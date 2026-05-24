/**
 * Tests for the `mail.send` MCP handler (Phase 3a item 5).
 *
 * Three branches:
 *   - dryRun=true  → no fetches; returns a preview with recipients,
 *     subject, bodyPreview, estimatedSize, and identityId.
 *   - dryRun=false → resolves session, POSTs chained Email/set +
 *     EmailSubmission/set, parses created into MailSendResult.
 *   - Validation errors for missing required fields.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMailSendHandler } from '../handlers/mail-send.js';
import { makeScopeSet } from '../scope-filter.js';

const SESSION_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const SEND_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        newState: 'state-2',
        created: {
          c0: { id: 'E-100', blobId: 'B-100', threadId: 'T-100', size: 512 },
        },
      },
      '0',
    ],
    [
      'EmailSubmission/set',
      {
        accountId: 'c',
        created: {
          s0: { id: 'Sub-100', sendAt: '2026-05-23T14:00:00Z' },
        },
      },
      '1',
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
  sentMailboxId: 'Mb-sent',
  identityId: 'id-001',
  from: { email: 'brent@example.net' },
  to: [{ email: 'alice@example.net' }],
  subject: 'project update',
  bodyText: 'Hi Alice, here is the update.',
};

const SCOPES = makeScopeSet(['mail:send']);

describe('createMailSendHandler — dry-run', () => {
  it('returns a preview with recipients, subject, bodyPreview, estimatedSize, and identityId without any fetches', async () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    const handler = createMailSendHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const r = (await handler(SAMPLE_INPUT, { dryRun: true, scopes: SCOPES })) as {
      recipients: { to: Array<{ email: string }>; cc?: unknown; bcc?: unknown };
      subject: string;
      bodyPreview: string;
      estimatedSize: number;
      identityId: string;
    };
    expect(r.recipients.to).toEqual([{ email: 'alice@example.net' }]);
    expect(r.subject).toBe('project update');
    expect(r.bodyPreview).toBe('Hi Alice, here is the update.');
    expect(r.estimatedSize).toBeGreaterThan(0);
    expect(r.identityId).toBe('id-001');
    expect((fetchSpy as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it('includes cc and bcc in preview when provided', async () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    const handler = createMailSendHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const input = {
      ...SAMPLE_INPUT,
      cc: [{ email: 'bob@example.net' }],
      bcc: [{ email: 'carol@example.net' }],
    };
    const r = (await handler(input, { dryRun: true, scopes: SCOPES })) as {
      recipients: {
        to: Array<{ email: string }>;
        cc: Array<{ email: string }>;
        bcc: Array<{ email: string }>;
      };
    };
    expect(r.recipients.cc).toEqual([{ email: 'bob@example.net' }]);
    expect(r.recipients.bcc).toEqual([{ email: 'carol@example.net' }]);
  });

  it('truncates bodyPreview for long bodies', async () => {
    const handler = createMailSendHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const input = {
      ...SAMPLE_INPUT,
      bodyText: 'x'.repeat(300),
    };
    const r = (await handler(input, { dryRun: true, scopes: SCOPES })) as {
      bodyPreview: string;
    };
    expect(r.bodyPreview.length).toBeLessThanOrEqual(260);
    expect(r.bodyPreview).toContain('…');
  });
});

describe('createMailSendHandler — commit', () => {
  it('resolves session then POSTs chained Email/set + EmailSubmission/set and returns the result', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, SEND_OK_BODY);
    const handler = createMailSendHandler({
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
      submissionId: string;
      sendAt?: string;
    };
    expect(r).toEqual({
      emailId: 'E-100',
      blobId: 'B-100',
      threadId: 'T-100',
      size: 512,
      submissionId: 'Sub-100',
      sendAt: '2026-05-23T14:00:00Z',
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
        [
          'EmailSubmission/set',
          { created: {} },
          '1',
        ],
      ],
    });
    const handler = createMailSendHandler({
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

  it('surfaces a submission_rejected error when EmailSubmission/set rejects', async () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            created: {
              c0: { id: 'E-100', blobId: 'B-100', threadId: 'T-100', size: 512 },
            },
          },
          '0',
        ],
        [
          'EmailSubmission/set',
          {
            notCreated: {
              s0: { type: 'forbidden', description: 'relay denied' },
            },
          },
          '1',
        ],
      ],
    });
    const handler = createMailSendHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: makeTwoStageFetch(SESSION_BODY, body),
    });
    try {
      await handler(SAMPLE_INPUT, { dryRun: false, scopes: SCOPES });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('submission_rejected');
      expect((e as Error).message).toContain('relay denied');
    }
  });
});

describe('createMailSendHandler — input validation', () => {
  it('rejects missing to', async () => {
    const handler = createMailSendHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const { to: _ignored, ...rest } = SAMPLE_INPUT;
    await expect(handler(rest, { dryRun: true, scopes: SCOPES })).rejects.toThrow(
      /input\.to/,
    );
  });

  it('rejects missing subject', async () => {
    const handler = createMailSendHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const { subject: _ignored, ...rest } = SAMPLE_INPUT;
    await expect(handler(rest, { dryRun: true, scopes: SCOPES })).rejects.toThrow(
      /input\.subject/,
    );
  });

  it('rejects missing sentMailboxId', async () => {
    const handler = createMailSendHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const { sentMailboxId: _ignored, ...rest } = SAMPLE_INPUT;
    await expect(handler(rest, { dryRun: true, scopes: SCOPES })).rejects.toThrow(
      /sentMailboxId/,
    );
  });

  it('rejects missing identityId', async () => {
    const handler = createMailSendHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const { identityId: _ignored, ...rest } = SAMPLE_INPUT;
    await expect(handler(rest, { dryRun: true, scopes: SCOPES })).rejects.toThrow(
      /identityId/,
    );
  });

  it('rejects an empty body on commit', async () => {
    const handler = createMailSendHandler({
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
