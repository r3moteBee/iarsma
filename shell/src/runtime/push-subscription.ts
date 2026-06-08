/**
 * JMAP Push Subscription via EventSource (Phase 3c).
 *
 * Opens a Server-Sent Events connection to the JMAP server's
 * `eventSourceUrl` (RFC 8620 §7.3) and translates `state` events into
 * cache invalidation signals.
 *
 * Lifecycle:
 *   - Connection opens when `session` is non-null.
 *   - Connection closes on sign-out (`session` becomes null) or unmount.
 *   - Tab visibility optimization: after 5 minutes of `document.hidden`,
 *     the connection is closed. On `visibilitychange` back to visible,
 *     it reopens. This avoids holding idle SSE connections for
 *     backgrounded tabs.
 *
 * Auth: Stalwart's `/jmap/eventsource/` endpoint requires
 * `Authorization: Bearer <token>`. Browsers don't allow setting
 * headers on the native EventSource API, so we use a fetch-based
 * stream reader that parses the `text/event-stream` protocol
 * manually. The implementation handles:
 *   - SSE field lines (`event:`, `data:`, `:` comments for pings)
 *   - Multi-line `data:` payloads (CRLF or LF terminators)
 *   - Reconnect on stream end / network error, with a 1.5s backoff
 *
 * PR 29 — the original Phase-3c implementation used native
 * EventSource + `?access_token=`, which Stalwart rejects with 401.
 */

import { atom } from 'jotai';
import { useEffect, useRef } from 'react';
import type { Session } from './jmap-client.js';
import type { CachePurposeKey } from './cache-storage.js';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type StateChange = {
  readonly changed: Readonly<Record<string, string>>;
};

/**
 * Monotonic generation counter that bumps on every JMAP push state
 * change. Read-hooks include it as a refetch dep, so any subscription
 * to this atom causes a re-fetch the next time the hook's effect runs.
 *
 * Coarser than per-type invalidation (every state change nudges every
 * read-hook), but the stale-while-revalidate path on cachedInvoker
 * makes the redundant calls cheap — cache hits return immediately while
 * the actual JMAP fetch happens in the background. PR 29.
 */
export const pushGenerationAtom = atom(0);

// ──────────────────────────────────────────────────────────────────────
// Pure mapping function
// ──────────────────────────────────────────────────────────────────────

/**
 * Map JMAP state-change type names to `CachePurposeKey` entries that
 * should be invalidated. Types not recognized by the cache layer are
 * silently ignored.
 */
export function mapStateChangeToCacheInvalidations(
  changes: StateChange,
): readonly CachePurposeKey[] {
  const purposes: CachePurposeKey[] = [];
  if ('Email' in changes.changed) {
    purposes.push('threads', 'threadBodies', 'searchResults');
  }
  if ('Mailbox' in changes.changed) {
    purposes.push('mailboxes');
  }
  if ('Identity' in changes.changed) {
    purposes.push('identities');
  }
  return purposes;
}

// ──────────────────────────────────────────────────────────────────────
// React hook
// ──────────────────────────────────────────────────────────────────────

/** How long (ms) a tab must be hidden before we close the EventSource. */
const HIDDEN_TIMEOUT_MS = 5 * 60 * 1000;

/** Backoff schedule for SSE reconnects (PR 56 / CoWork follow-up). The
 *  cap matches the BFCache resume window and the typical user-attention
 *  threshold: longer waits feel broken; shorter waits hammer the
 *  server when something's persistently wrong. */
const RECONNECT_BACKOFF_MS = [1500, 3000, 6000, 12000, 24000, 60000] as const;
/** After this many consecutive failures we give up and stop reconnecting.
 *  The app degrades gracefully — read-hooks still work; the user just
 *  doesn't get realtime push. */
const MAX_RECONNECT_ATTEMPTS = RECONNECT_BACKOFF_MS.length;

/**
 * Expand the RFC 6570 URI template variables in Stalwart's
 * `eventSourceUrl` to concrete values for the JMAP push subscription.
 *
 * Per RFC 8620 §7.3 the session resource's `eventSourceUrl` is a URI
 * template like
 *   `/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}`
 * and the client MUST expand the variables. The earlier implementation
 * naively appended `?types=*&closeafter=state&ping=30` regardless,
 * leaving the literal `{types}` placeholders in place; Stalwart then
 * rejected the malformed URL with 400 every cycle (PR 56).
 *
 * Pure function — exported for unit tests.
 */
