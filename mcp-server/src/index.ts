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

  const server = createIarsmaMcpServer({ tools });
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

export { createIarsmaMcpServer } from './server.js';
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
