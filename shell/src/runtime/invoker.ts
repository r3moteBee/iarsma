/**
 * The invoker — abstracts how a capability call actually reaches the server.
 *
 * Generated hooks ask `useInvoker()` for the current invoker (provided via
 * <IarsmaProvider>) and call `invoker.invoke(name, input)`. The runtime
 * doesn't care whether the underlying transport is MCP-over-HTTP, a direct
 * JMAP call, or a mock for testing — that's the invoker's job.
 *
 * Two production invokers ship with the runtime:
 *
 *   - `mcpInvoker(opts)` — POSTs to the configured MCP server endpoint.
 *     This is the default path during Phase 0/1 development.
 *
 *   - `jmapInvoker(opts)` — calls the JMAP client component directly,
 *     skipping MCP. Useful when the shell talks to JMAP without an
 *     intermediate MCP server. Stub for now; lands when the JMAP client
 *     component does (Phase 0 work item 5).
 *
 * Tests use a `mockInvoker(map)` that returns canned responses.
 */

import { createContext, useContext } from 'react';
import {
  buildMailDraftRequest,
  buildMailSendRequest,
  fetchAttachmentUpload,
  fetchCalendarList,
  fetchContactCreateCommit,
  fetchContactDeleteCommit,
  fetchContactGet,
  fetchContactList,
  fetchContactUpdateCommit,
  fetchEventCreateCommit,
  fetchEventDeleteCommit,
  fetchEmailMailboxMemberships,
  fetchEventGet,
  fetchEventList,
  fetchEventUpdateCommit,
  fetchIdentityList,
  fetchMailDeleteCommit,
  fetchMailDraftCommit,
  fetchMailModifyCommit,
  fetchMailSendCommit,
  fetchMailboxList,
  fetchSession,
  fetchThreadGet,
  fetchThreadList,
  fetchThreadSearch,
  resolveTrashMailboxId,
  type AttachmentUpload,
  type Calendar,
  type CalendarEvent,
  type Contact,
  type ContactCreateInput,
  type ContactCreateResult,
  type ContactDeleteResult,
  type ContactList,
  type ContactUpdateInput,
  type ContactUpdateResult,
  type EventCreateInput,
  type EventCreateResult,
  type EventDeleteResult,
  type EventList,
  type EventUpdateInput,
  type EventUpdateResult,
  type IdentityList,
  type JmapClientOptions,
  type Mailbox,
  type MailDeleteResult,
  type MailDraftInput,
  type MailDraftResult,
  type MailModifyInput,
  type MailModifyResult,
  type MailSendInput,
  type MailSendResult,
  type Session,
  type ThreadGet,
  type ThreadList,
} from './jmap-client.js';
import type { DryRunPreview, ToolError } from './types.js';

export type InvocationOptions = {
  /** True if the caller wants a dry-run preview, not a commit. */
  readonly dryRun?: boolean;
  /**
   * Hex SHA-384 of the canonicalized dry-run preview the user
   * approved (D-047, Phase 2 item 12). Forwarded to the action-log
   * `provenance.previewHashHex` on commit so the entry binds to
   * exactly the preview the user saw. Omit for non-destructive
   * tools or commits that didn't go through a preview gate.
   */
  readonly previewHashHex?: string;
};

export interface Invoker {
  /**
   * Call a capability by name. Returns the parsed output (or a dry-run
   * preview if `options.dryRun` is true). Throws ToolError on failure.
   */
  invoke<I, O>(
    name: string,
    input: I,
    options?: InvocationOptions,
  ): Promise<O | DryRunPreview<O>>;
  /**
   * Upload a binary blob (attachment, inline image) to the JMAP
   * server's blob endpoint. Separate from `invoke` because the JSON
   * channel can't carry binary bytes — RFC 8620 §6.1 defines a
   * dedicated upload URL on each session resource.
   *
   * Optional on the Invoker interface so test mocks can skip it
   * unless the test under exercise actually uploads. The JMAP
   * invoker always implements it; the MCP invoker will proxy through
   * to the server's upload endpoint when that lands.
   */
  uploadAttachment?(
    blob: Blob,
    options?: { readonly name?: string; readonly type?: string },
  ): Promise<AttachmentUpload>;
}

