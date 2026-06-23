/**
 * Pure helper for mapping `useMailboxList` response entries to `MailboxEntry`
 * objects for the sidebar.
 *
 * Lives in its own module so it can be unit-tested without importing the full
 * App.tsx dependency tree (which includes WASM modules and React context).
 */

import type { MailboxListOutput } from './generated/capabilities/mailbox-list.js';
import type { MailboxEntry } from './components/sidebar.js';

/**
 * Maps a single `useMailboxList` response entry to a `MailboxEntry` for the
 * sidebar.  Carries `myRights` (mayCreateChild / mayRename / mayDelete)
 * through so the folder Actions menu renders in the live app.
 */
export function toSidebarMailboxEntry(m: MailboxListOutput[number]): MailboxEntry {
  return {
    id: m.id,
    name: m.name,
    unreadCount: m.unreadEmails,
    ...(m.role !== undefined ? { role: m.role } : {}),
    ...(m.parentId !== undefined ? { parentId: m.parentId } : {}),
    myRights: {
      mayCreateChild: m.myRights.mayCreateChild,
      mayRename: m.myRights.mayRename,
      mayDelete: m.myRights.mayDelete,
    },
  };
}
