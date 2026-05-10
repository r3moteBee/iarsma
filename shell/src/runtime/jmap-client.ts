/**
 * Host wrapper around the `iarsma:jmap-client` WASM component.
 *
 * Per D-038 the component is parse-only — this module performs the HTTP
 * fetch (with the auth bearer) and routes the response body through the
 * component to produce a typed Session record.
 */

import {
  email as jmapClientEmail,
  mailbox as jmapClientMailbox,
  session as jmapClientSession,
} from '@iarsma/wasm-bindings/jmap-client';
import type { ToolError } from './types.js';

export type Session = {
  readonly username: string;
  readonly apiUrl: string;
  readonly downloadUrl: string;
  readonly uploadUrl: string;
  readonly eventSourceUrl: string;
  readonly state: string;
  readonly primaryAccountIdMail: string;
};

/** Mirrors the WIT `mailbox` record (RFC 8621 §2). bigint counts unwrapped
 *  to number — JMAP mailbox counts stay well within Number.MAX_SAFE_INTEGER. */
export type Mailbox = {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  readonly role?: string;
  readonly sortOrder: number;
  readonly totalEmails: number;
  readonly unreadEmails: number;
  readonly totalThreads: number;
  readonly unreadThreads: number;
  readonly isSubscribed: boolean;
  readonly myRights: MailboxRights;
};

export type MailboxRights = {
  readonly mayReadItems: boolean;
  readonly mayAddItems: boolean;
  readonly mayRemoveItems: boolean;
  readonly maySetSeen: boolean;
  readonly maySetKeywords: boolean;
  readonly mayCreateChild: boolean;
  readonly mayRename: boolean;
  readonly mayDelete: boolean;
  readonly maySubmit: boolean;
};

