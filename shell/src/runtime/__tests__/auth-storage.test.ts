import { describe, expect, it } from 'vitest';
import {
  inMemoryAuthStorage,
  type StoredPkce,
  type StoredTokens,
} from '../auth-storage.js';

const sampleTokens: StoredTokens = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
  idToken: 'id.jwt.value',
  expiresAtMs: 1700000000000,
  subject: 'user-123',
  email: 'user@example.net',
};

const samplePkce: StoredPkce = {
  state: 'state-1',
  codeVerifier: 'verifier-1',
  nonce: 'nonce-1',
  redirectUri: 'http://localhost:5173/auth/callback',
  startedAtMs: 1700000000000,
};

describe('inMemoryAuthStorage', () => {
  it('round-trips tokens', () => {
    const storage = inMemoryAuthStorage();
    expect(storage.loadTokens()).toBeNull();
    storage.saveTokens(sampleTokens);
    expect(storage.loadTokens()).toEqual(sampleTokens);
    storage.clearTokens();
    expect(storage.loadTokens()).toBeNull();
  });

  it('stores and consumes PKCE entries by state', () => {
    const storage = inMemoryAuthStorage();
    storage.savePkce(samplePkce.state, samplePkce);
    storage.savePkce('state-2', { ...samplePkce, state: 'state-2', codeVerifier: 'v2' });

    const taken = storage.takePkce(samplePkce.state);
    expect(taken).toEqual(samplePkce);
    // takePkce is destructive — second take returns null.
    expect(storage.takePkce(samplePkce.state)).toBeNull();
    // The other entry remains untouched.
    expect(storage.takePkce('state-2')?.codeVerifier).toBe('v2');
  });

  it('returns null when taking an unknown state', () => {
    const storage = inMemoryAuthStorage();
    expect(storage.takePkce('nope')).toBeNull();
  });

  it('clearAllPkce drops every PKCE entry', () => {
    const storage = inMemoryAuthStorage();
    storage.savePkce('s1', samplePkce);
    storage.savePkce('s2', { ...samplePkce, state: 's2' });
    storage.clearAllPkce();
    expect(storage.takePkce('s1')).toBeNull();
    expect(storage.takePkce('s2')).toBeNull();
  });

  it('keeps tokens and PKCE in independent buckets', () => {
    const storage = inMemoryAuthStorage();
    storage.saveTokens(sampleTokens);
    storage.savePkce('s1', samplePkce);
    storage.clearAllPkce();
    expect(storage.loadTokens()).toEqual(sampleTokens);
    storage.clearTokens();
    expect(storage.loadTokens()).toBeNull();
  });
});
