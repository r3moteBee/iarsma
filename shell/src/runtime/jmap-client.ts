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
// Two-stage delete helpers (PR 19) — Trash lookup + memberships read
// ──────────────────────────────────────────────────────────────────────

/**
 * Resolve the id of the mailbox with role: 'trash' for the signed-in
 * account. Throws when no Trash mailbox exists — soft delete requires
 * a destination, so the caller (mail.delete) can't proceed without it.
 *
 * Stalwart provisions a Trash on every account; this should only
 * trip for accounts on servers that don't.
 */
export async function resolveTrashMailboxId(
  opts: FetchMailboxListOptions,
): Promise<string> {
  const list = await fetchMailboxList(opts);
  const trash = list.find((m) => m.role === 'trash');
  if (trash === undefined) {
    throw makeError(
      'no_trash_mailbox',
      'mail.delete (soft delete) requires a mailbox with role: trash; ' +
        'the account has none.',
    );
  }
  return trash.id;
}

/**
 * Fetch only the `mailboxIds` field for each given email. Returns
 * a Map<emailId, mailboxIds[]> with each email's current membership
 * list — what mail.delete needs to build the inverse patch (and what
 * PR 22 stashes in the action-log provenance for undo).
 *
 * Cheap: a single Email/get with `properties: ['mailboxIds']`.
 */
export async function fetchEmailMailboxMemberships(
  opts: JmapClientOptions & {
    readonly session: Session;
    readonly emailIds: readonly string[];
  },
): Promise<ReadonlyMap<string, readonly string[]>> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/get',
        {
          accountId: opts.session.primaryAccountIdMail,
          ids: opts.emailIds,
          properties: ['mailboxIds'],
        },
        '0',
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
      `JMAP Email/get (memberships) returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Email/get memberships response: ${describe(e)}`,
      e,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Email/get memberships: not an object.');
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'Email/get memberships: no methodResponses array.',
    );
  }
  const first = responses[0] as unknown;
  if (!Array.isArray(first) || first.length < 2) {
    throw makeError(
      'jmap_parse_error',
      'Email/get memberships: malformed methodResponse entry.',
    );
  }
  const result = first[1] as { list?: unknown };
  const items = Array.isArray(result.list) ? result.list : [];
  const out = new Map<string, readonly string[]>();
  for (const row of items) {
    if (row === null || typeof row !== 'object') continue;
    const r = row as { id?: unknown; mailboxIds?: unknown };
    if (typeof r.id !== 'string') continue;
    const ids: string[] = [];
    if (r.mailboxIds !== null && typeof r.mailboxIds === 'object') {
      for (const [k, v] of Object.entries(r.mailboxIds as Record<string, unknown>)) {
        if (v === true) ids.push(k);
      }
    }
    out.set(r.id, ids);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Email/query — lean id-only fetch (PR 30, Empty trash)
// ──────────────────────────────────────────────────────────────────────

/**
 * Return all email ids in `mailboxId`, paginating internally up to
 * `maxIds`. Used by the Trash view to drive bulk mail.purge without
 * caring about thread structure or message bodies.
 *
 * If the mailbox has more than `maxIds` emails (default 500), the
 * caller gets the first slice; another call after the purge gets
 * the next slice. UX: Empty trash with 600 emails takes two clicks
 * — acceptable trade vs. unbounded query/purge round trips.
 */
export async function fetchEmailIdsInMailbox(
  opts: JmapClientOptions & {
    readonly session: Session;
    readonly mailboxId: string;
    readonly maxIds?: number;
  },
): Promise<readonly string[]> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const limit = opts.maxIds ?? 500;
  const body = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/query',
        {
          accountId: opts.session.primaryAccountIdMail,
          filter: { inMailbox: opts.mailboxId },
          limit,
        },
        '0',
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
      `JMAP Email/query (ids) returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Email/query (ids) response: ${describe(e)}`,
      e,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Email/query (ids): not an object.');
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'Email/query (ids): no methodResponses array.',
    );
  }
  const first = responses[0] as unknown;
  if (!Array.isArray(first) || first.length < 2) {
    throw makeError(
      'jmap_parse_error',
      'Email/query (ids): malformed methodResponse entry.',
    );
  }
  const result = first[1] as { ids?: unknown };
  if (!Array.isArray(result.ids)) return [];
  return result.ids.filter((id): id is string => typeof id === 'string');
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

// ──────────────────────────────────────────────────────────────────────
// Email/query + Email/get (thread.search — Phase 2 item 9)
// ──────────────────────────────────────────────────────────────────────
//
// Mirror of `fetchThreadList` but with a `text` filter instead of
// `inMailbox`. The response shape is identical (Email/query +
// chained Email/get), so we reuse `parseThreadList` to extract it.

export type FetchThreadSearchOptions = JmapClientOptions & {
  readonly session: Session;
  readonly query: string;
  readonly inMailboxId?: string;
  readonly position?: number;
  readonly limit?: number;
};

/**
 * Build the JMAP Email/query + Email/get chain for a text search.
 * `inMailboxId` is folded into the filter via an `AND` combinator
 * when supplied; omitted otherwise (search-everything semantics).
 */
export function buildEmailSearchRequest(opts: {
  readonly accountId: string;
  readonly query: string;
  readonly inMailboxId?: string;
  readonly position?: number;
  readonly limit?: number;
}): string {
  const position = opts.position ?? 0;
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const filter: Record<string, unknown> =
    opts.inMailboxId !== undefined
      ? {
          operator: 'AND',
          conditions: [
            { text: opts.query },
            { inMailbox: opts.inMailboxId },
          ],
        }
      : { text: opts.query };
  return JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/query',
        {
          accountId: opts.accountId,
          filter,
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
          accountId: opts.accountId,
          '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' },
          properties: EMAIL_LIST_PROPERTIES,
        },
        '1',
      ],
    ],
  });
}

