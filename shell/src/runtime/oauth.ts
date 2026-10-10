/**
 * OIDC + OAuth 2.1 PKCE flow for the shell, against a public client
 * (D-039). Wraps `oauth4webapi` (D-040) — keep this module narrow so the
 * `oauth4webapi` import stays contained.
 *
 * Flow:
 *   1. `startSignIn(deps)` — discover endpoints (cached), generate PKCE,
 *      stash verifier + nonce under a `state` key, redirect to authorize.
 *   2. Stalwart redirects back to `redirectUri?code=...&state=...`.
 *   3. `handleCallback(deps)` — pull PKCE by state, POST token endpoint,
 *      validate id_token, store tokens, return to caller for navigation.
 *   4. `getAccessToken(deps)` — return current access token; refresh if
 *      expired and a refresh_token is available.
 *   5. `signOut(deps)` — clear tokens + any in-flight PKCE.
 *
 * Refresh lifecycle (`getAccessToken`, `refreshAfterUnauthorized`):
 *   - One refresh in flight per storage instance; concurrent callers (read
 *     hooks, the push stream, the approval store) share its promise, so an
 *     expiry triggers exactly one token-endpoint POST per tab.
 *   - Across tabs the refresh runs under a Web Lock, and the record is
 *     re-read from the persistent backing inside it: another tab may already
 *     have refreshed and rotated the refresh token. Two tabs never spend the
 *     same refresh token (with reuse detection that revokes the session).
 *   - The token request times out, so a request hung by sleep / network
 *     change can't stall every caller sharing the refresh.
 *   - Tokens are cleared only when the token endpoint rejects the grant
 *     (400 / 401 / `invalid_grant`) or no refresh token exists. Network
 *     errors and 5xx keep the tokens and reject with `refresh_failed` so
 *     the caller can retry (e.g. a laptop waking from sleep before Wi-Fi).
 */

import * as oauth from 'oauth4webapi';
import type { ShellConfig } from '../config.js';
import {
  sessionAuthStorage,
  type AuthStorage,
  type StoredPkce,
  type StoredTokens,
} from './auth-storage.js';

export type OAuthError = {
  code:
    | 'discovery_failed'
    | 'invalid_callback'
    | 'pkce_mismatch'
    | 'token_exchange_failed'
    | 'id_token_invalid'
    | 'refresh_failed'
    | 'refresh_rejected'
    | 'no_storage';
  message: string;
};

export type OAuthDeps = {
  readonly config: ShellConfig;
  /** Override storage for tests (defaults to sessionStorage). */
  readonly storage?: AuthStorage;
  /** Override fetch for tests. */
  readonly fetch?: typeof fetch;
  /** Override window.location for tests. */
  readonly redirect?: (url: string) => void;
  /** Override Date.now for tests. */
  readonly now?: () => number;
  /**
   * Called when the refresh path concludes the session is over and has
   * cleared the tokens (refresh token rejected or missing, or the record was
   * removed by another tab). The shell uses it to drop per-user cached data
   * and flip to the signed-out view. Concurrent callers share one refresh,
   * so this runs once per ended session, with the hook of the caller that
   * started that refresh.
   */
  readonly onSessionEnded?: () => void | Promise<void>;
  /**
   * Called when re-reading the shared record shows a different account than
   * the one this tab was using (someone signed in from another tab). The
   * tokens are left alone — they belong to the other account's live
   * session — and the refresh resolves null. The shell reloads the page so
   * it boots cleanly as the new account instead of acting on one account's
   * on-screen state with the other's credentials.
   */
  readonly onAccountChanged?: () => void | Promise<void>;
  /** Override the cross-tab refresh lock for tests (defaults to Web Locks). */
  readonly refreshLock?: RefreshLock;
  /** Override the token-request timeout for tests. */
  readonly refreshTimeoutMs?: number;
};

/** Runs `fn` while holding a lock shared by every tab of the origin. */
export type RefreshLock = <T>(fn: () => Promise<T>) => Promise<T>;

type DiscoveredAs = oauth.AuthorizationServer;

/** Per-issuer discovery cache. Spans calls within a single page lifetime. */
const discoveryCache = new Map<string, Promise<DiscoveredAs>>();

