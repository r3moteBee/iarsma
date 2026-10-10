import { describe, expect, it, vi } from 'vitest';
import { stalwartSessionTokenStore } from '../stalwart-session-token-store.js';

const BASE = 'https://sw-mail.example.test';
const SESSION_URL = `${BASE}/.well-known/jmap`;

type Route = (init: RequestInit | undefined) => Promise<Response> | Response;

function makeFetch(handler: Route): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== SESSION_URL) throw new Error(`unmocked fetch: ${url}`);
    return handler(init);
  }) as unknown as typeof fetch;
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('stalwartSessionTokenStore', () => {
  it('validates a bearer by GETting /.well-known/jmap and surfaces username', async () => {
    let observedAuth: string | undefined;
    const fetchFn = makeFetch((init) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      observedAuth = h['authorization'];
      return ok({ username: 'brent@example.test', primaryAccounts: {} });
    });
    const store = stalwartSessionTokenStore({
      jmapBaseUrl: BASE,
      fetch: fetchFn,
    });
    const id = await store.resolve('api-key-secret-abc');
    expect(id).not.toBeNull();
    expect(id!.name).toBe('brent@example.test');
    expect(id!.stalwartApiKey).toBe('api-key-secret-abc');
    expect(observedAuth).toBe('Bearer api-key-secret-abc');
    // id is opaque (hashed prefix), not the raw bearer.
    expect(id!.id).not.toBe('api-key-secret-abc');
    expect(id!.id.length).toBeGreaterThan(0);
  });

  it('grants every known iarsma scope by default — Stalwart enforces per-call (PR 41)', async () => {
    const store = stalwartSessionTokenStore({
      jmapBaseUrl: BASE,
      fetch: makeFetch(() => ok({ username: 'u', primaryAccounts: {} })),
    });
    const id = await store.resolve('any-bearer');
    expect(id).not.toBeNull();
    // All five mail scopes our handlers gate on:
    for (const s of ['mail:read', 'mail:draft', 'mail:send', 'mail:modify', 'mail:delete']) {
      expect(id!.scopes.has(s)).toBe(true);
    }
    // Files scopes too:
    expect(id!.scopes.has('files:read')).toBe(true);
    expect(id!.scopes.has('files:write')).toBe(true);
  });

  it('returns null for 401 / 403 responses (revoked / unknown bearer)', async () => {
    const store = stalwartSessionTokenStore({
      jmapBaseUrl: BASE,
      fetch: makeFetch(() => new Response('', { status: 401 })),
    });
    expect(await store.resolve('bad')).toBeNull();
  });

  it('returns null for 5xx and other failures (fails closed)', async () => {
    const store = stalwartSessionTokenStore({
      jmapBaseUrl: BASE,
      fetch: makeFetch(() => new Response('', { status: 500 })),
    });
    expect(await store.resolve('any')).toBeNull();
  });

  it('caches valid results inside the TTL window', async () => {
    let calls = 0;
    const fetchFn = makeFetch(() => {
      calls++;
      return ok({ username: 'u', primaryAccounts: {} });
    });
    let nowMs = 1_000_000;
    const store = stalwartSessionTokenStore({
      jmapBaseUrl: BASE,
      cacheTtlMs: 30_000,
      fetch: fetchFn,
      now: () => nowMs,
    });
    await store.resolve('tok');
    await store.resolve('tok');
    expect(calls).toBe(1);

    nowMs += 31_000;
    await store.resolve('tok');
    expect(calls).toBe(2);
  });

  it('caches invalid results so revoked tokens do not thrash the network', async () => {
    let calls = 0;
    const fetchFn = makeFetch(() => {
      calls++;
      return new Response('', { status: 401 });
    });
    const store = stalwartSessionTokenStore({ jmapBaseUrl: BASE, fetch: fetchFn });
    expect(await store.resolve('revoked')).toBeNull();
    expect(await store.resolve('revoked')).toBeNull();
    expect(calls).toBe(1);
  });

  it('multi-tenant: different bearers resolve to different opaque ids', async () => {
    const fetchFn = makeFetch((init) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      const bearer = h['authorization']?.replace('Bearer ', '') ?? '';
      const username = bearer === 'alice-key' ? 'alice@test' : 'bob@test';
      return ok({ username, primaryAccounts: {} });
    });
    const store = stalwartSessionTokenStore({ jmapBaseUrl: BASE, fetch: fetchFn });

    const alice = await store.resolve('alice-key');
    const bob = await store.resolve('bob-key');
    expect(alice?.name).toBe('alice@test');
    expect(bob?.name).toBe('bob@test');
    expect(alice?.id).not.toBe(bob?.id);
    expect(alice?.stalwartApiKey).toBe('alice-key');
    expect(bob?.stalwartApiKey).toBe('bob-key');
  });

  it('reload() clears the cache', async () => {
    let calls = 0;
    const fetchFn = makeFetch(() => {
      calls++;
      return ok({ username: 'u', primaryAccounts: {} });
    });
    const store = stalwartSessionTokenStore({ jmapBaseUrl: BASE, fetch: fetchFn });
    await store.resolve('tok');
    store.reload();
    await store.resolve('tok');
    expect(calls).toBe(2);
  });

  it('does not cache 5xx failures — the next request re-validates', async () => {
    let calls = 0;
    const fetchFn = makeFetch(() => {
      calls++;
      return calls === 1
        ? new Response('', { status: 503 })
        : ok({ username: 'u', primaryAccounts: {} });
    });
    const store = stalwartSessionTokenStore({ jmapBaseUrl: BASE, fetch: fetchFn });
    expect(await store.resolve('tok')).toBeNull();
    expect(await store.resolve('tok')).not.toBeNull();
    expect(calls).toBe(2);
  });

  it('does not cache network errors or unparseable bodies', async () => {
    let calls = 0;
    const fetchFn = makeFetch(() => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      if (calls === 2) return new Response('not json', { status: 200 });
      return ok({ username: 'u', primaryAccounts: {} });
    });
    const store = stalwartSessionTokenStore({ jmapBaseUrl: BASE, fetch: fetchFn });
    expect(await store.resolve('tok')).toBeNull();
    expect(await store.resolve('tok')).toBeNull();
    expect(await store.resolve('tok')).not.toBeNull();
    expect(calls).toBe(3);
  });

  it('re-validates a revoked token once its negative entry expires', async () => {
    let calls = 0;
    const fetchFn = makeFetch(() => {
      calls++;
      return new Response('', { status: 403 });
    });
    let nowMs = 0;
    const store = stalwartSessionTokenStore({
      jmapBaseUrl: BASE,
      cacheTtlMs: 1_000,
      fetch: fetchFn,
      now: () => nowMs,
    });
    await store.resolve('revoked');
    await store.resolve('revoked');
    expect(calls).toBe(1);
    nowMs += 1_001;
    await store.resolve('revoked');
    expect(calls).toBe(2);
  });

  it('single-flight: concurrent lookups of one bearer share one upstream call', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchFn = makeFetch(async () => {
      calls++;
      await gate;
      return ok({ username: 'u', primaryAccounts: {} });
    });
    const store = stalwartSessionTokenStore({ jmapBaseUrl: BASE, fetch: fetchFn });
    const lookups = Promise.all([store.resolve('tok'), store.resolve('tok'), store.resolve('tok')]);
    release();
    const results = await lookups;
    expect(calls).toBe(1);
    expect(results.every((r) => r?.name === 'u')).toBe(true);
    // A different bearer is not coalesced with it.
    await store.resolve('other');
    expect(calls).toBe(2);
  });

  it('single-flight does not pin a failure: the call after a 5xx goes upstream again', async () => {
    let calls = 0;
    const fetchFn = makeFetch(() => {
      calls++;
      return new Response('', { status: 502 });
    });
    const store = stalwartSessionTokenStore({ jmapBaseUrl: BASE, fetch: fetchFn });
    await Promise.all([store.resolve('tok'), store.resolve('tok')]);
    expect(calls).toBe(1);
    await store.resolve('tok');
    expect(calls).toBe(2);
  });

  it('bounds the cache: the oldest bearer is evicted past maxCacheEntries', async () => {
    const seen: string[] = [];
    const fetchFn = makeFetch((init) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seen.push(h['authorization'] ?? '');
      return ok({ username: 'u', primaryAccounts: {} });
    });
    const store = stalwartSessionTokenStore({
      jmapBaseUrl: BASE,
      maxCacheEntries: 2,
      fetch: fetchFn,
    });
    await store.resolve('a');
    await store.resolve('b');
    await store.resolve('c'); // evicts 'a'
    await store.resolve('c');
    await store.resolve('b');
    expect(seen).toEqual(['Bearer a', 'Bearer b', 'Bearer c']);
    await store.resolve('a');
    expect(seen).toEqual(['Bearer a', 'Bearer b', 'Bearer c', 'Bearer a']);
  });

  it('sweeps expired entries before evicting live ones', async () => {
    let calls = 0;
    const fetchFn = makeFetch(() => {
      calls++;
      return ok({ username: 'u', primaryAccounts: {} });
    });
    let nowMs = 0;
    const store = stalwartSessionTokenStore({
      jmapBaseUrl: BASE,
      cacheTtlMs: 1_000,
      maxCacheEntries: 2,
      fetch: fetchFn,
      now: () => nowMs,
    });
    await store.resolve('old');
    nowMs += 600;
    await store.resolve('live');
    nowMs += 600; // 'old' has expired, 'live' has not
    await store.resolve('new'); // must drop 'old', keep 'live'
    expect(calls).toBe(3);
    await store.resolve('live');
    expect(calls).toBe(3);
  });

  it('reload() during an in-flight validation does not repopulate the cache', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetchFn = makeFetch(async () => {
      calls++;
      if (calls === 1) await gate;
      return ok({ username: 'u', primaryAccounts: {} });
    });
    const store = stalwartSessionTokenStore({ jmapBaseUrl: BASE, fetch: fetchFn });
    const first = store.resolve('tok');
    store.reload();
    release();
    expect(await first).not.toBeNull();
    await store.resolve('tok');
    expect(calls).toBe(2);
  });
});
