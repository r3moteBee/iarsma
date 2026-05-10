/**
 * Tests for the `thread.get` MCP-server handler (Phase 1 work item 6).
 *
 * Same two-step pattern as thread.list — GET session → POST chained
 * Thread/get + Email/get — but the request envelope differs (Thread/get
 * with explicit ids list, Email/get with back-reference into
 * Thread/get's emailIds), and the response carries body parts we expose
 * as flattened bodyText / bodyHtml.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createThreadGetHandler } from '../handlers/thread-get.js';
import { makeScopeSet } from '../scope-filter.js';

const SESSION_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const THREAD_GET_BODY = readFileSync(
  resolve(__dirname, '../../../components/jmap-client/tests/fixtures/thread_get.json'),
  'utf8',
);

function makeTwoStageFetch(
  sessionBody: string,
  threadBody: string,
  sessionStatus = 200,
  threadStatus = 200,
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
    return new Response(threadBody, {
      status: threadStatus,
      statusText: threadStatus === 200 ? 'OK' : 'Error',
    });
  }) as unknown as typeof fetch;
}

const ctx = { dryRun: false, scopes: makeScopeSet(['mail:read']) };

describe('createThreadGetHandler — happy path', () => {
  it('resolves session, then POSTs Thread/get + Email/get with back-reference', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, THREAD_GET_BODY);
    const handler = createThreadGetHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 'agent-token',
      fetch: fetchSpy,
    });
    const result = (await handler({ threadId: 'T1' }, ctx)) as {
      thread: { id: string; emailIds: ReadonlyArray<string> };
      emails: ReadonlyArray<unknown>;
    };
    expect(result.thread.id).toBe('T1');
    expect(result.thread.emailIds).toEqual(['E1', 'E2']);
    expect(result.emails).toHaveLength(2);
  });

  it('builds the JMAP request with Thread/get ids and Email/get back-reference', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, THREAD_GET_BODY);
    const handler = createThreadGetHandler({
      jmapBaseUrl: 'https://sw-mail.example.net',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    await handler({ threadId: 'T1' }, ctx);
    const calls = (fetchSpy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls).toHaveLength(2);
    const body = JSON.parse(String(calls[1]?.[1]?.body));
    expect(body.methodCalls[0][0]).toBe('Thread/get');
    expect(body.methodCalls[0][1].ids).toEqual(['T1']);
    expect(body.methodCalls[1][0]).toBe('Email/get');
    expect(body.methodCalls[1][1]['#ids']).toEqual({
      resultOf: '0',
      name: 'Thread/get',
      path: '/list/0/emailIds',
    });
    expect(body.methodCalls[1][1].fetchTextBodyValues).toBe(true);
    expect(body.methodCalls[1][1].fetchHTMLBodyValues).toBe(true);
    expect(body.methodCalls[1][1].properties).toEqual(
      expect.arrayContaining(['bodyValues', 'textBody', 'htmlBody', 'attachments']),
    );
  });

  it('flattens body parts and surfaces attachment metadata', async () => {
    const fetchSpy = makeTwoStageFetch(SESSION_BODY, THREAD_GET_BODY);
    const handler = createThreadGetHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    const result = (await handler({ threadId: 'T1' }, ctx)) as {
      emails: ReadonlyArray<{
        bodyText?: string;
        bodyHtml?: string;
        attachments: ReadonlyArray<{ cid?: string; type: string; name?: string }>;
      }>;
    };
    const first = result.emails[0]!;
    expect(first.bodyText).toContain('Hi Alice');
    expect(first.bodyHtml).toContain('<p>Hi Alice');
    const second = result.emails[1]!;
    const inline = second.attachments.find((a) => a.cid !== undefined);
    expect(inline?.type).toBe('image/png');
    expect(inline?.cid).toBe('logo@example');
    const pdf = second.attachments.find((a) => a.type === 'application/pdf');
    expect(pdf?.name).toBe('contract.pdf');
  });
});

describe('createThreadGetHandler — input validation', () => {
  const handler = createThreadGetHandler({
    jmapBaseUrl: 'https://x',
    bearerToken: 't',
    fetch: makeTwoStageFetch(SESSION_BODY, THREAD_GET_BODY),
  });

  it('rejects non-object input', async () => {
    await expect(handler('not an object', ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('rejects missing threadId', async () => {
    await expect(handler({}, ctx)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects empty-string threadId', async () => {
    await expect(handler({ threadId: '' }, ctx)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

describe('createThreadGetHandler — error paths', () => {
  it('surfaces 401 on the session leg as unauthorized', async () => {
    const handler = createThreadGetHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeTwoStageFetch('nope', THREAD_GET_BODY, 401, 200),
    });
    await expect(handler({ threadId: 'T1' }, ctx)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('surfaces 401 on the Thread/get leg as unauthorized', async () => {
    const handler = createThreadGetHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeTwoStageFetch(SESSION_BODY, 'nope', 200, 401),
    });
    await expect(handler({ threadId: 'T1' }, ctx)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('surfaces a method-error from Thread/get', async () => {
    const errBody = JSON.stringify({
      methodResponses: [['error', { type: 'tooManyMethods' }, '0']],
    });
    const handler = createThreadGetHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeTwoStageFetch(SESSION_BODY, errBody),
    });
    await expect(handler({ threadId: 'T1' }, ctx)).rejects.toThrow(
      /method-error|tooManyMethods/,
    );
  });
});
