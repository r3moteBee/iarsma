/**
 * Session lifecycle glue between the token layer (`oauth.ts`) and the
 * per-user capability cache (D-051), shared by every shell surface that
 * needs a Bearer token (invoker, push stream, approval store).
 *
 *   - `getAuthToken` — `getAccessToken` with one shared refresh per tab.
 *   - `onUnauthorized` — after a 401, force one refresh before giving up.
 *   - Whenever the token layer ends the session (refresh token rejected or
 *     missing, signed out in another tab), the capability cache is cleared
 *     before the UI is told, so the next account signed in on this browser
 *     never sees the previous one's rows.
 *
 * Transient refresh failures keep the tokens: `getAuthToken` rejects with a
 * retryable `refresh_failed`, `onUnauthorized` logs and keeps the session.
 */

import type { AuthStorage } from './auth-storage.js';
import type { CacheStorage } from './cache-storage.js';
import { getAccessToken, refreshAfterUnauthorized, type OAuthDeps } from './oauth.js';

export type AuthTokenAccessOptions = {
  /** Config, storage and test overrides passed to the token layer. Its
   *  `onSessionEnded` / `onAccountChanged` are replaced by the ones below. */
  readonly oauth: OAuthDeps & { readonly storage: AuthStorage };
  readonly cache: Pick<CacheStorage, 'clearAll'>;
  /** The session ended and the cache is cleared — re-render signed out. */
  readonly onSessionEnded: () => void;
  /** Another tab signed in a different account (see `OAuthDeps`). */
  readonly onAccountChanged: () => void;
};

export type AuthTokenAccess = {
  readonly getAuthToken: () => Promise<string | null>;
  /** Fire-and-forget from callers' point of view; resolves when settled. */
  readonly onUnauthorized: () => Promise<void>;
};

export function createAuthTokenAccess(opts: AuthTokenAccessOptions): AuthTokenAccess {
  const deps: OAuthDeps = {
    ...opts.oauth,
    onSessionEnded: async () => {
      await clearCapabilityCache(opts.cache);
      opts.onSessionEnded();
    },
    onAccountChanged: opts.onAccountChanged,
  };
  return {
    getAuthToken: () => getAccessToken(deps),
    onUnauthorized: async () => {
      try {
        await refreshAfterUnauthorized(deps);
      } catch (e) {
        // Token endpoint unreachable — keep the session; the next call
        // retries the refresh.
        // eslint-disable-next-line no-console
        console.warn('[iarsma] refresh after 401 failed; keeping session:', e);
      }
    },
  };
}

/**
 * Drop every cached capability result (D-051). Best-effort: owner scoping
 * in `cachedInvoker` is the second line of defense if this fails.
 */
export async function clearCapabilityCache(cache: Pick<CacheStorage, 'clearAll'>): Promise<void> {
  try {
    await cache.clearAll();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[iarsma] failed to clear capability cache:', e);
  }
}