export async function fetchThreadSearch(
  opts: FetchThreadSearchOptions,
): Promise<ThreadList> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  if (opts.query.trim() === '') {
    throw makeError('invalid_argument', 'thread.search requires a non-empty query.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = buildEmailSearchRequest({
    accountId: opts.session.primaryAccountIdMail,
    query: opts.query,
    ...(opts.inMailboxId !== undefined
      ? { inMailboxId: opts.inMailboxId }
      : {}),
    ...(opts.position !== undefined ? { position: opts.position } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
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
      `JMAP Email/query (text) returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseThreadList(text);
}

function normalizeAddress(a: { name?: string; email: string }): EmailAddress {
  return a.name !== undefined ? { name: a.name, email: a.email } : { email: a.email };
}

// ──────────────────────────────────────────────────────────────────────
// Thread/get + Email/get (chained — thread.get)
// ──────────────────────────────────────────────────────────────────────

export type Attachment = {
  readonly id: string;
  readonly name?: string;
  readonly type: string;
  readonly size: number;
  readonly cid?: string;
  readonly disposition?: string;
};

export type EmailFull = {
  readonly id: string;
  readonly threadId: string;
  readonly from?: ReadonlyArray<EmailAddress>;
  readonly to?: ReadonlyArray<EmailAddress>;
  readonly cc?: ReadonlyArray<EmailAddress>;
  readonly bcc?: ReadonlyArray<EmailAddress>;
  readonly subject?: string;
  readonly preview?: string;
  readonly receivedAt: string;
  readonly sentAt?: string;
  readonly keywords: ReadonlyArray<Keyword>;
  readonly size: number;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  readonly attachments: ReadonlyArray<Attachment>;
  /** RFC 5322 `Message-ID` value(s). Empty when absent. */
  readonly messageId: ReadonlyArray<string>;
  /** RFC 5322 `In-Reply-To` Message-ID(s). Empty when absent. */
  readonly inReplyTo: ReadonlyArray<string>;
  /** RFC 5322 `References` Message-IDs (full thread chain, oldest first). Empty when absent. */
  readonly references: ReadonlyArray<string>;
};

export type Thread = {
  readonly id: string;
  readonly emailIds: ReadonlyArray<string>;
};

export type ThreadGet = {
  readonly thread: Thread;
  readonly emails: ReadonlyArray<EmailFull>;
};

export type FetchThreadGetOptions = JmapClientOptions & {
  readonly session: Session;
  readonly threadId: string;
};

/** RFC 8621 §4.7: properties Email/get returns when we ask for full bodies. */
const EMAIL_FULL_PROPERTIES = [
  'id',
  'threadId',
  'from',
  'to',
  'cc',
  'bcc',
  'subject',
  'preview',
  'receivedAt',
  'sentAt',
  'keywords',
  'size',
  'bodyValues',
  'textBody',
  'htmlBody',
  'attachments',
  // RFC 5322 thread-linking headers — required for reply (Phase 2
  // item 5) so `In-Reply-To` + `References` can be stamped on the
  // composed reply.
  'messageId',
  'inReplyTo',
  'references',
];

/**
 * POST a chained `Thread/get` + `Email/get` JMAP request. Returns the
 * full thread with every email materialized (body parts flattened to
 * `bodyText` / `bodyHtml`, attachments listed with metadata).
 *
 * Hosts MUST sanitize `bodyHtml` via `iarsma:html-sanitizer` before
 * rendering.
 */
export async function fetchThreadGet(
  opts: FetchThreadGetOptions,
): Promise<ThreadGet> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      ['Thread/get', { accountId, ids: [opts.threadId] }, '0'],
      [
        'Email/get',
        {
          accountId,
          // Back-reference: pulls emailIds from the prior Thread/get's
          // first list entry, no client-side roundtrip.
          '#ids': {
            resultOf: '0',
            name: 'Thread/get',
            path: '/list/0/emailIds',
          },
          properties: EMAIL_FULL_PROPERTIES,
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
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
      `JMAP Thread/get+Email/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseThreadGet(text);
}

/**
 * Parse a JMAP response containing `Thread/get` + chained `Email/get`.
 * Exposed for tests; production callers go through `fetchThreadGet`.
 */
export function parseThreadGet(body: string): ThreadGet {
  let raw;
  try {
    raw = jmapClientEmail.parseThreadGetResponse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Thread/get response: ${describe(e)}`,
      e,
    );
  }
  return {
    thread: {
      id: raw.threadId,
      emailIds: raw.emailIds.slice(),
    },
    emails: raw.emails.map((e) => ({
      id: e.id,
      threadId: e.threadId,
      ...(e.from !== undefined ? { from: e.from.map(normalizeAddress) } : {}),
      ...(e.to !== undefined ? { to: e.to.map(normalizeAddress) } : {}),
      ...(e.cc !== undefined ? { cc: e.cc.map(normalizeAddress) } : {}),
      ...(e.bcc !== undefined ? { bcc: e.bcc.map(normalizeAddress) } : {}),
      ...(e.subject !== undefined ? { subject: e.subject } : {}),
      ...(e.preview !== undefined ? { preview: e.preview } : {}),
      receivedAt: e.receivedAt,
      ...(e.sentAt !== undefined ? { sentAt: e.sentAt } : {}),
      keywords: e.keywords.map((k) => ({ name: k.name, value: k.value })),
      size: Number(e.size),
      ...(e.bodyText !== undefined ? { bodyText: e.bodyText } : {}),
      ...(e.bodyHtml !== undefined ? { bodyHtml: e.bodyHtml } : {}),
      attachments: e.attachments.map((a) => ({
        id: a.id,
        ...(a.name !== undefined ? { name: a.name } : {}),
        type: a.type,
        size: Number(a.size),
        ...(a.cid !== undefined ? { cid: a.cid } : {}),
        ...(a.disposition !== undefined ? { disposition: a.disposition } : {}),
      })),
      messageId: e.messageId.slice(),
      inReplyTo: e.inReplyTo.slice(),
      references: e.references.slice(),
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Email/set (mail.draft commit)
// ──────────────────────────────────────────────────────────────────────
//
// D-038 generally puts response parsing in the Rust component to keep the
// host away from untrusted-input parsing. We carve out an exception here:
// `Email/set`'s success response is four scalars (`id`, `blobId`,
// `threadId`, `size`) with no nesting or sender-controlled content, and
// the contract codegen already validates it via Zod. Adding a WASM
// boundary for it would buy ~nothing in safety. If `Email/set` later
// grows a sender-influenced response shape (e.g., echoed body parts),
// move the parser into `components/jmap-client/`.

export type AttachmentRef = {
  readonly blobId: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly disposition?: string;
  readonly cid?: string;
};

export type MailDraftInput = {
  readonly mailboxId: string;
  readonly from: EmailAddress;
  readonly to: ReadonlyArray<EmailAddress>;
  readonly cc?: ReadonlyArray<EmailAddress>;
  readonly bcc?: ReadonlyArray<EmailAddress>;
  readonly subject: string;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  readonly inReplyTo?: string;
  readonly references?: string;
  readonly attachments?: ReadonlyArray<AttachmentRef>;
};

export type MailDraftResult = {
  readonly emailId: string;
  readonly blobId: string;
  readonly threadId: string;
  readonly size: number;
};

export type FetchMailDraftOptions = JmapClientOptions & {
  readonly session: Session;
  readonly params: MailDraftInput;
};

/**
 * Build the JMAP `Email/set` create payload for a draft. Pure function —
 * no I/O, no Squire / DOM dependency. The output is the request body
 * the host POSTs at commit time AND the basis for the dry-run preview.
 */
export function buildMailDraftRequest(opts: {
  readonly accountId: string;
  readonly params: MailDraftInput;
}): string {
  const { accountId, params } = opts;
  const bodyParts: Array<{
    partId: string;
    type: string;
  }> = [];
  const bodyValues: Record<string, { value: string }> = {};
  let nextPartId = 1;
  // Build text/plain part first if present (downstream clients render
  // text/plain as the fallback when html is the alternative).
  if (params.bodyText !== undefined) {
    const partId = String(nextPartId++);
    bodyParts.push({ partId, type: 'text/plain' });
    bodyValues[partId] = { value: params.bodyText };
  }
  if (params.bodyHtml !== undefined) {
    const partId = String(nextPartId++);
    bodyParts.push({ partId, type: 'text/html' });
    bodyValues[partId] = { value: params.bodyHtml };
  }
  // multipart/alternative when both bodies are present; single-part
  // when only one. Either way JMAP expects a `bodyStructure` tree, not
  // separate `textBody` / `htmlBody` properties — those are GET-only.
  const bodyStructure =
    bodyParts.length === 1
      ? bodyParts[0]
      : {
          type: 'multipart/alternative',
          subParts: bodyParts,
        };

  const email: Record<string, unknown> = {
    mailboxIds: { [params.mailboxId]: true },
    keywords: { $draft: true },
    from: params.from.name !== undefined ? [params.from] : [{ email: params.from.email }],
    to: params.to.map((a) =>
      a.name !== undefined ? a : { email: a.email },
    ),
    subject: params.subject,
    bodyStructure,
    bodyValues,
  };
  if (params.cc !== undefined && params.cc.length > 0) {
    email.cc = params.cc.map((a) => (a.name !== undefined ? a : { email: a.email }));
  }
  if (params.bcc !== undefined && params.bcc.length > 0) {
    email.bcc = params.bcc.map((a) => (a.name !== undefined ? a : { email: a.email }));
  }
  if (params.inReplyTo !== undefined) {
    email.inReplyTo = [params.inReplyTo];
  }
  if (params.references !== undefined) {
    email.references = params.references.split(/\s+/).filter((s) => s.length > 0);
  }
  if (params.attachments !== undefined && params.attachments.length > 0) {
    email.attachments = params.attachments.map(toJmapAttachment);
  }

  return JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/set',
        {
          accountId,
          create: { c0: email },
        },
        '0',
      ],
    ],
  });
}

/**
 * POST a JMAP `Email/set` create and parse the response into a
 * `MailDraftResult`. Use in the `mail.draft` commit branch of the
 * invoker; the dry-run branch should NOT call this — it constructs
 * the preview locally.
 */
export async function fetchMailDraftCommit(
  opts: FetchMailDraftOptions,
): Promise<MailDraftResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  if (opts.params.bodyText === undefined && opts.params.bodyHtml === undefined) {
    throw makeError(
      'invalid_argument',
      'mail.draft requires at least one of bodyText or bodyHtml.',
    );
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildMailDraftRequest({ accountId, params: opts.params });

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
      `JMAP Email/set returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseEmailSetResponse(text);
}

/**
 * Parse a JMAP `Email/set` response and extract the single creation
 * result (we always use creation id `c0` in the request). Surfaces a
 * structured `not_created` error when the JMAP server rejected the
 * create.
 */
export function parseEmailSetResponse(body: string): MailDraftResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Email/set response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Email/set response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'Email/set response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'Email/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not Email/set.',
    );
  }
  const result = first[1] as {
    created?: Record<string, unknown>;
    notCreated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notCreated !== undefined) {
    const c0 = result.notCreated['c0'];
    if (c0 !== undefined) {
      throw makeError(
        'jmap_set_error',
        `Email/set rejected: ${c0.type ?? 'unknown'}${c0.description !== undefined ? ` — ${c0.description}` : ''}`,
        c0,
      );
    }
  }
  const created = result.created?.['c0'] as
    | { id?: string; blobId?: string; threadId?: string; size?: number | bigint }
    | undefined;
  if (created === undefined) {
    throw makeError(
      'jmap_parse_error',
      'Email/set response has no created["c0"] entry.',
    );
  }
  if (
    typeof created.id !== 'string' ||
    typeof created.blobId !== 'string' ||
    typeof created.threadId !== 'string'
  ) {
    throw makeError(
      'jmap_parse_error',
      'Email/set created["c0"] is missing required fields.',
    );
  }
  return {
    emailId: created.id,
    blobId: created.blobId,
    threadId: created.threadId,
    size: Number(created.size ?? 0),
  };
}

// ──────────────────────────────────────────────────────────────────────
// JMAP Blob upload (attachments) — Phase 2 item 7
// ──────────────────────────────────────────────────────────────────────
//
// Per RFC 8620 §6.1, blob upload is a side-channel: POST raw bytes
// to the account's upload URL, get back `{accountId, blobId, type,
// size}`. The blob lives on the server until referenced by an
// `Email/set` create (or expired by the server's GC). The upload is
// NOT a regular JMAP method-call — it doesn't ride the invoker JSON
// channel because JSON can't carry binary bytes.

export type AttachmentUpload = {
  readonly accountId: string;
  readonly blobId: string;
  readonly type: string;
  readonly size: number;
};

export type FetchAttachmentUploadOptions = JmapClientOptions & {
  readonly session: Session;
  /** The bytes to upload. Browser File / Blob both work — the host
   *  reads through their stream API. Tests pass a Uint8Array wrapped
   *  in a Blob. */
  readonly blob: Blob;
  /** MIME type. Overrides `blob.type` when supplied — the file picker
   *  doesn't always set Blob.type reliably for non-image files. */
  readonly type?: string;
};

/**
 * Substitute the `{accountId}` token in the session's upload URL.
 * RFC 8620 §6.1 lets the URL also carry `{type}` and `{name}` tokens;
 * Stalwart's implementation only varies on `{accountId}` so we ignore
 * the others (they're allowed but optional per spec).
 */
function buildUploadUrl(session: Session): string {
  return session.uploadUrl.replace('{accountId}', session.primaryAccountIdMail);
}

