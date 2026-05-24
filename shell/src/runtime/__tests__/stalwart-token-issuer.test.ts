/**
 * Tests for StalwartTokenIssuer — the default AgentTokenIssuer backed
 * by OIDC discovery and Stalwart's token/revocation/introspection
 * endpoints.
 *
 * All HTTP interactions are mocked via a custom `fetch` injected into
 * the factory. No network calls leave the test process.
 */

import { describe, expect, it, vi } from 'vitest';
import { inMemoryAgentMetadataStore } from '../agent-metadata-store.js';
import { stalwartTokenIssuer } from '../stalwart-token-issuer.js';

// ── Mock OIDC discovery response ──────────────────────────────────

const OIDC_CONFIG = {
  issuer: 'https://mail.example',
  token_endpoint: 'https://mail.example/auth/token',
  revocation_endpoint: 'https://mail.example/auth/revoke',
  introspection_endpoint: 'https://mail.example/auth/introspect',
};

const ISSUER_URL = 'https://mail.example';
const ADMIN_TOKEN = 'admin-bearer-token';

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Build a mock fetch that responds to discovery and a set of
 * endpoint-specific handlers.
 */
function mockFetch(
  handlers: Record<string, (req: Request) => Response | Promise<Response>>,
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req = new Request(url, init);

    // OIDC discovery
    if (url === `${ISSUER_URL}/.well-known/openid-configuration`) {
      return new Response(JSON.stringify(OIDC_CONFIG), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const handler = handlers[url];
    if (handler) return handler(req);

    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Fixed clock for deterministic expiry calculations. */
function fixedNow(): number {
  return Date.parse('2025-06-01T12:00:00Z');
}

describe('stalwartTokenIssuer', () => {
  it('discovers OIDC endpoints on first call and caches them', async () => {
    const store = inMemoryAgentMetadataStore();
    const fakeFetch = mockFetch({
      [OIDC_CONFIG.token_endpoint]: () =>
        new Response(
          JSON.stringify({
            access_token: 'tok-aaa',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'urn:ietf:params:jmap:mail',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const issuer = stalwartTokenIssuer({
      issuerUrl: ISSUER_URL,
      adminToken: ADMIN_TOKEN,
      metadataStore: store,
      fetch: fakeFetch,
      now: fixedNow,
    });

    // First call triggers discovery + token issue.
    await issuer.issueToken({
      name: 'agent-1',
      scopes: ['urn:ietf:params:jmap:mail'],
      lifetimeSec: 3600,
    });

    // Second call should reuse cached discovery.
    await issuer.issueToken({
      name: 'agent-2',
      scopes: ['urn:ietf:params:jmap:mail'],
      lifetimeSec: 3600,
    });

    // Only one discovery fetch, two token requests → total 3 calls.
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    const calls = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map(
      (c: unknown[]) =>
        typeof c[0] === 'string' ? c[0] : (c[0] as URL).href,
    );
    const discoveryCount = urls.filter((u: string) =>
      u.includes('.well-known/openid-configuration'),
    ).length;
    expect(discoveryCount).toBe(1);
  });

  it('issues a token via client_credentials grant', async () => {
    const store = inMemoryAgentMetadataStore();
    let capturedBody = '';
    let capturedAuthHeader = '';

    const fakeFetch = mockFetch({
      [OIDC_CONFIG.token_endpoint]: async (req) => {
        capturedAuthHeader = req.headers.get('authorization') ?? '';
        capturedBody = await req.text();
        return new Response(
          JSON.stringify({
            access_token: 'secret-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'urn:ietf:params:jmap:mail urn:ietf:params:jmap:submission',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const issuer = stalwartTokenIssuer({
      issuerUrl: ISSUER_URL,
      adminToken: ADMIN_TOKEN,
      metadataStore: store,
      fetch: fakeFetch,
      now: fixedNow,
    });

    const result = await issuer.issueToken({
      name: 'my-agent',
      scopes: ['urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:submission'],
      lifetimeSec: 3600,
    });

    // Verify request was correct.
    expect(capturedAuthHeader).toBe(`Bearer ${ADMIN_TOKEN}`);
    const params = new URLSearchParams(capturedBody);
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('scope')).toBe(
      'urn:ietf:params:jmap:mail urn:ietf:params:jmap:submission',
    );

    // Verify result shape.
    expect(result.tokenId).toBeTruthy();
    expect(result.clientId).toBe(result.tokenId);
    expect(result.clientSecret).toBe('secret-access-token');
    expect(result.expiresAt).toBe('2025-06-01T13:00:00.000Z');

    // Verify metadata was persisted.
    const meta = await store.get(result.tokenId);
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe('my-agent');
    expect(meta!.scopes).toEqual([
      'urn:ietf:params:jmap:mail',
      'urn:ietf:params:jmap:submission',
    ]);
    expect(meta!.revoked).toBe(false);
  });

  it('revokes a token via RFC 7009', async () => {
    const store = inMemoryAgentMetadataStore();
    let revokeBody = '';
    let revokeAuthHeader = '';

    const fakeFetch = mockFetch({
      [OIDC_CONFIG.token_endpoint]: () =>
        new Response(
          JSON.stringify({
            access_token: 'tok-to-revoke',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'urn:ietf:params:jmap:mail',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      [OIDC_CONFIG.revocation_endpoint]: async (req) => {
        revokeAuthHeader = req.headers.get('authorization') ?? '';
        revokeBody = await req.text();
        return new Response('', { status: 200 });
      },
    });

    const issuer = stalwartTokenIssuer({
      issuerUrl: ISSUER_URL,
      adminToken: ADMIN_TOKEN,
      metadataStore: store,
      fetch: fakeFetch,
      now: fixedNow,
    });

    // Issue first.
    const issued = await issuer.issueToken({
      name: 'revokable-agent',
      scopes: ['urn:ietf:params:jmap:mail'],
      lifetimeSec: 3600,
    });

    // Revoke.
    await issuer.revokeToken(issued.tokenId);

    // Verify revocation request.
    expect(revokeAuthHeader).toBe(`Bearer ${ADMIN_TOKEN}`);
    const params = new URLSearchParams(revokeBody);
    expect(params.get('token')).toBe('tok-to-revoke');
    expect(params.get('token_type_hint')).toBe('access_token');

    // Verify metadata is marked revoked.
    const meta = await store.get(issued.tokenId);
    expect(meta).not.toBeNull();
    expect(meta!.revoked).toBe(true);
  });

  it('introspects an active token', async () => {
    const store = inMemoryAgentMetadataStore();
    let introspectBody = '';

    // Pre-seed metadata so we can look up the name.
    await store.save({
      tokenId: 'agent-id-42',
      name: 'my-cool-agent',
      scopes: ['urn:ietf:params:jmap:mail'],
      issuedAt: '2025-06-01T12:00:00.000Z',
      expiresAt: '2025-06-01T13:00:00.000Z',
      revoked: false,
      issuanceLogEntryHash: '',
    });

    const fakeFetch = mockFetch({
      [OIDC_CONFIG.introspection_endpoint]: async (req) => {
        introspectBody = await req.text();
        return new Response(
          JSON.stringify({
            active: true,
            client_id: 'agent-id-42',
            scope: 'urn:ietf:params:jmap:mail',
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const issuer = stalwartTokenIssuer({
      issuerUrl: ISSUER_URL,
      adminToken: ADMIN_TOKEN,
      metadataStore: store,
      fetch: fakeFetch,
      now: fixedNow,
    });

    const result = await issuer.introspectToken('some-bearer-token');

    // Verify introspection request.
    const params = new URLSearchParams(introspectBody);
    expect(params.get('token')).toBe('some-bearer-token');

    // Verify result.
    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.agentId).toBe('agent-id-42');
    expect(result!.name).toBe('my-cool-agent');
    expect(result!.scopes).toEqual(['urn:ietf:params:jmap:mail']);
  });

  it('returns null for inactive token', async () => {
    const store = inMemoryAgentMetadataStore();
    const fakeFetch = mockFetch({
      [OIDC_CONFIG.introspection_endpoint]: () =>
        new Response(
          JSON.stringify({ active: false }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const issuer = stalwartTokenIssuer({
      issuerUrl: ISSUER_URL,
      adminToken: ADMIN_TOKEN,
      metadataStore: store,
      fetch: fakeFetch,
      now: fixedNow,
    });

    const result = await issuer.introspectToken('expired-token');

    expect(result).toBeNull();
  });

  it('listTokens delegates to metadata store', async () => {
    const store = inMemoryAgentMetadataStore();
    const fakeFetch = mockFetch({
      [OIDC_CONFIG.token_endpoint]: () =>
        new Response(
          JSON.stringify({
            access_token: `tok-${Date.now()}`,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'urn:ietf:params:jmap:mail',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const issuer = stalwartTokenIssuer({
      issuerUrl: ISSUER_URL,
      adminToken: ADMIN_TOKEN,
      metadataStore: store,
      fetch: fakeFetch,
      now: fixedNow,
    });

    await issuer.issueToken({
      name: 'agent-a',
      scopes: ['urn:ietf:params:jmap:mail'],
      lifetimeSec: 3600,
    });
    await issuer.issueToken({
      name: 'agent-b',
      scopes: ['urn:ietf:params:jmap:submission'],
      lifetimeSec: 7200,
    });

    const tokens = await issuer.listTokens();
    expect(tokens).toHaveLength(2);

    const names = tokens.map((t) => t.name);
    expect(names).toContain('agent-a');
    expect(names).toContain('agent-b');

    // Each entry has the expected shape.
    for (const t of tokens) {
      expect(t.tokenId).toBeTruthy();
      expect(typeof t.issuedAt).toBe('string');
      expect(typeof t.expiresAt).toBe('string');
      expect(typeof t.revoked).toBe('boolean');
      expect(Array.isArray(t.scopes)).toBe(true);
    }
  });
});
