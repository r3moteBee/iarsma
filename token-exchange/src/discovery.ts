/**
 * Iarsma discovery payload — the body of `GET /.well-known/iarsma`.
 *
 * Per D-048 and D-049, the parallel discovery endpoint mirrors the
 * `urn:iarsma:agent-context` URN payload that the MCP server emits in
 * its capabilities map. The two delivery surfaces (well-known +
 * MCP capability) carry the *same* JSON; agents and native-app
 * embedders pick whichever they reach first.
 *
 * **Schema sync invariant:** the Zod schema below must stay in lockstep
 * with `mcp-server/src/agent-context.ts`. Both consume the same env
 * vars (`IARSMA_WEBMAIL_MCP_URL`, `IARSMA_ACTION_LOG_URL`,
 * `IARSMA_MEMORY_BACKEND_URL`) and produce the same payload. Divergence
 * is a `docs/discovery.md` bug; review changes to either side together.
 *
 * Mutation policy (D-049, boundary 5 of `docs/versioning.md`):
 *   - `version: 1` (monotonic integer).
 *   - Forward-compatible: new optional fields may be added without
 *     bumping `version`. Consumers ignore unknown fields.
 *   - Backward-incompatible (rename, remove, semantic-change of an
 *     existing field) requires bumping `version`.
 */

import { z } from 'zod';

export const DISCOVERY_VERSION = 1;

export const DiscoveryPayloadSchema = z.object({
  version: z.literal(DISCOVERY_VERSION),
  webmailMcpUrl: z.string().url(),
  actionLogUrl: z.string().url().optional(),
  memoryBackendUrl: z.string().url().optional(),
});

export type DiscoveryPayload = z.infer<typeof DiscoveryPayloadSchema>;

export class DiscoveryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryConfigError';
  }
}

/**
 * Resolve the discovery payload from a process-environment-shaped
 * object. Returns `null` when the required webmail URL is unset —
 * callers decide whether the route 404s or 503s.
 *
 * Recognized variables (mirror `mcp-server/src/agent-context.ts`):
 *   - `IARSMA_WEBMAIL_MCP_URL`     (required)
 *   - `IARSMA_ACTION_LOG_URL`      (optional)
 *   - `IARSMA_MEMORY_BACKEND_URL`  (optional)
 */
export function loadDiscoveryPayload(env: NodeJS.ProcessEnv): DiscoveryPayload | null {
  const webmailMcpUrl = readUrl(env, 'IARSMA_WEBMAIL_MCP_URL');
  if (webmailMcpUrl === undefined) return null;

  const actionLogUrl = readUrl(env, 'IARSMA_ACTION_LOG_URL');
  const memoryBackendUrl = readUrl(env, 'IARSMA_MEMORY_BACKEND_URL');

  return {
    version: DISCOVERY_VERSION,
    webmailMcpUrl,
    ...(actionLogUrl !== undefined ? { actionLogUrl } : {}),
    ...(memoryBackendUrl !== undefined ? { memoryBackendUrl } : {}),
  };
}

function readUrl(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    new URL(trimmed);
  } catch {
    throw new DiscoveryConfigError(
      `${name} is not a valid URL: ${JSON.stringify(trimmed)}`,
    );
  }
  return trimmed;
}
