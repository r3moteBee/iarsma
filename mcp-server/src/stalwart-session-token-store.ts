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
 * (revoked / unknown). Other errors (network, 5xx, unparseable body)
 * also fail closed as null + a log line, but are NOT cached: a Stalwart
 * blip must not lock every agent out for a whole TTL window.
 *
 * No operator credential. The agent's own bearer is the validator —
 * the MCP server is fully stateless multi-tenant, with no shared
 * secret of its own. Caching mirrors the introspection store: a
 * short TTL (30s default) keyed by SHA-256 of the bearer, so
 * revocation propagates within seconds but successive calls don't
 * thrash the network. The cache is bounded (`maxCacheEntries`, oldest
 * evicted first, expired entries swept on overflow), and concurrent
 * lookups of the same bearer share one in-flight validation.
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
  /**
   * Cache TTL for valid lookups and for definitive rejections
   * (401/403). Transient failures are never cached. Default 30s.
   */
  readonly cacheTtlMs?: number;
  /** Max cached bearers; the oldest entry is evicted past it. Default 10 000. */
  readonly maxCacheEntries?: number;
  /**
   * Upstream validation timeout. A timeout is a transient failure
   * (request rejected, nothing cached). Default 10s.
   */
  readonly validateTimeoutMs?: number;
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

/**
 * Outcome of one validation round-trip. `invalid` is a definitive
 * answer from Stalwart; `error` is anything transient.
 */
type Validation =
  | { readonly kind: 'valid'; readonly identity: ResolvedIdentity }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'error' };

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
    maxCacheEntries = 10_000,
    validateTimeoutMs = 10_000,
  } = opts;

  // Insertion-ordered, so the first key is always the oldest entry.
  const cache = new Map<string, CachedResult>();
  // Single-flight: one upstream validation per bearer at a time.
  const inflight = new Map<string, Promise<ResolvedIdentity | null>>();
  // Bumped by reload(); a validation started before a reload must not
  // repopulate the freshly cleared cache.
  let generation = 0;
  const sessionUrl = `${jmapBaseUrl.replace(/\/$/, '')}/.well-known/jmap`;

  function cacheKey(bearer: string): string {
    return createHash('sha256').update(bearer).digest('hex');
  }

  function remember(key: string, entry: CachedResult): void {
    cache.delete(key);
    if (cache.size >= maxCacheEntries) {
      const t = now();
      for (const [k, v] of cache) {
        if (v.expiresAt <= t) cache.delete(k);
      }
    }
    while (cache.size >= maxCacheEntries) {
      const oldest = cache.keys().next().value as string;
      cache.delete(oldest);
    }
    cache.set(key, entry);
  }

  async function validate(bearer: string): Promise<Validation> {
    let res: Response;
    try {
      res = await fetchFn(sessionUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${bearer}`,
        },
        // Without a bound, a hung Stalwart would hang every caller
        // sharing this single-flight lookup.
        signal: AbortSignal.timeout(validateTimeoutMs),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(
        '[iarsma-mcp] session-validate fetch failed:',
        e instanceof Error ? e.message : e,
      );
      return { kind: 'error' };
    }
    if (res.status === 401 || res.status === 403) return { kind: 'invalid' };
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[iarsma-mcp] session-validate non-OK ${res.status} ${res.statusText} — rejecting this request (not cached)`,
      );
      return { kind: 'error' };
    }
    let body: StalwartSessionResponse;
    try {
      body = (await res.json()) as StalwartSessionResponse;
    } catch {
      // eslint-disable-next-line no-console
      console.error('[iarsma-mcp] session-validate returned an unparseable body (not cached)');
      return { kind: 'error' };
    }
    const username = body.username ?? 'unknown';
    // The bearer itself is the stable identifier — agents share the
    // same username (the principal email), so we hash the bearer to
    // get an opaque per-token id for audit attribution.
    const id = cacheKey(bearer).slice(0, 16);
    return {
      kind: 'valid',
      identity: {
        id,
        name: username,
        stalwartApiKey: bearer,
        scopes,
      },
    };
  }

  return {
    async resolve(bearer: string): Promise<ResolvedIdentity | null> {
      const key = cacheKey(bearer);
      const hit = cache.get(key);
      if (hit !== undefined) {
        if (hit.expiresAt > now()) {
          return hit.kind === 'valid' ? hit.identity : null;
        }
        cache.delete(key);
      }
      const pending = inflight.get(key);
      if (pending !== undefined) return pending;

      const startedIn = generation;
      const lookup = validate(bearer)
        .then((result) => {
          if (generation === startedIn && result.kind !== 'error') {
            const expiresAt = now() + cacheTtlMs;
            remember(
              key,
              result.kind === 'valid'
                ? { kind: 'valid', identity: result.identity, expiresAt }
                : { kind: 'invalid', expiresAt },
            );
          }
          return result.kind === 'valid' ? result.identity : null;
        })
        .finally(() => {
          if (inflight.get(key) === lookup) inflight.delete(key);
        });
      inflight.set(key, lookup);
      return lookup;
    },
    reload(): void {
      generation++;
      cache.clear();
      inflight.clear();
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
