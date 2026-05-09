/**
 * Discovery URN — `urn:iarsma:agent-context` (D-032, D-048, D-049,
 * Phase 0 work item 14).
 *
 * Single source of truth for the URN value: the bundle of endpoints an
 * agent needs once it has reached the webmail. Today the only required
 * field is the webmail's MCP URL; action-log and memory-backend are
 * optional and lit up by later phases.
 *
 * Wire delivery (D-048):
 *   - **Parallel discovery endpoint** at `/.well-known/iarsma` served
 *     by the `token-exchange` sidecar (see `token-exchange/src/
 *     discovery.ts`). Agents and native-app embedders fetch this with
 *     a single GET, no MCP/JMAP round-trip.
 *   - **MCP capabilities map** — the URN value also surfaces here at
 *     connect time, so MCP-attached agents discover it without an
 *     extra HTTP fetch.
 *   - The previous (D-032) "JMAP session-resource extension" framing
 *     is retired: Iarsma can't extend Stalwart's session response, and
 *     the well-known endpoint covers the same need cleanly.
 *
 * Schema (D-049, boundary 5 of docs/versioning.md):
 *   - `version: 1` (monotonic integer)
 *   - `webmailMcpUrl: string` (required)
 *   - `actionLogUrl?: string`
 *   - `memoryBackendUrl?: string`
 *   - Forward-compatible: new optional fields may be added without
 *     bumping `version`. Renaming/removing/semantic-change requires bump.
 *
 * **Schema sync invariant:** this Zod schema must stay in lockstep with
 * `token-exchange/src/discovery.ts`. Both consume the same env vars and
 * produce the same payload shape; divergence is a docs/discovery.md bug.
 */

import { z } from 'zod';

/** The URN identifier itself. */
export const AGENT_CONTEXT_URN = 'urn:iarsma:agent-context';

/**
 * Current monotonic-integer schema version per D-049 / docs/versioning.md
 * boundary 5. Bumped only on backward-incompatible changes (rename,
 * remove, semantic-change of an existing field).
 */
export const AGENT_CONTEXT_VERSION = 1;

/**
 * Zod schema for the URN payload. Used at server startup (loadAgentContext)
 * to validate a fully-resolved context before publishing, and at consumer
 * boundaries (token-exchange tests, future SDK validators) to verify a
 * fetched payload.
 */
export const AgentContextUrnSchema = z.object({
  version: z.literal(AGENT_CONTEXT_VERSION),
  webmailMcpUrl: z.string().url(),
  actionLogUrl: z.string().url().optional(),
  memoryBackendUrl: z.string().url().optional(),
});

/**
 * The value carried by the URN. New endpoint fields are *added*, never
 * renamed; agents that don't recognize a field ignore it gracefully
 * (D-049 mutation policy).
 */
export type AgentContextUrn = z.infer<typeof AgentContextUrnSchema>;

export class AgentContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentContextError';
  }
}

/**
 * Resolve the URN value from a process-environment-shaped object.
 *
 * Recognized variables:
 *   - `IARSMA_WEBMAIL_MCP_URL`     (required)
 *   - `IARSMA_ACTION_LOG_URL`      (optional)
 *   - `IARSMA_MEMORY_BACKEND_URL`  (optional)
 *
 * Returns `null` when the webmail URL is unset — callers decide whether
 * the server should refuse to start (production) or skip the URN
 * advertisement (dev/test).
 */
export function loadAgentContext(env: NodeJS.ProcessEnv): AgentContextUrn | null {
  const webmailMcpUrl = readUrl(env, 'IARSMA_WEBMAIL_MCP_URL');
  if (webmailMcpUrl === undefined) return null;

  const actionLogUrl = readUrl(env, 'IARSMA_ACTION_LOG_URL');
  const memoryBackendUrl = readUrl(env, 'IARSMA_MEMORY_BACKEND_URL');

  return {
    version: AGENT_CONTEXT_VERSION,
    webmailMcpUrl,
    ...(actionLogUrl !== undefined ? { actionLogUrl } : {}),
    ...(memoryBackendUrl !== undefined ? { memoryBackendUrl } : {}),
  };
}

/**
 * Render the URN as the value-side of an MCP capability extension entry,
 * suitable for spreading into the SDK Server's `capabilities` argument:
 *
 *     capabilities: { tools: {}, ...agentContextCapability(ctx) }
 *
 * The shape `{ [URN]: value }` is the convention for namespaced extensions
 * carried over the MCP capabilities map.
 */
export function agentContextCapability(
  ctx: AgentContextUrn,
): Record<string, AgentContextUrn> {
  return { [AGENT_CONTEXT_URN]: ctx };
}

function readUrl(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Surface obviously-bad config at startup rather than letting agents
  // discover a malformed URN at connect time.
  try {
    new URL(trimmed);
  } catch {
    throw new AgentContextError(
      `${name} is not a valid URL: ${JSON.stringify(trimmed)}`,
    );
  }
  return trimmed;
}
