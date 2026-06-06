import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { fileTokenStore, singleTokenStore } from '../token-store.js';

describe('singleTokenStore', () => {
  it('resolves a matching bearer token', async () => {
    const store = singleTokenStore('secret-123', { name: 'test-agent', scopes: ['mail:read'] });
    const result = await store.resolve('secret-123');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-agent');
    expect(result!.scopes.has('mail:read')).toBe(true);
  });

  it('returns null for non-matching token', async () => {
    const store = singleTokenStore('secret-123');
    expect(await store.resolve('wrong')).toBeNull();
  });
});

describe('fileTokenStore', () => {
  let tmpDir: string;
  let filePath: string;

  function setup(content: unknown): void {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'iarsma-tokens-'));
    filePath = path.join(tmpDir, 'tokens.json');
    writeFileSync(filePath, JSON.stringify(content));
  }

  afterEach(() => {
    try { unlinkSync(filePath); } catch {}
  });

  it('resolves a token from the file', async () => {
    setup([
      { secret: 'abc123', name: 'agent-a', scopes: ['mail:read', 'mail:send'], tokenId: 't1' },
    ]);
    const store = fileTokenStore(filePath);
    const result = await store.resolve('abc123');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('t1');
    expect(result!.name).toBe('agent-a');
    expect(result!.scopes.has('mail:read')).toBe(true);
    expect(result!.scopes.has('mail:send')).toBe(true);
  });

  it('returns null for unknown token', async () => {
    setup([
      { secret: 'abc123', name: 'agent-a', scopes: ['mail:read'], tokenId: 't1' },
    ]);
    const store = fileTokenStore(filePath);
    expect(await store.resolve('unknown')).toBeNull();
  });

  it('handles multiple tokens', async () => {
    setup([
      { secret: 'tok-1', name: 'reader', scopes: ['mail:read'], tokenId: 'r1' },
      { secret: 'tok-2', name: 'sender', scopes: ['mail:read', 'mail:send'], tokenId: 's1' },
    ]);
    const store = fileTokenStore(filePath);
    expect((await store.resolve('tok-1'))!.name).toBe('reader');
    expect((await store.resolve('tok-2'))!.name).toBe('sender');
  });

  it('handles missing file gracefully', async () => {
    const store = fileTokenStore('/tmp/nonexistent-iarsma-tokens.json');
    expect(await store.resolve('anything')).toBeNull();
  });

  it('reloads the file on reload()', async () => {
    setup([{ secret: 'v1', name: 'a1', scopes: [], tokenId: 't1' }]);
    const store = fileTokenStore(filePath);
    expect(await store.resolve('v1')).not.toBeNull();
    expect(await store.resolve('v2')).toBeNull();

    writeFileSync(filePath, JSON.stringify([
      { secret: 'v2', name: 'a2', scopes: ['mail:read'], tokenId: 't2' },
    ]));
    store.reload();
    expect(await store.resolve('v1')).toBeNull();
    expect((await store.resolve('v2'))!.name).toBe('a2');
  });
});
