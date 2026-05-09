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
  it('round-trips tokens', async () => {
    const storage = inMemoryAuthStorage();
    expect(storage.loadTokens()).toBeNull();
    await storage.saveTokens(sampleTokens);
    expect(storage.loadTokens()).toEqual(sampleTokens);
    await storage.clearTokens();
    expect(storage.loadTokens()).toBeNull();
  });

  it('stores and consumes PKCE entries by state', async () => {
    const storage = inMemoryAuthStorage();
    await storage.savePkce(samplePkce.state, samplePkce);
    await storage.savePkce('state-2', { ...samplePkce, state: 'state-2', codeVerifier: 'v2' });

    const taken = await storage.takePkce(samplePkce.state);
    expect(taken).toEqual(samplePkce);
    // takePkce is destructive — second take returns null.
    expect(await storage.takePkce(samplePkce.state)).toBeNull();
    // The other entry remains untouched.
    expect((await storage.takePkce('state-2'))?.codeVerifier).toBe('v2');
  });

  it('returns null when taking an unknown state', async () => {
    const storage = inMemoryAuthStorage();
    expect(await storage.takePkce('nope')).toBeNull();
  });

  it('clearAllPkce drops every PKCE entry', async () => {
    const storage = inMemoryAuthStorage();
    await storage.savePkce('s1', samplePkce);
    await storage.savePkce('s2', { ...samplePkce, state: 's2' });
    await storage.clearAllPkce();
    expect(await storage.takePkce('s1')).toBeNull();
    expect(await storage.takePkce('s2')).toBeNull();
  });

  it('keeps tokens and PKCE in independent buckets', async () => {
    const storage = inMemoryAuthStorage();
    await storage.saveTokens(sampleTokens);
    await storage.savePkce('s1', samplePkce);
    await storage.clearAllPkce();
    expect(storage.loadTokens()).toEqual(sampleTokens);
    await storage.clearTokens();
    expect(storage.loadTokens()).toBeNull();
  });

  it('ready() resolves immediately for in-memory storage', async () => {
    const storage = inMemoryAuthStorage();
    await storage.ready();
    expect(storage.loadTokens()).toBeNull();
  });
});
