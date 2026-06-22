/**
 * Jotai atoms for read-mail state (Phase 1).
 *
 * Selection state lives in atoms so MailboxList (item 2) and the
 * forthcoming ThreadList (item 4) read the same source. Selection is
 * in-memory for Phase 1 — IndexedDB persistence lands with item 8 if
 * we decide we want it; most webmails don't bother.
 */

import { atom } from 'jotai';

/**
 * Currently-selected mailbox id, or `null` when nothing is selected.
 * MailboxList writes; ThreadList reads.
 *
 * Initial value `null`. The MailboxList component auto-selects the
 * inbox-role mailbox the first time `useMailboxList` returns data.
 */
export const selectedMailboxIdAtom = atom<string | null>(null);

/**
 * Per-mailbox scroll position in the ThreadList (PR 51 / CoWork #8).
 * Keyed by mailboxId; value is the last-observed `scrollTop` of the
 * thread list scroll container. ThreadList writes on scroll (throttled
 * via the `scroll` event handler) and reads on mount so navigating
 * away → back lands on the same row the user was looking at.
 *
 * Stored only in memory — refreshing the tab resets all positions.
 * That's acceptable: scroll position is ephemeral state, not a
 * preference, and IndexedDB pressure for an N-mailboxes-per-tab cache
 * isn't worth it.
 */
export const mailboxScrollPositionsAtom = atom<Readonly<Record<string, number>>>({});

/**
 * Currently-selected thread id within the selected mailbox, or `null`.
 * ThreadList writes (on Enter / click); the upcoming ThreadView (item 7)
 * reads. Switching mailboxes clears the selection — the previous-mailbox
 * thread isn't valid in the new mailbox's list.
 */
export const selectedThreadIdAtom = atom<string | null>(null);

/**
 * Pending delete-undo (U-4). Set by the loggingInvoker's
 * `onUndoRegistered` hook the moment a UI `mail.delete` commits and its
 * inverse is registered. `DeleteToast` reads it to show an act-then-undo
 * toast ("Moved to Trash · Undo") and clears it on Undo or timeout.
 * `seq` is the action-log seq whose inverse restores the message.
 */
export type PendingDeleteUndo = {
  readonly seq: number;
  readonly count: number;
  readonly createdAtMs: number;
};
export const pendingDeleteUndoAtom = atom<PendingDeleteUndo | null>(null);

/**
 * Search query atom (Phase 2 item 9). Empty string = inactive (the
 * ThreadList renders the selected mailbox); non-empty = active (the
 * ThreadList runs `thread.search` and renders results, ignoring
 * `selectedMailboxIdAtom`).
 *
 * The atom holds plain text rather than a wrapped union because the
 * shell's only search entry surface today is the header input — a
 * single bound value. Reach for `{kind, query}` if a second surface
 * (e.g., mailbox-scoped search) needs to coexist.
 */
export const searchQueryAtom = atom<string>('');

/**
 * Mail layout preference: 'side' renders thread list and thread view
 * side-by-side (default on desktop); 'stacked' renders them vertically.
 * Persisted to localStorage so the preference survives reloads.
 */
export type MailLayout = 'side' | 'stacked';

const storedLayout =
  typeof window !== 'undefined'
    ? localStorage.getItem('iarsma-mail-layout')
    : null;

export const mailLayoutAtom = atom<MailLayout>(
  storedLayout === 'stacked' ? 'stacked' : 'side',
);
