/**
 * Tests for the `files.list` MCP-server handler (Phase 5b).
 */

import { describe, expect, it, vi } from 'vitest';
import { createFilesListHandler } from '../handlers/files-list.js';
import type { GithubConfigStore } from '../github-config.js';
import { makeScopeSet } from '../scope-filter.js';

const ctx = { dryRun: false, scopes: makeScopeSet(['files:read']) };

function staticStore(
  config: ReturnType<GithubConfigStore['current']>,
): GithubConfigStore {
  return {
    current: () => config,
    reload: () => {},
  };
}

describe('createFilesListHandler', () => {
  it('hits the contents API with the configured branch and returns parsed entries', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { path: 'README.md', name: 'README.md', type: 'file', sha: 'abc', size: 42 },
          { path: 'src', name: 'src', type: 'dir' },
        ]),
        { status: 200, statusText: 'OK' },
      ),
    ) as unknown as typeof fetch;
    const handler = createFilesListHandler(
      staticStore({ token: 't', owner: 'o', repo: 'r', branch: 'dev' }),
      { fetch: fetchSpy },
    );
    const out = (await handler({ path: 'src' }, ctx)) as {
      entries: ReadonlyArray<{ path: string; type: string }>;
    };
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]?.path).toBe('README.md');
    expect(out.entries[1]?.type).toBe('dir');
    const [url, init] = (fetchSpy as unknown as {
      mock: { calls: [string, { headers: Record<string, string> }][] };
    }).mock.calls[0]!;
    expect(url).toContain('/repos/o/r/contents/src');
    expect(url).toContain('ref=dev');
    expect(init.headers['Authorization']).toBe('Bearer t');
    expect(init.headers['Accept']).toBe('application/vnd.github+json');
  });

  it('returns a single-element entry when GitHub responds with a file object instead of an array', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ path: 'README.md', name: 'README.md', type: 'file', sha: 'abc', size: 1 }),
        { status: 200, statusText: 'OK' },
      ),
    ) as unknown as typeof fetch;
    const handler = createFilesListHandler(
      staticStore({ token: 't', owner: 'o', repo: 'r' }),
      { fetch: fetchSpy },
    );
    const out = (await handler({ path: 'README.md' }, ctx)) as {
      entries: readonly unknown[];
    };
    expect(out.entries).toHaveLength(1);
  });

  it('errors when config is unset', async () => {
    const handler = createFilesListHandler(staticStore(null));
    await expect(handler({ path: '' }, ctx)).rejects.toThrow(/not configured/);
  });

  it('rejects non-string path', async () => {
    const handler = createFilesListHandler(
      staticStore({ token: 't', owner: 'o', repo: 'r' }),
    );
    await expect(handler({}, ctx)).rejects.toThrow(/path must be a string/);
  });
});
