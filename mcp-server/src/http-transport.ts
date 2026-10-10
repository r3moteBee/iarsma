/**
 * Streamable HTTP transport for the MCP server (Phase 2 work item
 * 10a). Wraps the SDK's `StreamableHTTPServerTransport` behind a
 * Node `http` listener and gates every request on a Bearer token.
 *
 * Auth: every `/mcp` request is authenticated BEFORE anything else
 * happens — the token store resolves the bearer (per-agent tokens,
 * D-057/D-058), with the legacy single shared secret
 * (`IARSMA_MCP_HTTP_TOKEN`) as a dev-only fallback. Unauthenticated
 * requests never allocate server state.
 *
 * Stateful mode (`sessionIdGenerator: randomUUID`): the SDK couples a
 * Server 1:1 with a Transport, so each MCP session (one `initialize`
 * handshake) gets its own Server+Transport pair, keyed by the
 * `Mcp-Session-Id` the transport assigns. Auth still happens fresh on
 * every request; a session is additionally bound to the identity that
 * initialized it, so another bearer cannot ride on it. The session
 * table is bounded: sessions are dropped when the transport closes
 * (client `DELETE`, server shutdown), after `sessionIdleTtlMs` without
 * traffic, and the least-recently-used session is evicted once
 * `maxSessionsPerIdentity` (that identity's own LRU) or `maxSessions`
 * (global LRU) is reached.
 *
 * The transport is enabled when `IARSMA_MCP_HTTP_PORT` is set; see
 * `loadHttpTransportConfig` for the remaining env vars. Unset → HTTP
 * disabled, stdio remains the only surface.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { TokenStore, ResolvedIdentity, TokenEntry } from './token-store.js';
import { createStalwartApiKey, destroyStalwartApiKey } from './stalwart-permissions.js';

// ─────────────────────────────────────────────────────────────────────────
//  Approval store types (Phase 3b)
// ─────────────────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | { status: 'pending' }
  | { status: 'approved'; result: unknown }
  | { status: 'denied'; reason: string };

export type ApprovalRecord = {
  readonly id: string;
} & ApprovalStatus;

/**
 * Read the approvals file and look up a specific approval by ID.
 * Returns `null` when the file doesn't exist or the ID isn't found.
 */
export function readApproval(approvalId: string, filePath?: string): ApprovalStatus | null {
  const path = filePath ?? process.env['IARSMA_APPROVALS_FILE'] ?? './run/approvals.json';
  try {
    const raw = readFileSync(path, 'utf-8');
    const records = JSON.parse(raw) as ApprovalRecord[];
    const record = records.find((r) => r.id === approvalId);
    if (record === undefined) return null;
    // Strip the `id` field — callers only need the status envelope.
    if (record.status === 'approved') return { status: 'approved', result: record.result };
    if (record.status === 'denied') return { status: 'denied', reason: record.reason };
    return { status: 'pending' };
  } catch {
    return null;
  }
}

/** Default request-body cap (1 MiB). Larger bodies get a 413. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
/** Default idle lifetime of an MCP session (30 min without traffic). */
export const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
/** Default cap on concurrent MCP sessions; LRU is evicted past it. */
export const DEFAULT_MAX_SESSIONS = 1000;
/**
 * Default per-identity session cap. Past it the identity's own LRU
 * session is evicted, so one tenant can't churn everyone else's
 * sessions out of the global table.
 */
export const DEFAULT_MAX_SESSIONS_PER_IDENTITY = 32;

