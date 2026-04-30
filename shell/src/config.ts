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
  return ConfigSchema.parse({
    oidcIssuer: issuer,
    clientId,
    redirectUri,
    ...(jmapBaseUrl !== undefined ? { jmapBaseUrl } : {}),
  });
}
