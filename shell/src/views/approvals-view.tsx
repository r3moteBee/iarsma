/**
 * ApprovalsView — approval queue UI for agent tool-use requests.
 *
 * PR 6: the per-row card lives in the shared `PreviewCard` component
 * (also used by Compose's send-preview modal). This view is now just
 * the surrounding chrome — heading, tab filter, list spacing — plus
 * a tool-specific preview formatter that turns structured previews
 * (e.g. `files.propose_write`'s unified diff) into a readable body
 * block. Unknown tools fall back to the raw-JSON disclosure.
 *
 * Purely presentational — side-effect work (approve/deny network
 * calls) is delegated to callback props.
 */

import { useState, type ReactNode } from 'react';
import { PreviewCard } from '../components/preview-card.js';
import styles from './approvals-view.module.css';

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

// ── Tool-specific preview formatters ──────────────────────────────

/**
 * Turn a structured preview into a readable body block when we know
 * the tool's shape. Returns null for unknown tools so the caller
 * falls back to the raw-JSON disclosure.
 */
function formatPreviewBody(toolName: string, preview: unknown): ReactNode | null {
  if (toolName === 'files.propose_write' && isFilesProposeWritePreview(preview)) {
    const isCreate = preview.diff.isCreate === true;
    return (
      <>
        <p style={{ margin: '0 0 var(--space-sm)' }}>
          {isCreate ? 'Create ' : 'Edit '}
          <code style={{ fontFamily: 'ui-monospace, monospace' }}>{preview.path}</code>
        </p>
        <pre
          data-testid="approval-diff"
          style={{
            margin: 0,
            padding: 'var(--space-sm) var(--space-md)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: '12px',
            overflow: 'auto',
            maxHeight: '18em',
            whiteSpace: 'pre',
          }}
        >
          {preview.diff.unified}
        </pre>
      </>
    );
  }
  return null;
}

type FilesProposeWritePreview = {
  readonly path: string;
  readonly diff: {
    readonly unified: string;
    readonly baseSha: string;
    readonly isCreate?: boolean;
    readonly isBinary?: boolean;
  };
};

function isFilesProposeWritePreview(v: unknown): v is FilesProposeWritePreview {
  if (v === null || typeof v !== 'object') return false;
  const o = v as { path?: unknown; diff?: unknown };
  if (typeof o.path !== 'string') return false;
  if (o.diff === null || typeof o.diff !== 'object') return false;
  const d = o.diff as { unified?: unknown; baseSha?: unknown };
  return typeof d.unified === 'string' && typeof d.baseSha === 'string';
}

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
    <section aria-labelledby="approvals-heading" className={styles['section']}>
      <h2 id="approvals-heading" className={styles['heading']}>
        Approvals
      </h2>
      {isLoading === true ? (
        <p className={styles['loading']}>Loading approvals...</p>
      ) : null}

      <nav aria-label="Approval status filter" className={styles['tabs']}>
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

      {approvals.length === 0 ? (
        <p className={styles['empty']}>No approval history yet.</p>
      ) : filtered.length === 0 ? (
        <p className={styles['empty']}>
          No pending approvals. Agents that require approval will appear here.
        </p>
      ) : (
        <div role="list" aria-label="Approval requests" className={styles['list']}>
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
  const cls = `${styles['tab']} ${isActive ? styles['tabActive'] : ''}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cls}
    >
      {label}
      {count !== undefined && count > 0 ? (
        <span className={styles['tabCount']}>{count}</span>
      ) : null}
    </button>
  );
}

function ApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  readonly approval: ApprovalCardData;
  readonly onApprove: (id: string) => Promise<void>;
  readonly onDeny: (id: string) => Promise<void>;
}) {
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

  const structuredBody = formatPreviewBody(approval.toolName, approval.preview);
  const showRawDisclosure = structuredBody === null;

  return (
    <div role="listitem" data-testid={`approval-card-${approval.id}`}>
      <PreviewCard
        title={approval.summary}
        actor={{ name: approval.agentName, kind: 'agent' }}
        badges={[approval.toolName]}
        meta={relativeTime(approval.requestedAt)}
        body={structuredBody ?? undefined}
        rawPreview={showRawDisclosure ? approval.preview : undefined}
        primary={{
          label: 'Approve',
          onClick: () => void handleApprove(),
          disabled: acting,
        }}
        secondary={{
          label: 'Deny',
          onClick: () => void handleDeny(),
          disabled: acting,
          intent: 'destructive',
        }}
        status={approval.status}
      />
    </div>
  );
}
