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
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { TokenStore, ResolvedIdentity } from './token-store.js';

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
}): Promise<StartHttpTransportResult> {
  const { config, mcpServer } = opts;

  // Stateless transport — each request handled independently.
  // `sessionIdGenerator: undefined` disables session-table tracking.
  // The SDK's types reject the literal `undefined` under
  // exactOptionalPropertyTypes; the cast keeps the runtime behavior
  // we want (the SDK explicitly checks for the property's presence).
  const transport = new StreamableHTTPServerTransport(
    { sessionIdGenerator: undefined } as unknown as ConstructorParameters<
      typeof StreamableHTTPServerTransport
    >[0],
  );
  // Cast: the SDK's `Transport` interface declares `onclose` as a
  // required function, but the transport's runtime shape sets it
  // lazily. exactOptionalPropertyTypes flags the mismatch; the
  // McpServer.connect call is the right operation regardless.
  await mcpServer.connect(transport as unknown as Parameters<typeof mcpServer.connect>[0]);

  const server = createServer(async (req, res) => {
    try {
      await handleRequest({ req, res, transport, expectedToken: config.bearerToken, tokenStore: config.tokenStore });
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
    server.once('error', reject);
    server.listen(config.port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const boundPort =
    typeof address === 'object' && address !== null ? address.port : config.port;

  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err !== undefined && err !== null ? reject(err) : resolve()));
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

  // MCP endpoints all live at /mcp.
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'not_found', message: 'Unknown path. Use /mcp.' }),
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
