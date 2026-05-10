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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { selectedMailboxIdAtom, selectedThreadIdAtom } from '../mail-state.js';
import { useThreadList } from '../generated/capabilities/thread-list.js';

const ROW_HEIGHT_PX = 64;

export function ThreadList() {
  const mailboxId = useAtomValue(selectedMailboxIdAtom);
  // Render placeholder when no mailbox is selected — without an id we
  // can't ask `useThreadList` for anything (the contract requires
  // mailboxId). The hook is called below only when `mailboxId` is set,
  // via the `enabled` flag.
  if (mailboxId === null) {
    return (
      <section aria-label="Threads">
        <p>Select a mailbox to view its threads.</p>
      </section>
    );
  }
  return <ThreadListWithMailbox mailboxId={mailboxId} />;
}

function ThreadListWithMailbox({ mailboxId }: { readonly mailboxId: string }) {
  const { data, error, isLoading } = useThreadList({ mailboxId });
  const selectedThreadId = useAtomValue(selectedThreadIdAtom);
  const setSelectedThreadId = useSetAtom(selectedThreadIdAtom);

  // Reset selection when the mailbox changes — the previous-mailbox
  // thread id isn't meaningful in this list.
  useEffect(() => {
    setSelectedThreadId(null);
  }, [mailboxId, setSelectedThreadId]);

  const threads = useMemo(() => data?.threads ?? [], [data?.threads]);
  const total = data?.total;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
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
        const el = scrollRef.current?.querySelector<HTMLDivElement>(
          `[data-thread-index="${next}"]`,
        );
        el?.focus();
      });
    },
    [threads.length, virtualizer],
  );

  const onSelect = useCallback(
    (idx: number) => {
      const thread = threads[idx];
      if (thread === undefined) return;
      setSelectedThreadId(thread.id);
      setFocusedIndex(idx);
    },
    [threads, setSelectedThreadId],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (focusedIndex === null) return;
      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault();
          moveFocus(focusedIndex + 1);
          break;
        case 'k':
        case 'ArrowUp':
          event.preventDefault();
          moveFocus(focusedIndex - 1);
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
          onSelect(focusedIndex);
          break;
      }
    },
    [focusedIndex, moveFocus, onSelect, threads.length],
  );

  if (isLoading) {
    return (
      <section aria-label="Threads" aria-busy="true">
        <p>Loading threads…</p>
      </section>
    );
  }
  if (error !== undefined) {
    return (
      <section aria-label="Threads">
        <p role="alert">Failed to load threads: {error.message}</p>
      </section>
    );
  }
  if (threads.length === 0) {
    return (
      <section aria-label="Threads">
        <p>No threads in this mailbox.</p>
      </section>
    );
  }

  const items = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  return (
    <section aria-label="Threads">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Threads</h2>
        {total !== undefined ? (
          <span aria-live="polite">
            {threads.length} of {total}
          </span>
        ) : null}
      </header>
      <div
        ref={scrollRef}
        // Scroll container — virtualizer measures this for visible window.
        style={{
          height: '70vh',
          overflowY: 'auto',
          marginTop: '0.5em',
        }}
      >
        <div
          role="listbox"
          aria-label="Threads"
          aria-multiselectable="false"
          aria-activedescendant={
            focusedIndex !== null ? `thread-row-${threads[focusedIndex]?.id}` : undefined
          }
          onKeyDown={onKeyDown}
          // Inner container is the listbox and carries keydown.
          // tabIndex 0 lets the user Tab into the list; arrow keys
          // then move within it.
          tabIndex={0}
          style={{ position: 'relative', height: `${totalHeight}px` }}
        >
          {items.map((vi) => {
            const thread = threads[vi.index];
            if (thread === undefined) return null;
            const isSelected = thread.id === selectedThreadId;
            const isFocused = vi.index === focusedIndex;
            return (
              <ThreadRow
                key={thread.id}
                index={vi.index}
                thread={thread}
                offsetTop={vi.start}
                rowHeight={ROW_HEIGHT_PX}
                isSelected={isSelected}
                isFocused={isFocused}
                onClick={() => onSelect(vi.index)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ThreadRow(props: {
  readonly index: number;
  readonly thread: import('../runtime/jmap-client.js').ThreadSummary;
  readonly offsetTop: number;
  readonly rowHeight: number;
  readonly isSelected: boolean;
  readonly isFocused: boolean;
  readonly onClick: () => void;
}) {
  const { index, thread, offsetTop, rowHeight, isSelected, isFocused, onClick } = props;
  const e = thread.latestEmail;
  const seen = e.keywords.find((k) => k.name === '$seen')?.value ?? false;
  const flagged = e.keywords.find((k) => k.name === '$flagged')?.value ?? false;
  const sender = formatSender(e.from);
  const date = formatDate(e.receivedAt);

  return (
    <div
      id={`thread-row-${thread.id}`}
      data-thread-id={thread.id}
      data-thread-index={index}
      role="option"
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      onClick={onClick}
      style={{
        position: 'absolute',
        top: `${offsetTop}px`,
        left: 0,
        right: 0,
        height: `${rowHeight}px`,
        padding: '0.5em 0.75em',
        boxSizing: 'border-box',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        cursor: 'pointer',
        background: isSelected ? 'rgba(0, 0, 0, 0.04)' : 'transparent',
        fontWeight: seen ? 400 : 600,
        outline: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5em' }}>
        <span
          style={{
            flex: '0 0 auto',
            maxWidth: '12em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sender}
        </span>
        <span style={{ flex: '0 0 auto', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
          {date}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '0.5em',
          alignItems: 'baseline',
        }}
      >
        {flagged ? (
          <span aria-label="Flagged" title="Flagged" style={{ flex: '0 0 auto' }}>
            ★
          </span>
        ) : null}
        <span
          style={{
            flex: '1 1 auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {e.subject ?? '(no subject)'}
        </span>
      </div>
      {e.preview !== undefined && e.preview.length > 0 ? (
        <div
          style={{
            opacity: 0.7,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 400,
          }}
        >
          {e.preview}
        </div>
      ) : null}
      {/* Screen-reader-only summary covering the read state, since
          the visual fontWeight + ★ icon convey it but a11y tools
          shouldn't depend on those. */}
      <span style={visuallyHidden}>
        {seen ? 'read' : 'unread'}
        {flagged ? ', flagged' : ''}
      </span>
    </div>
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

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;
