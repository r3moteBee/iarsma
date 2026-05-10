/**
 * Tree-folding logic tests (Phase 1 work item 2).
 *
 * Pure functions; no DOM, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import type { Mailbox } from '../../runtime/jmap-client.js';
import { flattenVisible, foldMailboxTree } from '../mailbox-tree.js';

const RIGHTS = {
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  mayCreateChild: true,
  mayRename: true,
  mayDelete: true,
  maySubmit: true,
};

function box(
  id: string,
  name: string,
  parentId: string | undefined,
  sortOrder = 0,
  role?: string,
): Mailbox {
  const m: Mailbox = {
    id,
    name,
    sortOrder,
    totalEmails: 0,
    unreadEmails: 0,
    totalThreads: 0,
    unreadThreads: 0,
    isSubscribed: true,
    myRights: RIGHTS,
    ...(parentId !== undefined ? { parentId } : {}),
    ...(role !== undefined ? { role } : {}),
  };
  return m;
}

describe('foldMailboxTree', () => {
  it('returns an empty array for empty input', () => {
    expect(foldMailboxTree([])).toEqual([]);
  });

  it('keeps top-level mailboxes at depth 0 and assigns posInSet implicitly', () => {
    const tree = foldMailboxTree([
      box('Mb01', 'Inbox', undefined, 0, 'inbox'),
      box('Mb02', 'Sent', undefined, 1, 'sent'),
    ]);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.depth).toBe(0);
    expect(tree[0]?.mailbox.id).toBe('Mb01');
    expect(tree[1]?.mailbox.id).toBe('Mb02');
  });

  it('nests children under their parent and increments depth', () => {
    const tree = foldMailboxTree([
      box('Mb01', 'Inbox', undefined),
      box('Mb02', 'Project', 'Mb01'),
      box('Mb03', 'Subproject', 'Mb02'),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.mailbox.id).toBe('Mb02');
    expect(tree[0]?.children[0]?.depth).toBe(1);
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
  });

  it('sorts siblings by sortOrder then name', () => {
    const tree = foldMailboxTree([
      box('Mb01', 'Bravo', undefined, 1),
      box('Mb02', 'Alpha', undefined, 1),
      box('Mb03', 'Zulu', undefined, 0),
    ]);
    expect(tree.map((n) => n.mailbox.name)).toEqual(['Zulu', 'Alpha', 'Bravo']);
  });

  it('surfaces orphans (parentId references missing mailbox) at the top level', () => {
    const tree = foldMailboxTree([
      box('Mb01', 'Inbox', undefined),
      box('Mb02', 'Orphan', 'MISSING'),
    ]);
    expect(tree).toHaveLength(2);
    const ids = tree.map((n) => n.mailbox.id).sort();
    expect(ids).toEqual(['Mb01', 'Mb02']);
  });

  it('breaks self-referential cycles by treating the visited node as terminal', () => {
    // Pathological: Mb01 lists itself as parent. Treated as top-level
    // and its children walk stops cleanly.
    const tree = foldMailboxTree([box('Mb01', 'Self', 'Mb01')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.mailbox.id).toBe('Mb01');
    expect(tree[0]?.children).toHaveLength(0);
  });
});

describe('flattenVisible', () => {
  const tree = foldMailboxTree([
    box('Mb01', 'Inbox', undefined, 0),
    box('Mb02', 'Sent', undefined, 1),
    box('Mb03', 'Project', 'Mb01', 0),
    box('Mb04', 'Archive', 'Mb01', 1),
  ]);

  it('flattens to all rows when everything is expanded', () => {
    const all = flattenVisible(tree, () => true);
    expect(all.map((n) => n.mailbox.id)).toEqual(['Mb01', 'Mb03', 'Mb04', 'Mb02']);
  });

  it('skips children of collapsed parents', () => {
    const visible = flattenVisible(tree, (id) => id !== 'Mb01');
    expect(visible.map((n) => n.mailbox.id)).toEqual(['Mb01', 'Mb02']);
  });
});
