/**
 * Stalwart-backed TokenStore (PR 36 / D-057).
 *
 * Agents present an OAuth access token issued by Stalwart (via the
 * webmail's "Agent tokens" form, which calls the OIDC token endpoint
 * with the `client_credentials` grant). The MCP server validates each
 * bearer at request time by POSTing to Stalwart's RFC 7662
 * introspection endpoint — no shared `tokens.json` file, no per-deploy
 * `IARSMA_AGENT_TOKEN`, no copy/paste step.
 *
 * The introspection response yields the agent's `client_id` (its
 * stable id), `scope` (granted scopes), and `active` (still valid /
 * not revoked / not expired). We surface that as a `ResolvedIdentity`
 * and pipe the agent's own bearer through as `stalwartApiKey`, so
 * downstream JMAP calls run with the agent's own permissions — never
 * an operator credential.
 *
 * Multi-tenant: each agent's token introspects to its own principal,
 * and the MCP server is stateless between requests. One server can
 * serve all mailboxes on a Stalwart host without per-user config.
 *
 * Caching: each successful introspection is held for `cacheTtlMs`
 * (default 30s) keyed by the SHA-256 of the bearer. Cache keys are
 * never logged; the store holds the raw token in memory for the TTL
 * so subsequent calls don't re-hit Stalwart's introspection endpoint.
 * Inactive results are also cached briefly so a revoked token doesn't
 * thrash the network — but the TTL stays short so revocations
 * propagate within seconds, not minutes.
 *
 * Operator credential: introspection itself requires admin auth at
 * Stalwart. The operator gives the MCP server one `adminToken` (the
 * `IARSMA_INTROSPECTION_ADMIN_TOKEN` env var); that token is NEVER
 * sent to agents and NEVER used for JMAP calls. Its sole job is to
 * authorize the introspection POSTs.
 */

import { createHash } from 'node:crypto';
import type { ResolvedIdentity, TokenEntry, TokenStore } from './token-store.js';
import { makeScopeSet } from './scope-filter.js';

// ── Options ───────────────────────────────────────────────────────

export type StalwartIntrospectionTokenStoreOptions = {
  /**
   * Stalwart base URL — the same value as `IARSMA_JMAP_BASE_URL`. The
   * store appends `/.well-known/openid-configuration` to discover the
   * introspection endpoint (RFC 8414 / OIDC discovery).
   */
  readonly issuerUrl: string;
  /**
   * Bearer the MCP server presents when calling Stalwart's
   * introspection endpoint. Operator-only — never given to agents.
   * Comes from `IARSMA_INTROSPECTION_ADMIN_TOKEN`.
   */
  readonly adminToken: string;
  /** Cache TTL for both active and inactive results. Default 30s. */
  readonly cacheTtlMs?: number;
  /** Override `fetch` for tests. */
  readonly fetch?: typeof fetch;
  /** Override clock for tests. Epoch millis. */
  readonly now?: () => number;
};

// ── Discovery types (subset) ──────────────────────────────────────

type OidcEndpoints = {
  readonly introspectionEndpoint: string;
};

type CachedResult =
  | { readonly kind: 'active'; readonly identity: ResolvedIdentity; readonly expiresAt: number }
  | { readonly kind: 'inactive'; readonly expiresAt: number };

// ── Factory ───────────────────────────────────────────────────────

export function stalwartIntrospectionTokenStore(
  opts: StalwartIntrospectionTokenStoreOptions,
): TokenStore {
  const {
    issuerUrl,
    adminToken,
    cacheTtlMs = 30_000,
    fetch: fetchFn = globalThis.fetch,
    now = Date.now,
  } = opts;

  let endpointsPromise: Promise<OidcEndpoints> | null = null;
  const cache = new Map<string, CachedResult>();

  async function discover(): Promise<OidcEndpoints> {
    const url = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const introspectionEndpoint = json['introspection_endpoint'];
    if (typeof introspectionEndpoint !== 'string') {
      throw new Error('OIDC discovery response missing introspection_endpoint');
    }
    return { introspectionEndpoint };
  }

  function getEndpoints(): Promise<OidcEndpoints> {
    if (endpointsPromise === null) {
      endpointsPromise = discover().catch((e) => {
        endpointsPromise = null;
        throw e;
      });
    }
    return endpointsPromise;
  }

  function cacheKey(bearer: string): string {
    return createHash('sha256').update(bearer).digest('hex');
  }

  async function introspect(bearer: string): Promise<ResolvedIdentity | null> {
    const endpoints = await getEndpoints();
    const body = new URLSearchParams({ token: bearer });
    const res = await fetchFn(endpoints.introspectionEndpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Token introspection failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    if (json['active'] !== true) return null;

    const clientId = json['client_id'];
    const scopeStr = json['scope'];
    const username = json['username'];
    if (typeof clientId !== 'string') {
      throw new Error('introspection response missing client_id for active token');
    }
    const scopes = typeof scopeStr === 'string'
      ? scopeStr.split(' ').filter((s) => s.length > 0)
      : [];
    const name = typeof username === 'string' && username.length > 0
      ? username
      : clientId;

    return {
      id: clientId,
      name,
      stalwartApiKey: bearer,
      scopes: makeScopeSet(scopes),
    };
  }

  return {
    async resolve(bearer: string): Promise<ResolvedIdentity | null> {
      const key = cacheKey(bearer);
      const hit = cache.get(key);
      if (hit !== undefined && hit.expiresAt > now()) {
        return hit.kind === 'active' ? hit.identity : null;
      }

      let identity: ResolvedIdentity | null;
      try {
        identity = await introspect(bearer);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[iarsma-mcp] introspection error:', e instanceof Error ? e.message : e);
        return null;
      }

      const expiresAt = now() + cacheTtlMs;
      if (identity === null) {
        cache.set(key, { kind: 'inactive', expiresAt });
      } else {
        cache.set(key, { kind: 'active', identity, expiresAt });
      }
      return identity;
    },
    reload(): void {
      cache.clear();
    },
    register(_entry: TokenEntry): void {
      // Stalwart owns the token lifecycle — issuance happens via the
      // webmail's IssueTokenForm calling Stalwart's OIDC token
      // endpoint. The introspection store is a read-only validator.
    },
    remove(_tokenId: string): TokenEntry | null {
      // Same — revocation is a webmail → Stalwart RFC 7009 call. The
      // cache will flip the token to inactive on its next refresh.
      return null;
    },
    list(): readonly TokenEntry[] {
      return [];
    },
  };
}
