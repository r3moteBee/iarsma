/**
 * @vitest-environment jsdom
 *
 * Tests for AgentDashboardView (PR 38).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentDashboardView } from '../agent-dashboard-view.js';
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

afterEach(cleanup);

describe('AgentDashboardView', () => {
  it('renders aggregate cards with the window hours in the label', () => {
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[]}
        onManageTokens={() => {}}
        onViewActivity={() => {}}
      />,
    );
    expect(screen.getByText(/active agents/i)).toBeInTheDocument();
    expect(screen.getByText(/actions \(last 24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/commits \(last 24h\)/i)).toBeInTheDocument();
    expect(screen.getByText(/dry-runs \(last 24h\)/i)).toBeInTheDocument();
    // Numeric values render in their own .aggregateValue divs — the
    // exact-text selector returns one match per number.
    expect(screen.getByText('5')).toBeInTheDocument(); // totalActions
    expect(screen.getByText('3')).toBeInTheDocument(); // commits
  });

  it('shows the empty-state CTA when no agents exist', () => {
    render(
      <AgentDashboardView
        aggregate={{ ...AGG, activeAgentCount: 0 }}
        agents={[]}
        onManageTokens={() => {}}
        onViewActivity={() => {}}
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
        onManageTokens={() => {}}
        onViewActivity={() => {}}
      />,
    );
    expect(screen.getByTestId('agent-row-t-alice')).toBeInTheDocument();
    expect(screen.getByTestId('agent-row-t-bob')).toBeInTheDocument();
    // Alice has activity → her count + per-row split appears.
    expect(screen.getByText(/2 commit, 1 dry/)).toBeInTheDocument();
    // Bob has no activity → "—" rendered for last-used.
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
        onManageTokens={() => {}}
        onViewActivity={() => {}}
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
        onManageTokens={() => {}}
        onViewActivity={() => {}}
      />,
    );
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it('wires onManageTokens to the Manage tokens button', () => {
    const onManageTokens = vi.fn();
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[]}
        onManageTokens={onManageTokens}
        onViewActivity={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('manage-tokens-button'));
    expect(onManageTokens).toHaveBeenCalledTimes(1);
  });

  it('wires onViewActivity to the per-row Activity link with the agent name', () => {
    const onViewActivity = vi.fn();
    render(
      <AgentDashboardView
        aggregate={AGG}
        agents={[agent({ tokenId: 't-alice', name: 'alice' })]}
        onManageTokens={() => {}}
        onViewActivity={onViewActivity}
      />,
    );
    fireEvent.click(screen.getByTestId('view-activity-t-alice'));
    expect(onViewActivity).toHaveBeenCalledWith('alice');
  });
});