export async function fetchAttachmentUpload(
  opts: FetchAttachmentUploadOptions,
): Promise<AttachmentUpload> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const url = buildUploadUrl(opts.session);
  const contentType = opts.type ?? opts.blob.type ?? 'application/octet-stream';

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        // No `Content-Length` header — fetch fills it from the blob's
        // size. Setting it manually trips Stalwart's strict-parse path.
        'content-type': contentType,
        authorization: `Bearer ${token}`,
      },
      body: opts.blob,
    });
  } catch (e) {
    throw makeError('network_error', `Blob upload failed: ${describe(e)}`);
  }
  if (!response.ok) {
    throw makeError(
      response.status === 401 ? 'unauthorized' : 'jmap_http_error',
      `Blob upload returned ${response.status} ${response.statusText}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse blob-upload response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Blob-upload response is not an object.');
  }
  const r = parsed as Record<string, unknown>;
  if (
    typeof r.accountId !== 'string' ||
    typeof r.blobId !== 'string' ||
    typeof r.type !== 'string'
  ) {
    throw makeError(
      'jmap_parse_error',
      'Blob-upload response is missing required fields.',
    );
  }
  return {
    accountId: r.accountId,
    blobId: r.blobId,
    type: r.type,
    size: typeof r.size === 'number' ? r.size : Number(r.size ?? 0),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Identity/get (identity.list)
// ──────────────────────────────────────────────────────────────────────
//
// D-038 carve-out for the same reason mail.draft/mail.send have one:
// `Identity/get` returns a flat list of operator-controlled records
// (id, name, email, mayDelete + a few optional fields). No
// sender-controlled content, no nested parsing, no security-sensitive
// transformations. The contract codegen already validates the shape
// via Zod.

export type Identity = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly replyTo?: ReadonlyArray<EmailAddress>;
  readonly bcc?: ReadonlyArray<EmailAddress>;
  readonly textSignature?: string;
  readonly htmlSignature?: string;
  readonly mayDelete: boolean;
};

export type IdentityList = {
  readonly identities: ReadonlyArray<Identity>;
};

export type FetchIdentityListOptions = JmapClientOptions & {
  readonly session: Session;
};

const JMAP_USING_SUBMISSION = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:submission',
];

/**
 * Build the JMAP `Identity/get` request. `ids: null` fetches every
 * identity the authenticated account is permitted to see.
 */
export function buildIdentityListRequest(opts: {
  readonly accountId: string;
}): string {
  return JSON.stringify({
    using: JMAP_USING_SUBMISSION,
    methodCalls: [
      [
        'Identity/get',
        {
          accountId: opts.accountId,
          ids: null,
        },
        '0',
      ],
    ],
  });
}

export async function fetchIdentityList(
  opts: FetchIdentityListOptions,
): Promise<IdentityList> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = buildIdentityListRequest({
    accountId: opts.session.primaryAccountIdMail,
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
      `JMAP Identity/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseIdentityListResponse(text);
}

export function parseIdentityListResponse(body: string): IdentityList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Identity/get response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Identity/get response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'Identity/get response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'Identity/get') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not Identity/get.',
    );
  }
  const list = (first[1] as { list?: unknown }).list;
  if (!Array.isArray(list)) {
    throw makeError('jmap_parse_error', 'Identity/get response is missing list.');
  }
  const identities = list.map((raw, i) => parseIdentity(raw, i));
  return { identities };
}

function parseIdentity(raw: unknown, index: number): Identity {
  if (raw === null || typeof raw !== 'object') {
    throw makeError(
      'jmap_parse_error',
      `Identity at index ${index} is not an object.`,
    );
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.name !== 'string' ||
    typeof r.email !== 'string' ||
    typeof r.mayDelete !== 'boolean'
  ) {
    throw makeError(
      'jmap_parse_error',
      `Identity at index ${index} is missing required fields.`,
    );
  }
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    mayDelete: r.mayDelete,
    ...(Array.isArray(r.replyTo)
      ? { replyTo: r.replyTo.map(parseAddress) }
      : {}),
    ...(Array.isArray(r.bcc) ? { bcc: r.bcc.map(parseAddress) } : {}),
    ...(typeof r.textSignature === 'string'
      ? { textSignature: r.textSignature }
      : {}),
    ...(typeof r.htmlSignature === 'string'
      ? { htmlSignature: r.htmlSignature }
      : {}),
  };
}

function parseAddress(raw: unknown): EmailAddress {
  if (raw === null || typeof raw !== 'object') {
    throw makeError('jmap_parse_error', 'Email address is not an object.');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.email !== 'string') {
    throw makeError('jmap_parse_error', 'Email address is missing `email`.');
  }
  return typeof r.name === 'string'
    ? { name: r.name, email: r.email }
    : { email: r.email };
}

// ──────────────────────────────────────────────────────────────────────
// Identity/set update (PR 33 — email signatures)
// ──────────────────────────────────────────────────────────────────────

/** Patchable fields on an Identity. Just signatures for v1 — server
 *  permissions on name/email/replyTo are gnarlier and Stalwart's
 *  validation needs more shape before we expose them. */
export type IdentityPatch = {
  /** Plain-text signature, or `null` to clear. */
  readonly textSignature?: string | null;
  /** HTML signature, or `null` to clear. iarsma's UI is text-only
   *  for v1; this stays for API completeness. */
  readonly htmlSignature?: string | null;
};

export type CommitIdentityUpdateOptions = JmapClientOptions & {
  readonly session: Session;
  readonly identityId: string;
  readonly patch: IdentityPatch;
};

