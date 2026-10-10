/**
 * Session-end glue: whenever the token layer ends the session, the
 * capability cache (D-051) is cleared before the UI is told; transient
 * failures leave both the tokens and the cache alone.
 */

import { describe, expect, it, vi } from 'vitest';
import { inMemoryAuthStorage, type StoredTokens } from '../auth-storage.js';
import { createAuthTokenAccess } from '../auth-session.js';
import { _resetDiscoveryCacheForTests } from '../oauth.js';

const CONFIG = {
  oidcIssuer: 'https://sw-mail.example.net',
  clientId: 'webmail',
  redirectUri: 'http://localhost:5173/auth/callback',
};
const TOKEN_ENDPOINT = 'https://sw-mail.example.net/auth/token';
const NOW = 1_700_000_000_000;

/** Discovery + a token endpoint answering every refresh with `respond`. */
function issuerFetch(respond: () => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith('/.well-known/openid-configuration')) {
      return Response.json({
        issuer: CONFIG.oidcIssuer,
        authorization_endpoint: `${CONFIG.oidcIssuer}/login`,
        token_endpoint: TOKEN_ENDPOINT,
      });
    }
    if (u === TOKEN_ENDPOINT) return respond();
    return new Response('not-found', { status: 404 });
  }) as unknown as typeof fetch;
}

const invalidGrant = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
const offline = (): Response => {
  throw new TypeError('Failed to fetch');
};

const ALICE: StoredTokens = {
  accessToken: 'at-0',
  refreshToken: 'rt-0',
  expiresAtMs: NOW + 600_000,
  obtainedAtMs: NOW - 600_000,
  subject: 'alice-sub',
};

async function setup(respond: () => Response | Promise<Response>, tokens: StoredTokens) {
  _resetDiscoveryCacheForTests();
  const storage = inMemoryAuthStorage();
  await storage.saveTokens(tokens);
  const order: string[] = [];
  const cache = {
    clearAll: vi.fn(async () => {
      order.push('cache-cleared');
    }),
  };
  const onSessionEnded = vi.fn(() => {
    order.push('session-ended');
  });
  const onAccountChanged = vi.fn();
  const access = createAuthTokenAccess({
    oauth: { config: CONFIG, storage, fetch: issuerFetch(respond), now: () => NOW },
    cache,
    onSessionEnded,
    onAccountChanged,
  });
  return { storage, cache, onSessionEnded, access, order };
}

describe('createAuthTokenAccess', () => {
  it('a rejected refresh clears tokens, then the cache, then tells the UI', async () => {
    const t = await setup(invalidGrant, { ...ALICE, expiresAtMs: NOW - 1 });
    expect(await t.access.getAuthToken()).toBeNull();
    expect(t.storage.loadTokens()).toBeNull();
    expect(t.order).toEqual(['cache-cleared', 'session-ended']);
  });

  it('a 401 whose forced refresh is rejected ends the session and clears the cache', async () => {
    const t = await setup(invalidGrant, ALICE);
    await t.access.onUnauthorized();
    expect(t.storage.loadTokens()).toBeNull();
    expect(t.order).toEqual(['cache-cleared', 'session-ended']);
  });

  it('a 401 while the token endpoint is unreachable keeps tokens and cache', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await setup(offline, ALICE);
    await t.access.onUnauthorized();
    expect(t.storage.loadTokens()).toEqual(ALICE);
    expect(t.cache.clearAll).not.toHaveBeenCalled();
    expect(t.onSessionEnded).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('getAuthToken surfaces a transient failure as a retryable error', async () => {
    const t = await setup(offline, { ...ALICE, expiresAtMs: NOW - 1 });
    await expect(t.access.getAuthToken()).rejects.toMatchObject({ code: 'refresh_failed' });
    expect(t.cache.clearAll).not.toHaveBeenCalled();
  });

  it('still tells the UI when clearing the cache fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await setup(invalidGrant, { ...ALICE, expiresAtMs: NOW - 1 });
    t.cache.clearAll.mockRejectedValueOnce(new Error('idb gone'));
    expect(await t.access.getAuthToken()).toBeNull();
    expect(t.onSessionEnded).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
