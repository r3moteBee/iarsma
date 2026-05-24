/**
 * Approval Store — JMAP-mailbox-backed store for approval requests.
 *
 * When an agent's action requires human approval, the request is stored
 * as an email in a dedicated "Approvals" mailbox. The user sees it in the
 * Approvals UI and can approve/deny.
 *
 * Two implementations:
 *   - `inMemoryApprovalStore()` — Map-backed, no JMAP. Used in unit tests.
 *   - `jmapApprovalStore(opts)` — JMAP-backed, uses Email/set + Email/query.
 */

import { fetchSession, type JmapClientOptions, type Session } from './jmap-client.js';
import type { ToolError } from './types.js';

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

export type ApprovalRequest = {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly toolName: string;
  readonly requestingAgentId: string;
  readonly requestingAgentName: string;
  readonly params: unknown;
  readonly preview: unknown;
  readonly previewHashHex: string;
  readonly requestedAt: string;
  readonly status: 'pending' | 'approved' | 'denied';
};

export type CreateApprovalInput = Omit<ApprovalRequest, 'id' | 'status'>;

export interface ApprovalStore {
  ensureMailbox(): Promise<string>;
  create(input: CreateApprovalInput): Promise<string>;
  list(filter?: { status?: 'pending' | 'approved' | 'denied' }): Promise<readonly ApprovalRequest[]>;
  get(approvalId: string): Promise<ApprovalRequest | null>;
  approve(approvalId: string): Promise<void>;
  deny(approvalId: string): Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────
// In-memory implementation (tests)
// ──────────────────────────────────────────────────────────────────────

export function inMemoryApprovalStore(): ApprovalStore {
  const items = new Map<string, ApprovalRequest>();
  const mailboxId = 'in-memory-approvals-mailbox';
  let nextId = 1;

  return {
    async ensureMailbox(): Promise<string> {
      return mailboxId;
    },

    async create(input: CreateApprovalInput): Promise<string> {
      const id = `approval-${nextId++}`;
      const request: ApprovalRequest = {
        id,
        schemaVersion: input.schemaVersion,
        toolName: input.toolName,
        requestingAgentId: input.requestingAgentId,
        requestingAgentName: input.requestingAgentName,
        params: input.params,
        preview: input.preview,
        previewHashHex: input.previewHashHex,
        requestedAt: input.requestedAt,
        status: 'pending',
      };
      items.set(id, request);
      return id;
    },

    async list(filter?: { status?: 'pending' | 'approved' | 'denied' }): Promise<readonly ApprovalRequest[]> {
      const all = Array.from(items.values());
      if (filter?.status !== undefined) {
        return all.filter((r) => r.status === filter.status);
      }
      return all;
    },

    async get(approvalId: string): Promise<ApprovalRequest | null> {
      return items.get(approvalId) ?? null;
    },

    async approve(approvalId: string): Promise<void> {
      const existing = items.get(approvalId);
      if (existing === undefined) {
        throw makeError('not_found', `Approval ${approvalId} not found.`);
      }
      items.set(approvalId, { ...existing, status: 'approved' });
    },

    async deny(approvalId: string): Promise<void> {
      const existing = items.get(approvalId);
      if (existing === undefined) {
        throw makeError('not_found', `Approval ${approvalId} not found.`);
      }
      items.set(approvalId, { ...existing, status: 'denied' });
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// JMAP implementation
// ──────────────────────────────────────────────────────────────────────

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

const APPROVAL_MAILBOX_NAME = 'Approvals';

/** Keyword → status mapping for JMAP email keywords. */
const KEYWORD_PENDING = '$approval_pending';
const KEYWORD_APPROVED = '$approval_approved';
const KEYWORD_DENIED = '$approval_denied';

/** Derive a short subject line from the approval input. */
function summarize(input: CreateApprovalInput): string {
  const agent = input.requestingAgentName || input.requestingAgentId;
  return `${agent} @ ${input.requestedAt}`;
}

/** Map a JMAP keywords object to an approval status. */
function keywordsToStatus(
  keywords: Record<string, boolean>,
): 'pending' | 'approved' | 'denied' {
  if (keywords[KEYWORD_APPROVED] === true) return 'approved';
  if (keywords[KEYWORD_DENIED] === true) return 'denied';
  return 'pending';
}

/** Map a status to the JMAP keyword filter condition. */
function statusToKeywordFilter(
  status: 'pending' | 'approved' | 'denied',
): Record<string, unknown> {
  switch (status) {
    case 'pending':
      return { hasKeyword: KEYWORD_PENDING };
    case 'approved':
      return { hasKeyword: KEYWORD_APPROVED };
    case 'denied':
      return { hasKeyword: KEYWORD_DENIED };
  }
}

export type JmapApprovalStoreOptions = {
  readonly baseUrl: string;
  readonly getAuthToken: () => string | null;
  readonly fetch?: typeof fetch;
};

export function jmapApprovalStore(opts: JmapApprovalStoreOptions): ApprovalStore {
  const clientOpts: JmapClientOptions = {
    baseUrl: opts.baseUrl,
    getAuthToken: opts.getAuthToken,
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  };
  const fetchImpl = opts.fetch ?? fetch;

  let cachedSession: Session | null = null;
  let cachedMailboxId: string | null = null;

  async function getSession(): Promise<Session> {
    if (cachedSession !== null) return cachedSession;
    cachedSession = await fetchSession(clientOpts);
    return cachedSession;
  }

  async function jmapPost(session: Session, body: string): Promise<unknown> {
    const token = opts.getAuthToken();
    if (token === null) {
      throw makeError('unauthorized', 'No auth token available.');
    }
    let response: Response;
    try {
      response = await fetchImpl(session.apiUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body,
      });
    } catch (e) {
      throw makeError('network_error', `JMAP fetch failed: ${describe(e)}`);
    }
    if (!response.ok) {
      throw makeError(
        response.status === 401 ? 'unauthorized' : 'jmap_http_error',
        `JMAP returned ${response.status} ${response.statusText}`,
      );
    }
    return response.json();
  }

  return {
    async ensureMailbox(): Promise<string> {
      if (cachedMailboxId !== null) return cachedMailboxId;

      const session = await getSession();
      const accountId = session.primaryAccountIdMail;

      // Step 1: Query for existing "Approvals" mailbox.
      const queryBody = JSON.stringify({
        using: JMAP_USING_MAIL,
        methodCalls: [
          [
            'Mailbox/query',
            {
              accountId,
              filter: { name: APPROVAL_MAILBOX_NAME },
            },
            '0',
          ],
        ],
      });
      const queryResult = await jmapPost(session, queryBody) as {
        methodResponses: Array<[string, { ids?: string[] }, string]>;
      };
      const queryResp = queryResult.methodResponses[0];
      if (queryResp !== undefined && queryResp[0] === 'Mailbox/query') {
        const ids = queryResp[1].ids;
        if (ids !== undefined && ids.length > 0) {
          cachedMailboxId = ids[0]!;
          return cachedMailboxId;
        }
      }

      // Step 2: Not found — create the mailbox.
      const createBody = JSON.stringify({
        using: JMAP_USING_MAIL,
        methodCalls: [
          [
            'Mailbox/set',
            {
              accountId,
              create: {
                m0: { name: APPROVAL_MAILBOX_NAME },
              },
            },
            '0',
          ],
        ],
      });
      const createResult = await jmapPost(session, createBody) as {
        methodResponses: Array<[string, {
          created?: Record<string, { id?: string }>;
          notCreated?: Record<string, { type?: string; description?: string }>;
        }, string]>;
      };
      const createResp = createResult.methodResponses[0];
      if (createResp === undefined || createResp[0] !== 'Mailbox/set') {
        throw makeError('jmap_parse_error', 'Unexpected Mailbox/set response.');
      }
      const created = createResp[1].created?.['m0'];
      if (created === undefined || typeof created.id !== 'string') {
        const notCreated = createResp[1].notCreated?.['m0'];
        throw makeError(
          'jmap_set_error',
          `Mailbox/set rejected: ${notCreated?.type ?? 'unknown'}${notCreated?.description !== undefined ? ` — ${notCreated.description}` : ''}`,
        );
      }
      cachedMailboxId = created.id;
      return cachedMailboxId;
    },

    async create(input: CreateApprovalInput): Promise<string> {
      const session = await getSession();
      const accountId = session.primaryAccountIdMail;
      const mailboxId = await this.ensureMailbox();

      const body = JSON.stringify({
        using: JMAP_USING_MAIL,
        methodCalls: [
          [
            'Email/set',
            {
              accountId,
              create: {
                c0: {
                  mailboxIds: { [mailboxId]: true },
                  from: [{ name: input.requestingAgentName, email: 'agent@iarsma.local' }],
                  subject: `[approval] ${input.toolName} — ${summarize(input)}`,
                  keywords: { [KEYWORD_PENDING]: true },
                  bodyValues: { '1': { value: JSON.stringify(input) } },
                  bodyStructure: { partId: '1', type: 'text/plain' },
                },
              },
            },
            '0',
          ],
        ],
      });

      const result = await jmapPost(session, body) as {
        methodResponses: Array<[string, {
          created?: Record<string, { id?: string }>;
          notCreated?: Record<string, { type?: string; description?: string }>;
        }, string]>;
      };
      const resp = result.methodResponses[0];
      if (resp === undefined || resp[0] !== 'Email/set') {
        throw makeError('jmap_parse_error', 'Unexpected Email/set response.');
      }
      if (resp[1].notCreated !== undefined) {
        const c0 = resp[1].notCreated['c0'];
        if (c0 !== undefined) {
          throw makeError(
            'jmap_set_error',
            `Email/set rejected: ${c0.type ?? 'unknown'}${c0.description !== undefined ? ` — ${c0.description}` : ''}`,
          );
        }
      }
      const created = resp[1].created?.['c0'];
      if (created === undefined || typeof created.id !== 'string') {
        throw makeError('jmap_parse_error', 'Email/set created["c0"] is missing id.');
      }
      return created.id;
    },

    async list(filter?: { status?: 'pending' | 'approved' | 'denied' }): Promise<readonly ApprovalRequest[]> {
      const session = await getSession();
      const accountId = session.primaryAccountIdMail;
      const mailboxId = await this.ensureMailbox();

      const queryFilter: Record<string, unknown> = { inMailbox: mailboxId };
      if (filter?.status !== undefined) {
        // Combine inMailbox + keyword filter with AND.
        const keywordFilter = statusToKeywordFilter(filter.status);
        Object.assign(queryFilter, keywordFilter);
      }

      const body = JSON.stringify({
        using: JMAP_USING_MAIL,
        methodCalls: [
          [
            'Email/query',
            {
              accountId,
              filter: queryFilter,
              sort: [{ property: 'receivedAt', isAscending: false }],
            },
            '0',
          ],
          [
            'Email/get',
            {
              accountId,
              '#ids': { resultOf: '0', name: 'Email/query', path: '/ids' },
              properties: ['id', 'subject', 'from', 'keywords', 'receivedAt', 'bodyValues'],
              fetchTextBodyValues: true,
            },
            '1',
          ],
        ],
      });

      const result = await jmapPost(session, body) as {
        methodResponses: Array<[string, Record<string, unknown>, string]>;
      };
      const getResp = result.methodResponses[1];
      if (getResp === undefined || getResp[0] !== 'Email/get') {
        throw makeError('jmap_parse_error', 'Unexpected Email/get response in list.');
      }
      const emails = (getResp[1] as { list?: unknown[] }).list ?? [];
      return emails.map(parseApprovalEmail);
    },

    async get(approvalId: string): Promise<ApprovalRequest | null> {
      const session = await getSession();
      const accountId = session.primaryAccountIdMail;

      const body = JSON.stringify({
        using: JMAP_USING_MAIL,
        methodCalls: [
          [
            'Email/get',
            {
              accountId,
              ids: [approvalId],
              properties: ['id', 'subject', 'from', 'keywords', 'receivedAt', 'bodyValues'],
              fetchTextBodyValues: true,
            },
            '0',
          ],
        ],
      });

      const result = await jmapPost(session, body) as {
        methodResponses: Array<[string, { list?: unknown[]; notFound?: string[] }, string]>;
      };
      const resp = result.methodResponses[0];
      if (resp === undefined || resp[0] !== 'Email/get') {
        throw makeError('jmap_parse_error', 'Unexpected Email/get response.');
      }
      const notFound = resp[1].notFound ?? [];
      if (notFound.includes(approvalId)) return null;
      const emails = resp[1].list ?? [];
      if (emails.length === 0) return null;
      return parseApprovalEmail(emails[0]);
    },

    async approve(approvalId: string): Promise<void> {
      const session = await getSession();
      const accountId = session.primaryAccountIdMail;

      const body = JSON.stringify({
        using: JMAP_USING_MAIL,
        methodCalls: [
          [
            'Email/set',
            {
              accountId,
              update: {
                [approvalId]: {
                  [`keywords/${KEYWORD_PENDING}`]: null,
                  [`keywords/${KEYWORD_APPROVED}`]: true,
                },
              },
            },
            '0',
          ],
        ],
      });

      const result = await jmapPost(session, body) as {
        methodResponses: Array<[string, {
          updated?: Record<string, unknown>;
          notUpdated?: Record<string, { type?: string; description?: string }>;
        }, string]>;
      };
      const resp = result.methodResponses[0];
      if (resp === undefined || resp[0] !== 'Email/set') {
        throw makeError('jmap_parse_error', 'Unexpected Email/set response.');
      }
      if (resp[1].notUpdated !== undefined) {
        const err = resp[1].notUpdated[approvalId];
        if (err !== undefined) {
          throw makeError(
            'jmap_set_error',
            `Email/set update rejected: ${err.type ?? 'unknown'}${err.description !== undefined ? ` — ${err.description}` : ''}`,
          );
        }
      }
    },

    async deny(approvalId: string): Promise<void> {
      const session = await getSession();
      const accountId = session.primaryAccountIdMail;

      const body = JSON.stringify({
        using: JMAP_USING_MAIL,
        methodCalls: [
          [
            'Email/set',
            {
              accountId,
              update: {
                [approvalId]: {
                  [`keywords/${KEYWORD_PENDING}`]: null,
                  [`keywords/${KEYWORD_DENIED}`]: true,
                },
              },
            },
            '0',
          ],
        ],
      });

      const result = await jmapPost(session, body) as {
        methodResponses: Array<[string, {
          updated?: Record<string, unknown>;
          notUpdated?: Record<string, { type?: string; description?: string }>;
        }, string]>;
      };
      const resp = result.methodResponses[0];
      if (resp === undefined || resp[0] !== 'Email/set') {
        throw makeError('jmap_parse_error', 'Unexpected Email/set response.');
      }
      if (resp[1].notUpdated !== undefined) {
        const err = resp[1].notUpdated[approvalId];
        if (err !== undefined) {
          throw makeError(
            'jmap_set_error',
            `Email/set update rejected: ${err.type ?? 'unknown'}${err.description !== undefined ? ` — ${err.description}` : ''}`,
          );
        }
      }
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Parse a JMAP Email record from the Approvals mailbox into an
 * ApprovalRequest. The body JSON is the original CreateApprovalInput;
 * status is derived from keywords.
 */
function parseApprovalEmail(raw: unknown): ApprovalRequest {
  if (raw === null || typeof raw !== 'object') {
    throw makeError('jmap_parse_error', 'Approval email is not an object.');
  }
  const email = raw as Record<string, unknown>;
  const id = email.id;
  if (typeof id !== 'string') {
    throw makeError('jmap_parse_error', 'Approval email is missing id.');
  }

  // Extract body JSON from bodyValues.
  const bodyValues = email.bodyValues as Record<string, { value?: string }> | undefined;
  let input: CreateApprovalInput | undefined;
  if (bodyValues !== undefined) {
    // The first body value contains the serialized CreateApprovalInput.
    const firstValue = Object.values(bodyValues)[0];
    if (firstValue !== undefined && typeof firstValue.value === 'string') {
      try {
        input = JSON.parse(firstValue.value) as CreateApprovalInput;
      } catch {
        // Fall through — body is unparseable.
      }
    }
  }

  if (input === undefined) {
    throw makeError('jmap_parse_error', `Approval email ${id} has no parseable body.`);
  }

  const keywords = (email.keywords ?? {}) as Record<string, boolean>;
  const status = keywordsToStatus(keywords);

  return {
    id,
    schemaVersion: input.schemaVersion,
    toolName: input.toolName,
    requestingAgentId: input.requestingAgentId,
    requestingAgentName: input.requestingAgentName,
    params: input.params,
    preview: input.preview,
    previewHashHex: input.previewHashHex,
    requestedAt: input.requestedAt,
    status,
  };
}

function makeError(code: string, message: string): ToolError {
  return { code, message };
}

function describe(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
