/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { cspConnectOrigins, stripMonacoCdnDefault, transformCspMeta } from './src/security/csp';

// Vite is the bundler. Same as tuatha (6.4+) — muscle memory carries over.
// The shell builds to a static-site bundle that is served by:
//   - Stalwart's Web Applications feature (default deployment), OR
//   - any HTTPS-capable static-file server (Caddy, nginx, CDN), OR
//   - bundled inside a Tauri 2 native shell.
// Same artifact, different host. Portability rules in docs/deployment.md.
//
// HTTPS dev: Stalwart's OAuth implementation (v0.16.x) requires HTTPS for
// redirect URIs, so the dev origin needs TLS too. Set `VITE_TLS_CERT` +
// `VITE_TLS_KEY` (paths to PEM files; mkcert is the easy generator) and
// the dev server flips to HTTPS automatically. Without those env vars,
// dev stays on plain HTTP for the contributors who don't need OAuth.
//
// Deploy prefix: when the bundle is served at a non-root URL (e.g.,
// `https://your-host/webmail/` via Stalwart Web Apps), Vite's `base`
// option must match the prefix so asset URLs in the built HTML
// (`/assets/...`) resolve correctly under the prefix
// (`/webmail/assets/...`). Set `VITE_BASE_PATH=/webmail/` at build time.
// Default is `/` — works for root-deployed bundles and for Vite's dev
// server which always serves at the root.

const tlsCertPath = process.env['VITE_TLS_CERT'];
const tlsKeyPath = process.env['VITE_TLS_KEY'];
const httpsConfig =
  tlsCertPath !== undefined && tlsKeyPath !== undefined
    ? {
        cert: readFileSync(tlsCertPath),
        key: readFileSync(tlsKeyPath),
      }
    : undefined;

// Vite expects `base` to start AND end with `/` (or be `./`). Tolerate
// missing trailing slash in the env var value because operators commonly
// type `/webmail` rather than `/webmail/`.
const rawBase = process.env['VITE_BASE_PATH'] ?? '/';
const basePath = rawBase === '/' || rawBase === './' ? rawBase : rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

// CSP: index.html carries the policy as a <meta> (Stalwart can't add
// response headers). This plugin extends its connect-src for cross-origin
// JMAP/OIDC builds (`IARSMA_CSP_CONNECT_SRC="https://mail.example.com"`,
// plus any VITE_OIDC_ISSUER / VITE_JMAP_BASE_URL origin), strips it on the
// dev server (inline React-refresh preamble + HMR), and blanks
// @monaco-editor/loader's CDN default so no jsdelivr URL ships. Details in
// src/security/csp.ts and docs/deployment.md.
function iarsmaCsp(): Plugin {
  let command: 'build' | 'serve' = 'build';
  let extraConnectSrc: string[] = [];
  return {
    name: 'iarsma-csp',
    configResolved(config) {
      command = config.command;
      // `config.env` holds the VITE_* values Vite loaded from .env files
      // as well as the shell env (process.env alone misses .env.local);
      // IARSMA_CSP_CONNECT_SRC isn't VITE_-prefixed, so it comes from the
      // shell env only, keeping it out of import.meta.env.
      if (command === 'build') {
        extraConnectSrc = cspConnectOrigins({
          ...config.env,
          IARSMA_CSP_CONNECT_SRC: process.env['IARSMA_CSP_CONNECT_SRC'],
        });
      }
    },
    transform(code, id) {
      if (!id.includes('@monaco-editor/loader') || !code.includes('cdn.jsdelivr.net')) return null;
      return { code: stripMonacoCdnDefault(code), map: null };
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return transformCspMeta(html, { command, extraConnectSrc });
      },
    },
  };
}

// Sourcemaps: off for release builds. The source is public, so maps leak
// nothing, but Monaco's alone add tens of MB to the zip Stalwart serves and
// the service worker caches, and any tag's maps can be rebuilt reproducibly
// (D-028). `IARSMA_SOURCEMAP=hidden` emits them without the
// sourceMappingURL comment (for an error tracker / local symbolication),
// `IARSMA_SOURCEMAP=true` restores linked maps for debugging a build.
const rawSourcemap = process.env['IARSMA_SOURCEMAP'];
const sourcemap = rawSourcemap === 'hidden' ? 'hidden' : rawSourcemap === 'true';

export default defineConfig({
  base: basePath,
  plugins: [react(), iarsmaCsp()],
  server: {
    port: 5173,
    strictPort: true,
    ...(httpsConfig !== undefined ? { https: httpsConfig } : {}),
  },
  preview: {
    port: 5173,
    strictPort: true,
    ...(httpsConfig !== undefined ? { https: httpsConfig } : {}),
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env['IARSMA_VERSION'] ?? 'dev'),
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap,
  },
  // Vitest sees `vite.config.ts` and adopts its config. Exclude `e2e/`
  // so Playwright specs aren't picked up by `pnpm test` (vitest); the
  // E2E suite has its own runner via `pnpm e2e`.
  //
  // `setupFiles` registers `@testing-library/jest-dom` matchers — only
  // active for tests that opt into the jsdom environment via the
  // `@vitest-environment jsdom` pragma. Node-environment tests (the
  // default for crypto-envelope, oauth, etc.) skip the setup file
  // because jest-dom is a no-op without a DOM.
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
