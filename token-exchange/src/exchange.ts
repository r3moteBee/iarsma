/**
 * The OIDC authorization-code-plus-PKCE-verifier exchange.
 *
 * Implements the OAuth 2.1 token-endpoint POST. The `client_secret` lives
 * in this process's memory (loaded from env) and never reaches the browser.
 *
 * Network calls go through an injectable `fetch` so tests can stub them
 * deterministically without spinning up an actual OIDC provider.
 *
 * The shape of the request mirrors the standard OAuth 2.1 RFC; nothing
 * Stalwart-specific lives here. If the user later swaps Stalwart for
 * another OIDC provider, this code keeps working.
 */

export type ExchangeRequest = {
  /** Auth code returned by the OIDC provider in the redirect callback. */
  readonly code: string;
  /** PKCE verifier the browser stored when it generated the challenge. */
  readonly codeVerifier: string;
  /** Redirect URI that was used in the authorization request. */
  readonly redirectUri: string;
};

export type ExchangeResponse = {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly idToken?: string;
  readonly tokenType: string;
  readonly expiresIn?: number;
  /** Scope set granted in this token response, if the provider returned one. */
  readonly scope?: string;
};

export class ExchangeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_request'
      | 'invalid_redirect_uri'
      | 'oidc_error'
      | 'discovery_failed'
      | 'malformed_response',
    public readonly upstream?: unknown,
  ) {
    super(message);
    this.name = 'ExchangeError';
  }
}

export type ExchangerConfig = {
  readonly oidcIssuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly allowedRedirectUris: readonly string[];
  /** Pre-discovered token endpoint. If undefined, discover at construction. */
  readonly tokenEndpoint?: string;
  /** Injectable fetch (defaults to the global). Tests pass a mock. */
  readonly fetch?: typeof fetch;
};

export type Exchanger = {
  exchange(req: ExchangeRequest): Promise<ExchangeResponse>;
};

export async function createExchanger(cfg: ExchangerConfig): Promise<Exchanger> {
  const doFetch = cfg.fetch ?? globalThis.fetch;
  const tokenEndpoint =
    cfg.tokenEndpoint ?? (await discoverTokenEndpoint(cfg.oidcIssuer, doFetch));

  const allowed = new Set(cfg.allowedRedirectUris);

  return {
    async exchange(req): Promise<ExchangeResponse> {
      if (!allowed.has(req.redirectUri)) {
        throw new ExchangeError(
          `redirect_uri not in allowed list: ${req.redirectUri}`,
          'invalid_redirect_uri',
        );
      }
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.code,
        redirect_uri: req.redirectUri,
        code_verifier: req.codeVerifier,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      });
      const response = await doFetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (e) {
        throw new ExchangeError(
          `Token endpoint did not return valid JSON (status ${response.status}).`,
          'malformed_response',
          e,
        );
      }
      if (!response.ok) {
        const errPayload = payload as { error?: string; error_description?: string };
        throw new ExchangeError(
          `OIDC token exchange failed: ${errPayload.error ?? response.status} — ${errPayload.error_description ?? ''}`,
          'oidc_error',
          payload,
        );
      }
      return parseTokenResponse(payload);
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

export async function discoverTokenEndpoint(
  issuer: string,
  doFetch: typeof fetch,
): Promise<string> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  let response: Response;
  try {
    response = await doFetch(url);
  } catch (e) {
    throw new ExchangeError(
      `OIDC discovery network error: ${(e as Error).message}`,
      'discovery_failed',
      e,
    );
  }
  if (!response.ok) {
    throw new ExchangeError(
      `OIDC discovery failed: ${response.status} ${response.statusText}`,
      'discovery_failed',
    );
  }
  let config: unknown;
  try {
    config = await response.json();
  } catch (e) {
    throw new ExchangeError(
      `OIDC discovery returned invalid JSON: ${(e as Error).message}`,
      'discovery_failed',
      e,
    );
  }
  if (
    typeof config !== 'object' ||
    config === null ||
    typeof (config as { token_endpoint?: unknown }).token_endpoint !== 'string'
  ) {
    throw new ExchangeError(
      'OIDC discovery response missing token_endpoint',
      'discovery_failed',
    );
  }
  return (config as { token_endpoint: string }).token_endpoint;
}

export function parseTokenResponse(payload: unknown): ExchangeResponse {
  if (typeof payload !== 'object' || payload === null) {
    throw new ExchangeError('Token response was not an object.', 'malformed_response');
  }
  const p = payload as Record<string, unknown>;
  if (typeof p['access_token'] !== 'string') {
    throw new ExchangeError(
      'Token response missing access_token.',
      'malformed_response',
    );
  }
  const tokenType = typeof p['token_type'] === 'string' ? p['token_type'] : 'Bearer';
  return {
    accessToken: p['access_token'] as string,
    ...(typeof p['refresh_token'] === 'string'
      ? { refreshToken: p['refresh_token'] }
      : {}),
    ...(typeof p['id_token'] === 'string' ? { idToken: p['id_token'] } : {}),
    tokenType,
    ...(typeof p['expires_in'] === 'number' ? { expiresIn: p['expires_in'] } : {}),
    ...(typeof p['scope'] === 'string' ? { scope: p['scope'] } : {}),
  };
}
