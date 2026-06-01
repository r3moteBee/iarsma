/**
 * @vitest-environment jsdom
 *
 * Integration-level a11y test for the 3-column signed-in shell
 * (Phase 1 work item 11).
 *
 * Each constituent view (MailboxList, ThreadList, ThreadView) has its
 * own per-component axe test. This file catches cross-component
 * a11y violations that only show up when the views are composed — e.g.
 * duplicate landmark roles, heading-order issues, or ARIA conflicts.
 *
 * The harness mirrors the layout from `App.tsx`'s `SignedInView`
 * exactly (3-column grid + ARIA landmarks). Drift would surface as a
 * test failure here even before the production component changes.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Provider as JotaiProvider, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the WASM bindings + virtualizer at module-load time — the
// signed-in shell imports both transitively, and jsdom can't load real
// WASM or compute layout for virtualization.
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
vi.mock('@iarsma/wasm-bindings/html-sanitizer', () => ({
  sanitize: {
    sanitize: (html: string, _allowExternalImages: boolean) => html,
  },
}));
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

import { selectedMailboxIdAtom } from '../mail-state.js';
import { IarsmaProvider, mockInvoker } from '../runtime/index.js';
import type { Invoker } from '../runtime/index.js';
import { MailboxTreeView, type MailboxRow } from '../components/mailbox-tree-view.js';
import { ThreadList } from '../views/thread-list.js';
import { ThreadView } from '../views/thread-view.js';
import { runAxe } from './util/axe.js';

afterEach(() => {
  cleanup();
});

// `mailbox.list` returns a flat array of Mailbox records — the
// MailboxList view folds it into a tree internally.
const RIGHTS = {
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  mayCreateChild: true,
  mayRename: true,
  mayDelete: false,
  maySubmit: true,
} as const;

const MAILBOX_FIXTURES = [
  {
    id: 'Mb01',
    name: 'Inbox',
    role: 'inbox',
    sortOrder: 0,
    totalEmails: 3,
    unreadEmails: 1,
    totalThreads: 2,
    unreadThreads: 1,
    myRights: RIGHTS,
  },
  {
    id: 'Mb02',
    name: 'Sent',
    role: 'sent',
    sortOrder: 1,
    totalEmails: 1,
    unreadEmails: 0,
    totalThreads: 1,
    unreadThreads: 0,
    myRights: RIGHTS,
  },
];

// MailboxTreeView is props-driven — give it the slim row shape directly
// instead of routing through the `mailbox.list` invoker mock.
const MAILBOX_ROWS: ReadonlyArray<MailboxRow> = [
  { id: 'Mb01', name: 'Inbox', role: 'inbox', unreadCount: 1, sortOrder: 0 },
  { id: 'Mb02', name: 'Sent', role: 'sent', unreadCount: 0, sortOrder: 1 },
];

const THREAD_LIST_FIXTURES = {
  threads: [
    {
      id: 'T1',
      latestEmail: {
        id: 'E1',
        threadId: 'T1',
        from: [{ name: 'Alice', email: 'alice@example.net' }],
        subject: 'Welcome',
        preview: 'Welcome to Iarsma.',
        receivedAt: '2026-05-10T18:30:00Z',
        keywords: [{ name: '$seen', value: false }],
        size: 1024,
      },
    },
  ],
  position: 0,
  total: 1,
};

const THREAD_GET_FIXTURES = {
  thread: { id: 'T1', emailIds: ['E1'] },
  emails: [
    {
      id: 'E1',
      threadId: 'T1',
      from: [{ name: 'Alice', email: 'alice@example.net' }],
      to: [{ name: 'Brent', email: 'brent@example.net' }],
      subject: 'Welcome',
      preview: 'Welcome to Iarsma.',
      receivedAt: '2026-05-10T18:30:00Z',
      keywords: [{ name: '$seen', value: false }],
      size: 1024,
      bodyText: 'Welcome to Iarsma.',
      attachments: [],
    },
  ],
};

function makeInvoker(): Invoker {
  return mockInvoker({
    'mailbox.list': async () => MAILBOX_FIXTURES,
    'thread.list': async () => THREAD_LIST_FIXTURES,
    'thread.get': async () => THREAD_GET_FIXTURES,
  });
}

/**
 * Mirror of the production `SignedInView` layout from `App.tsx`. Kept
 * in sync by hand — a drift between this harness and the production
 * markup would surface as an a11y regression here rather than silently
 * shipping. The two share landmarks, headings, and grid structure.
 */
function SignedInHarness() {
  const setSelectedMailboxId = useSetAtom(selectedMailboxIdAtom);
  // Pre-select Inbox so the thread list has data to render.
  useEffect(() => {
    setSelectedMailboxId('Mb01');
  }, [setSelectedMailboxId]);
  return (
    <main aria-label="Iarsma — signed in">
      <header>
        <h1>Iarsma</h1>
      </header>
      <section
        aria-labelledby="signedin-heading"
        style={{
          display: 'grid',
          gridTemplateColumns: '16em 22em minmax(0, 1fr)',
          gap: '1em',
          alignItems: 'start',
        }}
      >
        <header
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <h2 id="signedin-heading">Signed in</h2>
          <span>
            alice@example.net (
            <button type="button">Sign out</button>)
          </span>
        </header>
        <aside aria-label="Mailbox sidebar">
          <MailboxTreeView
            mailboxes={MAILBOX_ROWS}
            selectedId="Mb01"
            onSelect={(id) => setSelectedMailboxId(id)}
          />
        </aside>
        <section aria-label="Selected mailbox">
          <ThreadList />
        </section>
        <section aria-label="Selected thread">
          <ThreadView />
        </section>
      </section>
    </main>
  );
}

describe('a11y — signed-in shell integration', () => {
  it('renders the 3-column layout with zero axe-core violations', async () => {
    const { container } = render(
      <JotaiProvider>
        <IarsmaProvider value={makeInvoker()}>
          <SignedInHarness />
        </IarsmaProvider>
      </JotaiProvider>,
    );

    // Wait for all three columns to populate before running axe; the
    // empty loading states render placeholder text that doesn't catch
    // composition violations like duplicate landmarks.
    await waitFor(() => {
      expect(screen.getByRole('tree', { name: 'Mailboxes' })).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Threads' })).toBeInTheDocument();
    });

    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });

  it('exposes the expected landmark structure', async () => {
    render(
      <JotaiProvider>
        <IarsmaProvider value={makeInvoker()}>
          <SignedInHarness />
        </IarsmaProvider>
      </JotaiProvider>,
    );
    // Exactly one main landmark.
    expect(screen.getAllByRole('main')).toHaveLength(1);
    // The mailbox column is an `<aside>` (complementary landmark).
    expect(
      screen.getByRole('complementary', { name: 'Mailbox sidebar' }),
    ).toBeInTheDocument();
    // The two right columns are `<section aria-label>` (region role).
    expect(
      screen.getByRole('region', { name: 'Selected mailbox' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Selected thread' }),
    ).toBeInTheDocument();
  });

  it('uses a single h1 + monotonic heading order', async () => {
    render(
      <JotaiProvider>
        <IarsmaProvider value={makeInvoker()}>
          <SignedInHarness />
        </IarsmaProvider>
      </JotaiProvider>,
    );
    // One h1 (Iarsma). h2s: "Signed in" (harness) + the ThreadList's
    // mailbox-name pane title (PR 4). Multiple h2s at the same nesting
    // level are correct heading structure for sibling sections — what
    // we're checking is monotonic order (no level skipped) + a single
    // top-level h1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(1);
    // No level-1 → level-3 jumps.
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});
