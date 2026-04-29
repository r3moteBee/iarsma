/**
 * Discovery URN — `urn:iarsma:agent-context` (D-032, Phase 0 work item 14).
 *
 * Single source of truth for the URN value: the bundle of endpoints an agent
 * needs once it has reached the webmail. Today the only required field is
 * the webmail's MCP URL (already advertised by the server it's attached to,
 * but explicit in the URN so cross-MCP propagation works); action-log and
 * memory-backend are optional and lit up by later phases.
 *
 * Phase 0 surfaces the URN value in the MCP server's `capabilities` map at
 * connect time (the SDK passes arbitrary extension fields through). Phase 1+
 * also injects it into the JMAP session resource the shell receives, so a
 * single discovery call yields all relevant endpoints; that wiring lands
 * with the shell-side session enrichment work.
 */

/** The URN identifier itself. */
export const AGENT_CONTEXT_URN = 'urn:iarsma:agent-context';

/**
 * The value carried by the URN. New endpoint fields are *added*, never
 * renamed; agents that don't recognize a field ignore it gracefully.
 */
export type AgentContextUrn = {
  /** MCP endpoint that exposes the webmail's tools. Always populated. */
  readonly webmailMcpUrl: string;
  /** Action log endpoint. Optional in Phase 0 — the action-log component lands separately. */
  readonly actionLogUrl?: string;
  /** Memory backend MCP endpoint (e.g. an OB1 instance). Set when configured. */
  readonly memoryBackendUrl?: string;
};

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
 * Returns `null` when the webmail URL is unset — callers decide whether the
 * server should refuse to start (production) or skip the URN advertisement
 * (dev/test).
 */
export function loadAgentContext(env: NodeJS.ProcessEnv): AgentContextUrn | null {
  const webmailMcpUrl = readUrl(env, 'IARSMA_WEBMAIL_MCP_URL');
  if (webmailMcpUrl === undefined) return null;

  const actionLogUrl = readUrl(env, 'IARSMA_ACTION_LOG_URL');
  const memoryBackendUrl = readUrl(env, 'IARSMA_MEMORY_BACKEND_URL');

  return {
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
