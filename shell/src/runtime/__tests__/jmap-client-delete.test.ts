/**
 * Tests for mail.delete (Email/set destroy) — Task 4.
 *
 * Covers:
 *   - `buildMailDeleteRequest`: produces the correct `destroy` array.
 *   - `parseMailDeleteResponse`: extracts `deletedCount` from `destroyed`;
 *     throws on `notDestroyed`.
 *   - `fetchMailDeleteCommit`: auth check → POST → parse.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildMailDeleteRequest,
  fetchMailDeleteCommit,
  parseMailDeleteResponse,
  type Session,
} from '../jmap-client.js';
import type { ToolError } from '../types.js';

const SAMPLE_SESSION: Session = {
  username: 'user@example.net',
  apiUrl: 'https://sw-mail.example.net/jmap/',
  downloadUrl: 'https://sw-mail.example.net/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
  uploadUrl: 'https://sw-mail.example.net/jmap/upload/{accountId}/',
  eventSourceUrl:
    'https://sw-mail.example.net/jmap/eventsource/?types={types}&closeafter={closeafter}&ping={ping}',
  state: '817d3028',
  primaryAccountIdMail: 'c',
};

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

// ──────────────────────────────────────────────────────────────────────
// buildMailDeleteRequest
// ──────────────────────────────────────────────────────────────────────

describe('buildMailDeleteRequest', () => {
  it('produces Email/set with a destroy array', () => {
    const body = buildMailDeleteRequest({
      accountId: 'c',
      emailIds: ['E-1', 'E-2'],
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:mail',
    ]);
    expect(parsed.methodCalls).toHaveLength(1);
    expect(parsed.methodCalls[0]![0]).toBe('Email/set');
    const args = parsed.methodCalls[0]![1]!;
    expect(args.accountId).toBe('c');
    expect(args.destroy).toEqual(['E-1', 'E-2']);
  });

  it('handles a single email id', () => {
    const body = buildMailDeleteRequest({
      accountId: 'c',
      emailIds: ['E-solo'],
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.methodCalls[0]![1]!.destroy).toEqual(['E-solo']);
  });
});

// ──────────────────────────────────────────────────────────────────────
// parseMailDeleteResponse
// ──────────────────────────────────────────────────────────────────────

const DELETE_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        newState: 'state-3',
        destroyed: ['E-1', 'E-2'],
      },
      '0',
    ],
  ],
});

describe('parseMailDeleteResponse', () => {
  it('extracts deletedCount from the destroyed array', () => {
    const result = parseMailDeleteResponse(DELETE_OK_BODY);
    expect(result).toEqual({ deletedCount: 2 });
  });

  it('returns deletedCount: 0 when destroyed is an empty array', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Email/set', { accountId: 'c', destroyed: [] }, '0'],
      ],
    });
    const result = parseMailDeleteResponse(body);
    expect(result).toEqual({ deletedCount: 0 });
  });

  it('throws code=jmap_set_error when notDestroyed contains entries', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            accountId: 'c',
            destroyed: ['E-1'],
            notDestroyed: {
              'E-2': { type: 'notFound' },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseMailDeleteResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('notDestroyed');
      expect(err.message).toContain('E-2');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseMailDeleteResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error when methodResponses is empty', () => {
    const body = JSON.stringify({ methodResponses: [] });
    try {
      parseMailDeleteResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error when first methodResponse is not Email/set', () => {
    const body = JSON.stringify({
      methodResponses: [['error', { type: 'unknownMethod' }, '0']],
    });
    try {
      parseMailDeleteResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error when response is not an object', () => {
    try {
      parseMailDeleteResponse('"string"');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchMailDeleteCommit
// ──────────────────────────────────────────────────────────────────────

describe('fetchMailDeleteCommit', () => {
  it('POSTs Email/set destroy and returns the MailDeleteResult', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(DELETE_OK_BODY);
    const result = await fetchMailDeleteCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      emailIds: ['E-1', 'E-2'],
    });
    expect(result).toEqual({ deletedCount: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    const sentBody = init?.body as string;
    expect(sentBody).toContain('Email/set');
    expect(sentBody).toContain('destroy');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchMailDeleteCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(DELETE_OK_BODY),
        session: SAMPLE_SESSION,
        emailIds: ['E-1'],
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=jmap_http_error on a non-2xx response', async () => {
    await expect(
      fetchMailDeleteCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('err', { status: 500, statusText: 'Server Error' }),
        session: SAMPLE_SESSION,
        emailIds: ['E-1'],
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });

  it('surfaces 401 as unauthorized', async () => {
    await expect(
      fetchMailDeleteCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('nope', { status: 401, statusText: 'Unauthorized' }),
        session: SAMPLE_SESSION,
        emailIds: ['E-1'],
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
