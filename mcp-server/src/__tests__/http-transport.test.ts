/**
 * Tests for the Streamable HTTP transport (Phase 2 work item 10a).
 *
 * Covers:
 *   - loadHttpTransportConfig env-var gating
 *   - 401 on missing / wrong Bearer
 *   - 200 OK on /healthz (no auth)
 *   - 404 on unknown paths
 *   - Transport routes a valid POST to the MCP server (smoke — full
 *     MCP handshake is exercised by the SDK's own tests; here we
 *     just confirm our auth gate + router don't block correct
 *     requests).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { loadTools } from '../tool-loader.js';
import { createIarsmaMcpServer } from '../server.js';
import {
  loadHttpTransportConfig,
  startHttpTransport,
  readApproval,
} from '../http-transport.js';
import path from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeScopeSet } from '../scope-filter.js';
import type { ResolvedIdentity, TokenEntry, TokenStore } from '../token-store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.resolve(here, '..', '..', '..', 'tools', 'codegen', 'dist', 'tools');

describe('loadHttpTransportConfig', () => {
  it('returns null when port is missing', () => {
    expect(loadHttpTransportConfig({})).toBeNull();
    expect(loadHttpTransportConfig({ IARSMA_MCP_HTTP_TOKEN: 'tok' })).toBeNull();
  });

  it('returns config with only port set — token is optional under introspection', () => {
    const c = loadHttpTransportConfig({ IARSMA_MCP_HTTP_PORT: '8765' });
    expect(c).toEqual({ port: 8765 });
  });

  it('returns config when port + legacy token are set', () => {
    const c = loadHttpTransportConfig({
      IARSMA_MCP_HTTP_PORT: '8765',
      IARSMA_MCP_HTTP_TOKEN: 'tok',
    });
    expect(c).toEqual({ port: 8765, bearerToken: 'tok' });
  });

  it('honors IARSMA_MCP_HTTP_HOST when set', () => {
    const c = loadHttpTransportConfig({
      IARSMA_MCP_HTTP_PORT: '8765',
      IARSMA_MCP_HTTP_TOKEN: 'tok',
      IARSMA_MCP_HTTP_HOST: '127.0.0.1',
    });
    expect(c?.host).toBe('127.0.0.1');
  });

  it('parses IARSMA_MCP_HTTP_CORS_ORIGINS into an allowlist', () => {
    const c = loadHttpTransportConfig({
      IARSMA_MCP_HTTP_PORT: '8765',
      IARSMA_MCP_HTTP_CORS_ORIGINS: ' https://mail.example.test , ,https://other.test',
    });
    expect(c?.corsOrigins).toEqual(['https://mail.example.test', 'https://other.test']);
  });

  it('throws on a non-integer port', () => {
    expect(() =>
      loadHttpTransportConfig({
        IARSMA_MCP_HTTP_PORT: 'oops',
        IARSMA_MCP_HTTP_TOKEN: 'tok',
      }),
    ).toThrow(/integer/);
  });
});

describe('startHttpTransport — gating + routing', () => {
  let close: (() => Promise<void>) | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    const tools = await loadTools(toolsDir);
    const mcpServer = createIarsmaMcpServer({ tools });
    const r = await startHttpTransport({
      config: { port: 0, bearerToken: 'secret-token', host: '127.0.0.1' },
      mcpServer,
    });
    close = r.close;
    baseUrl = `http://127.0.0.1:${r.port}`;
  });

  afterEach(async () => {
    if (close !== null) await close();
    close = null;
  });

  it('200 OK on /healthz with no auth', async () => {
    const r = await fetch(`${baseUrl}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
  });

  it('404 on unknown paths', async () => {
    const r = await fetch(`${baseUrl}/nope`);
    expect(r.status).toBe(404);
  });

  it('401 when Authorization header is missing on /mcp', async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('401 when Bearer token mismatches', async () => {
    const r = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong-token',
      },
      body: '{}',
    });
    expect(r.status).toBe(401);
  });

  it('does NOT return 401 when the Bearer token matches (routes to MCP)', async () => {
    // We send a malformed JSON-RPC body; the MCP transport will
    // respond with an MCP-shaped error (400/500), but NOT 401 — the
    // auth gate has already let us through.
    const r = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer secret-token',
      },
      body: '{"not": "a valid JSON-RPC request"}',
    });
    expect(r.status).not.toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Hardening: auth-before-session, session lifecycle, body cap, /agents,
//  CORS.
// ─────────────────────────────────────────────────────────────────────────

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
});

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function identity(id: string): ResolvedIdentity {
  return { id, name: id, scopes: makeScopeSet([]) };
}

/** Token store that knows two agent bearers; spies on the mutators. */
function stubTokenStore(): TokenStore & {
  register: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  const known: Record<string, ResolvedIdentity> = {
    'agent-a-token': identity('agent-a'),
    'agent-b-token': identity('agent-b'),
  };
  const entry: TokenEntry = {
    secret: 's', name: 'n', scopes: [], tokenId: 'tid-1', stalwartKeyId: 'key-1',
  };
  return {
    resolve: async (bearer: string) => known[bearer] ?? null,
    reload: () => {},
    register: vi.fn(),
    remove: vi.fn(() => entry),
    list: vi.fn(() => [entry]),
  };
}

