/**
 * AgentDashboardView — top-level "Agents" surface (Phase 4 #9 / PR 38).
 *
 * Pure presentational; consumes pre-derived metrics from
 * `useAgentDashboard`. Issue + revoke flows stay in Settings → Agent
 * tokens; this view is observability — what each agent is doing,
 * when it last ran, and which ones haven't done anything.
 *
 * The kill-switch button is a navigation shortcut to Settings (the
 * actual revoke confirmation dialog lives there). Filtering Activity
 * by agent is one click — pre-sets the actor filter and navigates in.
 */

import type { ReactNode } from 'react';
import { Badge } from '../components/badge.js';
import { Button } from '../components/button.js';
import type {
  AgentDashboardAggregate,
  AgentDashboardEntry,
} from '../runtime/use-agent-dashboard.js';
import styles from './agent-dashboard-view.module.css';

// ── Props ─────────────────────────────────────────────────────────

export type AgentDashboardViewProps = {
  readonly aggregate: AgentDashboardAggregate;
  readonly agents: readonly AgentDashboardEntry[];
  /** Navigate to Settings → Agent tokens for revoke / issue flows. */
  readonly onManageTokens: () => void;
  /** Pre-filter Activity by this agent's name + navigate to it. */
  readonly onViewActivity: (agentName: string) => void;
};

// ── Component ─────────────────────────────────────────────────────

export function AgentDashboardView({
  aggregate,
  agents,
  onManageTokens,
  onViewActivity,
}: AgentDashboardViewProps) {
  return (
    <section className={styles.dashboard} aria-labelledby="agents-heading">
      <header className={styles.header}>
        <h1 id="agents-heading">Agents</h1>
        <button
          type="button"
          className={styles.manageButton}
          onClick={onManageTokens}
          data-testid="manage-tokens-button"
        >
          Manage tokens
        </button>
      </header>

      <p className={styles.lede}>
        Observability for the agents currently authorized against this
        mailbox. Issue or revoke tokens under{' '}
        <strong>Settings → Agent tokens</strong>.
      </p>

      {/* Aggregate metrics — large readable numbers, no chart yet. */}
      <div className={styles.aggregateGrid} aria-label="Aggregate metrics">
        <AggregateCard
          label="Active agents"
          value={aggregate.activeAgentCount}
          {...(aggregate.revokedAgentCount > 0
            ? { hint: `${aggregate.revokedAgentCount} revoked` }
            : {})}
        />
        <AggregateCard
          label={`Actions (last ${aggregate.windowHours}h)`}
          value={aggregate.totalActionsInWindow}
        />
        <AggregateCard
          label={`Commits (last ${aggregate.windowHours}h)`}
          value={aggregate.commitsInWindow}
        />
        <AggregateCard
          label={`Dry-runs (last ${aggregate.windowHours}h)`}
          value={aggregate.dryRunsInWindow}
        />
      </div>

      {/* Per-agent table. Empty state when the user hasn't issued any. */}
      {agents.length === 0 ? (
        <div className={styles.empty} data-testid="agents-empty-state">
          <p>No agent tokens issued yet.</p>
          <Button onClick={onManageTokens}>Issue your first token</Button>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.agentTable} aria-label="Agents">
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Scopes</th>
                <th scope="col">Status</th>
                <th scope="col">Last used</th>
                <th scope="col" className={styles.numericCol}>
                  Actions (24h)
                </th>
                <th scope="col" className={styles.numericCol}>
                  Total
                </th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr
                  key={a.tokenId}
                  data-testid={`agent-row-${a.tokenId}`}
                  className={a.revoked ? styles.revokedRow : undefined}
                >
                  <td>
                    <span className={styles.agentName}>{a.name}</span>
                    <span className={styles.tokenIdHint} title={a.tokenId}>
                      {shortId(a.tokenId)}
                    </span>
                  </td>
                  <td>
                    <ul className={styles.scopeList}>
                      {a.scopes.map((s) => (
                        <li key={s}>
                          <Badge variant="scope" color="neutral">{s}</Badge>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{statusFor(a)}</td>
                  <td>{a.lastUsedAt !== undefined ? formatTimestamp(a.lastUsedAt) : '—'}</td>
                  <td className={styles.numericCol}>
                    {a.actionsInWindow}
                    {a.actionsInWindow > 0 ? (
                      <span className={styles.commitSplit}>
                        {' '}({a.commitsInWindow} commit, {a.dryRunsInWindow} dry)
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.numericCol}>{a.totalActions}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.activityLink}
                      onClick={() => onViewActivity(a.name)}
                      aria-label={`View activity for ${a.name}`}
                      data-testid={`view-activity-${a.tokenId}`}
                    >
                      Activity →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function AggregateCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly hint?: string;
}) {
  return (
    <div className={styles.aggregateCard}>
      <div className={styles.aggregateValue}>{value}</div>
      <div className={styles.aggregateLabel}>{label}</div>
      {hint !== undefined ? (
        <div className={styles.aggregateHint}>{hint}</div>
      ) : null}
    </div>
  );
}

function statusFor(a: AgentDashboardEntry): ReactNode {
  if (a.revoked) {
    return <Badge variant="status" color="warning">Revoked</Badge>;
  }
  const expiresMs = Date.parse(a.expiresAt);
  if (!Number.isNaN(expiresMs) && expiresMs < Date.now()) {
    return <Badge variant="status" color="warning">Expired</Badge>;
  }
  return <Badge variant="status" color="accent">Active</Badge>;
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
