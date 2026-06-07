/**
 * @vitest-environment jsdom
 *
 * Tests for `useThreadSearchPaginated` (PR 53 / CoWork #15).
 *
 * Covers:
 *   - First-page load on mount.
 *   - `loadMore` appends; doesn't refetch the first page.
 *   - Query change resets the accumulator before the new first page.
 *   - `hasMore` is true only when (a) we have a `total` and the
 *     accumulator is short of it, OR (b) the last page returned was
 *     full (proxy when the server omits `total`).
 *   - Empty / whitespace queries don't issue a request.
 *   - `loadMore` is idempotent — back-to-back calls don't double-fire.
 *   - Errors surface without dropping the already-loaded pages.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@iarsma/wasm-bindings/jmap-client', () => ({
  session: { parseSession: vi.fn() },
  mailbox: { parseMailboxGetResponse: vi.fn() },
  email: {
    parseEmailQueryResponse: vi.fn(),
    parseThreadGetResponse: vi.fn(),
  },
}));
vi.mock('@iarsma/wasm-bindings/action-log', () => ({
  chain: { canonicalize: vi.fn(), verifyLinks: vi.fn() },
}));

import { IarsmaProvider, mockInvoker } from '../index.js';
import { useThreadSearchPaginated } from '../use-thread-search-paginated.js';

afterEach(() => {
  cleanup();
});

function makeThread(id: string, subject: string) {
  return {
    id,
    latestEmail: {
      id: `E-${id}`,
      threadId: id,
      from: [{ name: 'Alice', email: 'alice@example.invalid' }],
      subject,
      preview: 'preview',
      receivedAt: '2026-06-01T00:00:00Z',
      keywords: [{ name: '$seen', value: false }],
      size: 100,
    },
  };
}

function wrap(invoker: ReturnType<typeof mockInvoker>) {
  return ({ children }: { children: React.ReactNode }) => (
    <JotaiProvider>
      <IarsmaProvider value={invoker}>{children}</IarsmaProvider>
    </JotaiProvider>
  );
}

describe('useThreadSearchPaginated — first page', () => {
  it('fetches the first page on mount with position=0', async () => {
    const calls: Array<{ position: number; limit: number }> = [];
    const invoker = mockInvoker({
      'thread.search': async (input) => {
        const i = input as { position: number; limit: number };
        calls.push({ position: i.position, limit: i.limit });
        return {
          threads: [makeThread('T1', 'hit')],
          position: 0,
          total: 1,
        };
      },
    });
    const { result } = renderHook(
      () => useThreadSearchPaginated({ query: 'hit' }),
      { wrapper: wrap(invoker) },
    );
    await waitFor(() => expect(result.current.threads.length).toBe(1));
    expect(calls[0]).toEqual({ position: 0, limit: 50 });
    expect(result.current.total).toBe(1);
  });

  it('does not fetch when the query is empty', () => {
    const invoker = mockInvoker({
      'thread.search': async () => ({ threads: [], position: 0 }),
    });
    const { result } = renderHook(
      () => useThreadSearchPaginated({ query: '' }),
      { wrapper: wrap(invoker) },
    );
    expect(result.current.threads).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not fetch for whitespace-only queries', () => {
    const invoker = mockInvoker({
      'thread.search': async () => ({ threads: [], position: 0 }),
    });
    const { result } = renderHook(
      () => useThreadSearchPaginated({ query: '   ' }),
      { wrapper: wrap(invoker) },
    );
    expect(result.current.threads).toEqual([]);
  });
});

describe('useThreadSearchPaginated — loadMore', () => {
  it('appends the next page rather than replacing it', async () => {
    const responses = [
      {
        threads: Array.from({ length: 50 }, (_, i) =>
          makeThread(`T${i}`, `subj ${i}`),
        ),
        position: 0,
        total: 75,
      },
      {
        threads: Array.from({ length: 25 }, (_, i) =>
          makeThread(`T${i + 50}`, `subj ${i + 50}`),
        ),
        position: 50,
        total: 75,
      },
    ];
    let idx = 0;
    const invoker = mockInvoker({
      'thread.search': async () => responses[idx++],
    });
    const { result } = renderHook(
      () => useThreadSearchPaginated({ query: 'hit' }),
      { wrapper: wrap(invoker) },
    );
    await waitFor(() => expect(result.current.threads.length).toBe(50));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.threads.length).toBe(75));
    expect(result.current.hasMore).toBe(false);
  });

  it('hasMore stays true when the last page was full but total is unknown', async () => {
    let nextPosition = 0;
    const invoker = mockInvoker({
      'thread.search': async (input) => {
        const i = input as { position: number; limit: number };
        nextPosition = i.position;
        return {
          threads: Array.from({ length: 50 }, (_, k) =>
            makeThread(`T${i.position + k}`, `subj ${i.position + k}`),
          ),
          position: i.position,
          // total omitted intentionally
        };
      },
    });
    const { result } = renderHook(
      () => useThreadSearchPaginated({ query: 'hit' }),
      { wrapper: wrap(invoker) },
    );
    await waitFor(() => expect(result.current.threads.length).toBe(50));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.threads.length).toBe(100));
    expect(nextPosition).toBe(50);
  });

  it('hasMore flips false on a short page even with no total', async () => {
    const responses = [
      {
        threads: Array.from({ length: 50 }, (_, i) =>
          makeThread(`T${i}`, ''),
        ),
        position: 0,
      },
      {
        threads: Array.from({ length: 10 }, (_, i) =>
          makeThread(`T${i + 50}`, ''),
        ),
        position: 50,
      },
    ];
    let idx = 0;
    const invoker = mockInvoker({
      'thread.search': async () => responses[idx++],
    });
    const { result } = renderHook(
      () => useThreadSearchPaginated({ query: 'q' }),
      { wrapper: wrap(invoker) },
    );
    await waitFor(() => expect(result.current.threads.length).toBe(50));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.threads.length).toBe(60));
    expect(result.current.hasMore).toBe(false);
  });

  it('is a no-op when called while a load is in flight', async () => {
    let resolveFirst!: () => void;
    let calls = 0;
    const invoker = mockInvoker({
      'thread.search': async () => {
        calls++;
        if (calls === 1) {
          await new Promise<void>((r) => {
            resolveFirst = r;
          });
        }
        return {
          threads: [makeThread(`T${calls}`, '')],
          position: (calls - 1) * 50,
          total: 9999,
        };
      },
    });
    const { result } = renderHook(
      () => useThreadSearchPaginated({ query: 'q' }),
      { wrapper: wrap(invoker) },
    );
    // Wait for the loading flag to become true (the first invoke has
    // hit the in-flight delay).
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    act(() => result.current.loadMore()); // ignored, isLoading is true
    expect(calls).toBe(1);
    resolveFirst();
    await waitFor(() => expect(result.current.threads.length).toBe(1));
  });
});

describe('useThreadSearchPaginated — query change resets', () => {
  it('discards accumulator when the query changes', async () => {
    let queryArg = '';
    const invoker = mockInvoker({
      'thread.search': async (input) => {
        const i = input as { query: string };
        queryArg = i.query;
        return {
          threads: [makeThread(`T-${i.query}`, i.query)],
          position: 0,
          total: 1,
        };
      },
    });
    const { result, rerender } = renderHook(
      ({ q }) => useThreadSearchPaginated({ query: q }),
      { wrapper: wrap(invoker), initialProps: { q: 'foo' } },
    );
    await waitFor(() => expect(result.current.threads.length).toBe(1));
    expect(queryArg).toBe('foo');
    rerender({ q: 'bar' });
    await waitFor(() => expect(queryArg).toBe('bar'));
    expect(result.current.threads[0]?.id).toBe('T-bar');
  });
});

describe('useThreadSearchPaginated — errors', () => {
  it('keeps previous pages when a follow-up page errors', async () => {
    let call = 0;
    const invoker = mockInvoker({
      'thread.search': async () => {
        call++;
        if (call === 1) {
          return {
            threads: Array.from({ length: 50 }, (_, i) =>
              makeThread(`T${i}`, ''),
            ),
            position: 0,
            total: 200,
          };
        }
        throw new Error('boom');
      },
    });
    const { result } = renderHook(
      () => useThreadSearchPaginated({ query: 'q' }),
      { wrapper: wrap(invoker) },
    );
    await waitFor(() => expect(result.current.threads.length).toBe(50));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBeDefined());
    // The first page still rendered.
    expect(result.current.threads.length).toBe(50);
  });
});
