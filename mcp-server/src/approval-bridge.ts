/**
 * MCP-side bridge to the approval mailbox (Phase 5b).
 *
 * When an agent invokes a destructive `files.*` tool with `dryRun: false`,
 * the MCP server posts a JMAP email to the user's `Approvals` mailbox with
 * keyword `$approval_pending` and a JSON body matching `ApprovalRequest`
 * in `shell/src/runtime/approval-store.ts`. The browser's approval queue
 * already reads this shape — the bridge only writes the same record from
 * the server side using the agent's per-token `stalwartApiKey` (Phase 3a).
 *
 * Read/approve/deny operations stay browser-side; the server only ever
 * appends pending approvals.
 */

import { session as jmapClientSession } from '@iarsma/wasm-bindings/jmap-client';

export type ApprovalParams = {
  readonly toolName: string;
  readonly requestingAgentId: string;
  readonly requestingAgentName: string;
  readonly params: unknown;
  readonly preview: unknown;
  readonly previewHashHex: string;
};

export type ApprovalBridgeDeps = {
  readonly jmapBaseUrl: string;
  readonly stalwartApiKey: string;
  readonly fetch?: typeof fetch;
};

const JMAP_USING_MAIL = [
  'urn:ietf:params:jmap:core',
  'urn:ietf:params:jmap:mail',
];

const APPROVAL_MAILBOX_NAME = 'Approvals';
const KEYWORD_PENDING = '$approval_pending';

export async function createApproval(
  deps: ApprovalBridgeDeps,
  input: ApprovalParams,
): Promise<string> {
  const fetchImpl = deps.fetch ?? fetch;
  const sessionUrl = `${deps.jmapBaseUrl.replace(/\/$/, '')}/.well-known/jmap`;
  const sessionResp = await fetchImpl(sessionUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${deps.stalwartApiKey}`,
    },
  });
  if (!sessionResp.ok) {
    throw makeError(
      sessionResp.status,
      `JMAP session fetch returned ${sessionResp.status} ${sessionResp.statusText}`,
    );
  }
  const session = jmapClientSession.parseSession(await sessionResp.text());
  const accountId = session.primaryAccountIdMail;

  const mailboxId = await ensureMailbox(
    fetchImpl,
    session.apiUrl,
    deps.stalwartApiKey,
    accountId,
  );

  const requestedAt = new Date().toISOString();
  const body = {
    schemaVersion: 1 as const,
    toolName: input.toolName,
    requestingAgentId: input.requestingAgentId,
    requestingAgentName: input.requestingAgentName,
    params: input.params,
    preview: input.preview,
    previewHashHex: input.previewHashHex,
    requestedAt,
  };

  const subject = `[approval] ${input.toolName} — ${input.requestingAgentName || input.requestingAgentId} @ ${requestedAt}`;
  const emailBody = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Email/set',
        {
          accountId,
          create: {
            c0: {
              mailboxIds: { [mailboxId]: true },
              from: [
                {
                  name: input.requestingAgentName,
                  email: 'agent@iarsma.local',
                },
              ],
              subject,
              keywords: { [KEYWORD_PENDING]: true },
              bodyValues: { '1': { value: JSON.stringify(body) } },
              bodyStructure: { partId: '1', type: 'text/plain' },
            },
          },
        },
        '0',
      ],
    ],
  });

  const resp = await fetchImpl(session.apiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${deps.stalwartApiKey}`,
    },
    body: emailBody,
  });
  if (!resp.ok) {
    throw makeError(
      resp.status,
      `Approval Email/set returned ${resp.status} ${resp.statusText}`,
    );
  }
  const parsed = (await resp.json()) as {
    methodResponses?: Array<
      [
        string,
        {
          created?: Record<string, { id?: string }>;
          notCreated?: Record<string, { type?: string; description?: string }>;
        },
        string,
      ]
    >;
  };
  const m = parsed.methodResponses?.[0];
  if (m === undefined || m[0] !== 'Email/set') {
    throw makeError(0, 'Unexpected Approval Email/set response.');
  }
  const notCreated = m[1].notCreated?.['c0'];
  if (notCreated !== undefined) {
    throw makeError(
      0,
      `Approval Email/set rejected: ${notCreated.type ?? 'unknown'}${notCreated.description !== undefined ? ` — ${notCreated.description}` : ''}`,
    );
  }
  const id = m[1].created?.['c0']?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw makeError(0, 'Approval Email/set created["c0"].id missing.');
  }
  return id;
}

async function ensureMailbox(
  fetchImpl: typeof fetch,
  apiUrl: string,
  token: string,
  accountId: string,
): Promise<string> {
  const queryBody = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Mailbox/query',
        { accountId, filter: { name: APPROVAL_MAILBOX_NAME } },
        '0',
      ],
    ],
  });
  const queryResp = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: queryBody,
  });
  if (!queryResp.ok) {
    throw makeError(
      queryResp.status,
      `Approval Mailbox/query returned ${queryResp.status} ${queryResp.statusText}`,
    );
  }
  const queryParsed = (await queryResp.json()) as {
    methodResponses?: Array<[string, { ids?: string[] }, string]>;
  };
  const existing = queryParsed.methodResponses?.[0]?.[1].ids;
  if (existing !== undefined && existing.length > 0 && existing[0] !== undefined) {
    return existing[0];
  }

  const createBody = JSON.stringify({
    using: JMAP_USING_MAIL,
    methodCalls: [
      [
        'Mailbox/set',
        { accountId, create: { m0: { name: APPROVAL_MAILBOX_NAME } } },
        '0',
      ],
    ],
  });
  const createResp = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: createBody,
  });
  if (!createResp.ok) {
    throw makeError(
      createResp.status,
      `Approval Mailbox/set returned ${createResp.status} ${createResp.statusText}`,
    );
  }
  const createParsed = (await createResp.json()) as {
    methodResponses?: Array<
      [
        string,
        {
          created?: Record<string, { id?: string }>;
          notCreated?: Record<string, { type?: string; description?: string }>;
        },
        string,
      ]
    >;
  };
  const m = createParsed.methodResponses?.[0];
  const id = m?.[1].created?.['m0']?.id;
  if (typeof id !== 'string' || id.length === 0) {
    const nc = m?.[1].notCreated?.['m0'];
    throw makeError(
      0,
      `Approval Mailbox/set rejected: ${nc?.type ?? 'unknown'}${nc?.description !== undefined ? ` — ${nc.description}` : ''}`,
    );
  }
  return id;
}

function makeError(status: number, message: string): Error {
  const err = new Error(message);
  const code =
    status === 401 || status === 403
      ? 'unauthorized'
      : status === 404
        ? 'not_found'
        : 'jmap_http_error';
  (err as Error & { code?: string }).code = code;
  return err;
}

export async function hashPreview(payload: unknown): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
