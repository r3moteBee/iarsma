/**
 * Handler for the `thread.list` capability (Phase 1 work item 3).
 *
 * Three-step JMAP flow when a fresh session is needed:
 *   1. GET /.well-known/jmap to resolve `apiUrl` + `primaryAccountIdMail`.
 *   2. POST chained `Email/query` (filter + sort + collapse + paginate)
 *      + `Email/get` (with `#ids` back-reference into Email/query) — one
 *      JMAP request per RFC 8620 §3.7.
 *   3. Parse via `@iarsma/wasm-bindings/jmap-client`.
 *
 * Auth posture matches `session.get` / `mailbox.list`: bearer token
 * from `IARSMA_AGENT_TOKEN`. In-server session caching lands with
 * Phase 1 item 8 (storage layer); for now we re-fetch session per
 * invocation, same as `mailbox.list`.
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
  JmapConfigError as ThreadListConfigError,
  loadSessionGetDeps as loadThreadListDeps,
};
export type ThreadListDeps = JmapDeps;

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

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
 * Build a `thread.list` tool handler bound to the given deps.
 *
 * Input shape (mirrors the contract):
 *   `{ mailboxId: string, position?: number, limit?: number }`
 */
export function createThreadListHandler(deps: ThreadListDeps): ToolHandler {
  return async (input) => {
    const params = parseInput(input);
    const fetchImpl = deps.fetch ?? fetch;

    // Step 1: resolve session for apiUrl + primaryAccountIdMail.
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

    // Step 2: POST chained Email/query + Email/get.
    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const requestBody = JSON.stringify({
      using: JMAP_USING_MAIL,
      methodCalls: [
        [
          'Email/query',
          {
            accountId: session.primaryAccountIdMail,
            filter: { inMailbox: params.mailboxId },
            sort: [{ property: 'receivedAt', isAscending: false }],
            collapseThreads: true,
            position: params.position ?? 0,
            limit,
            calculateTotal: true,
          },
          '0',
        ],
        [
          'Email/get',
          {
            accountId: session.primaryAccountIdMail,
            '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' },
            properties: EMAIL_LIST_PROPERTIES,
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
    requireOk(queryResponse, 'JMAP Email/query+Email/get');
    const text = await queryResponse.text();

    let raw;
    try {
      raw = jmapClientEmail.parseEmailQueryResponse(text);
    } catch (e) {
      throw new Error(
        `JMAP Email/query response could not be parsed: ${describe(e)}`,
      );
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
    } satisfies ThreadList;
  };
}

function parseInput(input: unknown): {
  mailboxId: string;
  position?: number;
  limit?: number;
} {
  if (input === null || typeof input !== 'object') {
    throw badInput('thread.list input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (typeof i.mailboxId !== 'string' || i.mailboxId.length === 0) {
    throw badInput('thread.list input.mailboxId must be a non-empty string');
  }
  const out: { mailboxId: string; position?: number; limit?: number } = {
    mailboxId: i.mailboxId,
  };
  if (i.position !== undefined) {
    if (typeof i.position !== 'number' || !Number.isInteger(i.position) || i.position < 0) {
      throw badInput('thread.list input.position must be a non-negative integer');
    }
    out.position = i.position;
  }
  if (i.limit !== undefined) {
    if (typeof i.limit !== 'number' || !Number.isInteger(i.limit) || i.limit <= 0) {
      throw badInput('thread.list input.limit must be a positive integer');
    }
    out.limit = i.limit;
  }
  return out;
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
