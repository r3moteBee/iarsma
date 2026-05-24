/**
 * ActivityView -- action-log UI for hash-chain integrity verification.
 *
 * Paginated, filterable table of action-log entries. Each row is
 * expandable to show full params, provenance, and hash-chain info.
 * Integrity badge shows the hash-chain verification status.
 *
 * Purely presentational -- side-effect work (verification, filtering,
 * pagination) is delegated to callback props.
 */

import { useState } from 'react';

// -- Types ---------------------------------------------------------------

export type ActivityEntry = {
  readonly seq: number;
  readonly timestamp: string; // ISO 8601
  readonly actor: string; // "You" for UI, agent name for agents
  readonly callerClass: 'ui' | 'mcp' | 'agent' | 'library';
  readonly action: string; // tool name
  readonly mode?: 'preview' | 'commit';
  readonly params: unknown;
  readonly provenance?: {
    readonly affectedJson: string;
    readonly previewHashHex: string;
  };
  readonly hashHex: string;
  readonly prevHashHex: string;
};

export type ActivityViewProps = {
  readonly entries: readonly ActivityEntry[];
  readonly isLoading?: boolean;
  readonly integrityStatus?: 'verified' | 'failed' | 'checking' | 'unchecked';
  readonly integrityError?: string;
  readonly onVerify?: () => void;
  readonly filters: {
    readonly actor: string; // 'all' | 'you' | agent name
    readonly action: string; // 'all' | tool name
    readonly mode: string; // 'all' | 'preview' | 'commit'
    readonly timeRange: string; // 'all' | 'hour' | 'today' | 'week'
  };
  readonly onFilterChange: (key: string, value: string) => void;
  readonly page: number;
  readonly pageSize: number;
  readonly totalEntries: number;
  readonly onPageChange: (page: number) => void;
};

// -- Styles --------------------------------------------------------------

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.4em 0.6em',
  borderBottom: '2px solid rgba(0,0,0,0.15)',
};

const tdStyle: React.CSSProperties = {
  padding: '0.4em 0.6em',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
};

const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '1em',
  alignItems: 'flex-end',
  flexWrap: 'wrap',
  marginBottom: '1em',
};

const filterGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.2em',
};

const selectStyle: React.CSSProperties = {
  padding: '0.3em 0.5em',
  font: 'inherit',
  border: '1px solid rgba(0,0,0,0.2)',
  borderRadius: 4,
};

const badgeBaseStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3em',
  padding: '0.2em 0.6em',
  borderRadius: 4,
  fontSize: '0.85em',
  fontWeight: 600,
};

const modeBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.1em 0.4em',
  borderRadius: 3,
  fontSize: '0.85em',
  background: 'rgba(0,0,0,0.07)',
};

const paginationStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: '1em',
  marginTop: '1em',
  padding: '0.5em 0',
};

// -- Helpers -------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function uniqueActors(entries: readonly ActivityEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    seen.add(e.actor);
  }
  return [...seen].sort();
}

function uniqueActions(entries: readonly ActivityEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    seen.add(e.action);
  }
  return [...seen].sort();
}

// -- Component -----------------------------------------------------------

