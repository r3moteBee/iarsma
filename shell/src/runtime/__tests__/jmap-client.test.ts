import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fetchMailboxList,
  fetchSession,
  parseMailboxes,
  parseSession,
  type Session,
} from '../jmap-client.js';
import type { ToolError } from '../types.js';

const FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/session.json'),
  'utf8',
);

const MAILBOX_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/mailbox_get.json'),
  'utf8',
);

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

// ──────────────────────────────────────────────────────────────────────
// mailbox.list — Phase 1 work item 1
// ──────────────────────────────────────────────────────────────────────

describe('parseMailboxes (WASM component)', () => {
  it('parses the recorded fixture into a typed Mailbox[]', () => {
    const mailboxes = parseMailboxes(MAILBOX_FIXTURE);
    expect(mailboxes).toHaveLength(5);
    const inbox = mailboxes.find((m) => m.role === 'inbox')!;
    expect(inbox.name).toBe('Inbox');
    expect(inbox.parentId).toBeUndefined();
    expect(inbox.unreadEmails).toBe(3);
  });

  it('converts WIT bigint counts to JS number', () => {
    const mailboxes = parseMailboxes(MAILBOX_FIXTURE);
    for (const m of mailboxes) {
      expect(typeof m.totalEmails).toBe('number');
      expect(typeof m.unreadEmails).toBe('number');
      expect(typeof m.totalThreads).toBe('number');
      expect(typeof m.unreadThreads).toBe('number');
    }
  });

  it('preserves nested mailboxes via parentId so the host can fold the tree', () => {
    const mailboxes = parseMailboxes(MAILBOX_FIXTURE);
    const project = mailboxes.find((m) => m.name === 'Project')!;
    expect(project.parentId).toBe('Mb01');
  });

  it('throws ToolError-shaped value on malformed JSON', () => {
    try {
      parseMailboxes('{not json');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchMailboxList (host fetch + WASM parse)', () => {
  it('POSTs Mailbox/get with the using array + accountId, returns parsed mailboxes', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(MAILBOX_FIXTURE);
    const mailboxes = await fetchMailboxList({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 't',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
    });
    expect(mailboxes).toHaveLength(5);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:mail',
    ]);
    expect(body.methodCalls[0][0]).toBe('Mailbox/get');
    expect(body.methodCalls[0][1].accountId).toBe(SAMPLE_SESSION.primaryAccountIdMail);
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchMailboxList({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(MAILBOX_FIXTURE),
        session: SAMPLE_SESSION,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=unauthorized on a 401 response', async () => {
    await expect(
      fetchMailboxList({
        baseUrl: 'https://x',
        getAuthToken: () => 't',
        fetch: makeFetchSpy('nope', { status: 401, statusText: 'Unauthorized' }),
        session: SAMPLE_SESSION,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('wraps a Mailbox/get method-error response as jmap_parse_error', async () => {
    const errorBody = JSON.stringify({
      methodResponses: [['error', { type: 'accountNotFound' }, '0']],
    });
    await expect(
      fetchMailboxList({
        baseUrl: 'https://x',
        getAuthToken: () => 't',
        fetch: makeFetchSpy(errorBody),
        session: SAMPLE_SESSION,
      }),
    ).rejects.toMatchObject({ code: 'jmap_parse_error' });
  });
});
