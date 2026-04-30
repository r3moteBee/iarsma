/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OIDC_ISSUER?: string;
  readonly VITE_OAUTH_CLIENT_ID?: string;
  readonly VITE_OAUTH_REDIRECT_URI?: string;
  readonly VITE_JMAP_BASE_URL?: string;
  // `urn:iarsma:agent-context` URN value (D-032 mirror, Phase 0 wiring
  // follow-up C). Optional in dev; production deploys carry the values
  // in `/config.json` under `agentContext`.
  readonly VITE_AGENT_CONTEXT_WEBMAIL_MCP_URL?: string;
  readonly VITE_AGENT_CONTEXT_ACTION_LOG_URL?: string;
  readonly VITE_AGENT_CONTEXT_MEMORY_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
