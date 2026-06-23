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
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
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
import { LabelChip } from '../components/label-chip.js';
import { MenuButton } from '../components/menu-button.js';
import { Notice } from '../components/notice.js';
import { Skeleton } from '../components/skeleton.js';
import { composeStateAtom } from '../compose-state.js';
import { useMailboxList } from '../generated/capabilities/mailbox-list.js';
import { useThreadList } from '../generated/capabilities/thread-list.js';
import { useThreadSearchPaginated } from '../runtime/use-thread-search-paginated.js';
import { tokenize, buildSnippet, Highlight } from './highlight.js';
import {
  searchQueryAtom,
  mailboxScrollPositionsAtom,
  selectedMailboxIdAtom,
  selectedThreadIdAtom,
} from '../mail-state.js';
import { useInvoker } from '../runtime/invoker.js';
import { pushGenerationAtom } from '../runtime/push-subscription.js';
import type { EmailFull, ThreadGet } from '../runtime/jmap-client.js';
import {
  classifySender,
  colorFor,
  initialsFor,
  kindLabel,
  type SenderKind,
} from '../runtime/sender-color.js';
import type { LabelDef } from '../runtime/label-registry.js';
import { resolveLabels } from '../runtime/label-registry.js';
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

/** Stable empty array so rows in non-search mode don't churn React
 *  identity on every render (PR 53 / CoWork #15). */
const EMPTY_TOKENS: readonly string[] = [];

