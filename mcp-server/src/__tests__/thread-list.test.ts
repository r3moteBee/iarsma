/**
 * Tests for the `thread.list` MCP-server handler (Phase 1 work item 3).
 *
 * Same two-step pattern as `mailbox.list` — GET session → POST chained
 * Email/query + Email/get — but with input-validation tests on the
 * mailboxId / position / limit parameters and pagination assertions on
 * the request envelope.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createThreadListHandler } from '../handlers/thread-list.js';
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
  sessionStatus = 200,
  queryStatus = 200,
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
    return new Response(queryBody, {
      status: queryStatus,
      statusText: queryStatus === 200 ? 'OK' : 'Error',
    });
  }) as unknown as typeof fetch;
}

const ctx = { dryRun: false, scopes: makeScopeSet(['mail:read.metadata']) };

describe('createThreadListHandler — happy path', () => {
  it('resolves session, then POSTs Email/query+Email/get with paging, returns threads', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_QUERY_BODY);
    const handler = createThreadListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'agent-token',
      fetch: fetchSpy,
    });
    const result = (await handler(
      { mailboxId: 'Mb01', position: 0, limit: 25 },
      ctx,
    )) as { threads: ReadonlyArray<{ id: string }>; position: number; total?: number };
    expect(result.threads).toHaveLength(3);
    expect(result.position).toBe(0);
    expect(result.total).toBe(42);
  });

  it('issues exactly two HTTP calls — session, then chained Email/query+Email/get', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_QUERY_BODY);
    const handler = createThreadListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'agent-token',
      fetch: fetchSpy,
    });
    await handler({ mailboxId: 'Mb01' }, ctx);
    const calls = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toBe('https://sw-mail.example.net/.well-known/jmap');
    expect(calls[0]?.[1]?.method).toBe('GET');
    expect(calls[1]?.[0]).toBe('https://sw-mail.example.net/jmap/');
    expect(calls[1]?.[1]?.method).toBe('POST');
  });

  it('builds the JMAP request with collapseThreads + sort + filter + back-reference', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_QUERY_BODY);
    const handler = createThreadListHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'agent-token',
      fetch: fetchSpy,
    });
    await handler({ mailboxId: 'Mb01', position: 50, limit: 25 }, ctx);
    const calls = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const body = JSON.parse(String(calls[1]?.[1]?.body));
    expect(body.methodCalls[0][0]).toBe('Email/query');
    expect(body.methodCalls[0][1]).toMatchObject({
      accountId: 'c',
      filter: { inMailbox: 'Mb01' },
      collapseThreads: true,
      position: 50,
      limit: 25,
      calculateTotal: true,
    });
    expect(body.methodCalls[0][1].sort).toEqual([
      { property: 'receivedAt', isAscending: false },
    ]);
    expect(body.methodCalls[1][0]).toBe('Email/get');
    expect(body.methodCalls[1][1]['#ids']).toEqual({
      resultOf: '0',
      name: 'Email/query',
      path: '/ids',
    });
    expect(body.methodCalls[1][1].properties).toContain('threadId');
  });

  it('defaults position to 0 and limit to 50 when omitted', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_QUERY_BODY);
    const handler = createThreadListHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    await handler({ mailboxId: 'Mb01' }, ctx);
    const body = JSON.parse(
      String((fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1]?.[1]?.body),
    );
    expect(body.methodCalls[0][1].position).toBe(0);
    expect(body.methodCalls[0][1].limit).toBe(50);
  });

  it('caps limit at 200 even if the caller asks for more', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, EMAIL_QUERY_BODY);
    const handler = createThreadListHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    await handler({ mailboxId: 'Mb01', limit: 5000 }, ctx);
    const body = JSON.parse(
      String((fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1]?.[1]?.body),
    );
    expect(body.methodCalls[0][1].limit).toBe(200);
  });
});

describe('createThreadListHandler — input validation', () => {
  const handler = createThreadListHandler({
    jmapBaseUrl: 'https://x',
    bearerToken: 't',
    fetch: makeTwoStageFetch(SESSION_BODY, EMAIL_QUERY_BODY),
  });

  it('rejects non-object input', async () => {
    await expect(handler('not an object', ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('rejects missing mailboxId', async () => {
    await expect(handler({}, ctx)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects empty-string mailboxId', async () => {
    await expect(handler({ mailboxId: '' }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('rejects negative position', async () => {
    await expect(
      handler({ mailboxId: 'Mb01', position: -1 }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects fractional limit', async () => {
    await expect(
      handler({ mailboxId: 'Mb01', limit: 1.5 }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects zero or negative limit', async () => {
    await expect(
      handler({ mailboxId: 'Mb01', limit: 0 }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('createThreadListHandler — error paths', () => {
  it('surfaces 401 on the session leg as unauthorized', async () => {
    const handler = createThreadListHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeTwoStageFetch('nope', EMAIL_QUERY_BODY, 401, 200),
    });
    await expect(handler({ mailboxId: 'Mb01' }, ctx)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('surfaces 401 on the Email/query leg as unauthorized', async () => {
    const handler = createThreadListHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeTwoStageFetch(SESSION_BODY, 'nope', 200, 401),
    });
    await expect(handler({ mailboxId: 'Mb01' }, ctx)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('surfaces a method-error from Email/query in the error message', async () => {
    const errBody = JSON.stringify({
      methodResponses: [['error', { type: 'unknownMethod' }, '0']],
    });
    const handler = createThreadListHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeTwoStageFetch(SESSION_BODY, errBody),
    });
    await expect(handler({ mailboxId: 'Mb01' }, ctx)).rejects.toThrow(
      /method-error|unknownMethod/,
    );
  });
});
