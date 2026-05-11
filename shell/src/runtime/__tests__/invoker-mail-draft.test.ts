/**
 * Tests for the `mail.draft` case in `jmapInvoker` (Phase 2 work item 2).
 *
 * Covers the two branches of the destructive contract:
 *
 *   - `dryRun: true` builds the preview locally (no fetch). The
 *     preview shape matches the contract's `dryRun.preview` schema —
 *     `proposedEmail` + `estimatedSize`.
 *   - `dryRun: false` (commit) POSTs Email/set to the JMAP API URL
 *     and parses the response.
 *
 * Session discovery (`session.get` against /.well-known/jmap) is
 * exercised end-to-end on the commit branch — the invoker caches the
 * session per-instance per the existing pattern.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jmapInvoker } from '../invoker.js';
import type { MailDraftInput } from '../jmap-client.js';

const SESSION_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/session.json'),
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
          c0: {
            id: 'E-001',
            blobId: 'B-001',
            threadId: 'T-001',
            size: 256,
          },
        },
      },
      '0',
    ],
  ],
});

const DRAFT_INPUT: MailDraftInput = {
  mailboxId: 'Mb-drafts',
  from: { name: 'Brent', email: 'brent@example.net' },
  to: [{ name: 'Alice', email: 'alice@example.net' }],
  subject: 'project plan',
  bodyText: 'Hi Alice — here\'s the schedule.',
};

/** Fetch impl that hands back the session fixture for /.well-known/jmap
 *  and the Email/set fixture for the JMAP API URL. */
function makeRoutedFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/.well-known/jmap')) {
      return new Response(SESSION_FIXTURE, { status: 200, statusText: 'OK' });
    }
    return new Response(EMAIL_SET_OK_BODY, { status: 200, statusText: 'OK' });
  });
}

describe('jmapInvoker — mail.draft', () => {
  it('dry-run returns the proposed-email preview locally without fetching', async () => {
    const fetchSpy = makeRoutedFetch();
    const invoker = jmapInvoker({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
    });
    const preview = (await invoker.invoke<MailDraftInput, unknown>(
      'mail.draft',
      DRAFT_INPUT,
      { dryRun: true },
    )) as {
      proposedEmail: {
        mailboxId: string;
        keywords: string[];
        subject: string;
        hasBodyText: boolean;
        hasBodyHtml: boolean;
        bodyTextSize: number;
        bodyHtmlSize: number;
      };
      estimatedSize: number;
    };
    expect(preview.proposedEmail.mailboxId).toBe('Mb-drafts');
    expect(preview.proposedEmail.keywords).toEqual(['$draft']);
    expect(preview.proposedEmail.subject).toBe('project plan');
    expect(preview.proposedEmail.hasBodyText).toBe(true);
    expect(preview.proposedEmail.hasBodyHtml).toBe(false);
    expect(preview.proposedEmail.bodyTextSize).toBeGreaterThan(0);
    expect(preview.estimatedSize).toBeGreaterThan(0);
    // Dry-run MUST NOT fetch anything — no session lookup, no Email/set.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('commit fetches the session (once) and POSTs Email/set', async () => {
    const fetchSpy = makeRoutedFetch();
    const invoker = jmapInvoker({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
    });
    const result = (await invoker.invoke<MailDraftInput, unknown>(
      'mail.draft',
      DRAFT_INPUT,
      {},
    )) as { emailId: string; blobId: string; threadId: string; size: number };
    expect(result.emailId).toBe('E-001');
    expect(result.blobId).toBe('B-001');
    expect(result.threadId).toBe('T-001');
    expect(result.size).toBe(256);
    // Two fetches: session discovery + Email/set. The session is
    // cached per-invoker — a second commit would only fetch once
    // more (for Email/set).
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const urls = fetchSpy.mock.calls.map((c) =>
      typeof c[0] === 'string'
        ? c[0]
        : c[0] instanceof URL
          ? c[0].toString()
          : (c[0] as Request).url,
    );
    expect(urls[0]).toContain('/.well-known/jmap');
    expect(urls[1]).toContain('/jmap/');
  });

  it('subsequent commits reuse the cached session (one fetch each)', async () => {
    const fetchSpy = makeRoutedFetch();
    const invoker = jmapInvoker({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
    });
    await invoker.invoke<MailDraftInput, unknown>('mail.draft', DRAFT_INPUT, {});
    await invoker.invoke<MailDraftInput, unknown>('mail.draft', DRAFT_INPUT, {});
    // 1 session + 2 Email/set = 3 total.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
