import { describe, expect, it, vi } from 'vitest';
import {
  fetchResolveThreadEmailIds,
  type Session,
} from '../jmap-client.js';

function fakeSession(): Session {
  // Only the fields the resolver reads need to be real.
  return {
    apiUrl: 'https://jmap.example/api',
    primaryAccountIdMail: 'acct-1',
  } as unknown as Session;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchResolveThreadEmailIds', () => {
  it('returns an empty map without fetching when threadIds is empty', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const out = await fetchResolveThreadEmailIds({
      baseUrl: 'https://jmap.example',
      getAuthToken: () => 'tok',
      fetch: fetchImpl,
      session: fakeSession(),
      threadIds: [],
    });
    expect(out.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends one batched Thread/get and maps threadId -> emailIds', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        methodResponses: [
          [
            'Thread/get',
            {
              list: [
                { id: 'T1', emailIds: ['E1a', 'E1b'] },
                { id: 'T2', emailIds: ['E2a'] },
              ],
            },
            '0',
          ],
        ],
      }),
    );
    const out = await fetchResolveThreadEmailIds({
      baseUrl: 'https://jmap.example',
      getAuthToken: () => 'tok',
      fetch: fetchImpl,
      session: fakeSession(),
      threadIds: ['T1', 'T2'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body));
    expect(body.methodCalls[0][0]).toBe('Thread/get');
    expect(body.methodCalls[0][1].ids).toEqual(['T1', 'T2']);
    expect([...out.get('T1')!]).toEqual(['E1a', 'E1b']);
    expect([...out.get('T2')!]).toEqual(['E2a']);
  });

  it('omits threads the server did not return', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        methodResponses: [['Thread/get', { list: [{ id: 'T1', emailIds: ['E1'] }] }, '0']],
      }),
    );
    const out = await fetchResolveThreadEmailIds({
      baseUrl: 'https://jmap.example',
      getAuthToken: () => 'tok',
      fetch: fetchImpl,
      session: fakeSession(),
      threadIds: ['T1', 'T-gone'],
    });
    expect(out.has('T1')).toBe(true);
    expect(out.has('T-gone')).toBe(false);
  });

  it('throws unauthorized when no token is available', async () => {
    await expect(
      fetchResolveThreadEmailIds({
        baseUrl: 'https://jmap.example',
        getAuthToken: () => null,
        fetch: vi.fn<typeof fetch>(),
        session: fakeSession(),
        threadIds: ['T1'],
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
