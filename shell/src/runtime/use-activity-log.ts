/**
 * useActivityLog — adapter hook that joins the action-log store to the
 * presentational ActivityView (§8.5).
 *
 * Responsibilities:
 *   - Read the whole chain from `actionLog.entries()` on mount, and
 *     refresh on a periodic + activeView-change tick so new entries
 *     appended by the loggingInvoker show up without a full reload.
 *   - Hold filter + page state.
 *   - Map each StoredEntry into the ActivityEntry shape the view
 *     consumes (display actor, mode preserved, params parsed from
 *     paramsJson, ISO timestamp).
 *   - Apply filters client-side, then page.
 *   - Wire the Verify button to `actionLog.verify()` and surface
 *     integrity status as 'verified' | 'failed' | 'checking' | 'unchecked'.
 *
 * The view stays purely presentational; this hook owns all the runtime
 * coupling.
 */

import { atom, useAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { actionLog, undoRegistry } from '../auth-state.js';
import type { StoredEntry } from './action-log.js';
import type { UndoEntry } from './undo-registry.js';
import type { ActivityEntry } from '../views/activity-view.js';

const DEFAULT_PAGE_SIZE = 25;

type ActivityFilters = {
  readonly actor: string;
  readonly action: string;
  readonly mode: string;
  readonly timeRange: string;
};

const DEFAULT_FILTERS: ActivityFilters = {
  actor: 'all',
  action: 'all',
  mode: 'all',
  timeRange: 'all',
};

/**
 * Cross-view atom holding the Activity view's active filters. Lifted
 * out of the hook so other surfaces (Settings → Agent tokens) can
 * pre-set a filter (e.g. actor=<tokenName>) before navigating in.
 */
export const activityFiltersAtom = atom<ActivityFilters>(DEFAULT_FILTERS);

/**
 * Per-token last-used map: tokenId → ISO timestamp of the most
 * recent action-log entry for that token. Empty when the token has
 * never been used. Lifts the derivation out of any one view so the
 * Settings token table and the Activity view can both consume it.
 */
export type LastUsedByToken = ReadonlyMap<string, string>;

export type UseActivityLogOptions = {
  /** Resolve a tokenId to a display name (e.g., "CI Bot"). Falls back
   *  to the tokenId when the token is unknown — covers revoked tokens
   *  that have been pruned from the issuer's list. */
  readonly actorTokenName: (tokenId: string) => string;
  /** Override the periodic refresh interval (ms). Default 5s. */
  readonly refreshIntervalMs?: number;
};

export type UseActivityLogResult = {
  readonly entries: readonly ActivityEntry[];
  readonly isLoading: boolean;
  readonly integrityStatus: 'verified' | 'failed' | 'checking' | 'unchecked';
  readonly integrityError?: string;
  readonly onVerify: () => void;
  readonly filters: ActivityFilters;
  readonly onFilterChange: (key: string, value: string) => void;
  readonly page: number;
  readonly pageSize: number;
  readonly totalEntries: number;
  readonly onPageChange: (page: number) => void;
  readonly lastUsedByToken: LastUsedByToken;
  /** Per-seq lookup of active undo entries (consumed/expired excluded).
   *  Activity view uses this to decide which rows show an Undo button. */
  readonly undoBySeq: ReadonlyMap<number, UndoEntry>;
};

export function useActivityLog(opts: UseActivityLogOptions): UseActivityLogResult {
  const refreshIntervalMs = opts.refreshIntervalMs ?? 5000;
  const [allEntries, setAllEntries] = useState<readonly StoredEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [integrityStatus, setIntegrityStatus] = useState<
    'verified' | 'failed' | 'checking' | 'unchecked'
  >('unchecked');
  const [integrityError, setIntegrityError] = useState<string | undefined>(undefined);

  const [filters, setFilters] = useAtom(activityFiltersAtom);
  const [page, setPage] = useState(1);
  const [undoBySeq, setUndoBySeq] = useState<ReadonlyMap<number, UndoEntry>>(
    () => new Map(),
  );

  // Initial load + periodic refresh. Cheap enough on Phase-0 chain
  // sizes; Phase 1 swaps this for a count-watch and verified-prefix
  // cache so we're not re-decrypting the whole chain every tick.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const rows = await actionLog.entries();
        const undos = await undoRegistry.list({ activeOnly: true });
        if (!cancelled) {
          setAllEntries(rows);
          setUndoBySeq(new Map(undos.map((u) => [u.forEntrySeq, u])));
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    const handle = window.setInterval(() => {
      void load();
    }, refreshIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [refreshIntervalMs]);

  const mapped: readonly ActivityEntry[] = useMemo(() => {
    return allEntries.map((e) => mapEntry(e, opts.actorTokenName));
  }, [allEntries, opts.actorTokenName]);

  const filtered = useMemo(() => {
    return mapped.filter((e) => matchesFilters(e, filters));
  }, [mapped, filters]);

  // Newest first — surfaces the most recent activity at the top of the
  // table, which is what the action-log surface is for.
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => b.seq - a.seq);
  }, [filtered]);

  const totalEntries = sorted.length;
  const paged = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return sorted.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [sorted, page]);

  const onFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, [setFilters]);

  // Per-token last-used map derived from the raw chain (not the
  // filtered view, so the Settings table sees the truth regardless
  // of what the Activity view is currently scoped to).
  const lastUsedByToken = useMemo<LastUsedByToken>(() => {
    const map = new Map<string, string>();
    for (const e of allEntries) {
      const tokenId = e.data.agentTokenId;
      if (tokenId === undefined) continue;
      const ts = new Date(e.data.timestampMs).toISOString();
      const prev = map.get(tokenId);
      if (prev === undefined || prev < ts) map.set(tokenId, ts);
    }
    return map;
  }, [allEntries]);

  const onPageChange = useCallback((next: number) => {
    setPage(Math.max(1, next));
  }, []);

  const onVerify = useCallback(() => {
    setIntegrityStatus('checking');
    setIntegrityError(undefined);
    void (async () => {
      try {
        const result = await actionLog.verify();
        if (result === null) {
          setIntegrityStatus('verified');
        } else {
          setIntegrityStatus('failed');
          setIntegrityError(`seq ${result.seq}: ${result.message}`);
        }
      } catch (e) {
        setIntegrityStatus('failed');
        setIntegrityError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return {
    entries: paged,
    isLoading,
    integrityStatus,
    ...(integrityError !== undefined ? { integrityError } : {}),
    onVerify,
    filters,
    onFilterChange,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    totalEntries,
    lastUsedByToken,
    undoBySeq,
    onPageChange,
  };
}

function mapEntry(
  e: StoredEntry,
  resolveAgentName: (tokenId: string) => string,
): ActivityEntry {
  const d = e.data;
  const actor = ((): string => {
    if (d.callerClass === 'ui') return 'You';
    if (d.callerClass === 'agent') {
      if (d.agentTokenId !== undefined) return resolveAgentName(d.agentTokenId);
      return d.identity;
    }
    return d.identity;
  })();

  let params: unknown;
  try {
    params = JSON.parse(d.paramsJson);
  } catch {
    params = d.paramsJson;
  }

  const out: ActivityEntry = {
    seq: e.seq,
    timestamp: new Date(d.timestampMs).toISOString(),
    actor,
    callerClass: d.callerClass,
    action: d.action,
    ...(d.mode !== undefined ? { mode: d.mode } : {}),
    params,
    ...(d.provenance !== undefined ? { provenance: d.provenance } : {}),
    hashHex: e.hashHex,
    prevHashHex: e.prevHashHex,
  };
  return out;
}

function matchesFilters(e: ActivityEntry, f: ActivityFilters): boolean {
  if (f.actor !== 'all' && e.actor !== f.actor) return false;
  if (f.action !== 'all' && e.action !== f.action) return false;
  if (f.mode !== 'all') {
    if (e.mode !== f.mode) return false;
  }
  if (f.timeRange !== 'all') {
    const now = Date.now();
    const ts = Date.parse(e.timestamp);
    if (Number.isNaN(ts)) return true;
    const ageMs = now - ts;
    switch (f.timeRange) {
      case 'hour':
        if (ageMs > 60 * 60 * 1000) return false;
        break;
      case 'today': {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        if (ts < startOfDay.getTime()) return false;
        break;
      }
      case 'week':
        if (ageMs > 7 * 24 * 60 * 60 * 1000) return false;
        break;
    }
  }
  return true;
}
