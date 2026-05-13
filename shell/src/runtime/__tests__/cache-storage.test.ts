/**
 * Tests for the in-memory cache backing (D-051).
 *
 * The IDB-backed cache reuses the same `crypto-envelope` AAD logic
 * already exhaustively tested in `crypto-envelope.test.ts`; the cache
 * module's job is to wire purpose strings to object stores. Coverage
 * here:
 *
 *   - In-memory round-trip per-purpose
 *   - Purpose isolation (mailbox writes don't leak into the threads
 *     store, etc.)
 *   - clearAll() drops everything
 *   - CACHE_PURPOSES has the expected entries (locked so a future
 *     developer adding one notices the schema-version bump requirement)
 *
 * IDB-backed integration tests (with fake-indexeddb) are a follow-up,
 * tracked alongside the auth-storage IDB integration tests in D-050.
 */

import { describe, expect, it } from 'vitest';
import {
  CACHE_PURPOSES,
  inMemoryCacheStorage,
  type CachePurposeKey,
} from '../cache-storage.js';

describe('inMemoryCacheStorage', () => {
  it('returns null for unknown keys', async () => {
    const cache = inMemoryCacheStorage();
    expect(await cache.get('mailboxes', 'k1')).toBeNull();
  });

  it('round-trips values per purpose', async () => {
    const cache = inMemoryCacheStorage();
    const value = { mailboxes: [{ id: 'mb1', name: 'Inbox' }] };
    await cache.put('mailboxes', '{}', value);
    expect(await cache.get<typeof value>('mailboxes', '{}')).toEqual(value);
  });

  it('isolates entries across purposes (same key, different purpose)', async () => {
    const cache = inMemoryCacheStorage();
    await cache.put('mailboxes', 'k1', { kind: 'mailbox' });
    await cache.put('threads', 'k1', { kind: 'thread' });
    expect(await cache.get('mailboxes', 'k1')).toEqual({ kind: 'mailbox' });
    expect(await cache.get('threads', 'k1')).toEqual({ kind: 'thread' });
  });

  it('delete drops a single entry without affecting siblings', async () => {
    const cache = inMemoryCacheStorage();
    await cache.put('threads', 'k1', { id: 1 });
    await cache.put('threads', 'k2', { id: 2 });
    await cache.delete('threads', 'k1');
    expect(await cache.get('threads', 'k1')).toBeNull();
    expect(await cache.get('threads', 'k2')).toEqual({ id: 2 });
  });

  it('clearAll drops every purpose', async () => {
    const cache = inMemoryCacheStorage();
    await cache.put('mailboxes', 'k', { a: 1 });
    await cache.put('threads', 'k', { a: 2 });
    await cache.put('threadBodies', 'k', { a: 3 });
    await cache.clearAll();
    expect(await cache.get('mailboxes', 'k')).toBeNull();
    expect(await cache.get('threads', 'k')).toBeNull();
    expect(await cache.get('threadBodies', 'k')).toBeNull();
  });

  it('ready() resolves immediately', async () => {
    const cache = inMemoryCacheStorage();
    await cache.ready();
    expect(await cache.get('mailboxes', 'x')).toBeNull();
  });
});

describe('CACHE_PURPOSES schema lock', () => {
  // This test pins the (purpose, store) pairs so a developer adding a
  // new cache purpose remembers to bump the IDB version + register the
  // store in onupgradeneeded. It also documents the on-disk shape.
  it('exposes the expected purposes and their on-disk store names', () => {
    const expected: Record<CachePurposeKey, { store: string; purpose: string }> = {
      mailboxes: { store: 'mailboxes', purpose: 'cache.mailboxes.v1' },
      threads: { store: 'threads', purpose: 'cache.threads.v1' },
      threadBodies: {
        store: 'thread-bodies',
        purpose: 'cache.thread-bodies.v1',
      },
      identities: { store: 'identities', purpose: 'cache.identities.v1' },
    };
    expect(CACHE_PURPOSES).toEqual(expected);
  });

  it('uses distinct purpose strings per cache class (AAD domain separation)', () => {
    const purposes = Object.values(CACHE_PURPOSES).map((c) => c.purpose);
    const unique = new Set(purposes);
    expect(unique.size).toBe(purposes.length);
  });
});
