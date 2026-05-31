/**
 * Tool invocation dispatch.
 *
 * Phase 0: every tool returns a stub response with `not_implemented`. Real
 * implementations land as the underlying components are built — for example,
 * `session.get` will call into the JMAP client component once Phase 0 work
 * item 5 lands.
 *
 * The dispatcher's responsibilities are intentionally narrow:
 *   1. Look up the tool by name.
 *   2. Verify the caller's scope set covers `requiredScopes`.
 *   3. (Future) If destructive + dry-run, run the propose/preview path; else
 *      run the commit path. Both go through the policy seam.
 *   4. Validate input against the tool's input JSON Schema (deferred — Ajv
 *      integration lands when we want client-side validation).
 *   5. Emit an action-log entry (deferred until the action-log component
 *      lands; the seam is a function call we can wire later).
 *
 * The output of a successful invocation is a typed `InvocationResult`. The
 * MCP transport layer wraps that into the protocol's expected envelope.
 */

import { hasAllScopes, type ScopeSet } from './scope-filter.js';
import type { ToolRegistration } from './tool-loader.js';
import { requiredScope } from './tool-scopes.js';

export type InvocationOptions = {
  /** True for dry-run; false (default) for commit. */
  readonly dryRun?: boolean;
  /** Per-agent Stalwart API key override. When set, handlers use this
   *  instead of the shared IARSMA_AGENT_TOKEN for JMAP calls. */
  readonly bearerToken?: string;
  /** Stable agent identifier (tokenId). Surfaced to handlers that need
   *  to attribute side-effects — e.g. approval records. */
  readonly agentId?: string;
  /** Human-readable agent label. */
  readonly agentName?: string;
};

export type InvocationResult =
  | { kind: 'ok'; output: unknown }
  | { kind: 'preview'; preview: unknown }
  | { kind: 'denied'; code: 'unauthorized' | 'forbidden' | 'scope_denied' | 'not_found'; message: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'require_approval'; approvalId: string; reason: string };

export type Dispatcher = {
  invoke(
    name: string,
    input: unknown,
    callerScopes: ScopeSet,
    options?: InvocationOptions,
  ): Promise<InvocationResult>;
};

export type DispatcherDeps = {
  readonly tools: ReadonlyMap<string, ToolRegistration>;
  /**
   * Concrete tool handlers. Key is the tool name; value receives the input
   * and returns the output (or a preview for dry-run). Phase 0 leaves this
   * empty and the dispatcher returns `not_implemented` for every call.
   */
  readonly handlers?: ReadonlyMap<string, ToolHandler>;
};

export type ToolHandler = (
  input: unknown,
  ctx: {
    readonly dryRun: boolean;
    readonly scopes: ScopeSet;
    readonly bearerToken?: string;
    readonly agentId?: string;
    readonly agentName?: string;
  },
) => Promise<unknown>;

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const handlers = deps.handlers ?? new Map<string, ToolHandler>();

  return {
    async invoke(name, input, callerScopes, options = {}) {
      const tool = deps.tools.get(name);
      if (tool === undefined) {
        return {
          kind: 'denied',
          code: 'not_found',
          message: `Unknown tool: ${name}`,
        };
      }
      // Scope check: use the centralized TOOL_SCOPES constant when available,
      // falling back to the tool registration's requiredScopes array.
      const scope = requiredScope(name);
      const scopesToCheck = scope !== undefined ? [scope] : tool.requiredScopes;
      if (!hasAllScopes(callerScopes, scopesToCheck)) {
        const missing = scope ?? tool.requiredScopes.join(', ');
        return {
          kind: 'denied',
          code: 'scope_denied',
          message: `Tool '${name}' requires scope '${missing}' which is not granted.`,
        };
      }

      const dryRun = options.dryRun ?? false;
      const handler = handlers.get(name);
      if (handler === undefined) {
        return {
          kind: 'error',
          code: 'not_implemented',
          message:
            `Tool ${name} has no implementation yet. Implementations land as ` +
            `their underlying components do (see docs/implementation-plan.md).`,
        };
      }
      try {
        const output = await handler(input, {
          dryRun,
          scopes: callerScopes,
          ...(options.bearerToken !== undefined ? { bearerToken: options.bearerToken } : {}),
          ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
          ...(options.agentName !== undefined ? { agentName: options.agentName } : {}),
        });
        return dryRun ? { kind: 'preview', preview: output } : { kind: 'ok', output };
      } catch (e) {
        return {
          kind: 'error',
          code: e instanceof Error ? 'tool_error' : 'unknown_error',
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
