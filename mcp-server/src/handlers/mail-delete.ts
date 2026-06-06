/**
 * Handler for the `mail.delete` capability (Phase 3a).
 *
 * Destructive contract exposed over MCP. The dispatcher passes
 * `ctx.dryRun` based on the call envelope; we branch:
 *
 *   - `dryRun: true`  → fetch session → Email/get for the emailIds
 *                       to get subject + from for preview → return
 *                       `{affectedCount, emails: [{id, subject, from}]}`.
 *   - `dryRun: false` → fetch session → POST `Email/set` with
 *                       `destroy: emailIds` → return `{deletedCount}`.
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

    return commitDestroy(fetchImpl, token, session, params);
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

// -- Commit: Email/set destroy -----------------------------------------------

async function commitDestroy(
  fetchImpl: typeof fetch,
  bearerToken: string,
  session: { apiUrl: string; primaryAccountIdMail: string },
  params: MailDeleteInput,
): Promise<MailDeleteResult> {
  const body = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/set',
        {
          accountId: session.primaryAccountIdMail,
          destroy: params.emailIds,
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
  requireOk(response, 'JMAP Email/set (mail.delete)');
  return parseEmailSetDestroyResponse(await response.text());
}

function parseEmailSetDestroyResponse(body: string): MailDeleteResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(
      `Email/set response could not be parsed: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Email/set response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown })
    .methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw new Error('Email/set response missing methodResponses.');
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'Email/set') {
    throw new Error('Email/set first methodResponse is not Email/set.');
  }
  const result = first[1] as {
    destroyed?: ReadonlyArray<string>;
    notDestroyed?: Record<string, { type?: string }>;
  };

  // If any emails were not destroyed, surface as an error.
  if (
    result.notDestroyed !== undefined &&
    Object.keys(result.notDestroyed).length > 0
  ) {
    const details = Object.entries(result.notDestroyed)
      .map(([id, err]) => `${id}: ${err.type ?? 'unknown'}`)
      .join(', ');
    const err = new Error(`notDestroyed: ${details}`);
    (err as Error & { code?: string }).code = 'jmap_set_error';
    throw err;
  }

  const destroyed = result.destroyed ?? [];
  return { deletedCount: destroyed.length };
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
