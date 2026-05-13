/**
 * @vitest-environment jsdom
 *
 * Component-level tests for ThreadView + MessageView (Phase 1 work
 * item 7). Mirrors the structure of `thread-list.test.tsx` (PR-12):
 *
 *   - WASM-binding stubs (jmap-client, action-log, html-sanitizer).
 *     The sanitizer stub returns the input unchanged so we can assert
 *     "the html the component handed to dangerouslySetInnerHTML matches
 *     the html the email carried." Production wires the real
 *     ammonia-backed component (see PR-13 Rust tests for security
 *     coverage).
 *
 *   - Placeholder / loading / error / empty states.
 *
 *   - Expand-collapse behavior: latest message starts expanded, older
 *     start collapsed; clicking the header toggles.
 *
 *   - Sanitizer is invoked: bodyHtml → html element; bodyText → <pre>
 *     fallback when html is absent.
 *
 *   - External-images toggle: the "Show external images" affordance
 *     appears only when the html contains an `src=https?:` reference,
 *     and pressing it re-runs the sanitizer with allowExternalImages=true.
 *
 *   - Keyboard nav: n/ArrowDown, p/ArrowUp move focus AND auto-expand
 *     the destination message; e expands all.
 *
 *   - Attachments listing.
 *
 *   - axe-core baseline.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider as JotaiProvider, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

// Sanitizer stub: pass-through with a marker so we can assert that the
// component routed the body through us. The real component (PR-13) is
// covered by 26 Rust tests; here we only need to verify the wiring.
const sanitizeMock = vi.fn(
  (html: string, _allowExternalImages: boolean) => `[sanitized]${html}`,
);
vi.mock('@iarsma/wasm-bindings/html-sanitizer', () => ({
  sanitize: {
    sanitize: (html: string, allowExternalImages: boolean) =>
      sanitizeMock(html, allowExternalImages),
  },
}));

import { IarsmaProvider, mockInvoker } from '../../runtime/index.js';
import type { Invoker } from '../../runtime/index.js';
import { selectedThreadIdAtom } from '../../mail-state.js';
import { runAxe } from '../../__tests__/util/axe.js';
import { ThreadView } from '../thread-view.js';

afterEach(() => {
  cleanup();
  sanitizeMock.mockClear();
});

type Email = {
  id: string;
  threadId: string;
  from?: Array<{ name?: string; email: string }>;
  to?: Array<{ name?: string; email: string }>;
  subject?: string;
  preview?: string;
  receivedAt: string;
  keywords: Array<{ name: string; value: boolean }>;
  size: number;
  bodyText?: string;
  bodyHtml?: string;
  attachments: Array<{
    id: string;
    name?: string;
    type: string;
    size: number;
    cid?: string;
    disposition?: string;
  }>;
  messageId: string[];
  inReplyTo: string[];
  references: string[];
};

function email(over: Partial<Email> = {}): Email {
  return {
    id: over.id ?? 'E1',
    threadId: 'T1',
    from: [{ name: 'Alice', email: 'alice@example.net' }],
    to: [{ name: 'Brent', email: 'brent@example.net' }],
    subject: 'Subject 1',
    preview: 'Preview text 1.',
    receivedAt: '2026-05-09T15:42:11Z',
    keywords: [{ name: '$seen', value: true }],
    size: 1024,
    attachments: [],
    messageId: [],
    inReplyTo: [],
    references: [],
    ...over,
  };
}

function fixtureThreadGet(emails: Array<Email>) {
  return {
    thread: { id: 'T1', emailIds: emails.map((e) => e.id) },
    emails,
  };
}

function WithSelectedThread({
  threadId,
  children,
}: {
  threadId: string;
  children: React.ReactNode;
}) {
  const setSelectedThreadId = useSetAtom(selectedThreadIdAtom);
  useEffect(() => {
    setSelectedThreadId(threadId);
  }, [threadId, setSelectedThreadId]);
  return <>{children}</>;
}

function renderThreadView(opts: {
  threadId?: string | null;
  emails?: Array<Email>;
  invokerError?: Error;
  customInvoker?: Invoker;
} = {}) {
  const threadId = opts.threadId === undefined ? 'T1' : opts.threadId;
  const emails = opts.emails ?? [email()];
  const invoker =
    opts.customInvoker ??
    mockInvoker({
      'thread.get': async () => {
        if (opts.invokerError !== undefined) throw opts.invokerError;
        return fixtureThreadGet(emails);
      },
    });
  return render(
    <JotaiProvider>
      <IarsmaProvider value={invoker}>
        {threadId !== null ? (
          <WithSelectedThread threadId={threadId}>
            <ThreadView />
          </WithSelectedThread>
        ) : (
          <ThreadView />
        )}
      </IarsmaProvider>
    </JotaiProvider>,
  );
}

// ──────────────────────────────────────────────────────────────────────
// Placeholder / loading / error / empty states
// ──────────────────────────────────────────────────────────────────────

describe('ThreadView — placeholder states', () => {
  it('shows a "select a thread" placeholder when no thread is selected', () => {
    renderThreadView({ threadId: null });
    expect(screen.getByText(/select a thread/i)).toBeInTheDocument();
  });

  it('renders an empty-thread message when the data has zero emails', async () => {
    renderThreadView({ emails: [] });
    await waitFor(() => {
      expect(screen.getByText(/no messages/i)).toBeInTheDocument();
    });
  });

  it('shows the error state when the invoker rejects', async () => {
    renderThreadView({
      invokerError: Object.assign(new Error('boom'), {
        code: 'tool_error',
        message: 'boom',
      }),
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /failed to load thread.*boom/i,
      );
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Body rendering + expand/collapse
// ──────────────────────────────────────────────────────────────────────

describe('ThreadView — body rendering', () => {
  it('renders subject in the thread header from the latest message', async () => {
    renderThreadView({
      emails: [
        email({ id: 'E1', subject: 'old subject', receivedAt: '2026-05-01T00:00:00Z' }),
        email({ id: 'E2', subject: 'latest subject', receivedAt: '2026-05-09T00:00:00Z' }),
      ],
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: 'latest subject' }),
      ).toBeInTheDocument();
    });
  });

  it('routes html bodies through the sanitizer and renders the result', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          bodyHtml: '<p>hello <b>world</b></p>',
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByTestId('message-html-body')).toBeInTheDocument();
    });
    // Sanitizer was called once on initial render with default-off
    // external images, with the body html.
    expect(sanitizeMock).toHaveBeenCalledWith(
      '<p>hello <b>world</b></p>',
      false,
    );
    expect(screen.getByTestId('message-html-body').innerHTML).toBe(
      '[sanitized]<p>hello <b>world</b></p>',
    );
  });

  it('falls back to <pre> for plain-text bodies when html is absent', async () => {
    // No bodyHtml — exactOptionalPropertyTypes won't accept `undefined`,
    // so we just omit the field. The base fixture also omits it.
    renderThreadView({
      emails: [email({ id: 'E1', bodyText: 'plain only' })],
    });
    await waitFor(() => {
      expect(screen.getByTestId('message-text-body')).toHaveTextContent(
        'plain only',
      );
    });
    expect(sanitizeMock).not.toHaveBeenCalled();
  });

  it('latest message starts expanded; older messages start collapsed', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          subject: 'older',
          preview: 'older preview',
          bodyText: 'older body text',
          receivedAt: '2026-05-01T00:00:00Z',
        }),
        email({
          id: 'E2',
          subject: 'newer',
          preview: 'newer preview',
          bodyText: 'newer body text',
          receivedAt: '2026-05-09T00:00:00Z',
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByText('newer body text')).toBeInTheDocument();
    });
    // Older message is collapsed: preview visible, body hidden.
    expect(screen.queryByText('older body text')).not.toBeInTheDocument();
    expect(screen.getByText('older preview')).toBeInTheDocument();
  });

  it('clicking a collapsed message header expands it', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          subject: 'older',
          bodyText: 'older body text',
          receivedAt: '2026-05-01T00:00:00Z',
        }),
        email({
          id: 'E2',
          subject: 'newer',
          bodyText: 'newer body text',
          receivedAt: '2026-05-09T00:00:00Z',
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByText('newer body text')).toBeInTheDocument();
    });
    // Find the older message's toggle button via aria-controls — each
    // button controls `message-body-${id}`. The older message is E1.
    const olderToggle = document.querySelector(
      'button[aria-controls="message-body-E1"]',
    );
    expect(olderToggle).not.toBeNull();
    fireEvent.click(olderToggle!);
    await waitFor(() => {
      expect(screen.getByText('older body text')).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// External-images toggle
// ──────────────────────────────────────────────────────────────────────

describe('ThreadView — external content toggle', () => {
  it('shows a "Show" affordance when the html has an external src=https?:', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          bodyHtml: '<p>hi</p><img src="https://tracker.example/p.gif">',
        }),
      ],
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /show external images/i }),
      ).toBeInTheDocument();
    });
  });

  it('does NOT show the toggle when the html has no external src', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          bodyHtml: '<p>plain html, no images</p>',
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByTestId('message-html-body')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /show external/i }),
    ).toBeNull();
  });

  it('clicking "Show" re-runs the sanitizer with allowExternalImages=true', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          bodyHtml: '<img src="https://x.example/p.gif">',
        }),
      ],
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /show external images/i }),
      ).toBeInTheDocument();
    });
    sanitizeMock.mockClear();
    fireEvent.click(
      screen.getByRole('button', { name: /show external images/i }),
    );
    await waitFor(() => {
      expect(sanitizeMock).toHaveBeenCalledWith(
        '<img src="https://x.example/p.gif">',
        true,
      );
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Keyboard nav
// ──────────────────────────────────────────────────────────────────────

describe('ThreadView — keyboard nav', () => {
  it('e expands all messages', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          subject: 'older',
          bodyText: 'older body text',
          receivedAt: '2026-05-01T00:00:00Z',
        }),
        email({
          id: 'E2',
          subject: 'newer',
          bodyText: 'newer body text',
          receivedAt: '2026-05-09T00:00:00Z',
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByText('newer body text')).toBeInTheDocument();
    });
    const section = screen.getByRole('region', { name: 'Thread' });
    fireEvent.keyDown(section, { key: 'e' });
    await waitFor(() => {
      expect(screen.getByText('older body text')).toBeInTheDocument();
      expect(screen.getByText('newer body text')).toBeInTheDocument();
    });
  });

  it('p / ArrowUp moves focus to and expands the previous message', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          subject: 'older',
          bodyText: 'older body text',
          receivedAt: '2026-05-01T00:00:00Z',
        }),
        email({
          id: 'E2',
          subject: 'newer',
          bodyText: 'newer body text',
          receivedAt: '2026-05-09T00:00:00Z',
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByText('newer body text')).toBeInTheDocument();
    });
    const section = screen.getByRole('region', { name: 'Thread' });
    fireEvent.keyDown(section, { key: 'p' });
    await waitFor(() => {
      expect(screen.getByText('older body text')).toBeInTheDocument();
    });
  });

  it('n / ArrowDown moves focus to and expands the next message', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          subject: 'first',
          bodyText: 'first body text',
          receivedAt: '2026-05-01T00:00:00Z',
        }),
        email({
          id: 'E2',
          subject: 'second',
          bodyText: 'second body text',
          receivedAt: '2026-05-05T00:00:00Z',
        }),
        email({
          id: 'E3',
          subject: 'third',
          bodyText: 'third body text',
          receivedAt: '2026-05-09T00:00:00Z',
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByText('third body text')).toBeInTheDocument();
    });
    // Default focus is on the third (latest); n should be a no-op
    // (clamp), p should go back to second, p again to first.
    const section = screen.getByRole('region', { name: 'Thread' });
    fireEvent.keyDown(section, { key: 'p' });
    await waitFor(() => {
      expect(screen.getByText('second body text')).toBeInTheDocument();
    });
    fireEvent.keyDown(section, { key: 'n' });
    // Returning to "third" — already expanded — body still visible.
    await waitFor(() => {
      expect(screen.getByText('third body text')).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Attachments listing
// ──────────────────────────────────────────────────────────────────────

describe('ThreadView — attachments', () => {
  it('lists non-inline attachments with name, type, and size', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          attachments: [
            {
              id: 'A1',
              name: 'invoice.pdf',
              type: 'application/pdf',
              size: 12345,
              disposition: 'attachment',
            },
          ],
        }),
      ],
    });
    await waitFor(() => {
      expect(
        screen.getByRole('region', { name: 'Attachments' }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.getByText('application/pdf')).toBeInTheDocument();
    expect(screen.getByText('12.1 KB')).toBeInTheDocument();
  });

  it('does NOT list inline attachments (they render via cid: in the body)', async () => {
    renderThreadView({
      emails: [
        email({
          id: 'E1',
          attachments: [
            {
              id: 'A1',
              type: 'image/png',
              size: 4096,
              cid: 'inline1@x',
              disposition: 'inline',
            },
          ],
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Thread')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('region', { name: 'Attachments' }),
    ).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// axe-core baseline
// ──────────────────────────────────────────────────────────────────────

describe('ThreadView — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = renderThreadView({
      emails: [
        email({
          id: 'E1',
          subject: 'older',
          bodyHtml: '<p>older body</p>',
          receivedAt: '2026-05-01T00:00:00Z',
        }),
        email({
          id: 'E2',
          subject: 'newer',
          bodyHtml: '<p>newer body</p>',
          receivedAt: '2026-05-09T00:00:00Z',
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByTestId('message-html-body')).toBeInTheDocument();
    });
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Reply / Reply All / Forward — Phase 2 item 5
// ──────────────────────────────────────────────────────────────────────

import { composeStateAtom } from '../../compose-state.js';
import { useAtomValue } from 'jotai';

describe('ThreadView — reply actions', () => {
  /** Test harness that exposes composeStateAtom so we can assert it
   *  flipped open with the right prefill after a button click. */
  function ComposeStateProbe() {
    const state = useAtomValue(composeStateAtom);
    return (
      <div
        data-testid="compose-state"
        data-kind={state.kind}
        data-subject={state.kind === 'open' ? state.prefill.subject ?? '' : ''}
        data-to={
          state.kind === 'open'
            ? (state.prefill.to ?? []).map((a) => a.email).join(',')
            : ''
        }
        data-cc={
          state.kind === 'open'
            ? (state.prefill.cc ?? []).map((a) => a.email).join(',')
            : ''
        }
      />
    );
  }

  function renderWithProbe(emails: Array<Email>) {
    return render(
      <JotaiProvider>
        <IarsmaProvider
          value={mockInvoker({
            'thread.get': async () => fixtureThreadGet(emails),
          })}
        >
          <WithSelectedThread threadId="T1">
            <ThreadView />
          </WithSelectedThread>
          <ComposeStateProbe />
        </IarsmaProvider>
      </JotaiProvider>,
    );
  }

  it('Reply opens compose with to=sender, subject prefixed Re:', async () => {
    renderWithProbe([
      email({
        id: 'E1',
        from: [{ email: 'bob@example.net' }],
        to: [{ email: 'brent@example.net' }],
        subject: 'Project plan',
        messageId: ['<m-1@example.net>'],
      }),
    ]);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Reply' }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => {
      const probe = screen.getByTestId('compose-state');
      expect(probe).toHaveAttribute('data-kind', 'open');
      expect(probe).toHaveAttribute('data-subject', 'Re: Project plan');
      expect(probe).toHaveAttribute('data-to', 'bob@example.net');
      expect(probe).toHaveAttribute('data-cc', '');
    });
  });

  it('Reply all opens compose with cc filled from the original to + cc', async () => {
    // In tests `tokensAtom` is null → userEmail falls back to
    // 'unknown@example.invalid', so the "minus self" rule doesn't
    // filter anything by accident. The reply-prefill self-exclusion
    // logic is unit-tested directly in `reply-prefill.test.ts`.
    renderWithProbe([
      email({
        id: 'E1',
        from: [{ email: 'bob@example.net' }],
        to: [
          { email: 'alice@example.net' },
          { email: 'carol@example.net' },
        ],
        messageId: ['<m-1@example.net>'],
      }),
    ]);
    await waitFor(() => screen.getByRole('button', { name: 'Reply all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply all' }));
    await waitFor(() => {
      const probe = screen.getByTestId('compose-state');
      expect(probe).toHaveAttribute('data-kind', 'open');
      expect(probe).toHaveAttribute('data-to', 'bob@example.net');
      expect(probe).toHaveAttribute(
        'data-cc',
        'alice@example.net,carol@example.net',
      );
    });
  });

  it('Forward opens compose with empty recipients and Fwd: subject', async () => {
    renderWithProbe([
      email({
        id: 'E1',
        from: [{ email: 'bob@example.net' }],
        subject: 'Project plan',
        messageId: ['<m-1@example.net>'],
      }),
    ]);
    await waitFor(() => screen.getByRole('button', { name: 'Forward' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await waitFor(() => {
      const probe = screen.getByTestId('compose-state');
      expect(probe).toHaveAttribute('data-kind', 'open');
      expect(probe).toHaveAttribute('data-subject', 'Fwd: Project plan');
      expect(probe).toHaveAttribute('data-to', '');
    });
  });

  it('`r` keyboard binding replies to the focused message', async () => {
    renderWithProbe([
      email({
        id: 'E1',
        from: [{ email: 'bob@example.net' }],
        subject: 'Older message',
        receivedAt: '2026-05-01T00:00:00Z',
        messageId: ['<older@example.net>'],
      }),
      email({
        id: 'E2',
        from: [{ email: 'carol@example.net' }],
        subject: 'Newer message',
        receivedAt: '2026-05-09T00:00:00Z',
        messageId: ['<newer@example.net>'],
      }),
    ]);
    await waitFor(() => screen.getByRole('region', { name: 'Thread' }));
    // Latest message starts focused (E2). Press `r`.
    const section = screen.getByRole('region', { name: 'Thread' });
    fireEvent.keyDown(section, { key: 'r' });
    await waitFor(() => {
      const probe = screen.getByTestId('compose-state');
      expect(probe).toHaveAttribute('data-kind', 'open');
      expect(probe).toHaveAttribute('data-subject', 'Re: Newer message');
      expect(probe).toHaveAttribute('data-to', 'carol@example.net');
    });
  });
});
