/**
 * Handler for the `thread.get` capability (Phase 1 work item 6).
 *
 * Three-step JMAP flow per invocation:
 *   1. GET /.well-known/jmap to resolve session.
 *   2. POST chained `Thread/get` + `Email/get` (with `#ids`
 *      back-reference into Thread/get's emailIds, RFC 8620 §3.7).
 *   3. Parse via the WASM jmap-client component, which flattens
 *      JMAP's bodyValues + textBody/htmlBody arrays into the
 *      bodyText / bodyHtml strings the contract surfaces.
 *
 * Auth posture matches mailbox.list / thread.list — bearer token from
 * `IARSMA_AGENT_TOKEN`. Per-request token threading lands with
 * Streamable HTTP transport (Phase 2 item 10a).
 *
 * Hosts MUST sanitize `bodyHtml` via `iarsma:html-sanitizer` before
 * rendering. The MCP server's response carries the raw HTML; the
 * consuming agent decides how to render. Iarsma's React shell
 * sanitizes at the MessageView boundary (item 7).
 */

import {
  email as jmapClientEmail,
  session as jmapClientSession,
} from '@iarsma/wasm-bindings/jmap-client';
import type { ToolHandler } from '../invocation.js';
import {
  type SessionGetDeps as JmapDeps,
  loadSessionGetDeps,
  SessionGetConfigError as JmapConfigError,
} from './session-get.js';

export {
  JmapConfigError as ThreadGetConfigError,
  loadSessionGetDeps as loadThreadGetDeps,
};
export type ThreadGetDeps = JmapDeps;

export type EmailAddress = {
  readonly name?: string;
  readonly email: string;
};

export type Keyword = {
  readonly name: string;
  readonly value: boolean;
};

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
};

export type Thread = {
  readonly id: string;
  readonly emailIds: ReadonlyArray<string>;
};

export type ThreadGet = {
  readonly thread: Thread;
  readonly emails: ReadonlyArray<EmailFull>;
};

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

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
];

export function createThreadGetHandler(deps: ThreadGetDeps): ToolHandler {
  return async (input) => {
    const params = parseInput(input);
    const fetchImpl = deps.fetch ?? fetch;

    const sessionUrl = `${deps.jmapBaseUrl.replace(/\/$/, '')}/.well-known/jmap`;
    const sessionResponse = await tryFetch(fetchImpl, sessionUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${deps.bearerToken}`,
      },
    });
    requireOk(sessionResponse, 'JMAP /.well-known/jmap');
    const sessionBody = await sessionResponse.text();
    let session;
    try {
      session = jmapClientSession.parseSession(sessionBody);
    } catch (e) {
      throw new Error(`JMAP session response could not be parsed: ${describe(e)}`);
    }

    const requestBody = JSON.stringify({
      using: JMAP_USING_MAIL,
      methodCalls: [
        ['Thread/get', { accountId: session.primaryAccountIdMail, ids: [params.threadId] }, '0'],
        [
          'Email/get',
          {
            accountId: session.primaryAccountIdMail,
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
    const queryResponse = await tryFetch(fetchImpl, session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${deps.bearerToken}`,
      },
      body: requestBody,
    });
    requireOk(queryResponse, 'JMAP Thread/get+Email/get');
    const text = await queryResponse.text();

    let raw;
    try {
      raw = jmapClientEmail.parseThreadGetResponse(text);
    } catch (e) {
      throw new Error(
        `JMAP Thread/get response could not be parsed: ${describe(e)}`,
      );
    }

    return {
      thread: {
        id: raw.threadId,
        emailIds: [...raw.emailIds],
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
      })),
    } satisfies ThreadGet;
  };
}

function parseInput(input: unknown): { threadId: string } {
  if (input === null || typeof input !== 'object') {
    throw badInput('thread.get input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (typeof i.threadId !== 'string' || i.threadId.length === 0) {
    throw badInput('thread.get input.threadId must be a non-empty string');
  }
  return { threadId: i.threadId };
}

function badInput(message: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = 'invalid_input';
  return err;
}

function normalizeAddress(a: { name?: string; email: string }): EmailAddress {
  return a.name !== undefined ? { name: a.name, email: a.email } : { email: a.email };
}

async function tryFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (e) {
    throw new Error(
      `JMAP fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function requireOk(response: Response, label: string): void {
  if (response.ok) return;
  const code =
    response.status === 401 || response.status === 403
      ? 'unauthorized'
      : 'jmap_http_error';
  const err = new Error(`${label} returned ${response.status} ${response.statusText}`);
  (err as Error & { code?: string }).code = code;
  throw err;
}

function describe(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'payload' in e) {
    const payload = (e as { payload: unknown }).payload;
    if (
      payload !== null &&
      typeof payload === 'object' &&
      'code' in payload &&
      'message' in payload
    ) {
      const p = payload as { code: unknown; message: unknown };
      return `${String(p.code)}: ${String(p.message)}`;
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
