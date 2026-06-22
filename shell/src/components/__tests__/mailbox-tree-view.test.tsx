/**
 * @vitest-environment jsdom
 *
 * Tests for MailboxTreeView (PR 3.5). Lifts the WAI-ARIA + keyboard
 * coverage from the previous views/__tests__/mailbox-list.test.tsx and
 * retargets it at the new props-driven component embedded in the
 * sidebar. The auto-select tests moved to App.tsx (the parent owns
 * "pick the inbox when nothing is selected" — PR 2).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MailboxTreeView, type MailboxRow } from '../mailbox-tree-view.js';
import { runAxe } from '../../__tests__/util/axe.js';

afterEach(() => {
  cleanup();
  // Reset persisted collapse state between tests so a collapse from one
  // test doesn't bleed into the next.
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

const FIXTURES: ReadonlyArray<MailboxRow> = [
  { id: 'Mb01', name: 'INBOX', role: 'inbox', unreadCount: 3, sortOrder: 0 },
  { id: 'Mb02', name: 'Sent', role: 'sent', unreadCount: 0, sortOrder: 1 },
  { id: 'Mb03', name: 'Drafts', role: 'drafts', unreadCount: 0, sortOrder: 2 },
  { id: 'Mb04', name: 'Project', parentId: 'Mb01', unreadCount: 0, sortOrder: 0 },
];

function renderTree(opts?: {
  mailboxes?: ReadonlyArray<MailboxRow>;
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const onSelect = opts?.onSelect ?? (() => {});
  return render(
    <MailboxTreeView
      mailboxes={opts?.mailboxes ?? FIXTURES}
      {...(opts?.selectedId !== undefined ? { selectedId: opts.selectedId } : {})}
      onSelect={onSelect}
    />,
  );
}

// ──────────────────────────────────────────────────────────────────────
// ARIA structure
// ──────────────────────────────────────────────────────────────────────

describe('MailboxTreeView — ARIA structure', () => {
  it('renders the WAI-ARIA tree role with a labeled wrapper', () => {
    renderTree();
    expect(screen.getByRole('tree', { name: 'Mailboxes' })).toBeInTheDocument();
  });

  it('renders one treeitem per visible mailbox', () => {
    renderTree();
    const items = screen.getAllByRole('treeitem');
    // 3 top-level (Inbox, Sent, Drafts) + 1 child (Project) = 4 visible
    // because parents default to expanded.
    expect(items).toHaveLength(4);
  });

  it('renders the inbox role with the canonical English label, not the raw JMAP name', () => {
    renderTree();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.queryByText('INBOX')).toBeNull();
  });

  it('exposes aria-level / aria-posinset / aria-setsize on each row', () => {
    renderTree();
    const inbox = screen.getByText('Inbox').closest('li')!;
    expect(inbox).toHaveAttribute('aria-level', '1');
    expect(inbox).toHaveAttribute('aria-posinset', '1');
    expect(inbox).toHaveAttribute('aria-setsize', '3');

    const project = screen.getByText('Project').closest('li')!;
    expect(project).toHaveAttribute('aria-level', '2');
    expect(project).toHaveAttribute('aria-posinset', '1');
    expect(project).toHaveAttribute('aria-setsize', '1');
  });

  it('marks parents with aria-expanded; leaves omit it', () => {
    renderTree();
    const inbox = screen.getByText('Inbox').closest('li')!;
    expect(inbox).toHaveAttribute('aria-expanded');

    const sent = screen.getByText('Sent').closest('li')!;
    // Sent is a leaf — aria-expanded must be absent.
    expect(sent).not.toHaveAttribute('aria-expanded');
  });

  it('shows the unread count badge with screen-reader text', () => {
    renderTree();
    const inboxRow = screen.getByText('Inbox').closest('li')!;
    expect(inboxRow.textContent).toContain('3');
    expect(inboxRow.textContent).toContain('3 unread');
  });

  it('does NOT show an unread badge for the Drafts role (U-8)', () => {
    // Drafts are work-in-progress, not "unread mail" — an unread pill
    // there is misleading (Gmail shows no unread badge for Drafts).
    renderTree({
      mailboxes: [
        { id: 'Mb01', name: 'INBOX', role: 'inbox', unreadCount: 3, sortOrder: 0 },
        { id: 'Mb03', name: 'Drafts', role: 'drafts', unreadCount: 5, sortOrder: 1 },
      ],
    });
    const draftsRow = screen.getByText('Drafts').closest('li')!;
    expect(draftsRow.textContent).not.toContain('5');
    expect(draftsRow.textContent).not.toContain('unread');
    // Other roles still show their unread badge.
    const inboxRow = screen.getByText('Inbox').closest('li')!;
    expect(inboxRow.textContent).toContain('3 unread');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Selection
// ──────────────────────────────────────────────────────────────────────

describe('MailboxTreeView — selection', () => {
  it('marks the row matching `selectedId` as aria-selected', () => {
    renderTree({ selectedId: 'Mb02' });
    expect(screen.getByText('Sent').closest('li')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Inbox').closest('li')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('invokes onSelect with the mailbox id when a row is clicked', () => {
    const calls: string[] = [];
    renderTree({ onSelect: (id) => calls.push(id) });
    fireEvent.click(screen.getByText('Sent').closest('li')!);
    expect(calls).toEqual(['Mb02']);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Keyboard nav (WAI-ARIA tree pattern)
// ──────────────────────────────────────────────────────────────────────

describe('MailboxTreeView — keyboard nav', () => {
  // Helper: focus a row + fire React's onFocus so the component's
  // `focusedId` state stays in lockstep with DOM focus.
  function focusRow(el: HTMLElement): void {
    el.focus();
    fireEvent.focus(el);
  }

  beforeEach(() => {
    // Tests below all start with Inbox focused. Mounting with
    // selectedId pre-seeds focusedId via the component's effect.
  });

  it('ArrowDown moves focus to the next visible row', async () => {
    renderTree({ selectedId: 'Mb01' });
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Inbox').closest('li')!);
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    // Visible order: Inbox, Project (child), Sent, Drafts.
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect(document.activeElement).toBe(screen.getByText('Project').closest('li'));
  });

  it('ArrowUp moves focus to the previous visible row', async () => {
    renderTree({ selectedId: 'Mb01' });
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Project').closest('li')!);
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect(document.activeElement).toBe(screen.getByText('Inbox').closest('li'));
  });

  it('ArrowLeft on an expanded parent collapses it and hides children', () => {
    renderTree({ selectedId: 'Mb01' });
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Inbox').closest('li')!);
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.getByText('Inbox').closest('li')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Project')).toBeNull();
  });

  it('Home jumps to the first visible row', async () => {
    renderTree({ selectedId: 'Mb01' });
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Drafts').closest('li')!);
    fireEvent.keyDown(tree, { key: 'Home' });
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect(document.activeElement).toBe(screen.getByText('Inbox').closest('li'));
  });

  it('Enter on a row fires onSelect for that row', () => {
    const calls: string[] = [];
    renderTree({ selectedId: 'Mb01', onSelect: (id) => calls.push(id) });
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Sent').closest('li')!);
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(calls).toEqual(['Mb02']);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Persistence
// ──────────────────────────────────────────────────────────────────────

describe('MailboxTreeView — collapse persistence', () => {
  it('round-trips a collapsed parent through localStorage', () => {
    // First render: collapse Inbox.
    const { unmount } = renderTree({ selectedId: 'Mb01' });
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    const inbox = screen.getByText('Inbox').closest('li')!;
    inbox.focus();
    fireEvent.focus(inbox);
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    expect(screen.queryByText('Project')).toBeNull();
    unmount();

    // Second render: child should remain hidden.
    renderTree({ selectedId: 'Mb01' });
    expect(screen.queryByText('Project')).toBeNull();
    expect(screen.getByText('Inbox').closest('li')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// axe-core
// ──────────────────────────────────────────────────────────────────────

describe('MailboxTreeView — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = renderTree();
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