/** Test-only — drops the cache. */
export function _resetDiscoveryCacheForTests(): void {
  discoveryCache.clear();
}

async function discover(deps: OAuthDeps): Promise<DiscoveredAs> {
  const issuer = deps.config.oidcIssuer;
  const cached = discoveryCache.get(issuer);
  if (cached !== undefined) return cached;
  const promise = (async () => {
    const issuerUrl = new URL(issuer);
    const fetchOpts = makeFetchOpts(deps) as Parameters<typeof oauth.discoveryRequest>[1];
    let response: Response;
    try {
      response =
        fetchOpts === undefined
          ? await oauth.discoveryRequest(issuerUrl)
          : await oauth.discoveryRequest(issuerUrl, fetchOpts);
    } catch (e) {
      throw makeError('discovery_failed', `OIDC discovery fetch failed: ${describe(e)}`);
    }
    try {
      return await oauth.processDiscoveryResponse(issuerUrl, response);
    } catch (e) {
      throw makeError('discovery_failed', `OIDC discovery response invalid: ${describe(e)}`);
    }
  })();
  discoveryCache.set(issuer, promise);
  promise.catch(() => discoveryCache.delete(issuer));
  return promise;
}

/**
 * Build the optional `[customFetch]` options bag if a fetch override was
 * supplied; otherwise return undefined and let oauth4webapi use its
 * built-in `globalThis.fetch`. The wrapper adapts our standard-fetch
 * test doubles to oauth4webapi v3's `(url, options)` signature. The
 * return type is `unknown` because oauth4webapi parameterizes
 * `customFetch` by HTTP method and body type per call site; one helper
 * services discovery (GET), token (POST), and refresh (POST) by widening
 * here and letting each call site narrow.
 */
function makeFetchOpts(deps: OAuthDeps): unknown {
  if (deps.fetch === undefined) return undefined;
  const userFetch = deps.fetch;
  const customFetchImpl = async (
    url: string,
    options: {
      readonly method: string;
      readonly headers: Headers;
      readonly body?: BodyInit | null;
      readonly signal?: AbortSignal;
    },
  ): Promise<Response> => {
    const init: RequestInit = {
      method: options.method,
      headers: options.headers,
    };
    if (options.body !== undefined && options.body !== null) init.body = options.body;
    if (options.signal !== undefined) init.signal = options.signal;
    return userFetch(url, init);
  };
  return { [oauth.customFetch]: customFetchImpl };
}

function client(config: ShellConfig): oauth.Client {
  return {
    client_id: config.clientId,
    token_endpoint_auth_method: 'none',
  };
}

/**
 * Start the sign-in flow. Generates PKCE + state + nonce, stashes them,
 * redirects the browser to the authorization endpoint. Does not return
 * (the browser navigates away).
 */
