import { describe, expect, it } from 'vitest';
import { inMemoryAgentMetadataStore } from '../agent-metadata-store.js';
import { localTokenIssuer } from '../local-token-issuer.js';

describe('localTokenIssuer', () => {
  function makeIssuer(nowMs = 1_700_000_000_000) {
    const store = inMemoryAgentMetadataStore();
    const issuer = localTokenIssuer({ metadataStore: store, now: () => nowMs });
    return { issuer, store };
  }

  it('issues a token with a 64-char hex secret', async () => {
    const { issuer } = makeIssuer();
    const result = await issuer.issueToken({
      name: 'Test Agent',
      scopes: ['mail:read'],
      lifetimeSec: 3600,
    });
    expect(result.tokenId).toBeTruthy();
    expect(result.clientSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt).toBeTruthy();
  });

  it('persists metadata with the secret', async () => {
    const { issuer, store } = makeIssuer();
    const result = await issuer.issueToken({
      name: 'Test',
      scopes: ['mail:read'],
      lifetimeSec: 3600,
    });
    const meta = await store.get(result.tokenId);
    expect(meta).not.toBeNull();
    expect(meta!.secret).toBe(result.clientSecret);
    expect(meta!.name).toBe('Test');
    expect(meta!.scopes).toEqual(['mail:read']);
    expect(meta!.revoked).toBe(false);
  });

  it('listTokens returns issued tokens without secrets', async () => {
    const { issuer } = makeIssuer();
    await issuer.issueToken({ name: 'A', scopes: ['mail:read'], lifetimeSec: 60 });
    await issuer.issueToken({ name: 'B', scopes: ['mail:send'], lifetimeSec: 60 });
    const list = await issuer.listTokens();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name).sort()).toEqual(['A', 'B']);
    for (const t of list) {
      expect(t).not.toHaveProperty('secret');
    }
  });

  it('revokeToken marks the token as revoked', async () => {
    const { issuer, store } = makeIssuer();
    const result = await issuer.issueToken({ name: 'R', scopes: [], lifetimeSec: 60 });
    await issuer.revokeToken(result.tokenId);
    const meta = await store.get(result.tokenId);
    expect(meta!.revoked).toBe(true);
  });

  it('revokeToken throws for unknown tokenId', async () => {
    const { issuer } = makeIssuer();
    await expect(issuer.revokeToken('nonexistent')).rejects.toThrow(/Unknown token/);
  });

  it('introspectToken returns identity for valid active token', async () => {
    const { issuer } = makeIssuer();
    const result = await issuer.issueToken({
      name: 'Intro Agent',
      scopes: ['mail:read', 'mail:send'],
      lifetimeSec: 3600,
    });
    const intro = await issuer.introspectToken(result.clientSecret);
    expect(intro).not.toBeNull();
    expect(intro!.active).toBe(true);
    expect(intro!.agentId).toBe(result.tokenId);
    expect(intro!.name).toBe('Intro Agent');
    expect(intro!.scopes).toEqual(['mail:read', 'mail:send']);
  });

  it('introspectToken returns null for revoked token', async () => {
    const { issuer } = makeIssuer();
    const result = await issuer.issueToken({ name: 'X', scopes: [], lifetimeSec: 3600 });
    await issuer.revokeToken(result.tokenId);
    expect(await issuer.introspectToken(result.clientSecret)).toBeNull();
  });

  it('introspectToken returns null for expired token', async () => {
    let nowMs = 1_700_000_000_000;
    const store = inMemoryAgentMetadataStore();
    const issuer = localTokenIssuer({ metadataStore: store, now: () => nowMs });
    const result = await issuer.issueToken({ name: 'E', scopes: [], lifetimeSec: 60 });
    nowMs += 120_000; // advance 2 minutes past the 60s lifetime
    expect(await issuer.introspectToken(result.clientSecret)).toBeNull();
  });

  it('introspectToken returns null for unknown secret', async () => {
    const { issuer } = makeIssuer();
    expect(await issuer.introspectToken('not-a-real-secret')).toBeNull();
  });
});
