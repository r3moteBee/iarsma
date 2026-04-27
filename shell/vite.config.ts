import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite is the bundler. Same as tuatha (6.4+) — muscle memory carries over.
// The shell builds to a static-site bundle that is served by:
//   - Stalwart's Web Applications feature (default deployment), OR
//   - any HTTPS-capable static-file server (Caddy, nginx, CDN), OR
//   - bundled inside a Tauri 2 native shell.
// Same artifact, different host. Portability rules in docs/deployment.md.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
});
