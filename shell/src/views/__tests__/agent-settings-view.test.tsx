/**
 * @vitest-environment jsdom
 *
 * Tests for AgentSettingsView (Task 11 — Phase 3a).
 *
 * Covers:
 *   - Renders the issue form with all fields.
 *   - Submit button disabled when name is empty or no scopes selected.
 *   - Renders token table with provided tokens.
 *   - Revoke button calls onRevoke with the tokenId.
 *   - Shows secret display after successful issuance.
 *   - axe-core baseline.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub the wasm-bindings barrels — the runtime invoker.ts (now
// pulled in transitively by VacationSection's useInvoker) loads
// the JMAP WASM module on import, which jsdom can't satisfy.
vi.mock('@iarsma/wasm-bindings/jmap-client', () => ({
  mailbox: {},
  email: {},
  identity: {},
}));
vi.mock('@iarsma/wasm-bindings/action-log', () => ({
  chain: {
    canonicalize: () => new Uint8Array(0),
    verifyLinks: () => undefined,
  },
}));

import type { AgentTokenInfo, IssuedToken } from '../../runtime/agent-token-issuer.js';
import { runAxe } from '../../__tests__/util/axe.js';
import { IarsmaProvider } from '../../runtime/invoker.js';
import { AgentSettingsView } from '../agent-settings-view.js';

afterEach(cleanup);

const SAMPLE_TOKENS: readonly AgentTokenInfo[] = [
  {
    tokenId: 'tok-1',
    name: 'CI Bot',
    scopes: ['mail:read', 'mail:draft'],
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-08T00:00:00Z',
    revoked: false,
  },
  {
    tokenId: 'tok-2',
    name: 'Deploy Agent',
    scopes: ['mail:send'],
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-02T00:00:00Z',
    revoked: true,
  },
];

function noop() {
  return Promise.resolve();
}

function noopIssue(): Promise<IssuedToken> {
  return Promise.resolve({
    tokenId: 'tok-new',
    clientId: 'cid-new',
    clientSecret: 'secret-new-value',
    expiresAt: '2026-02-01T00:00:00Z',
  });
}

/**
 * PR 9: Settings has a sub-nav (Appearance / Agent tokens / Files /
 * Account). Default tab is Appearance. Tests that exercise the Issue
 * form + Token table need to navigate into the Agent tokens tab
 * first. Reused everywhere instead of duplicating the click.
 */
function openTokensTab(): void {
  const tab = screen.getByTestId('settings-tab-tokens');
  fireEvent.click(tab);
}