export function ActivityView({
  entries,
  isLoading,
  integrityStatus,
  integrityError,
  onVerify,
  filters,
  onFilterChange,
  page,
  pageSize,
  totalEntries,
  onPageChange,
}: ActivityViewProps) {
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));

  const actors = uniqueActors(entries);
  const actions = uniqueActions(entries);

  return (
    <section aria-labelledby="activity-heading" style={{ maxWidth: '72em' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5em' }}>
        <h2 id="activity-heading" style={{ margin: 0 }}>Activity</h2>
        <IntegrityBadge
          status={integrityStatus}
          error={integrityError}
          onVerify={onVerify}
        />
      </div>

      {isLoading === true ? <p>Loading activity...</p> : null}

      {/* Filter bar */}
      <div style={filterBarStyle}>
        <div style={filterGroupStyle}>
          <label htmlFor="activity-filter-actor" style={{ fontSize: '0.85em', fontWeight: 600 }}>
            Actor
          </label>
          <select
            id="activity-filter-actor"
            value={filters.actor}
            onChange={(e) => onFilterChange('actor', e.target.value)}
            style={selectStyle}
          >
            <option value="all">All</option>
            {actors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div style={filterGroupStyle}>
          <label htmlFor="activity-filter-action" style={{ fontSize: '0.85em', fontWeight: 600 }}>
            Action
          </label>
          <select
            id="activity-filter-action"
            value={filters.action}
            onChange={(e) => onFilterChange('action', e.target.value)}
            style={selectStyle}
          >
            <option value="all">All</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div style={filterGroupStyle}>
          <label htmlFor="activity-filter-mode" style={{ fontSize: '0.85em', fontWeight: 600 }}>
            Mode
          </label>
          <select
            id="activity-filter-mode"
            value={filters.mode}
            onChange={(e) => onFilterChange('mode', e.target.value)}
            style={selectStyle}
          >
            <option value="all">All</option>
            <option value="preview">Preview</option>
            <option value="commit">Commit</option>
          </select>
        </div>

        <div style={filterGroupStyle}>
          <label htmlFor="activity-filter-timerange" style={{ fontSize: '0.85em', fontWeight: 600 }}>
            Time range
          </label>
          <select
            id="activity-filter-timerange"
            value={filters.timeRange}
            onChange={(e) => onFilterChange('timeRange', e.target.value)}
            style={selectStyle}
          >
            <option value="all">All</option>
            <option value="hour">Last hour</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
          </select>
        </div>
      </div>

      {/* Table or empty state */}
      {entries.length === 0 ? (
        <p style={{ color: 'rgba(0,0,0,0.5)' }}>No activity recorded yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={thStyle}>Timestamp</th>
              <th scope="col" style={thStyle}>Actor</th>
              <th scope="col" style={thStyle}>Action</th>
              <th scope="col" style={thStyle}>Mode</th>
              <th scope="col" style={thStyle}>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, idx) => (
              <ActivityRow key={entry.seq} entry={entry} index={idx} />
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {totalEntries > 0 ? (
        <nav aria-label="Activity pagination" style={paginationStyle}>
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}

// -- Integrity badge -----------------------------------------------------

function IntegrityBadge({
  status,
  error,
  onVerify,
}: {
  readonly status?: 'verified' | 'failed' | 'checking' | 'unchecked' | undefined;
  readonly error?: string | undefined;
  readonly onVerify?: (() => void) | undefined;
}) {
  if (status === 'verified') {
    return (
      <span
        style={{
          ...badgeBaseStyle,
          background: '#eafaf1',
          color: '#1e8449',
          border: '1px solid #27ae60',
        }}
        role="status"
      >
        &#10003; Verified
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span
        style={{
          ...badgeBaseStyle,
          background: '#fdedec',
          color: '#922b21',
          border: '1px solid #c0392b',
        }}
        role="alert"
      >
        &#10007; Failed{error !== undefined ? `: ${error}` : ''}
      </span>
    );
  }

  if (status === 'checking') {
    return (
      <span
        style={{
          ...badgeBaseStyle,
          background: '#fef9e7',
          color: '#7d6608',
          border: '1px solid #f1c40f',
        }}
        role="status"
      >
        Checking...
      </span>
    );
  }

  // unchecked or undefined
  return (
    <button
      type="button"
      onClick={onVerify}
      aria-label="Verify chain"
      style={{
        padding: '0.3em 0.8em',
        font: 'inherit',
        fontSize: '0.85em',
        border: '1px solid rgba(0,0,0,0.2)',
        borderRadius: 4,
        background: 'none',
        cursor: 'pointer',
      }}
    >
      Verify chain
    </button>
  );
}

// -- Activity row --------------------------------------------------------

function ActivityRow({
  entry,
  index,
}: {
  readonly entry: ActivityEntry;
  readonly index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const bgColor = index % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)';

  return (
    <>
      <tr style={{ background: bgColor }}>
        <td style={tdStyle}>{formatTimestamp(entry.timestamp)}</td>
        <td style={tdStyle}>{entry.actor}</td>
        <td style={tdStyle}>{entry.action}</td>
        <td style={tdStyle}>
          {entry.mode !== undefined ? (
            <span style={modeBadgeStyle}>{entry.mode}</span>
          ) : (
            <span style={{ color: 'rgba(0,0,0,0.3)' }}>--</span>
          )}
        </td>
        <td style={tdStyle}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            style={{
              font: 'inherit',
              fontSize: '0.85em',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(0,0,0,0.5)',
              padding: 0,
            }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr style={{ background: bgColor }}>
          <td colSpan={5} style={{ padding: '0.5em 1em 1em 1em' }}>
            {/* Params */}
            <div style={{ marginBottom: '0.5em' }}>
              <strong style={{ fontSize: '0.85em' }}>Params:</strong>
              <pre
                style={{
                  marginTop: '0.3em',
                  padding: '0.5em',
                  background: 'rgba(0,0,0,0.03)',
                  borderRadius: 4,
                  fontSize: '0.85em',
                  overflow: 'auto',
                  maxHeight: '16em',
                }}
              >
                {JSON.stringify(entry.params, null, 2)}
              </pre>
            </div>

            {/* Provenance */}
            {entry.provenance !== undefined ? (
              <div style={{ marginBottom: '0.5em' }}>
                <strong style={{ fontSize: '0.85em' }}>Provenance:</strong>
                <div style={{ fontSize: '0.85em', marginTop: '0.2em' }}>
                  <div>
                    <span style={{ color: 'rgba(0,0,0,0.5)' }}>affectedJson:</span>{' '}
                    <code>{entry.provenance.affectedJson}</code>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(0,0,0,0.5)' }}>previewHashHex:</span>{' '}
                    <code>{entry.provenance.previewHashHex}</code>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Hash chain */}
            <div>
              <strong style={{ fontSize: '0.85em' }}>Hash chain:</strong>
              <div style={{ fontSize: '0.85em', marginTop: '0.2em' }}>
                <div>
                  <span style={{ color: 'rgba(0,0,0,0.5)' }}>seq:</span> {entry.seq}
                </div>
                <div>
                  <span style={{ color: 'rgba(0,0,0,0.5)' }}>hashHex:</span>{' '}
                  <code>{entry.hashHex}</code>
                </div>
                <div>
                  <span style={{ color: 'rgba(0,0,0,0.5)' }}>prevHashHex:</span>{' '}
                  <code>{entry.prevHashHex}</code>
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
