/**
 * ActivityView — action-log audit trail (§8.5).
 *
 * Paginated, filterable table of action-log entries. Each row is
 * expandable to show structured params, provenance, and hash chain.
 * Integrity badge announces verify result via aria-live.
 *
 * Purely presentational — side-effect work (verification, filtering,
 * pagination, fetching) is delegated to callback props.
 */

import { useState, type ReactNode } from 'react';

import { Avatar } from '../components/avatar.js';
import { Badge } from '../components/badge.js';
import { Button } from '../components/button.js';
import styles from './activity-view.module.css';

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
  for (const e of entries) seen.add(e.actor);
  return [...seen].sort();
}

function uniqueActions(entries: readonly ActivityEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) seen.add(e.action);
  return [...seen].sort();
}

function actorKindLabel(c: ActivityEntry['callerClass']): string {
  switch (c) {
    case 'ui':
      return 'human';
    case 'agent':
    case 'mcp':
      return 'agent';
    case 'library':
      return 'system';
  }
}

function actorKindColor(c: ActivityEntry['callerClass']): 'accent' | 'neutral' | 'warning' {
  if (c === 'ui') return 'accent';
  if (c === 'library') return 'neutral';
  return 'warning';
}

function modeColor(mode: 'preview' | 'commit'): 'accent' | 'neutral' {
  return mode === 'commit' ? 'accent' : 'neutral';
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
    <section
      aria-labelledby="activity-heading"
      className={styles['container']}
    >
      <div className={styles['header']}>
        <h2 id="activity-heading" className={styles['heading']}>Activity</h2>
        <IntegrityBadge
          {...(integrityStatus !== undefined ? { status: integrityStatus } : {})}
          {...(integrityError !== undefined ? { error: integrityError } : {})}
          {...(onVerify !== undefined ? { onVerify } : {})}
        />
      </div>

      {/* aria-live region for verify announcement (status pill is visual). */}
      <div className={styles['statusRegion']} aria-live="polite" role="status">
        {integrityStatus === 'verified' ? 'Chain verified.' : ''}
        {integrityStatus === 'failed'
          ? `Verification failed${integrityError !== undefined ? `: ${integrityError}` : ''}.`
          : ''}
      </div>

      {isLoading === true ? <p className={styles['muted']}>Loading activity…</p> : null}

      {/* Filter bar */}
      <div className={styles['filterBar']}>
        <div className={styles['filterField']}>
          <label htmlFor="activity-filter-actor" className={styles['filterLabel']}>
            Actor
          </label>
          <select
            id="activity-filter-actor"
            value={filters.actor}
            onChange={(e) => onFilterChange('actor', e.target.value)}
            className={styles['filterSelect']}
          >
            <option value="all">All</option>
            {actors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className={styles['filterField']}>
          <label htmlFor="activity-filter-action" className={styles['filterLabel']}>
            Action
          </label>
          <select
            id="activity-filter-action"
            value={filters.action}
            onChange={(e) => onFilterChange('action', e.target.value)}
            className={styles['filterSelect']}
          >
            <option value="all">All</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className={styles['filterField']}>
          <label htmlFor="activity-filter-mode" className={styles['filterLabel']}>
            Mode
          </label>
          <select
            id="activity-filter-mode"
            value={filters.mode}
            onChange={(e) => onFilterChange('mode', e.target.value)}
            className={styles['filterSelect']}
          >
            <option value="all">All</option>
            <option value="preview">Preview</option>
            <option value="commit">Commit</option>
          </select>
        </div>

        <div className={styles['filterField']}>
          <label htmlFor="activity-filter-timerange" className={styles['filterLabel']}>
            Time range
          </label>
          <select
            id="activity-filter-timerange"
            value={filters.timeRange}
            onChange={(e) => onFilterChange('timeRange', e.target.value)}
            className={styles['filterSelect']}
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
        <p className={styles['empty']}>No activity recorded yet.</p>
      ) : (
        <table className={styles['table']}>
          <thead>
            <tr>
              <th scope="col">Timestamp</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Mode</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <ActivityRow key={entry.seq} entry={entry} />
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {totalEntries > 0 ? (
        <nav aria-label="Activity pagination" className={styles['pagination']}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            Previous
          </Button>
          <span className={styles['pageInfo']}>Page {page} of {totalPages}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            Next
          </Button>
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
  readonly status?: 'verified' | 'failed' | 'checking' | 'unchecked';
  readonly error?: string;
  readonly onVerify?: () => void;
}) {
  if (status === 'verified') {
    return (
      <span className={styles['integrity']}>
        <Badge variant="status" color="success">Verified</Badge>
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span className={styles['integrity']} role="alert">
        <Badge variant="status" color="destructive">
          Failed{error !== undefined ? `: ${error}` : ''}
        </Badge>
      </span>
    );
  }

  if (status === 'checking') {
    return (
      <span className={styles['integrity']}>
        <Badge variant="status" color="warning">Checking…</Badge>
      </span>
    );
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      {...(onVerify !== undefined ? { onClick: onVerify } : {})}
      aria-label="Verify chain"
    >
      Verify chain
    </Button>
  );
}

// -- Activity row --------------------------------------------------------

function ActivityRow({ entry }: { readonly entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr className={styles['row']}>
        <td>
          <span className={styles['timestamp']}>{formatTimestamp(entry.timestamp)}</span>
        </td>
        <td>
          <div className={styles['actorCell']}>
            <Avatar name={entry.actor} size="sm" />
            <div>
              <div className={styles['actorName']}>{entry.actor}</div>
              <div className={styles['actorKind']}>
                <Badge variant="scope" color={actorKindColor(entry.callerClass)}>
                  {actorKindLabel(entry.callerClass)}
                </Badge>
              </div>
            </div>
          </div>
        </td>
        <td>
          <code className={styles['actionCode']}>{entry.action}</code>
        </td>
        <td>
          {entry.mode !== undefined ? (
            <Badge variant="scope" color={modeColor(entry.mode)}>
              {entry.mode}
            </Badge>
          ) : (
            <span className={styles['muted']}>—</span>
          )}
        </td>
        <td>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse details' : 'Expand details'}
            aria-expanded={expanded}
            className={styles['expandButton']}
          >
            <span
              className={`${styles['chevron']} ${expanded ? styles['chevronOpen'] : ''}`}
              aria-hidden="true"
            >
              ›
            </span>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className={styles['detailRow']}>
          <td colSpan={5} className={styles['detailCell']}>
            <DetailPanel entry={entry} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

// -- Detail panel --------------------------------------------------------

function DetailPanel({ entry }: { readonly entry: ActivityEntry }) {
  const [showRaw, setShowRaw] = useState(false);

  const paramEntries = isPlainObject(entry.params)
    ? Object.entries(entry.params)
    : null;

  return (
    <div className={styles['detail']}>
      {/* Params */}
      <div className={styles['detailSection']}>
        <h3 className={styles['detailHeading']}>Params</h3>
        {paramEntries !== null && paramEntries.length > 0 ? (
          <dl className={styles['paramsList']}>
            {paramEntries.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{formatParamValue(v)}</dd>
              </div>
            ))}
          </dl>
        ) : paramEntries !== null && paramEntries.length === 0 ? (
          <p className={styles['muted']}>(no params)</p>
        ) : (
          <pre className={styles['rawJson']}>{JSON.stringify(entry.params, null, 2)}</pre>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowRaw((v) => !v)}
          aria-expanded={showRaw}
        >
          {showRaw ? 'Hide raw JSON' : 'View raw JSON'}
        </Button>
        {showRaw ? (
          <pre className={styles['rawJson']}>{JSON.stringify(entry.params, null, 2)}</pre>
        ) : null}
      </div>

      {/* Provenance */}
      {entry.provenance !== undefined ? (
        <div className={styles['detailSection']}>
          <h3 className={styles['detailHeading']}>Provenance</h3>
          <HashRow label="affectedJson" value={entry.provenance.affectedJson} />
          <HashRow label="previewHashHex" value={entry.provenance.previewHashHex} />
        </div>
      ) : null}

      {/* Hash chain */}
      <div className={styles['detailSection']}>
        <h3 className={styles['detailHeading']}>Hash chain</h3>
        <HashRow label="seq" value={String(entry.seq)} copyable={false} />
        <HashRow label="hashHex" value={entry.hashHex} />
        <HashRow label="prevHashHex" value={entry.prevHashHex} />
      </div>
    </div>
  );
}

function HashRow({
  label,
  value,
  copyable = true,
}: {
  readonly label: string;
  readonly value: string;
  readonly copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = (): void => {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return;
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className={styles['hashRow']}>
      <span className={styles['hashLabel']}>{label}</span>
      <code className={styles['hashValue']}>{value === '' ? '(empty)' : value}</code>
      {copyable ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      ) : null}
    </div>
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function formatParamValue(v: unknown): ReactNode {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
