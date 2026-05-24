/**
 * Handler for the `mail.send` capability (Phase 3a item 5).
 *
 * Mirrors the `mail.draft` pattern with the addition of an
 * `EmailSubmission/set` chained after the `Email/set` create.
 *
 *   - `dryRun: true`  → return a preview (recipients, subject,
 *                       bodyPreview, estimatedSize, identityId).
 *                       No JMAP call.
 *   - `dryRun: false` → POST chained `Email/set` + `EmailSubmission/set`.
 *                       Returns `{emailId, blobId, threadId, size,
 *                       submissionId, sendAt?}`.
 *
 * Follows the same handler factory pattern as `mail-draft.ts`.
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
  JmapConfigError as MailSendConfigError,
  loadSessionGetDeps as loadMailSendDeps,
};
export type MailSendDeps = JmapDeps;

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

const JMAP_USING_MAIL_SUBMISSION = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
  'urn:ietf:params:jmap:submission',
];

const BODY_PREVIEW_MAX = 256;

export function createMailSendHandler(deps: MailSendDeps): ToolHandler {
  return async (input, ctx) => {
    const params = parseInput(input);

    // Dry-run is local — no JMAP roundtrip. Return a preview that lets
    // agents inspect what *would* be sent without side effects.
    if (ctx.dryRun) {
      const envelope = buildRequestBody({
        accountId: 'preview-account',
        params,
      });
      const bodySource = params.bodyText ?? params.bodyHtml ?? '';
      const bodyPreview =
        bodySource.length > BODY_PREVIEW_MAX
          ? bodySource.slice(0, BODY_PREVIEW_MAX) + '…'
          : bodySource;
      return {
        recipients: {
          to: params.to,
          ...(params.cc !== undefined ? { cc: params.cc } : {}),
          ...(params.bcc !== undefined ? { bcc: params.bcc } : {}),
        },
        subject: params.subject,
        bodyPreview,
        estimatedSize: envelope.length,
        identityId: params.identityId,
      };
    }

    // Commit branch: resolve session, POST chained Email/set +
    // EmailSubmission/set.
    if (params.bodyText === undefined && params.bodyHtml === undefined) {
      throw badInput('mail.send requires at least one of bodyText or bodyHtml');
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
    requireOk(response, 'JMAP Email/set+EmailSubmission/set (mail.send)');
    return parseEmailSubmissionSetResponse(await response.text());
  };
}

function buildRequestBody(opts: {
  accountId: string;
  params: MailSendInput;
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

function parseEmailSubmissionSetResponse(body: string): MailSendResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    throw new Error(
      `Email/set+EmailSubmission/set response could not be parsed: ${describe(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Send response is not an object.');
  }
  const methodResponses = (parsed as { methodResponses?: unknown }).methodResponses;
  if (!Array.isArray(methodResponses) || methodResponses.length < 2) {
    throw new Error(
      'Send response needs at least two methodResponses (Email/set, EmailSubmission/set).',
    );
  }
  const emailResp = methodResponses[0] as unknown;
  const subResp = methodResponses[1] as unknown;
  if (!Array.isArray(emailResp) || emailResp[0] !== 'Email/set') {
    throw new Error('First methodResponse is not Email/set.');
  }
  if (!Array.isArray(subResp) || subResp[0] !== 'EmailSubmission/set') {
    throw new Error('Second methodResponse is not EmailSubmission/set.');
  }
  // Email/set first
  const emailResult = emailResp[1] as {
    created?: Record<string, unknown>;
    notCreated?: Record<string, { type?: string; description?: string }>;
  };
  if (emailResult.notCreated !== undefined) {
    const c0 = emailResult.notCreated['c0'];
    if (c0 !== undefined) {
      const err = new Error(
        `Email/set rejected: ${c0.type ?? 'unknown'}${c0.description !== undefined ? ` — ${c0.description}` : ''}`,
      );
      (err as Error & { code?: string }).code = 'jmap_set_error';
      throw err;
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
    throw new Error('Email/set created["c0"] missing required fields.');
  }
  // EmailSubmission/set second
  const subResult = subResp[1] as {
    created?: Record<string, unknown>;
    notCreated?: Record<string, { type?: string; description?: string }>;
  };
  if (subResult.notCreated !== undefined) {
    const s0 = subResult.notCreated['s0'];
    if (s0 !== undefined) {
      const err = new Error(
        `EmailSubmission/set rejected: ${s0.type ?? 'unknown'}${s0.description !== undefined ? ` — ${s0.description}` : ''}`,
      );
      (err as Error & { code?: string }).code = 'submission_rejected';
      throw err;
    }
  }
  const createdSub = subResult.created?.['s0'] as
    | { id?: string; sendAt?: string }
    | undefined;
  if (createdSub === undefined || typeof createdSub.id !== 'string') {
    throw new Error('EmailSubmission/set created["s0"] is missing required fields.');
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

function parseInput(input: unknown): MailSendInput {
  if (input === null || typeof input !== 'object') {
    throw badInput('mail.send input must be an object');
  }
  const i = input as Record<string, unknown>;
  if (typeof i.sentMailboxId !== 'string' || i.sentMailboxId.length === 0) {
    throw badInput('mail.send input.sentMailboxId must be a non-empty string');
  }
  if (typeof i.identityId !== 'string' || i.identityId.length === 0) {
    throw badInput('mail.send input.identityId must be a non-empty string');
  }
  if (!isEmailAddress(i.from)) {
    throw badInput('mail.send input.from must be an email-address object');
  }
  if (!isEmailAddressList(i.to)) {
    throw badInput('mail.send input.to must be an array of email-address objects');
  }
  if (typeof i.subject !== 'string') {
    throw badInput('mail.send input.subject must be a string');
  }
  const out: MailSendInput = {
    sentMailboxId: i.sentMailboxId,
    identityId: i.identityId,
    from: i.from as EmailAddress,
    to: i.to as EmailAddress[],
    subject: i.subject,
  };
  if (i.cc !== undefined) {
    if (!isEmailAddressList(i.cc)) throw badInput('mail.send input.cc invalid');
    Object.assign(out, { cc: i.cc as EmailAddress[] });
  }
  if (i.bcc !== undefined) {
    if (!isEmailAddressList(i.bcc)) throw badInput('mail.send input.bcc invalid');
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
  if (i.sendAt !== undefined) {
    if (typeof i.sendAt !== 'string') throw badInput('sendAt must be a string');
    Object.assign(out, { sendAt: i.sendAt });
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
