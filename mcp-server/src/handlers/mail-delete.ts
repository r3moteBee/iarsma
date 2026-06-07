/**
 * Handler for the `mail.delete` capability.
 *
 * D-055: `mail.delete` is **soft-delete** (move-to-Trash), not
 * permanent destroy. Mirrors the shell-side path in
 * `shell/src/runtime/invoker.ts`. `mail.purge` remains the destroy
 * path and is intentionally NOT wired into the MCP server.
 *
 *   - `dryRun: true`  → fetch session → Email/get for the emailIds
 *                       to get subject + from for preview → return
 *                       `{affectedCount, emails: [{id, subject, from}]}`.
 *   - `dryRun: false` → resolve Trash mailbox + each email's current
 *                       `mailboxIds` (one round-trip), then issue
 *                       `Email/set update` swapping every source
 *                       mailbox for Trash (second round-trip).
 *                       Returns `{deletedCount}` — the count of
 *                       emails the user no longer sees in their
 *                       original mailbox(es).
 */

import {
  session as jmapClientSession,
} from '@iarsma/wasm-bindings/jmap-client';
import type { ToolHandler } from '../invocation.js';
import { resolveBearer } from './_resolve-bearer.js';
import {
  type SessionGetDeps as JmapDeps,
  loadSessionGetDeps,
  SessionGetConfigError as JmapConfigError,
} from './session-get.js';

export {
  JmapConfigError as MailDeleteConfigError,
  loadSessionGetDeps as loadMailDeleteDeps,
};
export type MailDeleteDeps = JmapDeps;

export type MailDeleteInput = {
  readonly emailIds: ReadonlyArray<string>;
};

export type MailDeletePreview = {
  readonly affectedCount: number;
  readonly emails: ReadonlyArray<{
    readonly id: string;
    readonly subject: string;
    readonly from: string;
  }>;
};

export type MailDeleteResult = {
  readonly deletedCount: number;
};

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

export function createMailDeleteHandler(deps: MailDeleteDeps): ToolHandler {
  return async (input, ctx) => {
    const token = resolveBearer(ctx?.bearerToken, deps.bearerToken);
    const params = parseInput(input);

    // Both branches need the session — resolve it once.
    const fetchImpl = deps.fetch ?? fetch;
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
      throw new Error(
        `JMAP session response could not be parsed: ${describe(e)}`,
      );
    }

    if (ctx.dryRun) {
      return fetchPreview(fetchImpl, token, session, params);
    }

    return commitSoftDelete(fetchImpl, token, session, params);
  };
}

// -- Dry-run: Email/get for preview metadata ---------------------------------

async function fetchPreview(
  fetchImpl: typeof fetch,
  bearerToken: string,
  session: { apiUrl: string; primaryAccountIdMail: string },
  params: MailDeleteInput,
): Promise<MailDeletePreview> {
  const body = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/get',
        {
          accountId: session.primaryAccountIdMail,
          ids: params.emailIds,
          properties: ['id', 'subject', 'from'],
        },
        '0',
      ],
    ],
  });
  const response = await tryFetch(fetchImpl, session.apiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${bearerToken}`,
    },
    body,
  });
  requireOk(response, 'JMAP Email/get (mail.delete preview)');
  return parseEmailGetResponse(await response.text(), params.emailIds.length);
}

function parseEmailGetResponse(
  body: string,
  requestedCount: number,
): MailDeletePreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(
      `Email/get response could not be parsed: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Email/get response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown })
    .methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw new Error('Email/get response missing methodResponses.');
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'Email/get') {
    throw new Error('Email/get first methodResponse is not Email/get.');
  }
  const result = first[1] as {
    list?: ReadonlyArray<{
      id?: string;
      subject?: string;
      from?: ReadonlyArray<{ name?: string; email?: string }>;
    }>;
  };
  const list = result.list ?? [];
  const emails = list.map((entry) => ({
    id: entry.id ?? '',
    subject: entry.subject ?? '',
    from: formatFrom(entry.from),
  }));
  return {
    affectedCount: requestedCount,
    emails,
  };
}

function formatFrom(
  from: ReadonlyArray<{ name?: string; email?: string }> | undefined,
): string {
  if (from === undefined || from.length === 0) return '';
  const first = from[0];
  if (first === undefined) return '';
  const email = first.email ?? '';
  if (first.name !== undefined && first.name.length > 0) {
    return `${first.name} <${email}>`;
  }
  return email;
}

// -- Commit: soft-delete (Mailbox/query trash + Email/get memberships + Email/set update) ----

