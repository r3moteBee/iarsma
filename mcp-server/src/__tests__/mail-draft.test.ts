/**
 * Tests for the `mail.draft` MCP handler (Phase 2 items 2 + 10).
 *
 * Two branches:
 *   - dryRun=true  → no fetches; returns the proposed Email shape
 *     (proposedEmail + estimatedSize).
 *   - dryRun=false → resolves session, POSTs Email/set create,
 *     parses created["c0"] into {emailId, blobId, threadId, size}.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMailDraftHandler } from '../handlers/mail-draft.js';
import { makeScopeSet } from '../scope-filter.js';

const SESSION_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const EMAIL_SET_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        newState: 'state-2',
        created: {
          c0: { id: 'E-001', blobId: 'B-001', threadId: 'T-001', size: 256 },
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
  mailboxId: 'Mb-drafts',
  from: { email: 'brent@example.net' },
  to: [{ email: 'alice@example.net' }],
  subject: 'project plan',
  bodyText: 'Hi Alice.',
};

const SCOPES = makeScopeSet(['mail:draft']);

describe('createMailDraftHandler — dry-run', () => {
  it('returns the proposed Email shape without any fetches', async () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    const handler = createMailDraftHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const r = (await handler(SAMPLE_INPUT, { dryRun: true, scopes: SCOPES })) as {
      proposedEmail: {
        mailboxId: string;
        keywords: string[];
        subject: string;
        hasBodyText: boolean;
        hasBodyHtml: boolean;
      };
      estimatedSize: number;
    };
    expect(r.proposedEmail.mailboxId).toBe('Mb-drafts');
    expect(r.proposedEmail.keywords).toEqual(['$draft']);
    expect(r.proposedEmail.hasBodyText).toBe(true);
    expect(r.proposedEmail.hasBodyHtml).toBe(false);
    expect(r.estimatedSize).toBeGreaterThan(0);
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});

describe('createMailDraftHandler — commit', () => {
  it('resolves session then POSTs Email/set create and returns the result', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_SET_OK_BODY);
    const handler = createMailDraftHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const r = (await handler(SAMPLE_INPUT, {
      dryRun: false,
      scopes: SCOPES,
    })) as {
      emailId: string;
      blobId: string;
      threadId: string;
      size: number;
    };
    expect(r).toEqual({
      emailId: 'E-001',
      blobId: 'B-001',
      threadId: 'T-001',
      size: 256,
    });
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });

  it('surfaces a jmap_set_error when Email/set rejects', async () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            notCreated: {
              c0: { type: 'invalidProperties', description: 'subject required' },
            },
          },
          '0',
        ],
      ],
    });
    const handler = createMailDraftHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: makeTwoStageFetch(SESSION_BODY, body),
    });
    try {
      await handler(SAMPLE_INPUT, { dryRun: false, scopes: SCOPES });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('jmap_set_error');
      expect((e as Error).message).toContain('invalidProperties');
    }
  });
});

describe('createMailDraftHandler — input validation', () => {
  it('rejects missing mailboxId', async () => {
    const handler = createMailDraftHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const { mailboxId: _ignored, ...rest } = SAMPLE_INPUT;
    await expect(handler(rest, { dryRun: true, scopes: SCOPES })).rejects.toThrow(
      /mailboxId/,
    );
  });

  it('rejects an empty body on commit', async () => {
    const handler = createMailDraftHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const { bodyText: _ignored, ...noBody } = SAMPLE_INPUT;
    await expect(
      handler(noBody, { dryRun: false, scopes: SCOPES }),
    ).rejects.toThrow(/bodyText.*bodyHtml/);
  });
});
