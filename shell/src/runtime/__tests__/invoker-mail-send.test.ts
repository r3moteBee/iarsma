/**
 * Tests for the `mail.send` case in `jmapInvoker` (Phase 2 work item 3).
 *
 * Covers:
 *   - Dry-run builds the preview locally (no fetch). Envelope rcptTo
 *     flattens to+cc+bcc, body preview snippet derived from text/html
 *     content, attachment count is 0 in Phase 2, identityId echoed.
 *   - Commit fetches session + sends the chained Email/set +
 *     EmailSubmission/set in one HTTP roundtrip.
 *   - bodyPreview falls back to stripped HTML when only bodyHtml set.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jmapInvoker } from '../invoker.js';
import type { MailSendInput } from '../jmap-client.js';

const SESSION_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const EMAIL_SUBMISSION_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        created: {
          c0: { id: 'E-001', blobId: 'B-001', threadId: 'T-001', size: 256 },
        },
      },
      '0',
    ],
    [
      'EmailSubmission/set',
      {
        accountId: 'c',
        created: {
          s0: { id: 'S-001', sendAt: '2026-05-11T18:30:00Z' },
        },
      },
      '1',
    ],
  ],
});

const SEND_INPUT: MailSendInput = {
  sentMailboxId: 'Mb-sent',
  identityId: 'I-brent',
  from: { name: 'Brent', email: 'brent@example.net' },
  to: [{ name: 'Alice', email: 'alice@example.net' }],
  subject: 'project plan',
  bodyText: 'Hi Alice — here\'s the schedule.',
};

function makeRoutedFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.endsWith('/.well-known/jmap')) {
      return new Response(SESSION_FIXTURE, { status: 200, statusText: 'OK' });
    }
    return new Response(EMAIL_SUBMISSION_OK_BODY, {
      status: 200,
      statusText: 'OK',
    });
  });
}

type SendPreview = {
  recipients: {
    to: ReadonlyArray<{ name?: string; email: string }>;
    cc?: ReadonlyArray<{ name?: string; email: string }>;
    bcc?: ReadonlyArray<{ name?: string; email: string }>;
    envelopeRcptTo: string[];
  };
  subject: string;
  bodyPreview: string;
  hasBodyText: boolean;
  hasBodyHtml: boolean;
  attachmentCount: number;
  attachmentBlobIds: string[];
  estimatedSendTime: string;
  estimatedSize: number;
  identityId: string;
};

describe('jmapInvoker — mail.send', () => {
  it('dry-run builds preview locally with no fetch', async () => {
    const fetchSpy = makeRoutedFetch();
    const invoker = jmapInvoker({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
    });
    const preview = (await invoker.invoke<MailSendInput, unknown>(
      'mail.send',
      SEND_INPUT,
      { dryRun: true },
    )) as SendPreview;

    expect(preview.subject).toBe('project plan');
    expect(preview.recipients.to[0]?.email).toBe('alice@example.net');
    expect(preview.recipients.envelopeRcptTo).toEqual(['alice@example.net']);
    expect(preview.bodyPreview).toContain('Hi Alice');
    expect(preview.hasBodyText).toBe(true);
    expect(preview.hasBodyHtml).toBe(false);
    expect(preview.attachmentCount).toBe(0);
    expect(preview.attachmentBlobIds).toEqual([]);
    expect(preview.identityId).toBe('I-brent');
    expect(preview.estimatedSize).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('envelopeRcptTo flattens to + cc + bcc (silent bcc surfacing)', async () => {
    const fetchSpy = makeRoutedFetch();
    const invoker = jmapInvoker({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
    });
    const preview = (await invoker.invoke<MailSendInput, unknown>(
      'mail.send',
      {
        ...SEND_INPUT,
        cc: [{ email: 'cc@example.net' }],
        bcc: [{ email: 'bcc@example.net' }],
      },
      { dryRun: true },
    )) as SendPreview;

    expect(preview.recipients.envelopeRcptTo).toEqual([
      'alice@example.net',
      'cc@example.net',
      'bcc@example.net',
    ]);
  });

  it('bodyPreview falls back to stripped HTML when only bodyHtml is set', async () => {
    const fetchSpy = makeRoutedFetch();
    const invoker = jmapInvoker({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
    });
    const { bodyText: _t, ...noText } = SEND_INPUT;
    const preview = (await invoker.invoke<MailSendInput, unknown>(
      'mail.send',
      {
        ...noText,
        bodyHtml: '<p>Hi <b>Alice</b> — here\'s the <i>schedule</i>.</p>',
      },
      { dryRun: true },
    )) as SendPreview;

    expect(preview.hasBodyHtml).toBe(true);
    expect(preview.hasBodyText).toBe(false);
    expect(preview.bodyPreview).toContain('Hi');
    expect(preview.bodyPreview).toContain('Alice');
    expect(preview.bodyPreview).not.toContain('<');
    expect(preview.bodyPreview).not.toContain('>');
  });

  it('estimatedSendTime echoes sendAt when supplied', async () => {
    const fetchSpy = makeRoutedFetch();
    const invoker = jmapInvoker({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
    });
    const preview = (await invoker.invoke<MailSendInput, unknown>(
      'mail.send',
      { ...SEND_INPUT, sendAt: '2026-05-12T09:00:00Z' },
      { dryRun: true },
    )) as SendPreview;
    expect(preview.estimatedSendTime).toBe('2026-05-12T09:00:00Z');
  });

  it('commit fetches session + sends Email/set + EmailSubmission/set', async () => {
    const fetchSpy = makeRoutedFetch();
    const invoker = jmapInvoker({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
    });
    const result = (await invoker.invoke<MailSendInput, unknown>(
      'mail.send',
      SEND_INPUT,
      {},
    )) as {
      emailId: string;
      submissionId: string;
      sendAt?: string;
    };
    expect(result.emailId).toBe('E-001');
    expect(result.submissionId).toBe('S-001');
    expect(result.sendAt).toBe('2026-05-11T18:30:00Z');
    // 1 session fetch + 1 send = 2 round-trips total. EmailSubmission
    // rides the same HTTP request as Email/set per the back-reference.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
