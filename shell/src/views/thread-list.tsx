/**
 * ThreadList — virtualized inbox view (Phase 1 work item 4).
 *
 * Reads `selectedMailboxIdAtom` (PR-10) and renders the threads from
 * `useThreadList` (PR-11). Each row shows: subject, sender, snippet
 * preview, date, and a read/unread indicator. ARIA listbox/option
 * pattern (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) — single
 * selection, roving tabindex.
 *
 * Keyboard:
 *   - j / ArrowDown    move to next thread
 *   - k / ArrowUp      move to previous thread
 *   - Home / End       first / last visible thread
 *   - Enter / Space    activate (sets selectedThreadIdAtom)
 *
 * Out of scope today (deferred to capabilities not yet built):
 *   - `x` to mark read — needs `mail.modify` (Phase 3 destructive
 *     capability surface).
 *   - Infinite scroll / "load more" pagination — Phase 1 ships the
 *     first page (50 by default); item 8 (storage layer) wires
 *     state-token-keyed delta sync that subsumes naive pagination.
 *   - "Open" thread — wired via `selectedThreadIdAtom`; the
 *     ThreadView (item 7) reads it. Today the atom is set but no
 *     consumer renders.
 *
 * Virtualization: `@tanstack/react-virtual` keeps DOM small for big
 * inboxes. The estimated row height is approximate; the library
 * remeasures on first render to adjust.
 */

import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Button } from '../components/button.js';
import { Dialog } from '../components/dialog.js';
import { EmptyState } from '../components/empty-state.js';
import { Notice } from '../components/notice.js';
import { Skeleton } from '../components/skeleton.js';
import { composeStateAtom } from '../compose-state.js';
import { useMailboxList } from '../generated/capabilities/mailbox-list.js';
import { useThreadList } from '../generated/capabilities/thread-list.js';
import { useThreadSearch } from '../generated/capabilities/thread-search.js';
import {
  searchQueryAtom,
  selectedMailboxIdAtom,
  selectedThreadIdAtom,
} from '../mail-state.js';
import { useInvoker } from '../runtime/invoker.js';
import type { EmailFull, ThreadGet } from '../runtime/jmap-client.js';
import {
  classifySender,
  colorFor,
  initialsFor,
  kindLabel,
  type SenderKind,
} from '../runtime/sender-color.js';
import type { ToolError } from '../runtime/types.js';
import { buildDraftPrefill } from './draft-prefill.js';
import styles from './thread-list.module.css';

// Canonical English label for special-use mailboxes. Mirrors the map
// in components/mailbox-tree-view.tsx — duplicated here rather than
// extracted because the map is tiny, rarely changes, and a shared
// helper module for 7 string constants is more code than the
// duplication.
const ROLE_LABEL: Record<string, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Trash',
  junk: 'Junk',
  archive: 'Archive',
  important: 'Important',
};

type MailboxLike = {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
  readonly unreadEmails?: number;
};

function getMailboxLabel(
  mailbox: MailboxLike | undefined,
  fallback: string,
): string {
  if (mailbox === undefined) return fallback;
  if (mailbox.role !== undefined && ROLE_LABEL[mailbox.role] !== undefined) {
    return ROLE_LABEL[mailbox.role]!;
  }
  return mailbox.name;
}

type ThreadListData = {
  readonly threads: ReadonlyArray<{
    readonly id: string;
    readonly latestEmail: {
      readonly id: string;
      readonly threadId: string;
      readonly from?: ReadonlyArray<{ name?: string; email: string }>;
      readonly to?: ReadonlyArray<{ name?: string; email: string }>;
      readonly subject?: string;
      readonly preview?: string;
      readonly receivedAt: string;
      readonly keywords: ReadonlyArray<{ name: string; value: boolean }>;
      readonly size: number;
    };
  }>;
  readonly position: number;
  readonly total?: number;
};

// Initial estimate only. The virtualizer's `measureElement` overrides this
// with each row's actual rendered height on first paint — so future content
// changes (e.g. adding an avatar that makes rows taller) won't reintroduce
// the row-overlap bug fixed in PR 3. The value matches `--row-mail` at
// density=1 so the initial frame doesn't reflow when measurement settles.
const ROW_HEIGHT_PX = 72;

