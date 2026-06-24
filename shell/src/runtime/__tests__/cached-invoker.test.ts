/**
 * cachedInvoker tests (D-051).
 *
 * Validates the stale-while-revalidate semantics:
 *
 *   - Cache miss: fetch + write-through; result returned.
 *   - Cache hit: cached value returned synchronously; background
 *     fetch fires; cache is updated when the background fetch
 *     completes.
 *   - Non-cacheable tool: pass-through (cache untouched, no SWR).
 *   - Dry-run: pass-through.
 *   - In-flight dedup: two simultaneous misses share one fetch.
 *   - Background-revalidation errors: silent by default, surfaced via
 *     the `onRevalidationError` callback when provided.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedInvoker } from '../cached-invoker.js';
import {
  inMemoryCacheStorage,
  type CacheStorage,
} from '../cache-storage.js';
import type { Invoker } from '../invoker.js';

function inner(handlers: Record<string, () => unknown>): {
  invoker: Invoker;
  calls: { name: string; input: unknown }[];
} {
  const calls: { name: string; input: unknown }[] = [];
  const invoker: Invoker = {
    async invoke(name, input) {
      calls.push({ name, input });
      const handler = handlers[name];
      if (handler === undefined) throw new Error(`no handler for ${name}`);
      return handler() as never;
    },
  };
  return { invoker, calls };
}

/** Wait for the macrotask queue to flush. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

let cache: CacheStorage;

beforeEach(() => {
  cache = inMemoryCacheStorage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cachedInvoker — cache miss', () => {
  it('fetches via inner and writes through to the cache', async () => {
    const { invoker, calls } = inner({
      'thread.list': () => ({ threads: [], position: 0, total: 0 }),
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });
    const out = await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    expect(out).toEqual({ threads: [], position: 0, total: 0 });
    expect(calls).toHaveLength(1);
    expect(await cache.get('threads', '{"mailboxId":"mb1"}')).toEqual({
      threads: [],
      position: 0,
      total: 0,
    });
  });

  it('dedups concurrent misses for the same (tool, input)', async () => {
    let resolveFetch!: (v: unknown) => void;
    const fetchPromise = new Promise((r) => {
      resolveFetch = r;
    });
    const { invoker, calls } = inner({
      'thread.list': () => fetchPromise,
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    const a = wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    const b = wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    // Let the IIFE bodies run past the cache lookup so `inner.invoke`
    // gets entered for the first call. The dedup gate catches the
    // second call before it spawns a parallel fetch.
    await flush();
    expect(calls).toHaveLength(1);
    resolveFetch({ threads: [{ id: 'T1' }] });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual({ threads: [{ id: 'T1' }] });
    expect(rb).toEqual({ threads: [{ id: 'T1' }] });
  });
});

describe('cachedInvoker — cache hit (stale-while-revalidate)', () => {
  it('returns the cached value and dispatches a background fetch', async () => {
    await cache.put('threads', '{"mailboxId":"mb1"}', {
      threads: [{ id: 'OLD' }],
      position: 0,
      total: 1,
    });
    const fetched = { threads: [{ id: 'NEW' }], position: 0, total: 1 };
    const { invoker, calls } = inner({ 'thread.list': () => fetched });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    const out = await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    // Returned the CACHED value, not the fetched one.
    expect(out).toEqual({
      threads: [{ id: 'OLD' }],
      position: 0,
      total: 1,
    });
    // Background revalidation fired anyway.
    await flush();
    expect(calls).toHaveLength(1);
    // After the revalidation, the cache reflects the fresh data.
    expect(await cache.get('threads', '{"mailboxId":"mb1"}')).toEqual(fetched);
  });

  it('coalesces a SWR background fetch with an in-flight cache-miss fetch', async () => {
    let resolveFetch!: (v: unknown) => void;
    const fetchPromise = new Promise((r) => {
      resolveFetch = r;
    });
    const { invoker, calls } = inner({
      'thread.list': () => fetchPromise,
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    // First call: cache miss, kicks off the fetch.
    const first = wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    // Second call before the first resolves: still no cached value, so
    // it joins the in-flight fetch (dedup).
    const second = wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    await flush();
    expect(calls).toHaveLength(1);
    resolveFetch({ threads: [{ id: 'X' }] });
    await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
  });
});

describe('cachedInvoker — pass-through', () => {
  it('non-cacheable tools never touch the store', async () => {
    const { invoker, calls } = inner({
      'session.get': () => ({ apiUrl: 'https://j', primaryAccountIdMail: 'A' }),
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await wrapped.invoke('session.get', {});
    await wrapped.invoke('session.get', {});
    expect(calls).toHaveLength(2);
  });

  it('dry-run invocations are not cached', async () => {
    const previewResult = { mode: 'preview', plan: { willSend: true } };
    const { invoker, calls } = inner({
      'thread.list': () => previewResult,
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await wrapped.invoke('thread.list', { mailboxId: 'mb1' }, { dryRun: true });
    await wrapped.invoke('thread.list', { mailboxId: 'mb1' }, { dryRun: true });
    expect(calls).toHaveLength(2);
    // The dry-run preview MUST NOT pollute the cache.
    expect(await cache.get('threads', '{"mailboxId":"mb1"}')).toBeNull();
  });
});

describe('cachedInvoker — write invalidation (v0.13.1)', () => {
  it('a move (mail.modify with a mailboxIds patch) clears threads + searchResults + mailboxes', async () => {
    // Seed a destination mailbox list, a label-filtered list, the
    // mailbox tree, and an unrelated thread body in the cache.
    await cache.put('threads', '{"mailboxId":"dest"}', { threads: [], position: 0, total: 0 });
    await cache.put('searchResults', '{"q":"x"}', { threads: [] });
    await cache.put('mailboxes', '{}', [{ id: 'dest', totalEmails: 0 }]);
    await cache.put('threadBodies', '{"id":"t1"}', { id: 't1' });

    const { invoker } = inner({ 'mail.modify': () => ({ modifiedCount: 1 }) });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await wrapped.invoke('mail.modify', {
      emailIds: ['e1'],
      patch: { mailboxIds: { src: false, dest: true } },
    });

    expect(await cache.get('threads', '{"mailboxId":"dest"}')).toBeNull();
    expect(await cache.get('searchResults', '{"q":"x"}')).toBeNull();
    expect(await cache.get('mailboxes', '{}')).toBeNull();
    // threadBodies is NOT in a move's invalidation set — left intact.
    expect(await cache.get('threadBodies', '{"id":"t1"}')).not.toBeNull();
  });

  it('a keyword-only mail.modify (flag / mark-read) does NOT clear the cache', async () => {
    await cache.put('threads', '{"mailboxId":"mb1"}', { threads: [], position: 0, total: 0 });
    const { invoker } = inner({ 'mail.modify': () => ({ modifiedCount: 1 }) });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await wrapped.invoke('mail.modify', {
      emailIds: ['e1'],
      patch: { keywords: { $seen: true } },
    });

    // Hot mark-read-on-open path must keep the cache warm.
    expect(await cache.get('threads', '{"mailboxId":"mb1"}')).not.toBeNull();
  });

  it('mail.delete clears threads, threadBodies, searchResults, and mailboxes', async () => {
    await cache.put('threads', '{"mailboxId":"mb1"}', { threads: [] });
    await cache.put('threadBodies', '{"id":"t1"}', { id: 't1' });
    await cache.put('searchResults', '{"q":"x"}', { threads: [] });
    await cache.put('mailboxes', '{}', []);
    const { invoker } = inner({ 'mail.delete': () => ({ deleted: 1 }) });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await wrapped.invoke('mail.delete', { emailIds: ['e1'] });

    expect(await cache.get('threads', '{"mailboxId":"mb1"}')).toBeNull();
    expect(await cache.get('threadBodies', '{"id":"t1"}')).toBeNull();
    expect(await cache.get('searchResults', '{"q":"x"}')).toBeNull();
    expect(await cache.get('mailboxes', '{}')).toBeNull();
  });

  it('label.apply clears threads + searchResults but not mailboxes', async () => {
    await cache.put('threads', '{"hasKeyword":"work"}', { threads: [] });
    await cache.put('searchResults', '{"q":"x"}', { threads: [] });
    await cache.put('mailboxes', '{}', []);
    const { invoker } = inner({ 'label.apply': () => ({ modifiedCount: 1 }) });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await wrapped.invoke('label.apply', { emailIds: ['e1'], add: ['work'] });

    expect(await cache.get('threads', '{"hasKeyword":"work"}')).toBeNull();
    expect(await cache.get('searchResults', '{"q":"x"}')).toBeNull();
    expect(await cache.get('mailboxes', '{}')).not.toBeNull();
  });

  it('a dry-run mutation never invalidates the cache', async () => {
    await cache.put('threads', '{"mailboxId":"dest"}', { threads: [], position: 0, total: 0 });
    const { invoker } = inner({
      'mail.modify': () => ({ mode: 'preview', plan: { affectedCount: 1 } }),
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await wrapped.invoke(
      'mail.modify',
      { emailIds: ['e1'], patch: { mailboxIds: { src: false, dest: true } } },
      { dryRun: true },
    );

    expect(await cache.get('threads', '{"mailboxId":"dest"}')).not.toBeNull();
  });

  it('a failed write propagates and does not invalidate', async () => {
    await cache.put('threads', '{"mailboxId":"dest"}', { threads: [], position: 0, total: 0 });
    const { invoker } = inner({
      'mail.modify': () => {
        throw new Error('boom');
      },
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await expect(
      wrapped.invoke('mail.modify', {
        emailIds: ['e1'],
        patch: { mailboxIds: { src: false, dest: true } },
      }),
    ).rejects.toThrow('boom');
    // Write failed → cache untouched.
    expect(await cache.get('threads', '{"mailboxId":"dest"}')).not.toBeNull();
  });
});

describe('cachedInvoker — cache key canonicalization', () => {
  it('treats inputs differing only by key order as the same cache key', async () => {
    // Pre-populate with a sentinel under the canonicalized key
    // (alphabetical-by-key JSON). Both call shapes below should
    // canonicalize to the same key and hit the cache. The handler
    // returns the same sentinel so background SWR overwrite is a
    // no-op — keeps the test focused on canonicalization rather than
    // SWR ordering.
    const SENTINEL = { threads: [{ id: 'CACHED' }], position: 0, total: 1 };
    await cache.put('threads', '{"limit":50,"mailboxId":"mb1"}', SENTINEL);
    const { invoker } = inner({ 'thread.list': () => SENTINEL });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    const a = await wrapped.invoke('thread.list', { mailboxId: 'mb1', limit: 50 });
    const b = await wrapped.invoke('thread.list', { limit: 50, mailboxId: 'mb1' });
    expect(a).toEqual(SENTINEL);
    expect(b).toEqual(SENTINEL);
  });

  it('treats different inputs as different cache keys', async () => {
    const { invoker, calls } = inner({
      'thread.list': () => ({ threads: [], position: 0, total: 0 }),
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    await wrapped.invoke('thread.list', { mailboxId: 'mb2' });
    expect(calls).toHaveLength(2);
  });
});

describe('cachedInvoker — revalidation errors', () => {
  it('swallows background-fetch errors silently by default', async () => {
    await cache.put('threads', '{"mailboxId":"mb1"}', {
      threads: [],
      position: 0,
      total: 0,
    });
    const { invoker } = inner({
      'thread.list': () => {
        throw new Error('upstream blew up');
      },
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });

    // The cache hit returns successfully; the background fetch
    // rejects but its rejection must not propagate to the caller.
    const out = await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    expect(out).toEqual({ threads: [], position: 0, total: 0 });
    await flush();
  });

  it('surfaces background-fetch errors via the onRevalidationError callback', async () => {
    await cache.put('threads', '{"mailboxId":"mb1"}', {
      threads: [],
      position: 0,
      total: 0,
    });
    const { invoker } = inner({
      'thread.list': () => {
        throw new Error('boom');
      },
    });
    const onRevalidationError = vi.fn();
    const wrapped = cachedInvoker({
      inner: invoker,
      store: cache,
      onRevalidationError,
    });
    await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    await flush();
    expect(onRevalidationError).toHaveBeenCalledTimes(1);
    expect(onRevalidationError.mock.calls[0]?.[0]).toBe('thread.list');
    expect((onRevalidationError.mock.calls[0]?.[1] as Error).message).toBe(
      'boom',
    );
  });

  it('cache-miss errors propagate to the caller', async () => {
    const { invoker } = inner({
      'thread.list': () => {
        throw new Error('miss-time error');
      },
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });
    await expect(
      wrapped.invoke('thread.list', { mailboxId: 'mb1' }),
    ).rejects.toThrow('miss-time error');
  });

  // PR 58 regression — when the caller passes `bypassCache: true`,
  // cachedInvoker MUST skip the cached value and go straight to the
  // inner invoker. Without this, `useReadHook` refetching on a JMAP
  // state change (push-generation bump) would see the pre-change
  // cached value, the background revalidate would silently update the
  // cache, and the UI never re-rendered with fresh data (the
  // auto-mark-on-open never visibly took effect).
  it('bypassCache forces a fresh fetch even when the cache is populated', async () => {
    let counter = 0;
    const { invoker, calls } = inner({
      'thread.list': () => ({ threads: [{ id: `t${++counter}` }] }),
    });
    const wrapped = cachedInvoker({ inner: invoker, store: cache });
    // Populate the cache (counter → 1).
    const r1 = await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    expect((r1 as { threads: { id: string }[] }).threads[0]!.id).toBe('t1');
    await flush();

    // Subsequent call with bypassCache: counter increments again, and
    // the FRESH value is what we receive (not the cached `t1`).
    const r2 = await wrapped.invoke(
      'thread.list',
      { mailboxId: 'mb1' },
      { bypassCache: true },
    );
    expect((r2 as { threads: { id: string }[] }).threads[0]!.id).not.toBe('t1');
    expect((r2 as { threads: { id: string }[] }).threads[0]!.id).toBe(
      `t${counter}`,
    );
    // Cache write-through: the bypass-fetched value is now in the
    // cache. A non-bypass call returns it synchronously.
    const r3 = await wrapped.invoke('thread.list', { mailboxId: 'mb1' });
    expect((r3 as { threads: { id: string }[] }).threads[0]!.id).toBe(
      (r2 as { threads: { id: string }[] }).threads[0]!.id,
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
