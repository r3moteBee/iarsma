/**
 * Shared helper: resolve the bearer token for a JMAP call.
 *
 * Order of precedence:
 *   1. `ctx.bearerToken` — set by the HTTP transport from the
 *      introspected agent identity (PR 36 / D-057). Always preferred.
 *   2. `deps.bearerToken` — stdio-mode fallback from
 *      `IARSMA_AGENT_TOKEN`. Used only when introspection isn't wired.
 *
 * When neither is present we throw a tagged `unauthorized` Error so
 * the dispatcher surfaces it as `denied` to the caller instead of an
 * opaque `tool_error`.
 */

export function resolveBearer(
  ctxBearer: string | undefined,
  depsBearer: string | undefined,
): string {
  const token = ctxBearer ?? depsBearer;
  if (token === undefined) {
    const err = new Error(
      'No bearer token available for JMAP call. The MCP server is ' +
        'running without an `IARSMA_AGENT_TOKEN` fallback and the ' +
        "request didn't carry an introspected agent identity.",
    );
    (err as Error & { code?: string }).code = 'unauthorized';
    throw err;
  }
  return token;
}