export function ThreadList({ labels = [] }: { readonly labels?: readonly LabelDef[] }) {
  const mailboxId = useAtomValue(selectedMailboxIdAtom);
  const searchQuery = useAtomValue(searchQueryAtom);
  // Search mode wins over mailbox selection — when the user types in
  // the header search, results stream into ThreadList regardless of
  // which mailbox they had open.
  if (searchQuery.trim() !== '') {
    return <ThreadListSearchMode query={searchQuery.trim()} labels={labels} />;
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
  return <ThreadListWithMailbox mailboxId={mailboxId} labels={labels} />;
}

function ThreadListSearchMode({ query, labels }: { readonly query: string; readonly labels: readonly LabelDef[] }) {
  // PR 53 / CoWork #15 — accumulate pages, drive infinite scroll from
  // the body's scroll handler, and pass the tokenized query down so
  // rows can highlight matches in the subject + preview snippet.
  const {
    threads,
    total,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refetch,
  } = useThreadSearchPaginated({ query });
  const data: ThreadListData = {
    threads,
    position: 0,
    ...(total !== undefined ? { total } : {}),
  };
  const tokens = useMemo(() => tokenize(query), [query]);
  const countText =
    total !== undefined ? `${threads.length} of ${total} for "${query}"` : null;
  return (
    <ThreadListBody
      data={data}
      error={error}
      isLoading={isLoading}
      isDrafts={false}
      isTrash={false}
      emptyMessage={`No results for "${query}".`}
      mailboxId={null}
      title={`Search: ${query}`}
      countText={countText}
      onRefresh={() => refetch()}
      tokens={tokens}
      isLoadingMore={isLoadingMore}
      hasMore={hasMore}
      onLoadMore={loadMore}
      labels={labels}
    />
  );
}

function ThreadListWithMailbox({ mailboxId, labels }: { readonly mailboxId: string; readonly labels: readonly LabelDef[] }) {
  const { data, error, isLoading, refetch } = useThreadList({ mailboxId });
  const setSelectedThreadId = useSetAtom(selectedThreadIdAtom);
  const mailboxes = useMailboxList({});

  const currentMailbox = useMemo(() => {
    const list = (mailboxes.data ?? []) as ReadonlyArray<MailboxLike>;
    return list.find((m) => m.id === mailboxId);
  }, [mailboxes.data, mailboxId]);

  const isDrafts = currentMailbox?.role === 'drafts';
  const isTrash = currentMailbox?.role === 'trash';

  // U-3 — the Inbox mailbox id, so Trash rows can offer "Move to Inbox".
  const inboxMailboxId = useMemo(() => {
    const list = (mailboxes.data ?? []) as ReadonlyArray<MailboxLike>;
    return list.find((m) => m.role === 'inbox')?.id;
  }, [mailboxes.data]);

  // Task 7 — candidate mailboxes for "Move to…": all mailboxes except
  // the current one. System roles are included (move to Trash, Archive…).
  const moveTargets = useMemo(() => {
    const list = (mailboxes.data ?? []) as ReadonlyArray<MailboxLike>;
    return list.filter((m) => m.id !== mailboxId);
  }, [mailboxes.data, mailboxId]);

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
      {...(inboxMailboxId !== undefined ? { inboxMailboxId } : {})}
      moveTargets={moveTargets}
      labels={labels}
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
  /** U-3 — Inbox mailbox id; present so Trash rows can restore. */
  readonly inboxMailboxId?: string;
  /** Task 7 — candidate mailboxes for "Move to…". Excludes the current
   *  mailbox. Empty in search mode (no single current mailbox). */
  readonly moveTargets?: ReadonlyArray<MailboxLike>;
  /** Search-mode props (PR 53 / CoWork #15). Defined only when the
   *  list is showing search results — mailbox-mode passes undefined
   *  and the body skips highlighting + pagination. */
  readonly tokens?: readonly string[];
  readonly isLoadingMore?: boolean;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
  /** Task 8 — label registry for resolving label chips on rows. */
  readonly labels?: readonly LabelDef[];
}) {
  const { data, error, isLoading, isDrafts, isTrash, emptyMessage, mailboxId, title, countText, onRefresh } =
    props;
  const tokens = props.tokens;
  const isLoadingMore = props.isLoadingMore === true;
  const hasMore = props.hasMore === true;
  const onLoadMore = props.onLoadMore;
  const labels = props.labels ?? [];
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

  // PR 51 / CoWork #8 — restore the scroll position when this list
  // remounts for a known mailbox. Throttled save runs from the
  // onScroll handler below. Search mode passes mailboxId=null, in
  // which case scroll persistence is skipped (each query is unique
  // enough that landing-at-top is the right default).
  const [scrollPositions, setScrollPositions] = useAtom(mailboxScrollPositionsAtom);
  useEffect(() => {
    if (mailboxId === null) return;
    const saved = scrollPositions[mailboxId];
    if (saved === undefined) return;
    // Defer one paint so the virtualizer has measured the rows and
    // can honor the requested scrollTop without snapping back to 0.
    const handle = requestAnimationFrame(() => {
      if (scrollRef.current !== null) scrollRef.current.scrollTop = saved;
    });
    return () => cancelAnimationFrame(handle);
    // We only want to restore when the *mailbox* changes — not on
    // every scrollPositions write (that would fight live scrolling).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailboxId]);

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

  // Per-row mail.modify wire-up (PR 4.5). `refetch()` runs after a
  // successful mutate so the row's $seen/$flagged reflects the new
  // state without waiting for a push subscription (Phase 7+). The
  // mail.modify contract uses the legacy `contract` export shape and
  // doesn't have a generated React hook today — invoking via
  // `useInvoker` is the same path the existing send/draft flows use.
  const bumpPushGeneration = useSetAtom(pushGenerationAtom);
  const toggleKeyword = useCallback(
    (emailId: string, keyword: '$seen' | '$flagged', set: boolean) => {
      void (async () => {
        try {
          await invoker.invoke('mail.modify', {
            emailIds: [emailId],
            patch: { keywords: { [keyword]: set ? true : null } },
          });
          await refetch();
          // PR 45 — refresh the sidebar unread badge + document title.
          if (keyword === '$seen') bumpPushGeneration((n) => n + 1);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn(`[iarsma] mail.modify ${keyword} failed:`, e);
        }
      })();
    },
    [invoker, refetch, bumpPushGeneration],
  );

  // PR 31 — per-row delete. Outside Trash, this is a soft delete to
  // Trash (mail.delete) — no confirm because Activity Undo exists.
  // Inside Trash, the same icon means "Delete forever" (mail.purge)
  // and goes through a confirm dialog handled in the row component.
  const handleSoftDelete = useCallback(
    (emailId: string) => {
      void (async () => {
        try {
          await invoker.invoke('mail.delete', { emailIds: [emailId] });
          await refetch();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[iarsma] mail.delete failed:', e);
        }
      })();
    },
    [invoker, refetch],
  );

  // U-3 — restore a trashed message to the Inbox. Removes the Trash
  // membership and adds Inbox via mail.modify. Only wired onto rows
  // while viewing Trash. We move to Inbox (not the original mailbox)
  // because a message already sitting in Trash carries no record of
  // where it came from — this matches Gmail's "Move to Inbox".
  const handleRestore = useCallback(
    (emailId: string) => {
      const inboxId = props.inboxMailboxId;
      const trashId = mailboxId;
      if (inboxId === undefined || trashId === null) {
        // eslint-disable-next-line no-console
        console.warn('[iarsma] restore: missing inbox/trash mailbox id');
        return;
      }
      void (async () => {
        try {
          await invoker.invoke('mail.modify', {
            emailIds: [emailId],
            patch: { mailboxIds: { [trashId]: false, [inboxId]: true } },
          });
          await refetch();
          // Refresh the sidebar Inbox unread badge + document title.
          bumpPushGeneration((n) => n + 1);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[iarsma] mail.restore failed:', e);
        }
      })();
    },
    [invoker, refetch, bumpPushGeneration, props.inboxMailboxId, mailboxId],
  );

  // Task 7 — move a message to another folder via mail.modify. The
  // patch removes the current mailbox membership and adds the target,
  // mirroring handleRestore but for arbitrary target mailboxes.
  const handleMove = useCallback(
    (emailId: string, targetMailboxId: string) => {
      const fromId = mailboxId;
      if (fromId === null) return;
      void (async () => {
        try {
          await invoker.invoke('mail.modify', {
            emailIds: [emailId],
            patch: { mailboxIds: { [fromId]: false, [targetMailboxId]: true } },
          });
          await refetch();
          bumpPushGeneration((n) => n + 1);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[iarsma] mail.move failed:', e);
        }
      })();
    },
    [invoker, refetch, bumpPushGeneration, mailboxId],
  );

  // Candidate mailboxes for "Move to…" come from the prop (computed in
  // ThreadListWithMailbox, already filtered to exclude the current
  // mailbox). Fall back to empty in search mode.
  const moveTargets = props.moveTargets ?? [];

  // Track which row (if any) is awaiting purge-forever confirmation.
  // null = no confirm open; a string is the emailId being prompted.
  const [purgeConfirmEmailId, setPurgeConfirmEmailId] = useState<string | null>(null);
  const [purgingRow, setPurgingRow] = useState(false);

  const handlePurgeRow = useCallback(
    (emailId: string): void => {
      setPurgeConfirmEmailId(emailId);
    },
    [],
  );

  const confirmPurgeRow = useCallback(async (): Promise<void> => {
    if (purgeConfirmEmailId === null) return;
    setPurgingRow(true);
    try {
      await invoker.invoke('mail.purge', { emailIds: [purgeConfirmEmailId] });
      setPurgeConfirmEmailId(null);
      await refetch();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[iarsma] mail.purge (row) failed:', e);
    } finally {
      setPurgingRow(false);
    }
  }, [invoker, purgeConfirmEmailId, refetch]);

  // Keyboard: navigation (j/k/Home/End/Enter) + row actions (U-7).
  // Defined after the action handlers so it can call them. `focusedIndex`
  // starts null and is set to 0 by the selection-sync effect; treat null
  // as "before the cursor" so j/ArrowDown lands on row 0.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLUListElement>) => {
      const i = focusedIndex ?? -1;
      const focusedEmailId = i >= 0 ? threads[i]?.latestEmail.id : undefined;
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
          if (i >= 0) onSelect(i);
          break;
        // U-7 — Gmail-style row actions on the focused thread.
        case '#': // delete (in Trash this opens the purge confirm)
          if (focusedEmailId === undefined) break;
          event.preventDefault();
          (isTrash ? handlePurgeRow : handleSoftDelete)(focusedEmailId);
          break;
        case 'I': // Shift+i — mark read
          if (focusedEmailId === undefined) break;
          event.preventDefault();
          toggleKeyword(focusedEmailId, '$seen', true);
          break;
        case 'U': // Shift+u — mark unread
          if (focusedEmailId === undefined) break;
          event.preventDefault();
          toggleKeyword(focusedEmailId, '$seen', false);
          break;
      }
    },
    [
      focusedIndex,
      moveFocus,
      onSelect,
      threads,
      isTrash,
      handlePurgeRow,
      handleSoftDelete,
      toggleKeyword,
    ],
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
      <div
        ref={scrollRef}
        className={styles['body']}
        onScroll={(e) => {
          const el = e.currentTarget;
          // PR 53 / CoWork #15 — infinite-scroll trigger in search
          // mode. Fire `onLoadMore` while the user is still 600px
          // above the bottom so the next page lands before they hit
          // the end of the list. The hook ignores calls while
          // already loading or when no more pages exist.
          if (onLoadMore !== undefined && hasMore && !isLoadingMore) {
            const distanceFromBottom =
              el.scrollHeight - (el.scrollTop + el.clientHeight);
            if (distanceFromBottom < 600) onLoadMore();
          }
          // PR 51 — throttle via the browser's natural scroll event
          // batching plus a microtask flush. mailboxId is captured
          // here so search-mode (mailboxId=null) skips the write.
          if (mailboxId === null) return;
          const top = el.scrollTop;
          setScrollPositions((prev) =>
            prev[mailboxId] === top ? prev : { ...prev, [mailboxId]: top },
          );
        }}
      >
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
                onDelete={isTrash ? handlePurgeRow : handleSoftDelete}
                deleteMode={isTrash ? 'purge' : 'soft'}
                {...(isTrash ? { onRestore: handleRestore } : {})}
                {...(moveTargets.length > 0 && mailboxId !== null
                  ? { onMove: handleMove, moveTargets }
                  : {})}
                {...(tokens !== undefined ? { tokens } : {})}
                labels={labels}
              />
            );
          })}
        </ul>
        {isLoadingMore ? (
          <div
            className={styles['loadingMore']}
            role="status"
            aria-live="polite"
          >
            Loading more results…
          </div>
        ) : null}
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
      {/* PR 31 — per-row Delete forever confirm. Only triggered
       *  from rows inside the Trash mailbox; outside Trash the
       *  row Delete is a soft-delete with no confirm (Activity
       *  Undo catches mistakes). */}
      <Dialog
        open={purgeConfirmEmailId !== null}
        onClose={() => {
          if (purgingRow) return;
          setPurgeConfirmEmailId(null);
        }}
        title="Delete forever?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPurgeConfirmEmailId(null)}
              disabled={purgingRow}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void confirmPurgeRow();
              }}
              disabled={purgingRow}
            >
              {purgingRow ? 'Deleting…' : 'Delete forever'}
            </Button>
          </>
        }
      >
        <p>
          This message will be permanently deleted. This can't be
          undone.
        </p>
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
  /** PR 31 — per-row delete. Outside Trash this is fire-and-forget
   *  soft-delete (Activity undo catches mistakes). In Trash the
   *  parent opens a confirm dialog before calling. */
  readonly onDelete: (emailId: string) => void;
  /** 'soft' → mail.delete + no confirm; 'purge' → ask parent to
   *  open the destructive confirm dialog. PR 31. */
  readonly deleteMode: 'soft' | 'purge';
  /** U-3 — restore a trashed message to the Inbox. Present only when
   *  viewing Trash; renders a "Move to Inbox" row action. */
  readonly onRestore?: (emailId: string) => void;
  /** Task 7 — move to another folder. Present when there are candidate
   *  target mailboxes (non-search mode, ≥2 mailboxes). Renders a
   *  MenuButton with one item per target. */
  readonly onMove?: (emailId: string, targetMailboxId: string) => void;
  readonly moveTargets?: ReadonlyArray<MailboxLike>;
  /** Tokenized search query (PR 53 / CoWork #15). When non-empty,
   *  the subject + preview are rendered through `<Highlight>` and the
   *  preview is reduced to a 120-char snippet centered on the first
   *  match. Mailbox-mode rows pass undefined and render unchanged. */
  readonly tokens?: readonly string[];
  /** Task 8 — label registry for resolving label chips on this row. */
  readonly labels?: readonly LabelDef[];
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
    onDelete,
    deleteMode,
    onRestore,
    onMove,
    moveTargets,
    tokens,
    labels,
  } = props;
  const highlightTokens = tokens ?? EMPTY_TOKENS;
  const isSearchMode = highlightTokens.length > 0;
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
  // Task 8 — resolve label chips for this row.
  // useMemo is acceptable here; hooks must not be called conditionally.
  const rowLabels = useMemo(
    () => resolveLabels(e.keywords, labels ?? []),
    [e.keywords, labels],
  );

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
          <span className={styles['subject']}>
            {isSearchMode ? (
              <Highlight text={subject} tokens={highlightTokens} />
            ) : (
              subject
            )}
          </span>
          {e.preview !== undefined && e.preview.length > 0 ? (
            <span
              className={
                isSearchMode
                  ? `${styles['preview']} ${styles['previewSnippet']}`
                  : styles['preview']
              }
            >
              {isSearchMode ? (
                <Highlight
                  text={buildSnippet(e.preview, highlightTokens)}
                  tokens={highlightTokens}
                />
              ) : (
                e.preview
              )}
            </span>
          ) : null}
          {/* Task 8 — label chips */}
          {rowLabels.length > 0 ? (
            <span className={styles['labelChips']} aria-label="Labels">
              {rowLabels.map((l) => (
                <LabelChip key={l.key} label={l} />
              ))}
            </span>
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
        {onRestore !== undefined ? (
          <button
            type="button"
            className={styles['iconBtn']}
            onClick={(ev) => {
              ev.stopPropagation();
              onRestore(e.id);
            }}
            aria-label={`Move to Inbox: ${subject}`}
            title="Move to Inbox"
          >
            <InboxIcon />
          </button>
        ) : null}
        {onMove !== undefined && moveTargets !== undefined && moveTargets.length > 0 ? (
          // Task 7 — "Move to…" menu. The trigger carries the email
          // subject so screen readers get per-row context. MenuItem keys
          // are mailbox ids (stable, no display-name collisions).
          <MenuButton
            label={`Move ${subject} to…`}
            items={moveTargets.map((m) => ({
              key: m.id,
              label: getMailboxLabel(m, m.id),
              onSelect: () => {
                onMove(e.id, m.id);
              },
            }))}
          >
            <MoveToFolderIcon />
          </MenuButton>
        ) : null}
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
        <button
          type="button"
          className={styles['iconBtn']}
          onClick={(ev) => {
            ev.stopPropagation();
            onDelete(e.id);
          }}
          aria-label={
            deleteMode === 'purge'
              ? `Delete forever: ${subject}`
              : `Delete: ${subject}`
          }
          title={deleteMode === 'purge' ? 'Delete forever' : 'Delete'}
        >
          <TrashIcon />
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

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  );
}

/** Task 7 — folder/move icon for the "Move to…" menu trigger. */
function MoveToFolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <polyline points="9 14 12 17 15 14" />
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