export async function startSignIn(deps: OAuthDeps): Promise<never> {
  const storage = deps.storage ?? sessionAuthStorage();
  const now = deps.now ?? Date.now;
  const as = await discover(deps);

  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const state = oauth.generateRandomState();
  const nonce = oauth.generateRandomNonce();

  const pkce: StoredPkce = {
    state,
    codeVerifier,
    nonce,
    redirectUri: deps.config.redirectUri,
    startedAtMs: now(),
  };
  await storage.savePkce(state, pkce);

  const url = new URL(as.authorization_endpoint!);
  url.searchParams.set('client_id', deps.config.clientId);
  url.searchParams.set('redirect_uri', deps.config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid offline_access');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  const redirect = deps.redirect ?? defaultRedirect;
  redirect(url.toString());
  // The redirect navigates away; this throw is unreachable in production
  // but appeases the `Promise<never>` return type for tests where
  // `redirect` is mocked.
  throw makeError('invalid_callback', 'startSignIn redirect did not navigate');
}

/**
 * Run the callback half: validate the redirected URL, exchange the code,
 * validate the id_token, and persist tokens. Idempotent on a clean URL —
 * if there's no `code` param, returns null without throwing.
 */
export async function handleCallback(
  deps: OAuthDeps,
  callbackUrl: URL,
): Promise<StoredTokens | null> {
  const storage = deps.storage ?? sessionAuthStorage();
  const now = deps.now ?? Date.now;
  const as = await discover(deps);
  const c = client(deps.config);

  // Defer state-validation to our PKCE store: oauth4webapi accepts the
  // URL with `skipStateCheck`, we then resolve the value against storage
  // ourselves. That keeps the "where did this state come from" check
  // against our own persisted record (constant-time-equal-by-key).
  let params: URLSearchParams;
  try {
    params = oauth.validateAuthResponse(as, c, callbackUrl, oauth.skipStateCheck);
  } catch (e) {
    throw makeError('invalid_callback', `auth response invalid: ${describe(e)}`);
  }
  if (params.get('code') === null) {
    return null;
  }
  const stateInUrl = params.get('state');
  if (stateInUrl === null) {
    throw makeError('invalid_callback', 'callback URL missing state parameter');
  }

  const pkce = await storage.takePkce(stateInUrl);
  if (pkce === null) {
    throw makeError(
      'pkce_mismatch',
      'no PKCE state matches the callback `state` — flow expired or replayed',
    );
  }

  const fetchOpts = makeFetchOpts(deps) as Parameters<
    typeof oauth.authorizationCodeGrantRequest
  >[6];

  let response: Response;
  try {
    response =
      fetchOpts === undefined
        ? await oauth.authorizationCodeGrantRequest(
            as,
            c,
            oauth.None(),
            params,
            pkce.redirectUri,
            pkce.codeVerifier,
          )
        : await oauth.authorizationCodeGrantRequest(
            as,
            c,
            oauth.None(),
            params,
            pkce.redirectUri,
            pkce.codeVerifier,
            fetchOpts,
          );
  } catch (e) {
    throw makeError('token_exchange_failed', `token exchange fetch failed: ${describe(e)}`);
  }

  let result: oauth.TokenEndpointResponse;
  try {
    result = await oauth.processAuthorizationCodeResponse(as, c, response, {
      expectedNonce: pkce.nonce,
    });
  } catch (e) {
    throw makeError('id_token_invalid', `token / id_token validation failed: ${describe(e)}`);
  }

  const claims = oauth.getValidatedIdTokenClaims(result);
  const issuedAt = now();
  const tokens: StoredTokens = {
    accessToken: result.access_token,
    expiresAtMs: issuedAt + (result.expires_in ?? 0) * 1000,
    obtainedAtMs: issuedAt,
    ...(result.refresh_token !== undefined ? { refreshToken: result.refresh_token } : {}),
    ...(result.id_token !== undefined ? { idToken: result.id_token } : {}),
    ...(claims?.['sub'] !== undefined && typeof claims['sub'] === 'string'
      ? { subject: claims['sub'] }
      : {}),
    ...(claims?.['email'] !== undefined && typeof claims['email'] === 'string'
      ? { email: claims['email'] }
      : {}),
  };
  await storage.saveTokens(tokens);
  return tokens;
}

/** Treat the access token as expired this early, to avoid clock-skew /
 *  network-latency 401s. */
const EXPIRY_SKEW_MS = 30_000;

/**
 * A 401 on an access token obtained this recently is attributed to a
 * request that still carried its predecessor, not to the new token being
 * rejected, so it does not trigger another refresh. Bounds the 401 → refresh
 * → 401 cycle to one refresh per window when the server keeps rejecting
 * fresh tokens.
 */
const UNAUTHORIZED_GRACE_MS = 10_000;

/** Abort a token request that hasn't answered in this long (retryable). */
const REFRESH_TIMEOUT_MS = 20_000;

const REFRESH_LOCK_NAME = 'iarsma.auth.refresh';

/** Web Locks when available; otherwise (Node tests, old browsers) none. */
function defaultRefreshLock(): RefreshLock {
  const locks =
    typeof navigator !== 'undefined'
      ? (navigator as { locks?: LockManager }).locks
      : undefined;
  if (locks === undefined) return (fn) => fn();
  // lib.dom types `request` as Promise<Promise<T>> for an async callback;
  // at runtime it resolves with the callback's settled value.
  return <T>(fn: () => Promise<T>) =>
    locks.request(REFRESH_LOCK_NAME, fn) as unknown as Promise<T>;
}

/** In-flight refresh per storage instance (see module doc). */
const refreshInFlight = new WeakMap<AuthStorage, Promise<string | null>>();

/**
 * Return the current access token, refreshing if expired (and a refresh
 * token is available). Returns null when no session exists or the
 * refresh token was rejected (tokens are then cleared and
 * `deps.onSessionEnded` runs). Rejects with an `OAuthError`
 * (`refresh_failed` / `discovery_failed`) when the refresh could not be
 * completed for a transient reason; tokens are kept and a later call
 * retries.
 */
export async function getAccessToken(deps: OAuthDeps): Promise<string | null> {
  const storage = deps.storage ?? sessionAuthStorage();
  const now = deps.now ?? Date.now;
  const tokens = storage.loadTokens();
  if (tokens === null) return null;
  // A refresh in flight (possibly forced by a 401 on the token we hold)
  // supersedes the cached token — don't hand out one the server rejected.
  const pending = refreshInFlight.get(storage);
  if (pending !== undefined) return pending;
  if (isFresh(tokens, now())) return tokens.accessToken;
  return sharedRefresh(deps, storage, false);
}

/**
 * Recover from a 401 on a resource request: force one refresh before
 * giving up on the session. Returns the access token to use from now on,
 * or null when the session is over (tokens cleared, `onSessionEnded` ran).
 * Rejects like `getAccessToken` on transient failures (tokens kept).
 *
 * A token obtained within `UNAUTHORIZED_GRACE_MS` (by this tab or another)
 * is returned as-is instead of being refreshed again.
 */
export async function refreshAfterUnauthorized(deps: OAuthDeps): Promise<string | null> {
  const storage = deps.storage ?? sessionAuthStorage();
  // Already signed out in this tab — nothing to recover, nothing to end.
  if (storage.loadTokens() === null) return null;
  return sharedRefresh(deps, storage, true);
}

function isFresh(tokens: StoredTokens, nowMs: number): boolean {
  return nowMs < tokens.expiresAtMs - EXPIRY_SKEW_MS;
}

function sharedRefresh(
  deps: OAuthDeps,
  storage: AuthStorage,
  afterUnauthorized: boolean,
): Promise<string | null> {
  const existing = refreshInFlight.get(storage);
  if (existing !== undefined) return existing;
  const lock = deps.refreshLock ?? defaultRefreshLock();
  const promise = lock(() => runRefresh(deps, storage, afterUnauthorized));
  refreshInFlight.set(storage, promise);
  const release = () => {
    if (refreshInFlight.get(storage) === promise) refreshInFlight.delete(storage);
  };
  promise.then(release, release);
  return promise;
}

async function runRefresh(
  deps: OAuthDeps,
  storage: AuthStorage,
  afterUnauthorized: boolean,
): Promise<string | null> {
  const now = deps.now ?? Date.now;
  const held = storage.loadTokens();
  // Another tab may have refreshed (rotating the refresh token we hold in
  // memory) or signed out since this tab hydrated. Spending a stale refresh
  // token would get `invalid_grant` and sign every tab out.
  const latest = await storage.reloadTokens();
  if (latest === null) return endSession(deps, storage);
  if (held !== null && isDifferentAccount(held, latest)) {
    await runHook(deps.onAccountChanged);
    return null;
  }
  if (afterUnauthorized) {
    const obtainedAt = latest.obtainedAtMs;
    if (
      obtainedAt !== undefined &&
      now() - obtainedAt < UNAUTHORIZED_GRACE_MS &&
      isFresh(latest, now())
    ) {
      return latest.accessToken;
    }
  } else if (isFresh(latest, now())) {
    return latest.accessToken;
  }
  if (latest.refreshToken === undefined) return endSession(deps, storage);
  try {
    const refreshed = await refreshTokens(deps, latest.refreshToken);
    return refreshed.accessToken;
  } catch (e) {
    if (!isOAuthError(e) || e.code !== 'refresh_rejected') throw e;
    // A tab racing us may have rotated the token between our re-read and
    // our POST; its rotation is what got ours rejected. Use its result.
    const raced = await storage.reloadTokens();
    if (
      raced !== null &&
      raced.refreshToken !== latest.refreshToken &&
      isFresh(raced, now())
    ) {
      return raced.accessToken;
    }
    return endSession(deps, storage);
  }
}

async function endSession(deps: OAuthDeps, storage: AuthStorage): Promise<null> {
  await storage.clearTokens();
  await runHook(deps.onSessionEnded);
  return null;
}

async function runHook(hook: (() => void | Promise<void>) | undefined): Promise<void> {
  if (hook === undefined) return;
  try {
    await hook();
  } catch {
    // The outcome stands either way; a failing hook must not turn the
    // result into an error.
  }
}

/** Both records name an account (subject, else email) and they differ. */
function isDifferentAccount(a: StoredTokens, b: StoredTokens): boolean {
  const idA = a.subject ?? a.email;
  const idB = b.subject ?? b.email;
  return idA !== undefined && idB !== undefined && idA !== idB;
}

/**
 * Exchange a refresh token for a new access token (and possibly a new
 * refresh token). Persists the result. Rejects with `refresh_rejected` when
 * the token endpoint refused the grant (the refresh token is dead) and with
 * `refresh_failed` for anything that may succeed on retry.
 */
export async function refreshTokens(
  deps: OAuthDeps,
  refreshToken: string,
): Promise<StoredTokens> {
  const storage = deps.storage ?? sessionAuthStorage();
  const now = deps.now ?? Date.now;
  const as = await discover(deps);
  const c = client(deps.config);

  const fetchOpts = {
    ...(makeFetchOpts(deps) as object | undefined),
    signal: AbortSignal.timeout(deps.refreshTimeoutMs ?? REFRESH_TIMEOUT_MS),
  } as Parameters<typeof oauth.refreshTokenGrantRequest>[4];

  let response: Response;
  try {
    response = await oauth.refreshTokenGrantRequest(
      as,
      c,
      oauth.None(),
      refreshToken,
      fetchOpts,
    );
  } catch (e) {
    throw makeError('refresh_failed', `refresh fetch failed: ${describe(e)}`);
  }

  let result: oauth.TokenEndpointResponse;
  try {
    result = await oauth.processRefreshTokenResponse(as, c, response);
  } catch (e) {
    // RFC 6749 §5.2: a dead / revoked / rotated-away refresh token is
    // `invalid_grant` with 400; client-authentication failures are 401.
    // Everything else (5xx, proxies, malformed bodies) is retryable.
    const rejected =
      response.status === 400 ||
      response.status === 401 ||
      (e instanceof oauth.ResponseBodyError && e.error === 'invalid_grant');
    throw makeError(
      rejected ? 'refresh_rejected' : 'refresh_failed',
      `refresh response ${rejected ? 'rejected' : 'invalid'}: ${describe(e)}`,
    );
  }

  const prior = storage.loadTokens();
  const issuedAt = now();
  const tokens: StoredTokens = {
    accessToken: result.access_token,
    expiresAtMs: issuedAt + (result.expires_in ?? 0) * 1000,
    obtainedAtMs: issuedAt,
    refreshToken: result.refresh_token ?? prior?.refreshToken ?? refreshToken,
    ...(result.id_token !== undefined
      ? { idToken: result.id_token }
      : prior?.idToken !== undefined
        ? { idToken: prior.idToken }
        : {}),
    ...(prior?.subject !== undefined ? { subject: prior.subject } : {}),
    ...(prior?.email !== undefined ? { email: prior.email } : {}),
  };
  await storage.saveTokens(tokens);
  return tokens;
}

/** Clear local auth state. Best-effort RP-initiated logout would happen
 *  here when Stalwart implements an end-session endpoint. */
export async function signOut(deps: OAuthDeps): Promise<void> {
  const storage = deps.storage ?? sessionAuthStorage();
  await storage.clearTokens();
  await storage.clearAllPkce();
}

/** Convenience accessor for the cached signed-in user info. */
export function loadCurrentSession(deps: OAuthDeps): StoredTokens | null {
  const storage = deps.storage ?? sessionAuthStorage();
  return storage.loadTokens();
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function defaultRedirect(url: string): void {
  if (typeof window !== 'undefined') {
    window.location.assign(url);
  }
}

function makeError(code: OAuthError['code'], message: string): OAuthError {
  return { code, message };
}

/** True for the `{ code, message }` errors this module throws. */
export function isOAuthError(e: unknown): e is OAuthError {
  return (
    e !== null &&
    typeof e === 'object' &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { message?: unknown }).message === 'string' &&
    !(e instanceof Error)
  );
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
