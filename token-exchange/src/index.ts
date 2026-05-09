/**
 * Token-exchange sidecar entrypoint.
 *
 * Loads config from env, discovers the OIDC token endpoint (or uses the
 * configured override), constructs the Fastify app, and listens.
 *
 * Run from the repo root:
 *   pnpm --filter '@iarsma/token-exchange' run dev
 *
 * Required env (see token-exchange/README.md and the repo .env.example):
 *   OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET,
 *   TOKEN_EXCHANGE_ALLOWED_REDIRECT_URIS
 */

import { ConfigError, loadConfig } from './config.js';
import { DiscoveryConfigError, loadDiscoveryPayload } from './discovery.js';
import { createExchanger } from './exchange.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      // eslint-disable-next-line no-console
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }

  let discovery;
  try {
    discovery = loadDiscoveryPayload(process.env);
  } catch (e) {
    if (e instanceof DiscoveryConfigError) {
      // eslint-disable-next-line no-console
      console.error(`[token-exchange] discovery config: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }

  const exchanger = await createExchanger({
    oidcIssuer: config.oidcIssuer,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    allowedRedirectUris: config.allowedRedirectUris,
    ...(config.tokenEndpoint !== undefined ? { tokenEndpoint: config.tokenEndpoint } : {}),
  });

  const app = await buildServer({
    exchanger,
    corsOrigins: config.corsOrigins,
    discovery,
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });
  const discoveryNote = discovery === null
    ? 'discovery=disabled (set IARSMA_WEBMAIL_MCP_URL to enable)'
    : 'discovery=enabled at /.well-known/iarsma';
  app.log.info(
    `[token-exchange] listening on port ${config.port}, ` +
      `client_id=${config.clientId}, allowed_redirects=${config.allowedRedirectUris.length}, ` +
      discoveryNote,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1]?.split('/').pop() ?? '');

if (isMain) {
  main().catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[token-exchange] fatal:', e);
    process.exit(1);
  });
}

export { loadConfig, ConfigError } from './config.js';
export type { Config } from './config.js';
export {
  DISCOVERY_VERSION,
  DiscoveryConfigError,
  DiscoveryPayloadSchema,
  loadDiscoveryPayload,
} from './discovery.js';
export type { DiscoveryPayload } from './discovery.js';
export { createExchanger, ExchangeError, parseTokenResponse, discoverTokenEndpoint } from './exchange.js';
export type {
  Exchanger,
  ExchangerConfig,
  ExchangeRequest,
  ExchangeResponse,
} from './exchange.js';
export { buildServer } from './server.js';
export type { ServerOptions } from './server.js';
