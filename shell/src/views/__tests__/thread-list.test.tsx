/**
 * @vitest-environment jsdom
 *
 * Component-level tests for ThreadList (Phase 1 work item 4).
 *
 * Covers: rendering threads, ARIA listbox/option roles, selection
 * state, j/k + Arrow / Enter keyboard nav, empty / no-mailbox /
 * loading / error states, axe-core baseline.
 *
 * `@tanstack/react-virtual` is mocked here because jsdom doesn't
 * compute real layout — `getBoundingClientRect` returns 0×0, so the
 * real virtualizer would render zero visible items. The mock returns
 * all items at predictable offsets so we can test the rendered DOM.
 * This is consistent with the established pattern from
 * `mailbox-list.test.tsx` (which mocks the WASM bindings).
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider as JotaiProvider, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// WASM-binding stubs (same as mailbox-list.test.tsx) — required so
// the runtime's jmap-client module can load under jsdom.
vi.mock('@iarsma/wasm-bindings/jmap-client', () => ({
  session: { parseSession: vi.fn() },
  mailbox: { parseMailboxGetResponse: vi.fn() },
  email: { parseEmailQueryResponse: vi.fn() },
}));
vi.mock('@iarsma/wasm-bindings/action-log', () => ({
  chain: { canonicalize: vi.fn(), verifyLinks: vi.fn() },
}));

// Virtualizer stub: returns one virtualItem per real item, at fixed
// offsets. This keeps the rendered DOM faithful to the row order
// without depending on jsdom layout.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 64,
        end: (i + 1) * 64,
        size: 64,
        lane: 0,
      })),
    getTotalSize: () => count * 64,
    scrollToIndex: vi.fn(),
  }),
}));

import { IarsmaProvider, mockInvoker } from '../../runtime/index.js';
import type { ThreadList as ThreadListData } from '../../runtime/jmap-client.js';
import { selectedMailboxIdAtom } from '../../mail-state.js';
import { runAxe } from '../../__tests__/util/axe.js';
import { ThreadList } from '../thread-list.js';

afterEach(() => {
  cleanup();
});

function thread(
  id: string,
  subject: string,
  fromName: string,
  preview: string,
  receivedAt: string,
  seen = false,
  flagged = false,
): ThreadListData['threads'][number] {
  const keywords = [
    { name: '$seen', value: seen },
    ...(flagged ? [{ name: '$flagged', value: true }] : []),
  ];
  return {
    id,
    latestEmail: {
      id: `E-${id}`,
      threadId: id,
      from: [{ name: fromName, email: `${fromName.toLowerCase()}@example.net` }],
      subject,
      preview,
      receivedAt,
      keywords,
      size: 1024,
    },
  };
}

const FIXTURES: ThreadListData = {
  threads: [
    thread('T1', 'Welcome', 'Welcome Bot', 'Welcome to your new mailbox.', '2026-05-09T18:30:00Z', true),
    thread('T2', 'Re: project plan', 'Alice', "Looks good — let's go with that schedule.", '2026-05-09T15:42:11Z', true, true),
    thread('T3', '(no subject)', 'Bob', 'Hey can you send me…', '2026-05-09T09:01:55Z'),
  ],
  position: 0,
  total: 3,
};

/** Helper component that pre-selects a mailbox before rendering ThreadList. */
function WithSelectedMailbox({ mailboxId, children }: { mailboxId: string; children: React.ReactNode }) {
  const setSelectedMailboxId = useSetAtom(selectedMailboxIdAtom);
  useEffect(() => {
    setSelectedMailboxId(mailboxId);
  }, [mailboxId, setSelectedMailboxId]);
  return <>{children}</>;
}

function renderThreadList(opts: {
  data?: ThreadListData;
  mailboxId?: string | null;
  invokerError?: Error;
} = {}) {
  const data = opts.data ?? FIXTURES;
  const mailboxId = opts.mailboxId === undefined ? 'Mb01' : opts.mailboxId;
  const invoker = mockInvoker({
    'thread.list': async () => {
      if (opts.invokerError !== undefined) throw opts.invokerError;
      return data;
    },
  });
  return render(
    <JotaiProvider>
      <IarsmaProvider value={invoker}>
        {mailboxId !== null ? (
          <WithSelectedMailbox mailboxId={mailboxId}>
            <ThreadList />
          </WithSelectedMailbox>
        ) : (
          <ThreadList />
        )}
      </IarsmaProvider>
    </JotaiProvider>,
  );
}