export async function commitIdentityUpdate(
  opts: CommitIdentityUpdateOptions,
): Promise<void> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  // JMAP Identity/set update only includes the fields the user
  // changed — undefined entries in patch are omitted; explicit null
  // clears the field server-side.
  const update: Record<string, unknown> = {};
  if (opts.patch.textSignature !== undefined) {
    update.textSignature = opts.patch.textSignature;
  }
  if (opts.patch.htmlSignature !== undefined) {
    update.htmlSignature = opts.patch.htmlSignature;
  }
  const body = JSON.stringify({
    using: JMAP_USING_SUBMISSION,
    methodCalls: [
      [
        'Identity/set',
        {
          accountId: opts.session.primaryAccountIdMail,
          update: { [opts.identityId]: update },
        },
        '0',
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
      `JMAP Identity/set returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Identity/set: ${describe(e)}`,
    );
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'Identity/set: no methodResponses array.',
    );
  }
  const first = responses[0] as unknown;
  if (!Array.isArray(first) || first.length < 2) return;
  const result = first[1] as { notUpdated?: Record<string, unknown> };
  if (
    result.notUpdated !== undefined &&
    result.notUpdated !== null &&
    typeof result.notUpdated === 'object' &&
    Object.keys(result.notUpdated).length > 0
  ) {
    const reason = JSON.stringify(result.notUpdated);
    throw makeError(
      'identity_set_failed',
      `Identity/set rejected: ${reason}`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// Email/set + EmailSubmission/set (mail.send commit)
// ──────────────────────────────────────────────────────────────────────

const JMAP_USING_MAIL_SUBMISSION = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
  'urn:ietf:params:jmap:submission',
];

export type MailSendInput = {
  readonly sentMailboxId: string;
  readonly identityId: string;
  readonly from: EmailAddress;
  readonly to: ReadonlyArray<EmailAddress>;
  readonly cc?: ReadonlyArray<EmailAddress>;
  readonly bcc?: ReadonlyArray<EmailAddress>;
  readonly subject: string;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  readonly inReplyTo?: string;
  readonly references?: string;
  readonly sendAt?: string;
  readonly attachments?: ReadonlyArray<AttachmentRef>;
};

export type MailSendResult = {
  readonly emailId: string;
  readonly blobId: string;
  readonly threadId: string;
  readonly size: number;
  readonly submissionId: string;
  readonly sendAt?: string;
};

export type FetchMailSendOptions = JmapClientOptions & {
  readonly session: Session;
  readonly params: MailSendInput;
};

/**
 * Build the chained JMAP `Email/set` + `EmailSubmission/set` request
 * for a send. Pure function — production AND dry-run share this so the
 * preview's `estimatedSize` matches what the server would receive.
 *
 * Differences vs `buildMailDraftRequest`:
 *   - Files under the SENT mailbox (no `$draft`, sets `$seen`).
 *   - Adds an `EmailSubmission/set` create that back-references the
 *     Email/set creation (`emailId: "#c0"`).
 *   - Adds the submission URN to the `using` array.
 */
export function buildMailSendRequest(opts: {
  readonly accountId: string;
  readonly params: MailSendInput;
}): string {
  const { accountId, params } = opts;
  const bodyParts: Array<{ partId: string; type: string }> = [];
  const bodyValues: Record<string, { value: string }> = {};
  let nextPartId = 1;
  if (params.bodyText !== undefined) {
    const partId = String(nextPartId++);
    bodyParts.push({ partId, type: 'text/plain' });
    bodyValues[partId] = { value: params.bodyText };
  }
  if (params.bodyHtml !== undefined) {
    const partId = String(nextPartId++);
    bodyParts.push({ partId, type: 'text/html' });
    bodyValues[partId] = { value: params.bodyHtml };
  }
  const bodyStructure =
    bodyParts.length === 1
      ? bodyParts[0]
      : { type: 'multipart/alternative', subParts: bodyParts };

  const email: Record<string, unknown> = {
    mailboxIds: { [params.sentMailboxId]: true },
    keywords: { $seen: true },
    from: params.from.name !== undefined ? [params.from] : [{ email: params.from.email }],
    to: params.to.map((a) => (a.name !== undefined ? a : { email: a.email })),
    subject: params.subject,
    bodyStructure,
    bodyValues,
  };
  if (params.cc !== undefined && params.cc.length > 0) {
    email.cc = params.cc.map((a) => (a.name !== undefined ? a : { email: a.email }));
  }
  if (params.bcc !== undefined && params.bcc.length > 0) {
    email.bcc = params.bcc.map((a) => (a.name !== undefined ? a : { email: a.email }));
  }
  if (params.inReplyTo !== undefined) {
    email.inReplyTo = [params.inReplyTo];
  }
  if (params.references !== undefined) {
    email.references = params.references.split(/\s+/).filter((s) => s.length > 0);
  }
  if (params.attachments !== undefined && params.attachments.length > 0) {
    email.attachments = params.attachments.map(toJmapAttachment);
  }

  const submission: Record<string, unknown> = {
    identityId: params.identityId,
    emailId: '#c0',
  };
  if (params.sendAt !== undefined) {
    submission.sendAt = params.sendAt;
  }

  return JSON.stringify({
    using: JMAP_USING_MAIL_SUBMISSION,
    methodCalls: [
      [
        'Email/set',
        {
          accountId,
          create: { c0: email },
        },
        '0',
      ],
      [
        'EmailSubmission/set',
        {
          accountId,
          create: { s0: submission },
        },
        '1',
      ],
    ],
  });
}

/**
 * POST a chained `Email/set` + `EmailSubmission/set` and parse the
 * response. Returns the union of both `created` records.
 */
export async function fetchMailSendCommit(
  opts: FetchMailSendOptions,
): Promise<MailSendResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  if (opts.params.bodyText === undefined && opts.params.bodyHtml === undefined) {
    throw makeError(
      'invalid_argument',
      'mail.send requires at least one of bodyText or bodyHtml.',
    );
  }
  if (opts.params.to.length === 0) {
    throw makeError('invalid_argument', 'mail.send requires at least one recipient.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildMailSendRequest({ accountId, params: opts.params });

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
      `JMAP Email/set+EmailSubmission/set returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseEmailSubmissionSetResponse(text);
}

/**
 * Parse the response from the chained Email/set + EmailSubmission/set
 * request. Extracts:
 *   - email creation `c0` (id / blobId / threadId / size)
 *   - submission creation `s0` (id / sendAt)
 *
 * Surfaces `notCreated` for either step as a structured error. The
 * EmailSubmission failure path is the more interesting one — it
 * surfaces relay-level errors (rate limits, address rejections, etc.)
 * that the client otherwise wouldn't see until a bounce.
 */
export function parseEmailSubmissionSetResponse(body: string): MailSendResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Email/set+EmailSubmission/set response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Send response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length < 2) {
    throw makeError(
      'jmap_parse_error',
      'Send response needs at least two methodResponses (Email/set, EmailSubmission/set).',
    );
  }
  const emailResp = methodResponses[0] as unknown;
  const subResp = methodResponses[1] as unknown;
  if (!Array.isArray(emailResp) || emailResp[0] !== 'Email/set') {
    throw makeError('jmap_parse_error', 'First methodResponse is not Email/set.');
  }
  if (!Array.isArray(subResp) || subResp[0] !== 'EmailSubmission/set') {
    throw makeError(
      'jmap_parse_error',
      'Second methodResponse is not EmailSubmission/set.',
    );
  }
  // Email/set first
  const emailResult = emailResp[1] as {
    created?: Record<string, unknown>;
    notCreated?: Record<string, { type?: string; description?: string }>;
  };
  if (emailResult.notCreated !== undefined) {
    const c0 = emailResult.notCreated['c0'];
    if (c0 !== undefined) {
      throw makeError(
        'jmap_set_error',
        `Email/set rejected: ${c0.type ?? 'unknown'}${c0.description !== undefined ? ` — ${c0.description}` : ''}`,
        c0,
      );
    }
  }
  const createdEmail = emailResult.created?.['c0'] as
    | { id?: string; blobId?: string; threadId?: string; size?: number | bigint }
    | undefined;
  if (
    createdEmail === undefined ||
    typeof createdEmail.id !== 'string' ||
    typeof createdEmail.blobId !== 'string' ||
    typeof createdEmail.threadId !== 'string'
  ) {
    throw makeError(
      'jmap_parse_error',
      'Email/set created["c0"] is missing required fields.',
    );
  }
  // EmailSubmission/set second
  const subResult = subResp[1] as {
    created?: Record<string, unknown>;
    notCreated?: Record<string, { type?: string; description?: string }>;
  };
  if (subResult.notCreated !== undefined) {
    const s0 = subResult.notCreated['s0'];
    if (s0 !== undefined) {
      throw makeError(
        'submission_rejected',
        `EmailSubmission/set rejected: ${s0.type ?? 'unknown'}${s0.description !== undefined ? ` — ${s0.description}` : ''}`,
        s0,
      );
    }
  }
  const createdSub = subResult.created?.['s0'] as
    | { id?: string; sendAt?: string }
    | undefined;
  if (createdSub === undefined || typeof createdSub.id !== 'string') {
    throw makeError(
      'jmap_parse_error',
      'EmailSubmission/set created["s0"] is missing required fields.',
    );
  }
  return {
    emailId: createdEmail.id,
    blobId: createdEmail.blobId,
    threadId: createdEmail.threadId,
    size: Number(createdEmail.size ?? 0),
    submissionId: createdSub.id,
    ...(createdSub.sendAt !== undefined ? { sendAt: createdSub.sendAt } : {}),
  };
}

/**
 * Translate an `AttachmentRef` (the contract input shape) into the
 * JMAP `Email/set` create attachment shape per RFC 8621 §4.1.4 /
 * §1.6.1. `partId` is JMAP's identifier for body-tree positioning;
 * `blobId` is what the server actually references the bytes by.
 */
function toJmapAttachment(a: AttachmentRef): Record<string, unknown> {
  return {
    blobId: a.blobId,
    type: a.type,
    name: a.name,
    size: a.size,
    ...(a.disposition !== undefined ? { disposition: a.disposition } : {}),
    ...(a.cid !== undefined ? { cid: a.cid } : {}),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Email/set update (mail.modify)
// ──────────────────────────────────────────────────────────────────────
//
// Same D-038 carve-out as mail.draft/mail.send: the `Email/set` update
// response is a flat `updated` map of `{id: null}` pairs (no
// sender-controlled content), and we parse it with the same
// hand-written host-side logic. The patch uses JMAP's path-based
// update syntax (RFC 8620 §5.3): `mailboxIds/inbox-id: false`,
// `keywords/$seen: true`.

export type MailModifyInput = {
  readonly emailIds: readonly string[];
  readonly patch: {
    readonly mailboxIds?: Readonly<Record<string, boolean>>;
    readonly keywords?: Readonly<Record<string, boolean>>;
  };
};

export type MailModifyResult = { readonly modifiedCount: number };

export type FetchMailModifyOptions = JmapClientOptions & {
  readonly session: Session;
  readonly params: MailModifyInput;
};

/**
 * Build the JMAP `Email/set` update payload for a modify. Pure function —
 * no I/O. The patch uses JMAP's path-based update syntax so individual
 * mailbox membership or keyword flags can be toggled without replacing
 * the entire map.
 */
export function buildMailModifyRequest(opts: {
  readonly accountId: string;
  readonly params: MailModifyInput;
}): string {
  const { accountId, params } = opts;
  const patchObj: Record<string, boolean> = {};
  if (params.patch.mailboxIds !== undefined) {
    for (const [id, value] of Object.entries(params.patch.mailboxIds)) {
      patchObj[`mailboxIds/${id}`] = value;
    }
  }
  if (params.patch.keywords !== undefined) {
    for (const [keyword, value] of Object.entries(params.patch.keywords)) {
      patchObj[`keywords/${keyword}`] = value;
    }
  }
  const update: Record<string, Record<string, boolean>> = {};
  for (const emailId of params.emailIds) {
    update[emailId] = { ...patchObj };
  }
  return JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/set',
        {
          accountId,
          update,
        },
        '0',
      ],
    ],
  });
}

/**
 * Parse a JMAP `Email/set` response for an update operation. Extracts
 * the count of `updated` entries. Throws on `notUpdated` entries.
 */
export function parseMailModifyResponse(body: string): MailModifyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Email/set update response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Email/set update response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'Email/set update response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'Email/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not Email/set.',
    );
  }
  const result = first[1] as {
    updated?: Record<string, unknown>;
    notUpdated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notUpdated !== undefined) {
    const entries = Object.entries(result.notUpdated);
    if (entries.length > 0) {
      const [id, err] = entries[0]!;
      throw makeError(
        'jmap_set_error',
        `Email/set update rejected for ${id}: ${err.type ?? 'unknown'}${err.description !== undefined ? ` — ${err.description}` : ''}`,
        result.notUpdated,
      );
    }
  }
  const updated = result.updated ?? {};
  return { modifiedCount: Object.keys(updated).length };
}

/**
 * POST a JMAP `Email/set` update and parse the response into a
 * `MailModifyResult`. Use in the `mail.modify` commit branch of the
 * invoker; the dry-run branch should NOT call this.
 */
export async function fetchMailModifyCommit(
  opts: FetchMailModifyOptions,
): Promise<MailModifyResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildMailModifyRequest({ accountId, params: opts.params });

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
      `JMAP Email/set update returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseMailModifyResponse(text);
}

// ──────────────────────────────────────────────────────────────────────
// Email/set destroy (mail.delete)
// ──────────────────────────────────────────────────────────────────────
//
// Same D-038 carve-out as mail.draft/mail.send: the `Email/set` destroy
// response is a flat `destroyed` string array + optional `notDestroyed`
// map. No sender-controlled content, no nested parsing.

export type MailDeleteResult = { readonly deletedCount: number };

export type FetchMailDeleteOptions = JmapClientOptions & {
  readonly session: Session;
  readonly emailIds: readonly string[];
};

/**
 * Build the JMAP `Email/set` destroy payload. Pure function — no I/O.
 */
export function buildMailDeleteRequest(opts: {
  readonly accountId: string;
  readonly emailIds: readonly string[];
}): string {
  return JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [['Email/set', { accountId: opts.accountId, destroy: opts.emailIds }, '0']],
  });
}

/**
 * Parse a JMAP `Email/set` destroy response. Extracts the `destroyed`
 * array length into `deletedCount`. Throws on `notDestroyed` with
 * error details so callers surface per-id failures.
 */
export function parseMailDeleteResponse(body: string): MailDeleteResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Email/set destroy response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Email/set destroy response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'Email/set destroy response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'Email/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not Email/set.',
    );
  }
  const result = first[1] as {
    destroyed?: unknown[];
    notDestroyed?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notDestroyed !== undefined && Object.keys(result.notDestroyed).length > 0) {
    const ids = Object.keys(result.notDestroyed);
    const details = ids
      .map((id) => {
        const entry = result.notDestroyed![id]!;
        return `${id}: ${entry.type ?? 'unknown'}${entry.description !== undefined ? ` — ${entry.description}` : ''}`;
      })
      .join('; ');
    throw makeError(
      'jmap_set_error',
      `Email/set notDestroyed: ${details}`,
      result.notDestroyed,
    );
  }
  const destroyed = Array.isArray(result.destroyed) ? result.destroyed : [];
  return { deletedCount: destroyed.length };
}

