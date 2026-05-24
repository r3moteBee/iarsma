/**
 * Handler for the `mail.modify` capability (Phase 3a).
 *
 * Modifies existing emails by applying JMAP path-based patches to
 * mailbox membership and/or keyword flags via `Email/set` update.
 *
 *   - `dryRun: true`  → return a preview locally with affectedCount
 *                       and a changes array. No JMAP roundtrip.
 *   - `dryRun: false` → POST `Email/set` update with path-based
 *                       patches. Returns `{ modifiedCount }`.
 *
 * The JMAP path-based update syntax converts `mailboxIds: { inbox: false }`
 * into `"mailboxIds/inbox": false` so individual flags can be toggled
 * without replacing the entire map (RFC 8621 §5.3).
 */

import {
  session as jmapClientSession,
} from '@iarsma/wasm-bindings/jmap-client';
import type { ToolHandler } from '../invocation.js';
import {
  type SessionGetDeps as JmapDeps,
  loadSessionGetDeps,
  SessionGetConfigError as JmapConfigError,
} from './session-get.js';

export {
  JmapConfigError as MailModifyConfigError,
  loadSessionGetDeps as loadMailModifyDeps,
};
export type MailModifyDeps = JmapDeps;

export type MailModifyPatch = {
  readonly mailboxIds?: Readonly<Record<string, boolean>>;
  readonly keywords?: Readonly<Record<string, boolean>>;
};

export type MailModifyInput = {
  readonly emailIds: readonly string[];
  readonly patch: MailModifyPatch;
};

export type MailModifyResult = {
  readonly modifiedCount: number;
};

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

export function createMailModifyHandler(deps: MailModifyDeps): ToolHandler {
  return async (input, ctx) => {
    const token = ctx?.bearerToken ?? deps.bearerToken;
    const params = parseInput(input);

    // Dry-run is local — no JMAP roundtrip. Return a preview that
    // mirrors the shape an agent would inspect before committing.
    if (ctx.dryRun) {
      return {
        affectedCount: params.emailIds.length,
        changes: params.emailIds.map((id) => ({
          emailId: id,
          patchApplied: params.patch,
        })),
      };
    }

    // Commit branch: resolve session, POST Email/set update.
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
    const body = buildRequestBody({
      accountId: session.primaryAccountIdMail,
      params,
    });
    const response = await tryFetch(fetchImpl, session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body,
    });
    requireOk(response, 'JMAP Email/set (mail.modify)');
    return parseEmailSetUpdateResponse(await response.text());
  };
}

function buildRequestBody(opts: {
  accountId: string;
  params: MailModifyInput;
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

function parseEmailSetUpdateResponse(body: string): MailModifyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(
      `Email/set update response could not be parsed: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Email/set update response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw new Error('Email/set update response missing methodResponses.');
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'Email/set') {
    throw new Error('Email/set first methodResponse is not Email/set.');
  }
  const result = first[1] as {
    updated?: Record<string, unknown>;
    notUpdated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notUpdated !== undefined) {
    const entries = Object.entries(result.notUpdated);
    if (entries.length > 0) {
      const [id, err] = entries[0]!;
      const e = new Error(
        `Email/set update rejected for ${id}: ${err.type ?? 'unknown'}${err.description !== undefined ? ` — ${err.description}` : ''}`,
      );
      (e as Error & { code?: string }).code = 'jmap_set_error';
      throw e;
    }
  }
  const updated = result.updated ?? {};
  return { modifiedCount: Object.keys(updated).length };
}

function parseInput(input: unknown): MailModifyInput {
  if (input === null || typeof input !== 'object') {
    throw badInput('mail.modify input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (!Array.isArray(i.emailIds) || i.emailIds.length === 0) {
    throw badInput('mail.modify input.emailIds must be a non-empty array of strings');
  }
  for (const id of i.emailIds) {
    if (typeof id !== 'string') {
      throw badInput('mail.modify input.emailIds must contain only strings');
    }
  }
  if (i.patch === null || typeof i.patch !== 'object') {
    throw badInput('mail.modify input.patch must be an object');
  }
  const patch = i.patch as Record<string, unknown>;
  if (patch.mailboxIds === undefined && patch.keywords === undefined) {
    throw badInput(
      'mail.modify input.patch must contain at least one of mailboxIds or keywords',
    );
  }
  return {
    emailIds: i.emailIds as string[],
    patch: patch as MailModifyPatch,
  };
}

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
