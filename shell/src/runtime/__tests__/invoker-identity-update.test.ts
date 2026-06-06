/**
 * Tests for identity.update (PR 33 — email signatures).
 *
 * Wraps JMAP Identity/set update for the textSignature field. The
 * full Identity record is operator-controlled (name/email/replyTo);
 * v1 only patches signatures.
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

describe('identity.update (PR 33)', () => {
  it('issues Identity/set update with the textSignature patch', async () => {
    const ok = JSON.stringify({
      methodResponses: [
        [
          'Identity/set',
          { accountId: 'c', updated: { 'I-1': null } },
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
    const result = await inv.invoke('identity.update', {
      identityId: 'I-1',
      patch: { textSignature: '— Jane' },
    });
    expect(result).toEqual({ ok: true });

    const body = calls[0]!;
    expect(body).toMatch(/Identity\/set/);
    expect(body).toMatch(/"I-1"/);
    expect(body).toMatch(/"textSignature":"— Jane"/);
  });

  it('sends explicit null to clear a signature', async () => {
    const ok = JSON.stringify({
      methodResponses: [
        ['Identity/set', { accountId: 'c', updated: { 'I-1': null } }, '0'],
      ],
    });
    const { fetch: fetchMock, calls } = makeFetch([ok]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });
    await inv.invoke('identity.update', {
      identityId: 'I-1',
      patch: { textSignature: null },
    });
    expect(calls[0]).toMatch(/"textSignature":null/);
  });

  it('omits unset patch fields (no field touched server-side)', async () => {
    const ok = JSON.stringify({
      methodResponses: [
        ['Identity/set', { accountId: 'c', updated: { 'I-1': null } }, '0'],
      ],
    });
    const { fetch: fetchMock, calls } = makeFetch([ok]);
    const inv = jmapInvoker({
      baseUrl: 'https://jmap.example.test',
      getAuthToken: () => 'tok',
      fetch: fetchMock,
    });
    // Empty patch (caller had nothing dirty); should still work and
    // simply not include any field in the update map.
    await inv.invoke('identity.update', {
      identityId: 'I-1',
      patch: {},
    });
    expect(calls[0]).not.toMatch(/textSignature/);
    expect(calls[0]).not.toMatch(/htmlSignature/);
  });

  it('throws when the server returns notUpdated', async () => {
    const rejected = JSON.stringify({
      methodResponses: [
        [
          'Identity/set',
          {
            accountId: 'c',
            notUpdated: {
              'I-1': { type: 'invalidProperties', properties: ['textSignature'] },
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
    await expect(
      inv.invoke('identity.update', {
        identityId: 'I-1',
        patch: { textSignature: 'whatever' },
      }),
    ).rejects.toThrow(/Identity\/set rejected/);
  });
});
