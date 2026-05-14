/**
 * Tests for the `thread.search` MCP handler (Phase 2 work items 9 + 10).
 *
 * Same two-step JMAP flow as `thread.list` but with a `text` filter.
 * Optional `inMailboxId` wraps the filter in an AND combinator per
 * RFC 8621 §4.4.1.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createThreadSearchHandler } from '../handlers/thread-search.js';
import { makeScopeSet } from '../scope-filter.js';

const SESSION_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const EMAIL_QUERY_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/email_query.json'),
  'utf8',
);

function makeTwoStageFetch(
  sessionBody: string,
  queryBody: string,
): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) {
      return new Response(sessionBody, { status: 200, statusText: 'OK' });
    }
    return new Response(queryBody, { status: 200, statusText: 'OK' });
  }) as unknown as typeof fetch;
}

const ctx = { dryRun: false, scopes: makeScopeSet(['mail:read']) };

describe('createThreadSearchHandler — happy path', () => {
  it('returns parsed threads from a text-filter Email/query', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_QUERY_BODY);
    const handler = createThreadSearchHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    const result = (await handler({ query: 'project plan' }, ctx)) as {
      threads: Array<{ id: string }>;
    };
    expect(result.threads.length).toBeGreaterThan(0);
    // Inspect the POST body the handler sent.
    const call2 = (fetchSpy as unknown as { mock: { calls: unknown[] } })
      .mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(call2[1].body as string) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const args = body.methodCalls[0]![1] as { filter: unknown };
    expect(args.filter).toEqual({ text: 'project plan' });
  });

  it('wraps in AND with inMailbox when scoped to one mailbox', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_QUERY_BODY);
    const handler = createThreadSearchHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'tok',
      fetch: fetchSpy,
    });
    await handler({ query: 'q', inMailboxId: 'Mb-inbox' }, ctx);
    const call2 = (fetchSpy as unknown as { mock: { calls: unknown[] } })
      .mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(call2[1].body as string) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect((body.methodCalls[0]![1] as { filter: unknown }).filter).toEqual({
      operator: 'AND',
      conditions: [{ text: 'q' }, { inMailbox: 'Mb-inbox' }],
    });
  });
});

describe('createThreadSearchHandler — input validation', () => {
  it('rejects empty query', async () => {
    const handler = createThreadSearchHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(handler({ query: '' }, ctx)).rejects.toThrow(/non-empty/);
    await expect(handler({ query: '   ' }, ctx)).rejects.toThrow(/non-empty/);
  });

  it('rejects non-object input', async () => {
    const handler = createThreadSearchHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 'tok',
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(handler(null, ctx)).rejects.toThrow(/object/);
    await expect(handler('hi', ctx)).rejects.toThrow(/object/);
  });
});
