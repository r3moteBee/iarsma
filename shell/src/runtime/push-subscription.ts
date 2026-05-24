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
 * Auth: the bearer token is appended as a query parameter
 * (`access_token=<token>`) per RFC 8620 §7.3.1 — EventSource does not
 * support custom request headers.
 */

import { useEffect, useRef } from 'react';
import type { Session } from './jmap-client.js';
import type { CachePurposeKey } from './cache-storage.js';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type StateChange = {
  readonly changed: Readonly<Record<string, string>>;
};

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

export type UsePushSubscriptionOptions = {
  readonly session: Session | null;
  readonly getAuthToken: () => string | null;
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
    let es: EventSource | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;

    function buildUrl(): string | null {
      const token = getAuthTokenRef.current();
      if (token === null) {
        return null;
      }
      // RFC 8620 §7.3: append query parameters.
      const separator = session.eventSourceUrl.includes('?') ? '&' : '?';
      return `${session.eventSourceUrl}${separator}types=*&closeafter=state&ping=30&access_token=${encodeURIComponent(token)}`;
    }

    function open(): void {
      close();
      const url = buildUrl();
      if (url === null) {
        // eslint-disable-next-line no-console
        console.warn('[iarsma] push-subscription: no auth token, skipping EventSource open');
        return;
      }
      es = new EventSource(url);

      es.addEventListener('state', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as {
            changed?: Record<string, Record<string, string>>;
          };
          // JMAP StateChange object (RFC 8620 §7.1): the `changed` map
          // is `accountId → { typeName → stateToken }`. We flatten all
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
      });

      es.onerror = () => {
        // EventSource auto-reconnects on error (browser built-in).
        // Log a warning so transient issues are visible in devtools.
        // eslint-disable-next-line no-console
        console.warn('[iarsma] push-subscription: EventSource error (will auto-reconnect)');
      };
    }

    function close(): void {
      if (es !== null) {
        es.close();
        es = null;
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
        // Reopen if closed (either by the hidden timer or by an error
        // that exhausted reconnect attempts — unlikely but defensive).
        if (es === null) {
          open();
        }
      }
    }

    open();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
      close();
    };
  }, [opts.session]);
}
