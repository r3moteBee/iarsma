/**
 * useAgentDashboard — derives the Agents view from the action-log
 * chain + issued-token list (Phase 4 #9, PR 38).
 *
 * Pure derivation: takes the raw action-log entries and the set of
 * issued tokens and produces both aggregate metrics (active agent
 * count, action volume, dry-run rate) and per-agent rollups (last
 * used, action count, dry-run count, commit count).
 *
 * The dashboard intentionally re-reads the same `actionLog` store
 * `useActivityLog` already polls — we don't want a second polling
 * loop. App-level wiring passes the entries down to avoid the
 * duplicate fetch.
 */

import { useMemo } from 'react';

import type { StoredEntry } from './action-log.js';
import type { AgentTokenInfo } from './agent-token-issuer.js';

// ── Types ─────────────────────────────────────────────────────────

export type AgentDashboardEntry = {
  readonly tokenId: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revoked: boolean;
  /** Most recent action-log entry attributed to this agent, ISO 8601. */
  readonly lastUsedAt?: string;
  /** Total action-log entries attributed to this agent (all time). */
  readonly totalActions: number;
  /** Subset of totalActions that landed inside the active window. */
  readonly actionsInWindow: number;
  /** Commits (mode='commit' or unset) within the active window. */
  readonly commitsInWindow: number;
  /** Dry-runs (mode='preview') within the active window. */
  readonly dryRunsInWindow: number;
};

export type AgentDashboardAggregate = {
  /** Tokens with revoked=false. Doesn't subtract expired ones — the
   *  table column shows status, the aggregate keeps the count
   *  intuitive ("how many agents do I have"). */
  readonly activeAgentCount: number;
  /** Tokens with revoked=true. */
  readonly revokedAgentCount: number;
  /** Sum of agent-attributed action-log entries inside the window. */
  readonly totalActionsInWindow: number;
  /** Sum of dry-runs inside the window. */
  readonly dryRunsInWindow: number;
  /** Sum of commits inside the window. */
  readonly commitsInWindow: number;
  /** The window the metrics cover, in hours (e.g. 24). */
  readonly windowHours: number;
};

export type UseAgentDashboardResult = {
  readonly aggregate: AgentDashboardAggregate;
  readonly agents: readonly AgentDashboardEntry[];
};

export type UseAgentDashboardOptions = {
  readonly tokens: readonly AgentTokenInfo[];
  readonly entries: readonly StoredEntry[];
  /** Window for "recent" metrics, in hours. Default 24. */
  readonly windowHours?: number;
  /** Override clock for tests. Returns epoch ms. */
  readonly now?: () => number;
};

const DEFAULT_WINDOW_HOURS = 24;

// ── Hook ──────────────────────────────────────────────────────────

export function useAgentDashboard(
  opts: UseAgentDashboardOptions,
): UseAgentDashboardResult {
  const { tokens, entries } = opts;
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const nowFn = opts.now;

  return useMemo(() => {
    const now = nowFn !== undefined ? nowFn() : Date.now();
    const windowStartMs = now - windowHours * 60 * 60 * 1000;

    // First pass: index agent-attributed entries by tokenId.
    type PerToken = {
      lastUsedMs?: number;
      total: number;
      inWindow: number;
      commits: number;
      dryRuns: number;
    };
    const byToken = new Map<string, PerToken>();

    let totalInWindow = 0;
    let dryRunsInWindow = 0;
    let commitsInWindow = 0;

    for (const e of entries) {
      const tokenId = e.data.agentTokenId;
      if (tokenId === undefined) continue;
      const ts = e.data.timestampMs;
      let bucket = byToken.get(tokenId);
      if (bucket === undefined) {
        bucket = { total: 0, inWindow: 0, commits: 0, dryRuns: 0 };
        byToken.set(tokenId, bucket);
      }
      bucket.total += 1;
      if (bucket.lastUsedMs === undefined || ts > bucket.lastUsedMs) {
        bucket.lastUsedMs = ts;
      }
      if (ts >= windowStartMs) {
        bucket.inWindow += 1;
        totalInWindow += 1;
        if (e.data.mode === 'preview') {
          bucket.dryRuns += 1;
          dryRunsInWindow += 1;
        } else {
          bucket.commits += 1;
          commitsInWindow += 1;
        }
      }
    }

    // Second pass: join token metadata. Iterate tokens (not byToken)
    // so freshly-issued tokens with no activity still appear.
    const agents: AgentDashboardEntry[] = tokens.map((t) => {
      const bucket = byToken.get(t.tokenId);
      const lastUsedAt =
        bucket?.lastUsedMs !== undefined
          ? new Date(bucket.lastUsedMs).toISOString()
          : undefined;
      return {
        tokenId: t.tokenId,
        name: t.name,
        scopes: t.scopes,
        issuedAt: t.issuedAt,
        expiresAt: t.expiresAt,
        revoked: t.revoked,
        ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
        totalActions: bucket?.total ?? 0,
        actionsInWindow: bucket?.inWindow ?? 0,
        commitsInWindow: bucket?.commits ?? 0,
        dryRunsInWindow: bucket?.dryRuns ?? 0,
      };
    });

    // Stable ordering: most-recently-active first; never-used tokens
    // fall to the end ordered by issuance (newest first).
    agents.sort((a, b) => {
      const aLast = a.lastUsedAt ?? '';
      const bLast = b.lastUsedAt ?? '';
      if (aLast !== bLast) return bLast.localeCompare(aLast);
      return b.issuedAt.localeCompare(a.issuedAt);
    });

    const activeAgentCount = tokens.filter((t) => !t.revoked).length;
    const revokedAgentCount = tokens.length - activeAgentCount;

    const aggregate: AgentDashboardAggregate = {
      activeAgentCount,
      revokedAgentCount,
      totalActionsInWindow: totalInWindow,
      dryRunsInWindow,
      commitsInWindow,
      windowHours,
    };

    return { aggregate, agents };
  }, [tokens, entries, windowHours, nowFn]);
}
