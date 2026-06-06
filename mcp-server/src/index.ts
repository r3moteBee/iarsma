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
import { stalwartIntrospectionTokenStore } from './stalwart-introspection-token-store.js';
import { stalwartSessionTokenStore } from './stalwart-session-token-store.js';
import { fileTokenStore, type TokenStore } from './token-store.js';
import { createFilesListHandler } from './handlers/files-list.js';
import { createFilesReadHandler } from './handlers/files-read.js';
import { createFilesProposeWriteHandler } from './handlers/files-propose-write.js';
import { loadGithubConfigStore } from './github-config.js';
import { createMailDeleteHandler } from './handlers/mail-delete.js';
import { createMailDraftHandler } from './handlers/mail-draft.js';
import { createMailModifyHandler } from './handlers/mail-modify.js';
import { createMailSendHandler } from './handlers/mail-send.js';
import { createMailboxListHandler } from './handlers/mailbox-list.js';
import {
  createSessionGetHandler,
  loadSessionGetDeps,
} from './handlers/session-get.js';
import { createThreadGetHandler } from './handlers/thread-get.js';
import { createThreadListHandler } from './handlers/thread-list.js';
import { createThreadSearchHandler } from './handlers/thread-search.js';
import {
  loadHttpTransportConfig,
  startHttpTransport,
} from './http-transport.js';
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
      '[iarsma-mcp] IARSMA_JMAP_BASE_URL unset — JMAP-backed ' +
        'capabilities will surface as not_implemented this run. ' +
        'Per-request bearers (D-057) still need IARSMA_JMAP_BASE_URL ' +
        'to know which Stalwart to call.',
    );
  } else {
    handlers.set('session.get', createSessionGetHandler(sessionGetDeps));
    // All capabilities share the JMAP-base-URL + bearer-token deps,
    // so we resolve once and wire each. Each handler does its own
    // session fetch internally; in-process session caching arrives
    // with the Phase 1 storage layer (already shipped for the
    // browser; mcp-server is still fresh-per-call until Phase 3).
    handlers.set('mailbox.list', createMailboxListHandler(sessionGetDeps));
    handlers.set('thread.list', createThreadListHandler(sessionGetDeps));
    handlers.set('thread.get', createThreadGetHandler(sessionGetDeps));
    handlers.set('thread.search', createThreadSearchHandler(sessionGetDeps));
    handlers.set('mail.draft', createMailDraftHandler(sessionGetDeps));
    handlers.set('mail.send', createMailSendHandler(sessionGetDeps));
    handlers.set('mail.modify', createMailModifyHandler(sessionGetDeps));
    handlers.set('mail.delete', createMailDeleteHandler(sessionGetDeps));
    // eslint-disable-next-line no-console
    console.error(
      `[iarsma-mcp] capabilities wired against ${sessionGetDeps.jmapBaseUrl}: ` +
        'session.get, mailbox.list, thread.list, thread.get, thread.search, mail.draft, mail.send, mail.modify, mail.delete',
    );
  }

  // Phase 5b: files.* capabilities. The MCP server is read-only against
  // GitHub; writes happen browser-side after human approval (D-053). The
  // GitHub config is loaded from env vars / `run/github-config.json` —
  // unset means files.* return `not_configured` rather than absent so
  // agents see the tool and learn how to enable it.
  const githubConfigStore = loadGithubConfigStore(process.env);
  process.on('SIGHUP', () => {
    githubConfigStore.reload();
    // eslint-disable-next-line no-console
    console.error('[iarsma-mcp] SIGHUP received — reloaded GitHub config');
  });
  handlers.set('files.list', createFilesListHandler(githubConfigStore));
  handlers.set('files.read', createFilesReadHandler(githubConfigStore));
  if (sessionGetDeps !== null) {
    handlers.set(
      'files.propose_write',
      createFilesProposeWriteHandler({
        configStore: githubConfigStore,
        jmapBaseUrl: sessionGetDeps.jmapBaseUrl,
      }),
    );
  }
  // eslint-disable-next-line no-console
  console.error(
    `[iarsma-mcp] files.* wired (config ${githubConfigStore.current() === null ? 'NOT set — set IARSMA_GITHUB_TOKEN/OWNER/REPO or write run/github-config.json' : 'present'})`,
  );

  const stdioServer = createIarsmaMcpServer({
    tools,
    handlers,
    ...(agentContext !== null ? { agentContext } : {}),
  });
  const transport = new StdioServerTransport();
  await stdioServer.connect(transport);
  // eslint-disable-next-line no-console
  console.error('[iarsma-mcp] connected via stdio. Awaiting requests...');

  // Optional Streamable HTTP transport (Phase 2 item 10a). Each
  // transport needs its own Server instance — the SDK couples them
  // 1:1 via the Protocol layer. The handlers map is shared so both
  // surfaces expose the same tool list.
  const httpConfig = loadHttpTransportConfig(process.env);
  if (httpConfig !== null) {
    // Token store selection (D-058 precedence):
    //
    //   1. **session-validate** (default, D-058): when
    //      `IARSMA_JMAP_BASE_URL` is set, every request's bearer is
    //      validated by making a JMAP `/.well-known/jmap` call. Works
    //      for Stalwart API keys (created via the webmail's
    //      `x:ApiKey/set` flow) and any other Stalwart-issued
    //      bearer that authenticates against JMAP. No operator
    //      credential.
    //   2. **introspection** (D-057, legacy OAuth deploys): set
    //      `IARSMA_INTROSPECTION_ADMIN_TOKEN` to force the older
    //      OAuth introspection path. Only useful for deploys that
    //      still issue agent tokens through `oauth/token`
    //      `client_credentials` instead of `x:ApiKey/set`.
    //   3. **tokens.json** (legacy single-host): `IARSMA_TOKENS_FILE`.
    //   4. None: only the static `IARSMA_MCP_HTTP_TOKEN` verifier.
    let tokenStore: TokenStore | undefined;
    let tokenStoreLabel = '<none — legacy IARSMA_MCP_HTTP_TOKEN only>';
    const adminToken = process.env['IARSMA_INTROSPECTION_ADMIN_TOKEN']?.trim();
    const introspectionIssuer =
      process.env['IARSMA_INTROSPECTION_ISSUER_URL']?.trim() ??
      sessionGetDeps?.jmapBaseUrl;
    if (adminToken !== undefined && adminToken !== '' && introspectionIssuer !== undefined) {
      tokenStore = stalwartIntrospectionTokenStore({
        issuerUrl: introspectionIssuer,
        adminToken,
      });
      tokenStoreLabel = `stalwart-introspection @ ${introspectionIssuer}`;
    } else if (sessionGetDeps !== null) {
      tokenStore = stalwartSessionTokenStore({
        jmapBaseUrl: sessionGetDeps.jmapBaseUrl,
      });
      tokenStoreLabel = `stalwart-session @ ${sessionGetDeps.jmapBaseUrl}`;
    } else {
      const tokensFile = process.env['IARSMA_TOKENS_FILE'];
      if (tokensFile !== undefined && tokensFile !== '') {
        const fileStore = fileTokenStore(tokensFile);
        tokenStore = fileStore;
        tokenStoreLabel = `file-store ${tokensFile}`;
        process.on('SIGHUP', () => {
          // eslint-disable-next-line no-console
          console.error('[iarsma-mcp] SIGHUP received — reloading token store');
          fileStore.reload();
        });
      }
    }

    const makeServer = () => createIarsmaMcpServer({
      tools,
      handlers,
      ...(agentContext !== null ? { agentContext } : {}),
    });
    const { port } = await startHttpTransport({
      config: { ...httpConfig, tokenStore },
      mcpServer: makeServer(),
      createServer: makeServer,
    });
    // eslint-disable-next-line no-console
    console.error(
      `[iarsma-mcp] Streamable HTTP transport listening on ${httpConfig.host ?? '0.0.0.0'}:${port}. POST /mcp with Authorization: Bearer <token>. Token store: ${tokenStoreLabel}`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.error(
      '[iarsma-mcp] HTTP transport disabled — set IARSMA_MCP_HTTP_PORT to enable.',
    );
  }
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
export {
  createThreadListHandler,
  loadThreadListDeps,
  ThreadListConfigError,
} from './handlers/thread-list.js';
export type {
  EmailAddress,
  EmailSummary,
  Keyword,
  ThreadList,
  ThreadListDeps,
  ThreadSummary,
} from './handlers/thread-list.js';
export {
  createThreadGetHandler,
  loadThreadGetDeps,
  ThreadGetConfigError,
} from './handlers/thread-get.js';
export type {
  Attachment,
  EmailFull,
  Thread,
  ThreadGet,
  ThreadGetDeps,
} from './handlers/thread-get.js';
export {
  createMailSendHandler,
  loadMailSendDeps,
  MailSendConfigError,
} from './handlers/mail-send.js';
export type {
  MailSendDeps,
  MailSendInput,
  MailSendResult,
} from './handlers/mail-send.js';
export {
  createMailModifyHandler,
  loadMailModifyDeps,
  MailModifyConfigError,
} from './handlers/mail-modify.js';
export type {
  MailModifyDeps,
  MailModifyInput,
  MailModifyPatch,
  MailModifyResult,
} from './handlers/mail-modify.js';
export {
  createMailDeleteHandler,
  loadMailDeleteDeps,
  MailDeleteConfigError,
} from './handlers/mail-delete.js';
export type {
  MailDeleteDeps,
  MailDeleteInput,
  MailDeletePreview,
  MailDeleteResult,
} from './handlers/mail-delete.js';
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
