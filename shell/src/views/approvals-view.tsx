/**
 * ApprovalsView — approval queue UI for agent tool-use requests.
 *
 * Single-column list of approval cards with tab filtering (Pending,
 * Approved, Denied, All). Each card displays the agent name, tool name
 * badge, relative timestamp, summary, an expandable JSON preview, and
 * approve/deny action buttons (pending items only).
 *
 * Purely presentational — side-effect work (approve/deny network calls)
 * is delegated to callback props.
 */

import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────

export type ApprovalCardData = {
  readonly id: string;
  readonly toolName: string;
  readonly agentName: string;
  readonly summary: string;
  readonly requestedAt: string;
  readonly status: 'pending' | 'approved' | 'denied';
  readonly preview: unknown;
  readonly params: unknown;
};

export type ApprovalsViewProps = {
  readonly approvals: readonly ApprovalCardData[];
  readonly onApprove: (id: string) => Promise<void>;
  readonly onDeny: (id: string) => Promise<void>;
  readonly isLoading?: boolean;
  readonly pendingCount?: number;
};

type TabFilter = 'pending' | 'approved' | 'denied' | 'all';

// ── Relative timestamp helper ─────────────────────────────────────

function relativeTime(iso: string): string {
  const now = Date.now();
  let then: number;
  try {
    then = new Date(iso).getTime();
  } catch {
    return iso;
  }
  if (Number.isNaN(then)) return iso;

  const diffMs = now - then;
  if (diffMs < 0) return iso;

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return '1 min ago';
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return '1 hour ago';
  if (diffHr < 24) return `${diffHr} hours ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';

  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

// ── Styles ────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--surface-3)',
  borderRadius: 4,
  padding: '0.75em 1em',
  marginBottom: '0.5em',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.1em 0.45em',
  borderRadius: 3,
  fontSize: '0.85em',
  background: 'var(--surface-3)',
  color: 'var(--text-1)',
  marginLeft: '0.5em',
};

const countBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0 0.45em',
  borderRadius: '0.75em',
  fontSize: '0.8em',
  background: 'var(--surface-3)',
  color: 'var(--text-1)',
  marginLeft: '0.35em',
  fontWeight: 600,
};

const approveButtonStyle: React.CSSProperties = {
  padding: '0.25em 0.7em',
  font: 'inherit',
  border: '1px solid var(--success)',
  borderRadius: 4,
  background: 'color-mix(in srgb, var(--success) 15%, transparent)',
  color: 'var(--success)',
  cursor: 'pointer',
  marginRight: '0.4em',
};

const denyButtonStyle: React.CSSProperties = {
  padding: '0.25em 0.7em',
  font: 'inherit',
  border: '1px solid var(--destructive)',
  borderRadius: 4,
  background: 'color-mix(in srgb, var(--destructive) 15%, transparent)',
  color: 'var(--destructive)',
  cursor: 'pointer',
};

// ── Component ─────────────────────────────────────────────────────

export function ApprovalsView({
  approvals,
  onApprove,
  onDeny,
  isLoading,
  pendingCount,
}: ApprovalsViewProps) {
  const [activeTab, setActiveTab] = useState<TabFilter>('pending');

  const filtered =
    activeTab === 'all'
      ? approvals
      : approvals.filter((a) => a.status === activeTab);

  const effectivePendingCount =
    pendingCount ?? approvals.filter((a) => a.status === 'pending').length;

  return (
    <section aria-labelledby="approvals-heading" style={{ maxWidth: '56em' }}>
      <h2 id="approvals-heading">Approvals</h2>
      {isLoading === true ? <p>Loading approvals...</p> : null}

      {/* Tab bar */}
      <nav
        aria-label="Approval status filter"
        style={{ display: 'flex', gap: '0.25em', marginBottom: '1em' }}
      >
        <TabButton
          label="Pending"
          count={effectivePendingCount}
          isActive={activeTab === 'pending'}
          onClick={() => setActiveTab('pending')}
        />
        <TabButton
          label="Approved"
          isActive={activeTab === 'approved'}
          onClick={() => setActiveTab('approved')}
        />
        <TabButton
          label="Denied"
          isActive={activeTab === 'denied'}
          onClick={() => setActiveTab('denied')}
        />
        <TabButton
          label="All"
          isActive={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
        />
      </nav>

      {/* List or empty state */}
      {approvals.length === 0 ? (
        <p style={{ color: 'var(--text-2)' }}>No approval history yet.</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-2)' }}>
          No pending approvals. Agents that require approval will appear here.
        </p>
      ) : (
        <div role="list" aria-label="Approval requests">
          {filtered.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Tab button ────────────────────────────────────────────────────

function TabButton({
  label,
  count,
  isActive,
  onClick,
}: {
  readonly label: string;
  readonly count?: number;
  readonly isActive: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      style={{
        padding: '0.3em 0.8em',
        font: 'inherit',
        border: 'none',
        borderBottom: isActive ? '2px solid currentColor' : '2px solid transparent',
        background: 'none',
        cursor: 'pointer',
        fontWeight: isActive ? 600 : 400,
      }}
    >
      {label}
      {count !== undefined && count > 0 ? (
        <span style={countBadgeStyle}>{count}</span>
      ) : null}
    </button>
  );
}

// ── Approval card ─────────────────────────────────────────────────

function ApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  readonly approval: ApprovalCardData;
  readonly onApprove: (id: string) => Promise<void>;
  readonly onDeny: (id: string) => Promise<void>;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [acting, setActing] = useState(false);

  const handleApprove = async () => {
    setActing(true);
    try {
      await onApprove(approval.id);
    } finally {
      setActing(false);
    }
  };

  const handleDeny = async () => {
    setActing(true);
    try {
      await onDeny(approval.id);
    } finally {
      setActing(false);
    }
  };

  return (
    <div role="listitem" style={cardStyle}>
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.5em',
          marginBottom: '0.25em',
        }}
      >
        <strong>{approval.agentName}</strong>
        <span style={badgeStyle}>{approval.toolName}</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.85em',
            color: 'var(--text-2)',
          }}
        >
          {relativeTime(approval.requestedAt)}
        </span>
      </div>

      {/* Summary */}
      <div style={{ marginBottom: '0.4em', color: 'var(--text-1)' }}>
        {approval.summary}
      </div>

      {/* Preview toggle */}
      <div style={{ marginBottom: '0.4em' }}>
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          aria-label={previewOpen ? 'Hide preview' : 'Show preview'}
          style={{
            font: 'inherit',
            fontSize: '0.85em',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-2)',
            padding: 0,
          }}
        >
          {previewOpen ? 'Hide preview' : 'Show preview'}
        </button>
        {previewOpen ? (
          <pre
            style={{
              marginTop: '0.4em',
              padding: '0.5em',
              background: 'var(--surface-2)',
              borderRadius: 4,
              fontSize: '0.85em',
              overflow: 'auto',
              maxHeight: '16em',
              color: 'var(--text-1)',
            }}
          >
            {JSON.stringify(approval.preview, null, 2)}
          </pre>
        ) : null}
      </div>

      {/* Actions (pending only) */}
      {approval.status === 'pending' ? (
        <div style={{ display: 'flex', gap: '0.4em' }}>
          <button
            type="button"
            onClick={handleApprove}
            disabled={acting}
            style={approveButtonStyle}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={handleDeny}
            disabled={acting}
            style={denyButtonStyle}
          >
            Deny
          </button>
        </div>
      ) : (
        <div
          style={{
            fontSize: '0.85em',
            fontWeight: 600,
            color: approval.status === 'approved' ? 'var(--success)' : 'var(--destructive)',
          }}
        >
          {approval.status === 'approved' ? 'Approved' : 'Denied'}
        </div>
      )}
    </div>
  );
}
