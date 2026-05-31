/**
 * Tests for the `files.read` MCP-server handler (Phase 5b).
 */

import { describe, expect, it, vi } from 'vitest';
import { createFilesReadHandler } from '../handlers/files-read.js';
import type { GithubConfigStore } from '../github-config.js';
import { makeScopeSet } from '../scope-filter.js';

const ctx = { dryRun: false, scopes: makeScopeSet(['files:read']) };

function staticStore(
  config: ReturnType<GithubConfigStore['current']>,
): GithubConfigStore {
  return { current: () => config, reload: () => {} };
}

describe('createFilesReadHandler', () => {
  it('decodes UTF-8 base64 content for text files', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          path: 'README.md',
          sha: 's1',
          size: 12,
          content: Buffer.from('# Hello\n').toString('base64'),
          encoding: 'base64',
        }),
        { status: 200, statusText: 'OK' },
      ),
    ) as unknown as typeof fetch;
    const handler = createFilesReadHandler(
      staticStore({ token: 't', owner: 'o', repo: 'r' }),
      { fetch: fetchSpy },
    );
    const out = (await handler({ path: 'README.md' }, ctx)) as {
      content: string;
      encoding: string;
    };
    expect(out.content).toBe('# Hello\n');
    expect(out.encoding).toBe('utf-8');
  });

  it('keeps base64 + strips whitespace for binary paths', async () => {
    const base64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const withNewlines = base64.split('').join('\n');
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          path: 'a.png',
          sha: 's2',
          size: 4,
          content: withNewlines,
          encoding: 'base64',
        }),
        { status: 200, statusText: 'OK' },
      ),
    ) as unknown as typeof fetch;
    const handler = createFilesReadHandler(
      staticStore({ token: 't', owner: 'o', repo: 'r' }),
      { fetch: fetchSpy },
    );
    const out = (await handler({ path: 'a.png' }, ctx)) as {
      content: string;
      encoding: string;
    };
    expect(out.content).toBe(base64);
    expect(out.encoding).toBe('base64');
  });

  it('throws unauthorized on 401', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response('nope', { status: 401, statusText: 'Unauthorized' }),
    ) as unknown as typeof fetch;
    const handler = createFilesReadHandler(
      staticStore({ token: 't', owner: 'o', repo: 'r' }),
      { fetch: fetchSpy },
    );
    await expect(handler({ path: 'x' }, ctx)).rejects.toThrow(/401/);
  });

  it('rejects empty path', async () => {
    const handler = createFilesReadHandler(
      staticStore({ token: 't', owner: 'o', repo: 'r' }),
    );
    await expect(handler({ path: '' }, ctx)).rejects.toThrow(/non-empty/);
  });
});
