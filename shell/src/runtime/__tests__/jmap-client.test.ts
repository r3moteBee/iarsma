import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildIdentityListRequest,
  buildMailDraftRequest,
  buildMailSendRequest,
  fetchAttachmentUpload,
  fetchIdentityList,
  fetchMailDraftCommit,
  fetchMailSendCommit,
  fetchMailboxList,
  fetchSession,
  fetchThreadGet,
  fetchThreadList,
  parseEmailSetResponse,
  parseEmailSubmissionSetResponse,
  parseIdentityListResponse,
  parseMailboxes,
  parseSession,
  parseThreadGet,
  parseThreadList,
  type MailDraftInput,
  type MailSendInput,
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

const EMAIL_QUERY_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/email_query.json'),
  'utf8',
);

const THREAD_GET_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../components/jmap-client/tests/fixtures/thread_get.json'),
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

// ──────────────────────────────────────────────────────────────────────
// thread.list — Phase 1 work item 3
// ──────────────────────────────────────────────────────────────────────

describe('parseThreadList (WASM component)', () => {
  it('parses the recorded fixture into a typed ThreadList', () => {
    const result = parseThreadList(EMAIL_QUERY_FIXTURE);
    expect(result.threads).toHaveLength(3);
    expect(result.position).toBe(0);
    expect(result.total).toBe(42);
    expect(result.threads[0]?.id).toBe('T1');
    expect(result.threads[0]?.latestEmail.id).toBe('E1');
    expect(result.threads[0]?.latestEmail.subject).toBe('Welcome');
  });

  it('converts WIT bigint size + total to JS number', () => {
    const result = parseThreadList(EMAIL_QUERY_FIXTURE);
    expect(typeof result.total).toBe('number');
    for (const t of result.threads) {
      expect(typeof t.latestEmail.size).toBe('number');
    }
  });

  it('preserves keyword flags as the array shape from JMAP', () => {
    const result = parseThreadList(EMAIL_QUERY_FIXTURE);
    const flagged = result.threads.find((t) => t.id === 'T2')!;
    const keywords = Object.fromEntries(
      flagged.latestEmail.keywords.map((k) => [k.name, k.value]),
    );
    expect(keywords['$seen']).toBe(true);
    expect(keywords['$flagged']).toBe(true);
  });

  it('handles null subject + missing keywords gracefully', () => {
    const result = parseThreadList(EMAIL_QUERY_FIXTURE);
    const t3 = result.threads.find((t) => t.id === 'T3')!;
    expect(t3.latestEmail.subject).toBeUndefined();
    expect(t3.latestEmail.keywords).toEqual([]);
  });

  it('throws ToolError-shaped value on malformed JSON', () => {
    try {
      parseThreadList('{not json');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchThreadList (host fetch + WASM parse)', () => {
  it('POSTs Email/query + Email/get with back-reference, returns parsed threads', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(EMAIL_QUERY_FIXTURE);
    const result = await fetchThreadList({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      mailboxId: 'Mb01',
      position: 0,
      limit: 50,
    });
    expect(result.threads).toHaveLength(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:mail',
    ]);
    expect(body.methodCalls).toHaveLength(2);
    expect(body.methodCalls[0][0]).toBe('Email/query');
    expect(body.methodCalls[0][1]).toMatchObject({
      accountId: 'c',
      filter: { inMailbox: 'Mb01' },
      collapseThreads: true,
      position: 0,
      limit: 50,
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
  });

  it('applies the default limit of 50 when limit is omitted', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(EMAIL_QUERY_FIXTURE);
    await fetchThreadList({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      mailboxId: 'Mb01',
    });
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body));
    expect(body.methodCalls[0][1].limit).toBe(50);
  });

  it('caps the limit at 200 even if the caller asks for more', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(EMAIL_QUERY_FIXTURE);
    await fetchThreadList({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      mailboxId: 'Mb01',
      limit: 5000,
    });
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body));
    expect(body.methodCalls[0][1].limit).toBe(200);
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchThreadList({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EMAIL_QUERY_FIXTURE),
        session: SAMPLE_SESSION,
        mailboxId: 'Mb01',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('surfaces 401 as unauthorized', async () => {
    await expect(
      fetchThreadList({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('nope', { status: 401, statusText: 'Unauthorized' }),
        session: SAMPLE_SESSION,
        mailboxId: 'Mb01',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('wraps an Email/query method-error response as jmap_parse_error', async () => {
    const errorBody = JSON.stringify({
      methodResponses: [['error', { type: 'unknownMethod' }, '0']],
    });
    await expect(
      fetchThreadList({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy(errorBody),
        session: SAMPLE_SESSION,
        mailboxId: 'Mb01',
      }),
    ).rejects.toMatchObject({ code: 'jmap_parse_error' });
  });
});

// ──────────────────────────────────────────────────────────────────────
// thread.get — Phase 1 work item 6
// ──────────────────────────────────────────────────────────────────────

describe('parseThreadGet (WASM component)', () => {
  it('parses the recorded fixture into a typed ThreadGet', () => {
    const result = parseThreadGet(THREAD_GET_FIXTURE);
    expect(result.thread.id).toBe('T1');
    expect(result.thread.emailIds).toEqual(['E1', 'E2']);
    expect(result.emails).toHaveLength(2);
    expect(result.emails[0]?.id).toBe('E1');
    expect(result.emails[1]?.id).toBe('E2');
  });

  it('flattens body parts into bodyText / bodyHtml strings', () => {
    const result = parseThreadGet(THREAD_GET_FIXTURE);
    const first = result.emails[0]!;
    expect(first.bodyText).toContain('Hi Alice');
    expect(first.bodyHtml).toContain('<p>Hi Alice');
  });

  it('exposes attachments with cid, type, size, disposition', () => {
    const result = parseThreadGet(THREAD_GET_FIXTURE);
    const second = result.emails[1]!;
    expect(second.attachments).toHaveLength(2);
    const inline = second.attachments.find((a) => a.cid !== undefined);
    expect(inline?.cid).toBe('logo@example');
    expect(inline?.disposition).toBe('inline');
    expect(inline?.type).toBe('image/png');
    const pdf = second.attachments.find((a) => a.type === 'application/pdf');
    expect(pdf?.name).toBe('contract.pdf');
    expect(pdf?.size).toBe(12345);
  });

  it('preserves cc + sentAt when present', () => {
    const result = parseThreadGet(THREAD_GET_FIXTURE);
    const first = result.emails[0]!;
    expect(first.cc).toEqual([{ email: 'cc@example.net' }]);
    expect(first.sentAt).toBe('2026-05-09T15:41:50Z');
  });

  it('converts WIT bigint sizes + email size to JS number', () => {
    const result = parseThreadGet(THREAD_GET_FIXTURE);
    for (const e of result.emails) {
      expect(typeof e.size).toBe('number');
      for (const a of e.attachments) {
        expect(typeof a.size).toBe('number');
      }
    }
  });

  it('throws ToolError-shaped value on malformed JSON', () => {
    try {
      parseThreadGet('{not json');
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchThreadGet (host fetch + WASM parse)', () => {
  it('POSTs Thread/get + Email/get with back-reference, returns parsed thread', async () => {
    const fetchSpy: FetchSpy = makeFetchSpy(THREAD_GET_FIXTURE);
    const result = await fetchThreadGet({
      baseUrl: 'https://sw-mail.example.net',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      threadId: 'T1',
    });
    expect(result.thread.id).toBe('T1');
    expect(result.emails).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.using).toEqual([
      'urn:ietf:params:jmap:core',
      'urn:ietf:params:jmap:mail',
    ]);
    expect(body.methodCalls).toHaveLength(2);
    expect(body.methodCalls[0][0]).toBe('Thread/get');
    expect(body.methodCalls[0][1]).toMatchObject({
      accountId: 'c',
      ids: ['T1'],
    });
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

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchThreadGet({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(THREAD_GET_FIXTURE),
        session: SAMPLE_SESSION,
        threadId: 'T1',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('surfaces 401 as unauthorized', async () => {
    await expect(
      fetchThreadGet({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('nope', { status: 401, statusText: 'Unauthorized' }),
        session: SAMPLE_SESSION,
        threadId: 'T1',
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('wraps a Thread/get method-error as jmap_parse_error', async () => {
    const errorBody = JSON.stringify({
      methodResponses: [['error', { type: 'tooManyMethods' }, '0']],
    });
    await expect(
      fetchThreadGet({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy(errorBody),
        session: SAMPLE_SESSION,
        threadId: 'T1',
      }),
    ).rejects.toMatchObject({ code: 'jmap_parse_error' });
  });
});

// ──────────────────────────────────────────────────────────────────────
// mail.draft (Email/set create) — Phase 2 item 2
// ──────────────────────────────────────────────────────────────────────

const SAMPLE_DRAFT_INPUT: MailDraftInput = {
  mailboxId: 'Mb-drafts',
  from: { name: 'Brent', email: 'brent@example.net' },
  to: [{ name: 'Alice', email: 'alice@example.net' }],
  subject: 'project plan',
  bodyText: "Hi Alice,\n\nHere's the schedule.\n\nBrent",
};

const EMAIL_SET_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        newState: 'state-2',
        created: {
          c0: {
            id: 'E-001',
            blobId: 'B-001',
            threadId: 'T-001',
            size: 256,
          },
        },
      },
      '0',
    ],
  ],
});

describe('buildMailDraftRequest', () => {
  it('builds a single-part text body when only bodyText is set', () => {
    const body = buildMailDraftRequest({
      accountId: 'c',
      params: SAMPLE_DRAFT_INPUT,
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toContain('urn:ietf:params:jmap:mail');
    expect(parsed.methodCalls[0]?.[0]).toBe('Email/set');
    const args = parsed.methodCalls[0]?.[1] as {
      accountId: string;
      create: Record<string, Record<string, unknown>>;
    };
    expect(args.accountId).toBe('c');
    const email = args.create['c0']!;
    expect(email.mailboxIds).toEqual({ 'Mb-drafts': true });
    expect(email.keywords).toEqual({ $draft: true });
    expect(email.subject).toBe('project plan');
    // Single body part → bodyStructure is the part itself, not multipart.
    expect((email.bodyStructure as { type: string }).type).toBe('text/plain');
  });

  it('builds multipart/alternative when both text and html are set', () => {
    const body = buildMailDraftRequest({
      accountId: 'c',
      params: {
        ...SAMPLE_DRAFT_INPUT,
        bodyHtml: '<p>Hi</p>',
      },
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const email = (
      parsed.methodCalls[0]?.[1] as {
        create: Record<string, Record<string, unknown>>;
      }
    ).create['c0']!;
    const structure = email.bodyStructure as {
      type: string;
      subParts: Array<{ type: string }>;
    };
    expect(structure.type).toBe('multipart/alternative');
    expect(structure.subParts.map((p) => p.type)).toEqual([
      'text/plain',
      'text/html',
    ]);
  });

  it('includes cc + bcc when supplied (and omits them when not)', () => {
    const body = buildMailDraftRequest({
      accountId: 'c',
      params: {
        ...SAMPLE_DRAFT_INPUT,
        cc: [{ email: 'cc@example.net' }],
        bcc: [{ email: 'bcc@example.net' }],
      },
    });
    const email = (
      JSON.parse(body) as {
        methodCalls: Array<[string, Record<string, unknown>, string]>;
      }
    ).methodCalls[0]![1] as {
      create: Record<string, Record<string, unknown>>;
    };
    const e = email.create['c0']!;
    expect(e.cc).toEqual([{ email: 'cc@example.net' }]);
    expect(e.bcc).toEqual([{ email: 'bcc@example.net' }]);

    const bodyNoCcBcc = buildMailDraftRequest({
      accountId: 'c',
      params: SAMPLE_DRAFT_INPUT,
    });
    const eNoCc = (
      JSON.parse(bodyNoCcBcc) as {
        methodCalls: Array<[string, Record<string, unknown>, string]>;
      }
    ).methodCalls[0]![1] as {
      create: Record<string, Record<string, unknown>>;
    };
    expect(eNoCc.create['c0']!.cc).toBeUndefined();
    expect(eNoCc.create['c0']!.bcc).toBeUndefined();
  });

  it('wires inReplyTo + references as RFC-shaped arrays', () => {
    const body = buildMailDraftRequest({
      accountId: 'c',
      params: {
        ...SAMPLE_DRAFT_INPUT,
        inReplyTo: '<msg-id-1@example.net>',
        references: '<msg-id-1@example.net> <msg-id-2@example.net>',
      },
    });
    const email = (
      (
        JSON.parse(body) as {
          methodCalls: Array<[string, Record<string, unknown>, string]>;
        }
      ).methodCalls[0]![1] as {
        create: Record<string, Record<string, unknown>>;
      }
    ).create['c0']!;
    expect(email.inReplyTo).toEqual(['<msg-id-1@example.net>']);
    expect(email.references).toEqual([
      '<msg-id-1@example.net>',
      '<msg-id-2@example.net>',
    ]);
  });
});

describe('parseEmailSetResponse', () => {
  it('extracts the created entry into a MailDraftResult', () => {
    const r = parseEmailSetResponse(EMAIL_SET_OK_BODY);
    expect(r).toEqual({
      emailId: 'E-001',
      blobId: 'B-001',
      threadId: 'T-001',
      size: 256,
    });
  });

  it('throws code=jmap_set_error when notCreated["c0"] is set', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            notCreated: {
              c0: {
                type: 'invalidProperties',
                description: 'mailboxIds: not a writable mailbox',
              },
            },
          },
          '0',
        ],
      ],
    });
    try {
      parseEmailSetResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('jmap_set_error');
      expect(err.message).toContain('invalidProperties');
    }
  });

  it('throws code=jmap_parse_error on a missing first methodResponse', () => {
    const body = JSON.stringify({ methodResponses: [] });
    try {
      parseEmailSetResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error on malformed JSON', () => {
    try {
      parseEmailSetResponse('not json');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchMailDraftCommit (host fetch + parse)', () => {
  it('POSTs Email/set with the right body and returns the MailDraftResult', async () => {
    const fetchSpy = makeFetchSpy(EMAIL_SET_OK_BODY);
    const result = await fetchMailDraftCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      params: SAMPLE_DRAFT_INPUT,
    });
    expect(result.emailId).toBe('E-001');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    const sentBody = init?.body as string;
    expect(sentBody).toContain('Email/set');
    expect(sentBody).toContain('Mb-drafts');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchMailDraftCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EMAIL_SET_OK_BODY),
        session: SAMPLE_SESSION,
        params: SAMPLE_DRAFT_INPUT,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=invalid_argument when both body fields are absent', async () => {
    const { bodyText: _t, ...noBody } = SAMPLE_DRAFT_INPUT;
    await expect(
      fetchMailDraftCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy(EMAIL_SET_OK_BODY),
        session: SAMPLE_SESSION,
        params: noBody,
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('rejects with code=jmap_http_error on a non-2xx response', async () => {
    await expect(
      fetchMailDraftCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('err', { status: 500, statusText: 'Server Error' }),
        session: SAMPLE_SESSION,
        params: SAMPLE_DRAFT_INPUT,
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });
});

// ──────────────────────────────────────────────────────────────────────
// mail.send (Email/set + EmailSubmission/set) — Phase 2 item 3
// ──────────────────────────────────────────────────────────────────────

const SAMPLE_SEND_INPUT: MailSendInput = {
  sentMailboxId: 'Mb-sent',
  identityId: 'I-brent',
  from: { name: 'Brent', email: 'brent@example.net' },
  to: [{ name: 'Alice', email: 'alice@example.net' }],
  subject: 'project plan',
  bodyText: 'Hi Alice — here\'s the schedule.',
};

const EMAIL_SUBMISSION_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'Email/set',
      {
        accountId: 'c',
        created: {
          c0: { id: 'E-001', blobId: 'B-001', threadId: 'T-001', size: 256 },
        },
      },
      '0',
    ],
    [
      'EmailSubmission/set',
      {
        accountId: 'c',
        created: {
          s0: { id: 'S-001', sendAt: '2026-05-11T18:30:00Z' },
        },
      },
      '1',
    ],
  ],
});

describe('buildMailSendRequest', () => {
  it('files the message under the Sent mailbox with $seen (not $draft)', () => {
    const body = buildMailSendRequest({
      accountId: 'c',
      params: SAMPLE_SEND_INPUT,
    });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toContain('urn:ietf:params:jmap:submission');
    const email = (
      parsed.methodCalls[0]![1] as {
        create: Record<string, Record<string, unknown>>;
      }
    ).create['c0']!;
    expect(email.mailboxIds).toEqual({ 'Mb-sent': true });
    expect(email.keywords).toEqual({ $seen: true });
  });

  it('emits a second methodCall: EmailSubmission/set with #c0 back-reference', () => {
    const body = buildMailSendRequest({
      accountId: 'c',
      params: SAMPLE_SEND_INPUT,
    });
    const parsed = JSON.parse(body) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.methodCalls).toHaveLength(2);
    const sub = parsed.methodCalls[1]!;
    expect(sub[0]).toBe('EmailSubmission/set');
    const submission = (
      sub[1] as { create: Record<string, Record<string, unknown>> }
    ).create['s0']!;
    expect(submission.identityId).toBe('I-brent');
    expect(submission.emailId).toBe('#c0');
    expect(submission.sendAt).toBeUndefined();
  });

  it('passes sendAt through to the submission when supplied (delayed send)', () => {
    const body = buildMailSendRequest({
      accountId: 'c',
      params: {
        ...SAMPLE_SEND_INPUT,
        sendAt: '2026-05-12T09:00:00Z',
      },
    });
    const submission = (
      JSON.parse(body) as {
        methodCalls: Array<[string, Record<string, unknown>, string]>;
      }
    ).methodCalls[1]![1] as { create: Record<string, Record<string, unknown>> };
    expect(submission.create['s0']!.sendAt).toBe('2026-05-12T09:00:00Z');
  });
});

describe('parseEmailSubmissionSetResponse', () => {
  it('extracts the email + submission ids into a MailSendResult', () => {
    const r = parseEmailSubmissionSetResponse(EMAIL_SUBMISSION_OK_BODY);
    expect(r).toEqual({
      emailId: 'E-001',
      blobId: 'B-001',
      threadId: 'T-001',
      size: 256,
      submissionId: 'S-001',
      sendAt: '2026-05-11T18:30:00Z',
    });
  });

  it('omits sendAt when the server treats the submission as immediate', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            created: {
              c0: { id: 'E-002', blobId: 'B-002', threadId: 'T-002', size: 100 },
            },
          },
          '0',
        ],
        [
          'EmailSubmission/set',
          {
            created: {
              s0: { id: 'S-002' },
            },
          },
          '1',
        ],
      ],
    });
    const r = parseEmailSubmissionSetResponse(body);
    expect(r.sendAt).toBeUndefined();
  });

  it('throws code=submission_rejected when EmailSubmission notCreated["s0"] is set', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            created: {
              c0: { id: 'E-001', blobId: 'B-001', threadId: 'T-001', size: 256 },
            },
          },
          '0',
        ],
        [
          'EmailSubmission/set',
          {
            notCreated: {
              s0: {
                type: 'forbiddenMailFrom',
                description: 'identity does not permit this from address',
              },
            },
          },
          '1',
        ],
      ],
    });
    try {
      parseEmailSubmissionSetResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      const err = e as ToolError;
      expect(err.code).toBe('submission_rejected');
      expect(err.message).toContain('forbiddenMailFrom');
    }
  });

  it('throws code=jmap_set_error when Email/set itself rejected the create', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            notCreated: {
              c0: { type: 'invalidProperties', description: 'subject required' },
            },
          },
          '0',
        ],
        ['EmailSubmission/set', { created: {} }, '1'],
      ],
    });
    try {
      parseEmailSubmissionSetResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_set_error');
    }
  });

  it('throws code=jmap_parse_error when only one methodResponse is present', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Email/set',
          {
            created: { c0: { id: 'E', blobId: 'B', threadId: 'T', size: 1 } },
          },
          '0',
        ],
      ],
    });
    try {
      parseEmailSubmissionSetResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchMailSendCommit (host fetch + parse)', () => {
  it('POSTs the chained request and returns the MailSendResult', async () => {
    const fetchSpy = makeFetchSpy(EMAIL_SUBMISSION_OK_BODY);
    const result = await fetchMailSendCommit({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      params: SAMPLE_SEND_INPUT,
    });
    expect(result.submissionId).toBe('S-001');
    expect(result.emailId).toBe('E-001');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    const sentBody = init?.body as string;
    expect(sentBody).toContain('EmailSubmission/set');
    expect(sentBody).toContain('Email/set');
  });

  it('rejects with code=invalid_argument when the recipient list is empty', async () => {
    await expect(
      fetchMailSendCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy(EMAIL_SUBMISSION_OK_BODY),
        session: SAMPLE_SESSION,
        params: { ...SAMPLE_SEND_INPUT, to: [] },
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('rejects with code=invalid_argument when both body fields are absent', async () => {
    const { bodyText: _t, ...noBody } = SAMPLE_SEND_INPUT;
    await expect(
      fetchMailSendCommit({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy(EMAIL_SUBMISSION_OK_BODY),
        session: SAMPLE_SESSION,
        params: noBody,
      }),
    ).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchMailSendCommit({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(EMAIL_SUBMISSION_OK_BODY),
        session: SAMPLE_SESSION,
        params: SAMPLE_SEND_INPUT,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// ──────────────────────────────────────────────────────────────────────
// identity.list (Identity/get) — Phase 2 item 6
// ──────────────────────────────────────────────────────────────────────

const IDENTITY_OK_BODY = JSON.stringify({
  methodResponses: [
    [
      'Identity/get',
      {
        accountId: 'c',
        state: 'i-state-1',
        list: [
          {
            id: 'I-1',
            name: 'Brent',
            email: 'brent@example.net',
            mayDelete: false,
          },
          {
            id: 'I-2',
            name: 'Brent (work)',
            email: 'brent@example.org',
            replyTo: [{ email: 'work-reply@example.org' }],
            mayDelete: true,
          },
        ],
      },
      '0',
    ],
  ],
});

describe('buildIdentityListRequest', () => {
  it('asks for every identity (ids: null) under the submission URN', () => {
    const body = buildIdentityListRequest({ accountId: 'c' });
    const parsed = JSON.parse(body) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    expect(parsed.using).toContain('urn:ietf:params:jmap:submission');
    const [name, args] = parsed.methodCalls[0]!;
    expect(name).toBe('Identity/get');
    expect(args.accountId).toBe('c');
    expect(args.ids).toBeNull();
  });
});

describe('parseIdentityListResponse', () => {
  it('parses every identity with optional fields preserved', () => {
    const r = parseIdentityListResponse(IDENTITY_OK_BODY);
    expect(r.identities).toHaveLength(2);
    expect(r.identities[0]).toEqual({
      id: 'I-1',
      name: 'Brent',
      email: 'brent@example.net',
      mayDelete: false,
    });
    expect(r.identities[1]).toEqual({
      id: 'I-2',
      name: 'Brent (work)',
      email: 'brent@example.org',
      mayDelete: true,
      replyTo: [{ email: 'work-reply@example.org' }],
    });
  });

  it('throws code=jmap_parse_error on missing list', () => {
    const body = JSON.stringify({
      methodResponses: [['Identity/get', { accountId: 'c' }, '0']],
    });
    try {
      parseIdentityListResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });

  it('throws code=jmap_parse_error on malformed identity (missing required field)', () => {
    const body = JSON.stringify({
      methodResponses: [
        [
          'Identity/get',
          {
            list: [{ id: 'I-1', name: 'Brent', email: 'x@y.z' }], // no mayDelete
          },
          '0',
        ],
      ],
    });
    try {
      parseIdentityListResponse(body);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ToolError).code).toBe('jmap_parse_error');
    }
  });
});

describe('fetchIdentityList', () => {
  it('POSTs Identity/get and returns the parsed list', async () => {
    const fetchSpy = makeFetchSpy(IDENTITY_OK_BODY);
    const r = await fetchIdentityList({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
    });
    expect(r.identities).toHaveLength(2);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SAMPLE_SESSION.apiUrl);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    await expect(
      fetchIdentityList({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(IDENTITY_OK_BODY),
        session: SAMPLE_SESSION,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Blob upload (attachment.upload) — Phase 2 item 7
// ──────────────────────────────────────────────────────────────────────

const UPLOAD_OK_BODY = JSON.stringify({
  accountId: 'c',
  blobId: 'B-up-1',
  type: 'application/pdf',
  size: 1234,
});

describe('fetchAttachmentUpload', () => {
  it('POSTs the blob bytes to the substituted upload URL with the right content type', async () => {
    const fetchSpy = makeFetchSpy(UPLOAD_OK_BODY);
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: 'application/pdf',
    });
    const r = await fetchAttachmentUpload({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      blob,
    });
    expect(r).toEqual({
      accountId: 'c',
      blobId: 'B-up-1',
      type: 'application/pdf',
      size: 1234,
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://sw-mail.example.net/jmap/upload/c/');
    expect(init?.method).toBe('POST');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok');
    expect(headers['content-type']).toBe('application/pdf');
    expect(init?.body).toBe(blob);
  });

  it('honors a caller-supplied `type` override (file picker leaves Blob.type empty for some MIME types)', async () => {
    const fetchSpy = makeFetchSpy(UPLOAD_OK_BODY);
    const blob = new Blob([new Uint8Array([1])]); // no type
    await fetchAttachmentUpload({
      baseUrl: 'https://x',
      getAuthToken: () => 'tok',
      fetch: fetchSpy,
      session: SAMPLE_SESSION,
      blob,
      type: 'application/x-custom',
    });
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-custom');
  });

  it('rejects with code=unauthorized when no token is available', async () => {
    const blob = new Blob([new Uint8Array([1])]);
    await expect(
      fetchAttachmentUpload({
        baseUrl: 'https://x',
        getAuthToken: () => null,
        fetch: makeFetchSpy(UPLOAD_OK_BODY),
        session: SAMPLE_SESSION,
        blob,
      }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects with code=jmap_http_error on a non-2xx response', async () => {
    const blob = new Blob([new Uint8Array([1])]);
    await expect(
      fetchAttachmentUpload({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy('rejected', { status: 413, statusText: 'Payload Too Large' }),
        session: SAMPLE_SESSION,
        blob,
      }),
    ).rejects.toMatchObject({ code: 'jmap_http_error' });
  });

  it('rejects with code=jmap_parse_error on a malformed response', async () => {
    const blob = new Blob([new Uint8Array([1])]);
    await expect(
      fetchAttachmentUpload({
        baseUrl: 'https://x',
        getAuthToken: () => 'tok',
        fetch: makeFetchSpy(JSON.stringify({ blobId: 'b' /* missing fields */ })),
        session: SAMPLE_SESSION,
        blob,
      }),
    ).rejects.toMatchObject({ code: 'jmap_parse_error' });
  });
});

describe('buildMailSendRequest — attachments', () => {
  it('passes attachments through to Email/set when supplied', () => {
    const body = buildMailSendRequest({
      accountId: 'c',
      params: {
        sentMailboxId: 'Mb-sent',
        identityId: 'I-1',
        from: { email: 'b@b.b' },
        to: [{ email: 'a@a.a' }],
        subject: 's',
        bodyText: 'hi',
        attachments: [
          {
            blobId: 'B-1',
            name: 'contract.pdf',
            type: 'application/pdf',
            size: 1234,
            disposition: 'attachment',
          },
        ],
      },
    });
    const email = (
      (
        JSON.parse(body) as {
          methodCalls: Array<[string, Record<string, unknown>, string]>;
        }
      ).methodCalls[0]![1] as {
        create: Record<string, Record<string, unknown>>;
      }
    ).create['c0']!;
    expect(email.attachments).toEqual([
      {
        blobId: 'B-1',
        type: 'application/pdf',
        name: 'contract.pdf',
        size: 1234,
        disposition: 'attachment',
      },
    ]);
  });

  it('omits the attachments key when none are supplied', () => {
    const body = buildMailSendRequest({
      accountId: 'c',
      params: {
        sentMailboxId: 'Mb-sent',
        identityId: 'I-1',
        from: { email: 'b@b.b' },
        to: [{ email: 'a@a.a' }],
        subject: 's',
        bodyText: 'hi',
      },
    });
    const email = (
      (
        JSON.parse(body) as {
          methodCalls: Array<[string, Record<string, unknown>, string]>;
        }
      ).methodCalls[0]![1] as {
        create: Record<string, Record<string, unknown>>;
      }
    ).create['c0']!;
    expect(email.attachments).toBeUndefined();
  });
});
