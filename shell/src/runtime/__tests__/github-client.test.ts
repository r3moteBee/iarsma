/**
 * Tests for the GitHub Contents API client.
 *
 * Coverage:
 *   - list: array for dir listings, single-item array for file targets
 *   - read: decodes base64 → UTF-8 for text, keeps base64 for binary
 *   - write: PUTs base64-encoded content and (optionally) the existing sha
 *   - delete: sends sha + branch in the JSON body
 *   - history: extracts sha / message / author / date
 *   - auth + version headers are attached to every request
 */

import { describe, expect, it, vi } from 'vitest';
import {
  githubClient,
  isBinaryPath,
  type GitHubConfig,
} from '../github-client.js';

const CONFIG: GitHubConfig = {
  token: 'ghp_test',
  owner: 'octocat',
  repo: 'demo',
  branch: 'main',
};

type FetchSpy = ReturnType<typeof makeFetchSpy>;

function makeFetchSpy(
  body: string,
  init: { status?: number; statusText?: string } = {},
) {
  const status = init.status ?? 200;
  const impl: typeof fetch = async () =>
    new Response(body, {
      status,
      statusText:
        init.statusText ?? (status >= 200 && status < 300 ? 'OK' : 'Error'),
      headers: { 'Content-Type': 'application/json' },
    });
  return vi.fn<typeof fetch>(impl);
}

