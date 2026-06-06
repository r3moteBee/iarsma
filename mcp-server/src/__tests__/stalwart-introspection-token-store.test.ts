import { describe, expect, it, vi } from 'vitest';
import { stalwartIntrospectionTokenStore } from '../stalwart-introspection-token-store.js';

const ISSUER = 'https://sw-mail.example.test';
const INTROSPECT_URL = `${ISSUER}/oauth/introspect`;
const DISCOVERY_BODY = {
  issuer: ISSUER,
  introspection_endpoint: INTROSPECT_URL,
};

function makeFetch(
  routes: ReadonlyMap<string, (init: RequestInit | undefined) => Response | Promise<Response>>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = routes.get(url);
    if (handler === undefined) {
      throw new Error(`unmocked fetch: ${url}`);
    }
    return handler(init);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('stalwartIntrospectionTokenStore', () => {
  it('resolves an active token to a ResolvedIdentity with scopes', async () => {
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse(DISCOVERY_BODY)],
      [INTROSPECT_URL, () => jsonResponse({
        active: true,
        client_id: 'agent-uuid-1',
        username: 'brent',
        scope: 'mail:read mail:send',
      })],
    ]));
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'admin-tok',
      fetch: fetchFn,
    });
    const id = await store.resolve('agent-bearer-abc');
    expect(id).not.toBeNull();
    expect(id!.id).toBe('agent-uuid-1');
    expect(id!.name).toBe('brent');
    expect(id!.stalwartApiKey).toBe('agent-bearer-abc');
    expect(id!.scopes.has('mail:read')).toBe(true);
    expect(id!.scopes.has('mail:send')).toBe(true);
    expect(id!.scopes.has('mail:modify')).toBe(false);
  });

  it('returns null for an inactive token', async () => {
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse(DISCOVERY_BODY)],
      [INTROSPECT_URL, () => jsonResponse({ active: false })],
    ]));
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'admin-tok',
      fetch: fetchFn,
    });
    expect(await store.resolve('revoked-tok')).toBeNull();
  });

  it('multi-tenant: different bearers introspect to different principals', async () => {
    let calls = 0;
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse(DISCOVERY_BODY)],
      [INTROSPECT_URL, async (init) => {
        calls++;
        const body = String(init?.body ?? '');
        if (body.includes('alice-bearer')) {
          return jsonResponse({
            active: true,
            client_id: 'agent-alice',
            username: 'alice',
            scope: 'mail:read',
          });
        }
        if (body.includes('bob-bearer')) {
          return jsonResponse({
            active: true,
            client_id: 'agent-bob',
            username: 'bob',
            scope: 'mail:send',
          });
        }
        return jsonResponse({ active: false });
      }],
    ]));
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'admin-tok',
      fetch: fetchFn,
    });

    const alice = await store.resolve('alice-bearer');
    const bob = await store.resolve('bob-bearer');

    expect(alice?.id).toBe('agent-alice');
    expect(alice?.stalwartApiKey).toBe('alice-bearer');
    expect(alice?.scopes.has('mail:read')).toBe(true);
    expect(alice?.scopes.has('mail:send')).toBe(false);

    expect(bob?.id).toBe('agent-bob');
    expect(bob?.stalwartApiKey).toBe('bob-bearer');
    expect(bob?.scopes.has('mail:send')).toBe(true);
    expect(bob?.scopes.has('mail:read')).toBe(false);

    expect(calls).toBe(2);
  });

  it('caches active introspections inside the TTL window', async () => {
    let introspectCalls = 0;
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse(DISCOVERY_BODY)],
      [INTROSPECT_URL, () => {
        introspectCalls++;
        return jsonResponse({
          active: true,
          client_id: 'agent-uuid-1',
          scope: 'mail:read',
        });
      }],
    ]));
    let nowMs = 1_000_000;
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'admin-tok',
      cacheTtlMs: 30_000,
      fetch: fetchFn,
      now: () => nowMs,
    });
    await store.resolve('tok-cache');
    await store.resolve('tok-cache');
    expect(introspectCalls).toBe(1);

    // Advance past TTL: cache miss → another network call.
    nowMs += 31_000;
    await store.resolve('tok-cache');
    expect(introspectCalls).toBe(2);
  });

  it('caches inactive introspections so revoked tokens do not thrash the network', async () => {
    let introspectCalls = 0;
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse(DISCOVERY_BODY)],
      [INTROSPECT_URL, () => {
        introspectCalls++;
        return jsonResponse({ active: false });
      }],
    ]));
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'admin-tok',
      fetch: fetchFn,
    });
    expect(await store.resolve('revoked')).toBeNull();
    expect(await store.resolve('revoked')).toBeNull();
    expect(introspectCalls).toBe(1);
  });

  it('reload() clears the cache so subsequent resolves re-introspect', async () => {
    let introspectCalls = 0;
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse(DISCOVERY_BODY)],
      [INTROSPECT_URL, () => {
        introspectCalls++;
        return jsonResponse({
          active: true,
          client_id: 'agent-uuid-1',
          scope: 'mail:read',
        });
      }],
    ]));
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'admin-tok',
      fetch: fetchFn,
    });
    await store.resolve('tok');
    store.reload();
    await store.resolve('tok');
    expect(introspectCalls).toBe(2);
  });

  it('returns null when introspection HTTP errors (fails closed)', async () => {
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse(DISCOVERY_BODY)],
      [INTROSPECT_URL, () => new Response('boom', { status: 500 })],
    ]));
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'admin-tok',
      fetch: fetchFn,
    });
    expect(await store.resolve('tok')).toBeNull();
  });

  it('throws on a discovery response missing introspection_endpoint', async () => {
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse({ issuer: ISSUER })],
      [INTROSPECT_URL, () => jsonResponse({ active: true, client_id: 'x' })],
    ]));
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'admin-tok',
      fetch: fetchFn,
    });
    // Failure during discovery surfaces as null via the catch in resolve().
    expect(await store.resolve('tok')).toBeNull();
  });

  it('sends the admin token in the introspection request', async () => {
    let observedAuth: string | undefined;
    const fetchFn = makeFetch(new Map([
      [`${ISSUER}/.well-known/openid-configuration`, () => jsonResponse(DISCOVERY_BODY)],
      [INTROSPECT_URL, (init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        observedAuth = headers['authorization'];
        return jsonResponse({
          active: true,
          client_id: 'agent-uuid-1',
          scope: 'mail:read',
        });
      }],
    ]));
    const store = stalwartIntrospectionTokenStore({
      issuerUrl: ISSUER,
      adminToken: 'op-admin-token-xyz',
      fetch: fetchFn,
    });
    await store.resolve('any-bearer');
    expect(observedAuth).toBe('Bearer op-admin-token-xyz');
  });
});