describe('AgentSettingsView', () => {
  describe('Issue form', () => {
    it('renders all form fields', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      expect(screen.getByLabelText(/agent name/i)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: /scopes/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/lifetime/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /issue token/i })).toBeInTheDocument();
    });

    it('renders all scope checkboxes', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      const scopes = ['mail:read', 'mail:draft', 'mail:send', 'mail:modify', 'mail:delete'];
      for (const scope of scopes) {
        expect(screen.getByLabelText(scope)).toBeInTheDocument();
      }
    });

    it('renders all lifetime options', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      const select = screen.getByLabelText(/lifetime/i);
      const options = within(select).getAllByRole('option');
      expect(options.map((o) => o.textContent)).toEqual([
        '1 hour',
        '1 day',
        '7 days',
        '30 days',
        '90 days',
      ]);
    });

    it('submit button is disabled when name is empty', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      // Check a scope so only name is missing
      fireEvent.click(screen.getByLabelText('mail:read'));
      expect(screen.getByRole('button', { name: /issue token/i })).toBeDisabled();
    });

    it('submit button is disabled when no scopes selected', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      // Fill in name but no scopes
      fireEvent.change(screen.getByLabelText(/agent name/i), {
        target: { value: 'My Agent' },
      });
      expect(screen.getByRole('button', { name: /issue token/i })).toBeDisabled();
    });

    it('submit button is enabled when name and at least one scope are provided', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      fireEvent.change(screen.getByLabelText(/agent name/i), {
        target: { value: 'My Agent' },
      });
      fireEvent.click(screen.getByLabelText('mail:read'));
      expect(screen.getByRole('button', { name: /issue token/i })).toBeEnabled();
    });

    it('calls onIssue with correct arguments on submit', async () => {
      const onIssue = vi.fn(noopIssue);
      render(
        <AgentSettingsView tokens={[]} onIssue={onIssue} onRevoke={noop} />,
      );
      openTokensTab();

      fireEvent.change(screen.getByLabelText(/agent name/i), {
        target: { value: 'CI Bot' },
      });
      fireEvent.click(screen.getByLabelText('mail:read'));
      fireEvent.click(screen.getByLabelText('mail:draft'));
      fireEvent.change(screen.getByLabelText(/lifetime/i), {
        target: { value: '604800' },
      });
      fireEvent.click(screen.getByRole('button', { name: /issue token/i }));

      await waitFor(() => {
        expect(onIssue).toHaveBeenCalledWith('CI Bot', ['mail:read', 'mail:draft'], 604800);
      });
    });

    it('shows secret display after successful issuance', async () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      fireEvent.change(screen.getByLabelText(/agent name/i), {
        target: { value: 'CI Bot' },
      });
      fireEvent.click(screen.getByLabelText('mail:read'));
      fireEvent.click(screen.getByRole('button', { name: /issue token/i }));

      await waitFor(() => {
        expect(screen.getByText(/secret-new-value/)).toBeInTheDocument();
      });
      // After PR 34 the page also renders Copy buttons inside the
      // MCP-connection docs; scope the assertion to the secret reveal.
      expect(
        screen.getByRole('button', { name: /copy secret/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/won't be shown again/i)).toBeInTheDocument();
    });
  });

  describe('Token table', () => {
    it('renders table with provided tokens', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      // Check column headers
      const headers = within(table).getAllByRole('columnheader');
      expect(headers.map((h) => h.textContent)).toEqual([
        'Name',
        'Scopes',
        'Issued',
        'Expires',
        'Last used',
        'Status',
        'Action',
      ]);

      // Check rows
      const rows = within(table).getAllByRole('row');
      // 1 header row + 2 data rows
      expect(rows).toHaveLength(3);
    });

    it('shows active status for non-revoked tokens', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      const rows = screen.getAllByRole('row');
      // First data row (index 1) is the non-revoked token
      expect(within(rows[1]!).getByText('Active')).toBeInTheDocument();
    });

    it('shows revoked status for revoked tokens', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      const rows = screen.getAllByRole('row');
      // Second data row (index 2) is the revoked token
      expect(within(rows[2]!).getByText('Revoked')).toBeInTheDocument();
    });

    it('shows revoke button only for active tokens', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      const revokeButtons = screen.getAllByRole('button', { name: /revoke/i });
      // Only one active token, so only one revoke button
      expect(revokeButtons).toHaveLength(1);
    });

    it('opens a confirm dialog before calling onRevoke (PR 12, §8.11)', async () => {
      const onRevoke = vi.fn(noop);
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={onRevoke} />,
      );
      openTokensTab();

      // Row button: opens the dialog, does NOT immediately revoke.
      const rowRevoke = screen.getByRole('button', { name: /revoke ci bot/i });
      fireEvent.click(rowRevoke);
      expect(onRevoke).not.toHaveBeenCalled();

      // Confirm dialog visible with destructive copy.
      const dialog = screen.getByRole('dialog', { name: /revoke token\?/i });
      expect(dialog).toBeInTheDocument();

      // Confirm.
      const confirm = within(dialog).getByRole('button', { name: /revoke token/i });
      fireEvent.click(confirm);

      await waitFor(() => {
        expect(onRevoke).toHaveBeenCalledWith('tok-1');
      });
    });

    it('cancel button closes the confirm dialog without revoking', () => {
      const onRevoke = vi.fn(noop);
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={onRevoke} />,
      );
      openTokensTab();

      fireEvent.click(screen.getByRole('button', { name: /revoke ci bot/i }));
      const dialog = screen.getByRole('dialog', { name: /revoke token\?/i });
      fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
      expect(onRevoke).not.toHaveBeenCalled();
    });

    it('shows scopes as comma-separated badges', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      const rows = screen.getAllByRole('row');
      // First data row has scopes 'mail:read', 'mail:draft'
      expect(within(rows[1]!).getByText('mail:read')).toBeInTheDocument();
      expect(within(rows[1]!).getByText('mail:draft')).toBeInTheDocument();
    });

    it('renders empty table when no tokens exist', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );
      openTokensTab();

      const table = screen.getByRole('table');
      const rows = within(table).getAllByRole('row');
      // Header row only
      expect(rows).toHaveLength(1);
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when isLoading is true', () => {
      render(
        <AgentSettingsView
          tokens={[]}
          onIssue={noopIssue}
          onRevoke={noop}
          isLoading={true}
        />,
      );
      openTokensTab();

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe('last used + jump-to-Activity (PR 16, §8.11)', () => {
    it('shows "Never" when a token has no last-used entry', () => {
      render(
        <AgentSettingsView
          tokens={SAMPLE_TOKENS}
          onIssue={noopIssue}
          onRevoke={noop}
          lastUsedByToken={new Map()}
        />,
      );
      openTokensTab();
      expect(screen.getAllByText(/never/i).length).toBeGreaterThan(0);
    });

    it('shows a relative time for tokens with a last-used entry', () => {
      // Use a fixed reference: 5 minutes ago.
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      render(
        <AgentSettingsView
          tokens={SAMPLE_TOKENS}
          onIssue={noopIssue}
          onRevoke={noop}
          lastUsedByToken={new Map([['tok-1', fiveMinAgo]])}
        />,
      );
      openTokensTab();
      // 5m ago should match the active row.
      expect(screen.getByText(/5m ago/i)).toBeInTheDocument();
    });

    it('renders an "Activity" button per token that calls onViewActivity with the token name', () => {
      const onViewActivity = vi.fn();
      render(
        <AgentSettingsView
          tokens={SAMPLE_TOKENS}
          onIssue={noopIssue}
          onRevoke={noop}
          onViewActivity={onViewActivity}
        />,
      );
      openTokensTab();
      const buttons = screen.getAllByRole('button', { name: /view activity for/i });
      // SAMPLE_TOKENS has 2 entries (one revoked, one active) — both
      // get the Activity link because filtering history is useful
      // even for revoked tokens.
      expect(buttons.length).toBe(SAMPLE_TOKENS.length);
      fireEvent.click(buttons[0]!);
      expect(onViewActivity).toHaveBeenCalledWith('CI Bot');
    });
  });

  describe('Sending section (PR 23, §8.5)', () => {
    function openSendingTab(): void {
      fireEvent.click(screen.getByTestId('settings-tab-sending'));
    }

    it('renders the Sending tab with the delay input', () => {
      // Clear localStorage so the test starts from defaults.
      localStorage.removeItem('iarsma-send-delay-ms');
      render(<AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />);
      openSendingTab();
      // The labelled "Delay" input is populated with the default
      // seconds value (10s).
      const input = screen.getByLabelText(/delay/i) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('10');
    });

    it('writes to the sendDelayMsAtom (× 1000) when the input changes', () => {
      localStorage.removeItem('iarsma-send-delay-ms');
      render(<AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />);
      openSendingTab();
      const input = screen.getByLabelText(/delay/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '5' } });
      expect(localStorage.getItem('iarsma-send-delay-ms')).toBe('5000');
    });

    it('clamps writes above the max (30s)', () => {
      localStorage.removeItem('iarsma-send-delay-ms');
      render(<AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />);
      openSendingTab();
      const input = screen.getByLabelText(/delay/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '60' } });
      expect(localStorage.getItem('iarsma-send-delay-ms')).toBe('30000');
    });
  });

  describe('MCP connection docs (PR 34)', () => {
    it('renders the collapsible docs panel above the issue form', () => {
      render(<AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />);
      openTokensTab();
      // The <summary> for the <details> renders the label as a clickable
      // element regardless of open/closed state.
      expect(screen.getByText(/how to connect an mcp agent/i)).toBeInTheDocument();
    });

    it('warns when no MCP URL is configured in the shell', () => {
      render(<AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />);
      openTokensTab();
      // Open the details element so the body is visible to the test.
      fireEvent.click(screen.getByText(/how to connect an mcp agent/i));
      expect(
        screen.getByText(/MCP URL for this deployment isn't configured/i),
      ).toBeInTheDocument();
    });

    it('shows the curl + SDK examples once opened', () => {
      render(<AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />);
      openTokensTab();
      fireEvent.click(screen.getByText(/how to connect an mcp agent/i));
      // curl block.
      expect(screen.getByText(/tools\/call/i)).toBeInTheDocument();
      // SDK block (StreamableHTTPClientTransport).
      expect(screen.getByText(/StreamableHTTPClientTransport/)).toBeInTheDocument();
    });
  });

  describe('Signatures section (PR 33)', () => {
    function openSignaturesTab(): void {
      fireEvent.click(screen.getByTestId('settings-tab-signatures'));
    }

    function renderWithInvoker(
      invoker: { invoke: ReturnType<typeof vi.fn> },
    ) {
      return render(
        <IarsmaProvider value={invoker}>
          <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />
        </IarsmaProvider>,
      );
    }

    const IDENTITIES = [
      {
        id: 'I-1',
        name: 'Brent',
        email: 'brent@example.test',
        mayDelete: false,
        textSignature: '— Brent',
      },
      {
        id: 'I-2',
        name: 'Brent (alt)',
        email: 'alt@example.test',
        mayDelete: true,
      },
    ];

    it('hydrates the textarea from the first identity\'s textSignature', async () => {
      const invoke = vi.fn(async (name: string) => {
        if (name === 'identity.list') {
          return { identities: IDENTITIES };
        }
        return undefined;
      });
      renderWithInvoker({ invoke });
      openSignaturesTab();
      await waitFor(() => {
        const ta = screen.getByLabelText(/^signature$/i) as HTMLTextAreaElement;
        expect(ta.value).toBe('— Brent');
      });
    });

    it('switching identity resets the draft to that identity\'s signature', async () => {
      const invoke = vi.fn(async (name: string) => {
        if (name === 'identity.list') {
          return { identities: IDENTITIES };
        }
        return undefined;
      });
      renderWithInvoker({ invoke });
      openSignaturesTab();
      await waitFor(() => {
        expect(screen.getByLabelText(/^identity$/i)).toBeInTheDocument();
      });
      fireEvent.change(screen.getByLabelText(/^identity$/i), {
        target: { value: 'I-2' },
      });
      // I-2 has no textSignature → empty draft.
      const ta = screen.getByLabelText(/^signature$/i) as HTMLTextAreaElement;
      expect(ta.value).toBe('');
    });

    it('Save calls identity.update with the trimmed signature', async () => {
      const calls: Array<{ name: string; input: unknown }> = [];
      const invoke = vi.fn(async (name: string, input: unknown) => {
        calls.push({ name, input });
        if (name === 'identity.list') {
          return { identities: IDENTITIES };
        }
        return { ok: true };
      });
      renderWithInvoker({ invoke });
      openSignaturesTab();
      const ta = (await waitFor(() =>
        screen.getByLabelText(/^signature$/i),
      )) as HTMLTextAreaElement;
      fireEvent.change(ta, {
        target: { value: '— Brent, signing off  ' },
      });
      fireEvent.click(screen.getByRole('button', { name: /save signature/i }));
      await waitFor(() => {
        expect(calls.find((c) => c.name === 'identity.update')).toBeDefined();
      });
      const updateCall = calls.find((c) => c.name === 'identity.update');
      expect(updateCall?.input).toEqual({
        identityId: 'I-1',
        patch: { textSignature: '— Brent, signing off' },
      });
    });

    it('Save sends null when the user clears the signature', async () => {
      const calls: Array<{ name: string; input: unknown }> = [];
      const invoke = vi.fn(async (name: string, input: unknown) => {
        calls.push({ name, input });
        if (name === 'identity.list') {
          return { identities: IDENTITIES };
        }
        return { ok: true };
      });
      renderWithInvoker({ invoke });
      openSignaturesTab();
      const ta = (await waitFor(() =>
        screen.getByLabelText(/^signature$/i),
      )) as HTMLTextAreaElement;
      fireEvent.change(ta, { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save signature/i }));
      await waitFor(() => {
        expect(calls.find((c) => c.name === 'identity.update')).toBeDefined();
      });
      expect(
        (calls.find((c) => c.name === 'identity.update')?.input as {
          patch: { textSignature: unknown };
        }).patch.textSignature,
      ).toBeNull();
    });

    it('Save is disabled when the draft matches the stored signature', async () => {
      const invoke = vi.fn(async (name: string) => {
        if (name === 'identity.list') return { identities: IDENTITIES };
        return undefined;
      });
      renderWithInvoker({ invoke });
      openSignaturesTab();
      await waitFor(() => {
        expect(screen.getByLabelText(/^signature$/i)).toBeInTheDocument();
      });
      // No change made → Save disabled.
      expect(screen.getByRole('button', { name: /save signature/i })).toBeDisabled();
    });
  });

  describe('Vacation responder section (PR 32)', () => {
    function openVacationTab(): void {
      fireEvent.click(screen.getByTestId('settings-tab-vacation'));
    }

    function renderWithInvoker(
      invoker: { invoke: ReturnType<typeof vi.fn> },
    ) {
      // VacationSection calls useInvoker() on mount; we wrap the
      // settings view in an IarsmaProvider so the hook resolves.
      return render(
        <IarsmaProvider value={invoker}>
          <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />
        </IarsmaProvider>,
      );
    }

    it('hydrates the form from vacation.get on mount', async () => {
      const invoke = vi.fn(async (name: string) => {
        if (name === 'vacation.get') {
          return {
            id: 'singleton',
            isEnabled: true,
            subject: 'Out of office',
            textBody: 'Back next week.',
            fromDate: '2026-06-10T00:00:00Z',
          };
        }
        return undefined;
      });
      renderWithInvoker({ invoke });
      openVacationTab();
      // The status checkbox reflects the server's isEnabled=true.
      await waitFor(() => {
        const cb = screen.getByLabelText(/enable vacation responder/i) as HTMLInputElement;
        expect(cb.checked).toBe(true);
      });
      // Subject + body are populated.
      expect((screen.getByLabelText(/subject/i) as HTMLInputElement).value).toBe(
        'Out of office',
      );
      expect((screen.getByLabelText(/message/i) as HTMLTextAreaElement).value).toBe(
        'Back next week.',
      );
      // Date field strips the ISO time component.
      expect((screen.getByLabelText(/start date/i) as HTMLInputElement).value).toBe(
        '2026-06-10',
      );
    });

    it('Save calls vacation.set with the form contents', async () => {
      const calls: Array<{ name: string; input: unknown }> = [];
      const invoke = vi.fn(async (name: string, input: unknown) => {
        calls.push({ name, input });
        if (name === 'vacation.get') {
          return { id: 'singleton', isEnabled: false };
        }
        return { ok: true };
      });
      renderWithInvoker({ invoke });
      openVacationTab();
      // Wait for initial load.
      await waitFor(() => {
        expect(calls.some((c) => c.name === 'vacation.get')).toBe(true);
      });
      // Toggle on + fill subject + body.
      fireEvent.click(screen.getByLabelText(/enable vacation responder/i));
      fireEvent.change(screen.getByLabelText(/subject/i), {
        target: { value: 'On vacation' },
      });
      fireEvent.change(screen.getByLabelText(/message/i), {
        target: { value: 'Back Monday.' },
      });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await waitFor(() => {
        expect(calls.find((c) => c.name === 'vacation.set')).toBeDefined();
      });
      const setCall = calls.find((c) => c.name === 'vacation.set');
      expect(setCall?.input).toMatchObject({
        isEnabled: true,
        subject: 'On vacation',
        textBody: 'Back Monday.',
      });
    });

    it('disables Save when enabled is on but subject is empty', async () => {
      const invoke = vi.fn(async (name: string) => {
        if (name === 'vacation.get') {
          return { id: 'singleton', isEnabled: false };
        }
        return undefined;
      });
      renderWithInvoker({ invoke });
      openVacationTab();
      await waitFor(() => {
        expect(screen.getByLabelText(/enable vacation responder/i)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText(/enable vacation responder/i));
      // Save is disabled because subject is empty.
      const save = screen.getByRole('button', { name: /^save$/i });
      expect(save).toBeDisabled();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );

      expect(await runAxe(container)).toEqual([]);
    });
  });
});
