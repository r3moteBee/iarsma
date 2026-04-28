/**
 * Server route tests via Fastify's `inject()`. No HTTP listener; we drive
 * the app's request handler directly with synthetic requests.
 *
 * The exchanger is stubbed so we can verify the route's translation between
 * HTTP/JSON and the domain types without an OIDC provider.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ExchangeError, type Exchanger } from '../exchange.js';
import { buildServer } from '../server.js';

let appsToClose: Array<Awaited<ReturnType<typeof buildServer>>> = [];

afterEach(async () => {
  for (const a of appsToClose) await a.close();
  appsToClose = [];
});

function makeStubExchanger(stub: Partial<Exchanger>): Exchanger {
  return {
    exchange: stub.exchange ?? (async () => {
      throw new Error('exchange not stubbed');
    }),
  };
}

describe('POST /auth/token — happy path', () => {
  it('returns an OAuth-shaped JSON response', async () => {
    const exchanger = makeStubExchanger({
      exchange: async (req) => {
        expect(req).toEqual({
          code: 'auth-code',
          codeVerifier: 'pkce-verifier',
          redirectUri: 'http://localhost:5173/auth/callback',
        });
        return {
          accessToken: 'a-tok',
          refreshToken: 'r-tok',
          idToken: 'i-tok',
          tokenType: 'Bearer',
          expiresIn: 3600,
        };
      },
    });
    const app = await buildServer({ exchanger, logger: false });
    appsToClose.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        code: 'auth-code',
        code_verifier: 'pkce-verifier',
        redirect_uri: 'http://localhost:5173/auth/callback',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      access_token: 'a-tok',
      refresh_token: 'r-tok',
      id_token: 'i-tok',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('omits absent fields rather than emitting null/undefined', async () => {
    const exchanger = makeStubExchanger({
      exchange: async () => ({
        accessToken: 'a-tok',
        tokenType: 'Bearer',
      }),
    });
    const app = await buildServer({ exchanger, logger: false });
    appsToClose.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        code: 'c',
        code_verifier: 'v',
        redirect_uri: 'http://localhost:5173/auth/callback',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBe('a-tok');
    expect(body.refresh_token).toBeUndefined();
    expect(body.id_token).toBeUndefined();
    expect(body.expires_in).toBeUndefined();
    expect('refresh_token' in body).toBe(false);
  });
});

describe('POST /auth/token — error paths', () => {
  it('returns 400 when the request body is missing fields', async () => {
    const app = await buildServer({
      exchanger: makeStubExchanger({}),
      logger: false,
    });
    appsToClose.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { code: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('returns 400 when redirect_uri is not a URL', async () => {
    const app = await buildServer({
      exchanger: makeStubExchanger({}),
      logger: false,
    });
    appsToClose.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { code: 'c', code_verifier: 'v', redirect_uri: 'not-a-url' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 with invalid_redirect_uri when exchanger rejects it', async () => {
    const exchanger = makeStubExchanger({
      exchange: async () => {
        throw new ExchangeError('not allowed', 'invalid_redirect_uri');
      },
    });
    const app = await buildServer({ exchanger, logger: false });
    appsToClose.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        code: 'c',
        code_verifier: 'v',
        redirect_uri: 'http://localhost:5173/auth/callback',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_redirect_uri');
  });

  it('returns 502 when OIDC provider returns an error', async () => {
    const exchanger = makeStubExchanger({
      exchange: async () => {
        throw new ExchangeError('bad grant', 'oidc_error');
      },
    });
    const app = await buildServer({ exchanger, logger: false });
    appsToClose.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        code: 'c',
        code_verifier: 'v',
        redirect_uri: 'http://localhost:5173/auth/callback',
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('oidc_error');
  });

  it('returns 500 on unexpected non-ExchangeError throws', async () => {
    const exchanger = makeStubExchanger({
      exchange: async () => {
        throw new Error('boom');
      },
    });
    const app = await buildServer({ exchanger, logger: false });
    appsToClose.push(app);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: {
        code: 'c',
        code_verifier: 'v',
        redirect_uri: 'http://localhost:5173/auth/callback',
      },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('internal_error');
  });
});

describe('GET /healthz', () => {
  it('returns 200 with a small body', async () => {
    const app = await buildServer({ exchanger: makeStubExchanger({}), logger: false });
    appsToClose.push(app);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
