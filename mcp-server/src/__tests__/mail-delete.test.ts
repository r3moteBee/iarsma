/**
 * Tests for the `mail.delete` MCP handler (Phase 3a).
 *
 * Two branches:
 *   - dryRun=true  → fetches email metadata via Email/get and returns
 *     a preview with affectedCount + email summaries.
 *   - dryRun=false → resolves session, POSTs Email/set destroy,
 *     parses destroyed list into {deletedCount}.
 *
 * Also covers:
 *   - Input validation (emailIds must be a non-empty array)
 *   - Handling of notDestroyed errors in the response
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMailDeleteHandler } from '../handlers/mail-delete.js';
import { makeScopeSet } from '../scope-filter.js';

const SESSION_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const SCOPES = makeScopeSet(['mail:delete']);

// -- Fixtures ----------------------------------------------------------------

const EMAIL_GET_RESPONSE = JSON.stringify({
  methodResponses: [
    [
      'Email/get',
      {
        accountId: 'c',
        list: [
          {
            id: 'E-001',
            subject: 'Hello Alice',
            from: [{ name: 'Bob', email: 'bob@example.net' }],
          },
          {
            id: 'E-002',
            subject: 'Meeting notes',
            from: [{ email: 'carol@example.net' }],
          },
        ],
        notFound: [],
      },
      '0',
    ],
  ],
});

const EMAIL_SET_DESTROY_OK = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        destroyed: ['E-001', 'E-002'],
      },
      '0',
    ],
  ],
});

const EMAIL_SET_DESTROY_PARTIAL = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        destroyed: ['E-001'],
        notDestroyed: {
          'E-002': { type: 'notFound' },
        },
      },
      '0',
    ],
  ],
});

// -- Helpers -----------------------------------------------------------------

function makeTwoStageFetch(
  sessionBody: string,
  secondBody: string,
  secondStatus = 200,
): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) {
      return new Response(sessionBody, { status: 200, statusText: 'OK' });
    }
    return new Response(secondBody, {
      status: secondStatus,
      statusText: secondStatus === 200 ? 'OK' : 'Error',
    });
  }) as unknown as typeof fetch;
}

// -- Tests -------------------------------------------------------------------

describe('createMailDeleteHandler — dry-run', () => {
  it('fetches email metadata and returns a preview', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_GET_RESPONSE);
    const handler = createMailDeleteHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const r = (await handler(
      { emailIds: ['E-001', 'E-002'] },
      { dryRun: true, scopes: SCOPES },
    )) as {
      affectedCount: number;
      emails: Array<{ id: string; subject: string; from: string }>;
    };
    expect(r.affectedCount).toBe(2);
    expect(r.emails).toHaveLength(2);
    expect(r.emails[0]).toEqual({
      id: 'E-001',
      subject: 'Hello Alice',
      from: 'Bob <bob@example.net>',
    });
    expect(r.emails[1]).toEqual({
      id: 'E-002',
      subject: 'Meeting notes',
      from: 'carol@example.net',
    });
    // Should have made 2 fetch calls: session + Email/get
    expect(
      (fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(2);
  });
});

describe('createMailDeleteHandler — commit', () => {
  it('POSTs Email/set destroy and returns deletedCount', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_SET_DESTROY_OK);
    const handler = createMailDeleteHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const r = (await handler(
      { emailIds: ['E-001', 'E-002'] },
      { dryRun: false, scopes: SCOPES },
    )) as { deletedCount: number };
    expect(r.deletedCount).toBe(2);
    expect(
      (fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(2);
  });

  it('surfaces notDestroyed errors', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_SET_DESTROY_PARTIAL);
    const handler = createMailDeleteHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    try {
      await handler(
        { emailIds: ['E-001', 'E-002'] },
        { dryRun: false, scopes: SCOPES },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('jmap_set_error');
      expect((e as Error).message).toContain('notDestroyed');
      expect((e as Error).message).toContain('E-002');
    }
  });
});

describe('createMailDeleteHandler — input validation', () => {
  it('rejects missing emailIds', async () => {
    const handler = createMailDeleteHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      handler({}, { dryRun: true, scopes: SCOPES }),
    ).rejects.toThrow(/emailIds/);
  });

  it('rejects empty emailIds array', async () => {
    const handler = createMailDeleteHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      handler({ emailIds: [] }, { dryRun: true, scopes: SCOPES }),
    ).rejects.toThrow(/emailIds/);
  });

  it('rejects non-array emailIds', async () => {
    const handler = createMailDeleteHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      handler({ emailIds: 'not-an-array' }, { dryRun: true, scopes: SCOPES }),
    ).rejects.toThrow(/emailIds/);
  });
});
