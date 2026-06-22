/**
 * @vitest-environment jsdom
 *
 * Tests for the ComposeView modal (Phase 2 work item 4).
 *
 * Covers:
 *   - Closed by default; opens via the `composeStateAtom` flip.
 *   - Form fields render with ARIA wiring; first focus lands in the
 *     dialog.
 *   - Send button is disabled until a valid recipient is present.
 *   - Invalid recipient shows an inline error.
 *   - Save-on-blur (debounced 500ms) calls `mail.draft`.
 *   - Send click runs `mail.send.preview` → renders the preview modal.
 *     Confirm runs `mail.send.commit` → closes the composer.
 *   - Cancel / Esc closes without sending.
 *   - axe-core baseline on the open modal.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Provider as JotaiProvider, useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { composeStateAtom } from '../../compose-state.js';
import { IarsmaProvider, mockInvoker } from '../../runtime/index.js';
import type { Invoker } from '../../runtime/index.js';
import { runAxe } from '../../__tests__/util/axe.js';
import { ComposeView } from '../compose-view.js';

const MAILBOXES = [
  {
    id: 'Mb-drafts',
    name: 'Drafts',
    role: 'drafts',
    sortOrder: 2,
    totalEmails: 0,
    unreadEmails: 0,
    totalThreads: 0,
    unreadThreads: 0,
    isSubscribed: true,
    myRights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: false,
      mayRename: false,
      mayDelete: false,
      maySubmit: false,
    },
  },
  {
    id: 'Mb-sent',
    name: 'Sent',
    role: 'sent',
    sortOrder: 3,
    totalEmails: 0,
    unreadEmails: 0,
    totalThreads: 0,
    unreadThreads: 0,
    isSubscribed: true,
    myRights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: false,
      mayRename: false,
      mayDelete: false,
      maySubmit: true,
    },
  },
];

const DRAFT_OK = {
  emailId: 'E-draft-1',
  blobId: 'B-1',
  threadId: 'T-1',
  size: 100,
};

const SEND_PREVIEW = {
  recipients: {
    to: [{ email: 'alice@example.net' }],
    envelopeRcptTo: ['alice@example.net'],
  },
  subject: 'hello',
  bodyPreview: 'Body content',
  hasBodyText: false,
  hasBodyHtml: true,
  attachmentCount: 0,
  attachmentBlobIds: [],
  estimatedSendTime: '2026-05-11T19:00:00Z',
  estimatedSize: 200,
  identityId: 'placeholder-identity',
};

const SEND_OK = {
  emailId: 'E-sent-1',
  blobId: 'B-2',
  threadId: 'T-2',
  size: 200,
  submissionId: 'S-1',
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function WithOpen({ children }: { children: React.ReactNode }) {
  const setState = useSetAtom(composeStateAtom);
  useEffect(() => {
    setState({ kind: 'open', prefill: {} });
  }, [setState]);
  return <>{children}</>;
}

function makeInvoker(
  overrides: {
    draft?: (input: unknown) => unknown;
    sendPreview?: () => unknown;
    sendCommit?: () => unknown;
    identities?: ReadonlyArray<{
      id: string;
      name: string;
      email: string;
      mayDelete: boolean;
    }>;
    upload?: (
      blob: Blob,
      options: { readonly name?: string; readonly type?: string },
    ) => {
      accountId: string;
      blobId: string;
      type: string;
      size: number;
    };
  } = {},
): {
  invoker: Invoker;
  calls: Array<{
    name: string;
    dryRun: boolean;
    input?: unknown;
    previewHashHex?: string;
  }>;
  uploads: Array<{ name: string; type: string; size: number }>;
} {
  const calls: Array<{
    name: string;
    dryRun: boolean;
    input?: unknown;
    previewHashHex?: string;
  }> = [];
  const uploads: Array<{ name: string; type: string; size: number }> = [];
  const identities = overrides.identities ?? [
    { id: 'I-1', name: 'Brent', email: 'brent@example.net', mayDelete: false },
  ];
  let nextBlobId = 1;
  const invoker = mockInvoker(
    {
      'mailbox.list': async () => MAILBOXES,
      'identity.list': async () => ({ identities }),
      'mail.draft': async (input, dryRun, options) => {
        calls.push({
          name: 'mail.draft',
          dryRun,
          input,
          ...(options?.previewHashHex !== undefined
            ? { previewHashHex: options.previewHashHex }
            : {}),
        });
        return overrides.draft !== undefined ? overrides.draft(input) : DRAFT_OK;
      },
      'mail.send': async (input, dryRun, options) => {
        calls.push({
          name: 'mail.send',
          dryRun,
          input,
          ...(options?.previewHashHex !== undefined
            ? { previewHashHex: options.previewHashHex }
            : {}),
        });
        if (dryRun) {
          return overrides.sendPreview !== undefined
            ? overrides.sendPreview()
            : SEND_PREVIEW;
        }
        return overrides.sendCommit !== undefined ? overrides.sendCommit() : SEND_OK;
      },
    },
    {
      uploadAttachment: async (blob, opts) => {
        uploads.push({
          name: opts.name ?? '(unnamed)',
          type: opts.type ?? blob.type,
          size: blob.size,
        });
        if (overrides.upload !== undefined) {
          return overrides.upload(blob, opts);
        }
        return {
          accountId: 'c',
          blobId: `B-${nextBlobId++}`,
          type: opts.type ?? blob.type ?? 'application/octet-stream',
          size: blob.size,
        };
      },
    },
  );
  return { invoker, calls, uploads };
}

function renderComposer(overrides: Parameters<typeof makeInvoker>[0] = {}) {
  const { invoker, calls, uploads } = makeInvoker(overrides);
  const r = render(
    <JotaiProvider>
      <IarsmaProvider value={invoker}>
        <WithOpen>
          <ComposeView />
        </WithOpen>
      </IarsmaProvider>
    </JotaiProvider>,
  );
  return { ...r, calls, uploads };
}

describe('ComposeView — closed by default', () => {
  it('does not render anything when composeStateAtom is closed', () => {
    const { invoker } = makeInvoker();
    render(
      <JotaiProvider>
        <IarsmaProvider value={invoker}>
          <ComposeView />
        </IarsmaProvider>
      </JotaiProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ComposeView — open state', () => {
  it('renders a dialog with the form fields', () => {
    renderComposer();
    const dialog = screen.getByRole('dialog', { name: /new message/i });
    expect(within(dialog).getByLabelText('To')).toBeInTheDocument();
    // Cc/Bcc are progressively disclosed (U-9) — reveal them first.
    fireEvent.click(within(dialog).getByRole('button', { name: /cc\/bcc/i }));
    expect(within(dialog).getByLabelText('Cc')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Bcc')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Subject')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('textbox', { name: 'Message body' }),
    ).toBeInTheDocument();
  });

  it('Send button is disabled with no recipients', () => {
    renderComposer();
    const send = screen.getByRole('button', { name: 'Send…' });
    expect(send).toBeDisabled();
  });

  it('Send button enables once a valid recipient is typed (and mailboxes load)', async () => {
    renderComposer();
    const toField = screen.getByLabelText('To');
    fireEvent.change(toField, { target: { value: 'alice@example.net' } });
    // Send also gates on the Sent mailbox being resolved — wait for
    // mailbox.list (microtask-async) to populate before the assertion.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send…' })).toBeEnabled();
    });
  });

  it('shows an inline error for an invalid recipient on blur (PR 47)', () => {
    renderComposer();
    const toField = screen.getByLabelText('To');
    fireEvent.change(toField, { target: { value: 'not-an-email' } });
    // PR 47 / CoWork #3 — the error no longer fires mid-keystroke;
    // it only surfaces after the field is blurred (or on Send).
    expect(screen.queryByText(/Invalid recipient/i)).not.toBeInTheDocument();
    fireEvent.blur(toField);
    expect(screen.getByText(/Invalid recipient/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send…' })).toBeDisabled();
  });
});

describe('ComposeView — save-on-blur', () => {
  it('debounces and calls mail.draft 500ms after a field blur', async () => {
    const { calls } = renderComposer();
    const toField = screen.getByLabelText('To');
    fireEvent.change(toField, { target: { value: 'alice@example.net' } });
    // Wait for the mailbox.list hook to resolve — proxied via Send
    // becoming enabled (Send disables until sentMailboxId is known).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send…' })).toBeEnabled();
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'hello' },
    });
    fireEvent.blur(screen.getByLabelText('Subject'));
    expect(calls.filter((c) => c.name === 'mail.draft')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    await waitFor(() => {
      expect(calls.filter((c) => c.name === 'mail.draft')).toHaveLength(1);
    });
  });

  it('does NOT save when the form is empty', async () => {
    const { calls } = renderComposer();
    // Even with mailboxes loaded, an empty form shouldn't save.
    await waitFor(() => {
      // Subject field present means render happened; mailbox.list is
      // microtask-async, but doSaveDraft's empty-check runs before
      // the mailbox check, so this test passes either way.
      expect(screen.getByLabelText('Subject')).toBeInTheDocument();
    });
    fireEvent.blur(screen.getByLabelText('Subject'));
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.filter((c) => c.name === 'mail.draft')).toHaveLength(0);
  });
});

async function fillRecipientAndWaitForSendEnabled() {
  fireEvent.change(screen.getByLabelText('To'), {
    target: { value: 'alice@example.net' },
  });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Send…' })).toBeEnabled();
  });
}

describe('ComposeView — send flow', () => {
  it('Send click runs preview → renders preview modal with the right data', async () => {
    const { calls } = renderComposer();
    await fillRecipientAndWaitForSendEnabled();
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /send this message/i }),
      ).toBeInTheDocument();
    });
    const sentDryRun = calls.find(
      (c) => c.name === 'mail.send' && c.dryRun,
    );
    expect(sentDryRun).toBeDefined();
    expect(screen.getByText('alice@example.net')).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('Confirm in preview calls mail.send.commit and closes the composer', async () => {
    const { calls } = renderComposer();
    await fillRecipientAndWaitForSendEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await waitFor(() => screen.getByRole('dialog', { name: /send this message/i }));
    const previewDialog = screen.getByRole('dialog', {
      name: /send this message/i,
    });
    const sendButtons = within(previewDialog).getAllByRole('button', {
      name: 'Send',
    });
    fireEvent.click(sendButtons[0]!);
    await waitFor(() => {
      expect(
        calls.find((c) => c.name === 'mail.send' && !c.dryRun),
      ).toBeDefined();
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /new message/i }),
      ).toBeNull();
    });
  });

  it('threads a SHA-384 previewHashHex from preview to commit (D-047 provenance)', async () => {
    const { calls } = renderComposer();
    await fillRecipientAndWaitForSendEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await waitFor(() => screen.getByRole('dialog', { name: /send this message/i }));
    const previewDialog = screen.getByRole('dialog', {
      name: /send this message/i,
    });
    fireEvent.click(
      within(previewDialog).getAllByRole('button', { name: 'Send' })[0]!,
    );
    await waitFor(() => {
      const commit = calls.find(
        (c) => c.name === 'mail.send' && !c.dryRun,
      );
      expect(commit).toBeDefined();
      // 96-hex-char SHA-384 (the helper returns lowercase hex).
      expect(commit!.previewHashHex).toMatch(/^[0-9a-f]{96}$/);
    });
  });

  it('Cancel in preview keeps the composer open and does not commit', async () => {
    const { calls } = renderComposer();
    await fillRecipientAndWaitForSendEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await waitFor(() => screen.getByRole('dialog', { name: /send this message/i }));
    const previewDialog = screen.getByRole('dialog', {
      name: /send this message/i,
    });
    fireEvent.click(within(previewDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /send this message/i }),
      ).toBeNull();
    });
    expect(
      screen.getByRole('dialog', { name: /new message/i }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.name === 'mail.send' && !c.dryRun)).toBeUndefined();
  });
});

describe('ComposeView — dismissal', () => {
  it('Esc closes the compose dialog', async () => {
    renderComposer();
    // PR 5.5: the dialog is a native <dialog>. Real browsers fire a
    // `cancel` event when the user presses Escape; jsdom doesn't
    // simulate that for synthetic keydown events. Fire the cancel
    // event directly — same pattern as the Dialog component's own
    // Esc test (components/__tests__/components.test.tsx).
    const dialog = screen.getByRole('dialog', { name: /new message/i });
    fireEvent(dialog, new Event('cancel'));
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /new message/i }),
      ).toBeNull();
    });
  });

  it('Cancel button closes the dialog', async () => {
    renderComposer();
    const dialog = screen.getByRole('dialog', { name: /new message/i });
    const cancelButtons = within(dialog).getAllByRole('button', {
      name: 'Cancel',
    });
    fireEvent.click(cancelButtons[0]!);
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /new message/i }),
      ).toBeNull();
    });
  });
});

describe('ComposeView — identity selector', () => {
  it('shows the single identity as static text (no dropdown when only one)', async () => {
    renderComposer();
    await waitFor(() => {
      expect(
        screen.getByText('Brent <brent@example.net>'),
      ).toBeInTheDocument();
    });
    // PR 47 — To/Cc/Bcc now expose role=combobox for autocomplete,
    // so just asserting "no combobox at all" no longer captures
    // intent. Narrow to the From-identity select specifically by
    // its label.
    expect(
      screen.queryByLabelText('From', { selector: 'select' }),
    ).toBeNull();
  });

  it('renders a dropdown when there are multiple identities, defaulting to the first', async () => {
    renderComposer({
      identities: [
        { id: 'I-1', name: 'Brent', email: 'brent@example.net', mayDelete: false },
        {
          id: 'I-2',
          name: 'Brent (work)',
          email: 'brent@example.org',
          mayDelete: true,
        },
      ],
    });
    const selector = await screen.findByRole('combobox', {
      name: /sending identity/i,
    });
    expect((selector as HTMLSelectElement).value).toBe('I-1');
    expect(within(selector).getAllByRole('option')).toHaveLength(2);
  });

  it('threads selectedIdentity through to mail.send commit', async () => {
    const { calls } = renderComposer({
      identities: [
        { id: 'I-1', name: 'Brent', email: 'brent@example.net', mayDelete: false },
        {
          id: 'I-2',
          name: 'Brent (work)',
          email: 'brent@example.org',
          mayDelete: true,
        },
      ],
    });
    const selector = await screen.findByRole('combobox', {
      name: /sending identity/i,
    });
    fireEvent.change(selector, { target: { value: 'I-2' } });
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: 'alice@example.net' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send…' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await waitFor(() =>
      screen.getByRole('dialog', { name: /send this message/i }),
    );
    const previewDialog = screen.getByRole('dialog', {
      name: /send this message/i,
    });
    fireEvent.click(
      within(previewDialog).getAllByRole('button', { name: 'Send' })[0]!,
    );
    await waitFor(() => {
      const commit = calls.find(
        (c) => c.name === 'mail.send' && !c.dryRun,
      );
      expect(commit).toBeDefined();
      expect((commit!.input as { identityId: string }).identityId).toBe('I-2');
    });
  });

  it('Send stays disabled when there are zero identities', async () => {
    renderComposer({ identities: [] });
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: 'alice@example.net' },
    });
    // Wait long enough for identity.list to resolve (synchronously
    // returns []). Send still gates on selectedIdentity !== null.
    await waitFor(() => {
      expect(
        screen.getByText(/no sending identities configured/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Send…' })).toBeDisabled();
  });
});

describe('ComposeView — attachments', () => {
  it('uploads a picked file and shows it as a chip with name + size', async () => {
    const { uploads } = renderComposer();
    const input = screen.getByLabelText(/attach files/i) as HTMLInputElement;
    const file = new File(['hello world'], 'note.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText('note.txt')).toBeInTheDocument();
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.name).toBe('note.txt');
    expect(screen.getByText('11 B')).toBeInTheDocument();
    // PR 5.5: section heading is gone; the count surfaces as "N attached"
    // next to the Attach button.
    expect(screen.getByText(/1 attached/i)).toBeInTheDocument();
  });

  it('removes an attachment via the chip × button', async () => {
    renderComposer();
    const input = screen.getByLabelText(/attach files/i) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(['x'], 'a.txt', { type: 'text/plain' })],
      },
    });
    await waitFor(() => screen.getByText('a.txt'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.txt' }));
    await waitFor(() => {
      expect(screen.queryByText('a.txt')).toBeNull();
    });
    // PR 5.5: when there are zero attachments the "N attached" output
    // is hidden entirely (no chip layout to count).
    expect(screen.queryByText(/attached/i)).toBeNull();
  });

  it('threads attached blobs through to mail.send commit', async () => {
    const { calls } = renderComposer();
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: 'alice@example.net' },
    });
    const input = screen.getByLabelText(/attach files/i) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(['pdf-bytes'], 'doc.pdf', { type: 'application/pdf' })],
      },
    });
    await waitFor(() => screen.getByText('doc.pdf'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send…' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    await waitFor(() =>
      screen.getByRole('dialog', { name: /send this message/i }),
    );
    const previewDialog = screen.getByRole('dialog', {
      name: /send this message/i,
    });
    fireEvent.click(
      within(previewDialog).getAllByRole('button', { name: 'Send' })[0]!,
    );
    await waitFor(() => {
      const commit = calls.find(
        (c) => c.name === 'mail.send' && !c.dryRun,
      );
      expect(commit).toBeDefined();
      const attachments = (commit!.input as {
        attachments?: Array<{ blobId: string; name: string }>;
      }).attachments;
      expect(attachments).toBeDefined();
      expect(attachments![0]).toMatchObject({ name: 'doc.pdf' });
    });
  });
});

describe('ComposeView — a11y', () => {
  it('has zero axe-core violations against WCAG 2.1 AA', async () => {
    const { container } = renderComposer();
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// U-9 — progressive Cc/Bcc disclosure
// ──────────────────────────────────────────────────────────────────────

describe('ComposeView — Cc/Bcc disclosure', () => {
  it('hides Cc and Bcc until the Cc/Bcc toggle is clicked', () => {
    renderComposer();
    expect(screen.queryByLabelText('Cc')).toBeNull();
    expect(screen.queryByLabelText('Bcc')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /cc\/bcc/i }));
    expect(screen.getByLabelText('Cc')).toBeInTheDocument();
    expect(screen.getByLabelText('Bcc')).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────────
// U-10 — skippable send confirmation
// ──────────────────────────────────────────────────────────────────────

import { skipSendReviewAtom } from '../../runtime/skip-send-review-state.js';

function SetSkip() {
  const set = useSetAtom(skipSendReviewAtom);
  useEffect(() => {
    set(true);
  }, [set]);
  return null;
}

describe('ComposeView — skippable send (U-10)', () => {
  it('exposes a "Don\'t ask again" checkbox in the review dialog', async () => {
    renderComposer();
    await fillRecipientAndWaitForSendEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    const dialog = await screen.findByRole('dialog', { name: /send this message/i });
    expect(within(dialog).getByLabelText(/don't ask again/i)).toBeInTheDocument();
  });

  it('skips the dialog and sends directly when the pref is on', async () => {
    const { invoker, calls } = makeInvoker();
    render(
      <JotaiProvider>
        <IarsmaProvider value={invoker}>
          <SetSkip />
          <WithOpen>
            <ComposeView />
          </WithOpen>
        </IarsmaProvider>
      </JotaiProvider>,
    );
    await fillRecipientAndWaitForSendEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send…' }));
    // Commits without ever showing the review dialog.
    await waitFor(() => {
      expect(calls.some((c) => c.name === 'mail.send' && !c.dryRun)).toBe(true);
    });
    expect(
      screen.queryByRole('dialog', { name: /send this message/i }),
    ).toBeNull();
  });
});
