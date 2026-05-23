/**
 * Tests for mail.modify JMAP client functions.
 *
 * Covers `buildMailModifyRequest`, `parseMailModifyResponse`, and
 * `fetchMailModifyCommit` — the Email/set update path for moving
 * emails between mailboxes and toggling keywords.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildMailModifyRequest,
  fetchMailModifyCommit,
  parseMailModifyResponse,
  type MailModifyInput,
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
// buildMailModifyRequest
// ──────────────────────────────────────────────────────────────────────

describe('buildMailModifyRequest', () => {
  it('builds correct JMAP path-based update for mailboxIds', () => {
    const body = buildMailModifyRequest({
      accountId: 'c',
      params: {
        emailIds: ['E-1'],
        patch: {
          mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true },
        },
      },
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toContain('urn:ietf:params:jmap:mail');
    expect(parsed.methodCalls[0]?.[0]).toBe('Email/set');
    const args = parsed.methodCalls[0]?.[1] as {
      accountId: string;
      update: Record<string, Record<string, unknown>>;
    };
    expect(args.accountId).toBe('c');
    const update = args.update['E-1']!;
    expect(update['mailboxIds/Mb-inbox']).toBe(false);
    expect(update['mailboxIds/Mb-archive']).toBe(true);
  });

  it('builds correct JMAP path-based update for keywords', () => {
    const body = buildMailModifyRequest({
      accountId: 'c',
      params: {
        emailIds: ['E-1'],
        patch: {
          keywords: { $seen: true, $flagged: false },
        },
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const update = (
      parsed.methodCalls[0]?.[1] as {
        update: Record<string, Record<string, unknown>>;
      }
    ).update['E-1']!;
    expect(update['keywords/$seen']).toBe(true);
    expect(update['keywords/$flagged']).toBe(false);
  });

  it('handles both mailboxIds and keywords together', () => {
    const body = buildMailModifyRequest({
      accountId: 'c',
      params: {
        emailIds: ['E-1'],
        patch: {
          mailboxIds: { 'Mb-inbox': false, 'Mb-archive': true },
          keywords: { $seen: true },
        },
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const update = (
      parsed.methodCalls[0]?.[1] as {
        update: Record<string, Record<string, unknown>>;
      }
    ).update['E-1']!;
    expect(update['mailboxIds/Mb-inbox']).toBe(false);
    expect(update['mailboxIds/Mb-archive']).toBe(true);
    expect(update['keywords/$seen']).toBe(true);
  });

  it('applies same patch to all emailIds', () => {
    const body = buildMailModifyRequest({
      accountId: 'c',
      params: {
        emailIds: ['E-1', 'E-2', 'E-3'],
        patch: {
          keywords: { $seen: true },
        },
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const update = (
      parsed.methodCalls[0]?.[1] as {
        update: Record<string, Record<string, unknown>>;
      }
    ).update;
    expect(Object.keys(update)).toEqual(['E-1', 'E-2', 'E-3']);
    for (const id of ['E-1', 'E-2', 'E-3']) {
      expect(update[id]!['keywords/$seen']).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// parseMailModifyResponse
// ──────────────────────────────────────────────────────────────────────

const EMAIL_SET_UPDATE_OK = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        newState: 'state-3',
        updated: {
          'E-1': null,
          'E-2': null,
          'E-3': null,
        },
      },
      '0',
    ],
  ],
});

describe('parseMailModifyResponse', () => {
  it('extracts correct modifiedCount from updated map', () => {
    const result = parseMailModifyResponse(EMAIL_SET_UPDATE_OK);
    expect(result).toEqual({ modifiedCount: 3 });
  });

  it('returns modifiedCount 0 when updated map is empty', () => {
    const body = JSON.stringify({
      methodResponses: [
        ['Email/set', { accountId: 'c', updated: {} }, '0'],
      ],
    });
    const result = parseMailModifyResponse(body);
    expect(result).toEqual({ modifiedCount: 0 });
  });

  it('throws on notUpdated entries with error details', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            notUpdated: {
              'E-1': {
                type: 'notFound',
                description: 'Email not found',
              },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseMailModifyResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('notFound');
      expect(err.message).toContain('Email not found');
    }
  });

  it('throws on notUpdated with multiple entries (reports first)', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            notUpdated: {
              'E-1': { type: 'notFound' },
              'E-2': { type: 'invalidProperties' },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseMailModifyResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
    }
  });

  it('throws code=jmap_parse_error on missing first methodResponse', () => {
    const body = JSON.stringify({ methodResponses: [] });
    try {
      parseMailModifyResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseMailModifyResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error when first methodResponse is not Email/set', () => {
    const body = JSON.stringify({
      methodResponses: [['Mailbox/set', {}, '0']],
    });
    try {
      parseMailModifyResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchMailModifyCommit
// ──────────────────────────────────────────────────────────────────────

const SAMPLE_MODIFY_INPUT: MailModifyInput = {
  emailIds: ['E-1', 'E-2'],
  patch: {
    keywords: { $seen: true },
  },
};

describe('fetchMailModifyCommit', () => {
  it('POSTs Email/set with the right body and returns the MailModifyResult', async () => {
    const fetchSpy = makeFetchSpy(EMAIL_SET_UPDATE_OK);
    const result = await fetchMailModifyCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      params: SAMPLE_MODIFY_INPUT,
    });
    expect(result.modifiedCount).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    const sentBody = init?.body as string;
    expect(sentBody).toContain('Email/set');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchMailModifyCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EMAIL_SET_UPDATE_OK),
        session: SAMPLE_SESSION,
        params: SAMPLE_MODIFY_INPUT,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=jmap_http_error on a non-2xx response', async () => {
    await expect(
      fetchMailModifyCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('err', { status: 500, statusText: 'Server Error' }),
        session: SAMPLE_SESSION,
        params: SAMPLE_MODIFY_INPUT,
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });

  it('rejects with code=unauthorized on a 401 response', async () => {
    await expect(
      fetchMailModifyCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('nope', { status: 401, statusText: 'Unauthorized' }),
        session: SAMPLE_SESSION,
        params: SAMPLE_MODIFY_INPUT,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('wraps fetch transport failures as network_error', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(
      fetchMailModifyCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: vi.fn<typeof fetch>(fetchImpl),
        session: SAMPLE_SESSION,
        params: SAMPLE_MODIFY_INPUT,
      }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });
});
