/**
 * Handler for the `mailbox.list` capability (Phase 1 work item 1).
 *
 * Two-step JMAP flow: first resolve the session (`/.well-known/jmap`) to
 * obtain `apiUrl` + `primaryAccountIdMail`, then POST a `Mailbox/get`
 * request to the API URL. The session is fetched once per handler
 * invocation today; an in-server session cache lands when Phase 1 work
 * item 8 wires the IndexedDB-equivalent storage layer.
 *
 * Auth posture matches `session.get`: bearer token from `IARSMA_AGENT_TOKEN`
 * env var (Phase 0 stdio); per-request header threading lands with the
 * Streamable HTTP transport in Phase 2 (PR-1's plan addition for D1).
 *
 * Parse path: shared with the shell via `@iarsma/wasm-bindings/jmap-client`.
 * Both hosts route the JMAP response body through the same WASM component.
 */

import {
  mailbox as jmapClientMailbox,
  session as jmapClientSession,
} from '@iarsma/wasm-bindings/jmap-client';
import type { ToolHandler } from '../invocation.js';
import { resolveBearer } from './_resolve-bearer.js';
import {
  type SessionGetDeps as JmapDeps,
  loadSessionGetDeps,
  SessionGetConfigError as JmapConfigError,
} from './session-get.js';

export { JmapConfigError as MailboxListConfigError, loadSessionGetDeps as loadMailboxListDeps };
export type MailboxListDeps = JmapDeps;

/** Field-aligned with the WIT `mailbox` record (RFC 8621 §2). bigint
 *  counts unwrapped to number — JMAP mailbox counts stay well within
 *  Number.MAX_SAFE_INTEGER. */
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

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

/**
 * Build a `mailbox.list` tool handler bound to the given deps. Returns
 * the flat array of mailboxes the parser produces; callers fold the
 * tree on `parentId` if they need a hierarchy.
 */
export function createMailboxListHandler(deps: MailboxListDeps): ToolHandler {
  return async (_input, ctx) => {
    const token = resolveBearer(ctx?.bearerToken, deps.bearerToken);
    const fetchImpl = deps.fetch ?? fetch;

    // Step 1: resolve the session.
    const sessionUrl = `${deps.jmapBaseUrl.replace(/\/$/, '')}/.well-known/jmap`;
    const sessionResponse = await tryFetch(fetchImpl, sessionUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
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

    // Step 2: POST Mailbox/get to the resolved API URL.
    const requestBody = JSON.stringify({
      using: JMAP_USING_MAIL,
      methodCalls: [
        ['Mailbox/get', { accountId: session.primaryAccountIdMail }, '0'],
      ],
    });
    const mailboxResponse = await tryFetch(fetchImpl, session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: requestBody,
    });
    requireOk(mailboxResponse, 'JMAP Mailbox/get');
    const text = await mailboxResponse.text();

    let raw;
    try {
      raw = jmapClientMailbox.parseMailboxGetResponse(text);
    } catch (e) {
      throw new Error(`JMAP Mailbox/get response could not be parsed: ${describe(e)}`);
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
    })) satisfies Mailbox[];
  };
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
