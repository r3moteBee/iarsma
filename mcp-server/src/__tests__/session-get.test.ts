/**
 * Tests for the `session.get` MCP-server handler. Covers:
 *   - env-var resolution (`loadSessionGetDeps`)
 *   - happy path (handler returns the narrowed Session record)
 *   - 401 / 403 surface as `unauthorized`
 *   - non-2xx generic surfaces as `jmap_http_error`
 *   - response-shape mismatch surfaces a useful error
 *   - missing primary mail account surfaces a useful error
 */

import { describe, expect, it, vi } from 'vitest';
import {
  SessionGetConfigError,
  createSessionGetHandler,
  loadSessionGetDeps,
} from '../handlers/session-get.js';
import { makeScopeSet } from '../scope-filter.js';

const STALWART_SESSION_BODY = {
  capabilities: {
    'urn:ietf:params:jmap:core': {},
    'urn:ietf:params:jmap:mail': {},
  },
  accounts: { c: { name: 'user@example.net' } },
  primaryAccounts: {
    'urn:ietf:params:jmap:mail': 'c',
    'urn:ietf:params:jmap:submission': 'c',
  },
  username: 'user@example.net',
  apiUrl: 'https://sw-mail.example.net/jmap/',
  downloadUrl:
    'https://sw-mail.example.net/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
  uploadUrl: 'https://sw-mail.example.net/jmap/upload/{accountId}/',
  eventSourceUrl:
    'https://sw-mail.example.net/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
  state: '817d3028',
};

function makeFetch(
  body: unknown,
  init: { status?: number; statusText?: string } = {},
): typeof fetch {
  const status = init.status ?? 200;
  return vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      statusText: init.statusText ?? (status >= 200 && status < 300 ? 'OK' : 'Error'),
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

const ctx = { dryRun: false, scopes: makeScopeSet(['session:read']) };

describe('loadSessionGetDeps', () => {
  it('returns null when either env var is unset', () => {
    expect(loadSessionGetDeps({})).toBeNull();
    expect(
      loadSessionGetDeps({ IARSMA_JMAP_BASE_URL: 'https://x' }),
    ).toBeNull();
    expect(loadSessionGetDeps({ IARSMA_AGENT_TOKEN: 't' })).toBeNull();
  });

  it('returns null when env vars are empty/whitespace', () => {
    expect(
      loadSessionGetDeps({
        IARSMA_JMAP_BASE_URL: '   ',
        IARSMA_AGENT_TOKEN: 't',
      }),
    ).toBeNull();
    expect(
      loadSessionGetDeps({
        IARSMA_JMAP_BASE_URL: 'https://x',
        IARSMA_AGENT_TOKEN: '',
      }),
    ).toBeNull();
  });

  it('returns deps when both vars are set', () => {
    const deps = loadSessionGetDeps({
      IARSMA_JMAP_BASE_URL: 'https://sw-mail.example.net',
      IARSMA_AGENT_TOKEN: 'tok-123',
    });
    expect(deps?.jmapBaseUrl).toBe('https://sw-mail.example.net');
    expect(deps?.bearerToken).toBe('tok-123');
  });

  it('throws SessionGetConfigError on a malformed URL', () => {
    expect(() =>
      loadSessionGetDeps({
        IARSMA_JMAP_BASE_URL: 'not a url',
        IARSMA_AGENT_TOKEN: 't',
      }),
    ).toThrow(SessionGetConfigError);
  });
});

describe('createSessionGetHandler', () => {
  it('GETs /.well-known/jmap with Bearer token and returns the narrowed Session', async () => {
    const fetchSpy = makeFetch(STALWART_SESSION_BODY);
    const handler = createSessionGetHandler({
      jmapBaseUrl: 'https://sw-mail.example.net/',
      bearerToken: 'token-abc',
      fetch: fetchSpy,
    });

    const result = (await handler({}, ctx)) as Record<string, unknown>;
    expect(result['username']).toBe('user@example.net');
    expect(result['apiUrl']).toBe('https://sw-mail.example.net/jmap/');
    expect(result['state']).toBe('817d3028');
    expect(result['primaryAccountIdMail']).toBe('c');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]!;
    expect(call[0]).toBe('https://sw-mail.example.net/.well-known/jmap');
    const headers = ((call[1] as RequestInit).headers ?? {}) as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer token-abc');
  });

  it('classifies 401 as `unauthorized` via the error code property', async () => {
    const handler = createSessionGetHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeFetch('nope', { status: 401, statusText: 'Unauthorized' }),
    });
    try {
      await handler({}, ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/401/);
      expect((e as Error & { code?: string }).code).toBe('unauthorized');
    }
  });

  it('classifies 500 as `jmap_http_error`', async () => {
    const handler = createSessionGetHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeFetch('boom', { status: 500, statusText: 'Server Error' }),
    });
    try {
      await handler({}, ctx);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('jmap_http_error');
    }
  });

  it('rejects when the response is missing required fields', async () => {
    const handler = createSessionGetHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeFetch({ ...STALWART_SESSION_BODY, username: undefined }),
    });
    await expect(handler({}, ctx)).rejects.toThrow(/expected shape/);
  });

  it('rejects when primaryAccounts has no mail entry', async () => {
    const handler = createSessionGetHandler({
      jmapBaseUrl: 'https://x',
      bearerToken: 't',
      fetch: makeFetch({
        ...STALWART_SESSION_BODY,
        primaryAccounts: { 'urn:ietf:params:jmap:submission': 'c' },
      }),
    });
    await expect(handler({}, ctx)).rejects.toThrow(/missing primary account/);
  });

  it('strips a single trailing slash from the base URL', async () => {
    const fetchSpy = makeFetch(STALWART_SESSION_BODY);
    const handler = createSessionGetHandler({
      jmapBaseUrl: 'https://sw-mail.example.net/',
      bearerToken: 't',
      fetch: fetchSpy,
    });
    await handler({}, ctx);
    const call = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]!;
    expect(call[0]).toBe('https://sw-mail.example.net/.well-known/jmap');
  });
});
