/**
 * Playwright config for the shell's E2E tests.
 *
 * Phase 0 covers a single spec — the OAuth + PKCE login round-trip
 * (`oauth-login.spec.ts`) — but the config is structured so future
 * specs (mailbox tree, thread view, etc.) drop into `e2e/` as they
 * land.
 *
 * The spec runs against a *real* Stalwart deployment configured
 * through `shell/.env.local` (or VITE_* env vars on the runner). It
 * is **not** part of CI by default because:
 *
 *   - it requires live credentials (provided via env vars; never
 *     committed),
 *   - it talks to an external service whose state we don't own.
 *
 * Trigger explicitly with `pnpm --filter @iarsma/shell run e2e` once
 * the env is set. CI hooks for the smoke land later, behind a secret-
 * bound matrix entry.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['IARSMA_E2E_PORT'] ?? 5173);
const HOST = process.env['IARSMA_E2E_HOST'] ?? 'localhost';
// Default to HTTPS — Stalwart's OAuth implementation refuses non-HTTPS
// redirect URIs at token-issuance even when the URI is registered. Set
// `VITE_TLS_CERT` + `VITE_TLS_KEY` (mkcert-generated PEMs) for the dev
// origin; flip the protocol back to `http` via env if you're testing
// outside the OAuth flow.
const PROTOCOL = process.env['IARSMA_E2E_PROTOCOL'] ?? 'https';
const BASE_URL = `${PROTOCOL}://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Each spec is hermetic against the live server, so parallelism is
  // safe but slow (multiple sign-ins × audit-log entries).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Headless by default — this runs on a server without a display.
    headless: true,
    // Don't share storage state between specs; every test starts
    // signed-out so the auth flow is exercised end to end.
    storageState: undefined,
    // Self-signed dev certs (mkcert / @vitejs/plugin-basic-ssl) won't
    // be in Playwright's bundled-Chromium trust store. The browser is
    // ephemeral; the iarsma origin is the only HTTPS endpoint it talks
    // to over self-signed TLS. The OIDC + JMAP traffic to Stalwart is
    // real CA-signed HTTPS and is not affected by this flag.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
    ignoreHTTPSErrors: true,
    env: {
      // Vite picks these up via shell/src/config.ts. The test reads
      // the issuer from process.env to assert against; both sides
      // need to agree.
      VITE_OIDC_ISSUER: process.env['IARSMA_E2E_OIDC_ISSUER'] ?? '',
      VITE_OAUTH_CLIENT_ID: process.env['IARSMA_E2E_CLIENT_ID'] ?? 'webmail',
      VITE_OAUTH_REDIRECT_URI:
        process.env['IARSMA_E2E_REDIRECT_URI'] ?? `${BASE_URL}/auth/callback`,
      // Forwarded so the dev server's HTTPS toggle picks up the
      // mkcert-generated PEMs the runner (or Playwright invocation)
      // sets in its environment.
      ...(process.env['VITE_TLS_CERT'] !== undefined
        ? { VITE_TLS_CERT: process.env['VITE_TLS_CERT'] }
        : {}),
      ...(process.env['VITE_TLS_KEY'] !== undefined
        ? { VITE_TLS_KEY: process.env['VITE_TLS_KEY'] }
        : {}),
    },
  },
});
