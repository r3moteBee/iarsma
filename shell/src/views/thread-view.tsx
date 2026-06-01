/**
 * ThreadView + MessageView — full thread reading surface
 * (Phase 1 work item 7).
 *
 * Reads `selectedThreadIdAtom` (PR-12), calls `useThreadGet` (PR-14),
 * renders messages chronologically. Each MessageView renders the
 * sanitized HTML body (via the html-sanitizer WASM component, PR-13)
 * or a plain-text fallback.
 *
 * Defaults match Gmail-style threading:
 *   - The most recent message starts expanded; older messages start
 *     collapsed (showing sender + date + preview).
 *   - External images blocked by default; per-message "Show external
 *     content" toggle enables them.
 *   - Click a collapsed row to expand it; click the expanded header
 *     to collapse.
 *
 * Keyboard:
 *   - n / ArrowDown    next message (also expands it)
 *   - p / ArrowUp      previous message (also expands it)
 *   - e                expand all messages in the thread
 *
 * Out of scope (deferred):
 *   - Quoted-reply collapsing inside body — landing with a future
 *     polish PR; the sanitized HTML preserves <blockquote> already,
 *     so quoted content renders, just without the click-to-expand
 *     affordance.
 *   - Markdown rendering of plain-text bodies — needs the markdown
 *     WASM component (currently a placeholder). Plain-text bodies
 *     render as preformatted today.
 *   - Inline-image rewriting (cid: → data: with the attachment
 *     bytes) — needs the future `mail.attachment.download` capability.
 *     For now, sanitized HTML keeps `cid:` URLs in src; the image
 *     renders broken until cid resolution lands.
 */

import { useAtomValue, useSetAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { tokensAtom } from '../auth-state.js';
import { EmptyState } from '../components/empty-state.js';
import { Skeleton } from '../components/skeleton.js';
import { composeStateAtom } from '../compose-state.js';
import { selectedThreadIdAtom } from '../mail-state.js';
import { useThreadGet } from '../generated/capabilities/thread-get.js';
import { sanitizeHtml } from '../runtime/sanitizer.js';
import type { EmailFull } from '../runtime/jmap-client.js';
import { buildReplyPrefill, type ReplyMode } from './reply-prefill.js';

export function ThreadView() {
  const threadId = useAtomValue(selectedThreadIdAtom);
  if (threadId === null) {
    return (
      <section aria-label="Thread">
        <EmptyState
          title="No conversation selected"
          description="Pick a message from the list to read it here."
        />
      </section>
    );
  }
  return <ThreadViewWithThread threadId={threadId} />;
}

function ThreadViewWithThread({ threadId }: { readonly threadId: string }) {
  const { data, error, isLoading } = useThreadGet({ threadId });

  if (isLoading) {
    return (
      <section aria-label="Thread" aria-busy="true">
        <ThreadLoadingSkeleton />
      </section>
    );
  }
  if (error !== undefined) {
    return (
      <section aria-label="Thread">
        <p role="alert">Failed to load thread: {error.message}</p>
      </section>
    );
  }
  if (data === undefined || data.emails.length === 0) {
    return (
      <section aria-label="Thread">
        <EmptyState
          title="This thread is empty"
          description="The conversation has no messages to display."
        />
      </section>
    );
  }

  return <ThreadViewLoaded emails={data.emails as ReadonlyArray<EmailFull>} />;
}

function ThreadViewLoaded({
  emails,
}: {
  readonly emails: ReadonlyArray<EmailFull>;
}) {
  const tokens = useAtomValue(tokensAtom);
  const setComposeState = useSetAtom(composeStateAtom);
  const userEmail = tokens?.email ?? 'unknown@example.invalid';
  // Latest message is auto-expanded; older messages start collapsed.
  // Selection is keyed by index — emails are immutable per render so
  // index is stable across the lifetime of this view.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(
    () => new Set([emails.length - 1]),
  );
  const [focusedIndex, setFocusedIndex] = useState(emails.length - 1);
  const messageRefs = useRef<Array<HTMLElement | null>>([]);

  // Re-focus the focused message when the index changes.
  useEffect(() => {
    const el = messageRefs.current[focusedIndex];
    el?.focus();
  }, [focusedIndex]);

  const toggleExpanded = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setFocusedIndex(index);
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(emails.map((_, i) => i)));
  }, [emails]);

  const moveFocus = useCallback(
    (delta: number) => {
      setFocusedIndex((prev) => {
        const next = Math.min(emails.length - 1, Math.max(0, prev + delta));
        // Auto-expand the newly-focused message so the user can
        // immediately read it.
        setExpanded((s) => {
          if (s.has(next)) return s;
          const out = new Set(s);
          out.add(next);
          return out;
        });
        return next;
      });
    },
    [emails.length],
  );

  const replyToFocused = useCallback(
    (mode: ReplyMode) => {
      const target = emails[focusedIndex];
      if (target === undefined) return;
      setComposeState({
        kind: 'open',
        prefill: buildReplyPrefill({ email: target, mode, userEmail }),
      });
    },
    [emails, focusedIndex, userEmail, setComposeState],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'n':
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(1);
          break;
        case 'p':
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(-1);
          break;
        case 'e':
          event.preventDefault();
          expandAll();
          break;
        case 'r':
          // Plain `r` is reply; Shift+`r` (event.key === 'R') is
          // reply-all. We branch on the literal key value so the
          // shifted key is detected reliably across layouts.
          event.preventDefault();
          replyToFocused('reply');
          break;
        case 'R':
          event.preventDefault();
          replyToFocused('reply-all');
          break;
      }
    },
    [moveFocus, expandAll, replyToFocused],
  );

  return (
    // onKeyDown lives on the outer section so that DOM events from
    // any focused message bubble up to a single handler. Tests fire
    // keyDown on this region; production focus is on a message
    // article's tabIndex=0 root.
    <section aria-label="Thread" onKeyDown={onKeyDown}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '0.5em',
        }}
      >
        <h2 style={{ margin: 0 }}>
          {emails[emails.length - 1]?.subject ?? '(no subject)'}
        </h2>
        <span aria-live="polite">
          {emails.length} {emails.length === 1 ? 'message' : 'messages'}
        </span>
      </header>
      <div>
        {emails.map((email, index) => (
          <MessageView
            key={email.id}
            email={email}
            isExpanded={expanded.has(index)}
            isFocused={index === focusedIndex}
            onToggleExpand={() => toggleExpanded(index)}
            registerRef={(el) => {
              messageRefs.current[index] = el;
            }}
          />
        ))}
      </div>
    </section>
  );
}

