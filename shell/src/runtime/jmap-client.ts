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

function makeError(code: string, message: string, payload?: unknown): ToolError {
  return payload === undefined ? { code, message } : { code, message, payload };
}

function describe(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
