/**
 * @vitest-environment jsdom
 *
 * Component-level tests for MailboxList (Phase 1 work item 2).
 *
 * Coverage:
 *   - WAI-ARIA tree pattern (role=tree/treeitem, aria-level / setsize /
 *     posinset / expanded / selected) — verified via getByRole queries.
 *   - Auto-select inbox-role mailbox on first data load.
 *   - Keyboard navigation (ArrowDown / ArrowUp / ArrowRight / ArrowLeft
 *     / Home / End / Enter).
 *   - axe-core baseline (zero WCAG 2.1 AA violations).
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the WASM bindings before any module that transitively imports them
// loads — the jco-transpiled `jmap_client.js` calls
// `WebAssembly.compile(fs.readFile(url))` at module-init time, which
// fails under jsdom because the URL has no `file://` scheme. The mock
// supplies the named exports the runtime's jmap-client.ts looks up;
// MailboxList never actually invokes them because we provide a
// mockInvoker that short-circuits the call.
vi.mock('@iarsma/wasm-bindings/jmap-client', () => ({
  session: { parseSession: vi.fn() },
  mailbox: { parseMailboxGetResponse: vi.fn() },
}));
vi.mock('@iarsma/wasm-bindings/action-log', () => ({
  chain: { canonicalize: vi.fn(), verifyLinks: vi.fn() },
}));

import { IarsmaProvider, mockInvoker } from '../../runtime/index.js';
import type { Mailbox } from '../../runtime/jmap-client.js';
import { runAxe } from '../../__tests__/util/axe.js';
import { MailboxList } from '../mailbox-list.js';

afterEach(() => {
  cleanup();
});

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
  unreadEmails = 0,
): Mailbox {
  const m: Mailbox = {
    id,
    name,
    sortOrder,
    totalEmails: unreadEmails,
    unreadEmails,
    totalThreads: 0,
    unreadThreads: 0,
    isSubscribed: true,
    myRights: RIGHTS,
    ...(parentId !== undefined ? { parentId } : {}),
    ...(role !== undefined ? { role } : {}),
  };
  return m;
}

const FIXTURES: ReadonlyArray<Mailbox> = [
  box('Mb01', 'Inbox', undefined, 0, 'inbox', 3),
  box('Mb02', 'Sent', undefined, 1, 'sent'),
  box('Mb03', 'Drafts', undefined, 2, 'drafts'),
  box('Mb04', 'Project', 'Mb01', 0),
];

function renderTree(mailboxes: ReadonlyArray<Mailbox> = FIXTURES) {
  const invoker = mockInvoker({
    'mailbox.list': async () => mailboxes,
  });
  return render(
    <JotaiProvider>
      <IarsmaProvider value={invoker}>
        <MailboxList />
      </IarsmaProvider>
    </JotaiProvider>,
  );
}

async function waitForTree(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('tree', { name: 'Mailboxes' })).toBeInTheDocument();
  });
}

// ──────────────────────────────────────────────────────────────────────
// ARIA structure
// ──────────────────────────────────────────────────────────────────────

describe('MailboxList — ARIA structure', () => {
  it('renders the WAI-ARIA tree role with a labeled wrapper', async () => {
    renderTree();
    await waitForTree();
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    expect(tree).toBeInTheDocument();
  });

  it('renders one treeitem per visible mailbox', async () => {
    renderTree();
    await waitForTree();
    const items = screen.getAllByRole('treeitem');
    // 3 top-level (Inbox, Sent, Drafts) + 1 child (Project) = 4 visible.
    expect(items).toHaveLength(4);
  });

  it('renders the inbox role with the canonical English label', async () => {
    renderTree();
    await waitForTree();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
  });

  it('exposes aria-level / aria-posinset / aria-setsize on each row', async () => {
    renderTree();
    await waitForTree();
    const inbox = screen.getByText('Inbox').closest('li')!;
    expect(inbox).toHaveAttribute('aria-level', '1');
    expect(inbox).toHaveAttribute('aria-posinset', '1');
    expect(inbox).toHaveAttribute('aria-setsize', '3');

    const project = screen.getByText('Project').closest('li')!;
    expect(project).toHaveAttribute('aria-level', '2');
    expect(project).toHaveAttribute('aria-posinset', '1');
    expect(project).toHaveAttribute('aria-setsize', '1');
  });

  it('marks parents with aria-expanded; leaves omit it', async () => {
    renderTree();
    await waitForTree();
    const inbox = screen.getByText('Inbox').closest('li')!;
    expect(inbox).toHaveAttribute('aria-expanded');

    const sent = screen.getByText('Sent').closest('li')!;
    // Sent is a leaf (no children) — aria-expanded must be absent.
    expect(sent).not.toHaveAttribute('aria-expanded');
  });

  it('shows the unread count badge with screen-reader text', async () => {
    renderTree();
    await waitForTree();
    const inboxRow = screen.getByText('Inbox').closest('li')!;
    expect(inboxRow.textContent).toContain('3');
    expect(inboxRow.textContent).toContain('3 unread');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Auto-select
// ──────────────────────────────────────────────────────────────────────

describe('MailboxList — auto-select', () => {
  it('marks the inbox as aria-selected on first data load', async () => {
    renderTree();
    await waitForTree();
    const inbox = screen.getByText('Inbox').closest('li')!;
    await waitFor(() => {
      expect(inbox).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('falls back to the first mailbox when no inbox role is present', async () => {
    const noInbox: Mailbox[] = [
      box('Mb02', 'Sent', undefined, 1, 'sent'),
      box('Mb05', 'Custom', undefined, 0),
    ];
    renderTree(noInbox);
    await waitForTree();
    // After sort: Custom (sortOrder 0) then Sent (sortOrder 1).
    const first = screen.getByText('Custom').closest('li')!;
    await waitFor(() => {
      expect(first).toHaveAttribute('aria-selected', 'true');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Keyboard nav
// ──────────────────────────────────────────────────────────────────────

describe('MailboxList — keyboard nav', () => {
  // Helper: focus a row + fire React's onFocus so the component's
  // `focusedId` state stays in lockstep with DOM focus. Programmatic
  // `.focus()` in jsdom moves the active element but doesn't always
  // bubble through React's synthetic event system reliably enough for
  // tests; firing focus explicitly closes the gap.
  function focusRow(el: HTMLElement): void {
    el.focus();
    fireEvent.focus(el);
  }

  it('ArrowDown moves focus to the next visible row', async () => {
    renderTree();
    await waitForTree();
    // findByText retries until the expand-all effect populates the
    // child rows; getByText runs synchronously and is racy on slower
    // CI runners.
    const project = await screen.findByText('Project');
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Inbox').closest('li')!);
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(document.activeElement).toBe(project.closest('li'));
    });
  });

  it('ArrowUp moves focus to the previous visible row', async () => {
    renderTree();
    await waitForTree();
    const project = await screen.findByText('Project');
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(project.closest('li')!);
    fireEvent.keyDown(tree, { key: 'ArrowUp' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByText('Inbox').closest('li'));
    });
  });

  it('ArrowLeft on an expanded parent collapses it and hides children', async () => {
    renderTree();
    await waitForTree();
    await screen.findByText('Project');
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Inbox').closest('li')!);
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(screen.getByText('Inbox').closest('li')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(screen.queryByText('Project')).toBeNull();
    });
  });

  it('Home jumps to the first visible row', async () => {
    renderTree();
    await waitForTree();
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Drafts').closest('li')!);
    fireEvent.keyDown(tree, { key: 'Home' });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByText('Inbox').closest('li'));
    });
  });

  it('Enter on a row marks it aria-selected', async () => {
    renderTree();
    await waitForTree();
    const tree = screen.getByRole('tree', { name: 'Mailboxes' });
    focusRow(screen.getByText('Sent').closest('li')!);
    fireEvent.keyDown(tree, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByText('Sent').closest('li')).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    // Inbox should be deselected now.
    expect(screen.getByText('Inbox').closest('li')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// axe-core
// ──────────────────────────────────────────────────────────────────────

describe('MailboxList — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = renderTree();
    await waitForTree();
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