export function ThreadList() {
  const mailboxId = useAtomValue(selectedMailboxIdAtom);
  const searchQuery = useAtomValue(searchQueryAtom);
  // Search mode wins over mailbox selection — when the user types in
  // the header search, results stream into ThreadList regardless of
  // which mailbox they had open.
  if (searchQuery.trim() !== '') {
    return <ThreadListSearchMode query={searchQuery.trim()} />;
  }
  if (mailboxId === null) {
    // After the auto-select effect in App.tsx, this state should be rare
    // (mailboxes still loading on first paint). Keep an EmptyState
    // anyway so the pane never goes blank.
    return (
      <section aria-label="Threads">
        <EmptyState
          title="No mailbox selected"
          description="Pick a mailbox from the sidebar to see its threads."
        />
      </section>
    );
  }
  return <ThreadListWithMailbox mailboxId={mailboxId} />;
}

function ThreadListSearchMode({ query }: { readonly query: string }) {
  const { data, error, isLoading, refetch } = useThreadSearch({ query });
  // Search mode doesn't carry a mailboxId — `isDrafts` is forced
  // false. Future "search within Drafts only" could pass `inMailboxId`
  // and recompute, but item 9 ships search-everywhere.
  const threadsLen = (data as ThreadListData | undefined)?.threads.length ?? 0;
  const total = (data as ThreadListData | undefined)?.total;
  const countText =
    total !== undefined ? `${threadsLen} of ${total} for "${query}"` : null;
  return (
    <ThreadListBody
      data={data as ThreadListData | undefined}
      error={error}
      isLoading={isLoading}
      isDrafts={false}
      isTrash={false}
      emptyMessage={`No results for "${query}".`}
      mailboxId={null}
      title={`Search: ${query}`}
      countText={countText}
      onRefresh={refetch}
    />
  );
}

function ThreadListWithMailbox({ mailboxId }: { readonly mailboxId: string }) {
  const { data, error, isLoading, refetch } = useThreadList({ mailboxId });
  const setSelectedThreadId = useSetAtom(selectedThreadIdAtom);
  const mailboxes = useMailboxList({});

  const currentMailbox = useMemo(() => {
    const list = (mailboxes.data ?? []) as ReadonlyArray<MailboxLike>;
    return list.find((m) => m.id === mailboxId);
  }, [mailboxes.data, mailboxId]);

  const isDrafts = currentMailbox?.role === 'drafts';
  const isTrash = currentMailbox?.role === 'trash';

  // Reset thread selection when the mailbox changes.
  useEffect(() => {
    setSelectedThreadId(null);
  }, [mailboxId, setSelectedThreadId]);

  const title = getMailboxLabel(currentMailbox, 'Mail');
  const threadsLen = data?.threads.length ?? 0;
  const total = data?.total;
  const unread = currentMailbox?.unreadEmails ?? 0;
  const countText =
    total !== undefined
      ? unread > 0
        ? `${unread} unread · 1–${threadsLen} of ${total}`
        : `1–${threadsLen} of ${total}`
      : null;

  return (
    <ThreadListBody
      data={data}
      error={error}
      isLoading={isLoading}
      isDrafts={isDrafts}
      isTrash={isTrash}
      emptyMessage={
        isTrash ? 'Trash is empty.' : 'No threads in this mailbox.'
      }
      mailboxId={mailboxId}
      title={title}
      countText={countText}
      onRefresh={refetch}
    />
  );
}

