/**
 * Environment-based configuration for the token-exchange sidecar.
 *
 * The sidecar holds the OAuth `client_secret` (which the browser bundle
 * cannot — see D-019) and performs the auth-code-plus-PKCE-verifier
 * exchange against Stalwart's OIDC token endpoint.
 *
 * Required env vars (see `.env.example` at the repo root):
 *   - OIDC_ISSUER:                 base URL of the OIDC provider
 *   - OIDC_CLIENT_ID:              registered client id
 *   - OIDC_CLIENT_SECRET:          registered client secret (NEVER ship to browser)
 *   - TOKEN_EXCHANGE_ALLOWED_REDIRECT_URIS:
 *                                  comma-separated allowed redirect URIs
 *
 * Optional:
 *   - TOKEN_EXCHANGE_PORT:         default 4000
 *   - TOKEN_EXCHANGE_CORS_ORIGINS: comma-separated allowed origins for CORS
 *                                  (browser shell origins). Empty list disables CORS.
 *   - TOKEN_EXCHANGE_TOKEN_ENDPOINT: explicit token endpoint URL. If unset,
 *                                  the sidecar discovers it from
 *                                  `${OIDC_ISSUER}/.well-known/openid-configuration`.
 */

import { z } from 'zod';

const ConfigSchema = z.object({
  TOKEN_EXCHANGE_PORT: z.coerce.number().int().positive().default(4000),
  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  TOKEN_EXCHANGE_ALLOWED_REDIRECT_URIS: z.string().min(1),
  TOKEN_EXCHANGE_CORS_ORIGINS: z.string().optional(),
  TOKEN_EXCHANGE_TOKEN_ENDPOINT: z.string().url().optional(),
});

export type Config = {
  readonly port: number;
  readonly oidcIssuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly allowedRedirectUris: readonly string[];
  readonly corsOrigins: readonly string[];
  /** Explicit token endpoint, or undefined to discover from issuer. */
  readonly tokenEndpoint: string | undefined;
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parseResult = ConfigSchema.safeParse(env);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigError(
      `Invalid environment for token-exchange sidecar:\n${issues}\n` +
        `See token-exchange/README.md and the repo-root .env.example.`,
    );
  }
  const parsed = parseResult.data;
  return {
    port: parsed.TOKEN_EXCHANGE_PORT,
    oidcIssuer: parsed.OIDC_ISSUER,
    clientId: parsed.OIDC_CLIENT_ID,
    clientSecret: parsed.OIDC_CLIENT_SECRET,
    allowedRedirectUris: splitCsv(parsed.TOKEN_EXCHANGE_ALLOWED_REDIRECT_URIS),
    corsOrigins: splitCsv(parsed.TOKEN_EXCHANGE_CORS_ORIGINS ?? ''),
    tokenEndpoint: parsed.TOKEN_EXCHANGE_TOKEN_ENDPOINT,
  };
}

function splitCsv(s: string): string[] {
  return s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
