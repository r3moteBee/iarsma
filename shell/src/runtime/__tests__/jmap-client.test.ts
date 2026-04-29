import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchSession, parseSession } from '../jmap-client.js';
import type { ToolError } from '../types.js';

const FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

type FetchSpy = ReturnType<typeof makeFetchSpy>;

function makeFetchSpy(
  body: string,
  init: { status?: number; statusText?: string } = {},
) {
  const status = init.status ?? 200;
  const impl: typeof fetch = async () =>
    new Response(body, {
      status,
      statusText: init.statusText ?? (status >= 200 && status < 300 ? 'OK' : 'Error'),
    });
  return vi.fn<typeof fetch>(impl);
}

describe('parseSession (WASM component)', () => {
  it('parses the recorded fixture into a typed Session', () => {
    const session = parseSession(FIXTURE);
    expect(session.username).toBe('user@example.net');
    expect(session.apiUrl).toBe('https://sw-mail.example.net/jmap/');
    expect(session.state).toBe('817d3028');
    expect(session.primaryAccountIdMail).toBe('c');
  });

  it('throws ToolError-shaped value on malformed JSON', () => {
    try {
      parseSession('{not json');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchSession (host fetch + WASM parse)', () => {
  it('GETs /.well-known/jmap with the Bearer token and returns the parsed session', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(FIXTURE);
    const session = await fetchSession({
      baseUrl: 'https://sw-mail.example.net/',
      getAuthToken: () => 'token-abc',
      fetch: fetchSpy,
    });
    expect(session.username).toBe('user@example.net');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe('https://sw-mail.example.net/.well-known/jmap');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-abc');
  });

  it('strips a single trailing slash from baseUrl', async () => {
    const fetchSpy = makeFetchSpy(FIXTURE);
    await fetchSession({
      baseUrl: 'https://sw-mail.example.net/',
      getAuthToken: () => 't',
      fetch: fetchSpy,
    });
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe('https://sw-mail.example.net/.well-known/jmap');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchSession({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(FIXTURE),
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=unauthorized on a 401 response', async () => {
    await expect(
      fetchSession({
        baseUrl: 'https://x',
        getAuthToken: () => 't',
        fetch: makeFetchSpy('unauthorized', { status: 401, statusText: 'Unauthorized' }),
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with jmap_http_error on a 500 response', async () => {
    await expect(
      fetchSession({
        baseUrl: 'https://x',
        getAuthToken: () => 't',
        fetch: makeFetchSpy('boom', { status: 500, statusText: 'Server Error' }),
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });

  it('wraps fetch transport failures as network_error', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(
      fetchSession({
        baseUrl: 'https://x',
        getAuthToken: () => 't',
        fetch: vi.fn<typeof fetch>(fetchImpl),
      }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });

  it('wraps WASM parse errors as jmap_parse_error', async () => {
    await expect(
      fetchSession({
        baseUrl: 'https://x',
        getAuthToken: () => 't',
        fetch: makeFetchSpy('{not json'),
      }),
    ).rejects.toMatchObject({ code: 'jmap_parse_error' });
  });
});