function ThreadListBody(props: {
  readonly data: ThreadListData | undefined;
  readonly error: ToolError | undefined;
  readonly isLoading: boolean;
  readonly isDrafts: boolean;
  /** Mailbox role === 'trash' (PR 30). Toggles destructive UI:
   *  toolbar Empty trash button + per-row Delete forever. */
  readonly isTrash: boolean;
  readonly emptyMessage: string;
  readonly mailboxId: string | null;
  readonly title: string;
  readonly countText: string | null;
  readonly onRefresh: () => Promise<void> | void;
}) {
  const { data, error, isLoading, isDrafts, isTrash, emptyMessage, mailboxId, title, countText, onRefresh } =
    props;
  const refetch = onRefresh;
  const selectedThreadId = useAtomValue(selectedThreadIdAtom);
  const setSelectedThreadId = useSetAtom(selectedThreadIdAtom);
  const setComposeState = useSetAtom(composeStateAtom);
  const invoker = useInvoker();
  const [emptyConfirmOpen, setEmptyConfirmOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const [emptyError, setEmptyError] = useState<string | null>(null);

  const threads = useMemo(() => data?.threads ?? [], [data?.threads]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    // Dynamic measurement (PR 3): the virtualizer reads each row's
    // actual height on first paint and recomputes offsets, so the
    // ESTIMATE → ACTUAL drift that caused the row-overlap bug is gone.
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 8,
  });

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Auto-focus the selected row, or the first row when nothing's
  // selected and we have data.
  useEffect(() => {
    if (threads.length === 0) {
      setFocusedIndex(null);
      return;
    }
    if (selectedThreadId !== null) {
      const idx = threads.findIndex((t) => t.id === selectedThreadId);
      if (idx >= 0) {
        setFocusedIndex(idx);
        return;
      }
    }
    if (focusedIndex === null) setFocusedIndex(0);
  }, [threads, selectedThreadId, focusedIndex]);

  const moveFocus = useCallback(
    (next: number) => {
      if (next < 0 || next >= threads.length) return;
      setFocusedIndex(next);
      virtualizer.scrollToIndex(next, { align: 'auto' });
      // Focus DOM after the next paint so the new row's tabIndex=0 has
      // applied. queueMicrotask is sufficient for the simple case;
      // requestAnimationFrame would be safer if we ever batch many
      // focus moves.
      queueMicrotask(() => {
        // PR 4.5: focus target moved from the row <li> to the primary
        // <button> inside it. The li wrapper carries the data-attr;
        // its first <button> child is the row's clickable surface.
        const li = scrollRef.current?.querySelector<HTMLLIElement>(
          `[data-thread-index="${next}"]`,
        );
        const btn = li?.querySelector<HTMLButtonElement>('button');
        btn?.focus();
      });
    },
    [threads.length, virtualizer],
  );

  const onSelect = useCallback(
    (idx: number) => {
      const thread = threads[idx];
      if (thread === undefined) return;
      setFocusedIndex(idx);
      if (!isDrafts) {
        setSelectedThreadId(thread.id);
        return;
      }
      // Drafts path: fetch thread.get imperatively, reopen the draft
      // body in the composer. Don't update selectedThreadId — the
      // composer modal is the user's view of this draft.
      void (async () => {
        try {
          const result = (await invoker.invoke<{ threadId: string }, ThreadGet>(
            'thread.get',
            { threadId: thread.id },
          )) as ThreadGet;
          // A draft thread typically has a single email — take the
          // latest one (chronological order is preserved by the
          // parser).
          const draftEmail = result.emails[result.emails.length - 1] as
            | EmailFull
            | undefined;
          if (draftEmail === undefined) return;
          setComposeState({
            kind: 'open',
            prefill: buildDraftPrefill(draftEmail),
          });
        } catch (e) {
          // Surface via the existing thread-list error path? It's
          // mid-click flow, no good UI surface yet. Console-log and
          // leave the user in the thread list.
          // eslint-disable-next-line no-console
          console.warn('[iarsma] failed to reopen draft:', e);
        }
      })();
    },
    [threads, setSelectedThreadId, isDrafts, invoker, setComposeState],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      // `focusedIndex` starts null and is set to 0 by the
      // selection-sync useEffect. A keystroke that arrives *between*
      // the initial render and the effect commit would otherwise be a
      // silent no-op — manifests as a CI race and as a real-user UX
      // glitch (press j on a freshly-loaded mailbox, nothing happens).
      // Treat null as "before the cursor" so j/ArrowDown moves to 0
      // and k/ArrowUp / Home behave consistently.
      const i = focusedIndex ?? -1;
      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(i + 1);
          break;
        case 'k':
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(i - 1);
          break;
        case 'Home':
          event.preventDefault();
          moveFocus(0);
          break;
        case 'End':
          event.preventDefault();
          moveFocus(threads.length - 1);
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          // Activation requires a real focus position — null means the
          // user never moved the cursor, so Enter is a no-op (matches
          // a fresh-load listbox with no row highlighted).
          if (i >= 0) onSelect(i);
          break;
      }
    },
    [focusedIndex, moveFocus, onSelect, threads.length],
  );

  // Per-row mail.modify wire-up (PR 4.5). `refetch()` runs after a
  // successful mutate so the row's $seen/$flagged reflects the new
  // state without waiting for a push subscription (Phase 7+). The
  // mail.modify contract uses the legacy `contract` export shape and
  // doesn't have a generated React hook today — invoking via
  // `useInvoker` is the same path the existing send/draft flows use.
  const toggleKeyword = useCallback(
    (emailId: string, keyword: '$seen' | '$flagged', set: boolean) => {
      void (async () => {
        try {
          await invoker.invoke('mail.modify', {
            emailIds: [emailId],
            patch: { [`keywords/${keyword}`]: set ? true : null },
          });
          await refetch();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[iarsma] mail.modify ${keyword} failed:`, e);
        }
      })();
    },
    [invoker, refetch],
  );

  const items = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // PR 30 — Empty trash. Queries the trash mailbox for email ids
  // via mail.list-ids (up to maxIds=500 per call; clicking again
  // handles more), then calls mail.purge with the batch.
  const handleEmptyTrash = async (): Promise<void> => {
    if (!isTrash || mailboxId === null) return;
    setEmptyError(null);
    setEmptying(true);
    try {
      const listResult = await invoker.invoke<unknown, { emailIds: string[] }>(
        'mail.list-ids',
        { mailboxId },
      );
      const ids = (listResult as { emailIds: string[] }).emailIds ?? [];
      if (ids.length === 0) {
        setEmptyConfirmOpen(false);
        return;
      }
      await invoker.invoke('mail.purge', { emailIds: ids });
      setEmptyConfirmOpen(false);
      await refetch();
    } catch (e) {
      setEmptyError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmptying(false);
    }
  };

  // Always render the header — even on loading/empty/error states —
  // so the pane doesn't blink between "no chrome" and "header + body"
  // when data lands. Only the inner body switches by state.
  const headerEl = (
    <header className={styles['header']}>
      <div className={styles['titleRow']}>
        <h2 className={styles['title']}>{title}</h2>
        {countText !== null ? (
          <span className={styles['sub']} aria-live="polite">
            {countText}
          </span>
        ) : null}
      </div>
      <div className={styles['toolbar']} aria-label="Mailbox actions">
        <button
          type="button"
          className={styles['iconBtn']}
          onClick={() => void refetch()}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
        <span className={styles['toolbarSpacer']} />
        {/* PR 30 — Empty trash button. Only shown in the Trash
         *  mailbox. Disabled when there's nothing to empty. */}
        {isTrash ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setEmptyConfirmOpen(true)}
            disabled={(data?.total ?? 0) === 0 || emptying}
            aria-label="Empty trash"
          >
            {emptying ? 'Emptying…' : 'Empty trash'}
          </Button>
        ) : null}
      </div>
    </header>
  );

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className={styles['body']} aria-busy="true">
        <ThreadListLoadingSkeleton />
      </div>
    );
  } else if (error !== undefined) {
    body = (
      <div className={styles['body']} style={{ padding: 'var(--space-md)' }}>
        <Notice variant="error">Failed to load threads: {error.message}</Notice>
      </div>
    );
  } else if (threads.length === 0) {
    body = (
      <div className={styles['body']}>
        <EmptyState title="Nothing here yet" description={emptyMessage} />
      </div>
    );
  } else {
    body = (
      <div ref={scrollRef} className={styles['body']}>
        <ul
          aria-label="Threads"
          onKeyDown={onKeyDown}
          className={styles['list']}
          // The virtualizer needs a fixed-height container to compute
          // scroll offsets against. The <ul> stays a normal block; its
          // <li> children are absolute-positioned.
          style={{ height: `${totalHeight}px` }}
        >
          {items.map((vi) => {
            const thread = threads[vi.index];
            if (thread === undefined) return null;
            const isSelected = thread.id === selectedThreadId;
            const isFocused = vi.index === focusedIndex;
            return (
              <ThreadRow
                key={thread.id}
                ref={virtualizer.measureElement}
                index={vi.index}
                thread={thread}
                offsetTop={vi.start}
                rowHeight={ROW_HEIGHT_PX}
                isSelected={isSelected}
                isFocused={isFocused}
                onClick={() => onSelect(vi.index)}
                onToggleFlag={(id, current) => toggleKeyword(id, '$flagged', !current)}
                onToggleRead={(id, current) => toggleKeyword(id, '$seen', !current)}
              />
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <section
      aria-label={title}
      style={{
        // PR 3: flex into the pane parent so the body inside can
        // flex: 1; min-height: 0 and bound itself to the pane.
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {headerEl}
      {body}
      <Dialog
        open={emptyConfirmOpen}
        onClose={() => {
          if (emptying) return;
          setEmptyConfirmOpen(false);
          setEmptyError(null);
        }}
        title="Empty trash?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setEmptyConfirmOpen(false)}
              disabled={emptying}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleEmptyTrash();
              }}
              disabled={emptying}
            >
              {emptying ? 'Emptying…' : 'Empty trash'}
            </Button>
          </>
        }
      >
        <p>
          Every message in the Trash will be permanently deleted.
          This can't be undone.
        </p>
        {(data?.total ?? 0) > 500 ? (
          <p>
            Trash holds {data?.total} messages; this clears the first
            500. Click Empty trash again to continue.
          </p>
        ) : null}
        {emptyError !== null ? (
          <Notice variant="error">{emptyError}</Notice>
        ) : null}
      </Dialog>
    </section>
  );
}

type ThreadRowProps = {
  readonly index: number;
  readonly thread: import('../runtime/jmap-client.js').ThreadSummary;
  readonly offsetTop: number;
  /** Initial min-height for the row. Virtualizer's `measureElement`
   *  overrides the actual rendered height after first paint. */
  readonly rowHeight: number;
  readonly isSelected: boolean;
  readonly isFocused: boolean;
  readonly onClick: () => void;
  /** Per-row Flag toggle. `current` is the row's pre-click value so
   *  the caller can compute the patch direction without re-reading
   *  state. */
  readonly onToggleFlag: (emailId: string, current: boolean) => void;
  readonly onToggleRead: (emailId: string, current: boolean) => void;
};

const ThreadRow = forwardRef<HTMLLIElement, ThreadRowProps>(function ThreadRow(props, ref) {
  const {
    index,
    thread,
    offsetTop,
    rowHeight,
    isSelected,
    isFocused,
    onClick,
    onToggleFlag,
    onToggleRead,
  } = props;
  const e = thread.latestEmail;
  const seen = e.keywords.find((k) => k.name === '$seen')?.value ?? false;
  const flagged = e.keywords.find((k) => k.name === '$flagged')?.value ?? false;
  const from = e.from?.[0];
  const senderName = formatSender(e.from);
  const senderEmail = from?.email ?? '';
  // Phase 4 ships human/system classification only; agent senders need
  // an explicit signal from the provenance layer (deferred — see
  // runtime/sender-color.ts).
  const kind: SenderKind = senderEmail !== ''
    ? classifySender(senderEmail, from?.name)
    : 'human';
  const initials = initialsFor(from?.name, senderEmail);
  const avatarColor = colorFor(senderEmail || senderName, kind);
  const subject = e.subject ?? '(no subject)';
  const date = formatDate(e.receivedAt);

  const liClassName = [
    styles['rowLi'],
    isSelected ? styles['rowLiSelected'] : '',
    !seen ? styles['rowLiUnread'] : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Compose a screen-reader-friendly label for the primary row button.
  // Sighted users get the unread dot + accent-active date + flag icon;
  // AT users get the same information through the aria-label below.
  const ariaLabel = [
    `${kindLabel(kind)} ${senderName}: ${subject}`,
    seen ? null : 'unread',
    flagged ? 'flagged' : null,
    date,
  ]
    .filter((s): s is string => s !== null)
    .join(', ');

  return (
    <li
      ref={ref}
      data-thread-id={thread.id}
      data-thread-index={index}
      data-index={index}
      className={liClassName}
      style={{
        position: 'absolute',
        top: `${offsetTop}px`,
        left: 0,
        right: 0,
        /* PR 3 row-overlap fix carried forward: minHeight +
         * measureElement. The actual rendered height drives the offset
         * table; the initial estimate matches `--row-mail`. */
        minHeight: `${rowHeight}px`,
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        id={`thread-row-${thread.id}`}
        // data-thread-id is duplicated from the <li> so tests that
        // walk from [tabindex="0"] to the row identity keep working
        // without an extra closest('li') step.
        data-thread-id={thread.id}
        data-thread-index={index}
        className={styles['row']}
        onClick={onClick}
        tabIndex={isFocused ? 0 : -1}
        aria-current={isSelected ? 'true' : undefined}
        aria-label={ariaLabel}
      >
        <span className={styles['udot']} aria-hidden="true" />
        <span
          className={styles['avatar']}
          style={{ background: avatarColor }}
          aria-hidden="true"
          title={kindLabel(kind)}
        >
          {initials}
        </span>
        <span className={styles['main']}>
          <span className={styles['sender']}>{senderName}</span>
          <span className={styles['subject']}>{subject}</span>
          {e.preview !== undefined && e.preview.length > 0 ? (
            <span className={styles['preview']}>{e.preview}</span>
          ) : null}
        </span>
        <span className={styles['meta']}>
          <span className={styles['date']}>{date}</span>
          {flagged ? (
            <span aria-label="Flagged" title="Flagged" style={{ color: 'var(--accent)' }}>
              <FlagIcon filled />
            </span>
          ) : null}
        </span>
      </button>
      {/* Per-row action buttons sit as DOM siblings of the row button
       * inside the <li>. axe-core's nested-interactive rule is
       * satisfied because the buttons aren't descendants of an
       * interactive element. */}
      <div className={styles['rowActions']} role="group" aria-label="Row actions">
        <button
          type="button"
          className={`${styles['iconBtn']} ${flagged ? styles['iconBtnFlagged'] : ''}`}
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleFlag(e.id, flagged);
          }}
          aria-label={flagged ? `Unflag: ${subject}` : `Flag: ${subject}`}
          aria-pressed={flagged}
          title={flagged ? 'Unflag' : 'Flag'}
        >
          <FlagIcon filled={flagged} />
        </button>
        <button
          type="button"
          className={styles['iconBtn']}
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleRead(e.id, seen);
          }}
          aria-label={seen ? `Mark unread: ${subject}` : `Mark read: ${subject}`}
          aria-pressed={!seen}
          title={seen ? 'Mark unread' : 'Mark read'}
        >
          {seen ? <MarkUnreadIcon /> : <MarkReadIcon />}
        </button>
      </div>
    </li>
  );
});

// ── Inline SVG icons ──────────────────────────────────────────────

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  );
}

function FlagIcon({ filled }: { readonly filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

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

function formatSender(
  from: ReadonlyArray<{ name?: string; email: string }> | undefined,
): string {
  if (from === undefined || from.length === 0) return '(no sender)';
  const first = from[0]!;
  return first.name ?? first.email;
}

function formatDate(iso: string): string {
  // For now, plain locale-formatted date. Phase 7 will add relative-time
  // ("3h ago", "Yesterday") once we lock the i18n framework.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Skeleton rows shown while the thread list is loading. Five rows feels
 * like "real content arriving" without being so many that a fast load
 * causes a visible flash. Each row apes the three-line layout the real
 * row uses so the loading state doesn't reflow into something taller.
 */
function ThreadListLoadingSkeleton() {
  return (
    <div aria-hidden="true" style={{ padding: '0.5em' }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '0.5em 0.75em',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton width="40%" height="13px" />
          <Skeleton width="80%" height="15px" />
          <Skeleton width="65%" height="12px" />
        </div>
      ))}
    </div>
  );
}