export function buildPushUrl(eventSourceUrl: string): string {
  // RFC 6570 template form — expand the three variables Stalwart's
  // session resource publishes. We URL-encode `*` because some
  // intermediaries (and the spec's level-2 expansion) treat `*` as a
  // reserved char inside templates.
  if (eventSourceUrl.includes('{')) {
    return eventSourceUrl
      .replace('{types}', encodeURIComponent('*'))
      .replace('{closeafter}', 'state')
      .replace('{ping}', '30');
  }
  // Legacy / non-templated URL — append as query params, dedup the
  // separator. Kept so a hand-configured non-Stalwart server that
  // skips the template form still works.
  const sep = eventSourceUrl.includes('?') ? '&' : '?';
  return `${eventSourceUrl}${sep}types=*&closeafter=state&ping=30`;
}

export type UsePushSubscriptionOptions = {
  readonly session: Session | null;
  readonly getAuthToken: () => string | null | Promise<string | null>;
  readonly onStateChange: (changes: StateChange) => void;
};

/**
 * Manage an EventSource connection to the JMAP server for real-time
 * state change notifications.
 *
 * The hook is intentionally fire-and-forget: callers provide a callback
 * and the hook manages the connection lifecycle (open, close, reconnect
 * on visibility change). EventSource's built-in reconnect handles
 * transient network errors.
 */
