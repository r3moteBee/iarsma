/**
 * useThreadSearchPaginated — accumulator hook for `thread.search`
 * (PR 53 / CoWork #15).
 *
 * The generated `useThreadSearch` is single-page and re-fetches on
 * input change. Infinite scroll needs the opposite contract: keep the
 * pages we've already loaded around, and let the caller ask for the
 * next page when the user scrolls near the bottom. This hook does
 * exactly that — it owns `threads[]`, `total`, `hasMore`, `loadMore()`.
 *
 * Reset rules:
 *   - Query changes (after canonicalization) → discard all pages and
 *     refetch from position 0.
 *   - `pushGenerationAtom` ticks (push-state token changed) → for
 *     consistency with `useReadHook`, also clear & refetch first page.
 *
 * Errors don't poison the accumulator — a failed page keeps the
 * already-loaded threads visible so the user isn't stranded.
 */

import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useInvoker } from './invoker.js';
import { pushGenerationAtom } from './push-subscription.js';
import { toToolError, type ToolError } from './types.js';

const DEFAULT_PAGE_SIZE = 50;

export type ThreadSummary =
  import('./jmap-client.js').ThreadSummary;

type SearchPageInput = {
  readonly query: string;
  readonly position: number;
  readonly limit: number;
};

type SearchPageOutput = {
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly position: number;
  readonly total?: number;
};

export type UseThreadSearchPaginatedOptions = {
  readonly query: string;
  /** Page size — defaults to 50 (matches the contract default). */
  readonly pageSize?: number;
};

export type UseThreadSearchPaginatedResult = {
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly total: number | undefined;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly error: ToolError | undefined;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly refetch: () => void;
};

export function useThreadSearchPaginated(
  opts: UseThreadSearchPaginatedOptions,
): UseThreadSearchPaginatedResult {
  const { query, pageSize = DEFAULT_PAGE_SIZE } = opts;
  const invoker = useInvoker();
  const pushGen = useAtomValue(pushGenerationAtom);

  const [threads, setThreads] = useState<ReadonlyArray<ThreadSummary>>([]);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<ToolError | undefined>(undefined);
  // `lastPageWasFull` covers the case where the server omits `total`
  // (Stalwart does this on expensive queries). When unknown, we treat
  // any non-full page as the last one — at worst the user has to
  // refresh to see results that arrived after the search.
  const [lastPageWasFull, setLastPageWasFull] = useState<boolean>(true);

  const reqIdRef = useRef(0);

  const trimmed = query.trim();

  const fetchPage = useCallback(
    async (position: number, isFirst: boolean): Promise<void> => {
      const myReq = ++reqIdRef.current;
      if (isFirst) setIsLoading(true);
      else setIsLoadingMore(true);
      try {
        const result = (await invoker.invoke<SearchPageInput, SearchPageOutput>(
          'thread.search',
          { query: trimmed, position, limit: pageSize },
        )) as SearchPageOutput;
        if (reqIdRef.current !== myReq) return;
        const pageThreads = result.threads;
        setThreads((prev) =>
          isFirst ? pageThreads : [...prev, ...pageThreads],
        );
        if (result.total !== undefined) setTotal(result.total);
        setLastPageWasFull(pageThreads.length >= pageSize);
        setError(undefined);
      } catch (e) {
        if (reqIdRef.current !== myReq) return;
        setError(toToolError(e));
      } finally {
        if (reqIdRef.current !== myReq) return;
        if (isFirst) setIsLoading(false);
        else setIsLoadingMore(false);
      }
    },
    [invoker, trimmed, pageSize],
  );

  // First-page load + reset on query/push changes.
  useEffect(() => {
    if (trimmed === '') {
      setThreads([]);
      setTotal(undefined);
      setError(undefined);
      setIsLoading(false);
      setLastPageWasFull(true);
      reqIdRef.current += 1; // cancel any in-flight request
      return;
    }
    // Clear before refetching so the stale rows don't flash from the
    // previous query — search rows are interpreted in the context of
    // the highlighted tokens, so showing old subjects with new tokens
    // looks broken.
    setThreads([]);
    setTotal(undefined);
    setLastPageWasFull(true);
    void fetchPage(0, true);
  }, [trimmed, pushGen, fetchPage]);

  const hasMore =
    error === undefined &&
    !isLoading &&
    !isLoadingMore &&
    threads.length > 0 &&
    (total !== undefined ? threads.length < total : lastPageWasFull);

  const loadMore = useCallback((): void => {
    if (!hasMore) return;
    void fetchPage(threads.length, false);
  }, [hasMore, fetchPage, threads.length]);

  const refetch = useCallback((): void => {
    if (trimmed === '') return;
    reqIdRef.current += 1;
    setThreads([]);
    setTotal(undefined);
    setLastPageWasFull(true);
    void fetchPage(0, true);
  }, [trimmed, fetchPage]);

  return {
    threads,
    total,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refetch,
  };
}
