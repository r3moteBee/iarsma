/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

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

const tlsCertPath = process.env['VITE_TLS_CERT'];
const tlsKeyPath = process.env['VITE_TLS_KEY'];
const httpsConfig =
  tlsCertPath !== undefined && tlsKeyPath !== undefined
    ? {
        cert: readFileSync(tlsCertPath),
        key: readFileSync(tlsKeyPath),
      }
    : undefined;

export default defineConfig({
  plugins: [react()],
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
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  // Vitest sees `vite.config.ts` and adopts its config. Exclude `e2e/`
  // so Playwright specs aren't picked up by `pnpm test` (vitest); the
  // E2E suite has its own runner via `pnpm e2e`.
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
