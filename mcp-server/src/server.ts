/**
 * MCP server setup. Wires the request handlers from `@modelcontextprotocol/sdk`
 * to our tool-loader + dispatcher.
 *
 * The SDK is intentionally a thin wrapper here. We want our domain logic
 * (loading, auth, scopes, dispatch) testable without the SDK in the way,
 * which is why server.ts is small and the modules it composes are not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Tool listing (ListToolsRequest)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The SDK's MCP protocol does not, today, surface request-level
 * authentication on `listTools`. For Phase 0 we expose ALL tools to any
 * connected client — the dispatch layer enforces scopes on actual calls.
 *
 * Phase 1+: when the SDK exposes per-request auth context, filter the tool
 * list by the connecting agent's scope set so agents only see what they can
 * call. Until then, listing is informational and dispatch is authoritative.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Tool calls (CallToolRequest)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The SDK's `CallToolRequest` doesn't carry headers in its request shape, so
 * Phase 0 dispatches with an empty scope set unless an `agentScopes` field
 * is provided in the tool arguments. That's a workaround for the stdio
 * transport; the HTTP/SSE transport (Phase 1+) will pull scopes from the
 * Authorization header before reaching this handler.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  AGENT_CONTEXT_URN,
  agentContextCapability,
  type AgentContextUrn,
} from './agent-context.js';
import { createDispatcher, type DispatcherDeps } from './invocation.js';
import { makeScopeSet } from './scope-filter.js';
import type { ToolRegistration } from './tool-loader.js';

export type IarsmaServerOptions = {
  /** Loaded tool registrations, keyed by name. */
  readonly tools: ReadonlyMap<string, ToolRegistration>;
  /** Optional handler map for the dispatcher. */
  readonly handlers?: DispatcherDeps['handlers'];
  /** Server name reported in MCP handshake. */
  readonly name?: string;
  /** Server version reported in MCP handshake. */
  readonly version?: string;
  /**
   * Discovery URN value (D-032 / Phase 0 work item 14). When provided, the
   * server advertises `urn:iarsma:agent-context` alongside `tools` in its
   * MCP capability map. Omit to skip advertisement (dev/test default).
   */
  readonly agentContext?: AgentContextUrn;
};

export function createIarsmaMcpServer(opts: IarsmaServerOptions): Server {
  // Conditional spread: with exactOptionalPropertyTypes, an explicit
  // `handlers: undefined` is not assignable to `handlers?: Map`.
  // Only include the field when we have a real value.
  const dispatcher = createDispatcher({
    tools: opts.tools,
    ...(opts.handlers !== undefined ? { handlers: opts.handlers } : {}),
  });

  const capabilities: Record<string, unknown> = { tools: {} };
  if (opts.agentContext !== undefined) {
    Object.assign(capabilities, agentContextCapability(opts.agentContext));
  }

  const server = new Server(
    {
      name: opts.name ?? '@iarsma/mcp-server',
      version: opts.version ?? '0.0.0',
    },
    { capabilities },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [...opts.tools.values()].map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    // Phase 0 transport-agnostic scope passing: the caller may include
    // `_iarsmaScopes` in arguments for testing. Real transports pull from
    // the Authorization header; this fallback is documented in server.ts.
    const scopesArg = args['_iarsmaScopes'];
    const dryRunArg = args['_iarsmaDryRun'];
    const scopes = makeScopeSet(
      Array.isArray(scopesArg) ? scopesArg.map(String) : [],
    );
    const cleanInput = stripIarsmaArgs(args);

    const result = await dispatcher.invoke(
      req.params.name,
      cleanInput,
      scopes,
      { dryRun: typeof dryRunArg === 'boolean' ? dryRunArg : false },
    );

    switch (result.kind) {
      case 'ok':
        return {
          content: [{ type: 'text', text: JSON.stringify(result.output) }],
        };
      case 'preview':
        return {
          content: [
            { type: 'text', text: JSON.stringify({ preview: result.preview }) },
          ],
        };
      case 'denied':
        return {
          content: [
            { type: 'text', text: `denied: ${result.code} — ${result.message}` },
          ],
          isError: true,
        };
      case 'error':
        return {
          content: [
            { type: 'text', text: `error: ${result.code} — ${result.message}` },
          ],
          isError: true,
        };
    }
  });

  return server;
}

/** Re-export for callers wiring up server options. */
export { AGENT_CONTEXT_URN };

function stripIarsmaArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k.startsWith('_iarsma')) continue;
    out[k] = v;
  }
  return out;
}
