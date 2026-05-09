/**
 * MCP server entrypoint. Loads tool registrations from disk and starts the
 * server over the configured transport.
 *
 * Phase 0 supports stdio transport only (the primary path for local-agent
 * integration: Claude Desktop, Continue, custom CLI tools). HTTP/SSE
 * transport for remote agents lands in Phase 1+ alongside real OIDC
 * introspection.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAgentContext } from './agent-context.js';
import { createMailboxListHandler } from './handlers/mailbox-list.js';
import {
  createSessionGetHandler,
  loadSessionGetDeps,
} from './handlers/session-get.js';
import type { ToolHandler } from './invocation.js';
import { createIarsmaMcpServer } from './server.js';
import { loadTools } from './tool-loader.js';

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..', '..');
  const defaultToolsDir = path.resolve(
    repoRoot,
    'tools',
    'codegen',
    'dist',
    'tools',
  );
  const toolsDir = process.env['IARSMA_TOOLS_DIR'] ?? defaultToolsDir;

  // eslint-disable-next-line no-console
  console.error(`[iarsma-mcp] loading tools from ${toolsDir}`);
  const tools = await loadTools(toolsDir);
  // eslint-disable-next-line no-console
  console.error(`[iarsma-mcp] loaded ${tools.size} tool(s): ${[...tools.keys()].join(', ')}`);

  const agentContext = loadAgentContext(process.env);
  if (agentContext === null) {
    // eslint-disable-next-line no-console
    console.error(
      '[iarsma-mcp] IARSMA_WEBMAIL_MCP_URL unset — discovery URN ' +
        'urn:iarsma:agent-context will NOT be advertised this run.',
    );
  } else {
    // eslint-disable-next-line no-console
    console.error(
      `[iarsma-mcp] advertising urn:iarsma:agent-context: ${JSON.stringify(agentContext)}`,
    );
  }

  // Wire real handlers for Phase 0. Currently only `session.get`. As more
  // capabilities land, each gets its own factory in `handlers/` and a
  // line below mapping the tool name to the resolved handler.
  const handlers = new Map<string, ToolHandler>();
  const sessionGetDeps = loadSessionGetDeps(process.env);
  if (sessionGetDeps === null) {
    // eslint-disable-next-line no-console
    console.error(
      '[iarsma-mcp] IARSMA_JMAP_BASE_URL or IARSMA_AGENT_TOKEN unset — ' +
        '`session.get` will surface as not_implemented this run.',
    );
  } else {
    handlers.set('session.get', createSessionGetHandler(sessionGetDeps));
    // mailbox.list shares the same JMAP-base-URL + bearer-token deps —
    // resolve once and wire both. Each handler does its own session
    // fetch internally; in-process session caching arrives with the
    // Phase 1 storage layer (item 8).
    handlers.set('mailbox.list', createMailboxListHandler(sessionGetDeps));
    // eslint-disable-next-line no-console
    console.error(
      `[iarsma-mcp] session.get + mailbox.list wired against ${sessionGetDeps.jmapBaseUrl}`,
    );
  }

  const server = createIarsmaMcpServer({
    tools,
    handlers,
    ...(agentContext !== null ? { agentContext } : {}),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error('[iarsma-mcp] connected via stdio. Awaiting requests...');
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[iarsma-mcp] fatal:', e);
    process.exit(1);
  });
}

export { createIarsmaMcpServer, AGENT_CONTEXT_URN } from './server.js';
export {
  agentContextCapability,
  loadAgentContext,
  AgentContextError,
} from './agent-context.js';
export type { AgentContextUrn } from './agent-context.js';
export {
  createSessionGetHandler,
  loadSessionGetDeps,
  SessionGetConfigError,
} from './handlers/session-get.js';
export type { Session, SessionGetDeps } from './handlers/session-get.js';
export {
  createMailboxListHandler,
  loadMailboxListDeps,
  MailboxListConfigError,
} from './handlers/mailbox-list.js';
export type { Mailbox, MailboxRights, MailboxListDeps } from './handlers/mailbox-list.js';
export { loadTools, ToolLoadError } from './tool-loader.js';
export type { ToolRegistration } from './tool-loader.js';
export { extractIdentity, AuthError, headersFromObject } from './auth.js';
export type { AgentIdentity, HeadersLike } from './auth.js';
export { makeScopeSet, hasAllScopes, visibleTools } from './scope-filter.js';
export type { ScopeSet } from './scope-filter.js';
export { createDispatcher } from './invocation.js';
export type {
  Dispatcher,
  DispatcherDeps,
  InvocationOptions,
  InvocationResult,
  ToolHandler,
} from './invocation.js';