/**
 * POST a JMAP `Email/set` destroy and parse the response into a
 * `MailDeleteResult`. Same auth-check -> POST -> parse pattern as
 * `fetchMailDraftCommit`.
 */
export async function fetchMailDeleteCommit(
  opts: FetchMailDeleteOptions,
): Promise<MailDeleteResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildMailDeleteRequest({ accountId, emailIds: opts.emailIds });

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
      `JMAP Email/set destroy returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseMailDeleteResponse(text);
}

// ──────────────────────────────────────────────────────────────────────
// Calendar/get (calendar.list) — Phase 4b
// ──────────────────────────────────────────────────────────────────────

export type Calendar = {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
  readonly isVisible: boolean;
};

export type FetchCalendarListOptions = JmapClientOptions & {
  readonly session: Session;
};

const JMAP_USING_CALENDARS = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:calendars',
];

/**
 * Build the JMAP `Calendar/get` request. `ids: null` fetches every
 * calendar the authenticated account is permitted to see.
 */
export function buildCalendarListRequest(opts: {
  readonly accountId: string;
}): string {
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [
      [
        'Calendar/get',
        {
          accountId: opts.accountId,
          ids: null,
        },
        '0',
      ],
    ],
  });
}

export async function fetchCalendarList(
  opts: FetchCalendarListOptions,
): Promise<Calendar[]> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = buildCalendarListRequest({
    accountId: opts.session.primaryAccountIdMail,
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
      `JMAP Calendar/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseCalendarListResponse(text);
}

export function parseCalendarListResponse(body: string): Calendar[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse Calendar/get response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'Calendar/get response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'Calendar/get response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'Calendar/get') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not Calendar/get.',
    );
  }
  const list = (first[1] as { list?: unknown }).list;
  if (!Array.isArray(list)) {
    throw makeError('jmap_parse_error', 'Calendar/get response is missing list.');
  }
  return list.map((raw, i) => parseCalendar(raw, i));
}

function parseCalendar(raw: unknown, index: number): Calendar {
  if (raw === null || typeof raw !== 'object') {
    throw makeError(
      'jmap_parse_error',
      `Calendar at index ${index} is not an object.`,
    );
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') {
    throw makeError(
      'jmap_parse_error',
      `Calendar at index ${index} is missing required fields.`,
    );
  }
  return {
    id: r.id,
    name: r.name,
    ...(typeof r.color === 'string' ? { color: r.color } : {}),
    isVisible: typeof r.isVisible === 'boolean' ? r.isVisible : true,
  };
}

// ──────────────────────────────────────────────────────────────────────
// CalendarEvent/query + CalendarEvent/get (event.list) — Phase 4b
// ──────────────────────────────────────────────────────────────────────

export type CalendarEvent = {
  readonly id: string;
  readonly calendarIds: Readonly<Record<string, boolean>>;
  readonly title: string;
  readonly description?: string;
  readonly start: string;
  readonly duration?: string;
  readonly timeZone?: string;
  readonly status?: 'confirmed' | 'tentative' | 'cancelled';
  readonly participants?: Readonly<Record<string, {
    name?: string;
    email: string;
    kind?: string;
    participationStatus?: string;
  }>>;
  readonly locations?: Readonly<Record<string, { name?: string }>>;
};

export type EventList = {
  readonly events: readonly CalendarEvent[];
  readonly position: number;
  readonly total?: number;
};

export type FetchEventListOptions = JmapClientOptions & {
  readonly session: Session;
  readonly after: string;
  readonly before: string;
  readonly calendarId?: string;
  readonly position?: number;
  readonly limit?: number;
};

const CALENDAR_EVENT_DEFAULT_LIMIT = 50;
const CALENDAR_EVENT_MAX_LIMIT = 200;

const CALENDAR_EVENT_PROPERTIES = [
  'id',
  'calendarIds',
  'title',
  'description',
  'start',
  'duration',
  'timeZone',
  'recurrenceRules',
  'participants',
  'locations',
  'status',
];

/**
 * Build the JMAP `CalendarEvent/query` + `CalendarEvent/get` chained
 * request for listing events in a date range.
 */
export function buildEventListRequest(opts: {
  readonly accountId: string;
  readonly after: string;
  readonly before: string;
  readonly calendarId?: string;
  readonly position?: number;
  readonly limit?: number;
}): string {
  const position = opts.position ?? 0;
  const limit = Math.min(opts.limit ?? CALENDAR_EVENT_DEFAULT_LIMIT, CALENDAR_EVENT_MAX_LIMIT);
  const filter: Record<string, unknown> = {
    after: opts.after,
    before: opts.before,
  };
  if (opts.calendarId !== undefined) {
    filter.inCalendars = [opts.calendarId];
  }
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [
      [
        'CalendarEvent/query',
        {
          accountId: opts.accountId,
          filter,
          sort: [{ property: 'start', isAscending: true }],
          position,
          limit,
          calculateTotal: true,
        },
        '0',
      ],
      [
        'CalendarEvent/get',
        {
          accountId: opts.accountId,
          '#ids': { resultOf: '0', name: 'CalendarEvent/query', path: '/ids' },
          properties: CALENDAR_EVENT_PROPERTIES,
        },
        '1',
      ],
    ],
  });
}

export async function fetchEventList(
  opts: FetchEventListOptions,
): Promise<EventList> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = buildEventListRequest({
    accountId: opts.session.primaryAccountIdMail,
    after: opts.after,
    before: opts.before,
    ...(opts.calendarId !== undefined ? { calendarId: opts.calendarId } : {}),
    ...(opts.position !== undefined ? { position: opts.position } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
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
      `JMAP CalendarEvent/query+CalendarEvent/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseEventListResponse(text);
}

export function parseEventListResponse(body: string): EventList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse CalendarEvent/query response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'CalendarEvent/query response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length < 2) {
    throw makeError(
      'jmap_parse_error',
      'CalendarEvent response needs at least two methodResponses.',
    );
  }
  const queryResp = methodResponses[0];
  const getResp = methodResponses[1];
  if (!Array.isArray(queryResp) || queryResp[0] !== 'CalendarEvent/query') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not CalendarEvent/query.',
    );
  }
  if (!Array.isArray(getResp) || getResp[0] !== 'CalendarEvent/get') {
    throw makeError(
      'jmap_parse_error',
      'Second methodResponse is not CalendarEvent/get.',
    );
  }
  const queryResult = queryResp[1] as { position?: number; total?: number };
  const getResult = getResp[1] as { list?: unknown[] };
  const list = Array.isArray(getResult.list) ? getResult.list : [];
  return {
    events: list.map((raw, i) => parseCalendarEvent(raw, i)),
    position: typeof queryResult.position === 'number' ? queryResult.position : 0,
    ...(typeof queryResult.total === 'number' ? { total: queryResult.total } : {}),
  };
}

// ──────────────────────────────────────────────────────────────────────
// CalendarEvent/get (event.get — single event) — Phase 4b
// ──────────────────────────────────────────────────────────────────────

export type FetchEventGetOptions = JmapClientOptions & {
  readonly session: Session;
  readonly eventId: string;
};

/**
 * Build a JMAP `CalendarEvent/get` request for a single event by id.
 */
export function buildEventGetRequest(opts: {
  readonly accountId: string;
  readonly eventId: string;
}): string {
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [
      [
        'CalendarEvent/get',
        {
          accountId: opts.accountId,
          ids: [opts.eventId],
          properties: CALENDAR_EVENT_PROPERTIES,
        },
        '0',
      ],
    ],
  });
}

export async function fetchEventGet(
  opts: FetchEventGetOptions,
): Promise<CalendarEvent> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = buildEventGetRequest({
    accountId: opts.session.primaryAccountIdMail,
    eventId: opts.eventId,
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
      `JMAP CalendarEvent/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseEventGetResponse(text);
}

export function parseEventGetResponse(body: string): CalendarEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse CalendarEvent/get response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'CalendarEvent/get response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'CalendarEvent/get response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'CalendarEvent/get') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not CalendarEvent/get.',
    );
  }
  const result = first[1] as { list?: unknown[]; notFound?: string[] };
  if (Array.isArray(result.notFound) && result.notFound.length > 0) {
    throw makeError(
      'not_found',
      `CalendarEvent not found: ${result.notFound.join(', ')}`,
    );
  }
  const list = Array.isArray(result.list) ? result.list : [];
  if (list.length === 0) {
    throw makeError('not_found', 'CalendarEvent/get returned empty list.');
  }
  return parseCalendarEvent(list[0], 0);
}

function parseCalendarEvent(raw: unknown, index: number): CalendarEvent {
  if (raw === null || typeof raw !== 'object') {
    throw makeError(
      'jmap_parse_error',
      `CalendarEvent at index ${index} is not an object.`,
    );
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.title !== 'string' || typeof r.start !== 'string') {
    throw makeError(
      'jmap_parse_error',
      `CalendarEvent at index ${index} is missing required fields.`,
    );
  }
  const calendarIds = (r.calendarIds !== null && typeof r.calendarIds === 'object')
    ? r.calendarIds as Record<string, boolean>
    : {};
  return {
    id: r.id,
    calendarIds,
    title: r.title,
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    start: r.start,
    ...(typeof r.duration === 'string' ? { duration: r.duration } : {}),
    ...(typeof r.timeZone === 'string' ? { timeZone: r.timeZone } : {}),
    ...(typeof r.status === 'string' &&
      (r.status === 'confirmed' || r.status === 'tentative' || r.status === 'cancelled')
      ? { status: r.status }
      : {}),
    ...(r.participants !== null && typeof r.participants === 'object'
      ? { participants: parseParticipants(r.participants as Record<string, unknown>) }
      : {}),
    ...(r.locations !== null && typeof r.locations === 'object'
      ? { locations: parseLocations(r.locations as Record<string, unknown>) }
      : {}),
  };
}