function MessageView(props: {
  readonly email: EmailFull;
  readonly isExpanded: boolean;
  readonly isFocused: boolean;
  readonly onToggleExpand: () => void;
  readonly registerRef: (el: HTMLElement | null) => void;
}) {
  const { email, isExpanded, isFocused, onToggleExpand, registerRef } = props;
  const [externalContentAllowed, setExternalContentAllowed] = useState(false);

  // Run the html body through the sanitizer. Recompute when the
  // toggle flips so allowing external content shows previously-stripped
  // <img src="https://..."> tags.
  const sanitized = useMemo(() => {
    if (email.bodyHtml === undefined || email.bodyHtml.length === 0) return null;
    return sanitizeHtml(email.bodyHtml, externalContentAllowed);
  }, [email.bodyHtml, externalContentAllowed]);

  const sender = formatAddress(email.from?.[0]);
  const recipients = formatRecipients(email);
  const date = formatDate(email.receivedAt);

  // Whether the original html had any URL-bearing image src that the
  // default-off sanitizer would strip — used to decide whether to
  // show the toggle. Coarse heuristic: the html body contains
  // `src="http`, `src='http`, or `src=http`.
  const hasExternalImages = useMemo(
    () => email.bodyHtml !== undefined && /\bsrc\s*=\s*["']?https?:/i.test(email.bodyHtml),
    [email.bodyHtml],
  );

  return (
    <article
      ref={registerRef}
      aria-label={email.subject ?? '(no subject)'}
      aria-expanded={isExpanded}
      tabIndex={isFocused ? 0 : -1}
      data-message-id={email.id}
      style={{
        border: '1px solid var(--surface-3)',
        borderRadius: 4,
        marginBottom: '0.5em',
        background: 'var(--surface-1)',
        color: 'var(--text-1)',
        outline: 'inherit',
      }}
    >
      <header
        // Header is clickable to toggle. Implemented as a button so
        // a11y tools see the affordance and Enter/Space activate it.
        style={{ padding: '0.5em 0.75em' }}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          aria-controls={`message-body-${email.id}`}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5em' }}>
            <strong>{sender}</strong>
            <span style={{ flex: '0 0 auto', color: 'var(--text-2)' }}>{date}</span>
          </div>
          {!isExpanded && email.preview !== undefined ? (
            <div
              style={{
                color: 'var(--text-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: '0.25em',
              }}
            >
              {email.preview}
            </div>
          ) : null}
          {isExpanded && recipients !== null ? (
            <div style={{ color: 'var(--text-2)', marginTop: '0.25em', fontSize: '0.9em' }}>
              {recipients}
            </div>
          ) : null}
        </button>
      </header>
      {isExpanded ? (
        <div
          id={`message-body-${email.id}`}
          role="region"
          aria-label="Message body"
          style={{ padding: '0 0.75em 0.75em' }}
        >
          {hasExternalImages && !externalContentAllowed ? (
            <p
              style={{
                background: 'var(--surface-2)',
                padding: '0.5em',
                borderRadius: 4,
                margin: '0 0 0.75em',
                color: 'var(--text-2)',
              }}
            >
              External images are blocked.{' '}
              <button
                type="button"
                onClick={() => setExternalContentAllowed(true)}
                aria-label={`Show external images in this message from ${sender}`}
              >
                Show
              </button>
            </p>
          ) : null}
          {sanitized !== null ? (
            <div
              data-testid="message-html-body"
              // sanitizeHtml ran above. The output is the security
              // boundary — never bypass it for sender-controlled bytes.
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: sanitized }}
            />
          ) : email.bodyText !== undefined && email.bodyText.length > 0 ? (
            <pre
              data-testid="message-text-body"
              style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}
            >
              {email.bodyText}
            </pre>
          ) : (
            <p style={{ color: 'var(--text-3)' }}>(empty body)</p>
          )}
          {email.attachments.length > 0 ? (
            <Attachments email={email} />
          ) : null}
          <ReplyActions email={email} />
        </div>
      ) : null}
    </article>
  );
}