export type JmapClientOptions = {
  /** Base URL of the JMAP server, e.g. 'https://sw-mail.example.net'. */
  readonly baseUrl: string;
  /** Returns the current Bearer token. Called on each request. */
  readonly getAuthToken: () => string | null;
  /** Override for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
};

/**
 * Fetch and parse the JMAP session resource.
 *
 * Network errors surface as `ToolError` with stable codes; component-side
 * parse errors come through with the WIT `parse-error-code` as the payload
 * so callers can branch on `malformed-json` vs `missing-field` etc.
 */
export async function fetchSession(opts: JmapClientOptions): Promise<Session> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const url = `${opts.baseUrl.replace(/\/$/, '')}/.well-known/jmap`;
  const fetchImpl = opts.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    throw makeError('network_error', `JMAP fetch failed: ${describe(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `JMAP /.well-known/jmap returned ${response.status} ${response.statusText}`,
    );
  }
  const body = await response.text();
  return parseSession(body);
}

/**
 * Parse a JMAP session response body. Exposed for tests; production
 * callers use `fetchSession`.
 */
export function parseSession(body: string): Session {
  try {
    return jmapClientSession.parseSession(body);
  } catch (e) {
    throw makeError('jmap_parse_error', `Failed to parse session: ${describe(e)}`, e);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Mailbox/get
// ──────────────────────────────────────────────────────────────────────

export type FetchMailboxListOptions = JmapClientOptions & {
  /** Already-resolved session (so we don't refetch /.well-known/jmap on
   *  every mailbox.list invocation). The invoker caches one session
   *  per signed-in tab. */
  readonly session: Session;
};

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

/**
 * POST a `Mailbox/get` request to the JMAP API URL and parse the response
 * into the typed `Mailbox[]` array. The flat list is what the parser
 * (and the capability contract) returns; the host folds it into a tree
 * on `parentId` at render time.
 */
export async function fetchMailboxList(
  opts: FetchMailboxListOptions,
): Promise<Mailbox[]> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      ['Mailbox/get', { accountId: opts.session.primaryAccountIdMail }, '0'],
    ],
  });
  let response: Response;
  try {
    response = await fetchImpl(opts.session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch (e) {
    throw makeError('network_error', `JMAP fetch failed: ${describe(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `JMAP Mailbox/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseMailboxes(text);
}

/**
 * Parse a JMAP request response containing a single `Mailbox/get` method
 * response. Exposed for tests; production callers go through
 * `fetchMailboxList`.
 *
 * The bigint count fields the WASM component returns (because WIT u64 →
 * jco bigint) are converted to number here. JMAP mailbox counts stay
 * comfortably within `Number.MAX_SAFE_INTEGER`.
 */
export function parseMailboxes(body: string): Mailbox[] {
  let raw;
  try {
    raw = jmapClientMailbox.parseMailboxGetResponse(body);
  } catch (e) {
    throw makeError('jmap_parse_error', `Failed to parse Mailbox/get: ${describe(e)}`, e);
  }
  return raw.map((m) => ({
    id: m.id,
    name: m.name,
    ...(m.parentId !== undefined ? { parentId: m.parentId } : {}),
    ...(m.role !== undefined ? { role: m.role } : {}),
    sortOrder: m.sortOrder,
    totalEmails: Number(m.totalEmails),
    unreadEmails: Number(m.unreadEmails),
    totalThreads: Number(m.totalThreads),
    unreadThreads: Number(m.unreadThreads),
    isSubscribed: m.isSubscribed,
    myRights: { ...m.myRights },
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Email/query + Email/get (chained — thread.list)
// ──────────────────────────────────────────────────────────────────────

export type EmailAddress = {
  readonly name?: string;
  readonly email: string;
};

export type Keyword = {
  readonly name: string;
  readonly value: boolean;
};

export type EmailSummary = {
  readonly id: string;
  readonly threadId: string;
  readonly from?: ReadonlyArray<EmailAddress>;
  readonly to?: ReadonlyArray<EmailAddress>;
  readonly subject?: string;
  readonly preview?: string;
  readonly receivedAt: string;
  readonly keywords: ReadonlyArray<Keyword>;
  readonly size: number;
};

export type ThreadSummary = {
  readonly id: string;
  readonly latestEmail: EmailSummary;
};

export type ThreadList = {
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly position: number;
  readonly total?: number;
};

export type FetchThreadListOptions = JmapClientOptions & {
  readonly session: Session;
  readonly mailboxId: string;
  /** Zero-indexed offset. Defaults to 0. */
  readonly position?: number;
  /** Page size. Defaults to 50; capped server-side at 200. */
  readonly limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** RFC 8621 §4.1: minimal property set for inbox-row rendering. */
const EMAIL_LIST_PROPERTIES = [
  'id',
  'threadId',
  'from',
  'to',
  'subject',
  'preview',
  'receivedAt',
  'keywords',
  'size',
];

/**
 * POST a chained `Email/query` + `Email/get` JMAP request and parse the
 * response into a thread list. The two methodCalls share a single
 * roundtrip (RFC 8620 §3.7) — `Email/get` references `Email/query.ids`
 * via a `#ids` back-reference.
 */
export async function fetchThreadList(
  opts: FetchThreadListOptions,
): Promise<ThreadList> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const position = opts.position ?? 0;
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const accountId = opts.session.primaryAccountIdMail;

  const body = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/query',
        {
          accountId,
          filter: { inMailbox: opts.mailboxId },
          sort: [{ property: 'receivedAt', isAscending: false }],
          collapseThreads: true,
          position,
          limit,
          calculateTotal: true,
        },
        '0',
      ],
      [
        'Email/get',
        {
          accountId,
          // JMAP back-reference: pulls ids from the prior Email/query
          // result, no client-side roundtrip.
          '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' },
          properties: EMAIL_LIST_PROPERTIES,
        },
        '1',
      ],
    ],
  });

  let response: Response;
  try {
    response = await fetchImpl(opts.session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch (e) {
    throw makeError('network_error', `JMAP fetch failed: ${describe(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `JMAP Email/query+Email/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseThreadList(text);
}

/**
 * Parse a JMAP response body containing both `Email/query` and
 * `Email/get` method responses. Exposed for tests; production callers
 * use `fetchThreadList`.
 */
export function parseThreadList(body: string): ThreadList {
  let raw;
  try {
    raw = jmapClientEmail.parseEmailQueryResponse(body);
  } catch (e) {
    throw makeError('jmap_parse_error', `Failed to parse Email/query response: ${describe(e)}`, e);
  }
  return {
    threads: raw.emails.map((e) => ({
      id: e.threadId,
      latestEmail: {
        id: e.id,
        threadId: e.threadId,
        ...(e.from !== undefined ? { from: e.from.map(normalizeAddress) } : {}),
        ...(e.to !== undefined ? { to: e.to.map(normalizeAddress) } : {}),
        ...(e.subject !== undefined ? { subject: e.subject } : {}),
        ...(e.preview !== undefined ? { preview: e.preview } : {}),
        receivedAt: e.receivedAt,
        keywords: e.keywords.map((k) => ({ name: k.name, value: k.value })),
        size: Number(e.size),
      },
    })),
    position: raw.position,
    ...(raw.total !== undefined ? { total: Number(raw.total) } : {}),
  };
}

function normalizeAddress(a: { name?: string; email: string }): EmailAddress {
  return a.name !== undefined ? { name: a.name, email: a.email } : { email: a.email };
}

function makeError(code: string, message: string, payload?: unknown): ToolError {
  return payload === undefined ? { code, message } : { code, message, payload };
}

function describe(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
