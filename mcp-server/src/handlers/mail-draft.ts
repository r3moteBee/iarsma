/**
 * Handler for the `mail.draft` capability (Phase 2 work item 2 + 10).
 *
 * First destructive contract exposed over MCP. The dispatcher passes
 * `ctx.dryRun` based on the call envelope; we branch:
 *
 *   - `dryRun: true`  → return the proposed Email locally. No JMAP
 *                       call. Matches the shell-side preview.
 *   - `dryRun: false` → POST `Email/set` create with the `\$draft`
 *                       keyword. Returns `{emailId, blobId, threadId,
 *                       size}` from the server.
 *
 * The MCP dispatcher already wraps the response in the appropriate
 * envelope (`{kind: 'preview', preview}` vs `{kind: 'ok', output}`).
 *
 * Phase 3 will add scope enforcement (per-agent `mail:draft` scope
 * gating); for now, every authenticated MCP caller can invoke this.
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
  JmapConfigError as MailDraftConfigError,
  loadSessionGetDeps as loadMailDraftDeps,
};
export type MailDraftDeps = JmapDeps;

type EmailAddress = {
  readonly name?: string;
  readonly email: string;
};

type AttachmentRef = {
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

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

export function createMailDraftHandler(deps: MailDraftDeps): ToolHandler {
  return async (input, ctx) => {
    const params = parseInput(input);

    // Dry-run is local — no JMAP roundtrip. Mirror the shell-side
    // `makeMailDraftPreview` shape so agents see the same fields they
    // would in the UI.
    if (ctx.dryRun) {
      const attachments = params.attachments ?? [];
      const envelope = buildRequestBody({
        accountId: 'preview-account',
        params,
      });
      return {
        proposedEmail: {
          mailboxId: params.mailboxId,
          keywords: ['$draft'],
          from: [params.from],
          to: params.to,
          ...(params.cc !== undefined ? { cc: params.cc } : {}),
          ...(params.bcc !== undefined ? { bcc: params.bcc } : {}),
          subject: params.subject,
          hasBodyText: params.bodyText !== undefined,
          hasBodyHtml: params.bodyHtml !== undefined,
          bodyTextSize: params.bodyText?.length ?? 0,
          bodyHtmlSize: params.bodyHtml?.length ?? 0,
          ...(params.inReplyTo !== undefined ? { inReplyTo: params.inReplyTo } : {}),
          ...(params.references !== undefined ? { references: params.references } : {}),
          attachmentCount: attachments.length,
          attachmentBlobIds: attachments.map((a) => a.blobId),
        },
        estimatedSize: envelope.length,
      };
    }

    // Commit branch: resolve session, POST Email/set create.
    if (params.bodyText === undefined && params.bodyHtml === undefined) {
      throw badInput('mail.draft requires at least one of bodyText or bodyHtml');
    }
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
    const body = buildRequestBody({
      accountId: session.primaryAccountIdMail,
      params,
    });
    const response = await tryFetch(fetchImpl, session.apiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${deps.bearerToken}`,
      },
      body,
    });
    requireOk(response, 'JMAP Email/set (mail.draft)');
    return parseEmailSetResponse(await response.text());
  };
}

function buildRequestBody(opts: {
  accountId: string;
  params: MailDraftInput;
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
    mailboxIds: { [params.mailboxId]: true },
    keywords: { $draft: true },
    from:
      params.from.name !== undefined
        ? [params.from]
        : [{ email: params.from.email }],
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
    email.references = params.references
      .split(/\s+/)
      .filter((s) => s.length > 0);
  }
  if (params.attachments !== undefined && params.attachments.length > 0) {
    email.attachments = params.attachments.map((a) => ({
      blobId: a.blobId,
      type: a.type,
      name: a.name,
      size: a.size,
      ...(a.disposition !== undefined ? { disposition: a.disposition } : {}),
      ...(a.cid !== undefined ? { cid: a.cid } : {}),
    }));
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

function parseEmailSetResponse(body: string): MailDraftResult {
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
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length === 0) {
    throw new Error('Email/set response missing methodResponses.');
  }
  const first = methodResponses[0];
  if (!Array.isArray(first) || first[0] !== 'Email/set') {
    throw new Error('Email/set first methodResponse is not Email/set.');
  }
  const result = first[1] as {
    created?: Record<string, unknown>;
    notCreated?: Record<string, { type?: string; description?: string }>;
  };
  if (result.notCreated !== undefined) {
    const c0 = result.notCreated['c0'];
    if (c0 !== undefined) {
      const err = new Error(
        `Email/set rejected: ${c0.type ?? 'unknown'}${c0.description !== undefined ? ` — ${c0.description}` : ''}`,
      );
      (err as Error & { code?: string }).code = 'jmap_set_error';
      throw err;
    }
  }
  const created = result.created?.['c0'] as
    | { id?: string; blobId?: string; threadId?: string; size?: number | bigint }
    | undefined;
  if (
    created === undefined ||
    typeof created.id !== 'string' ||
    typeof created.blobId !== 'string' ||
    typeof created.threadId !== 'string'
  ) {
    throw new Error('Email/set created["c0"] missing required fields.');
  }
  return {
    emailId: created.id,
    blobId: created.blobId,
    threadId: created.threadId,
    size: Number(created.size ?? 0),
  };
}

function parseInput(input: unknown): MailDraftInput {
  if (input === null || typeof input !== 'object') {
    throw badInput('mail.draft input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (typeof i.mailboxId !== 'string' || i.mailboxId.length === 0) {
    throw badInput('mail.draft input.mailboxId must be a non-empty string');
  }
  if (!isEmailAddress(i.from)) {
    throw badInput('mail.draft input.from must be an email-address object');
  }
  if (!isEmailAddressList(i.to)) {
    throw badInput('mail.draft input.to must be an array of email-address objects');
  }
  if (typeof i.subject !== 'string') {
    throw badInput('mail.draft input.subject must be a string');
  }
  const out: MailDraftInput = {
    mailboxId: i.mailboxId,
    from: i.from as EmailAddress,
    to: i.to as EmailAddress[],
    subject: i.subject,
  };
  if (i.cc !== undefined) {
    if (!isEmailAddressList(i.cc)) throw badInput('mail.draft input.cc invalid');
    Object.assign(out, { cc: i.cc as EmailAddress[] });
  }
  if (i.bcc !== undefined) {
    if (!isEmailAddressList(i.bcc)) throw badInput('mail.draft input.bcc invalid');
    Object.assign(out, { bcc: i.bcc as EmailAddress[] });
  }
  if (i.bodyText !== undefined) {
    if (typeof i.bodyText !== 'string') throw badInput('bodyText must be a string');
    Object.assign(out, { bodyText: i.bodyText });
  }
  if (i.bodyHtml !== undefined) {
    if (typeof i.bodyHtml !== 'string') throw badInput('bodyHtml must be a string');
    Object.assign(out, { bodyHtml: i.bodyHtml });
  }
  if (i.inReplyTo !== undefined) {
    if (typeof i.inReplyTo !== 'string') throw badInput('inReplyTo must be a string');
    Object.assign(out, { inReplyTo: i.inReplyTo });
  }
  if (i.references !== undefined) {
    if (typeof i.references !== 'string') throw badInput('references must be a string');
    Object.assign(out, { references: i.references });
  }
  if (i.attachments !== undefined) {
    if (!Array.isArray(i.attachments)) throw badInput('attachments must be an array');
    Object.assign(out, { attachments: i.attachments as AttachmentRef[] });
  }
  return out;
}

function isEmailAddress(v: unknown): v is EmailAddress {
  if (v === null || typeof v !== 'object') return false;
  const o = v as { email?: unknown; name?: unknown };
  return (
    typeof o.email === 'string' &&
    (o.name === undefined || typeof o.name === 'string')
  );
}

function isEmailAddressList(v: unknown): v is EmailAddress[] {
  return Array.isArray(v) && v.every(isEmailAddress);
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
