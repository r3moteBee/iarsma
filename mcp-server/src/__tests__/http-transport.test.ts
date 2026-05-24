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

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { loadTools } from '../tool-loader.js';
import { createIarsmaMcpServer } from '../server.js';
import {
  loadHttpTransportConfig,
  startHttpTransport,
  readApproval,
} from '../http-transport.js';
import path from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const toolsDir = path.resolve(here, '..', '..', '..', 'tools', 'codegen', 'dist', 'tools');

describe('loadHttpTransportConfig', () => {
  it('returns null when port or token is missing', () => {
    expect(loadHttpTransportConfig({})).toBeNull();
    expect(loadHttpTransportConfig({ IARSMA_MCP_HTTP_PORT: '8765' })).toBeNull();
    expect(
      loadHttpTransportConfig({ IARSMA_MCP_HTTP_TOKEN: 'tok' }),
    ).toBeNull();
  });

  it('returns config when both env vars are set', () => {
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
