/**
 * Shell runtime configuration.
 *
 * Resolution order (first hit wins):
 *   1. `/config.json` fetched at startup — the production path. Bundle ships
 *      with no defaults; the deployer drops a `config.json` next to the
 *      bundle. Schema validated with Zod (CT-6 schema versioning).
 *   2. Vite environment variables (`VITE_*`) — the dev path. `vite.config.ts`
 *      reads `.env.local` etc. The shell never sees a real env, only the
 *      build-time replacement.
 *   3. Hard error — production must ship a `config.json`; dev must set
 *      env vars. There are no fallback URLs, by design.
 *
 * F-4 will formalize the `config.json` schema and same-origin defaults
 * across the whole bundle (JMAP endpoint, action-log URL, memory backend,
 * etc.). This module covers only the OIDC bits Phase 0 needs today.
 */

import { z } from 'zod';

/**
 * `urn:iarsma:agent-context` value mirror (D-032). The MCP server side
 * advertises this URN at connect time (Phase 0 work item 14); the shell
 * exposes the same bundle so capabilities running in-shell can hand it
 * to downstream consumers without each computing it from scratch. JMAP-
 * session-side injection — splicing this value into the actual JMAP
 * session resource the shell receives from Stalwart — is a Phase 1
 * deliverable that depends on the shell becoming an authoritative
 * session-resource issuer (today Stalwart serves it directly and we
 * can't modify its response).
 */
const AgentContextSchema = z.object({
  /** MCP endpoint that exposes the webmail's tools. Always populated. */
  webmailMcpUrl: z.string().url(),
  /** Action log endpoint. Optional in Phase 0 — the action-log component
   *  doesn't yet expose a network surface. */
  actionLogUrl: z.string().url().optional(),
  /** Memory backend MCP endpoint (e.g., an OB1 instance, per D-031).
   *  Set when configured. */
  memoryBackendUrl: z.string().url().optional(),
});

export type AgentContext = z.infer<typeof AgentContextSchema>;

const ConfigSchema = z.object({
  /** Stalwart base URL — the OIDC issuer. */
  oidcIssuer: z.string().url(),
  /** Pre-registered OAuth client id (public client, PKCE-only per D-039). */
  clientId: z.string().min(1),
  /** Where the shell expects Stalwart to redirect after auth. Must match
   *  one of the redirect URIs registered on the OAuth client. */
  redirectUri: z.string().url(),
  /** Optional: explicit JMAP base URL. Defaults to `oidcIssuer` because
   *  Stalwart serves JMAP and OIDC from the same host. */
  jmapBaseUrl: z.string().url().optional(),
  /** Optional: `urn:iarsma:agent-context` URN value. When set, must
   *  agree with the MCP server's `IARSMA_*_URL` env vars or agents will
   *  see divergent endpoints across the two surfaces. */
  agentContext: AgentContextSchema.optional(),
});

export type ShellConfig = z.infer<typeof ConfigSchema>;

let cached: ShellConfig | null = null;

/**
 * Load and cache the shell's runtime config. Idempotent — first call
 * fetches; subsequent calls return the cached value.
 */
export async function loadConfig(): Promise<ShellConfig> {
  if (cached !== null) return cached;
  const fromJson = await tryLoadConfigJson();
  if (fromJson !== null) {
    cached = fromJson;
    return cached;
  }
  const fromEnv = tryLoadFromViteEnv();
  if (fromEnv !== null) {
    cached = fromEnv;
    return cached;
  }
  throw new Error(
    'Iarsma: no runtime config found. Provide /config.json (deployed) ' +
      'or set VITE_OIDC_ISSUER + VITE_OAUTH_CLIENT_ID + VITE_OAUTH_REDIRECT_URI ' +
      '(dev). See docs/stalwart-setup.md.',
  );
}

/** Test-only — drops the cache. */
export function _resetConfigForTests(): void {
  cached = null;
}

async function tryLoadConfigJson(): Promise<ShellConfig | null> {
  if (typeof fetch !== 'function' || typeof window === 'undefined') return null;
  try {
    const response = await fetch('/config.json', {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return ConfigSchema.parse(body);
  } catch {
    return null;
  }
}

function tryLoadFromViteEnv(): ShellConfig | null {
  // `import.meta.env` is Vite-injected (typed in src/vite-env.d.ts). In
  // non-Vite contexts (Node tests), Vite's typings still apply but the
  // values are undefined and we skip.
  const env = import.meta.env;
  const issuer = env.VITE_OIDC_ISSUER;
  const clientId = env.VITE_OAUTH_CLIENT_ID;
  const redirectUri = env.VITE_OAUTH_REDIRECT_URI;
  if (
    issuer === undefined ||
    clientId === undefined ||
    redirectUri === undefined
  ) {
    return null;
  }
  const jmapBaseUrl = env.VITE_JMAP_BASE_URL;
  const webmailMcpUrl = env.VITE_AGENT_CONTEXT_WEBMAIL_MCP_URL;
  const actionLogUrl = env.VITE_AGENT_CONTEXT_ACTION_LOG_URL;
  const memoryBackendUrl = env.VITE_AGENT_CONTEXT_MEMORY_BACKEND_URL;
  const agentContext: AgentContext | undefined =
    webmailMcpUrl !== undefined
      ? {
          webmailMcpUrl,
          ...(actionLogUrl !== undefined ? { actionLogUrl } : {}),
          ...(memoryBackendUrl !== undefined ? { memoryBackendUrl } : {}),
        }
      : undefined;
  return ConfigSchema.parse({
    oidcIssuer: issuer,
    clientId,
    redirectUri,
    ...(jmapBaseUrl !== undefined ? { jmapBaseUrl } : {}),
    ...(agentContext !== undefined ? { agentContext } : {}),
  });
}
