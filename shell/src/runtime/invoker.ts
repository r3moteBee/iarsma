/**
 * The invoker — abstracts how a capability call actually reaches the server.
 *
 * Generated hooks ask `useInvoker()` for the current invoker (provided via
 * <IarsmaProvider>) and call `invoker.invoke(name, input)`. The runtime
 * doesn't care whether the underlying transport is MCP-over-HTTP, a direct
 * JMAP call, or a mock for testing — that's the invoker's job.
 *
 * Two production invokers ship with the runtime:
 *
 *   - `mcpInvoker(opts)` — POSTs to the configured MCP server endpoint.
 *     This is the default path during Phase 0/1 development.
 *
 *   - `jmapInvoker(opts)` — calls the JMAP client component directly,
 *     skipping MCP. Useful when the shell talks to JMAP without an
 *     intermediate MCP server. Stub for now; lands when the JMAP client
 *     component does (Phase 0 work item 5).
 *
 * Tests use a `mockInvoker(map)` that returns canned responses.
 */

import { createContext, useContext } from 'react';
import type { DryRunPreview, ToolError } from './types.js';

export type InvocationOptions = {
  /** True if the caller wants a dry-run preview, not a commit. */
  readonly dryRun?: boolean;
};

export interface Invoker {
  /**
   * Call a capability by name. Returns the parsed output (or a dry-run
   * preview if `options.dryRun` is true). Throws ToolError on failure.
   */
  invoke<I, O>(
    name: string,
    input: I,
    options?: InvocationOptions,
  ): Promise<O | DryRunPreview<O>>;
}

const InvokerContext = createContext<Invoker | null>(null);

export function useInvoker(): Invoker {
  const invoker = useContext(InvokerContext);
  if (invoker === null) {
    throw new Error(
      'No invoker found. Did you wrap your app in <IarsmaProvider invoker={...}>?',
    );
  }
  return invoker;
}

export const IarsmaProvider = InvokerContext.Provider;

// ──────────────────────────────────────────────────────────────────────────
// MCP invoker — POSTs to the MCP server's HTTP endpoint
// ──────────────────────────────────────────────────────────────────────────

export type McpInvokerOptions = {
  /** Base URL of the MCP server, e.g. 'https://sw-mail.example.net/mcp'. */
  readonly baseUrl: string;
  /** Returns the current Bearer token. Called on each invocation. */
  readonly getAuthToken: () => string | null;
};

export function mcpInvoker(opts: McpInvokerOptions): Invoker {
  return {
    async invoke<I, O>(
      name: string,
      input: I,
      options: InvocationOptions = {},
    ): Promise<O | DryRunPreview<O>> {
      const token = opts.getAuthToken();
      if (token === null) {
        throw makeToolError('unauthorized', 'No auth token available.');
      }
      const url = `${opts.baseUrl.replace(/\/$/, '')}/tools/${name}`;
      const headers: HeadersInit = {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      };
      if (options.dryRun) {
        headers['x-iarsma-dry-run'] = 'true';
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        let body: unknown = null;
        try {
          body = (await response.json()) as unknown;
        } catch {
          // ignore
        }
        if (body !== null && typeof body === 'object' && 'code' in body) {
          throw body as ToolError;
        }
        throw makeToolError(
          response.status === 401 ? 'unauthorized' : 'tool_error',
          `MCP tool call failed: ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as O | DryRunPreview<O>;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// JMAP invoker — placeholder; lands with Phase 0 work item 5
// ──────────────────────────────────────────────────────────────────────────

export function jmapInvoker(): Invoker {
  return {
    invoke() {
      return Promise.reject(
        makeToolError(
          'not_implemented',
          'jmapInvoker lands with Phase 0 work item 5 (JMAP client component).',
        ),
      );
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Mock invoker — for tests
// ──────────────────────────────────────────────────────────────────────────

export type MockInvokerHandler = (input: unknown, dryRun: boolean) => unknown | Promise<unknown>;

export function mockInvoker(handlers: Record<string, MockInvokerHandler>): Invoker {
  return {
    async invoke(name, input, options = {}) {
      const handler = handlers[name];
      if (handler === undefined) {
        throw makeToolError('tool_not_found', `mockInvoker has no handler for '${name}'.`);
      }
      const result = await handler(input, options.dryRun ?? false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result as any;
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeToolError(code: string, message: string): ToolError {
  return { code, message };
}
