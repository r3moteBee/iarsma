/**
 * Tests for the `mail.modify` MCP handler (Phase 3a).
 *
 * Two branches:
 *   - dryRun=true  → no fetches; returns a preview with affectedCount
 *     and a changes array showing the patch that would be applied.
 *   - dryRun=false → resolves session, POSTs Email/set update with
 *     JMAP path-based patches, parses response into { modifiedCount }.
 *
 * Validation:
 *   - emailIds must be a non-empty array
 *   - patch must contain at least one of mailboxIds or keywords
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMailModifyHandler } from '../handlers/mail-modify.js';
import { makeScopeSet } from '../scope-filter.js';

const SESSION_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const EMAIL_SET_UPDATE_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        newState: 'state-3',
        updated: {
          'E-001': null,
          'E-002': null,
        },
      },
      '0',
    ],
  ],
});

function makeTwoStageFetch(
  sessionBody: string,
  setBody: string,
  setStatus = 200,
): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) {
      return new Response(sessionBody, { status: 200, statusText: 'OK' });
    }
    return new Response(setBody, {
      status: setStatus,
      statusText: setStatus === 200 ? 'OK' : 'Error',
    });
  }) as unknown as typeof fetch;
}

const SAMPLE_INPUT = {
  emailIds: ['E-001', 'E-002'],
  patch: {
    mailboxIds: { inbox: false, trash: true },
    keywords: { $seen: true },
  },
};

const SCOPES = makeScopeSet(['mail:modify']);

describe('createMailModifyHandler — dry-run', () => {
  it('returns preview with affectedCount and changes array without any fetches', async () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    const handler = createMailModifyHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const r = (await handler(SAMPLE_INPUT, { dryRun: true, scopes: SCOPES })) as {
      affectedCount: number;
      changes: Array<{ emailId: string; patchApplied: unknown }>;
    };
    expect(r.affectedCount).toBe(2);
    expect(r.changes).toHaveLength(2);
    expect(r.changes[0]).toEqual({
      emailId: 'E-001',
      patchApplied: SAMPLE_INPUT.patch,
    });
    expect(r.changes[1]).toEqual({
      emailId: 'E-002',
      patchApplied: SAMPLE_INPUT.patch,
    });
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});

describe('createMailModifyHandler — commit', () => {
  it('resolves session then POSTs Email/set update and returns modifiedCount', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_SET_UPDATE_OK_BODY);
    const handler = createMailModifyHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const r = (await handler(SAMPLE_INPUT, {
      dryRun: false,
      scopes: SCOPES,
    })) as { modifiedCount: number };
    expect(r).toEqual({ modifiedCount: 2 });
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);

    // Verify the second call (Email/set) sent the right body.
    const secondCall = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1]!;
    const sentBody = JSON.parse(secondCall[1].body as string);
    expect(sentBody.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:mail',
    ]);
    const methodCall = sentBody.methodCalls[0];
    expect(methodCall[0]).toBe('Email/set');
    // Verify path-based update syntax
    expect(methodCall[1].update['E-001']).toEqual({
      'mailboxIds/inbox': false,
      'mailboxIds/trash': true,
      'keywords/$seen': true,
    });
    expect(methodCall[1].update['E-002']).toEqual({
      'mailboxIds/inbox': false,
      'mailboxIds/trash': true,
      'keywords/$seen': true,
    });
  });

  it('surfaces a jmap_set_error when Email/set rejects an update', async () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            notUpdated: {
              'E-001': { type: 'notFound', description: 'Email not found' },
            },
          },
          '0',
        ],
      ],
    });
    const handler = createMailModifyHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: makeTwoStageFetch(SESSION_BODY, body),
    });
    try {
      await handler(SAMPLE_INPUT, { dryRun: false, scopes: SCOPES });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('jmap_set_error');
      expect((e as Error).message).toContain('notFound');
      expect((e as Error).message).toContain('E-001');
    }
  });
});

describe('createMailModifyHandler — input validation', () => {
  it('rejects when emailIds is missing', async () => {
    const handler = createMailModifyHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      handler({ patch: { mailboxIds: { inbox: false } } }, { dryRun: true, scopes: SCOPES }),
    ).rejects.toThrow(/emailIds/);
  });

  it('rejects when emailIds is empty', async () => {
    const handler = createMailModifyHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      handler(
        { emailIds: [], patch: { mailboxIds: { inbox: false } } },
        { dryRun: true, scopes: SCOPES },
      ),
    ).rejects.toThrow(/emailIds/);
  });

  it('rejects when patch has neither mailboxIds nor keywords', async () => {
    const handler = createMailModifyHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      handler(
        { emailIds: ['E-001'], patch: {} },
        { dryRun: true, scopes: SCOPES },
      ),
    ).rejects.toThrow(/patch.*mailboxIds.*keywords/);
  });

  it('rejects when patch is missing', async () => {
    const handler = createMailModifyHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      handler(
        { emailIds: ['E-001'] },
        { dryRun: true, scopes: SCOPES },
      ),
    ).rejects.toThrow(/patch/);
  });
});