async function commitSoftDelete(
  fetchImpl: typeof fetch,
  bearerToken: string,
  session: { apiUrl: string; primaryAccountIdMail: string },
  params: MailDeleteInput,
): Promise<MailDeleteResult> {
  // Round 1: resolve Trash + current memberships in one POST.
  const trashAndMembershipsBody = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Mailbox/query',
        {
          accountId: session.primaryAccountIdMail,
          filter: { role: 'trash' },
        },
        '0',
      ],
      [
        'Email/get',
        {
          accountId: session.primaryAccountIdMail,
          ids: params.emailIds,
          properties: ['mailboxIds'],
        },
        '1',
      ],
    ],
  });
  const r1 = await tryFetch(fetchImpl, session.apiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${bearerToken}`,
    },
    body: trashAndMembershipsBody,
  });
  requireOk(r1, 'JMAP Mailbox/query + Email/get (mail.delete soft delete)');
  const { trashId, memberships } = parseTrashAndMemberships(await r1.text());

  // Round 2: Email/set update — each email gets the same patch
  // (`{trashId: true, ...sources: false}`) keyed by emailId.
  const patch = buildSoftDeletePatch(trashId, memberships);
  const update: Record<string, Record<string, Record<string, boolean>>> = {};
  for (const id of params.emailIds) {
    update[id] = { mailboxIds: patch };
  }
  const updateBody = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/set',
        { accountId: session.primaryAccountIdMail, update },
        '0',
      ],
    ],
  });
  const r2 = await tryFetch(fetchImpl, session.apiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${bearerToken}`,
    },
    body: updateBody,
  });
  requireOk(r2, 'JMAP Email/set update (mail.delete soft delete)');
  return parseEmailSetUpdateResponse(await r2.text());
}

function parseTrashAndMemberships(body: string): {
  trashId: string;
  memberships: ReadonlyMap<string, readonly string[]>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(`mail.delete round-1 response could not be parsed: ${describe(e)}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('mail.delete round-1 response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length < 2) {
    throw new Error('mail.delete round-1 response missing methodResponses.');
  }

  // Mailbox/query → trashId
  const mq = methodResponses.find(
    (mr) => Array.isArray(mr) && mr[0] === 'Mailbox/query',
  );
  const trashIds = (mq?.[1] as { ids?: ReadonlyArray<string> } | undefined)?.ids ?? [];
  if (trashIds.length === 0) {
    const err = new Error(
      'mail.delete (soft delete) requires a mailbox with role: trash; the account has none.',
    );
    (err as Error & { code?: string }).code = 'no_trash_mailbox';
    throw err;
  }
  const trashId = trashIds[0]!;

  // Email/get → memberships
  const eg = methodResponses.find(
    (mr) => Array.isArray(mr) && mr[0] === 'Email/get',
  );
  const list =
    (eg?.[1] as { list?: ReadonlyArray<{ id?: string; mailboxIds?: Record<string, boolean> }> } | undefined)
      ?.list ?? [];
  const memberships = new Map<string, readonly string[]>();
  for (const entry of list) {
    if (typeof entry.id !== 'string') continue;
    const ids = Object.entries(entry.mailboxIds ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    memberships.set(entry.id, ids);
  }
  return { trashId, memberships };
}

function buildSoftDeletePatch(
  trashId: string,
  memberships: ReadonlyMap<string, readonly string[]>,
): Record<string, boolean> {
  const patch: Record<string, boolean> = { [trashId]: true };
  for (const ids of memberships.values()) {
    for (const id of ids) {
      if (id !== trashId) patch[id] = false;
    }
  }
  return patch;
}

function parseEmailSetUpdateResponse(body: string): MailDeleteResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(`Email/set response could not be parsed: ${describe(e)}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Email/set response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw new Error('Email/set response missing methodResponses.');
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'Email/set') {
    throw new Error('Email/set first methodResponse is not Email/set.');
  }
  const result = first[1] as {
    updated?: Record<string, unknown>;
    notUpdated?: Record<string, { type?: string }>;
  };

  if (
    result.notUpdated !== undefined &&
    Object.keys(result.notUpdated).length > 0
  ) {
    const details = Object.entries(result.notUpdated)
      .map(([id, err]) => `${id}: ${err.type ?? 'unknown'}`)
      .join(', ');
    const err = new Error(`notUpdated: ${details}`);
    (err as Error & { code?: string }).code = 'jmap_set_error';
    throw err;
  }

  const updatedCount = Object.keys(result.updated ?? {}).length;
  // The output shape stays `deletedCount` (D-055): from the caller's
  // perspective the email IS gone from its previous mailbox view. The
  // restore-from-Trash path is a separate, deliberate action.
  return { deletedCount: updatedCount };
}

// -- Input validation --------------------------------------------------------

function parseInput(input: unknown): MailDeleteInput {
  if (input === null || typeof input !== 'object') {
    throw badInput('mail.delete input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (!Array.isArray(i.emailIds)) {
    throw badInput('mail.delete input.emailIds must be an array of strings');
  }
  if (i.emailIds.length === 0) {
    throw badInput('mail.delete input.emailIds must not be empty');
  }
  for (const id of i.emailIds) {
    if (typeof id !== 'string') {
      throw badInput('mail.delete input.emailIds must contain only strings');
    }
  }
  return { emailIds: i.emailIds as string[] };
}

// -- Shared utilities --------------------------------------------------------

function badInput(message: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = 'invalid_input';
  return err;
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
  if (e instanceof Error) return e.message;
  return String(e);
}