export type HttpTransportConfig = {
  /** Port to bind. Required when HTTP transport is enabled. */
  readonly port: number;
  /**
   * Legacy shared Bearer secret. When set, agents authenticate by
   * presenting this verbatim — used in dev or with a `tokens.json`
   * fallback store. Under introspection mode (PR 36 / D-057) the
   * operator omits this entirely; agents present their Stalwart-
   * issued bearers and the token store does the validation.
   */
  readonly bearerToken?: string;
  /** Hostname to bind. Defaults to '0.0.0.0' (all interfaces) — operators
   *  put this behind a reverse proxy + TLS terminator. */
  readonly host?: string;
  /** Per-agent token store. When provided, replaces the static
   *  bearerToken check with a lookup that returns identity + scopes. */
  readonly tokenStore?: TokenStore | undefined;
  /**
   * Origins allowed to make cross-origin requests
   * (`IARSMA_MCP_HTTP_CORS_ORIGINS`, comma-separated, exact match).
   * Default: none — no `Access-Control-Allow-Origin` is ever sent, so
   * only same-origin and non-browser clients can read responses.
   */
  readonly corsOrigins?: readonly string[];
  /**
   * Legacy agent-management endpoints (`POST /agents/register`,
   * `GET /agents`, `DELETE /agents/{id}`). Only meaningful with the
   * file token store (`tokens.json`); the caller enables them by
   * passing this object, otherwise they answer 404. Callers must
   * present a Stalwart user bearer that validates against
   * `jmapBaseUrl`; the JMAP API URL used to mint / destroy the
   * per-agent Stalwart API key comes from that session, never from
   * the request.
   */
  readonly agentManagement?: {
    readonly jmapBaseUrl?: string | undefined;
    /** Override `fetch` for tests. */
    readonly fetch?: typeof fetch;
  };
  /** Request-body cap in bytes. Default `DEFAULT_MAX_BODY_BYTES`. */
  readonly maxBodyBytes?: number;
  /** Idle lifetime of an MCP session. Default `DEFAULT_SESSION_IDLE_TTL_MS`. */
  readonly sessionIdleTtlMs?: number;
  /** Concurrent-session cap. Default `DEFAULT_MAX_SESSIONS`. */
  readonly maxSessions?: number;
  /** Per-identity session cap. Default `DEFAULT_MAX_SESSIONS_PER_IDENTITY`. */
  readonly maxSessionsPerIdentity?: number;
};

/**
 * Pull HTTP transport config from environment. Returns `null` when
 * `IARSMA_MCP_HTTP_PORT` is unset — the caller skips HTTP setup and
 * runs stdio-only. `IARSMA_MCP_HTTP_TOKEN` is optional; when unset,
 * the caller must wire a tokenStore (introspection or file) or no
 * requests will authenticate. `IARSMA_MCP_HTTP_CORS_ORIGINS` is an
 * optional comma-separated origin allowlist.
 */
