/**
 * @vitest-environment jsdom
 *
 * Tests for useAgentDashboard — pure-deriving hook (PR 38).
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StoredEntry } from '../action-log.js';
import type { AgentTokenInfo } from '../agent-token-issuer.js';
import { useAgentDashboard } from '../use-agent-dashboard.js';

// ── Fixtures ──────────────────────────────────────────────────────

const NOW_MS = Date.parse('2026-06-06T12:00:00Z');
const fixedNow = () => NOW_MS;

function tok(over: Partial<AgentTokenInfo>): AgentTokenInfo {
  return {
    tokenId: 't1',
    name: 'agent-1',
    scopes: ['mail:read'],
    issuedAt: '2026-06-01T00:00:00Z',
    expiresAt: '2027-06-01T00:00:00Z',
    revoked: false,
    ...over,
  };
}

function entry(over: {
  seq: number;
  tokenId?: string;
  callerClass?: 'ui' | 'agent' | 'mcp' | 'library';
  mode?: 'preview' | 'commit';
  hoursAgo?: number;
  action?: string;
}): StoredEntry {
  const hoursAgo = over.hoursAgo ?? 0;
  return {
    seq: over.seq,
    hashHex: `hash${over.seq}`,
    prevHashHex: over.seq === 1 ? '0'.repeat(64) : `hash${over.seq - 1}`,
    data: {
      timestampMs: NOW_MS - hoursAgo * 60 * 60 * 1000,
      callerClass: over.callerClass ?? 'agent',
      identity: 'brent@example.test',
      ...(over.tokenId !== undefined ? { agentTokenId: over.tokenId } : {}),
      action: over.action ?? 'mail.send',
      ...(over.mode !== undefined ? { mode: over.mode } : {}),
      paramsJson: '{}',
    } as StoredEntry['data'],
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('useAgentDashboard — aggregate', () => {
  it('counts active vs revoked tokens; never-used tokens still appear', () => {
    const { result } = renderHook(() =>
      useAgentDashboard({
        tokens: [
          tok({ tokenId: 'a', name: 'alice' }),
          tok({ tokenId: 'b', name: 'bob', revoked: true }),
          tok({ tokenId: 'c', name: 'carol' }),
        ],
        entries: [],
        now: fixedNow,
      }),
    );
    expect(result.current.aggregate.activeAgentCount).toBe(2);
    expect(result.current.aggregate.revokedAgentCount).toBe(1);
    expect(result.current.agents).toHaveLength(3);
    for (const a of result.current.agents) {
      expect(a.totalActions).toBe(0);
      expect(a.actionsInWindow).toBe(0);
      expect(a.lastUsedAt).toBeUndefined();
    }
  });

  it('rolls up actions inside the window and splits commit/preview', () => {
    const tokens = [tok({ tokenId: 'a', name: 'alice' })];
    const entries = [
      entry({ seq: 1, tokenId: 'a', mode: 'commit', hoursAgo: 1 }),
      entry({ seq: 2, tokenId: 'a', mode: 'preview', hoursAgo: 2 }),
      entry({ seq: 3, tokenId: 'a', mode: 'commit', hoursAgo: 5 }),
      // Outside the 24h window — counted in totalActions, not actionsInWindow.
      entry({ seq: 4, tokenId: 'a', mode: 'commit', hoursAgo: 30 }),
    ];
    const { result } = renderHook(() =>
      useAgentDashboard({ tokens, entries, now: fixedNow }),
    );
    const agent = result.current.agents[0]!;
    expect(agent.totalActions).toBe(4);
    expect(agent.actionsInWindow).toBe(3);
    expect(agent.commitsInWindow).toBe(2);
    expect(agent.dryRunsInWindow).toBe(1);
    expect(result.current.aggregate.totalActionsInWindow).toBe(3);
    expect(result.current.aggregate.commitsInWindow).toBe(2);
    expect(result.current.aggregate.dryRunsInWindow).toBe(1);
  });

  it('attributes per tokenId, not per actor name', () => {
    const tokens = [
      tok({ tokenId: 'a', name: 'alice' }),
      tok({ tokenId: 'b', name: 'bob' }),
    ];
    const entries = [
      entry({ seq: 1, tokenId: 'a', hoursAgo: 1 }),
      entry({ seq: 2, tokenId: 'a', hoursAgo: 2 }),
      entry({ seq: 3, tokenId: 'b', hoursAgo: 1 }),
    ];
    const { result } = renderHook(() =>
      useAgentDashboard({ tokens, entries, now: fixedNow }),
    );
    const alice = result.current.agents.find((a) => a.name === 'alice')!;
    const bob = result.current.agents.find((a) => a.name === 'bob')!;
    expect(alice.actionsInWindow).toBe(2);
    expect(bob.actionsInWindow).toBe(1);
  });

  it('ignores entries with no agentTokenId (UI/manual actions)', () => {
    const tokens = [tok({ tokenId: 'a' })];
    const entries = [
      entry({ seq: 1, callerClass: 'ui', hoursAgo: 1 }),
      entry({ seq: 2, tokenId: 'a', hoursAgo: 1 }),
    ];
    const { result } = renderHook(() =>
      useAgentDashboard({ tokens, entries, now: fixedNow }),
    );
    expect(result.current.aggregate.totalActionsInWindow).toBe(1);
    expect(result.current.agents[0]!.actionsInWindow).toBe(1);
  });
});

describe('useAgentDashboard — ordering', () => {
  it('sorts by most-recently-used; never-used tokens fall to the end by issuance', () => {
    const tokens = [
      tok({ tokenId: 'a', name: 'alice', issuedAt: '2026-06-01T00:00:00Z' }),
      tok({ tokenId: 'b', name: 'bob', issuedAt: '2026-06-05T00:00:00Z' }),
      tok({ tokenId: 'c', name: 'carol', issuedAt: '2026-06-03T00:00:00Z' }),
    ];
    const entries = [
      entry({ seq: 1, tokenId: 'a', hoursAgo: 10 }),
      entry({ seq: 2, tokenId: 'c', hoursAgo: 1 }),
      // bob has no activity.
    ];
    const { result } = renderHook(() =>
      useAgentDashboard({ tokens, entries, now: fixedNow }),
    );
    const names = result.current.agents.map((a) => a.name);
    // carol (most recent) → alice (used but older) → bob (never used, newest issued)
    expect(names).toEqual(['carol', 'alice', 'bob']);
  });
});

describe('useAgentDashboard — window', () => {
  it('honors a custom windowHours', () => {
    const tokens = [tok({ tokenId: 'a' })];
    const entries = [
      entry({ seq: 1, tokenId: 'a', hoursAgo: 0.5 }),
      entry({ seq: 2, tokenId: 'a', hoursAgo: 5 }),
    ];
    const { result } = renderHook(() =>
      useAgentDashboard({ tokens, entries, windowHours: 1, now: fixedNow }),
    );
    // 1-hour window: only the 0.5h-old entry counts.
    expect(result.current.aggregate.totalActionsInWindow).toBe(1);
    expect(result.current.aggregate.windowHours).toBe(1);
  });
});