async function waitForList(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('listbox', { name: 'Threads' })).toBeInTheDocument();
  });
}

// ──────────────────────────────────────────────────────────────────────
// Empty / no-mailbox / loading / error states
// ──────────────────────────────────────────────────────────────────────

describe('ThreadList — placeholder states', () => {
  it('shows "select a mailbox" placeholder when no mailbox is selected', () => {
    renderThreadList({ mailboxId: null });
    expect(
      screen.getByText(/select a mailbox/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows "no threads" empty state when the mailbox has zero threads', async () => {
    renderThreadList({ data: { threads: [], position: 0, total: 0 } });
    await waitFor(() => {
      expect(screen.getByText(/no threads in this mailbox/i)).toBeInTheDocument();
    });
  });

  it('shows error state when the invoker rejects', async () => {
    renderThreadList({
      invokerError: Object.assign(new Error('boom'), { code: 'tool_error', message: 'boom' }),
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load threads.*boom/i);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// ARIA structure + content
// ──────────────────────────────────────────────────────────────────────

describe('ThreadList — ARIA + content', () => {
  it('renders the listbox with one option per thread', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('listbox', { name: 'Threads' });
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(3);
  });

  it('renders subject, sender, and preview for each row', async () => {
    renderThreadList();
    await waitForList();
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText("Looks good — let's go with that schedule.")).toBeInTheDocument();
  });

  it('shows the count badge with aria-live for screen readers', async () => {
    renderThreadList();
    await waitForList();
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
  });

  it('uses (no subject) fallback when subject is absent', async () => {
    renderThreadList();
    await waitForList();
    expect(screen.getByText('(no subject)')).toBeInTheDocument();
  });

  it('exposes flagged threads with an accessible label', async () => {
    renderThreadList();
    await waitForList();
    expect(screen.getByLabelText('Flagged')).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Keyboard nav
// ──────────────────────────────────────────────────────────────────────

describe('ThreadList — keyboard nav', () => {
  it('j moves focus to the next thread', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('listbox', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'j' });
    await waitFor(() => {
      const focused = listbox.querySelector('[tabindex="0"]');
      expect(focused?.getAttribute('data-thread-id')).toBe('T2');
    });
  });

  it('k moves focus to the previous thread', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('listbox', { name: 'Threads' });
    // Move down to T2 first, then up.
    fireEvent.keyDown(listbox, { key: 'j' });
    fireEvent.keyDown(listbox, { key: 'k' });
    await waitFor(() => {
      const focused = listbox.querySelector('[tabindex="0"]');
      expect(focused?.getAttribute('data-thread-id')).toBe('T1');
    });
  });

  it('ArrowDown / ArrowUp work too (alongside j/k)', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('listbox', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await waitFor(() => {
      const focused = listbox.querySelector('[tabindex="0"]');
      expect(focused?.getAttribute('data-thread-id')).toBe('T2');
    });
  });

  it('Enter selects the focused thread (sets aria-selected=true)', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('listbox', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'j' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    await waitFor(() => {
      const t2 = listbox.querySelector('[data-thread-id="T2"]');
      expect(t2).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('End jumps to the last thread', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('listbox', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'End' });
    await waitFor(() => {
      const focused = listbox.querySelector('[tabindex="0"]');
      expect(focused?.getAttribute('data-thread-id')).toBe('T3');
    });
  });

  it('Home jumps to the first thread', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('listbox', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'End' });
    fireEvent.keyDown(listbox, { key: 'Home' });
    await waitFor(() => {
      const focused = listbox.querySelector('[tabindex="0"]');
      expect(focused?.getAttribute('data-thread-id')).toBe('T1');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Click selection
// ──────────────────────────────────────────────────────────────────────

describe('ThreadList — click selection', () => {
  it('clicking a row sets aria-selected', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('listbox', { name: 'Threads' });
    const t3 = listbox.querySelector('[data-thread-id="T3"]')!;
    fireEvent.click(t3);
    await waitFor(() => {
      expect(t3).toHaveAttribute('aria-selected', 'true');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// axe-core
// ──────────────────────────────────────────────────────────────────────

describe('ThreadList — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = renderThreadList();
    await waitForList();
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
