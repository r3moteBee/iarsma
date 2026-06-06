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

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { runAxe } from '../../__tests__/util/axe.js';
import { IarsmaProvider } from '../../runtime/invoker.js';
import { AgentSettingsView } from '../agent-settings-view.js';

afterEach(cleanup);

describe('AgentSettingsView', () => {

  describe('Sending section (PR 23, §8.5)', () => {
    function openSendingTab(): void {
      fireEvent.click(screen.getByTestId('settings-tab-sending'));
    }

    it('renders the Sending tab with the delay input', () => {
      // Clear localStorage so the test starts from defaults.
      localStorage.removeItem('iarsma-send-delay-ms');
      render(<AgentSettingsView />);
      openSendingTab();
      // The labelled "Delay" input is populated with the default
      // seconds value (10s).
      const input = screen.getByLabelText(/delay/i) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('10');
    });

    it('writes to the sendDelayMsAtom (× 1000) when the input changes', () => {
      localStorage.removeItem('iarsma-send-delay-ms');
      render(<AgentSettingsView />);
      openSendingTab();
      const input = screen.getByLabelText(/delay/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '5' } });
      expect(localStorage.getItem('iarsma-send-delay-ms')).toBe('5000');
    });

    it('clamps writes above the max (30s)', () => {
      localStorage.removeItem('iarsma-send-delay-ms');
      render(<AgentSettingsView />);
      openSendingTab();
      const input = screen.getByLabelText(/delay/i) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '60' } });
      expect(localStorage.getItem('iarsma-send-delay-ms')).toBe('30000');
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
          <AgentSettingsView />
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
          <AgentSettingsView />
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
        <AgentSettingsView />,
      );

      expect(await runAxe(container)).toEqual([]);
    });
  });
});
