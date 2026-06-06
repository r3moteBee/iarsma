/**
 * Stalwart session-validated TokenStore (PR 39 / D-058).
 *
 * Replaces `stalwartIntrospectionTokenStore` (PR 36) for deploys
 * where agents present Stalwart **API keys** rather than OAuth
 * access tokens. API keys aren't introspectable through the OAuth
 * endpoint, but they ARE valid JMAP bearers — so the natural
 * validation is to make a JMAP call and check the response.
 *
 * Validation: GET `/.well-known/jmap` with the agent's bearer. A 200
 * means the key is valid and unrevoked; the response also carries
 * the principal's username and primary mail account id, which we
 * surface as the agent's identity. 401/403 → token is null
 * (revoked / unknown). Other errors propagate as null + a log line.
 *
 * No operator credential. The agent's own bearer is the validator —
 * the MCP server is fully stateless multi-tenant, with no shared
 * secret of its own. Caching mirrors the introspection store: a
 * short TTL (30s default) keyed by SHA-256 of the bearer, so
 * revocation propagates within seconds but successive calls don't
 * thrash the network.
 *
 * Scopes: the JMAP session endpoint doesn't expose the bearer's
 * Stalwart permission set, so this store returns an empty scope set.
 * Tools are listed permissively at the MCP layer; the actual
 * authorization gate is Stalwart enforcing the API key's
 * Replace-mode permissions on each JMAP method call.
 */

import { createHash } from 'node:crypto';
import { makeScopeSet, type ScopeSet } from './scope-filter.js';
import { TOOL_SCOPES } from './tool-scopes.js';
import type { ResolvedIdentity, TokenEntry, TokenStore } from './token-store.js';

export type StalwartSessionTokenStoreOptions = {
  /** Stalwart base URL (same value as `IARSMA_JMAP_BASE_URL`). */
  readonly jmapBaseUrl: string;
  /** Cache TTL for both valid and invalid lookups. Default 30s. */
  readonly cacheTtlMs?: number;
  /** Override `fetch` for tests. */
  readonly fetch?: typeof fetch;
  /** Override clock for tests. Epoch millis. */
  readonly now?: () => number;
  /**
   * Scope set the identity carries. Default (PR 39 / D-058): every
   * scope iarsma's tool registry knows about, so the dispatcher's
   * scope gate passes through and Stalwart enforces the real
   * permission set on each JMAP method call. Tests pass a narrower
   * set to exercise the dispatcher's denial path.
   */
  readonly scopes?: ScopeSet;
};

/** All distinct scope strings the MCP server's tool registry uses. */
const ALL_KNOWN_SCOPES: ScopeSet = makeScopeSet(
  [...new Set(Object.values(TOOL_SCOPES))],
);

type CachedResult =
  | { readonly kind: 'valid'; readonly identity: ResolvedIdentity; readonly expiresAt: number }
  | { readonly kind: 'invalid'; readonly expiresAt: number };

type StalwartSessionResponse = {
  readonly username?: string;
  readonly primaryAccounts?: Readonly<Record<string, string>>;
};

export function stalwartSessionTokenStore(
  opts: StalwartSessionTokenStoreOptions,
): TokenStore {
  const {
    jmapBaseUrl,
    cacheTtlMs = 30_000,
    fetch: fetchFn = globalThis.fetch,
    now = Date.now,
    scopes = ALL_KNOWN_SCOPES,
  } = opts;

  const cache = new Map<string, CachedResult>();
  const sessionUrl = `${jmapBaseUrl.replace(/\/$/, '')}/.well-known/jmap`;

  function cacheKey(bearer: string): string {
    return createHash('sha256').update(bearer).digest('hex');
  }

  async function validate(bearer: string): Promise<ResolvedIdentity | null> {
    let res: Response;
    try {
      res = await fetchFn(sessionUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${bearer}`,
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        '[iarsma-mcp] session-validate fetch failed:',
        e instanceof Error ? e.message : e,
      );
      return null;
    }
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[iarsma-mcp] session-validate non-OK ${res.status} ${res.statusText} — treating as invalid`,
      );
      return null;
    }
    let body: StalwartSessionResponse;
    try {
      body = (await res.json()) as StalwartSessionResponse;
    } catch {
      return null;
    }
    const username = body.username ?? 'unknown';
    // The bearer itself is the stable identifier — agents share the
    // same username (the principal email), so we hash the bearer to
    // get an opaque per-token id for audit attribution.
    const id = cacheKey(bearer).slice(0, 16);
    return {
      id,
      name: username,
      stalwartApiKey: bearer,
      scopes,
    };
  }

  return {
    async resolve(bearer: string): Promise<ResolvedIdentity | null> {
      const key = cacheKey(bearer);
      const hit = cache.get(key);
      if (hit !== undefined && hit.expiresAt > now()) {
        return hit.kind === 'valid' ? hit.identity : null;
      }
      const identity = await validate(bearer);
      const expiresAt = now() + cacheTtlMs;
      if (identity === null) {
        cache.set(key, { kind: 'invalid', expiresAt });
      } else {
        cache.set(key, { kind: 'valid', identity, expiresAt });
      }
      return identity;
    },
    reload(): void {
      cache.clear();
    },
    register(_entry: TokenEntry): void {
      // Stalwart owns token lifecycle. The webmail's
      // stalwartApiKeyIssuer creates keys directly via x:ApiKey/set;
      // this store has nothing to persist.
    },
    remove(_tokenId: string): TokenEntry | null {
      return null;
    },
    list(): readonly TokenEntry[] {
      return [];
    },
  };
}
