/**
 * AgentDashboardView — single surface for agent observability +
 * lifecycle (Phase 4 #9 / PR 38; consolidated with token issuance
 * + revoke in PR 40).
 *
 * Layout (top → bottom):
 *   1. Aggregate cards (active count, actions / commits / dry-runs
 *      in last 24h).
 *   2. Collapsible MCP connection docs.
 *   3. Issue-new-token form.
 *   4. Per-agent table — scopes, status, last-used, in-window
 *      action counts, Activity link, Revoke button.
 *
 * Pure presentational; the only state it manages is the per-row
 * Revoke confirm dialog. Aggregate metrics + agent rollups arrive
 * pre-derived from `useAgentDashboard`.
 */

import { useState, type ReactNode } from 'react';
import { Badge } from '../components/badge.js';
import { Button } from '../components/button.js';
import { Dialog } from '../components/dialog.js';
import type { IssuedToken } from '../runtime/agent-token-issuer.js';
import type {
  AgentDashboardAggregate,
  AgentDashboardEntry,
} from '../runtime/use-agent-dashboard.js';
import { IssueTokenForm, McpConnectionDocs } from './agent-settings-view.js';
import styles from './agent-dashboard-view.module.css';

// ── Props ─────────────────────────────────────────────────────────

export type AgentDashboardViewProps = {
  readonly aggregate: AgentDashboardAggregate;
  readonly agents: readonly AgentDashboardEntry[];
  /** Pre-filter Activity by this agent's name + navigate to it. */
  readonly onViewActivity: (agentName: string) => void;
  /** Issue a new agent token (resolves to the secret payload). */
  readonly onIssue: (
    name: string,
    scopes: readonly string[],
    lifetimeSec: number,
  ) => Promise<IssuedToken>;
  /** Revoke an existing agent token by id. */
  readonly onRevoke: (tokenId: string) => Promise<void>;
};

// ── Component ─────────────────────────────────────────────────────

export function AgentDashboardView({
  aggregate,
  agents,
  onViewActivity,
  onIssue,
  onRevoke,
}: AgentDashboardViewProps) {
  return (
    <section className={styles.dashboard} aria-labelledby="agents-heading">
      <header className={styles.header}>
        <h1 id="agents-heading">Agents</h1>
      </header>

      <p className={styles.lede}>
        Issue, revoke, and audit the agents authorized against this
        mailbox. Token records live in Stalwart, so this list and the
        Revoke buttons work from any device you sign in on.
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

      <McpConnectionDocs />
      <IssueTokenForm onIssue={onIssue} />

      {/* Per-agent table. Empty state when the user hasn't issued any. */}
      {agents.length === 0 ? (
        <div className={styles.empty} data-testid="agents-empty-state">
          <p>No agent tokens issued yet — use the form above to create one.</p>
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
                <AgentRow
                  key={a.tokenId}
                  agent={a}
                  onViewActivity={onViewActivity}
                  onRevoke={onRevoke}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Per-row component (owns its revoke confirm-dialog state) ─────

function AgentRow({
  agent: a,
  onViewActivity,
  onRevoke,
}: {
  readonly agent: AgentDashboardEntry;
  readonly onViewActivity: (agentName: string) => void;
  readonly onRevoke: (tokenId: string) => Promise<void>;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const closeConfirm = (): void => {
    if (revoking) return;
    setConfirmOpen(false);
  };

  const handleRevoke = async (): Promise<void> => {
    setRevoking(true);
    try {
      await onRevoke(a.tokenId);
      setConfirmOpen(false);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <tr
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
        {!a.revoked ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              aria-label={`Revoke ${a.name}`}
            >
              Revoke
            </Button>
            <Dialog
              open={confirmOpen}
              onClose={closeConfirm}
              title="Revoke token?"
              footer={
                <>
                  <Button variant="secondary" onClick={closeConfirm} disabled={revoking}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      void handleRevoke();
                    }}
                    disabled={revoking}
                  >
                    {revoking ? 'Revoking…' : 'Revoke'}
                  </Button>
                </>
              }
            >
              <p>
                Revoke the <strong>{a.name}</strong> token? Agents
                using it will start getting 401s within a few seconds.
                This can't be undone.
              </p>
            </Dialog>
          </>
        ) : null}
      </td>
    </tr>
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