export function loadHttpTransportConfig(
  env: NodeJS.ProcessEnv,
): HttpTransportConfig | null {
  const portRaw = env['IARSMA_MCP_HTTP_PORT'];
  if (portRaw === undefined || portRaw === '') {
    return null;
  }
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `IARSMA_MCP_HTTP_PORT must be an integer in [1, 65535] (got ${portRaw}).`,
    );
  }
  const tokenRaw = env['IARSMA_MCP_HTTP_TOKEN'];
  const corsOrigins = (env['IARSMA_MCP_HTTP_CORS_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
  return {
    port,
    ...(tokenRaw !== undefined && tokenRaw !== '' ? { bearerToken: tokenRaw } : {}),
    ...(env['IARSMA_MCP_HTTP_HOST'] !== undefined &&
    env['IARSMA_MCP_HTTP_HOST'] !== ''
      ? { host: env['IARSMA_MCP_HTTP_HOST'] }
      : {}),
    ...(corsOrigins.length > 0 ? { corsOrigins } : {}),
  };
}

export type StartHttpTransportResult = {
  /** Actual port (useful when port=0 was requested for ephemeral binding). */
  readonly port: number;
  /** Number of live MCP sessions (ops / tests). */
  readonly sessionCount: () => number;
  /** Stop the listener and close every session. Resolves when sockets are closed. */
  readonly close: () => Promise<void>;
};

type Session = {
  readonly transport: StreamableHTTPServerTransport;
  readonly server: McpServer;
  /** Identity that initialized the session; later requests must match. */
  readonly ownerId: string;
  lastSeen: number;
};

/** Identity id used for requests authenticated by the legacy shared secret. */
const LEGACY_OWNER_ID = 'static-token';

/**
 * Start the HTTP listener. Each authenticated `initialize` POST to
 * `/mcp` gets a fresh Server+Transport pair (see the header comment);
 * later requests are routed by `Mcp-Session-Id`.
 *
 * NOT a long-lived promise — returns once the socket is listening.
 * The caller holds the `close` handle for shutdown.
 */
export async function startHttpTransport(opts: {
  readonly config: HttpTransportConfig;
  readonly mcpServer: McpServer;
  /** Factory to create new MCP server instances for concurrent sessions. */
  readonly createServer?: () => McpServer;
}): Promise<StartHttpTransportResult> {
  const { config } = opts;
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const idleTtlMs = config.sessionIdleTtlMs ?? DEFAULT_SESSION_IDLE_TTL_MS;
  const maxSessions = Math.max(1, config.maxSessions ?? DEFAULT_MAX_SESSIONS);
  const maxPerIdentity = Math.max(
    1,
    config.maxSessionsPerIdentity ?? DEFAULT_MAX_SESSIONS_PER_IDENTITY,
  );
  const corsOrigins = new Set(config.corsOrigins ?? []);

  // Live sessions in least-recently-used-first order: `touch` re-inserts
  // a session at the end, so the first key is always the LRU.
  const sessions = new Map<string, Session>();

  function touch(id: string, session: Session): void {
    session.lastSeen = Date.now();
    sessions.delete(id);
    sessions.set(id, session);
  }

  function evict(id: string, session: Session, reason: string): void {
    sessions.delete(id);
    // eslint-disable-next-line no-console
    console.error(`[iarsma-mcp-http] evicting session ${id}: ${reason}`);
    closeSession(session);
  }

  /** Make room for one more session owned by `ownerId`. */
  function makeRoom(ownerId: string): void {
    // The identity's own sessions first, oldest first …
    const owned = [...sessions].filter(([, s]) => s.ownerId === ownerId);
    while (owned.length >= maxPerIdentity) {
      const [id, s] = owned.shift()!;
      evict(id, s, `per-identity cap ${maxPerIdentity} reached`);
    }
    // … then the global LRU.
    while (sessions.size >= maxSessions) {
      const [id, s] = sessions.entries().next().value as [string, Session];
      evict(id, s, `session cap ${maxSessions} reached`);
    }
  }

  function closeSession(session: Session): void {
    // Server.close → transport.close → transport.onclose, which removes
    // the map entry. Errors here only mean the pair was already gone.
    session.server.close().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[iarsma-mcp-http] session close failed:', err);
    });
  }

  async function createSession(ownerId: string): Promise<Session> {
    const server = opts.createServer !== undefined
      ? opts.createServer()
      : opts.mcpServer;
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id: string) => {
        // Make room before registering so the caps are hard bounds.
        makeRoom(ownerId);
        sessions.set(id, session);
        // eslint-disable-next-line no-console
        console.error(`[iarsma-mcp-http] new session: ${id} (${sessions.size} active)`);
      },
    });
    const session: Session = { transport, server, ownerId, lastSeen: Date.now() };
    transport.onerror = (err: Error) => {
      // eslint-disable-next-line no-console
      console.error('[iarsma-mcp-http] transport error:', err.message);
    };
    // Set before `connect`: the SDK's Protocol chains a pre-existing
    // onclose rather than replacing it.
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id !== undefined && sessions.get(id) === session) {
        sessions.delete(id);
        // eslint-disable-next-line no-console
        console.error(`[iarsma-mcp-http] closed session: ${id} (${sessions.size} active)`);
      }
    };
    await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
    return session;
  }

  function sweepIdleSessions(): void {
    const cutoff = Date.now() - idleTtlMs;
    for (const [id, session] of sessions) {
      // LRU order: the first non-expired session ends the sweep.
      if (session.lastSeen > cutoff) break;
      sessions.delete(id);
      // eslint-disable-next-line no-console
      console.error(`[iarsma-mcp-http] idle session expired: ${id}`);
      closeSession(session);
    }
  }
  const sweepTimer = setInterval(sweepIdleSessions, Math.min(idleTtlMs, 60_000));
  sweepTimer.unref();

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 1. Authenticate before touching any session state.
    const identity = await authenticate(req, config);
    if (identity === null) {
      writeUnauthorized(res);
      return;
    }
    const ownerId = identity === 'legacy' ? LEGACY_OWNER_ID : identity.id;

    // 2. Parse the body (bounded) so the transport can dispatch it.
    let body: unknown;
    if (req.method === 'POST') {
      const parsed = await readBodyOrReject(req, res, maxBodyBytes);
      if (!parsed.ok) return;
      body = parsed.value;
    }

    // 3. Route to an existing session, or start one on `initialize`.
    const sessionId = header(req, 'mcp-session-id');
    let session: Session;
    if (sessionId !== undefined) {
      const existing = sessions.get(sessionId);
      if (existing === undefined || existing.ownerId !== ownerId) {
        writeJsonRpcError(res, 404, -32001, 'Session not found');
        return;
      }
      touch(sessionId, existing);
      session = existing;
    } else {
      const messages = Array.isArray(body) ? body : [body];
      if (req.method !== 'POST' || !messages.some((m) => isInitializeRequest(m))) {
        writeJsonRpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        return;
      }
      session = await createSession(ownerId);
    }

    // Attach resolved identity to req.auth so the SDK passes it
    // through to CallTool/ListTools handlers via request context.
    if (identity !== 'legacy') {
      (req as unknown as Record<string, unknown>).auth = identity;
    }

    try {
      await session.transport.handleRequest(req, res, body);
    } finally {
      // An `initialize` the SDK rejected (bad Accept header, batched
      // init, …) or that threw never gets a session id — release the
      // pair now rather than leaking it.
      if (sessionId === undefined && session.transport.sessionId === undefined) {
        closeSession(session);
      }
    }
  }

  const httpServer = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '').split('?')[0]!;

      // Health check — useful for ops without exposing the MCP surface.
      if (req.method === 'GET' && path === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }

      applyCors(req, res, corsOrigins);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (path === '/agents' || path.startsWith('/agents/')) {
        await handleAgentEndpoint({ req, res, config, maxBodyBytes });
        return;
      }

      if (path === '/mcp' || path.startsWith('/mcp/')) {
        await handleMcp(req, res);
        return;
      }

      writeJson(res, 404, { error: 'not_found', message: 'Use /mcp.' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[iarsma-mcp-http] unhandled error:', e);
      if (!res.headersSent) {
        writeJson(res, 500, {
          error: 'internal_error',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  });

  const host = config.host ?? '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  const boundPort =
    typeof address === 'object' && address !== null ? address.port : config.port;

  return {
    port: boundPort,
    sessionCount: () => sessions.size,
    close: () => {
      clearInterval(sweepTimer);
      for (const session of [...sessions.values()]) closeSession(session);
      sessions.clear();
      return new Promise<void>((resolve, reject) => {
        httpServer.close((err: unknown) => (err !== undefined && err !== null ? reject(err) : resolve()));
        // Open SSE streams would otherwise hold `close` open forever.
        httpServer.closeAllConnections();
      });
    },
  };
}

/**
 * Agent auth shared by `/mcp` and the approval-poll endpoint: try the
 * token store first (per-agent tokens), fall back to the legacy static
 * bearer. Returns the resolved identity, `'legacy'` for a static-secret
 * match, or `null` when unauthenticated.
 */
async function authenticate(
  req: IncomingMessage,
  config: HttpTransportConfig,
): Promise<ResolvedIdentity | 'legacy' | null> {
  const bearer = extractBearer(req.headers.authorization);
  if (bearer === null) return null;
  if (config.tokenStore !== undefined) {
    const resolved = await config.tokenStore.resolve(bearer);
    if (resolved !== null) return resolved;
  }
  if (config.bearerToken !== undefined && verifyBearer(req.headers.authorization, config.bearerToken)) {
    return 'legacy';
  }
  return null;
}

async function handleAgentEndpoint(args: {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly config: HttpTransportConfig;
  readonly maxBodyBytes: number;
}): Promise<void> {
  const { req, res, config, maxBodyBytes } = args;
  const path = (req.url ?? '').split('?')[0]!;

  // GET /agents/approvals/{id} — poll approval status (Phase 3b). This
  // is agent-facing (the `pollUrl` in a `pending_approval` tool result),
  // so it authenticates exactly like `/mcp`.
  const approvalMatch = req.method === 'GET' && /^\/agents\/approvals\/([^/]+)$/.exec(path);
  if (approvalMatch) {
    if ((await authenticate(req, config)) === null) {
      writeUnauthorized(res);
      return;
    }
    let approvalId: string;
    try {
      approvalId = decodeURIComponent(approvalMatch[1]!);
    } catch {
      writeJson(res, 400, { error: 'invalid_request', message: 'Malformed approval id.' });
      return;
    }
    const approval = readApproval(approvalId);
    if (approval === null) {
      writeJson(res, 404, { error: 'not_found', message: `Approval ${approvalId} not found.` });
      return;
    }
    writeJson(res, 200, approval);
    return;
  }

  // Everything else is legacy agent management, which only exists in
  // file-token-store mode. Elsewhere Stalwart owns the agent-token
  // lifecycle (D-058) and these routes are simply absent.
  const management = config.agentManagement;
  const tokenStore = config.tokenStore;
  if (management === undefined || tokenStore === undefined) {
    writeJson(res, 404, { error: 'not_found', message: 'Unknown agent endpoint.' });
    return;
  }
  if (management.jmapBaseUrl === undefined) {
    writeJson(res, 503, {
      error: 'not_configured',
      message: 'Agent management needs a Stalwart JMAP base URL to authenticate callers.',
    });
    return;
  }

  // The caller must hold a bearer Stalwart accepts — validated against
  // the configured server, never a URL the request supplies.
  const bearer = extractBearer(req.headers.authorization);
  const fetchFn = management.fetch ?? globalThis.fetch;
  const apiUrl = bearer === null
    ? null
    : await resolveStalwartApiUrl(management.jmapBaseUrl, bearer, fetchFn);
  if (bearer === null || apiUrl === null) {
    writeUnauthorized(res);
    return;
  }

  // POST /agents/register — create agent token + Stalwart API key
  if (req.method === 'POST' && path === '/agents/register') {
    const parsed = await readBodyOrReject(req, res, maxBodyBytes);
    if (!parsed.ok) return;
    const body = (parsed.value ?? {}) as Record<string, unknown>;

    const name = body['name'];
    const scopes = body['scopes'];
    if (
      typeof name !== 'string' ||
      !Array.isArray(scopes) ||
      !scopes.every((s): s is string => typeof s === 'string')
    ) {
      writeJson(res, 400, { error: 'invalid_request', message: 'Required: name (string), scopes (string[]).' });
      return;
    }

    try {
      // Create scoped Stalwart API key using the user's token
      const stalwartKey = await createStalwartApiKey({
        jmapUrl: apiUrl,
        userToken: bearer,
        description: `iarsma-agent: ${name}`,
        scopes,
        fetch: fetchFn,
      });

      // Generate agent secret
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const agentSecret = Array.from(secretBytes, (b) => b.toString(16).padStart(2, '0')).join('');
      const tokenId = crypto.randomUUID();

      // Register in token store
      const entry: TokenEntry = {
        secret: agentSecret,
        name,
        scopes,
        tokenId,
        stalwartApiKey: stalwartKey.secret,
        stalwartKeyId: stalwartKey.id,
      };
      tokenStore.register(entry);

      // eslint-disable-next-line no-console
      console.error(`[iarsma-mcp] registered agent '${name}' (${tokenId}) with scopes: ${scopes.join(', ')}`);

      writeJson(res, 201, { tokenId, secret: agentSecret, name, scopes });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[iarsma-mcp] agent registration failed:', e instanceof Error ? e.message : e);
      writeJson(res, 500, {
        error: 'registration_failed',
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  // DELETE /agents/{tokenId} — revoke agent + destroy Stalwart key
  const deleteMatch = req.method === 'DELETE' && /^\/agents\/([^/]+)$/.exec(path);
  if (deleteMatch) {
    const tokenId = deleteMatch[1]!;
    const removed = tokenStore.remove(tokenId);
    if (removed === null) {
      writeJson(res, 404, { error: 'not_found', message: `Token ${tokenId} not found.` });
      return;
    }

    // Destroy the Stalwart API key
    if (removed.stalwartKeyId !== undefined) {
      try {
        await destroyStalwartApiKey({
          jmapUrl: apiUrl,
          userToken: bearer,
          keyId: removed.stalwartKeyId,
          fetch: fetchFn,
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          '[iarsma-mcp] Stalwart key cleanup failed (agent removed anyway):',
          e instanceof Error ? e.message : e,
        );
      }
    }

    // eslint-disable-next-line no-console
    console.error(`[iarsma-mcp] revoked agent '${removed.name}' (${tokenId})`);
    writeJson(res, 200, { revoked: tokenId });
    return;
  }

  // GET /agents — list all agents (no secrets)
  if (req.method === 'GET' && path === '/agents') {
    writeJson(
      res,
      200,
      tokenStore.list().map((e) => ({ tokenId: e.tokenId, name: e.name, scopes: e.scopes })),
    );
    return;
  }

  writeJson(res, 404, { error: 'not_found', message: 'Unknown agent endpoint.' });
}

/**
 * Validate a Stalwart user bearer against the configured server's JMAP
 * session endpoint and return its absolute `apiUrl`, or `null` when the
 * bearer is not accepted (or Stalwart is unreachable — fail closed).
 */
async function resolveStalwartApiUrl(
  jmapBaseUrl: string,
  bearer: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const sessionUrl = `${jmapBaseUrl.replace(/\/$/, '')}/.well-known/jmap`;
  try {
    const r = await fetchFn(sessionUrl, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { apiUrl?: unknown };
    if (typeof body.apiUrl !== 'string') return null;
    return new URL(body.apiUrl, sessionUrl).toString();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[iarsma-mcp] agent-management session check failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowed: ReadonlySet<string>): void {
  res.setHeader('vary', 'Origin');
  const origin = req.headers.origin;
  if (origin === undefined || !allowed.has(origin)) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function writeUnauthorized(res: ServerResponse): void {
  res.writeHead(401, {
    'content-type': 'application/json',
    'www-authenticate': 'Bearer realm="iarsma-mcp"',
  });
  res.end(
    JSON.stringify({
      error: 'unauthorized',
      message:
        'Missing or invalid Authorization header. Use `Authorization: Bearer <token>`.',
    }),
  );
}

/** JSON-RPC error envelope, shaped like the SDK transport's own errors. */
function writeJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  writeJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

function extractBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (match === null) return null;
  return match[1]!.trim();
}

function verifyBearer(
  header: string | undefined,
  expected: string,
): boolean {
  if (header === undefined) return false;
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (match === null) return false;
  // Constant-time-ish compare via length-checked equality. The
  // tokens are operator-configured; this isn't a serious side-
  // channel surface, but it costs nothing to do it right.
  const provided = match[1]!.trim();
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes.`);
  }
}

/**
 * Read + parse a JSON body, answering 413 / 400 itself on failure.
 * `ok: false` means the response has already been written.
 */
async function readBodyOrReject(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  try {
    return { ok: true, value: await readJson(req, maxBytes) };
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      // Don't keep the socket around to drain an oversized upload.
      res.setHeader('connection', 'close');
      writeJson(res, 413, { error: 'payload_too_large', message: e.message });
    } else {
      writeJson(res, 400, {
        error: 'invalid_request',
        message: e instanceof Error ? e.message : 'Bad request body.',
      });
    }
    return { ok: false };
  }
}

function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new BodyTooLargeError(maxBytes));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        done = true;
        chunks.length = 0;
        reject(new BodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(c);
    });
    req.on('error', (e) => {
      done = true;
      reject(e);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (raw === '') {
          resolve(undefined);
          return;
        }
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}
