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
 * Why a hand-roll JSON parse here rather than the WASM jmap-client
 * component the shell uses: the shell imports the jco-transpiled
 * bindings out of `shell/src/wasm/`, which is shell-package-local. Phase 1
 * promotes the transpiled artifacts to a workspace-wide `wasm-bindings/`
 * directory so both consumers share one component instance — at which
 * point the parse logic here collapses into a call into the same
 * component the shell uses. For Phase 0 the duplication is intentional:
 * keeps this PR focused, the JSON shape is small and stable, and the
 * shape-equivalence is exercised end-to-end by the codegen-emitted
 * JSON-Schema parity tests.
 */

import { z } from 'zod';
import type { ToolHandler } from '../invocation.js';

const URN_MAIL = 'urn:ietf:params:jmap:mail';

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

const RawSessionSchema = z.object({
  username: z.string(),
  apiUrl: z.string(),
  downloadUrl: z.string(),
  uploadUrl: z.string(),
  eventSourceUrl: z.string(),
  state: z.string(),
  primaryAccounts: z.record(z.string()),
});

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
    const body = (await response.json()) as unknown;
    const parsed = RawSessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error(
        `JMAP session response did not match expected shape: ${parsed.error.message}`,
      );
    }
    const primaryMail = parsed.data.primaryAccounts[URN_MAIL];
    if (primaryMail === undefined) {
      throw new Error(
        `JMAP session response missing primary account for ${URN_MAIL}`,
      );
    }
    const session: Session = {
      username: parsed.data.username,
      apiUrl: parsed.data.apiUrl,
      downloadUrl: parsed.data.downloadUrl,
      uploadUrl: parsed.data.uploadUrl,
      eventSourceUrl: parsed.data.eventSourceUrl,
      state: parsed.data.state,
      primaryAccountIdMail: primaryMail,
    };
    return session;
  };
}
