/**
 * Tests for `files.propose_write` (Phase 5b).
 *
 * The handler has three phases:
 *   1. Read current content (or 404 → create-new).
 *   2. Build a unified diff for the dry-run preview.
 *   3. On commit, append a JMAP approval email.
 *
 * Tests cover the dry-run + commit branches and the unified-diff helper
 * directly. The approval-bridge call is exercised against a fake fetch
 * that simulates Mailbox/query + Mailbox/set + Email/set in sequence.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createFilesProposeWriteHandler,
  unifiedDiff,
} from '../handlers/files-propose-write.js';
import type { GithubConfigStore } from '../github-config.js';
import { makeScopeSet } from '../scope-filter.js';

function staticStore(): GithubConfigStore {
  return {
    current: () => ({ token: 't', owner: 'o', repo: 'r' }),
    reload: () => {},
  };
}

const writeScopes = makeScopeSet(['files:write']);

describe('unifiedDiff', () => {
  it('returns header-only when the file is unchanged', () => {
    const out = unifiedDiff('a.txt', 'hello\nworld\n', 'hello\nworld\n', false);
    expect(out).toMatch(/^--- a\/a\.txt\n\+\+\+ b\/a\.txt\n$/);
  });

  it('produces a single-hunk add+context for a one-line edit', () => {
    const out = unifiedDiff(
      'a.txt',
      'line1\nline2\nline3\n',
      'line1\nline2-edited\nline3\n',
      false,
    );
    expect(out).toContain('--- a/a.txt');
    expect(out).toContain('+++ b/a.txt');
    expect(out).toContain('-line2');
    expect(out).toContain('+line2-edited');
  });

  it('uses /dev/null on create', () => {
    const out = unifiedDiff('new.txt', '', 'hello\n', true);
    expect(out).toContain('--- /dev/null');
    expect(out).toContain('+++ b/new.txt');
    expect(out).toContain('+hello');
  });
});

describe('createFilesProposeWriteHandler — dry run', () => {
  it('reads current, returns a diff preview, never writes', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          path: 'README.md',
          sha: 'sha-current',
          size: 12,
          content: Buffer.from('hello\nworld\n').toString('base64'),
          encoding: 'base64',
        }),
        { status: 200, statusText: 'OK' },
      ),
    ) as unknown as typeof fetch;
    const handler = createFilesProposeWriteHandler({
      configStore: staticStore(),
      jmapBaseUrl: 'https://sw-mail.example.net',
      fetch: fetchSpy,
    });
    const preview = (await handler(
      {
        path: 'README.md',
        content: 'hello\nworld 2\n',
        encoding: 'utf-8',
        message: 'docs: update',
      },
      { dryRun: true, scopes: writeScopes, bearerToken: 'key' },
    )) as {
      diff: { unified: string; baseSha: string; isCreate: boolean; isBinary: boolean };
      message: string;
      path: string;
    };
    expect(preview.path).toBe('README.md');
    expect(preview.message).toBe('docs: update');
    expect(preview.diff.baseSha).toBe('sha-current');
    expect(preview.diff.isCreate).toBe(false);
    expect(preview.diff.isBinary).toBe(false);
    expect(preview.diff.unified).toContain('-world');
    expect(preview.diff.unified).toContain('+world 2');
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('reports isCreate=true when the current read returns 404', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch;
    const handler = createFilesProposeWriteHandler({
      configStore: staticStore(),
      jmapBaseUrl: 'https://sw-mail.example.net',
      fetch: fetchSpy,
    });
    const preview = (await handler(
      {
        path: 'NEW.md',
        content: 'hello\n',
        encoding: 'utf-8',
        message: 'docs: add',
      },
      { dryRun: true, scopes: writeScopes, bearerToken: 'key' },
    )) as { diff: { isCreate: boolean; baseSha: string; unified: string } };
    expect(preview.diff.isCreate).toBe(true);
    expect(preview.diff.baseSha).toBe('');
    expect(preview.diff.unified).toContain('--- /dev/null');
  });

  it('flags binary paths and emits a placeholder diff', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          path: 'logo.png',
          sha: 'b1',
          size: 4,
          content: 'AAAA',
          encoding: 'base64',
        }),
        { status: 200, statusText: 'OK' },
      ),
    ) as unknown as typeof fetch;
    const handler = createFilesProposeWriteHandler({
      configStore: staticStore(),
      jmapBaseUrl: 'https://sw-mail.example.net',
      fetch: fetchSpy,
    });
    const preview = (await handler(
      {
        path: 'logo.png',
        content: 'BBBB',
        encoding: 'base64',
        message: 'replace logo',
      },
      { dryRun: true, scopes: writeScopes, bearerToken: 'key' },
    )) as { diff: { isBinary: boolean; unified: string } };
    expect(preview.diff.isBinary).toBe(true);
    expect(preview.diff.unified).toContain('binary content omitted');
  });

  it('refuses commit without a bearer token', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          path: 'a.txt',
          sha: 's',
          size: 0,
          content: '',
          encoding: 'base64',
        }),
        { status: 200, statusText: 'OK' },
      ),
    ) as unknown as typeof fetch;
    const handler = createFilesProposeWriteHandler({
      configStore: staticStore(),
      jmapBaseUrl: 'https://sw-mail.example.net',
      fetch: fetchSpy,
    });
    await expect(
      handler(
        { path: 'a.txt', content: 'x', encoding: 'utf-8', message: 'm' },
        { dryRun: false, scopes: writeScopes },
      ),
    ).rejects.toThrow(/stalwartApiKey|Stalwart API key/);
  });
});

describe('createFilesProposeWriteHandler — commit appends approval email', () => {
  it('creates an Approvals mailbox if missing, then posts the approval email and returns its id', async () => {
    let call = 0;
    const fetchSpy = vi.fn(async () => {
      call += 1;
      // Call 1: read current
      if (call === 1) {
        return new Response(
          JSON.stringify({
            path: 'a.txt',
            sha: 'sha-cur',
            size: 6,
            content: Buffer.from('hello\n').toString('base64'),
            encoding: 'base64',
          }),
          { status: 200, statusText: 'OK' },
        );
      }
      // Call 2: JMAP session
      if (call === 2) {
        return new Response(
          JSON.stringify({
            apiUrl: 'https://sw-mail.example.net/jmap',
            primaryAccounts: {
              'urn:ietf:params:jmap:mail': 'acct-1',
            },
            accounts: {},
            capabilities: {
              'urn:ietf:params:jmap:core': {},
              'urn:ietf:params:jmap:mail': {},
            },
            username: 'brent',
            downloadUrl: 'https://sw-mail.example.net/download',
            uploadUrl: 'https://sw-mail.example.net/upload',
            eventSourceUrl: 'https://sw-mail.example.net/eventsource',
            state: 's0',
          }),
          { status: 200, statusText: 'OK' },
        );
      }
      // Call 3: Mailbox/query → empty
      if (call === 3) {
        return new Response(
          JSON.stringify({
            methodResponses: [['Mailbox/query', { ids: [] }, '0']],
          }),
          { status: 200, statusText: 'OK' },
        );
      }
      // Call 4: Mailbox/set → created
      if (call === 4) {
        return new Response(
          JSON.stringify({
            methodResponses: [['Mailbox/set', { created: { m0: { id: 'mb-1' } } }, '0']],
          }),
          { status: 200, statusText: 'OK' },
        );
      }
      // Call 5: Email/set → created
      return new Response(
        JSON.stringify({
          methodResponses: [['Email/set', { created: { c0: { id: 'approval-1' } } }, '0']],
        }),
        { status: 200, statusText: 'OK' },
      );
    }) as unknown as typeof fetch;

    const handler = createFilesProposeWriteHandler({
      configStore: staticStore(),
      jmapBaseUrl: 'https://sw-mail.example.net',
      fetch: fetchSpy,
    });
    const out = (await handler(
      { path: 'a.txt', content: 'hello\nworld\n', encoding: 'utf-8', message: 'm' },
      { dryRun: false, scopes: writeScopes, bearerToken: 'sw-key', agentId: 'ag-1', agentName: 'Test Agent' },
    )) as { approvalId: string };
    expect(out.approvalId).toBe('approval-1');
  });
});
