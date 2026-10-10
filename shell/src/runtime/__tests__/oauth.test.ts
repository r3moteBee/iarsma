/**
 * OAuth flow contract tests.
 *
 * The third-party `oauth4webapi` is itself well-tested upstream — these
 * tests pin the wrapper behavior we own: discovery caching, redirect URL
 * composition, PKCE persistence, callback error paths, sign-out, and the
 * refresh lifecycle (shared in-flight refresh, cross-tab rotation, and
 * which token-endpoint failures end the session).
 * The full happy-path token-exchange is verified manually against the
 * reference Stalwart per docs/stalwart-setup.md (an automated end-to-end
 * needs a signed-id-token fixture and is deferred to Phase 1).
 */

import { describe, expect, it, vi } from 'vitest';
import { inMemoryAuthStorage, type AuthStorage, type StoredTokens } from '../auth-storage.js';
import {
  _resetDiscoveryCacheForTests,
  getAccessToken,
  handleCallback,
  refreshAfterUnauthorized,
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
    const stored = await storage.takePkce(state);
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
  it('clears tokens and any in-flight PKCE entries', async () => {
    const storage = inMemoryAuthStorage();
    await storage.saveTokens({ accessToken: 't', expiresAtMs: 0 });
    await storage.savePkce('s1', {
      state: 's1',
      codeVerifier: 'v',
      nonce: 'n',
      redirectUri: 'http://x',
      startedAtMs: 0,
    });
    await signOut({ config: CONFIG, storage });
    expect(storage.loadTokens()).toBeNull();
    expect(await storage.takePkce('s1')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
// Refresh lifecycle
// ───────────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

/**
 * Fake issuer: serves discovery and a token endpoint that implements
 * refresh-token rotation (each refresh token is single-use). `mode` lets a
 * test make the endpoint unreachable or failing.
 */
function fakeIssuer(initialRefreshToken: string) {
  const state = {
    validRefreshToken: initialRefreshToken,
    tokenPosts: 0,
    issued: 0,
    mode: 'ok' as 'ok' | 'network-error' | 'server-error',
    /** Resolves pending token responses; null = respond immediately. */
    gate: null as Promise<void> | null,
  };
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify(STALWART_DISCOVERY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u === STALWART_DISCOVERY.token_endpoint) {
      state.tokenPosts += 1;
      if (state.gate !== null) await state.gate;
      if (state.mode === 'network-error') throw new TypeError('Failed to fetch');
      if (state.mode === 'server-error') {
        return new Response('<html>bad gateway</html>', { status: 502 });
      }
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (body.get('refresh_token') !== state.validRefreshToken) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      state.issued += 1;
      state.validRefreshToken = `rt-${state.issued}`;
      return new Response(
        JSON.stringify({
          access_token: `at-${state.issued}`,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: state.validRefreshToken,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
  return { state, fetch: fetchImpl };
}

/**
 * Two "tabs" over one persistent backing: each tab has its own in-memory
 * token cache (like `indexedDbAuthStorage`), refreshed from the shared
 * record only by `ready()` / `reloadTokens()`.
 */
function sharedBacking(initial: StoredTokens | null): {
  tab: () => AuthStorage;
  disk: () => StoredTokens | null;
} {
  let disk = initial;
  return {
    disk: () => disk,
    tab: () => {
      const base = inMemoryAuthStorage();
      let cache: StoredTokens | null = disk;
      return {
        ...base,
        ready: async () => {
          cache = disk;
        },
        loadTokens: () => cache,
        reloadTokens: async () => {
          cache = disk;
          return cache;
        },
        saveTokens: async (t) => {
          disk = t;
          cache = t;
        },
        clearTokens: async () => {
          disk = null;
          cache = null;
        },
      };
    },
  };
}

const EXPIRED: StoredTokens = {
  accessToken: 'at-0',
  refreshToken: 'rt-0',
  expiresAtMs: NOW - 1_000,
  obtainedAtMs: NOW - 3_600_000,
  subject: 'alice-sub',
  email: 'alice@example.net',
};

describe('getAccessToken — refresh', () => {
  it('returns an unexpired token without contacting the token endpoint', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const storage = inMemoryAuthStorage();
    await storage.saveTokens({ ...EXPIRED, expiresAtMs: NOW + 600_000 });
    const token = await getAccessToken({ config: CONFIG, storage, fetch: issuer.fetch, now: () => NOW });
    expect(token).toBe('at-0');
    expect(issuer.state.tokenPosts).toBe(0);
  });

  it('concurrent callers share one refresh: one token POST, one result', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(EXPIRED);
    const deps = { config: CONFIG, storage, fetch: issuer.fetch, now: () => NOW };
    const results = await Promise.all([
      getAccessToken(deps),
      getAccessToken(deps),
      getAccessToken(deps),
      getAccessToken(deps),
    ]);
    expect(results).toEqual(['at-1', 'at-1', 'at-1', 'at-1']);
    expect(issuer.state.tokenPosts).toBe(1);
    expect(storage.loadTokens()).toMatchObject({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAtMs: NOW + 3_600_000,
      obtainedAtMs: NOW,
      subject: 'alice-sub',
      email: 'alice@example.net',
    });
  });

  it('a network error keeps the tokens and rejects with a retryable error', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    issuer.state.mode = 'network-error';
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(EXPIRED);
    const onSessionEnded = vi.fn();
    const deps = { config: CONFIG, storage, fetch: issuer.fetch, now: () => NOW, onSessionEnded };
    await expect(getAccessToken(deps)).rejects.toMatchObject({ code: 'refresh_failed' });
    expect(storage.loadTokens()).toEqual(EXPIRED);
    expect(onSessionEnded).not.toHaveBeenCalled();
    // Back online: the next call retries and succeeds.
    issuer.state.mode = 'ok';
    expect(await getAccessToken(deps)).toBe('at-1');
  });

  it('a 5xx from the token endpoint keeps the tokens', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    issuer.state.mode = 'server-error';
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(EXPIRED);
    await expect(
      getAccessToken({ config: CONFIG, storage, fetch: issuer.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'refresh_failed' });
    expect(storage.loadTokens()).toEqual(EXPIRED);
  });

  it('invalid_grant clears the tokens and ends the session once', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('some-other-token');
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(EXPIRED);
    const onSessionEnded = vi.fn();
    const deps = { config: CONFIG, storage, fetch: issuer.fetch, now: () => NOW, onSessionEnded };
    const results = await Promise.all([getAccessToken(deps), getAccessToken(deps)]);
    expect(results).toEqual([null, null]);
    expect(storage.loadTokens()).toBeNull();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(issuer.state.tokenPosts).toBe(1);
  });

  it('an expired token without a refresh token ends the session', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const storage = inMemoryAuthStorage();
    const { refreshToken: _omit, ...noRefresh } = EXPIRED;
    await storage.saveTokens(noRefresh);
    const onSessionEnded = vi.fn();
    expect(
      await getAccessToken({ config: CONFIG, storage, fetch: issuer.fetch, now: () => NOW, onSessionEnded }),
    ).toBeNull();
    expect(storage.loadTokens()).toBeNull();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(issuer.state.tokenPosts).toBe(0);
  });

  it("picks up a second tab's rotated token instead of spending a stale refresh token", async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const backing = sharedBacking(EXPIRED);
    const tabA = backing.tab();
    const tabB = backing.tab();
    // Both tabs hydrated the same (now expired) record; tab A refreshes
    // first, rotating rt-0 → rt-1.
    expect(
      await getAccessToken({ config: CONFIG, storage: tabA, fetch: issuer.fetch, now: () => NOW }),
    ).toBe('at-1');
    // Tab B still holds rt-0 in memory. Spending it would be invalid_grant.
    expect(tabB.loadTokens()?.refreshToken).toBe('rt-0');
    const onSessionEnded = vi.fn();
    expect(
      await getAccessToken({
        config: CONFIG,
        storage: tabB,
        fetch: issuer.fetch,
        now: () => NOW,
        onSessionEnded,
      }),
    ).toBe('at-1');
    expect(issuer.state.tokenPosts).toBe(1);
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(backing.disk()?.refreshToken).toBe('rt-1');
  });

  it("uses a racing tab's rotation when our own refresh was rejected because of it", async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const backing = sharedBacking(EXPIRED);
    const tabA = backing.tab();
    const tabB = backing.tab();
    // Hold both POSTs at the token endpoint so both tabs read rt-0 first.
    let open: () => void = () => {};
    issuer.state.gate = new Promise((r) => {
      open = r;
    });
    const onSessionEnded = vi.fn();
    const a = getAccessToken({ config: CONFIG, storage: tabA, fetch: issuer.fetch, now: () => NOW });
    const b = getAccessToken({
      config: CONFIG,
      storage: tabB,
      fetch: issuer.fetch,
      now: () => NOW,
      onSessionEnded,
    });
    await vi.waitFor(() => expect(issuer.state.tokenPosts).toBe(2));
    open();
    // One tab wins the rotation; the loser is rejected, then adopts the
    // winner's token instead of signing everyone out.
    const [ta, tb] = await Promise.all([a, b]);
    expect(ta).toBe('at-1');
    expect(tb).toBe('at-1');
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(backing.disk()?.refreshToken).toBe('rt-1');
  });

  it('ends the session when another tab signed out', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const backing = sharedBacking(EXPIRED);
    const tabA = backing.tab();
    const tabB = backing.tab();
    await signOut({ config: CONFIG, storage: tabA });
    const onSessionEnded = vi.fn();
    expect(
      await getAccessToken({
        config: CONFIG,
        storage: tabB,
        fetch: issuer.fetch,
        now: () => NOW,
        onSessionEnded,
      }),
    ).toBeNull();
    expect(tabB.loadTokens()).toBeNull();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(issuer.state.tokenPosts).toBe(0);
  });
});

