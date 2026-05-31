/**
 * Tests for the discovery URN scaffold (D-032 / Phase 0 work item 14).
 *
 * Pin the env-var resolution contract and the URN advertisement shape
 * before later phases (action-log endpoint, OB1 memory backend) start
 * populating the optional fields.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_CONTEXT_URN,
  AgentContextError,
  agentContextCapability,
  loadAgentContext,
} from '../agent-context.js';
import { createIarsmaMcpServer } from '../server.js';

describe('loadAgentContext', () => {
  it('returns null when the required webmail URL is unset', () => {
    expect(loadAgentContext({})).toBeNull();
    expect(loadAgentContext({ IARSMA_WEBMAIL_MCP_URL: '' })).toBeNull();
    expect(loadAgentContext({ IARSMA_WEBMAIL_MCP_URL: '   ' })).toBeNull();
  });

  it('populates only the webmail URL when the optional vars are unset', () => {
    const ctx = loadAgentContext({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.version).toBe(1);
    expect(ctx?.webmailMcpUrl).toBe('https://sw-mail.example.net/mcp');
    expect(ctx?.actionLogUrl).toBeUndefined();
    expect(ctx?.memoryBackendUrl).toBeUndefined();
  });

  it('passes optional URLs through when set', () => {
    const ctx = loadAgentContext({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
      IARSMA_ACTION_LOG_URL: 'https://sw-mail.example.net/log',
      IARSMA_MEMORY_BACKEND_URL: 'https://ob1.example.net/mcp',
    });
    expect(ctx?.actionLogUrl).toBe('https://sw-mail.example.net/log');
    expect(ctx?.memoryBackendUrl).toBe('https://ob1.example.net/mcp');
  });

  it('trims whitespace around URL values', () => {
    const ctx = loadAgentContext({
      IARSMA_WEBMAIL_MCP_URL: '  https://sw-mail.example.net/mcp  ',
    });
    expect(ctx?.webmailMcpUrl).toBe('https://sw-mail.example.net/mcp');
  });

  it('omits an optional field when its env var is empty/whitespace', () => {
    const ctx = loadAgentContext({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
      IARSMA_ACTION_LOG_URL: '',
      IARSMA_MEMORY_BACKEND_URL: '   ',
    });
    expect(ctx?.actionLogUrl).toBeUndefined();
    expect(ctx?.memoryBackendUrl).toBeUndefined();
  });

  it('throws AgentContextError on a malformed URL', () => {
    expect(() =>
      loadAgentContext({ IARSMA_WEBMAIL_MCP_URL: 'not a url' }),
    ).toThrow(AgentContextError);
    expect(() =>
      loadAgentContext({
        IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
        IARSMA_ACTION_LOG_URL: 'also not a url',
      }),
    ).toThrow(AgentContextError);
  });
});

describe('agentContextCapability', () => {
  it('keys the value under urn:iarsma:agent-context', () => {
    const cap = agentContextCapability({
      version: 1,
      webmailMcpUrl: 'https://sw-mail.example.net/mcp',
    });
    expect(Object.keys(cap)).toEqual([AGENT_CONTEXT_URN]);
    expect(cap[AGENT_CONTEXT_URN]?.webmailMcpUrl).toBe(
      'https://sw-mail.example.net/mcp',
    );
    expect(cap[AGENT_CONTEXT_URN]?.version).toBe(1);
  });

  it('preserves optional fields without renaming or stripping', () => {
    const ctx = {
      version: 1 as const,
      webmailMcpUrl: 'https://sw-mail.example.net/mcp',
      actionLogUrl: 'https://sw-mail.example.net/log',
      memoryBackendUrl: 'https://ob1.example.net/mcp',
    };
    const cap = agentContextCapability(ctx);
    expect(cap[AGENT_CONTEXT_URN]).toEqual(ctx);
  });
});

describe('createIarsmaMcpServer URN advertisement', () => {
  it('does not advertise the URN when agentContext is omitted', () => {
    const server = createIarsmaMcpServer({ tools: new Map() });
    const caps = (server as unknown as { _capabilities: Record<string, unknown> })
      ._capabilities;
    expect(caps['tools']).toBeDefined();
    expect(caps[AGENT_CONTEXT_URN]).toBeUndefined();
  });

  it('advertises the URN under capabilities when agentContext is supplied', () => {
    const ctx = {
      version: 1 as const,
      webmailMcpUrl: 'https://sw-mail.example.net/mcp',
      actionLogUrl: 'https://sw-mail.example.net/log',
    };
    const server = createIarsmaMcpServer({ tools: new Map(), agentContext: ctx });
    const caps = (server as unknown as { _capabilities: Record<string, unknown> })
      ._capabilities;
    expect(caps[AGENT_CONTEXT_URN]).toEqual(ctx);
    expect(caps['tools']).toBeDefined();
  });

  it('Phase 5c smoke: env IARSMA_MEMORY_BACKEND_URL flows through to the advertised URN', () => {
    // End-to-end: env → loadAgentContext → createIarsmaMcpServer → caps.
    // Pins the chain so an OB1 deploy that sets the env var actually
    // surfaces the URL in the discovery URN agents read.
    const ctx = loadAgentContext({
      IARSMA_WEBMAIL_MCP_URL: 'https://sw-mail.example.net/mcp',
      IARSMA_MEMORY_BACKEND_URL: 'https://ob1.example.net/mcp',
    });
    expect(ctx).not.toBeNull();
    const server = createIarsmaMcpServer({
      tools: new Map(),
      ...(ctx !== null ? { agentContext: ctx } : {}),
    });
    const caps = (server as unknown as { _capabilities: Record<string, unknown> })
      ._capabilities;
    const advertised = caps[AGENT_CONTEXT_URN] as {
      webmailMcpUrl: string;
      memoryBackendUrl?: string;
    };
    expect(advertised.webmailMcpUrl).toBe('https://sw-mail.example.net/mcp');
    expect(advertised.memoryBackendUrl).toBe('https://ob1.example.net/mcp');
  });
});
