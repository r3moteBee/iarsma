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

import type { AgentTokenInfo, IssuedToken } from '../../runtime/agent-token-issuer.js';
import { runAxe } from '../../__tests__/util/axe.js';
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

describe('AgentSettingsView', () => {
  describe('Issue form', () => {
    it('renders all form fields', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );

      expect(screen.getByLabelText(/agent name/i)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: /scopes/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/lifetime/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /issue token/i })).toBeInTheDocument();
    });

    it('renders all scope checkboxes', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );

      const scopes = ['mail:read', 'mail:draft', 'mail:send', 'mail:modify', 'mail:delete'];
      for (const scope of scopes) {
        expect(screen.getByLabelText(scope)).toBeInTheDocument();
      }
    });

    it('renders all lifetime options', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );

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

      // Check a scope so only name is missing
      fireEvent.click(screen.getByLabelText('mail:read'));
      expect(screen.getByRole('button', { name: /issue token/i })).toBeDisabled();
    });

    it('submit button is disabled when no scopes selected', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );

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

      fireEvent.change(screen.getByLabelText(/agent name/i), {
        target: { value: 'CI Bot' },
      });
      fireEvent.click(screen.getByLabelText('mail:read'));
      fireEvent.click(screen.getByRole('button', { name: /issue token/i }));

      await waitFor(() => {
        expect(screen.getByText(/secret-new-value/)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
      expect(screen.getByText(/won't be shown again/i)).toBeInTheDocument();
    });
  });

  describe('Token table', () => {
    it('renders table with provided tokens', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );

      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();

      // Check column headers
      const headers = within(table).getAllByRole('columnheader');
      expect(headers.map((h) => h.textContent)).toEqual([
        'Name',
        'Scopes',
        'Issued',
        'Expires',
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

      const rows = screen.getAllByRole('row');
      // First data row (index 1) is the non-revoked token
      expect(within(rows[1]!).getByText('Active')).toBeInTheDocument();
    });

    it('shows revoked status for revoked tokens', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );

      const rows = screen.getAllByRole('row');
      // Second data row (index 2) is the revoked token
      expect(within(rows[2]!).getByText('Revoked')).toBeInTheDocument();
    });

    it('shows revoke button only for active tokens', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );

      const revokeButtons = screen.getAllByRole('button', { name: /revoke/i });
      // Only one active token, so only one revoke button
      expect(revokeButtons).toHaveLength(1);
    });

    it('calls onRevoke with the tokenId when clicking revoke', async () => {
      const onRevoke = vi.fn(noop);
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={onRevoke} />,
      );

      const revokeButton = screen.getByRole('button', { name: /revoke/i });
      fireEvent.click(revokeButton);

      await waitFor(() => {
        expect(onRevoke).toHaveBeenCalledWith('tok-1');
      });
    });

    it('shows scopes as comma-separated badges', () => {
      render(
        <AgentSettingsView tokens={SAMPLE_TOKENS} onIssue={noopIssue} onRevoke={noop} />,
      );

      const rows = screen.getAllByRole('row');
      // First data row has scopes 'mail:read', 'mail:draft'
      expect(within(rows[1]!).getByText('mail:read')).toBeInTheDocument();
      expect(within(rows[1]!).getByText('mail:draft')).toBeInTheDocument();
    });

    it('renders empty table when no tokens exist', () => {
      render(
        <AgentSettingsView tokens={[]} onIssue={noopIssue} onRevoke={noop} />,
      );

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

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
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
