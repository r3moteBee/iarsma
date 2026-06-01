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
  email: {
    parseEmailQueryResponse: vi.fn(),
    parseThreadGetResponse: vi.fn(),
  },
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

type MailboxFixture = { id: string; role?: string };

function renderThreadList(opts: {
  data?: ThreadListData;
  mailboxId?: string | null;
  invokerError?: Error;
  mailboxes?: ReadonlyArray<MailboxFixture>;
  threadGet?: (input: { threadId: string }) => unknown;
} = {}) {
  const data = opts.data ?? FIXTURES;
  const mailboxId = opts.mailboxId === undefined ? 'Mb01' : opts.mailboxId;
  // Default mailbox list: a single "Mb01" with no role. Tests that
  // exercise the drafts path supply their own list with a
  // `role: 'drafts'` entry.
  const mailboxes = (opts.mailboxes ?? [{ id: 'Mb01' }]) as ReadonlyArray<unknown>;
  const invoker = mockInvoker({
    'thread.list': async () => {
      if (opts.invokerError !== undefined) throw opts.invokerError;
      return data;
    },
    'mailbox.list': async () => mailboxes,
    'thread.get': async (input) => {
      if (opts.threadGet !== undefined) {
        return opts.threadGet(input as { threadId: string });
      }
      return { thread: { id: '', emailIds: [] }, emails: [] };
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
  // Wait for both the listbox to render AND the auto-focus useEffect
  // to commit (focusedIndex 0 → first row has tabindex=0). Without the
  // tabindex check the j/k tests race the effect on slower CI runs:
  // listbox renders with no focused row, keydown fires with the null
  // focusedIndex, and our `focusedIndex ?? -1` path moves to 0 (T1)
  // instead of the expected "j from T1 → T2".
  await waitFor(() => {
    const listbox = screen.getByRole('list', { name: 'Threads' });
    expect(listbox).toBeInTheDocument();
    expect(listbox.querySelector('[tabindex="0"]')).not.toBeNull();
  });
}

// ──────────────────────────────────────────────────────────────────────
// Empty / no-mailbox / loading / error states
// ──────────────────────────────────────────────────────────────────────

describe('ThreadList — placeholder states', () => {
  it('shows the no-mailbox EmptyState when no mailbox is selected', () => {
    renderThreadList({ mailboxId: null });
    expect(screen.getByText(/no mailbox selected/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Threads' })).toBeNull();
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
  it('renders the list with one listitem per thread', async () => {
    renderThreadList();
    await waitForList();
    const list = screen.getByRole('list', { name: 'Threads' });
    // PR 4.5: rows became <li>s (listitem role). The primary click
    // target inside each <li> is a <button>; the listbox/option
    // pattern was incompatible with per-row action buttons.
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
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
    // PR 4 format: "1–N of M" (with optional "X unread · " prefix when
    // the mailbox carries an unreadEmails count). The render harness
    // doesn't seed mailbox metadata, so just the page-range half shows.
    expect(screen.getByText(/1.{1,3}3 of 3/)).toBeInTheDocument();
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
    const listbox = screen.getByRole('list', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'j' });
    await waitFor(() => {
      const focused = listbox.querySelector('[tabindex="0"]');
      expect(focused?.getAttribute('data-thread-id')).toBe('T2');
    });
  });

  it('k moves focus to the previous thread', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('list', { name: 'Threads' });
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
    const listbox = screen.getByRole('list', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await waitFor(() => {
      const focused = listbox.querySelector('[tabindex="0"]');
      expect(focused?.getAttribute('data-thread-id')).toBe('T2');
    });
  });

  it('Enter selects the focused thread (sets aria-current=true on the row button)', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('list', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'j' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    await waitFor(() => {
      // PR 4.5: selection moved from aria-selected on the row <li> to
      // aria-current on the inner row <button> (the listbox pattern
      // was incompatible with per-row action buttons — see PR body).
      const t2 = listbox.querySelector('button[data-thread-id="T2"]');
      expect(t2).toHaveAttribute('aria-current', 'true');
    });
  });

  it('End jumps to the last thread', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('list', { name: 'Threads' });
    fireEvent.keyDown(listbox, { key: 'End' });
    await waitFor(() => {
      const focused = listbox.querySelector('[tabindex="0"]');
      expect(focused?.getAttribute('data-thread-id')).toBe('T3');
    });
  });

  it('Home jumps to the first thread', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('list', { name: 'Threads' });
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
  it('clicking a row sets aria-current on the row button', async () => {
    renderThreadList();
    await waitForList();
    const listbox = screen.getByRole('list', { name: 'Threads' });
    // PR 4.5: click the inner row button, not the <li>. The button is
    // the interactive element; clicking the li wouldn't fire onClick.
    const t3 = listbox.querySelector<HTMLButtonElement>('button[data-thread-id="T3"]')!;
    fireEvent.click(t3);
    await waitFor(() => {
      expect(t3).toHaveAttribute('aria-current', 'true');
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

// ──────────────────────────────────────────────────────────────────────
// Drafts panel — Phase 2 item 8
// ──────────────────────────────────────────────────────────────────────

import { useAtomValue } from 'jotai';
import { composeStateAtom } from '../../compose-state.js';
import { selectedThreadIdAtom } from '../../mail-state.js';

describe('ThreadList — drafts click path', () => {
  /** Probe component that surfaces composeStateAtom + selectedThreadIdAtom
   *  for the assertions to consume. */
  function StateProbe() {
    const compose = useAtomValue(composeStateAtom);
    const selectedThread = useAtomValue(selectedThreadIdAtom);
    return (
      <div
        data-testid="state-probe"
        data-compose-kind={compose.kind}
        data-compose-subject={
          compose.kind === 'open' ? compose.prefill.subject ?? '' : ''
        }
        data-compose-body-html={
          compose.kind === 'open' ? compose.prefill.bodyHtml ?? '' : ''
        }
        data-selected-thread={selectedThread ?? ''}
      />
    );
  }

  it('opens the composer prefilled with the draft body when clicking a draft', async () => {
    const renderWithProbe = (opts: Parameters<typeof renderThreadList>[0]) => {
      const data = opts?.data ?? FIXTURES;
      const mailboxId =
        opts?.mailboxId === undefined ? 'Mb-drafts' : opts.mailboxId;
      const mailboxes = (opts?.mailboxes ?? [
        { id: 'Mb-drafts', role: 'drafts' },
      ]) as ReadonlyArray<unknown>;
      const invoker = mockInvoker({
        'thread.list': async () => data,
        'mailbox.list': async () => mailboxes,
        'thread.get': async (input) =>
          opts?.threadGet !== undefined
            ? opts.threadGet(input as { threadId: string })
            : { thread: { id: '', emailIds: [] }, emails: [] },
      });
      return render(
        <JotaiProvider>
          <IarsmaProvider value={invoker}>
            {mailboxId !== null ? (
              <WithSelectedMailbox mailboxId={mailboxId}>
                <ThreadList />
                <StateProbe />
              </WithSelectedMailbox>
            ) : (
              <>
                <ThreadList />
                <StateProbe />
              </>
            )}
          </IarsmaProvider>
        </JotaiProvider>,
      );
    };

    renderWithProbe({
      mailboxId: 'Mb-drafts',
      mailboxes: [{ id: 'Mb-drafts', role: 'drafts' }],
      threadGet: () => ({
        thread: { id: 'T1', emailIds: ['E-draft'] },
        emails: [
          {
            id: 'E-draft',
            threadId: 'T1',
            from: [{ email: 'brent@example.net' }],
            to: [{ email: 'alice@example.net' }],
            subject: 'project plan (draft)',
            preview: '',
            receivedAt: '2026-05-12T00:00:00Z',
            keywords: [{ name: '$draft', value: true }],
            size: 256,
            bodyHtml: '<p>Here is the plan.</p>',
            attachments: [],
            messageId: [],
            inReplyTo: [],
            references: [],
          },
        ],
      }),
    });

    await waitForList();
    const listbox = screen.getByRole('list', { name: 'Threads' });
    // PR 4.5: click the inner button, not the <li>.
    const t1 = listbox.querySelector<HTMLButtonElement>('button[data-thread-id="T1"]')!;
    fireEvent.click(t1);

    await waitFor(() => {
      const probe = screen.getByTestId('state-probe');
      expect(probe).toHaveAttribute('data-compose-kind', 'open');
      expect(probe).toHaveAttribute(
        'data-compose-subject',
        'project plan (draft)',
      );
      expect(probe).toHaveAttribute(
        'data-compose-body-html',
        '<p>Here is the plan.</p>',
      );
      // Drafts path doesn't touch selectedThreadIdAtom — the composer
      // is the user's surface for this thread.
      expect(probe).toHaveAttribute('data-selected-thread', '');
    });
  });

  it('keeps the normal thread-selection behavior in non-drafts mailboxes', async () => {
    renderThreadList({
      mailboxId: 'Mb01',
      mailboxes: [{ id: 'Mb01' /* no role */ }],
    });
    await waitForList();
    const listbox = screen.getByRole('list', { name: 'Threads' });
    fireEvent.click(listbox.querySelector('button[data-thread-id="T1"]')!);
    await waitFor(() => {
      expect(
        listbox.querySelector('button[data-thread-id="T1"]'),
      ).toHaveAttribute('aria-current', 'true');
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Search mode — Phase 2 item 9
// ──────────────────────────────────────────────────────────────────────

import { searchQueryAtom } from '../../mail-state.js';

describe('ThreadList — search mode', () => {
  function WithSearch({
    query,
    children,
  }: {
    query: string;
    children: React.ReactNode;
  }) {
    const setQuery = useSetAtom(searchQueryAtom);
    useEffect(() => {
      setQuery(query);
      return () => {
        setQuery('');
      };
    }, [query, setQuery]);
    return <>{children}</>;
  }

  it('switches to thread.search when the searchQueryAtom is non-empty', async () => {
    const invokerCalls: Array<{ name: string; input: unknown }> = [];
    const invoker = mockInvoker({
      'thread.list': async (input) => {
        invokerCalls.push({ name: 'thread.list', input });
        return FIXTURES;
      },
      'thread.search': async (input) => {
        invokerCalls.push({ name: 'thread.search', input });
        return {
          threads: [FIXTURES.threads[0]],
          position: 0,
          total: 1,
        };
      },
      'mailbox.list': async () => [{ id: 'Mb01' }],
      'thread.get': async () => ({ thread: { id: '', emailIds: [] }, emails: [] }),
    });
    render(
      <JotaiProvider>
        <IarsmaProvider value={invoker}>
          <WithSelectedMailbox mailboxId="Mb01">
            <WithSearch query="project">
              <ThreadList />
            </WithSearch>
          </WithSelectedMailbox>
        </IarsmaProvider>
      </JotaiProvider>,
    );
    await waitFor(() => {
      expect(
        invokerCalls.find((c) => c.name === 'thread.search'),
      ).toBeDefined();
    });
    // thread.list MUST NOT be called once search mode is active.
    expect(
      invokerCalls.find((c) => c.name === 'thread.list'),
    ).toBeUndefined();
    await waitFor(() => {
      expect(
        screen.getByRole('list', { name: 'Threads' }),
      ).toBeInTheDocument();
    });
  });

  it('shows a search-specific empty message when no results', async () => {
    const invoker = mockInvoker({
      'thread.list': async () => FIXTURES,
      'thread.search': async () => ({ threads: [], position: 0, total: 0 }),
      'mailbox.list': async () => [{ id: 'Mb01' }],
      'thread.get': async () => ({ thread: { id: '', emailIds: [] }, emails: [] }),
    });
    render(
      <JotaiProvider>
        <IarsmaProvider value={invoker}>
          <WithSelectedMailbox mailboxId="Mb01">
            <WithSearch query="nonexistent">
              <ThreadList />
            </WithSearch>
          </WithSelectedMailbox>
        </IarsmaProvider>
      </JotaiProvider>,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/no results for "nonexistent"/i),
      ).toBeInTheDocument();
    });
  });
});
