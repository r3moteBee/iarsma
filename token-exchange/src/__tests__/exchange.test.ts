/**
 * Exchange logic tests. Uses an injected mock fetch so we can verify the
 * exact OAuth wire format (request body, headers) without an OIDC server.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ExchangeError,
  createExchanger,
  discoverTokenEndpoint,
  parseTokenResponse,
} from '../exchange.js';

const ISSUER = 'https://sw-mail.example.net';
const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`;
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

function makeResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

// ──────────────────────────────────────────────────────────────────────────
// parseTokenResponse — pure parser
// ──────────────────────────────────────────────────────────────────────────

describe('parseTokenResponse', () => {
  it('parses a minimal access-token response', () => {
    const res = parseTokenResponse({ access_token: 'a' });
    expect(res.accessToken).toBe('a');
    expect(res.tokenType).toBe('Bearer');
    expect(res.refreshToken).toBeUndefined();
  });

  it('parses a full response', () => {
    const res = parseTokenResponse({
      access_token: 'a',
      refresh_token: 'r',
      id_token: 'i',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'mail:read',
    });
    expect(res).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      idToken: 'i',
      tokenType: 'bearer',
      expiresIn: 3600,
      scope: 'mail:read',
    });
  });

  it('throws on missing access_token', () => {
    expect(() => parseTokenResponse({ token_type: 'Bearer' })).toThrow(ExchangeError);
  });

  it('throws on non-object input', () => {
    expect(() => parseTokenResponse(null)).toThrow(ExchangeError);
    expect(() => parseTokenResponse('not-an-object')).toThrow(ExchangeError);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// discoverTokenEndpoint
// ──────────────────────────────────────────────────────────────────────────

describe('discoverTokenEndpoint', () => {
  it('extracts token_endpoint from a discovery doc', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      makeResponse({ token_endpoint: TOKEN_ENDPOINT }),
    );
    const ep = await discoverTokenEndpoint(ISSUER, fetchStub as unknown as typeof fetch);
    expect(ep).toBe(TOKEN_ENDPOINT);
    expect(fetchStub).toHaveBeenCalledWith(DISCOVERY_URL);
  });

  it('strips trailing slash from issuer before discovery', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      makeResponse({ token_endpoint: TOKEN_ENDPOINT }),
    );
    await discoverTokenEndpoint(`${ISSUER}/`, fetchStub as unknown as typeof fetch);
    expect(fetchStub).toHaveBeenCalledWith(DISCOVERY_URL);
  });

  it('throws ExchangeError on non-2xx discovery response', async () => {
    const fetchStub = vi.fn().mockResolvedValue(makeResponse({}, { status: 404 }));
    await expect(
      discoverTokenEndpoint(ISSUER, fetchStub as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ExchangeError);
  });

  it('throws ExchangeError when discovery doc lacks token_endpoint', async () => {
    const fetchStub = vi.fn().mockResolvedValue(makeResponse({ wrong: 'shape' }));
    await expect(
      discoverTokenEndpoint(ISSUER, fetchStub as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ExchangeError);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// createExchanger.exchange — the production code path
// ──────────────────────────────────────────────────────────────────────────

describe('exchanger.exchange', () => {
  const baseConfig = {
    oidcIssuer: ISSUER,
    clientId: 'webmail',
    clientSecret: 's3cr3t',
    allowedRedirectUris: ['http://localhost:5173/auth/callback'],
    tokenEndpoint: TOKEN_ENDPOINT,
  };

  const sampleRequest = {
    code: 'auth-code',
    codeVerifier: 'pkce-verifier',
    redirectUri: 'http://localhost:5173/auth/callback',
  };

  it('calls the token endpoint with the OAuth 2.1 form-encoded grant', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      makeResponse({ access_token: 'a', token_type: 'Bearer', expires_in: 3600 }),
    );
    const ex = await createExchanger({
      ...baseConfig,
      fetch: fetchStub as unknown as typeof fetch,
    });

    const result = await ex.exchange(sampleRequest);
    expect(result.accessToken).toBe('a');
    expect(result.expiresIn).toBe(3600);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe(TOKEN_ENDPOINT);
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
    const bodyParams = new URLSearchParams(((init as RequestInit).body as URLSearchParams).toString());
    expect(bodyParams.get('grant_type')).toBe('authorization_code');
    expect(bodyParams.get('code')).toBe('auth-code');
    expect(bodyParams.get('code_verifier')).toBe('pkce-verifier');
    expect(bodyParams.get('redirect_uri')).toBe('http://localhost:5173/auth/callback');
    expect(bodyParams.get('client_id')).toBe('webmail');
    expect(bodyParams.get('client_secret')).toBe('s3cr3t');
  });

  it('rejects redirect URIs that are not in the allowed list', async () => {
    const fetchStub = vi.fn();
    const ex = await createExchanger({
      ...baseConfig,
      fetch: fetchStub as unknown as typeof fetch,
    });
    await expect(
      ex.exchange({ ...sampleRequest, redirectUri: 'http://evil.example/callback' }),
    ).rejects.toMatchObject({ code: 'invalid_redirect_uri' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('wraps OIDC errors as ExchangeError with code oidc_error', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      makeResponse(
        { error: 'invalid_grant', error_description: 'bad code' },
        { status: 400 },
      ),
    );
    const ex = await createExchanger({
      ...baseConfig,
      fetch: fetchStub as unknown as typeof fetch,
    });
    await expect(ex.exchange(sampleRequest)).rejects.toMatchObject({
      code: 'oidc_error',
    });
  });

  it('throws ExchangeError when the response is not JSON', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const ex = await createExchanger({
      ...baseConfig,
      fetch: fetchStub as unknown as typeof fetch,
    });
    await expect(ex.exchange(sampleRequest)).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('discovers the token endpoint at construction when not provided', async () => {
    const fetchStub = vi
      .fn()
      // First call: discovery
      .mockResolvedValueOnce(makeResponse({ token_endpoint: TOKEN_ENDPOINT }))
      // Second call: token exchange
      .mockResolvedValueOnce(makeResponse({ access_token: 'a' }));
    const ex = await createExchanger({
      oidcIssuer: ISSUER,
      clientId: 'webmail',
      clientSecret: 's3cr3t',
      allowedRedirectUris: ['http://localhost:5173/auth/callback'],
      fetch: fetchStub as unknown as typeof fetch,
    });
    await ex.exchange(sampleRequest);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(fetchStub.mock.calls[0]?.[0]).toBe(DISCOVERY_URL);
    expect(fetchStub.mock.calls[1]?.[0]).toBe(TOKEN_ENDPOINT);
  });
});