const InvokerContext = createContext<Invoker | null>(null);

export function useInvoker(): Invoker {
  const invoker = useContext(InvokerContext);
  if (invoker === null) {
    throw new Error(
      'No invoker found. Did you wrap your app in <IarsmaProvider invoker={...}>?',
    );
  }
  return invoker;
}

export const IarsmaProvider = InvokerContext.Provider;

// ──────────────────────────────────────────────────────────────────────────
// MCP invoker — POSTs to the MCP server's HTTP endpoint
// ──────────────────────────────────────────────────────────────────────────

export type McpInvokerOptions = {
  /** Base URL of the MCP server, e.g. 'https://sw-mail.example.net/mcp'. */
  readonly baseUrl: string;
  /** Returns the current Bearer token. Called on each invocation. */
  readonly getAuthToken: () => string | null;
};

export function mcpInvoker(opts: McpInvokerOptions): Invoker {
  return {
    async invoke<I, O>(
      name: string,
      input: I,
      options: InvocationOptions = {},
    ): Promise<O | DryRunPreview<O>> {
      const token = opts.getAuthToken();
      if (token === null) {
        throw makeToolError('unauthorized', 'No auth token available.');
      }
      const url = `${opts.baseUrl.replace(/\/$/, '')}/tools/${name}`;
      const headers: HeadersInit = {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      };
      if (options.dryRun) {
        headers['x-iarsma-dry-run'] = 'true';
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        let body: unknown = null;
        try {
          body = (await response.json()) as unknown;
        } catch {
          // ignore
        }
        if (body !== null && typeof body === 'object' && 'code' in body) {
          throw body as ToolError;
        }
        throw makeToolError(
          response.status === 401 ? 'unauthorized' : 'tool_error',
          `MCP tool call failed: ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as O | DryRunPreview<O>;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// JMAP invoker — calls the JMAP server directly via the jmap-client component.
// Used when the shell talks to JMAP without going through an MCP server.
// ──────────────────────────────────────────────────────────────────────────

export type JmapInvokerOptions = JmapClientOptions;

export function jmapInvoker(opts: JmapInvokerOptions): Invoker {
  // Per-invoker session cache. The first call to any capability fetches
  // /.well-known/jmap once; subsequent calls reuse the resolved session
  // for `apiUrl` + `primaryAccountIdMail`. The cache is per-invoker
  // instance, so signing out (which discards the invoker) clears it
  // naturally.
  let cachedSession: Session | null = null;
  async function getSession(): Promise<Session> {
    if (cachedSession === null) {
      cachedSession = await fetchSession(opts);
    }
    return cachedSession;
  }

  return {
    async invoke<I, O>(
      name: string,
      _input: I,
      _options: InvocationOptions = {},
    ): Promise<O | DryRunPreview<O>> {
      switch (name) {
        case 'session.get': {
          const session = await getSession();
          return session as unknown as O;
        }
        case 'mailbox.list': {
          const session = await getSession();
          const mailboxes: Mailbox[] = await fetchMailboxList({ ...opts, session });
          return mailboxes as unknown as O;
        }
        case 'thread.list': {
          const session = await getSession();
          // The contract input is `{mailboxId, position?, limit?}`. Cast
          // through `unknown` because the invoker's surface is typed
          // generically; the per-tool shape is enforced by the
          // capability contract + codegen at the call site.
          const params = _input as unknown as {
            mailboxId: string;
            position?: number;
            limit?: number;
          };
          const result: ThreadList = await fetchThreadList({
            ...opts,
            session,
            mailboxId: params.mailboxId,
            ...(params.position !== undefined ? { position: params.position } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
          });
          return result as unknown as O;
        }
        case 'thread.get': {
          const session = await getSession();
          const params = _input as unknown as { threadId: string };
          const result: ThreadGet = await fetchThreadGet({
            ...opts,
            session,
            threadId: params.threadId,
          });
          return result as unknown as O;
        }
        case 'thread.search': {
          const session = await getSession();
          const params = _input as unknown as {
            query: string;
            inMailboxId?: string;
            position?: number;
            limit?: number;
          };
          const result: ThreadList = await fetchThreadSearch({
            ...opts,
            session,
            query: params.query,
            ...(params.inMailboxId !== undefined
              ? { inMailboxId: params.inMailboxId }
              : {}),
            ...(params.position !== undefined ? { position: params.position } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
          });
          return result as unknown as O;
        }
        case 'identity.list': {
          const session = await getSession();
          const result: IdentityList = await fetchIdentityList({
            ...opts,
            session,
          });
          return result as unknown as O;
        }
        case 'mail.draft': {
          // Phase 2 work item 2. Destructive contract — dry-run returns
          // the proposed Email without touching JMAP; commit issues
          // Email/set create.
          const params = _input as unknown as MailDraftInput;
          if (_options.dryRun === true) {
            return makeMailDraftPreview(params) as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: MailDraftResult = await fetchMailDraftCommit({
            ...opts,
            session,
            params,
          });
          return result as unknown as O;
        }
        case 'mail.send': {
          // Phase 2 work item 3. Destructive contract — dry-run builds
          // the recipient + body preview locally; commit issues the
          // chained Email/set + EmailSubmission/set.
          const params = _input as unknown as MailSendInput;
          if (_options.dryRun === true) {
            return makeMailSendPreview(params) as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: MailSendResult = await fetchMailSendCommit({
            ...opts,
            session,
            params,
          });
          return result as unknown as O;
        }
        case 'mail.modify': {
          const params = _input as unknown as MailModifyInput;
          if (_options.dryRun === true) {
            return makeMailModifyPreview(params) as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: MailModifyResult = await fetchMailModifyCommit({
            ...opts,
            session,
            params,
          });
          return result as unknown as O;
        }
        case 'mail.delete': {
          // PR 19 — soft delete. mail.delete no longer issues Email/set
          // destroy. It resolves the Trash mailbox, reads each email's
          // current memberships, then issues Email/set update that adds
          // Trash and removes the union of source mailboxes. The
          // inverse — what the UndoRegistry (PR 21+) will record — is
          // exactly the reverse patch.
          //
          // Destructive contract preserved: dry-run still returns
          // `{affectedCount, emails: []}` so existing dry-run gates
          // through the MCP / preview surface don't change shape.
          const params = _input as unknown as { emailIds: string[] };
          if (_options.dryRun === true) {
            return {
              affectedCount: params.emailIds.length,
              emails: [],
            } as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const trashId = await resolveTrashMailboxId({ ...opts, session });
          const memberships = await fetchEmailMailboxMemberships({
            ...opts,
            session,
            emailIds: params.emailIds,
          });
          const result: MailModifyResult = await fetchMailModifyCommit({
            ...opts,
            session,
            params: {
              emailIds: params.emailIds,
              patch: { mailboxIds: buildSoftDeletePatch(trashId, memberships) },
            },
          });
          // PR 22 — enrich the return shape with the pre-move
          // memberships + the resolved trash id so the loggingInvoker
          // (buildInverse) can construct a restore-mailboxes inverse
          // without re-fetching anything. The base MailModifyResult
          // type doesn't know about these extras — callers that
          // care about modifiedCount continue to read it; everyone
          // else ignores the extras.
          const previousMailboxesByEmail: Record<string, readonly string[]> = {};
          for (const [emailId, mailboxes] of memberships) {
            previousMailboxesByEmail[emailId] = mailboxes;
          }
          return {
            ...result,
            previousMailboxesByEmail,
            trashMailboxId: trashId,
          } as unknown as O;
        }
        case 'mail.purge': {
          // PR 19 — the hard JMAP Email/set destroy. UI-only; the MCP
          // server doesn't expose mail.purge, and the agent-token scope
          // vocabulary doesn't grant it. Agents calling mail.delete get
          // the safer soft-delete path above.
          const params = _input as unknown as { emailIds: string[] };
          if (_options.dryRun === true) {
            return {
              affectedCount: params.emailIds.length,
              emails: [],
            } as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: MailDeleteResult = await fetchMailDeleteCommit({
            ...opts,
            session,
            emailIds: params.emailIds,
          });
          return result as unknown as O;
        }
        case 'calendar.list': {
          const session = await getSession();
          const calendars: Calendar[] = await fetchCalendarList({ ...opts, session });
          return calendars as unknown as O;
        }
        case 'event.list': {
          const session = await getSession();
          const evParams = _input as unknown as {
            calendarId?: string;
            after: string;
            before: string;
            position?: number;
            limit?: number;
          };
          const evResult: EventList = await fetchEventList({
            ...opts,
            session,
            after: evParams.after,
            before: evParams.before,
            ...(evParams.calendarId !== undefined ? { calendarId: evParams.calendarId } : {}),
            ...(evParams.position !== undefined ? { position: evParams.position } : {}),
            ...(evParams.limit !== undefined ? { limit: evParams.limit } : {}),
          });
          return evResult as unknown as O;
        }
        case 'event.get': {
          const session = await getSession();
          const egParams = _input as unknown as { eventId: string };
          const event: CalendarEvent = await fetchEventGet({
            ...opts,
            session,
            eventId: egParams.eventId,
          });
          return event as unknown as O;
        }
        case 'contact.list': {
          const session = await getSession();
          const clParams = _input as unknown as { query?: string };
          const result: ContactList = await fetchContactList({
            ...opts,
            session,
            ...(clParams.query !== undefined ? { query: clParams.query } : {}),
          });
          return result as unknown as O;
        }
        case 'contact.get': {
          const session = await getSession();
          const cgParams = _input as unknown as { contactId: string };
          const contact: Contact = await fetchContactGet({
            ...opts,
            session,
            contactId: cgParams.contactId,
          });
          return contact as unknown as O;
        }
        case 'event.create': {
          const params = _input as unknown as EventCreateInput;
          if (_options.dryRun === true) {
            return {
              calendarId: params.calendarId,
              title: params.title,
              start: params.start,
              ...(params.duration !== undefined ? { duration: params.duration } : {}),
              ...(params.timeZone !== undefined ? { timeZone: params.timeZone } : {}),
              ...(params.description !== undefined ? { description: params.description } : {}),
              ...(params.location !== undefined ? { location: params.location } : {}),
            } as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: EventCreateResult = await fetchEventCreateCommit({
            ...opts,
            session,
            params,
          });
          return result as unknown as O;
        }
        case 'event.update': {
          const params = _input as unknown as EventUpdateInput;
          if (_options.dryRun === true) {
            return {
              eventId: params.eventId,
              ...(params.title !== undefined ? { title: params.title } : {}),
              ...(params.start !== undefined ? { start: params.start } : {}),
              ...(params.duration !== undefined ? { duration: params.duration } : {}),
              ...(params.description !== undefined ? { description: params.description } : {}),
              ...(params.location !== undefined ? { location: params.location } : {}),
            } as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: EventUpdateResult = await fetchEventUpdateCommit({
            ...opts,
            session,
            params,
          });
          return result as unknown as O;
        }
        case 'event.delete': {
          const params = _input as unknown as { eventId: string };
          if (_options.dryRun === true) {
            return { eventId: params.eventId } as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: EventDeleteResult = await fetchEventDeleteCommit({
            ...opts,
            session,
            eventId: params.eventId,
          });
          return result as unknown as O;
        }
        case 'contact.create': {
          const params = _input as unknown as ContactCreateInput;
          if (_options.dryRun === true) {
            return {
              name: params.name,
              ...(params.addressBookId !== undefined ? { addressBookId: params.addressBookId } : {}),
              ...(params.emails !== undefined ? { emails: params.emails } : {}),
              ...(params.phones !== undefined ? { phones: params.phones } : {}),
              ...(params.organizations !== undefined ? { organizations: params.organizations } : {}),
            } as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: ContactCreateResult = await fetchContactCreateCommit({
            ...opts,
            session,
            params,
          });
          return result as unknown as O;
        }
        case 'contact.update': {
          const params = _input as unknown as ContactUpdateInput;
          if (_options.dryRun === true) {
            return {
              contactId: params.contactId,
              ...(params.name !== undefined ? { name: params.name } : {}),
              ...(params.emails !== undefined ? { emails: params.emails } : {}),
              ...(params.phones !== undefined ? { phones: params.phones } : {}),
            } as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: ContactUpdateResult = await fetchContactUpdateCommit({
            ...opts,
            session,
            params,
          });
          return result as unknown as O;
        }
        case 'contact.delete': {
          const params = _input as unknown as { contactId: string };
          if (_options.dryRun === true) {
            return { contactId: params.contactId } as unknown as O | DryRunPreview<O>;
          }
          const session = await getSession();
          const result: ContactDeleteResult = await fetchContactDeleteCommit({
            ...opts,
            session,
            contactId: params.contactId,
          });
          return result as unknown as O;
        }
        default:
          throw makeToolError(
            'tool_not_found',
            `jmapInvoker has no handler for '${name}'.`,
          );
      }
    },
    async uploadAttachment(blob, uploadOpts = {}) {
      const session = await getSession();
      return fetchAttachmentUpload({
        ...opts,
        session,
        blob,
        ...(uploadOpts.type !== undefined ? { type: uploadOpts.type } : {}),
      });
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Mock invoker — for tests
// ──────────────────────────────────────────────────────────────────────────

export type MockInvokerHandler = (
  input: unknown,
  dryRun: boolean,
  options?: InvocationOptions,
) => unknown | Promise<unknown>;

export type MockInvokerUploadHandler = (
  blob: Blob,
  options: { readonly name?: string; readonly type?: string },
) => AttachmentUpload | Promise<AttachmentUpload>;

export type MockInvokerOptions = {
  /** Optional `uploadAttachment` handler. Tests that don't exercise
   *  uploads can omit it; calls fall through to a not_implemented
   *  error so test forgetfulness fails loud. */
  readonly uploadAttachment?: MockInvokerUploadHandler;
};

export function mockInvoker(
  handlers: Record<string, MockInvokerHandler>,
  options: MockInvokerOptions = {},
): Invoker {
  return {
    async invoke(name, input, invokeOpts = {}) {
      const handler = handlers[name];
      if (handler === undefined) {
        throw makeToolError('tool_not_found', `mockInvoker has no handler for '${name}'.`);
      }
      const result = await handler(input, invokeOpts.dryRun ?? false, invokeOpts);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result as any;
    },
    ...(options.uploadAttachment !== undefined
      ? {
          uploadAttachment: async (blob, uploadOpts = {}) =>
            options.uploadAttachment!(blob, uploadOpts),
        }
      : {}),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeToolError(code: string, message: string): ToolError {
  return { code, message };
}

/**
 * Build the dry-run preview for `mail.draft` locally (no JMAP call).
 * D-046 wraps destructive outputs in `DryRunPreview<O>` — but here we
 * return the *natural* preview shape from the contract; the
 * `cachedInvoker` + `loggingInvoker` wrappers (D-051, D-052) treat it
 * as the canonical preview value, and the call site uses the
 * generated `MailDraftPreview` type.
 *
 * `estimatedSize` is intentionally rough: it's the JSON-stringified
 * envelope length, which is close enough to RFC 822 wire size for
 * "give the user a sense of message size" without round-tripping the
 * server.
 */
function makeMailDraftPreview(params: MailDraftInput): {
  proposedEmail: {
    mailboxId: string;
    keywords: string[];
    from: ReadonlyArray<{ name?: string; email: string }>;
    to: ReadonlyArray<{ name?: string; email: string }>;
    cc?: ReadonlyArray<{ name?: string; email: string }>;
    bcc?: ReadonlyArray<{ name?: string; email: string }>;
    subject: string;
    hasBodyText: boolean;
    hasBodyHtml: boolean;
    bodyTextSize: number;
    bodyHtmlSize: number;
    inReplyTo?: string;
    references?: string;
    attachmentCount: number;
    attachmentBlobIds: string[];
  };
  estimatedSize: number;
} {
  const bodyTextSize = params.bodyText?.length ?? 0;
  const bodyHtmlSize = params.bodyHtml?.length ?? 0;
  const attachments = params.attachments ?? [];
  const envelope = buildMailDraftRequest({
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
      bodyTextSize,
      bodyHtmlSize,
      ...(params.inReplyTo !== undefined ? { inReplyTo: params.inReplyTo } : {}),
      ...(params.references !== undefined ? { references: params.references } : {}),
      attachmentCount: attachments.length,
      attachmentBlobIds: attachments.map((a) => a.blobId),
    },
    estimatedSize: envelope.length,
  };
}

/**
 * Build the dry-run preview for `mail.send` locally. Recipients flatten
 * to a single SMTP envelope list (to + cc + bcc) so the UI can warn the
 * user that a bcc'd recipient is silently included.
 *
 * `bodyPreview` strips HTML tags as a last resort when only `bodyHtml`
 * is present — good enough for a confirmation snippet; not exposed to
 * any rendering surface. Real preview rendering happens via the
 * already-sanitized `bodyHtml`.
 */
function makeMailSendPreview(params: MailSendInput): {
  recipients: {
    to: ReadonlyArray<{ name?: string; email: string }>;
    cc?: ReadonlyArray<{ name?: string; email: string }>;
    bcc?: ReadonlyArray<{ name?: string; email: string }>;
    envelopeRcptTo: string[];
  };
  subject: string;
  bodyPreview: string;
  hasBodyText: boolean;
  hasBodyHtml: boolean;
  attachmentCount: number;
  attachmentBlobIds: string[];
  estimatedSendTime: string;
  estimatedSize: number;
  identityId: string;
} {
  const envelopeRcptTo = [
    ...params.to.map((a) => a.email),
    ...(params.cc ?? []).map((a) => a.email),
    ...(params.bcc ?? []).map((a) => a.email),
  ];
  const preview = previewSnippet(params.bodyText, params.bodyHtml);
  const envelope = buildMailSendRequest({
    accountId: 'preview-account',
    params,
  });
  return {
    recipients: {
      to: params.to,
      ...(params.cc !== undefined ? { cc: params.cc } : {}),
      ...(params.bcc !== undefined ? { bcc: params.bcc } : {}),
      envelopeRcptTo,
    },
    subject: params.subject,
    bodyPreview: preview,
    hasBodyText: params.bodyText !== undefined,
    hasBodyHtml: params.bodyHtml !== undefined,
    attachmentCount: params.attachments?.length ?? 0,
    attachmentBlobIds: (params.attachments ?? []).map((a) => a.blobId),
    estimatedSendTime: params.sendAt ?? new Date().toISOString(),
    estimatedSize: envelope.length,
    identityId: params.identityId,
  };
}

/**
 * Build the dry-run preview for `mail.modify` locally (no JMAP call).
 * Returns the affected email count and the patch that would be applied.
 * Since modify is a bulk operation, the preview surfaces the number of
 * affected emails and the per-email patch for confirmation.
 */
function makeMailModifyPreview(params: MailModifyInput): {
  affectedCount: number;
  changes: ReadonlyArray<{
    emailId: string;
    patchApplied: MailModifyInput['patch'];
  }>;
} {
  return {
    affectedCount: params.emailIds.length,
    changes: params.emailIds.map((id) => ({
      emailId: id,
      patchApplied: params.patch,
    })),
  };
}

/**
 * PR 19 — soft delete patch. Combines per-email memberships into a
 * single `mailboxIds` patch that moves every selected email into
 * Trash and out of the union of source mailboxes.
 *
 * Limitation: when callers delete a heterogeneous batch (e.g., one
 * email from Inbox and another from Archive), the combined patch
 * removes the email from *both* mailboxes — the Archive email
 * effectively loses its Archive membership too. The common case
 * (delete N from one mailbox) is unaffected. Heterogeneous batches
 * are a v2 refinement.
 */
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

function previewSnippet(text: string | undefined, html: string | undefined): string {
  if (text !== undefined && text.length > 0) {
    return text.slice(0, 200);
  }
  if (html !== undefined && html.length > 0) {
    // Strip tags + collapse whitespace. This is a confirmation snippet,
    // not a rendering surface — the html that ships down the wire is
    // already sanitized by the composer pipeline.
    const stripped = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, 200);
  }
  return '';
}