describe('getAccessToken — account changed in another tab', () => {
  it('does not adopt the other account\'s tokens and leaves them intact', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const backing = sharedBacking(EXPIRED);
    const aliceTab = backing.tab();
    const otherTab = backing.tab();
    const BOB: StoredTokens = {
      accessToken: 'bob-at',
      refreshToken: 'bob-rt',
      expiresAtMs: NOW + 3_600_000,
      obtainedAtMs: NOW,
      subject: 'bob-sub',
      email: 'bob@example.net',
    };
    await otherTab.saveTokens(BOB);
    const onAccountChanged = vi.fn();
    const onSessionEnded = vi.fn();
    expect(
      await getAccessToken({
        config: CONFIG,
        storage: aliceTab,
        fetch: issuer.fetch,
        now: () => NOW,
        onAccountChanged,
        onSessionEnded,
      }),
    ).toBeNull();
    expect(onAccountChanged).toHaveBeenCalledTimes(1);
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(backing.disk()).toEqual(BOB);
    expect(issuer.state.tokenPosts).toBe(0);
  });
});

describe('refreshAfterUnauthorized', () => {
  const VALID: StoredTokens = { ...EXPIRED, expiresAtMs: NOW + 600_000 };

  it('forces one refresh of a token the local clock still considers valid', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(VALID);
    const deps = { config: CONFIG, storage, fetch: issuer.fetch, now: () => NOW };
    const results = await Promise.all([
      refreshAfterUnauthorized(deps),
      refreshAfterUnauthorized(deps),
      getAccessToken(deps),
    ]);
    expect(results).toEqual(['at-1', 'at-1', 'at-1']);
    expect(issuer.state.tokenPosts).toBe(1);
  });

  it('does not refresh again for a 401 right after a refresh', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(VALID);
    let now = NOW;
    const deps = { config: CONFIG, storage, fetch: issuer.fetch, now: () => now };
    expect(await refreshAfterUnauthorized(deps)).toBe('at-1');
    // A request that carried at-0 comes back 401 two seconds later.
    now = NOW + 2_000;
    expect(await refreshAfterUnauthorized(deps)).toBe('at-1');
    expect(issuer.state.tokenPosts).toBe(1);
    // Past the grace window a 401 forces another refresh.
    now = NOW + 60_000;
    expect(await refreshAfterUnauthorized(deps)).toBe('at-2');
    expect(issuer.state.tokenPosts).toBe(2);
  });

  it('ends the session when the forced refresh is rejected', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('revoked-elsewhere');
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(VALID);
    const onSessionEnded = vi.fn();
    expect(
      await refreshAfterUnauthorized({
        config: CONFIG,
        storage,
        fetch: issuer.fetch,
        now: () => NOW,
        onSessionEnded,
      }),
    ).toBeNull();
    expect(storage.loadTokens()).toBeNull();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the token endpoint is unreachable', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    issuer.state.mode = 'network-error';
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(VALID);
    await expect(
      refreshAfterUnauthorized({ config: CONFIG, storage, fetch: issuer.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'refresh_failed' });
    expect(storage.loadTokens()).toEqual(VALID);
  });

  it('is a no-op when already signed out', async () => {
    _resetDiscoveryCacheForTests();
    const issuer = fakeIssuer('rt-0');
    const onSessionEnded = vi.fn();
    expect(
      await refreshAfterUnauthorized({
        config: CONFIG,
        storage: inMemoryAuthStorage(),
        fetch: issuer.fetch,
        onSessionEnded,
      }),
    ).toBeNull();
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(issuer.state.tokenPosts).toBe(0);
  });
});
