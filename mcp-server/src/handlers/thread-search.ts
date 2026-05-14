/**
 * Handler for the `thread.search` capability (Phase 2 work item 9 +
 * 10).
 *
 * Same JMAP shape as `thread.list` but with a `text` filter instead
 * of `inMailbox`. Optional `inMailboxId` scopes the search to one
 * mailbox via an AND-combinator (matches RFC 8621 §4.4.1).
 *
 * Deps mirror `thread.list` — bearer token + JMAP base URL from
 * environment. Per-agent identity scoping is Phase 3.
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
import type { ThreadList } from './thread-list.js';

export {
  JmapConfigError as ThreadSearchConfigError,
  loadSessionGetDeps as loadThreadSearchDeps,
};
export type ThreadSearchDeps = JmapDeps;

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

export function createThreadSearchHandler(deps: ThreadSearchDeps): ToolHandler {
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
      throw new Error(
        `JMAP session response could not be parsed: ${describe(e)}`,
      );
    }

    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const filter: Record<string, unknown> =
      params.inMailboxId !== undefined
        ? {
            operator: 'AND',
            conditions: [
              { text: params.query },
              { inMailbox: params.inMailboxId },
            ],
          }
        : { text: params.query };
    const requestBody = JSON.stringify({
      using: JMAP_USING_MAIL,
      methodCalls: [
        [
          'Email/query',
          {
            accountId: session.primaryAccountIdMail,
            filter,
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
    requireOk(queryResponse, 'JMAP Email/query (text)');
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
  query: string;
  inMailboxId?: string;
  position?: number;
  limit?: number;
} {
  if (input === null || typeof input !== 'object') {
    throw badInput('thread.search input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (typeof i.query !== 'string' || i.query.trim().length === 0) {
    throw badInput('thread.search input.query must be a non-empty string');
  }
  const out: {
    query: string;
    inMailboxId?: string;
    position?: number;
    limit?: number;
  } = { query: i.query };
  if (i.inMailboxId !== undefined) {
    if (typeof i.inMailboxId !== 'string' || i.inMailboxId.length === 0) {
      throw badInput('thread.search input.inMailboxId must be a non-empty string');
    }
    out.inMailboxId = i.inMailboxId;
  }
  if (i.position !== undefined) {
    if (
      typeof i.position !== 'number' ||
      !Number.isInteger(i.position) ||
      i.position < 0
    ) {
      throw badInput('thread.search input.position must be a non-negative integer');
    }
    out.position = i.position;
  }
  if (i.limit !== undefined) {
    if (typeof i.limit !== 'number' || !Number.isInteger(i.limit) || i.limit <= 0) {
      throw badInput('thread.search input.limit must be a positive integer');
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

function normalizeAddress(a: { name?: string; email: string }): {
  name?: string;
  email: string;
} {
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
  const err = new Error(
    `${label} returned ${response.status} ${response.statusText}`,
  );
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
