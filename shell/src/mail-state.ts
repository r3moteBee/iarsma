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
