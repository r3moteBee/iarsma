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
import { Button } from '../components/button.js';
import { EmptyState } from '../components/empty-state.js';
import { Notice } from '../components/notice.js';
import { Skeleton } from '../components/skeleton.js';
import { composeStateAtom } from '../compose-state.js';
import { selectedThreadIdAtom } from '../mail-state.js';
import { useThreadGet } from '../generated/capabilities/thread-get.js';
import { useInvoker } from '../runtime/invoker.js';
import { sanitizeHtml } from '../runtime/sanitizer.js';
import type { EmailFull } from '../runtime/jmap-client.js';
import {
  classifySender,
  colorFor,
  initialsFor,
  type SenderKind,
} from '../runtime/sender-color.js';
import { buildReplyPrefill, type ReplyMode } from './reply-prefill.js';
import styles from './thread-view.module.css';

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
  const { data, error, isLoading, refetch } = useThreadGet({ threadId });

  if (isLoading) {
    return (
      <section aria-label="Thread" aria-busy="true" className={styles['pane']}>
        <ThreadLoadingSkeleton />
      </section>
    );
  }
  if (error !== undefined) {
    return (
      <section aria-label="Thread" className={styles['pane']}>
        <div style={{ padding: 'var(--space-md)' }}>
          <Notice variant="error">Failed to load thread: {error.message}</Notice>
        </div>
      </section>
    );
  }
  if (data === undefined || data.emails.length === 0) {
    return (
      <section aria-label="Thread" className={styles['pane']}>
        <EmptyState
          title="This thread is empty"
          description="The conversation has no messages to display."
        />
      </section>
    );
  }

  return (
    <ThreadViewLoaded
      emails={data.emails as ReadonlyArray<EmailFull>}
      refetch={refetch}
    />
  );
}

function ThreadViewLoaded({
  emails,
  refetch,
}: {
  readonly emails: ReadonlyArray<EmailFull>;
  readonly refetch: () => Promise<void>;
}) {
  const tokens = useAtomValue(tokensAtom);
  const setComposeState = useSetAtom(composeStateAtom);
  const invoker = useInvoker();
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

  // Reply / Reply-all / Forward — handlers used by both the keyboard
  // model (r / R) and the sticky reply bar below. The user replies to
  // the *focused* message (which defaults to the latest), so the
  // shortcut and the bar click stay aligned.
  const replyTo = useCallback(
    (mode: ReplyMode) => {
      const target = emails[focusedIndex] ?? emails[emails.length - 1];
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
          replyTo('reply');
          break;
        case 'R':
          event.preventDefault();
          replyTo('reply-all');
          break;
      }
    },
    [moveFocus, expandAll, replyTo],
  );

  // Whole-thread mark-read/unread toggle. JMAP supports patching many
  // emailIds in one mail.modify call, so the whole thread flips in a
  // single round-trip. `seen` is derived from the LATEST email — that
  // matches mail-client convention (a thread is "unread" iff its
  // newest message is unread). After the modify, refetch() so the
  // header re-renders with the new derived state.
  const threadSeen =
    emails[emails.length - 1]?.keywords.find((k) => k.name === '$seen')?.value ?? false;
  const toggleThreadSeen = useCallback(() => {
    const next = !threadSeen;
    void (async () => {
      try {
        await invoker.invoke('mail.modify', {
          emailIds: emails.map((e) => e.id),
          patch: { 'keywords/$seen': next ? true : null },
        });
        await refetch();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[iarsma] mail.modify $seen failed:', e);
      }
    })();
  }, [invoker, refetch, emails, threadSeen]);

  const subject = emails[emails.length - 1]?.subject ?? '(no subject)';
  const messageCountLabel = `${emails.length} ${emails.length === 1 ? 'message' : 'messages'}`;

  return (
    // onKeyDown lives on the outer section so DOM events from any
    // focused message bubble to a single handler.
    <section aria-label="Thread" onKeyDown={onKeyDown} className={styles['pane']}>
      <header className={styles['header']}>
        <div className={styles['titleRow']}>
          <h2 className={styles['title']}>{subject}</h2>
          <span className={styles['sub']} aria-live="polite">
            {messageCountLabel}
          </span>
        </div>
        <div className={styles['actions']} aria-label="Thread actions">
          <button
            type="button"
            className={styles['iconBtn']}
            onClick={toggleThreadSeen}
            aria-label={threadSeen ? 'Mark thread unread' : 'Mark thread read'}
            aria-pressed={!threadSeen}
            title={threadSeen ? 'Mark unread' : 'Mark read'}
          >
            {threadSeen ? <MarkUnreadIcon /> : <MarkReadIcon />}
          </button>
        </div>
      </header>
      <div className={styles['msgs']}>
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
      <div className={styles['replyBar']} role="group" aria-label="Reply actions">
        <Button variant="primary" onClick={() => replyTo('reply')}>
          Reply
        </Button>
        <Button variant="secondary" onClick={() => replyTo('reply-all')}>
          Reply all
        </Button>
        <Button variant="ghost" onClick={() => replyTo('forward')}>
          Forward
        </Button>
      </div>
    </section>
  );
}