function parseParticipants(
  raw: Record<string, unknown>,
): Record<string, { name?: string; email: string; kind?: string; participationStatus?: string }> {
  const result: Record<string, { name?: string; email: string; kind?: string; participationStatus?: string }> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== null && typeof value === 'object') {
      const p = value as Record<string, unknown>;
      if (typeof p.email === 'string') {
        result[key] = {
          ...(typeof p.name === 'string' ? { name: p.name } : {}),
          email: p.email,
          ...(typeof p.kind === 'string' ? { kind: p.kind } : {}),
          ...(typeof p.participationStatus === 'string'
            ? { participationStatus: p.participationStatus }
            : {}),
        };
      }
    }
  }
  return result;
}

function parseLocations(
  raw: Record<string, unknown>,
): Record<string, { name?: string }> {
  const result: Record<string, { name?: string }> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== null && typeof value === 'object') {
      const l = value as Record<string, unknown>;
      result[key] = {
        ...(typeof l.name === 'string' ? { name: l.name } : {}),
      };
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────
// ContactCard/query + ContactCard/get (contact.list) — Phase 4c
// ──────────────────────────────────────────────────────────────────────

export type Contact = {
  readonly id: string;
  readonly name?: { readonly full?: string; readonly given?: string; readonly surname?: string };
  readonly emails?: readonly { readonly address: string; readonly label?: string }[];
  readonly phones?: readonly { readonly number: string; readonly label?: string }[];
  readonly organizations?: readonly { readonly name?: string; readonly title?: string }[];
};

export type ContactList = {
  readonly contacts: readonly Contact[];
  readonly total?: number;
};

export type FetchContactListOptions = JmapClientOptions & {
  readonly session: Session;
  readonly query?: string;
};

export type FetchContactGetOptions = JmapClientOptions & {
  readonly session: Session;
  readonly contactId: string;
};

const JMAP_USING_CONTACTS = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:contacts',
];

const CONTACT_CARD_PROPERTIES = [
  'id',
  'name',
  'emails',
  'phones',
  'organizations',
];

/**
 * Build the JMAP `AddressBook/get` → `ContactCard/query` → `ContactCard/get`
 * chained request. The query step discovers all contact IDs in the first
 * address book; the get step materializes the records.
 */
export function buildContactListRequest(opts: {
  readonly accountId: string;
  readonly query?: string;
}): string {
  const queryFilter: Record<string, unknown> = {};
  if (opts.query !== undefined && opts.query.trim() !== '') {
    queryFilter.text = opts.query;
  }
  return JSON.stringify({
    using: JMAP_USING_CONTACTS,
    methodCalls: [
      [
        'AddressBook/get',
        { accountId: opts.accountId },
        '0',
      ],
      [
        'ContactCard/query',
        {
          accountId: opts.accountId,
          ...(Object.keys(queryFilter).length > 0 ? { filter: queryFilter } : {}),
        },
        '1',
      ],
      [
        'ContactCard/get',
        {
          accountId: opts.accountId,
          '#ids': { resultOf: '1', name: 'ContactCard/query', path: '/ids' },
          properties: CONTACT_CARD_PROPERTIES,
        },
        '2',
      ],
    ],
  });
}

/**
 * Build the JMAP `ContactCard/get` request for a single contact by id.
 */
export function buildContactGetRequest(opts: {
  readonly accountId: string;
  readonly contactId: string;
}): string {
  return JSON.stringify({
    using: JMAP_USING_CONTACTS,
    methodCalls: [
      [
        'ContactCard/get',
        {
          accountId: opts.accountId,
          ids: [opts.contactId],
          properties: CONTACT_CARD_PROPERTIES,
        },
        '0',
      ],
    ],
  });
}

export async function fetchContactList(
  opts: FetchContactListOptions,
): Promise<ContactList> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = buildContactListRequest({
    accountId: opts.session.primaryAccountIdMail,
    ...(opts.query !== undefined ? { query: opts.query } : {}),
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
      `JMAP ContactCard/query+ContactCard/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseContactListResponse(text);
}

export function parseContactListResponse(body: string): ContactList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse ContactCard response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'ContactCard response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length < 3) {
    throw makeError(
      'jmap_parse_error',
      'ContactCard response needs at least three methodResponses.',
    );
  }
  const queryResp = methodResponses[1];
  const getResp = methodResponses[2];
  if (!Array.isArray(queryResp) || queryResp[0] !== 'ContactCard/query') {
    throw makeError(
      'jmap_parse_error',
      'Second methodResponse is not ContactCard/query.',
    );
  }
  if (!Array.isArray(getResp) || getResp[0] !== 'ContactCard/get') {
    throw makeError(
      'jmap_parse_error',
      'Third methodResponse is not ContactCard/get.',
    );
  }
  const queryResult = queryResp[1] as { total?: number };
  const getResult = getResp[1] as { list?: unknown[] };
  const list = Array.isArray(getResult.list) ? getResult.list : [];
  return {
    contacts: list.map((raw, i) => parseContact(raw, i)),
    ...(typeof queryResult.total === 'number' ? { total: queryResult.total } : {}),
  };
}

export async function fetchContactGet(
  opts: FetchContactGetOptions,
): Promise<Contact> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = buildContactGetRequest({
    accountId: opts.session.primaryAccountIdMail,
    contactId: opts.contactId,
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
      `JMAP ContactCard/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseContactGetResponse(text);
}

export function parseContactGetResponse(body: string): Contact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse ContactCard/get response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'ContactCard/get response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'ContactCard/get response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'ContactCard/get') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not ContactCard/get.',
    );
  }
  const result = first[1] as { list?: unknown[]; notFound?: string[] };
  if (Array.isArray(result.notFound) && result.notFound.length > 0) {
    throw makeError(
      'not_found',
      `ContactCard not found: ${result.notFound.join(', ')}`,
    );
  }
  const list = Array.isArray(result.list) ? result.list : [];
  if (list.length === 0) {
    throw makeError('not_found', 'ContactCard/get returned empty list.');
  }
  return parseContact(list[0], 0);
}

/**
 * Parse a single contact card from the JMAP response. JSContact (RFC 9553)
 * represents emails/phones/organizations as maps keyed by arbitrary IDs;
 * we flatten them to arrays for the contract output.
 */
function parseContact(raw: unknown, index: number): Contact {
  if (raw === null || typeof raw !== 'object') {
    throw makeError(
      'jmap_parse_error',
      `ContactCard at index ${index} is not an object.`,
    );
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') {
    throw makeError(
      'jmap_parse_error',
      `ContactCard at index ${index} is missing required id field.`,
    );
  }
  const contact: {
    id: string;
    name?: { full?: string; given?: string; surname?: string };
    emails?: { address: string; label?: string }[];
    phones?: { number: string; label?: string }[];
    organizations?: { name?: string; title?: string }[];
  } = { id: r.id };

  // Name
  if (r.name !== null && typeof r.name === 'object') {
    const n = r.name as Record<string, unknown>;
    contact.name = {
      ...(typeof n.full === 'string' ? { full: n.full } : {}),
      ...(typeof n.given === 'string' ? { given: n.given } : {}),
      ...(typeof n.surname === 'string' ? { surname: n.surname } : {}),
    };
  }

  // Emails — JSContact stores as a map { "key": { address, label?, ... } }
  if (r.emails !== null && typeof r.emails === 'object') {
    const emailMap = r.emails as Record<string, unknown>;
    const emails: { address: string; label?: string }[] = [];
    for (const value of Object.values(emailMap)) {
      if (value !== null && typeof value === 'object') {
        const e = value as Record<string, unknown>;
        if (typeof e.address === 'string') {
          emails.push({
            address: e.address,
            ...(typeof e.label === 'string' ? { label: e.label } : {}),
          });
        }
      }
    }
    if (emails.length > 0) {
      contact.emails = emails;
    }
  }

  // Phones — same map structure
  if (r.phones !== null && typeof r.phones === 'object') {
    const phoneMap = r.phones as Record<string, unknown>;
    const phones: { number: string; label?: string }[] = [];
    for (const value of Object.values(phoneMap)) {
      if (value !== null && typeof value === 'object') {
        const p = value as Record<string, unknown>;
        if (typeof p.number === 'string') {
          phones.push({
            number: p.number,
            ...(typeof p.label === 'string' ? { label: p.label } : {}),
          });
        }
      }
    }
    if (phones.length > 0) {
      contact.phones = phones;
    }
  }

  // Organizations — same map structure
  if (r.organizations !== null && typeof r.organizations === 'object') {
    const orgMap = r.organizations as Record<string, unknown>;
    const orgs: { name?: string; title?: string }[] = [];
    for (const value of Object.values(orgMap)) {
      if (value !== null && typeof value === 'object') {
        const o = value as Record<string, unknown>;
        orgs.push({
          ...(typeof o.name === 'string' ? { name: o.name } : {}),
          ...(typeof o.title === 'string' ? { title: o.title } : {}),
        });
      }
    }
    if (orgs.length > 0) {
      contact.organizations = orgs;
    }
  }

  return contact;
}

// ──────────────────────────────────────────────────────────────────────
// CalendarEvent/set — event.create / event.update / event.delete
// ──────────────────────────────────────────────────────────────────────

export type EventCreateInput = {
  readonly calendarId: string;
  readonly title: string;
  readonly start: string;
  readonly duration?: string;
  readonly timeZone?: string;
  readonly description?: string;
  readonly location?: string;
};

export type EventCreateResult = { readonly eventId: string };

export type EventUpdateInput = {
  readonly eventId: string;
  readonly title?: string;
  readonly start?: string;
  readonly duration?: string;
  readonly description?: string;
  readonly location?: string;
};

export type EventUpdateResult = { readonly updated: boolean };

export type EventDeleteInput = { readonly eventId: string };
export type EventDeleteResult = { readonly deleted: boolean };

export type FetchEventCreateOptions = JmapClientOptions & {
  readonly session: Session;
  readonly params: EventCreateInput;
};

