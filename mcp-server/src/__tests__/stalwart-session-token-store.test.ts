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
});