/**
 * Reply / Reply All / Forward action row — appears under the body of
 * each expanded message. Click → buildReplyPrefill → composeStateAtom
 * flips to `'open'` with the prefilled fields. The keyboard model
 * (`r`, `R`) wires the same actions globally on the focused message.
 */
function ReplyActions({ email }: { readonly email: EmailFull }) {
  const tokens = useAtomValue(tokensAtom);
  const setComposeState = useSetAtom(composeStateAtom);
  const userEmail = tokens?.email ?? 'unknown@example.invalid';
  const open = (mode: ReplyMode) => {
    setComposeState({
      kind: 'open',
      prefill: buildReplyPrefill({ email, mode, userEmail }),
    });
  };
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5em',
        marginTop: '0.75em',
        paddingTop: '0.5em',
        borderTop: '1px solid var(--surface-3)',
      }}
    >
      <button type="button" onClick={() => open('reply')}>
        Reply
      </button>
      <button type="button" onClick={() => open('reply-all')}>
        Reply all
      </button>
      <button type="button" onClick={() => open('forward')}>
        Forward
      </button>
    </div>
  );
}

function Attachments({ email }: { readonly email: EmailFull }) {
  // Inline (cid:-referenced) attachments are typically rendered inside
  // the body itself; we only chrome-list "real" downloadable
  // attachments. When disposition is unknown, default to listing.
  const visible = email.attachments.filter(
    (a) => a.disposition !== 'inline',
  );
  if (visible.length === 0) return null;
  return (
    <section aria-label="Attachments" style={{ marginTop: '0.75em' }}>
      <h3 style={{ fontSize: '0.95em', margin: '0 0 0.25em' }}>
        Attachments ({visible.length})
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {visible.map((a) => (
          <li
            key={a.id}
            style={{
              display: 'flex',
              gap: '0.5em',
              padding: '0.25em 0',
              borderTop: '1px solid var(--surface-3)',
            }}
          >
            <span style={{ flex: '1 1 auto' }}>{a.name ?? '(unnamed)'}</span>
            <span style={{ flex: '0 0 auto', color: 'var(--text-2)' }}>{a.type}</span>
            <span style={{ flex: '0 0 auto', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
              {formatBytes(a.size)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatAddress(a: { name?: string; email: string } | undefined): string {
  if (a === undefined) return '(no sender)';
  return a.name !== undefined ? `${a.name} <${a.email}>` : a.email;
}

function formatRecipients(email: EmailFull): string | null {
  const to = (email.to ?? []).map((a) => a.name ?? a.email);
  const cc = (email.cc ?? []).map((a) => a.name ?? a.email);
  if (to.length === 0 && cc.length === 0) return null;
  const parts: string[] = [];
  if (to.length > 0) parts.push(`To: ${to.join(', ')}`);
  if (cc.length > 0) parts.push(`Cc: ${cc.join(', ')}`);
  return parts.join(' · ');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Skeleton shown while a thread is being fetched. Apes the per-message
 * card shape (header strip + a few preview lines) so the page doesn't
 * reflow noticeably when real content lands.
 */
function ThreadLoadingSkeleton() {
  return (
    <div aria-hidden="true" style={{ padding: '1em', display: 'flex', flexDirection: 'column', gap: '1em' }}>
      <Skeleton width="70%" height="22px" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '1em',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <Skeleton width="40%" height="14px" />
          <Skeleton width="100%" height="13px" />
          <Skeleton width="95%" height="13px" />
          <Skeleton width="60%" height="13px" />
        </div>
      ))}
    </div>
  );
}

