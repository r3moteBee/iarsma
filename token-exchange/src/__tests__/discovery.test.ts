/**
 * Discovery payload + `/.well-known/iarsma` route tests (D-048, D-049).
 *
 * Pin the env-var resolution contract and the served-payload shape so
 * any future addition to the URN payload (per D-049 mutation policy)
 * lands as an explicit test diff.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DISCOVERY_VERSION,
  DiscoveryConfigError,
  DiscoveryPayloadSchema,
  loadDiscoveryPayload,
} from '../discovery.js';
import { type Exchanger } from '../exchange.js';
import { buildServer } from '../server.js';

let appsToClose: Array<Awaited<ReturnType<typeof buildServer>>> = [];

afterEach(async () => {
  for (const a of appsToClose) await a.close();
  appsToClose = [];
});

function stubExchanger(): Exchanger {
  return {
    exchange: async () => {
      throw new Error('exchange not used by discovery tests');
    },
  };
}

describe('loadDiscoveryPayload', () => {
  it('returns null when the required webmail URL is unset', () => {
    expect(loadDiscoveryPayload({})).toBeNull();
    expect(loadDiscoveryPayload({ IARSMA_WEBMAIL_MCP_URL: '' })).toBeNull();
    expect(loadDiscoveryPayload({ IARSMA_WEBMAIL_MCP_URL: '   ' })).toBeNull();
  });

  it('stamps the current monotonic-integer schema version (D-049)', () => {
    const payload = loadDiscoveryPayload({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
    });
    expect(payload?.version).toBe(DISCOVERY_VERSION);
    expect(DISCOVERY_VERSION).toBe(1);
  });

  it('passes optional URLs through when set', () => {
    const payload = loadDiscoveryPayload({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
      IARSMA_ACTION_LOG_URL: 'https://sw-mail.example.net/log',
      IARSMA_MEMORY_BACKEND_URL: 'https://ob1.example.net/mcp',
    });
    expect(payload?.actionLogUrl).toBe('https://sw-mail.example.net/log');
    expect(payload?.memoryBackendUrl).toBe('https://ob1.example.net/mcp');
  });

  it('omits an optional field when its env var is empty/whitespace', () => {
    const payload = loadDiscoveryPayload({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
      IARSMA_ACTION_LOG_URL: '',
      IARSMA_MEMORY_BACKEND_URL: '   ',
    });
    expect(payload?.actionLogUrl).toBeUndefined();
    expect(payload?.memoryBackendUrl).toBeUndefined();
  });

  it('throws DiscoveryConfigError on a malformed URL', () => {
    expect(() =>
      loadDiscoveryPayload({ IARSMA_WEBMAIL_MCP_URL: 'not a url' }),
    ).toThrow(DiscoveryConfigError);
  });

  it('always conforms to the published Zod schema', () => {
    const payload = loadDiscoveryPayload({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
      IARSMA_ACTION_LOG_URL: 'https://sw-mail.example.net/log',
    });
    const parsed = DiscoveryPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});

describe('GET /.well-known/iarsma — route', () => {
  it('serves the configured discovery payload as JSON', async () => {
    const app = await buildServer({
      exchanger: stubExchanger(),
      logger: false,
      discovery: {
        version: 1,
        webmailMcpUrl: 'https://sw-mail.example.net/mcp',
        actionLogUrl: 'https://sw-mail.example.net/log',
      },
    });
    appsToClose.push(app);

    const res = await app.inject({ method: 'GET', url: '/.well-known/iarsma' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
    expect(res.json()).toEqual({
      version: 1,
      webmailMcpUrl: 'https://sw-mail.example.net/mcp',
      actionLogUrl: 'https://sw-mail.example.net/log',
    });
  });

  it('matches the schema returned by loadDiscoveryPayload', async () => {
    const payload = loadDiscoveryPayload({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
    });
    expect(payload).not.toBeNull();
    const app = await buildServer({
      exchanger: stubExchanger(),
      logger: false,
      discovery: payload!,
    });
    appsToClose.push(app);
    const res = await app.inject({ method: 'GET', url: '/.well-known/iarsma' });
    const parsed = DiscoveryPayloadSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
  });

  it('returns 404 when discovery is disabled (no payload supplied)', async () => {
    const app = await buildServer({
      exchanger: stubExchanger(),
      logger: false,
      // discovery omitted
    });
    appsToClose.push(app);

    const res = await app.inject({ method: 'GET', url: '/.well-known/iarsma' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when discovery is explicitly null', async () => {
    const app = await buildServer({
      exchanger: stubExchanger(),
      logger: false,
      discovery: null,
    });
    appsToClose.push(app);

    const res = await app.inject({ method: 'GET', url: '/.well-known/iarsma' });
    expect(res.statusCode).toBe(404);
  });
});