export function usePushSubscription(opts: UsePushSubscriptionOptions): void {
  // Refs keep the latest callback / token getter available to the
  // EventSource listener without forcing a reconnect on every render.
  const onStateChangeRef = useRef(opts.onStateChange);
  onStateChangeRef.current = opts.onStateChange;

  const getAuthTokenRef = useRef(opts.getAuthToken);
  getAuthTokenRef.current = opts.getAuthToken;

  useEffect(() => {
    if (opts.session === null) {
      return;
    }

    const session = opts.session;
    let abort: AbortController | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    // PR 56 — track consecutive failures so we back off and eventually
    // stop hammering the server. Reset to 0 on any successful
    // connection (response.ok with a readable body).
    let reconnectAttempts = 0;
    let gaveUp = false;

    function buildUrl(): string {
      return buildPushUrl(session.eventSourceUrl);
    }

    function handleStateEventData(rawData: string): void {
      try {
        const data = JSON.parse(rawData) as {
          changed?: Record<string, Record<string, string>>;
        };
        // JMAP StateChange object (RFC 8620 §7.1): the `changed` map
        // is `accountId → { typeName → stateToken }`. Flatten all
        // accounts into a single type→state map because iarsma is
        // single-account.
        if (data.changed !== undefined) {
          const merged: Record<string, string> = {};
          for (const accountChanges of Object.values(data.changed)) {
            for (const [type, state] of Object.entries(accountChanges)) {
              merged[type] = state;
            }
          }
          if (Object.keys(merged).length > 0) {
            onStateChangeRef.current({ changed: merged });
          }
        }
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[iarsma] push-subscription: failed to parse state event');
      }
    }

    // Minimal text/event-stream parser per WHATWG HTML §9.2.5 — handles
    // SSE field lines + multi-line data + flush on blank line.
    function parseSseChunk(
      chunk: string,
      state: { buffer: string; eventName: string; dataLines: string[] },
    ): void {
      state.buffer += chunk;
      let nlIndex: number;
      while ((nlIndex = state.buffer.indexOf('\n')) !== -1) {
        let line = state.buffer.slice(0, nlIndex);
        state.buffer = state.buffer.slice(nlIndex + 1);
        // Strip optional trailing \r from CRLF line endings.
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          // Blank line = dispatch.
          if (state.dataLines.length > 0) {
            const payload = state.dataLines.join('\n');
            // Stalwart fires the StateChange as event: 'state'. The
            // generic 'message' channel is unused.
            if (state.eventName === 'state' || state.eventName === 'message') {
              handleStateEventData(payload);
            }
          }
          state.eventName = 'message';
          state.dataLines = [];
          continue;
        }
        if (line.startsWith(':')) {
          // Comment / keep-alive ping — ignore.
          continue;
        }
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        // One leading space is allowed and stripped (HTML spec).
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') {
          state.eventName = value;
        } else if (field === 'data') {
          state.dataLines.push(value);
        }
        // 'id' and 'retry' fields ignored — we don't resume on Last-
        // Event-ID; the next StateChange after reconnect catches us up.
      }
    }

    async function open(): Promise<void> {
      close();
      if (cancelled) return;
      const token = await getAuthTokenRef.current();
      if (token === null) {
        // eslint-disable-next-line no-console
        console.warn(
          '[iarsma] push-subscription: no auth token; skipping SSE open',
        );
        return;
      }
      abort = new AbortController();
      const ac = abort;
      try {
        const response = await fetch(buildUrl(), {
          method: 'GET',
          headers: {
            accept: 'text/event-stream',
            authorization: `Bearer ${token}`,
          },
          signal: ac.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          // eslint-disable-next-line no-console
          console.warn(
            `[iarsma] push-subscription: SSE returned ${response.status} ${response.statusText}`,
          );
          scheduleReconnect();
          return;
        }
        // Successful response — reset the failure counter so the next
        // disconnect starts the backoff schedule from the top.
        reconnectAttempts = 0;
        const body = response.body;
        if (body === null) {
          scheduleReconnect();
          return;
        }
        const reader = body.getReader();
        const decoder = new TextDecoder('utf-8');
        const state = { buffer: '', eventName: 'message', dataLines: [] as string[] };
        while (!ac.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          parseSseChunk(decoder.decode(value, { stream: true }), state);
        }
        // Stream ended without abort — server closed (e.g. closeafter=state).
        // Reconnect so we keep receiving the next round of events.
        if (!ac.signal.aborted) scheduleReconnect();
      } catch (e) {
        if (!ac.signal.aborted) {
          // eslint-disable-next-line no-console
          console.warn('[iarsma] push-subscription: SSE error', e);
          scheduleReconnect();
        }
      }
    }

    function scheduleReconnect(): void {
      if (cancelled) return;
      if (gaveUp) return;
      if (reconnectTimer !== null) return;
      // PR 56 — exponential backoff with a hard ceiling. After
      // MAX_RECONNECT_ATTEMPTS consecutive failures, give up and let
      // the app run without realtime push (it still works — read-hooks
      // just don't auto-invalidate). Reconnection picks back up on
      // tab visibility transition (visible → reset attempts via the
      // `onVisibilityChange` path).
      const idx = Math.min(reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1);
      const base = RECONNECT_BACKOFF_MS[idx]!;
      // Jitter ±20% so a cluster of clients reconnecting after a
      // server blip doesn't synchronize into a thundering herd.
      const jitter = base * 0.4 * (Math.random() - 0.5);
      const delay = Math.max(0, Math.round(base + jitter));
      reconnectAttempts += 1;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        gaveUp = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[iarsma] push-subscription: giving up after ${MAX_RECONNECT_ATTEMPTS} failed reconnects; realtime push disabled until tab refocus`,
        );
        return;
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void open();
      }, delay);
    }

    function close(): void {
      if (abort !== null) {
        abort.abort();
        abort = null;
      }
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function onVisibilityChange(): void {
      if (document.hidden) {
        // Start a timer — if the tab stays hidden for HIDDEN_TIMEOUT_MS,
        // close the connection to free server resources.
        if (hiddenTimer === null) {
          hiddenTimer = setTimeout(() => {
            hiddenTimer = null;
            close();
          }, HIDDEN_TIMEOUT_MS);
        }
      } else {
        // Tab became visible again.
        if (hiddenTimer !== null) {
          clearTimeout(hiddenTimer);
          hiddenTimer = null;
        }
        // PR 56 — visibility transition is a strong "user is here"
        // signal, so reset the give-up state and the failure counter.
        // If push was broken because of a transient server issue,
        // refocusing the tab is exactly the moment to retry.
        gaveUp = false;
        reconnectAttempts = 0;
        if (abort === null && reconnectTimer === null) {
          void open();
        }
      }
    }

    void open();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
      close();
    };
  }, [opts.session]);
}