// ── Inline SVG icons ──────────────────────────────────────────────

function MarkReadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function MarkUnreadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
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

  const fromAddress = email.from?.[0];
  const senderName = fromAddress?.name ?? fromAddress?.email ?? '(no sender)';
  const senderEmail = fromAddress?.email ?? '';
  const recipients = formatRecipients(email);
  const date = formatDate(email.receivedAt);

  // Sender avatar — reuses the rule from sender-color.ts. Agent
  // detection isn't wired here yet (Phase 4 reserved for the
  // provenance layer); humans + system are classified by the
  // address/display-name heuristic.
  const kind: SenderKind = senderEmail !== ''
    ? classifySender(senderEmail, fromAddress?.name)
    : 'human';
  const initials = initialsFor(fromAddress?.name, senderEmail);
  const avatarColor = colorFor(senderEmail || senderName, kind);

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
      className={styles['msgCard']}
    >
      {/* Clickable header — toggles expanded state. Implemented as a
       * single <button> for a11y so Enter/Space activate it. */}
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-controls={`message-body-${email.id}`}
        className={styles['msgHead']}
      >
        <span
          className={styles['msgAvatar']}
          style={{ background: avatarColor }}
          aria-hidden="true"
        >
          {initials}
        </span>
        <span className={styles['msgWho']}>
          <span className={styles['msgName']}>{senderName}</span>
          {senderEmail !== '' && senderEmail !== senderName ? (
            <span className={styles['msgEmail']}>{senderEmail}</span>
          ) : null}
        </span>
        <span className={styles['msgDate']}>{date}</span>
      </button>
      {!isExpanded && email.preview !== undefined && email.preview.length > 0 ? (
        <div className={styles['msgPreview']}>{email.preview}</div>
      ) : null}
      {isExpanded && recipients !== null ? (
        <div className={styles['msgRecip']}>{recipients}</div>
      ) : null}
      {isExpanded ? (
        <>
          {hasExternalImages && !externalContentAllowed ? (
            <div className={styles['notice']} role="status">
              <span className={styles['noticeText']}>External images are blocked.</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExternalContentAllowed(true)}
                aria-label={`Show external images in this message from ${senderName}`}
              >
                Show
              </Button>
            </div>
          ) : null}
          <div
            id={`message-body-${email.id}`}
            role="region"
            aria-label="Message body"
            className={styles['msgBody']}
          >
            {sanitized !== null ? (
              <div
                data-testid="message-html-body"
                // sanitizeHtml ran above. The output is the security
                // boundary — never bypass it for sender-controlled bytes.
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: sanitized }}
              />
            ) : email.bodyText !== undefined && email.bodyText.length > 0 ? (
              <pre data-testid="message-text-body">{email.bodyText}</pre>
            ) : (
              <p className={styles['msgEmpty']}>(empty body)</p>
            )}
          </div>
          {email.attachments.length > 0 ? <Attachments email={email} /> : null}
        </>
      ) : null}
    </article>
  );
}

/* PR 5: per-message ReplyActions deleted — Reply / Reply all / Forward
 * now live in the sticky bar at the bottom of the pane (see
 * ThreadViewLoaded). The keyboard shortcuts (`r`, `R`) still target
 * the focused message via the parent's `replyTo`. */

function Attachments({ email }: { readonly email: EmailFull }) {
  // Inline (cid:-referenced) attachments are typically rendered inside
  // the body itself; we only chrome-list "real" downloadable
  // attachments. When disposition is unknown, default to listing.
  const visible = email.attachments.filter(
    (a) => a.disposition !== 'inline',
  );
  if (visible.length === 0) return null;
  return (
    <section aria-label="Attachments" className={styles['attach']}>
      {visible.map((a) => (
        <span key={a.id} className={styles['attachItem']}>
          <span>{a.name ?? '(unnamed)'}</span>
          <span className={styles['attachSize']}>{formatBytes(a.size)}</span>
        </span>
      ))}
    </section>
  );
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