export type FetchEventUpdateOptions = JmapClientOptions & {
  readonly session: Session;
  readonly params: EventUpdateInput;
};

export type FetchEventDeleteOptions = JmapClientOptions & {
  readonly session: Session;
  readonly eventId: string;
};

/**
 * Build the JMAP `CalendarEvent/set` create payload. Pure function — no I/O.
 */
export function buildEventCreateRequest(opts: {
  readonly accountId: string;
  readonly params: EventCreateInput;
}): string {
  const { accountId, params } = opts;
  const event: Record<string, unknown> = {
    '@type': 'Event',
    calendarIds: { [params.calendarId]: true },
    title: params.title,
    start: params.start,
  };
  if (params.duration !== undefined) {
    event.duration = params.duration;
  }
  if (params.timeZone !== undefined) {
    event.timeZone = params.timeZone;
  }
  if (params.description !== undefined) {
    event.description = params.description;
  }
  if (params.location !== undefined) {
    event.locations = { loc0: { name: params.location } };
  }
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [
      [
        'CalendarEvent/set',
        {
          accountId,
          create: { c0: event },
        },
        '0',
      ],
    ],
  });
}

/**
 * Build the JMAP `CalendarEvent/set` update payload. Only includes fields
 * present in the input — JMAP path-based patching semantics.
 */
export function buildEventUpdateRequest(opts: {
  readonly accountId: string;
  readonly params: EventUpdateInput;
}): string {
  const { accountId, params } = opts;
  const patch: Record<string, unknown> = {};
  if (params.title !== undefined) {
    patch.title = params.title;
  }
  if (params.start !== undefined) {
    patch.start = params.start;
  }
  if (params.duration !== undefined) {
    patch.duration = params.duration;
  }
  if (params.description !== undefined) {
    patch.description = params.description;
  }
  if (params.location !== undefined) {
    patch.locations = { loc0: { name: params.location } };
  }
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [
      [
        'CalendarEvent/set',
        {
          accountId,
          update: { [params.eventId]: patch },
        },
        '0',
      ],
    ],
  });
}

/**
 * Build the JMAP `CalendarEvent/set` destroy payload.
 */
export function buildEventDeleteRequest(opts: {
  readonly accountId: string;
  readonly eventId: string;
}): string {
  return JSON.stringify({
    using: JMAP_USING_CALENDARS,
    methodCalls: [
      ['CalendarEvent/set', { accountId: opts.accountId, destroy: [opts.eventId] }, '0'],
    ],
  });
}

/**
 * Parse a JMAP `CalendarEvent/set` create response.
 */
export function parseEventCreateResponse(body: string): EventCreateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse CalendarEvent/set response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'CalendarEvent/set response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'CalendarEvent/set response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'CalendarEvent/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not CalendarEvent/set.',
    );
  }
  const result = first[1] as {
    created?: Record<string, unknown>;
    notCreated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notCreated !== undefined) {
    const c0 = result.notCreated['c0'];
    if (c0 !== undefined) {
      throw makeError(
        'jmap_set_error',
        `CalendarEvent/set rejected: ${c0.type ?? 'unknown'}${c0.description !== undefined ? ` — ${c0.description}` : ''}`,
        c0,
      );
    }
  }
  const created = result.created?.['c0'] as { id?: string } | undefined;
  if (created === undefined || typeof created.id !== 'string') {
    throw makeError(
      'jmap_parse_error',
      'CalendarEvent/set response has no created["c0"] entry.',
    );
  }
  return { eventId: created.id };
}

/**
 * Parse a JMAP `CalendarEvent/set` update response.
 */
export function parseEventUpdateResponse(body: string): EventUpdateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse CalendarEvent/set update response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'CalendarEvent/set update response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'CalendarEvent/set update response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'CalendarEvent/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not CalendarEvent/set.',
    );
  }
  const result = first[1] as {
    updated?: Record<string, unknown>;
    notUpdated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notUpdated !== undefined) {
    const entries = Object.entries(result.notUpdated);
    if (entries.length > 0) {
      const [id, err] = entries[0]!;
      throw makeError(
        'jmap_set_error',
        `CalendarEvent/set update rejected for ${id}: ${err.type ?? 'unknown'}${err.description !== undefined ? ` — ${err.description}` : ''}`,
        result.notUpdated,
      );
    }
  }
  return { updated: true };
}

/**
 * Parse a JMAP `CalendarEvent/set` destroy response.
 */
export function parseEventDeleteResponse(body: string): EventDeleteResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse CalendarEvent/set destroy response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'CalendarEvent/set destroy response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'CalendarEvent/set destroy response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'CalendarEvent/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not CalendarEvent/set.',
    );
  }
  const result = first[1] as {
    destroyed?: unknown[];
    notDestroyed?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notDestroyed !== undefined && Object.keys(result.notDestroyed).length > 0) {
    const ids = Object.keys(result.notDestroyed);
    const details = ids
      .map((id) => {
        const entry = result.notDestroyed![id]!;
        return `${id}: ${entry.type ?? 'unknown'}${entry.description !== undefined ? ` — ${entry.description}` : ''}`;
      })
      .join('; ');
    throw makeError(
      'jmap_set_error',
      `CalendarEvent/set notDestroyed: ${details}`,
      result.notDestroyed,
    );
  }
  return { deleted: true };
}

/**
 * POST a JMAP `CalendarEvent/set` create and parse the response.
 */
export async function fetchEventCreateCommit(
  opts: FetchEventCreateOptions,
): Promise<EventCreateResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildEventCreateRequest({ accountId, params: opts.params });

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
      `JMAP CalendarEvent/set create returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseEventCreateResponse(text);
}

/**
 * POST a JMAP `CalendarEvent/set` update and parse the response.
 */
export async function fetchEventUpdateCommit(
  opts: FetchEventUpdateOptions,
): Promise<EventUpdateResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildEventUpdateRequest({ accountId, params: opts.params });

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
      `JMAP CalendarEvent/set update returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseEventUpdateResponse(text);
}

/**
 * POST a JMAP `CalendarEvent/set` destroy and parse the response.
 */
