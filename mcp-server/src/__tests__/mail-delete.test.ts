/**
 * Tests for the `mail.delete` MCP handler.
 *
 * D-055: mail.delete is soft-delete (move-to-Trash), not destroy.
 * Two branches:
 *   - dryRun=true  → fetches email metadata via Email/get and returns
 *     a preview with affectedCount + email summaries.
 *   - dryRun=false → resolves session, then in one round-trip:
 *       Mailbox/query (role=trash) + Email/get (mailboxIds);
 *     then a second round-trip Email/set update that swaps every
 *     source mailbox for Trash. Returns `{deletedCount}` — the
 *     count of emails the server reports as updated.
 *
 * Also covers:
 *   - Input validation (emailIds must be a non-empty array)
 *   - `notUpdated` errors surfaced as `jmap_set_error`
 *   - Missing Trash mailbox surfaces as `no_trash_mailbox`
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

const TRASH_AND_MEMBERSHIPS_OK = JSON.stringify({
  methodResponses: [
    [
      'Mailbox/query',
      { accountId: 'c', ids: ['Mb-trash'] },
      '0',
    ],
    [
      'Email/get',
      {
        accountId: 'c',
        list: [
          { id: 'E-001', mailboxIds: { 'Mb-inbox': true } },
          { id: 'E-002', mailboxIds: { 'Mb-inbox': true, 'Mb-project': true } },
        ],
      },
      '1',
    ],
  ],
});

const TRASH_MISSING = JSON.stringify({
  methodResponses: [
    [ 'Mailbox/query', { accountId: 'c', ids: [] }, '0' ],
    [ 'Email/get',     { accountId: 'c', list: [] }, '1' ],
  ],
});

const EMAIL_SET_UPDATE_OK = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        updated: { 'E-001': null, 'E-002': null },
      },
      '0',
    ],
  ],
});

const EMAIL_SET_UPDATE_PARTIAL = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        updated: { 'E-001': null },
        notUpdated: { 'E-002': { type: 'notFound' } },
      },
      '0',
    ],
  ],
});

// -- Helpers -----------------------------------------------------------------

/** Two-stage fetch — session GET, then one POST. */
function makeTwoStageFetch(sessionBody: string, secondBody: string): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) return new Response(sessionBody, { status: 200, statusText: 'OK' });
    return new Response(secondBody, { status: 200, statusText: 'OK' });
  }) as unknown as typeof fetch;
}

/**
 * Four-stage fetch for the soft-delete commit path:
 *   1) session GET
 *   2) Mailbox/query + Email/get (memberships)
 *   3) Email/set update
 *
 * The handler does GET-then-POST-then-POST, so three calls. We keep
 * the function name "four-stage" because future paths may add a
 * preflight.
 */
function makeCommitFetch(
  sessionBody: string,
  round1Body: string,
  round2Body: string,
): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) return new Response(sessionBody, { status: 200, statusText: 'OK' });
    if (call === 2) return new Response(round1Body, { status: 200, statusText: 'OK' });
    return new Response(round2Body, { status: 200, statusText: 'OK' });
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
    expect(
      (fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls,
    ).toHaveLength(2);
  });
});

describe('createMailDeleteHandler — commit (soft-delete, D-055)', () => {
  it('moves emails to Trash via Email/set update and returns deletedCount', async () => {
    const fetchSpy = makeCommitFetch(
      SESSION_BODY,
      TRASH_AND_MEMBERSHIPS_OK,
      EMAIL_SET_UPDATE_OK,
    );
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
    const calls = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(3);

    // Inspect the round-2 update body — should target Mb-trash and
    // remove the union of source mailboxes (Mb-inbox + Mb-project).
    const updateInit = calls[2]![1] as RequestInit;
    const updateBody = JSON.parse(String(updateInit.body));
    const update = updateBody.methodCalls[0][1].update;
    expect(update['E-001'].mailboxIds).toEqual({
      'Mb-trash': true,
      'Mb-inbox': false,
      'Mb-project': false,
    });
    // Both emails get the same patch — JMAP `Email/set update` is
    // idempotent on no-op removals.
    expect(update['E-002'].mailboxIds).toEqual(update['E-001'].mailboxIds);
  });

  it('surfaces notUpdated errors as jmap_set_error', async () => {
    const fetchSpy = makeCommitFetch(
      SESSION_BODY,
      TRASH_AND_MEMBERSHIPS_OK,
      EMAIL_SET_UPDATE_PARTIAL,
    );
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
      expect((e as Error).message).toContain('notUpdated');
      expect((e as Error).message).toContain('E-002');
    }
  });

  it('surfaces a missing Trash mailbox as no_trash_mailbox', async () => {
    const fetchSpy = makeCommitFetch(SESSION_BODY, TRASH_MISSING, '');
    const handler = createMailDeleteHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    try {
      await handler(
        { emailIds: ['E-001'] },
        { dryRun: false, scopes: SCOPES },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('no_trash_mailbox');
      expect((e as Error).message).toMatch(/role:\s*trash/);
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
