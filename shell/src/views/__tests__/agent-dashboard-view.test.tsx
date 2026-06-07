/**
 * @vitest-environment jsdom
 *
 * Tests for AgentDashboardView (PR 38; revoke + issue inline in PR 40).
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Same shim agent-settings-view.test.tsx uses — the dashboard now
// pulls in IssueTokenForm + McpConnectionDocs which transitively
// import wasm-bindings via invoker.ts.
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

import { AgentDashboardView } from '../agent-dashboard-view.js';
import type { IssuedToken } from '../../runtime/agent-token-issuer.js';
import type {
  AgentDashboardAggregate,
  AgentDashboardEntry,
} from '../../runtime/use-agent-dashboard.js';

const AGG: AgentDashboardAggregate = {
  activeAgentCount: 2,
  revokedAgentCount: 0,
  totalActionsInWindow: 5,
  dryRunsInWindow: 2,
  commitsInWindow: 3,
  windowHours: 24,
};

function agent(over: Partial<AgentDashboardEntry>): AgentDashboardEntry {
  return {
    tokenId: 'tok-id-1',
    name: 'alice',
    scopes: ['mail:read'],
    issuedAt: '2026-06-01T00:00:00Z',
    expiresAt: '2027-06-01T00:00:00Z',
    revoked: false,
    totalActions: 0,
    actionsInWindow: 0,
    commitsInWindow: 0,
    dryRunsInWindow: 0,
    ...over,
  };
}

function noopIssue(): Promise<IssuedToken> {
  return Promise.resolve({
    tokenId: 'fake',
    clientId: 'fake',
    clientSecret: 'fake-secret',
    expiresAt: '2027-01-01T00:00:00Z',
  });
}

function noopRevoke(): Promise<void> {
  return Promise.resolve();
}

afterEach(cleanup);

describe('AgentDashboardView', () => {
  it('renders aggregate cards with the window hours in the label', () => {
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    expect(screen.getByText(/active agents/i)).toBeInTheDocument();
    expect(screen.getByText(/actions \(last 24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/commits \(last 24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/dry-runs \(last 24h\)/i)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders the inline Issue form (moved from Settings in PR 40)', () => {
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    expect(screen.getByText(/issue new token/i)).toBeInTheDocument();
  });

  it('renders the collapsible MCP docs (moved from Settings in PR 40)', () => {
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    expect(screen.getByText(/how to connect an mcp agent/i)).toBeInTheDocument();
  });

  it('shows the empty-state CTA when no agents exist', () => {
    render(
      <AgentDashboardView
        aggregate={{ ...AGG, activeAgentCount: 0 }}
        agents={[]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    expect(screen.getByTestId('agents-empty-state')).toBeInTheDocument();
  });

  it('renders one row per agent with scope badges + last-used + counts', () => {
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[
          agent({
            tokenId: 't-alice',
            name: 'alice',
            scopes: ['mail:read', 'mail:send'],
            lastUsedAt: '2026-06-06T11:00:00Z',
            actionsInWindow: 3,
            commitsInWindow: 2,
            dryRunsInWindow: 1,
            totalActions: 12,
          }),
          agent({
            tokenId: 't-bob',
            name: 'bob',
            scopes: ['mail:read'],
          }),
        ]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    expect(screen.getByTestId('agent-row-t-alice')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-t-bob')).toBeInTheDocument();
    expect(screen.getByText(/2 commit, 1 dry/)).toBeInTheDocument();
    const bobRow = screen.getByTestId('agent-row-t-bob');
    expect(bobRow.textContent).toContain('—');
  });

  it('shows a Revoked badge for revoked tokens and dims the row', () => {
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[
          agent({ tokenId: 't-zomb', name: 'zombie', revoked: true }),
        ]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    expect(screen.getByText(/revoked/i)).toBeInTheDocument();
  });

  it('shows an Expired badge for tokens past their expiry', () => {
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[
          agent({
            tokenId: 't-old',
            name: 'old',
            expiresAt: '2020-01-01T00:00:00Z',
          }),
        ]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    // PR 50 — both the Status badge ("Expired") and the Expires
    // column ("expired") match /expired/i, so narrow to the badge
    // by case-sensitive match on its uppercase label.
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('expired')).toBeInTheDocument();
  });

  it('wires onViewActivity to the per-row Activity link with the agent name', () => {
    const onViewActivity = vi.fn();
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[agent({ tokenId: 't-alice', name: 'alice' })]}
        onViewActivity={onViewActivity}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    fireEvent.click(screen.getByTestId('view-activity-t-alice'));
    expect(onViewActivity).toHaveBeenCalledWith('alice');
  });

  it('Revoke button opens a confirm dialog and calls onRevoke on confirm', async () => {
    const onRevoke = vi.fn(noopRevoke);
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[agent({ tokenId: 't-rev', name: 'doomed' })]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={onRevoke}
      />,
    );
    const row = screen.getByTestId('agent-row-t-rev');
    fireEvent.click(within(row).getByRole('button', { name: /^Revoke doomed/ }));
    // Dialog open — its own "Revoke" button is the destructive one.
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Revoke$/ }));
    expect(onRevoke).toHaveBeenCalledWith('t-rev');
  });

  it('Revoke button is absent on already-revoked rows', () => {
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[agent({ tokenId: 't-z', name: 'zombie', revoked: true })]}
        onViewActivity={() => {}}
        onIssue={noopIssue}
        onRevoke={noopRevoke}
      />,
    );
    const row = screen.getByTestId('agent-row-t-z');
    expect(within(row).queryByRole('button', { name: /^Revoke zombie/ })).toBeNull();
  });
});