type Harness = {
  readonly baseUrl: string;
  readonly sessionCount: () => number;
  readonly serversCreated: () => number;
  /** Servers the factory produced that are still attached to a transport. */
  readonly serversConnected: () => number;
  readonly close: () => Promise<void>;
};

async function startHarness(
  config: Partial<Parameters<typeof startHttpTransport>[0]['config']> = {},
): Promise<Harness> {
  const tools = await loadTools(toolsDir);
  const servers: ReturnType<typeof createIarsmaMcpServer>[] = [];
  const makeServer = () => {
    const s = createIarsmaMcpServer({ tools });
    servers.push(s);
    return s;
  };
  const r = await startHttpTransport({
    config: { port: 0, host: '127.0.0.1', tokenStore: stubTokenStore(), ...config },
    mcpServer: createIarsmaMcpServer({ tools }),
    createServer: makeServer,
  });
  return {
    baseUrl: `http://127.0.0.1:${r.port}`,
    sessionCount: r.sessionCount,
    serversCreated: () => servers.length,
    serversConnected: () => servers.filter((s) => s.transport !== undefined).length,
    close: r.close,
  };
}

async function initialize(h: Harness, bearer = 'agent-a-token'): Promise<string> {
  const r = await fetch(`${h.baseUrl}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, authorization: `Bearer ${bearer}` },
    body: INIT_BODY,
  });
  expect(r.status).toBe(200);
  await r.text();
  const id = r.headers.get('mcp-session-id');
  expect(id).toBeTruthy();
  return id!;
}

function listTools(h: Harness, sessionId: string, bearer = 'agent-a-token'): Promise<Response> {
  return fetch(`${h.baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      ...MCP_HEADERS,
      authorization: `Bearer ${bearer}`,
      'mcp-session-id': sessionId,
      'mcp-protocol-version': '2025-03-26',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
}

describe('startHttpTransport — session lifecycle', () => {
  let h: Harness | null = null;

  afterEach(async () => {
    if (h !== null) await h.close();
    h = null;
  });

  it('unauthenticated initialize allocates no server or session', async () => {
    h = await startHarness();
    for (const auth of [undefined, 'Bearer bogus']) {
      const r = await fetch(`${h.baseUrl}/mcp`, {
        method: 'POST',
        headers: { ...MCP_HEADERS, ...(auth !== undefined ? { authorization: auth } : {}) },
        body: INIT_BODY,
      });
      expect(r.status).toBe(401);
    }
    expect(h.serversCreated()).toBe(0);
    expect(h.sessionCount()).toBe(0);
  });

  it('a valid client initializes, then reuses its session', async () => {
    h = await startHarness();
    const id = await initialize(h);
    expect(h.sessionCount()).toBe(1);
    const r = await listTools(h, id);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('"tools"');
    expect(h.serversCreated()).toBe(1);
  });

  it('non-initialize requests without a session id allocate nothing', async () => {
    h = await startHarness();
    const r = await fetch(`${h.baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, authorization: 'Bearer agent-a-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    expect(r.status).toBe(400);
    const g = await fetch(`${h.baseUrl}/mcp`, {
      headers: { accept: 'text/event-stream', authorization: 'Bearer agent-a-token' },
    });
    expect(g.status).toBe(400);
    expect(h.serversCreated()).toBe(0);
  });

  it('unknown session ids get 404 without allocating', async () => {
    h = await startHarness();
    const r = await listTools(h, 'not-a-session');
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: { code: number } }).error.code).toBe(-32001);
    expect(h.serversCreated()).toBe(0);
  });

  it('a session is bound to the identity that created it', async () => {
    h = await startHarness();
    const id = await initialize(h, 'agent-a-token');
    const r = await listTools(h, id, 'agent-b-token');
    expect(r.status).toBe(404);
    expect((await listTools(h, id, 'agent-a-token')).status).toBe(200);
  });

  it('a failed initialize (bad Accept header) does not leak a session', async () => {
    h = await startHarness();
    const r = await fetch(`${h.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer agent-a-token' },
      body: INIT_BODY,
    });
    expect(r.status).toBe(406);
    expect(h.sessionCount()).toBe(0);
    expect(h.serversCreated()).toBe(1);
    await vi.waitFor(() => expect(h!.serversConnected()).toBe(0));
  });

  it('DELETE closes the session and prunes it from the table', async () => {
    h = await startHarness();
    const id = await initialize(h);
    const d = await fetch(`${h.baseUrl}/mcp`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer agent-a-token', 'mcp-session-id': id },
    });
    expect(d.status).toBe(200);
    expect(h.sessionCount()).toBe(0);
    expect(h.serversConnected()).toBe(0);
    expect((await listTools(h, id)).status).toBe(404);
  });

  it('idle sessions expire after sessionIdleTtlMs', async () => {
    h = await startHarness({ sessionIdleTtlMs: 40 });
    const id = await initialize(h);
    expect(h.sessionCount()).toBe(1);
    await vi.waitFor(() => expect(h!.sessionCount()).toBe(0), { timeout: 2_000, interval: 20 });
    expect((await listTools(h, id)).status).toBe(404);
  });

  it('the idle sweep spares a session with an open SSE stream', async () => {
    h = await startHarness({ sessionIdleTtlMs: 40 });
    const id = await initialize(h);
    const abort = new AbortController();
    const stream = await fetch(`${h.baseUrl}/mcp`, {
      headers: {
        accept: 'text/event-stream',
        authorization: 'Bearer agent-a-token',
        'mcp-session-id': id,
        'mcp-protocol-version': '2025-03-26',
      },
      signal: abort.signal,
    });
    expect(stream.status).toBe(200);
    // Several sweep intervals pass while the stream stays open.
    await new Promise((r) => setTimeout(r, 200));
    expect(h.sessionCount()).toBe(1);
    abort.abort();
    // Once the stream closes, the session idles out normally.
    await vi.waitFor(() => expect(h!.sessionCount()).toBe(0), { timeout: 2_000, interval: 20 });
  });

  it('maxSessions evicts the least-recently-used session', async () => {
    h = await startHarness({ maxSessions: 2 });
    const first = await initialize(h);
    const second = await initialize(h);
    // Touch `first` so `second` becomes the LRU.
    expect((await listTools(h, first)).status).toBe(200);
    const third = await initialize(h);
    expect(h.sessionCount()).toBe(2);
    expect((await listTools(h, second)).status).toBe(404);
    expect((await listTools(h, first)).status).toBe(200);
    expect((await listTools(h, third)).status).toBe(200);
  });

  it('the per-identity cap evicts the caller\'s own oldest session, not other tenants\'', async () => {
    h = await startHarness({ maxSessionsPerIdentity: 2, maxSessions: 10 });
    const bSession = await initialize(h, 'agent-b-token');
    const a1 = await initialize(h, 'agent-a-token');
    // agent-b's session is now the global LRU; agent-a churns on.
    const a2 = await initialize(h, 'agent-a-token');
    const a3 = await initialize(h, 'agent-a-token');
    expect(h.sessionCount()).toBe(3);
    expect((await listTools(h, a1)).status).toBe(404);
    expect((await listTools(h, a2)).status).toBe(200);
    expect((await listTools(h, a3)).status).toBe(200);
    expect((await listTools(h, bSession, 'agent-b-token')).status).toBe(200);
  });

  it('close() shuts every open session', async () => {
    h = await startHarness();
    await initialize(h);
    await initialize(h, 'agent-b-token');
    const count = h.sessionCount;
    await h.close();
    h = null;
    expect(count()).toBe(0);
  });
});

describe('startHttpTransport — request body cap', () => {
  let h: Harness | null = null;

  afterEach(async () => {
    if (h !== null) await h.close();
    h = null;
  });

  it('413 for a body over maxBodyBytes, before any session exists', async () => {
    h = await startHarness({ maxBodyBytes: 1024 });
    const r = await fetch(`${h.baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, authorization: 'Bearer agent-a-token' },
      body: JSON.stringify({ pad: 'x'.repeat(4096) }),
    });
    expect(r.status).toBe(413);
    expect(h.serversCreated()).toBe(0);
  });

  it('413 for an oversized chunked body (no Content-Length to pre-check)', async () => {
    h = await startHarness({ maxBodyBytes: 1024 });
    const chunk = new TextEncoder().encode('x'.repeat(512));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 8) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const r = await fetch(`${h.baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, authorization: 'Bearer agent-a-token' },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(r.status).toBe(413);
    expect(h.serversCreated()).toBe(0);
  });

  it('a body within the cap still goes through', async () => {
    h = await startHarness({ maxBodyBytes: 1024 });
    await initialize(h);
  });
});

describe('startHttpTransport — /agents endpoints', () => {
  const JMAP_BASE = 'https://stalwart.example.test';
  let h: Harness | null = null;
  let store: ReturnType<typeof stubTokenStore>;
  let fetchCalls: string[];

  /** Stalwart stub: `user-token` is a valid user; everything else 401. */
  const stalwartFetch = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push(url);
    const auth = ((init?.headers ?? {}) as Record<string, string>)['authorization'];
    if (auth !== 'Bearer user-token') return new Response('', { status: 401 });
    if (url === `${JMAP_BASE}/.well-known/jmap`) {
      return Response.json({ apiUrl: '/jmap/', username: 'brent@example.test' });
    }
    if (url === `${JMAP_BASE}/jmap/`) {
      return Response.json({
        methodResponses: [['x:ApiKey/set', { created: { c0: { id: 'key-9', secret: 'stalwart-secret' } }, destroyed: ['key-1'] }, '0']],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;

  beforeEach(() => {
    store = stubTokenStore();
    fetchCalls = [];
  });

  afterEach(async () => {
    if (h !== null) await h.close();
    h = null;
  });

  it('management routes are 404 unless agent management is enabled (file-store mode)', async () => {
    h = await startHarness({ tokenStore: store });
    for (const [method, p] of [['GET', '/agents'], ['DELETE', '/agents/tid-1'], ['POST', '/agents/register']] as const) {
      const r = await fetch(`${h.baseUrl}${p}`, { method, headers: { authorization: 'Bearer anything' } });
      expect(r.status).toBe(404);
    }
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();
  });

  it('rejects a bogus bearer on every management route', async () => {
    h = await startHarness({ tokenStore: store, agentManagement: { jmapBaseUrl: JMAP_BASE, fetch: stalwartFetch } });
    for (const [method, p] of [['GET', '/agents'], ['DELETE', '/agents/tid-1'], ['POST', '/agents/register']] as const) {
      const r = await fetch(`${h.baseUrl}${p}`, {
        method,
        headers: { authorization: 'Bearer bogus', 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ name: 'x', scopes: [] }) } : {}),
      });
      expect(r.status).toBe(401);
    }
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.list).not.toHaveBeenCalled();
    expect(store.register).not.toHaveBeenCalled();
  });

  it('503 when management is enabled without a JMAP base URL', async () => {
    h = await startHarness({ tokenStore: store, agentManagement: {} });
    const r = await fetch(`${h.baseUrl}/agents`, { headers: { authorization: 'Bearer user-token' } });
    expect(r.status).toBe(503);
  });

  it('register ignores a request-supplied jmapUrl and only talks to the configured Stalwart', async () => {
    h = await startHarness({ tokenStore: store, agentManagement: { jmapBaseUrl: JMAP_BASE, fetch: stalwartFetch } });
    const r = await fetch(`${h.baseUrl}/agents/register`, {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bot', scopes: ['mail:read'], jmapUrl: 'https://attacker.example/steal' }),
    });
    expect(r.status).toBe(201);
    expect(fetchCalls.every((u) => u.startsWith(`${JMAP_BASE}/`))).toBe(true);
    expect(fetchCalls).toContain(`${JMAP_BASE}/jmap/`);
    expect(store.register).toHaveBeenCalledOnce();
  });

  it('DELETE ignores a jmapUrl query parameter', async () => {
    h = await startHarness({ tokenStore: store, agentManagement: { jmapBaseUrl: JMAP_BASE, fetch: stalwartFetch } });
    const r = await fetch(`${h.baseUrl}/agents/tid-1?jmapUrl=${encodeURIComponent('https://attacker.example/')}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer user-token' },
    });
    expect(r.status).toBe(200);
    expect(store.remove).toHaveBeenCalledWith('tid-1');
    expect(fetchCalls.every((u) => u.startsWith(`${JMAP_BASE}/`))).toBe(true);
  });

  it('approval polling requires an agent bearer that resolves', async () => {
    h = await startHarness({ tokenStore: store });
    const bad = await fetch(`${h.baseUrl}/agents/approvals/a-1`, { headers: { authorization: 'Bearer bogus' } });
    expect(bad.status).toBe(401);
    const good = await fetch(`${h.baseUrl}/agents/approvals/a-1`, { headers: { authorization: 'Bearer agent-a-token' } });
    // Authenticated; no approvals file in the test env, so not found.
    expect(good.status).toBe(404);
  });
});

describe('startHttpTransport — CORS', () => {
  let h: Harness | null = null;

  afterEach(async () => {
    if (h !== null) await h.close();
    h = null;
  });

  it('sends no Access-Control-Allow-Origin by default', async () => {
    h = await startHarness();
    const r = await fetch(`${h.baseUrl}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('echoes only allowlisted origins', async () => {
    h = await startHarness({ corsOrigins: ['https://mail.example.test'] });
    const ok = await fetch(`${h.baseUrl}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://mail.example.test' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://mail.example.test');
    expect(ok.headers.get('access-control-allow-headers')).toContain('mcp-session-id');
    expect(ok.headers.get('access-control-expose-headers')).toBe('mcp-session-id');
    const evil = await fetch(`${h.baseUrl}/mcp`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('readApproval', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'iarsma-approvals-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns pending status for a pending approval', () => {
    const filePath = path.join(tmpDir, 'approvals.json');
    writeFileSync(filePath, JSON.stringify([{ id: 'a-1', status: 'pending' }]));
    const result = readApproval('a-1', filePath);
    expect(result).toEqual({ status: 'pending' });
  });

  it('returns approved status with result', () => {
    const filePath = path.join(tmpDir, 'approvals.json');
    writeFileSync(filePath, JSON.stringify([
      { id: 'a-1', status: 'approved', result: { emailId: 'E-42' } },
    ]));
    const result = readApproval('a-1', filePath);
    expect(result).toEqual({ status: 'approved', result: { emailId: 'E-42' } });
  });

  it('returns denied status with reason', () => {
    const filePath = path.join(tmpDir, 'approvals.json');
    writeFileSync(filePath, JSON.stringify([
      { id: 'a-1', status: 'denied', reason: 'User declined.' },
    ]));
    const result = readApproval('a-1', filePath);
    expect(result).toEqual({ status: 'denied', reason: 'User declined.' });
  });

  it('returns null when approval ID is not found', () => {
    const filePath = path.join(tmpDir, 'approvals.json');
    writeFileSync(filePath, JSON.stringify([{ id: 'a-1', status: 'pending' }]));
    const result = readApproval('a-nonexistent', filePath);
    expect(result).toBeNull();
  });

  it('returns null when file does not exist', () => {
    const result = readApproval('a-1', path.join(tmpDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });
});
