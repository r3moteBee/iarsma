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
};

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
  const tokens: StoredTokens = {
    accessToken: result.access_token,
    expiresAtMs: now() + (result.expires_in ?? 0) * 1000,
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

/**
 * Return the current access token, refreshing if expired (and a refresh
 * token is available). Returns null when no session exists or the
 * refresh fails.
 */
export async function getAccessToken(deps: OAuthDeps): Promise<string | null> {
  const storage = deps.storage ?? sessionAuthStorage();
  const now = deps.now ?? Date.now;
  const tokens = storage.loadTokens();
  if (tokens === null) return null;
  // Treat the token as expired 30 seconds early to avoid clock-skew /
  // network-latency 401s.
  const skewMs = 30_000;
  if (now() < tokens.expiresAtMs - skewMs) return tokens.accessToken;
  if (tokens.refreshToken === undefined) {
    await storage.clearTokens();
    return null;
  }
  try {
    const refreshed = await refreshTokens(deps, tokens.refreshToken);
    return refreshed.accessToken;
  } catch {
    await storage.clearTokens();
    return null;
  }
}

/**
 * Exchange a refresh token for a new access token (and possibly a new
 * refresh token). Persists the result.
 */
export async function refreshTokens(
  deps: OAuthDeps,
  refreshToken: string,
): Promise<StoredTokens> {
  const storage = deps.storage ?? sessionAuthStorage();
  const now = deps.now ?? Date.now;
  const as = await discover(deps);
  const c = client(deps.config);

  const fetchOpts = makeFetchOpts(deps) as Parameters<
    typeof oauth.refreshTokenGrantRequest
  >[4];

  let response: Response;
  try {
    response =
      fetchOpts === undefined
        ? await oauth.refreshTokenGrantRequest(as, c, oauth.None(), refreshToken)
        : await oauth.refreshTokenGrantRequest(
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
    throw makeError('refresh_failed', `refresh response invalid: ${describe(e)}`);
  }

  const prior = storage.loadTokens();
  const tokens: StoredTokens = {
    accessToken: result.access_token,
    expiresAtMs: now() + (result.expires_in ?? 0) * 1000,
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

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