/** Pull the call args off a fetch spy. */
function callOf(spy: FetchSpy, index = 0): { url: string; init: RequestInit } {
  const call = spy.mock.calls[index];
  if (call === undefined) throw new Error(`no fetch call at index ${index}`);
  return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

/** Encode UTF-8 string → base64 (same path as the production helper). */
function b64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

// ══════════════════════════════════════════════════════════════════════
// list
// ══════════════════════════════════════════════════════════════════════

describe('githubClient.list', () => {
  it('returns an array of entries for a directory listing', async () => {
    const fixture = JSON.stringify([
      { path: 'src/a.ts', name: 'a.ts', type: 'file', sha: 'aaa', size: 12 },
      { path: 'src/sub', name: 'sub', type: 'dir', sha: 'bbb' },
    ]);
    const fetchSpy = makeFetchSpy(fixture);
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    const entries = await client.list('src');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      path: 'src/a.ts',
      name: 'a.ts',
      type: 'file',
      sha: 'aaa',
      size: 12,
    });
    expect(entries[1]).toEqual({
      path: 'src/sub',
      name: 'sub',
      type: 'dir',
      sha: 'bbb',
    });

    // URL encodes segments individually, preserves '/'.
    const { url, init } = callOf(fetchSpy);
    expect(url).toBe(
      'https://api.github.com/repos/octocat/demo/contents/src?ref=main',
    );
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer ghp_test');
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
    expect(headers.get('X-GitHub-Api-Version')).toBe('2022-11-28');
  });

  it('wraps a single-file response in an array', async () => {
    const fixture = JSON.stringify({
      path: 'README.md',
      name: 'README.md',
      type: 'file',
      sha: 'r1',
      size: 33,
    });
    const fetchSpy = makeFetchSpy(fixture);
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    const entries = await client.list('README.md');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('file');
  });

  it('encodes path segments but preserves slashes', async () => {
    const fetchSpy = makeFetchSpy('[]');
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });
    await client.list('docs/notes & drafts/file.md');

    const { url } = callOf(fetchSpy);
    expect(url).toBe(
      'https://api.github.com/repos/octocat/demo/contents/docs/notes%20%26%20drafts/file.md?ref=main',
    );
  });

  it('throws on non-2xx responses', async () => {
    const fetchSpy = makeFetchSpy('{"message":"Not Found"}', { status: 404 });
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    await expect(client.list('missing')).rejects.toThrow(
      /github list missing: 404/,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// read
// ══════════════════════════════════════════════════════════════════════

describe('githubClient.read', () => {
  it('decodes base64 to UTF-8 for text files', async () => {
    const original = 'hello — world 🌍\n';
    const fixture = JSON.stringify({
      path: 'notes.md',
      sha: 'abc',
      size: original.length,
      content: b64Utf8(original) + '\n', // GitHub injects newlines
      encoding: 'base64',
    });
    const fetchSpy = makeFetchSpy(fixture);
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    const result = await client.read('notes.md');

    expect(result.path).toBe('notes.md');
    expect(result.sha).toBe('abc');
    expect(result.encoding).toBe('utf-8');
    expect(result.content).toBe(original);
  });

  it('preserves base64 content (stripped of whitespace) for binary files', async () => {
    const b64 = 'iVBORw0KGgo='; // arbitrary png-like base64
    const fixture = JSON.stringify({
      path: 'logo.png',
      sha: 'png1',
      size: 100,
      content: b64.slice(0, 5) + '\n' + b64.slice(5),
      encoding: 'base64',
    });
    const fetchSpy = makeFetchSpy(fixture);
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    const result = await client.read('logo.png');

    expect(result.encoding).toBe('base64');
    expect(result.content).toBe(b64);
  });

  it('throws on non-2xx responses', async () => {
    const fetchSpy = makeFetchSpy('{"message":"Not Found"}', { status: 404 });
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });
    await expect(client.read('nope.md')).rejects.toThrow(/github read nope.md: 404/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// write
// ══════════════════════════════════════════════════════════════════════

describe('githubClient.write', () => {
  it('PUTs base64-encoded content with branch and (when updating) sha', async () => {
    const responseFixture = JSON.stringify({
      content: { sha: 'newblob' },
      commit: { sha: 'c1', html_url: 'https://github.com/octocat/demo/commit/c1' },
    });
    const fetchSpy = makeFetchSpy(responseFixture, { status: 201 });
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    const result = await client.write(
      'notes/today.md',
      'Today I learned 🎓\n',
      'docs: add note',
      'oldsha',
    );

    expect(result).toEqual({
      sha: 'c1',
      url: 'https://github.com/octocat/demo/commit/c1',
    });

    const { url, init } = callOf(fetchSpy);
    expect(url).toBe(
      'https://api.github.com/repos/octocat/demo/contents/notes/today.md',
    );
    expect(init.method).toBe('PUT');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.message).toBe('docs: add note');
    expect(body.branch).toBe('main');
    expect(body.sha).toBe('oldsha');
    expect(body.content).toBe(b64Utf8('Today I learned 🎓\n'));
  });

  it('omits sha when creating a new file', async () => {
    const fetchSpy = makeFetchSpy(
      JSON.stringify({
        commit: { sha: 'c2', html_url: 'https://example/c2' },
      }),
      { status: 201 },
    );
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    await client.write('new.md', 'hi', 'docs: new');

    const { init } = callOf(fetchSpy);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect('sha' in body).toBe(false);
    expect(body.content).toBe(b64Utf8('hi'));
  });

  it('throws on non-2xx responses', async () => {
    const fetchSpy = makeFetchSpy('{"message":"Validation Failed"}', {
      status: 422,
    });
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });
    await expect(client.write('x.md', 'x', 'm')).rejects.toThrow(
      /github write x.md: 422/,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// delete
// ══════════════════════════════════════════════════════════════════════

describe('githubClient.delete', () => {
  it('sends sha and branch in a JSON body', async () => {
    const fetchSpy = makeFetchSpy(
      JSON.stringify({
        commit: { sha: 'd1', html_url: 'https://example/d1' },
      }),
    );
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    const result = await client.delete('old.md', 'chore: remove', 'sha-old');

    expect(result).toEqual({ sha: 'd1', url: 'https://example/d1' });

    const { url, init } = callOf(fetchSpy);
    expect(url).toBe(
      'https://api.github.com/repos/octocat/demo/contents/old.md',
    );
    expect(init.method).toBe('DELETE');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.message).toBe('chore: remove');
    expect(body.sha).toBe('sha-old');
    expect(body.branch).toBe('main');
  });

  it('throws on non-2xx responses', async () => {
    const fetchSpy = makeFetchSpy('{"message":"Conflict"}', { status: 409 });
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });
    await expect(client.delete('x.md', 'm', 's')).rejects.toThrow(
      /github delete x.md: 409/,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// history
// ══════════════════════════════════════════════════════════════════════

describe('githubClient.history', () => {
  it('returns commit metadata for a path', async () => {
    const fixture = JSON.stringify([
      {
        sha: 'c1',
        commit: {
          message: 'docs: edit',
          author: { name: 'Brent', date: '2026-05-30T10:00:00Z' },
        },
      },
      {
        sha: 'c0',
        commit: {
          message: 'docs: create',
          author: { name: 'Brent', date: '2026-05-29T09:00:00Z' },
        },
      },
    ]);
    const fetchSpy = makeFetchSpy(fixture);
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });

    const history = await client.history('notes.md', 5);

    expect(history).toEqual([
      {
        sha: 'c1',
        message: 'docs: edit',
        author: 'Brent',
        date: '2026-05-30T10:00:00Z',
      },
      {
        sha: 'c0',
        message: 'docs: create',
        author: 'Brent',
        date: '2026-05-29T09:00:00Z',
      },
    ]);

    const { url } = callOf(fetchSpy);
    expect(url).toBe(
      'https://api.github.com/repos/octocat/demo/commits?path=notes.md&sha=main&per_page=5',
    );
  });

  it('defaults to a per_page of 30', async () => {
    const fetchSpy = makeFetchSpy('[]');
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });
    await client.history('a.md');
    const { url } = callOf(fetchSpy);
    expect(url).toContain('per_page=30');
  });

  it('throws on non-2xx responses', async () => {
    const fetchSpy = makeFetchSpy('{"message":"err"}', { status: 500 });
    const client = githubClient(CONFIG, { fetchImpl: fetchSpy });
    await expect(client.history('x.md')).rejects.toThrow(
      /github history x.md: 500/,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// isBinaryPath
// ══════════════════════════════════════════════════════════════════════

describe('isBinaryPath', () => {
  it('flags well-known binary extensions', () => {
    expect(isBinaryPath('logo.png')).toBe(true);
    expect(isBinaryPath('archive.zip')).toBe(true);
    expect(isBinaryPath('font.woff2')).toBe(true);
    expect(isBinaryPath('MOD.WASM')).toBe(true); // case-insensitive
  });

  it('treats other files as text', () => {
    expect(isBinaryPath('notes.md')).toBe(false);
    expect(isBinaryPath('src/index.ts')).toBe(false);
    expect(isBinaryPath('README')).toBe(false);
  });
});
