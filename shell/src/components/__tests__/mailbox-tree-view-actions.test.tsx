/**
 * @vitest-environment jsdom
 *
 * Tests for folder-action menus in MailboxTreeView (Task 6).
 *
 * Covers:
 *   - System-role folders (inbox) show NO Rename/Delete items
 *   - User folders show Rename + Delete (enabled when no children)
 *   - A folder with children has Delete disabled with the subfolder reason
 *   - Clicking Rename/Delete fires the right callback
 *   - Right-click opens the same menu (contextMenu)
 *   - "New subfolder" shows when mayCreateChild is true
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailboxTreeView, type MailboxRow } from '../mailbox-tree-view.js';

afterEach(() => {
  cleanup();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

/** Re-use the existing renderTree helper pattern. */
function renderTree(opts: {
  mailboxes: ReadonlyArray<MailboxRow>;
  onCreateFolder?: (parentId?: string) => void;
  onRenameFolder?: (id: string, currentName: string) => void;
  onDeleteFolder?: (id: string) => void;
}) {
  return render(
    <MailboxTreeView
      mailboxes={opts.mailboxes}
      onSelect={() => {}}
      storageKey="test-actions-key"
      {...(opts.onCreateFolder !== undefined ? { onCreateFolder: opts.onCreateFolder } : {})}
      {...(opts.onRenameFolder !== undefined ? { onRenameFolder: opts.onRenameFolder } : {})}
      {...(opts.onDeleteFolder !== undefined ? { onDeleteFolder: opts.onDeleteFolder } : {})}
    />,
  );
}

// ── System folder: no Rename / Delete ────────────────────────────────

describe('MailboxTreeView actions — system folders', () => {
  it('Inbox row has no Rename or Delete menu items', () => {
    renderTree({
      mailboxes: [
        {
          id: 'inbox-1',
          name: 'INBOX',
          role: 'inbox',
          unreadCount: 0,
          myRights: { mayCreateChild: true, mayRename: true, mayDelete: true },
        },
      ],
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
    });

    // Open the Actions menu
    fireEvent.click(screen.getByRole('button', { name: /actions for inbox/i }));

    // Rename and Delete must NOT appear
    expect(screen.queryByRole('menuitem', { name: /rename/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delete/i })).toBeNull();
  });

  it('Inbox with mayCreateChild shows New subfolder', () => {
    renderTree({
      mailboxes: [
        {
          id: 'inbox-1',
          name: 'INBOX',
          role: 'inbox',
          unreadCount: 0,
          myRights: { mayCreateChild: true },
        },
      ],
      onCreateFolder: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /actions for inbox/i }));
    expect(screen.getByRole('menuitem', { name: /new subfolder/i })).toBeInTheDocument();
  });

  it('System folder without myRights shows no Actions button', () => {
    renderTree({
      mailboxes: [
        { id: 'sent-1', name: 'Sent', role: 'sent', unreadCount: 0 },
      ],
    });
    expect(screen.queryByRole('button', { name: /actions for/i })).toBeNull();
  });
});

// ── User folder: Rename + Delete ────────────────────────────────────

describe('MailboxTreeView actions — user folders', () => {
  it('user folder with mayRename+mayDelete shows both menu items enabled', () => {
    renderTree({
      mailboxes: [
        {
          id: 'proj-1',
          name: 'Projects',
          unreadCount: 0,
          myRights: { mayRename: true, mayDelete: true },
        },
      ],
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /actions for projects/i }));

    const renameItem = screen.getByRole('menuitem', { name: /rename/i });
    const deleteItem = screen.getByRole('menuitem', { name: /delete/i });

    expect(renameItem).toBeInTheDocument();
    expect(deleteItem).toBeInTheDocument();

    // Neither item should be disabled
    expect(renameItem).not.toHaveAttribute('aria-disabled', 'true');
    expect(deleteItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('clicking Rename fires onRenameFolder with (id, currentName)', () => {
    const onRename = vi.fn();
    renderTree({
      mailboxes: [
        {
          id: 'proj-1',
          name: 'Projects',
          unreadCount: 0,
          myRights: { mayRename: true, mayDelete: true },
        },
      ],
      onRenameFolder: onRename,
      onDeleteFolder: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /actions for projects/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }));

    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith('proj-1', 'Projects');
  });

  it('clicking Delete fires onDeleteFolder with the mailbox id', () => {
    const onDelete = vi.fn();
    renderTree({
      mailboxes: [
        {
          id: 'proj-1',
          name: 'Projects',
          unreadCount: 0,
          myRights: { mayRename: true, mayDelete: true },
        },
      ],
      onRenameFolder: vi.fn(),
      onDeleteFolder: onDelete,
    });

    fireEvent.click(screen.getByRole('button', { name: /actions for projects/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }));

    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledWith('proj-1');
  });
});

// ── Folder with children: Delete disabled ───────────────────────────

describe('MailboxTreeView actions — folder with children', () => {
  it('Delete is disabled with subfolder reason when folder has children', () => {
    renderTree({
      mailboxes: [
        {
          id: 'parent-1',
          name: 'Work',
          unreadCount: 0,
          myRights: { mayRename: true, mayDelete: true },
        },
        {
          id: 'child-1',
          name: 'Client A',
          parentId: 'parent-1',
          unreadCount: 0,
          myRights: { mayRename: true, mayDelete: true },
        },
      ],
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /actions for work/i }));

    const deleteItem = screen.getByRole('menuitem', { name: /delete/i });
    expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
    expect(deleteItem).toHaveAttribute('title', 'Has subfolders — delete those first');
  });

  it('Delete click on disabled item does NOT fire onDeleteFolder', () => {
    const onDelete = vi.fn();
    renderTree({
      mailboxes: [
        {
          id: 'parent-1',
          name: 'Work',
          unreadCount: 0,
          myRights: { mayDelete: true },
        },
        {
          id: 'child-1',
          name: 'Client A',
          parentId: 'parent-1',
          unreadCount: 0,
        },
      ],
      onDeleteFolder: onDelete,
    });

    fireEvent.click(screen.getByRole('button', { name: /actions for work/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }));

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('child folder (no children itself) has Delete enabled', () => {
    renderTree({
      mailboxes: [
        {
          id: 'parent-1',
          name: 'Work',
          unreadCount: 0,
          myRights: { mayDelete: true },
        },
        {
          id: 'child-1',
          name: 'Client A',
          parentId: 'parent-1',
          unreadCount: 0,
          myRights: { mayRename: true, mayDelete: true },
        },
      ],
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: /actions for client a/i }));
    const deleteItem = screen.getByRole('menuitem', { name: /delete/i });
    expect(deleteItem).not.toHaveAttribute('aria-disabled', 'true');
  });
});

// ── Right-click opens the same menu ──────────────────────────────────

describe('MailboxTreeView actions — context menu', () => {
  it('right-click on a folder row opens the actions menu', () => {
    renderTree({
      mailboxes: [
        {
          id: 'proj-1',
          name: 'Projects',
          unreadCount: 0,
          myRights: { mayRename: true, mayDelete: true },
        },
      ],
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
    });

    const row = screen.getByTestId('sidebar-mailbox-proj-1');
    fireEvent.contextMenu(row);

    // The menu should now be open with Rename + Delete
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument();
  });
});
