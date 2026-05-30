import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

// Expose the bundled version for DevTools inspection. Lets an operator
// confirm what's actually running by typing `__IARSMA_VERSION__` in the
// console, independent of the sidebar label.
(window as unknown as { __IARSMA_VERSION__: string }).__IARSMA_VERSION__ = __APP_VERSION__;
// eslint-disable-next-line no-console
console.info(`[iarsma] v${__APP_VERSION__}`);

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('No #root element. Check index.html.');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker for app shell caching.
// This prevents the browser HTTP Basic Auth dialog on reload —
// the shell is served from cache without hitting Stalwart's auth.
if ('serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL ?? '/';
  const swUrl = `${base}sw.js`;
  navigator.serviceWorker.register(swUrl, { scope: base }).catch(() => {
    // SW registration failure is non-fatal — the app still works,
    // just without cache-first reload behavior.
  });
}

// Auto-update check: compare in-bundle version against the latest
// version.json from the network. If they differ, the SW served us
// a stale shell — clear caches and reload to pick up the new version.
//
// Skip when:
// - URL has OAuth callback params (code/state) — reload would lose them
// - URL has `?nopdate` debug bypass
// - We already reloaded once this session (loop guard)
// - Running in dev mode
(async () => {
  try {
    if (__APP_VERSION__ === 'dev') return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('code') || url.searchParams.has('state') || url.searchParams.has('error')) {
      return; // OAuth callback — never disrupt
    }
    if (url.searchParams.has('noupdate')) return;
    if (sessionStorage.getItem('iarsma-just-updated') === '1') {
      sessionStorage.removeItem('iarsma-just-updated');
      return; // Already reloaded once this session
    }

    const base = import.meta.env.BASE_URL ?? '/';
    const resp = await fetch(`${base}version.json`, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!resp.ok) return;
    const data = (await resp.json()) as { version?: string };
    if (typeof data.version !== 'string') return;
    if (data.version === __APP_VERSION__) return; // Already on latest

    // eslint-disable-next-line no-console
    console.warn(`[iarsma] running v${__APP_VERSION__}, network has v${data.version} — updating`);
    sessionStorage.setItem('iarsma-just-updated', '1');
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    window.location.reload();
  } catch {
    // Network check failed — skip silently
  }
})();
