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
  fetchMailDraftCommit,
  fetchMailboxList,
  fetchSession,
  fetchThreadGet,
  fetchThreadList,
  type JmapClientOptions,
  type Mailbox,
  type MailDraftInput,
  type MailDraftResult,
  type Session,
  type ThreadGet,
  type ThreadList,
} from './jmap-client.js';
import type { DryRunPreview, ToolError } from './types.js';

export type InvocationOptions = {
  /** True if the caller wants a dry-run preview, not a commit. */
  readonly dryRun?: boolean;
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
        default:
          throw makeToolError(
            'tool_not_found',
            `jmapInvoker has no handler for '${name}'.`,
          );
      }
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Mock invoker — for tests
// ──────────────────────────────────────────────────────────────────────────

export type MockInvokerHandler = (input: unknown, dryRun: boolean) => unknown | Promise<unknown>;

export function mockInvoker(handlers: Record<string, MockInvokerHandler>): Invoker {
  return {
    async invoke(name, input, options = {}) {
      const handler = handlers[name];
      if (handler === undefined) {
        throw makeToolError('tool_not_found', `mockInvoker has no handler for '${name}'.`);
      }
      const result = await handler(input, options.dryRun ?? false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result as any;
    },
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
  };
  estimatedSize: number;
} {
  const bodyTextSize = params.bodyText?.length ?? 0;
  const bodyHtmlSize = params.bodyHtml?.length ?? 0;
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
    },
    estimatedSize: envelope.length,
  };
}
