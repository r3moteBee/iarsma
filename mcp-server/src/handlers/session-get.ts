/**
 * Handler for the `session.get` capability.
 *
 * Phase 0 design: the MCP server fetches `/.well-known/jmap` from the
 * configured Stalwart deployment using the agent's bearer token, then
 * narrows the response to the `Session` shape the capability contract
 * promises (mirrors the shell-side flow in `shell/src/runtime/jmap-client.ts`).
 *
 * Auth posture (Phase 0 stdio): the bearer token comes from the
 * `IARSMA_AGENT_TOKEN` env var. Phase 1's HTTP/SSE transport replaces
 * this with the per-request `Authorization: Bearer <token>` header,
 * threaded through the dispatcher via the agent identity.
 *
 * Parse path: shared with the shell via `@iarsma/wasm-bindings/jmap-client`.
 * Both hosts route the JMAP response body through the same WASM component
 * so wire-shape divergence shows up in one place (the component) rather
 * than two hand-rolled parsers.
 */

import { session as jmapClientSession } from '@iarsma/wasm-bindings/jmap-client';
import type { ToolHandler } from '../invocation.js';

/**
 * Field-aligned with the codegen-emitted Session output schema. Stays in
 * sync via the schema-parity tests in `tools/codegen` — any divergence
 * surfaces as a contract test failure rather than a runtime mismatch.
 */
export type Session = {
  readonly username: string;
  readonly apiUrl: string;
  readonly downloadUrl: string;
  readonly uploadUrl: string;
  readonly eventSourceUrl: string;
  readonly state: string;
  readonly primaryAccountIdMail: string;
};

export class SessionGetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionGetConfigError';
  }
}

export type SessionGetDeps = {
  /** Stalwart base URL — `/.well-known/jmap` is appended. */
  readonly jmapBaseUrl: string;
  /** Bearer token to authenticate the JMAP fetch. */
  readonly bearerToken: string;
  /** Override for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
};

/**
 * Read the Phase 0 deps from environment variables. Returns `null` when
 * either var is missing — the caller decides whether to refuse to
 * advertise the tool or expose it as `not_implemented`.
 */
export function loadSessionGetDeps(env: NodeJS.ProcessEnv): SessionGetDeps | null {
  const jmapBaseUrl = env['IARSMA_JMAP_BASE_URL']?.trim();
  const bearerToken = env['IARSMA_AGENT_TOKEN']?.trim();
  if (
    jmapBaseUrl === undefined ||
    jmapBaseUrl.length === 0 ||
    bearerToken === undefined ||
    bearerToken.length === 0
  ) {
    return null;
  }
  // Surface obviously-bad config at startup.
  try {
    new URL(jmapBaseUrl);
  } catch {
    throw new SessionGetConfigError(
      `IARSMA_JMAP_BASE_URL is not a valid URL: ${JSON.stringify(jmapBaseUrl)}`,
    );
  }
  return { jmapBaseUrl, bearerToken };
}

/**
 * Build a `session.get` tool handler bound to the given deps. Returns
 * the parsed Session record. Errors propagate to the dispatcher's
 * catch and surface as `tool_error` (or `unauthorized` for 401).
 */
export function createSessionGetHandler(deps: SessionGetDeps): ToolHandler {
  return async (_input) => {
    const fetchImpl = deps.fetch ?? fetch;
    const url = `${deps.jmapBaseUrl.replace(/\/$/, '')}/.well-known/jmap`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${deps.bearerToken}`,
        },
      });
    } catch (e) {
      throw new Error(
        `JMAP fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403 ? 'unauthorized' : 'jmap_http_error';
      const detail = await response.text().catch(() => '');
      const err = new Error(
        `JMAP /.well-known/jmap returned ${response.status} ${response.statusText}` +
          (detail.length > 0 ? ` — ${detail.slice(0, 200)}` : ''),
      );
      (err as Error & { code?: string }).code = code;
      throw err;
    }
    const body = await response.text();
    try {
      return jmapClientSession.parseSession(body) as Session;
    } catch (e) {
      throw new Error(
        `JMAP session response could not be parsed: ${describe(e)}`,
      );
    }
  };
}

function describe(e: unknown): string {
  // jco wraps `result<_, E>` errors in an object whose `.payload`
  // carries the WIT `parse-error` record. Surface code + message when
  // present so the dispatcher can attribute the failure precisely.
  if (e !== null && typeof e === 'object' && 'payload' in e) {
    const payload = (e as { payload: unknown }).payload;
    if (
      payload !== null &&
      typeof payload === 'object' &&
      'code' in payload &&
      'message' in payload
    ) {
      const p = payload as { code: unknown; message: unknown };
      return `${String(p.code)}: ${String(p.message)}`;
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
