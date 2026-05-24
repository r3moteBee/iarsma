/**
 * Streamable HTTP transport for the MCP server (Phase 2 work item
 * 10a). Wraps the SDK's `StreamableHTTPServerTransport` behind a
 * Node `http` listener and gates every request on a Bearer-token
 * match.
 *
 * Phase 2 posture: single-shared-secret. `IARSMA_MCP_HTTP_TOKEN` is
 * checked verbatim against the request's `Authorization: Bearer
 * <token>`. Phase 3 introduces per-agent token introspection (the
 * MCP server validates the token against the auth server and derives
 * scopes from the introspection response). The transport shape is
 * the same — only the token-check function changes.
 *
 * Stateless mode (`sessionIdGenerator: undefined`): each POST is
 * independent. No server-side session table; auth happens fresh per
 * request. This is the right posture for "agents from anywhere"
 * usage. Stateful mode lands when we need server-pushed
 * notifications (Phase 3 push subscriptions).
 *
 * The transport is enabled when BOTH env vars are set:
 *   - `IARSMA_MCP_HTTP_PORT`  — port to bind (e.g., 8765).
 *   - `IARSMA_MCP_HTTP_TOKEN` — shared bearer secret.
 *
 * Either missing → HTTP disabled, stdio remains the only surface.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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

export type HttpTransportConfig = {
  /** Port to bind. Required when HTTP transport is enabled. */
  readonly port: number;
  /** Shared Bearer secret. Legacy single-token mode — used when no
   *  TokenStore is provided. */
  readonly bearerToken: string;
  /** Hostname to bind. Defaults to '0.0.0.0' (all interfaces) — operators
   *  put this behind a reverse proxy + TLS terminator. */
  readonly host?: string;
  /** Per-agent token store. When provided, replaces the static
   *  bearerToken check with a lookup that returns identity + scopes. */
  readonly tokenStore?: TokenStore | undefined;
};

/**
 * Pull HTTP transport config from environment. Returns `null` when
 * one or both env vars are missing — the caller skips HTTP setup and
 * runs stdio-only.
 */
export function loadHttpTransportConfig(
  env: NodeJS.ProcessEnv,
): HttpTransportConfig | null {
  const portRaw = env['IARSMA_MCP_HTTP_PORT'];
  const tokenRaw = env['IARSMA_MCP_HTTP_TOKEN'];
  if (
    portRaw === undefined ||
    portRaw === '' ||
    tokenRaw === undefined ||
    tokenRaw === ''
  ) {
    return null;
  }
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `IARSMA_MCP_HTTP_PORT must be an integer in [1, 65535] (got ${portRaw}).`,
    );
  }
  return {
    port,
    bearerToken: tokenRaw,
    ...(env['IARSMA_MCP_HTTP_HOST'] !== undefined &&
    env['IARSMA_MCP_HTTP_HOST'] !== ''
      ? { host: env['IARSMA_MCP_HTTP_HOST'] }
      : {}),
  };
}

export type StartHttpTransportResult = {
  /** Actual port (useful when port=0 was requested for ephemeral binding). */
  readonly port: number;
  /** Stop the listener. Resolves when sockets are closed. */
  readonly close: () => Promise<void>;
};