export async function fetchEventDeleteCommit(
  opts: FetchEventDeleteOptions,
): Promise<EventDeleteResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildEventDeleteRequest({ accountId, eventId: opts.eventId });

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
      `JMAP CalendarEvent/set destroy returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseEventDeleteResponse(text);
}

// ──────────────────────────────────────────────────────────────────────
// ContactCard/set — contact.create / contact.update / contact.delete
// ──────────────────────────────────────────────────────────────────────

export type ContactCreateInput = {
  readonly addressBookId?: string;
  readonly name: { readonly full?: string; readonly given?: string; readonly surname?: string };
  readonly emails?: readonly { readonly address: string; readonly label?: string }[];
  readonly phones?: readonly { readonly number: string; readonly label?: string }[];
  readonly organizations?: readonly { readonly name?: string; readonly title?: string }[];
};

export type ContactCreateResult = { readonly contactId: string };

export type ContactUpdateInput = {
  readonly contactId: string;
  readonly name?: { readonly full?: string; readonly given?: string; readonly surname?: string };
  readonly emails?: readonly { readonly address: string; readonly label?: string }[];
  readonly phones?: readonly { readonly number: string; readonly label?: string }[];
};

export type ContactUpdateResult = { readonly updated: boolean };

export type ContactDeleteInput = { readonly contactId: string };
export type ContactDeleteResult = { readonly deleted: boolean };

export type FetchContactCreateOptions = JmapClientOptions & {
  readonly session: Session;
  readonly params: ContactCreateInput;
};

export type FetchContactUpdateOptions = JmapClientOptions & {
  readonly session: Session;
  readonly params: ContactUpdateInput;
};

export type FetchContactDeleteOptions = JmapClientOptions & {
  readonly session: Session;
  readonly contactId: string;
};

/**
 * Build the JMAP `ContactCard/set` create payload. Translates the flat
 * array-based input into JSContact's map-keyed structure.
 */
export function buildContactCreateRequest(opts: {
  readonly accountId: string;
  readonly params: ContactCreateInput;
}): string {
  const { accountId, params } = opts;
  const card: Record<string, unknown> = {
    '@type': 'Card',
    name: params.name,
  };
  if (params.addressBookId !== undefined) {
    card.addressBookIds = { [params.addressBookId]: true };
  }
  if (params.emails !== undefined && params.emails.length > 0) {
    const emailMap: Record<string, unknown> = {};
    params.emails.forEach((e, i) => {
      emailMap[`e${i}`] = {
        address: e.address,
        ...(e.label !== undefined ? { label: e.label } : {}),
      };
    });
    card.emails = emailMap;
  }
  if (params.phones !== undefined && params.phones.length > 0) {
    const phoneMap: Record<string, unknown> = {};
    params.phones.forEach((p, i) => {
      phoneMap[`p${i}`] = {
        number: p.number,
        ...(p.label !== undefined ? { label: p.label } : {}),
      };
    });
    card.phones = phoneMap;
  }
  if (params.organizations !== undefined && params.organizations.length > 0) {
    const orgMap: Record<string, unknown> = {};
    params.organizations.forEach((o, i) => {
      orgMap[`o${i}`] = {
        ...(o.name !== undefined ? { name: o.name } : {}),
        ...(o.title !== undefined ? { title: o.title } : {}),
      };
    });
    card.organizations = orgMap;
  }
  return JSON.stringify({
    using: JMAP_USING_CONTACTS,
    methodCalls: [
      [
        'ContactCard/set',
        {
          accountId,
          create: { c0: card },
        },
        '0',
      ],
    ],
  });
}

/**
 * Build the JMAP `ContactCard/set` update payload. Only includes fields
 * present in the input.
 */
export function buildContactUpdateRequest(opts: {
  readonly accountId: string;
  readonly params: ContactUpdateInput;
}): string {
  const { accountId, params } = opts;
  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) {
    patch.name = params.name;
  }
  if (params.emails !== undefined && params.emails.length > 0) {
    const emailMap: Record<string, unknown> = {};
    params.emails.forEach((e, i) => {
      emailMap[`e${i}`] = {
        address: e.address,
        ...(e.label !== undefined ? { label: e.label } : {}),
      };
    });
    patch.emails = emailMap;
  }
  if (params.phones !== undefined && params.phones.length > 0) {
    const phoneMap: Record<string, unknown> = {};
    params.phones.forEach((p, i) => {
      phoneMap[`p${i}`] = {
        number: p.number,
        ...(p.label !== undefined ? { label: p.label } : {}),
      };
    });
    patch.phones = phoneMap;
  }
  return JSON.stringify({
    using: JMAP_USING_CONTACTS,
    methodCalls: [
      [
        'ContactCard/set',
        {
          accountId,
          update: { [params.contactId]: patch },
        },
        '0',
      ],
    ],
  });
}

/**
 * Build the JMAP `ContactCard/set` destroy payload.
 */
export function buildContactDeleteRequest(opts: {
  readonly accountId: string;
  readonly contactId: string;
}): string {
  return JSON.stringify({
    using: JMAP_USING_CONTACTS,
    methodCalls: [
      ['ContactCard/set', { accountId: opts.accountId, destroy: [opts.contactId] }, '0'],
    ],
  });
}

/**
 * Parse a JMAP `ContactCard/set` create response.
 */
export function parseContactCreateResponse(body: string): ContactCreateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse ContactCard/set response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'ContactCard/set response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'ContactCard/set response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'ContactCard/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not ContactCard/set.',
    );
  }
  const result = first[1] as {
    created?: Record<string, unknown>;
    notCreated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notCreated !== undefined) {
    const c0 = result.notCreated['c0'];
    if (c0 !== undefined) {
      throw makeError(
        'jmap_set_error',
        `ContactCard/set rejected: ${c0.type ?? 'unknown'}${c0.description !== undefined ? ` — ${c0.description}` : ''}`,
        c0,
      );
    }
  }
  const created = result.created?.['c0'] as { id?: string } | undefined;
  if (created === undefined || typeof created.id !== 'string') {
    throw makeError(
      'jmap_parse_error',
      'ContactCard/set response has no created["c0"] entry.',
    );
  }
  return { contactId: created.id };
}

/**
 * Parse a JMAP `ContactCard/set` update response.
 */
export function parseContactUpdateResponse(body: string): ContactUpdateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse ContactCard/set update response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'ContactCard/set update response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'ContactCard/set update response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'ContactCard/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not ContactCard/set.',
    );
  }
  const result = first[1] as {
    updated?: Record<string, unknown>;
    notUpdated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notUpdated !== undefined) {
    const entries = Object.entries(result.notUpdated);
    if (entries.length > 0) {
      const [id, err] = entries[0]!;
      throw makeError(
        'jmap_set_error',
        `ContactCard/set update rejected for ${id}: ${err.type ?? 'unknown'}${err.description !== undefined ? ` — ${err.description}` : ''}`,
        result.notUpdated,
      );
    }
  }
  return { updated: true };
}

/**
 * Parse a JMAP `ContactCard/set` destroy response.
 */
export function parseContactDeleteResponse(body: string): ContactDeleteResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse ContactCard/set destroy response: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw makeError('jmap_parse_error', 'ContactCard/set destroy response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'ContactCard/set destroy response has no methodResponses array.',
    );
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first.length < 2 || first[0] !== 'ContactCard/set') {
    throw makeError(
      'jmap_parse_error',
      'First methodResponse is not ContactCard/set.',
    );
  }
  const result = first[1] as {
    destroyed?: unknown[];
    notDestroyed?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notDestroyed !== undefined && Object.keys(result.notDestroyed).length > 0) {
    const ids = Object.keys(result.notDestroyed);
    const details = ids
      .map((id) => {
        const entry = result.notDestroyed![id]!;
        return `${id}: ${entry.type ?? 'unknown'}${entry.description !== undefined ? ` — ${entry.description}` : ''}`;
      })
      .join('; ');
    throw makeError(
      'jmap_set_error',
      `ContactCard/set notDestroyed: ${details}`,
      result.notDestroyed,
    );
  }
  return { deleted: true };
}

/**
 * POST a JMAP `ContactCard/set` create and parse the response.
 */
export async function fetchContactCreateCommit(
  opts: FetchContactCreateOptions,
): Promise<ContactCreateResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildContactCreateRequest({ accountId, params: opts.params });

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
      `JMAP ContactCard/set create returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseContactCreateResponse(text);
}

/**
 * POST a JMAP `ContactCard/set` update and parse the response.
 */
export async function fetchContactUpdateCommit(
  opts: FetchContactUpdateOptions,
): Promise<ContactUpdateResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildContactUpdateRequest({ accountId, params: opts.params });

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
      `JMAP ContactCard/set update returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseContactUpdateResponse(text);
}

/**
 * POST a JMAP `ContactCard/set` destroy and parse the response.
 */
export async function fetchContactDeleteCommit(
  opts: FetchContactDeleteOptions,
): Promise<ContactDeleteResult> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const accountId = opts.session.primaryAccountIdMail;
  const body = buildContactDeleteRequest({ accountId, contactId: opts.contactId });

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
      `JMAP ContactCard/set destroy returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  return parseContactDeleteResponse(text);
}

// ──────────────────────────────────────────────────────────────────────
// VacationResponse/get + VacationResponse/set (PR 32 — out-of-office)
// ──────────────────────────────────────────────────────────────────────
//
// RFC 8621 §8. The VacationResponse object is a per-account singleton
// (id always 'singleton'). Toggling isEnabled+subject+textBody is the
// minimum useful surface; the optional from/to dates let the user
// schedule the responder in advance.

export type VacationResponse = {
  readonly id: string;
  readonly isEnabled: boolean;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly subject?: string;
  readonly textBody?: string;
  readonly htmlBody?: string;
};

/** Patchable subset of VacationResponse — the fields a user can set
 *  from the UI. The `id` is always 'singleton' so it doesn't appear
 *  here. */
export type VacationResponseInput = {
  readonly isEnabled: boolean;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly subject?: string;
  readonly textBody?: string;
};

export type FetchVacationResponseOptions = JmapClientOptions & {
  readonly session: Session;
};

export type CommitVacationResponseOptions = JmapClientOptions & {
  readonly session: Session;
  readonly input: VacationResponseInput;
};

const JMAP_USING_VACATION = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:vacationresponse',
];

export async function fetchVacationResponse(
  opts: FetchVacationResponseOptions,
): Promise<VacationResponse | null> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const body = JSON.stringify({
    using: JMAP_USING_VACATION,
    methodCalls: [
      [
        'VacationResponse/get',
        {
          accountId: opts.session.primaryAccountIdMail,
          ids: ['singleton'],
        },
        '0',
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
      `JMAP VacationResponse/get returned ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse VacationResponse/get: ${describe(e)}`,
    );
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'VacationResponse/get: no methodResponses array.',
    );
  }
  const first = responses[0] as unknown;
  if (!Array.isArray(first) || first.length < 2) {
    throw makeError(
      'jmap_parse_error',
      'VacationResponse/get: malformed methodResponse entry.',
    );
  }
  const result = first[1] as { list?: unknown };
  if (!Array.isArray(result.list) || result.list.length === 0) return null;
  const item = result.list[0] as Record<string, unknown>;
  return {
    id: typeof item.id === 'string' ? item.id : 'singleton',
    isEnabled: item.isEnabled === true,
    ...(typeof item.fromDate === 'string' ? { fromDate: item.fromDate } : {}),
    ...(typeof item.toDate === 'string' ? { toDate: item.toDate } : {}),
    ...(typeof item.subject === 'string' ? { subject: item.subject } : {}),
    ...(typeof item.textBody === 'string' ? { textBody: item.textBody } : {}),
    ...(typeof item.htmlBody === 'string' ? { htmlBody: item.htmlBody } : {}),
  };
}

export async function commitVacationResponse(
  opts: CommitVacationResponseOptions,
): Promise<void> {
  const token = opts.getAuthToken();
  if (token === null) {
    throw makeError('unauthorized', 'No auth token available.');
  }
  const fetchImpl = opts.fetch ?? fetch;
  // JMAP VacationResponse/set update — payload is the patch fields.
  // Fields the user cleared are sent as null so the server clears
  // them; populated fields overwrite.
  const update: Record<string, unknown> = {
    isEnabled: opts.input.isEnabled,
    subject: opts.input.subject ?? null,
    textBody: opts.input.textBody ?? null,
    fromDate: opts.input.fromDate ?? null,
    toDate: opts.input.toDate ?? null,
    // Always clear the HTML body — iarsma's UI is text-only for v1.
    // Future rich-text editor can populate this alongside textBody.
    htmlBody: null,
  };
  const body = JSON.stringify({
    using: JMAP_USING_VACATION,
    methodCalls: [
      [
        'VacationResponse/set',
        {
          accountId: opts.session.primaryAccountIdMail,
          update: { singleton: update },
        },
        '0',
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
      `JMAP VacationResponse/set returned ${response.status} ${response.statusText}`,
    );
  }
  // Parse to surface notUpdated entries — they signal a server-side
  // rejection (invalid date, server-disabled feature, etc.).
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw makeError(
      'jmap_parse_error',
      `Failed to parse VacationResponse/set: ${describe(e)}`,
    );
  }
  const responses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(responses) || responses.length === 0) {
    throw makeError(
      'jmap_parse_error',
      'VacationResponse/set: no methodResponses array.',
    );
  }
  const first = responses[0] as unknown;
  if (!Array.isArray(first) || first.length < 2) return;
  const result = first[1] as { notUpdated?: Record<string, unknown> };
  if (
    result.notUpdated !== undefined &&
    result.notUpdated !== null &&
    typeof result.notUpdated === 'object' &&
    Object.keys(result.notUpdated).length > 0
  ) {
    const reason = JSON.stringify(result.notUpdated);
    throw makeError(
      'vacation_set_failed',
      `VacationResponse/set rejected: ${reason}`,
    );
  }
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
