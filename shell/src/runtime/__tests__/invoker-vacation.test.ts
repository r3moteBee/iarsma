/**
 * Tests for vacation.get + vacation.set (PR 32).
 *
 * Wraps JMAP VacationResponse/get + VacationResponse/set per RFC 8621.
 * The singleton id is always 'singleton'; iarsma's UI is text-only,
 * so htmlBody is always cleared.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { jmapInvoker } from '../invoker.js';

const SESSION_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

function makeFetch(
  apiBodies: readonly string[],
): { fetch: ReturnType<typeof vi.fn<typeof fetch>>; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.endsWith('/.well-known/jmap')) {
      return new Response(SESSION_FIXTURE, { status: 200 });
    }
    const body = String(init?.body ?? '');
    calls.push(body);
    const next = apiBodies[i++];
    if (next === undefined) {
      throw new Error(`unexpected API call #${i}: ${body.slice(0, 200)}`);
    }
    return new Response(next, { status: 200 });
  });
  return { fetch: fetchMock, calls };
}

describe('vacation.get (PR 32)', () => {
  it('returns the populated singleton when the server has one', async () => {
    const ok = JSON.stringify({
      methodResponses: [
        [
          'VacationResponse/get',
          {
            accountId: 'c',
            list: [
              {
                id: 'singleton',
                isEnabled: true,
                fromDate: '2026-06-10T00:00:00Z',
                toDate: '2026-06-20T23:59:59Z',
                subject: 'OOO',
                textBody: 'Back on the 20th.',
              },
            ],
          },
          '0',
        ],
      ],
    });
    const { fetch: fetchMock, calls } = makeFetch([ok]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });
    const result = await inv.invoke('vacation.get', {});
    expect(result).toEqual({
      id: 'singleton',
      isEnabled: true,
      fromDate: '2026-06-10T00:00:00Z',
      toDate: '2026-06-20T23:59:59Z',
      subject: 'OOO',
      textBody: 'Back on the 20th.',
    });
    expect(calls[0]).toMatch(/VacationResponse\/get/);
    expect(calls[0]).toMatch(/"ids":\["singleton"\]/);
  });

  it('returns a disabled singleton when the server returns an empty list', async () => {
    const empty = JSON.stringify({
      methodResponses: [
        ['VacationResponse/get', { accountId: 'c', list: [] }, '0'],
      ],
    });
    const { fetch: fetchMock } = makeFetch([empty]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });
    const result = await inv.invoke('vacation.get', {});
    expect(result).toEqual({ id: 'singleton', isEnabled: false });
  });
});

describe('vacation.set (PR 32)', () => {
  it('issues VacationResponse/set with the full update payload', async () => {
    const ok = JSON.stringify({
      methodResponses: [
        [
          'VacationResponse/set',
          { accountId: 'c', updated: { singleton: null } },
          '0',
        ],
      ],
    });
    const { fetch: fetchMock, calls } = makeFetch([ok]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });
    const result = await inv.invoke('vacation.set', {
      isEnabled: true,
      subject: 'On vacation',
      textBody: 'Back next week.',
      fromDate: '2026-06-10T00:00:00Z',
      toDate: '2026-06-20T23:59:59Z',
    });
    expect(result).toEqual({ ok: true });

    const body = calls[0]!;
    expect(body).toMatch(/VacationResponse\/set/);
    expect(body).toMatch(/"isEnabled":true/);
    expect(body).toMatch(/"subject":"On vacation"/);
    expect(body).toMatch(/"textBody":"Back next week."/);
    expect(body).toMatch(/"fromDate":"2026-06-10T00:00:00Z"/);
    expect(body).toMatch(/"toDate":"2026-06-20T23:59:59Z"/);
    // Always clears HTML body — iarsma is text-only for v1.
    expect(body).toMatch(/"htmlBody":null/);
  });

  it('sends nulls for cleared optional fields', async () => {
    const ok = JSON.stringify({
      methodResponses: [
        ['VacationResponse/set', { accountId: 'c', updated: { singleton: null } }, '0'],
      ],
    });
    const { fetch: fetchMock, calls } = makeFetch([ok]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });
    await inv.invoke('vacation.set', { isEnabled: false });
    const body = calls[0]!;
    expect(body).toMatch(/"isEnabled":false/);
    expect(body).toMatch(/"subject":null/);
    expect(body).toMatch(/"textBody":null/);
    expect(body).toMatch(/"fromDate":null/);
    expect(body).toMatch(/"toDate":null/);
  });

  it('throws when the server returns notUpdated for the singleton', async () => {
    const rejected = JSON.stringify({
      methodResponses: [
        [
          'VacationResponse/set',
          {
            accountId: 'c',
            notUpdated: {
              singleton: { type: 'invalidProperties', properties: ['fromDate'] },
            },
          },
          '0',
        ],
      ],
    });
    const { fetch: fetchMock } = makeFetch([rejected]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });
    await expect(inv.invoke('vacation.set', { isEnabled: true })).rejects.toThrow(
      /VacationResponse\/set rejected/,
    );
  });
});