/**
 * Start the HTTP listener. Connects the supplied MCP server to a
 * fresh `StreamableHTTPServerTransport` (stateless). Routes every
 * `POST /mcp` through the transport after verifying the bearer
 * token.
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

  // Per-session transport+server pairs. The MCP SDK couples Server 1:1
  // with a Transport, so each concurrent client needs its own pair.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  async function createSession(): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    transport.onerror = (err: Error) => {
      // eslint-disable-next-line no-console
      console.error('[iarsma-mcp-http] transport error:', err);
    };
    const server = opts.createServer !== undefined
      ? opts.createServer()
      : opts.mcpServer;
    await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
    return transport;
  }

  const httpServer = createServer(async (req, res) => {
    try {
      const url = req.url ?? '';

      // Non-MCP paths (healthz, agents) don't need session management.
      if (!url.startsWith('/mcp')) {
        await handleRequest({ req, res, transport: undefined as unknown as StreamableHTTPServerTransport, expectedToken: config.bearerToken, tokenStore: config.tokenStore });
        return;
      }

      // Session routing: look up existing session or create a new one.
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId !== undefined && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!;
      } else {
        // New session — create a fresh Server+Transport pair.
        transport = await createSession();
      }

      await handleRequest({ req, res, transport, expectedToken: config.bearerToken, tokenStore: config.tokenStore });

      // After handling, capture the session ID the transport assigned
      // (returned in the response header) and register it.
      const newSessionId = res.getHeader('mcp-session-id') as string | undefined;
      if (newSessionId !== undefined && !sessions.has(newSessionId)) {
        sessions.set(newSessionId, transport);
        // eslint-disable-next-line no-console
        console.error(`[iarsma-mcp-http] new session: ${newSessionId} (${sessions.size} active)`);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[iarsma-mcp-http] unhandled error:', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'internal_error',
            message: e instanceof Error ? e.message : String(e),
          }),
        );
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err: unknown) => (err !== undefined && err !== null ? reject(err) : resolve()));
      }),
  };
}

async function handleRequest(args: {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly transport: StreamableHTTPServerTransport;
  readonly expectedToken: string;
  readonly tokenStore?: TokenStore | undefined;
}): Promise<void> {
  const { req, res, transport, expectedToken, tokenStore } = args;

  // Health check — useful for ops without exposing the MCP surface.
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  // CORS — needed for webmail UI to call /agents/* endpoints.
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Agent management REST endpoints — authenticated with the user's
  // Stalwart bearer token (not an agent token).
  if (req.url?.startsWith('/agents')) {
    await handleAgentEndpoint({ req, res, tokenStore, expectedToken });
    return;
  }

  // MCP endpoints all live at /mcp.
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'not_found', message: 'Use /mcp or /agents/*.' }),
    );
    return;
  }

  // Auth: try token store first (per-agent tokens), fall back to
  // static bearer (legacy single-token mode).
  const bearer = extractBearer(req.headers.authorization);
  let resolvedAgent: ResolvedIdentity | null = null;
  if (bearer !== null && tokenStore !== undefined) {
    resolvedAgent = tokenStore.resolve(bearer);
  }
  if (resolvedAgent === null && !verifyBearer(req.headers.authorization, expectedToken)) {
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
    return;
  }

  // Attach resolved identity to req.auth so the SDK passes it
  // through to CallTool/ListTools handlers via request context.
  if (resolvedAgent !== null) {
    (req as unknown as Record<string, unknown>).auth = resolvedAgent;
  }

  // Pre-parse the JSON body for POST so the transport can dispatch
  // synchronously. The SDK's `handleRequest` accepts the parsed body
  // as a third argument, which we pass here.
  let body: unknown;
  if (req.method === 'POST') {
    try {
      body = await readJson(req);
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'invalid_request',
          message: e instanceof Error ? e.message : 'Bad request body.',
        }),
      );
      return;
    }
  }

  await transport.handleRequest(req, res, body);
}

async function handleAgentEndpoint(args: {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly tokenStore?: TokenStore | undefined;
  readonly expectedToken: string;
}): Promise<void> {
  const { req, res, tokenStore } = args;

  // All agent endpoints require auth — the user's Stalwart token.
  const bearer = extractBearer(req.headers.authorization);
  if (bearer === null) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized', message: 'Bearer token required.' }));
    return;
  }

  if (tokenStore === undefined) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_configured', message: 'Token store not configured (set IARSMA_TOKENS_FILE).' }));
    return;
  }

  // POST /agents/register — create agent token + Stalwart API key
  if (req.method === 'POST' && req.url === '/agents/register') {
    let body: Record<string, unknown>;
    try {
      body = (await readJson(req)) as Record<string, unknown>;
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_request', message: 'Invalid JSON body.' }));
      return;
    }

    const name = body.name as string | undefined;
    const scopes = body.scopes as string[] | undefined;
    const jmapUrl = body.jmapUrl as string | undefined;
    if (typeof name !== 'string' || !Array.isArray(scopes) || typeof jmapUrl !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_request', message: 'Required: name (string), scopes (string[]), jmapUrl (string).' }));
      return;
    }

    try {
      // Create scoped Stalwart API key using the user's token
      const stalwartKey = await createStalwartApiKey({
        jmapUrl,
        userToken: bearer,
        description: `iarsma-agent: ${name}`,
        scopes,
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

      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        tokenId,
        secret: agentSecret,
        name,
        scopes,
      }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[iarsma-mcp] agent registration failed:', e);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'registration_failed',
        message: e instanceof Error ? e.message : String(e),
      }));
    }
    return;
  }

  // DELETE /agents/{tokenId} — revoke agent + destroy Stalwart key
  const deleteMatch = req.method === 'DELETE' && req.url?.match(/^\/agents\/([^/]+)$/);
  if (deleteMatch) {
    const tokenId = deleteMatch[1]!;
    const removed = tokenStore.remove(tokenId);
    if (removed === null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', message: `Token ${tokenId} not found.` }));
      return;
    }

    // Destroy the Stalwart API key
    if (removed.stalwartKeyId !== undefined) {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const jmap = url.searchParams.get('jmapUrl');
      if (jmap !== null) {
        try {
          await destroyStalwartApiKey({ jmapUrl: jmap, userToken: bearer, keyId: removed.stalwartKeyId });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[iarsma-mcp] Stalwart key cleanup failed (agent removed anyway):', e);
        }
      }
    }

    // eslint-disable-next-line no-console
    console.error(`[iarsma-mcp] revoked agent '${removed.name}' (${tokenId})`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ revoked: tokenId }));
    return;
  }

  // GET /agents — list all agents (no secrets)
  if (req.method === 'GET' && req.url === '/agents') {
    const list = tokenStore.list().map((e) => ({
      tokenId: e.tokenId,
      name: e.name,
      scopes: e.scopes,
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }

  // GET /agents/approvals/{id} — poll approval status (Phase 3b)
  const approvalMatch = req.method === 'GET' && req.url?.match(/^\/agents\/approvals\/([^?]+)/);
  if (approvalMatch) {
    const approvalId = decodeURIComponent(approvalMatch[1]!);
    const approval = readApproval(approvalId);
    if (approval === null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', message: `Approval ${approvalId} not found.` }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(approval));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', message: 'Unknown agent endpoint.' }));
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

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => {
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
