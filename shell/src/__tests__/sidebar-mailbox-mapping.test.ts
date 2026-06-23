/**
 * Unit tests for `toSidebarMailboxEntry` — the pure helper that maps a
 * `useMailboxList` response entry into a `MailboxEntry` for the sidebar.
 *
 * Primary regression guard for Issue 1: `myRights` must be carried through
 * so that the folder Actions menu appears in the live app (not just in
 * component tests that inject `myRights` directly).
 */

import { describe, expect, it } from 'vitest';
import { toSidebarMailboxEntry } from '../sidebar-mailbox-entry.js';
import type { MailboxListOutput } from '../generated/capabilities/mailbox-list.js';

/** Minimal `MailboxListOutput[number]` fixture with required fields only
 *  (no optional `role` / `parentId` — exactOptionalPropertyTypes is on). */
const BASE_RAW: MailboxListOutput[number] = {
  id: 'm1',
  name: 'Projects',
  sortOrder: 10,
  totalEmails: 5,
  unreadEmails: 2,
  totalThreads: 3,
  unreadThreads: 1,
  isSubscribed: true,
  myRights: {
    mayReadItems: true,
    mayAddItems: true,
    mayRemoveItems: true,
    maySetSeen: true,
    maySetKeywords: true,
    mayCreateChild: true,
    mayRename: true,
    mayDelete: false,
    maySubmit: false,
  },
};

describe('toSidebarMailboxEntry — myRights propagation', () => {
  it('carries mayCreateChild, mayRename, mayDelete into the mapped entry', () => {
    const entry = toSidebarMailboxEntry(BASE_RAW);
    expect(entry.myRights).toBeDefined();
    expect(entry.myRights?.mayCreateChild).toBe(true);
    expect(entry.myRights?.mayRename).toBe(true);
    expect(entry.myRights?.mayDelete).toBe(false);
  });

  it('maps id, name, and unreadEmails → unreadCount correctly', () => {
    const entry = toSidebarMailboxEntry(BASE_RAW);
    expect(entry.id).toBe('m1');
    expect(entry.name).toBe('Projects');
    expect(entry.unreadCount).toBe(2);
  });

  it('omits role when not present', () => {
    const entry = toSidebarMailboxEntry(BASE_RAW);
    expect(entry.role).toBeUndefined();
  });

  it('carries role when present', () => {
    const entry = toSidebarMailboxEntry({ ...BASE_RAW, role: 'inbox' });
    expect(entry.role).toBe('inbox');
  });

  it('carries parentId when present', () => {
    const entry = toSidebarMailboxEntry({ ...BASE_RAW, parentId: 'parent-1' });
    expect(entry.parentId).toBe('parent-1');
  });

  it('omits parentId when not present', () => {
    const entry = toSidebarMailboxEntry(BASE_RAW);
    expect(entry.parentId).toBeUndefined();
  });
});
