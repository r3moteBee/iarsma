/**
 * OAuth flow contract tests.
 *
 * The third-party `oauth4webapi` is itself well-tested upstream — these
 * tests pin the wrapper behavior we own: discovery caching, redirect URL
 * composition, PKCE persistence, callback error paths, and sign-out.
 * The full happy-path token-exchange is verified manually against the
 * reference Stalwart per docs/stalwart-setup.md (an automated end-to-end
 * needs a signed-id-token fixture and is deferred to Phase 1).
 */

import { describe, expect, it, vi } from 'vitest';
import { inMemoryAuthStorage } from '../auth-storage.js';
import {
  _resetDiscoveryCacheForTests,
  handleCallback,
  signOut,
  startSignIn,
} from '../oauth.js';

const STALWART_DISCOVERY = {
  issuer: 'https://sw-mail.example.net',
  authorization_endpoint: 'https://sw-mail.example.net/login',
  token_endpoint: 'https://sw-mail.example.net/auth/token',
  userinfo_endpoint: 'https://sw-mail.example.net/auth/userinfo',
  jwks_uri: 'https://sw-mail.example.net/auth/jwks.json',
  scopes_supported: ['openid', 'offline_access'],
  response_types_supported: ['code', 'id_token', 'id_token token'],
  subject_types_supported: ['public'],
  grant_types_supported: ['authorization_code', 'implicit'],
  id_token_signing_alg_values_supported: ['RS256', 'ES256', 'PS256'],
  claims_supported: ['sub', 'name', 'email', 'email_verified'],
  code_challenge_methods_supported: ['S256'],
};

const CONFIG = {
  oidcIssuer: 'https://sw-mail.example.net',
  clientId: 'webmail',
  redirectUri: 'http://localhost:5173/auth/callback',
};

function discoveryFetch(): typeof fetch {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify(STALWART_DISCOVERY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('startSignIn', () => {
  it('redirects to the authorization endpoint with all required PKCE params', async () => {
    _resetDiscoveryCacheForTests();
    const storage = inMemoryAuthStorage();
    let redirectedTo: string | null = null;
    const redirect = (url: string) => {
      redirectedTo = url;
    };
    await expect(
      startSignIn({
        config: CONFIG,
        storage,
        fetch: discoveryFetch(),
        redirect,
      }),
    ).rejects.toMatchObject({ code: 'invalid_callback' });
    expect(redirectedTo).not.toBeNull();
    const url = new URL(redirectedTo!);
    expect(url.origin + url.pathname).toBe('https://sw-mail.example.net/login');
    expect(url.searchParams.get('client_id')).toBe('webmail');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'offline_access']),
    );
    const codeChallenge = url.searchParams.get('code_challenge');
    const state = url.searchParams.get('state');
    const nonce = url.searchParams.get('nonce');
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('persists a PKCE entry that the callback can later look up by state', async () => {
    _resetDiscoveryCacheForTests();
    const storage = inMemoryAuthStorage();
    let redirectedTo: string | null = null;
    await expect(
      startSignIn({
        config: CONFIG,
        storage,
        fetch: discoveryFetch(),
        redirect: (url) => {
          redirectedTo = url;
        },
      }),
    ).rejects.toBeDefined();
    const state = new URL(redirectedTo!).searchParams.get('state')!;
    const stored = storage.takePkce(state);
    expect(stored).not.toBeNull();
    expect(stored!.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(stored!.redirectUri).toBe(CONFIG.redirectUri);
    expect(stored!.state).toBe(state);
  });

  it('caches discovery — a second sign-in does not refetch the metadata', async () => {
    _resetDiscoveryCacheForTests();
    const storage = inMemoryAuthStorage();
    const fetchSpy = discoveryFetch();

    await expect(
      startSignIn({
        config: CONFIG,
        storage,
        fetch: fetchSpy,
        redirect: () => {},
      }),
    ).rejects.toBeDefined();
    await expect(
      startSignIn({
        config: CONFIG,
        storage,
        fetch: fetchSpy,
        redirect: () => {},
      }),
    ).rejects.toBeDefined();

    expect((fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(1);
  });

  it('surfaces a discovery_failed error when the issuer rejects discovery', async () => {
    _resetDiscoveryCacheForTests();
    const failing: typeof fetch = vi.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(
      startSignIn({
        config: CONFIG,
        storage: inMemoryAuthStorage(),
        fetch: failing,
        redirect: () => {},
      }),
    ).rejects.toMatchObject({ code: 'discovery_failed' });
  });
});

describe('handleCallback', () => {
  it('returns null when the URL has no code parameter', async () => {
    _resetDiscoveryCacheForTests();
    const result = await handleCallback(
      { config: CONFIG, storage: inMemoryAuthStorage(), fetch: discoveryFetch() },
      new URL('http://localhost:5173/'),
    );
    expect(result).toBeNull();
  });

  it('rejects with pkce_mismatch when no stored PKCE matches the state', async () => {
    _resetDiscoveryCacheForTests();
    const storage = inMemoryAuthStorage();
    const url = new URL(
      'http://localhost:5173/auth/callback?code=abc&state=unknown-state',
    );
    await expect(
      handleCallback(
        { config: CONFIG, storage, fetch: discoveryFetch() },
        url,
      ),
    ).rejects.toMatchObject({ code: 'pkce_mismatch' });
  });
});

describe('signOut', () => {
  it('clears tokens and any in-flight PKCE entries', () => {
    const storage = inMemoryAuthStorage();
    storage.saveTokens({ accessToken: 't', expiresAtMs: 0 });
    storage.savePkce('s1', {
      state: 's1',
      codeVerifier: 'v',
      nonce: 'n',
      redirectUri: 'http://x',
      startedAtMs: 0,
    });
    signOut({ config: CONFIG, storage });
    expect(storage.loadTokens()).toBeNull();
    expect(storage.takePkce('s1')).toBeNull();
  });
});
