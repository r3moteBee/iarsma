/**
 * Tests for the `mailbox.list` MCP-server handler (Phase 1 work item 1).
 *
 * The handler is a two-step JMAP flow:
 *   1. GET /.well-known/jmap to resolve `apiUrl` + `primaryAccountIdMail`.
 *   2. POST `Mailbox/get` to that apiUrl, parse the response.
 *
 * Tests cover both legs and the error paths each leg can surface.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMailboxListHandler } from '../handlers/mailbox-list.js';
import { makeScopeSet } from '../scope-filter.js';

const SESSION_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const MAILBOX_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/mailbox_get.json'),
  'utf8',
);

/**
 * Build a fetch stub that responds with `sessionBody` on the first call and
 * `mailboxBody` on the second. Both responses are 200 by default; per-call
 * status overrides land via the second + third args.
 */
function makeTwoStageFetch(
  sessionBody: string,
  mailboxBody: string,
  sessionStatus = 200,
  mailboxStatus = 200,
): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    call += 1;
    if (call === 1) {
      return new Response(sessionBody, {
        status: sessionStatus,
        statusText: sessionStatus === 200 ? 'OK' : 'Error',
      });
    }
    return new Response(mailboxBody, {
      status: mailboxStatus,
      statusText: mailboxStatus === 200 ? 'OK' : 'Error',
    });
  }) as unknown as typeof fetch;
}

const ctx = { dryRun: false, scopes: makeScopeSet(['mail:read.metadata']) };

describe('createMailboxListHandler — happy path', () => {
  it('resolves the session, then POSTs Mailbox/get with accountId, returns parsed mailboxes', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, MAILBOX_BODY);
    const handler = createMailboxListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'agent-token',
      fetch: fetchSpy,
    });
    const result = await handler({}, ctx);
    const mailboxes = result as ReadonlyArray<{ id: string; role?: string; unreadEmails: number }>;
    expect(mailboxes).toHaveLength(5);
    const inbox = mailboxes.find((m) => m.role === 'inbox')!;
    expect(inbox.unreadEmails).toBe(3);
  });

  it('issues exactly two HTTP calls — one for session, one for Mailbox/get', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, MAILBOX_BODY);
    const handler = createMailboxListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'agent-token',
      fetch: fetchSpy,
    });
    await handler({}, ctx);
    expect((fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(2);

    const calls = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls[0]?.[0]).toBe('https://sw-mail.example.net/.well-known/jmap');
    expect(calls[0]?.[1]?.method).toBe('GET');
    expect(calls[1]?.[0]).toBe('https://sw-mail.example.net/jmap/');
    expect(calls[1]?.[1]?.method).toBe('POST');

    const body = JSON.parse(String(calls[1]?.[1]?.body));
    expect(body.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:mail',
    ]);
    expect(body.methodCalls[0][0]).toBe('Mailbox/get');
    expect(body.methodCalls[0][1].accountId).toBe('c');
  });

  it('passes the bearer token on both calls', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, MAILBOX_BODY);
    const handler = createMailboxListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'agent-token',
      fetch: fetchSpy,
    });
    await handler({}, ctx);
    const calls = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    for (const [, init] of calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer agent-token');
    }
  });
});

describe('createMailboxListHandler — error paths', () => {
  it('surfaces 401 on the session fetch as unauthorized', async () => {
    const fetchSpy = makeTwoStageFetch('nope', MAILBOX_BODY, 401, 200);
    const handler = createMailboxListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    await expect(handler({}, ctx)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('surfaces 401 on the Mailbox/get fetch as unauthorized', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, 'nope', 200, 401);
    const handler = createMailboxListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    await expect(handler({}, ctx)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('surfaces 5xx as jmap_http_error', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, 'boom', 200, 500);
    const handler = createMailboxListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    await expect(handler({}, ctx)).rejects.toMatchObject({ code: 'jmap_http_error' });
  });

  it('reports a useful message when Mailbox/get returns a method error', async () => {
    const errBody = JSON.stringify({
      methodResponses: [['error', { type: 'accountNotFound' }, '0']],
    });
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, errBody);
    const handler = createMailboxListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    await expect(handler({}, ctx)).rejects.toThrow(/method-error|accountNotFound/);
  });
});
