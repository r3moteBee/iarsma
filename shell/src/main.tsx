import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

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
(async () => {
  try {
    const base = import.meta.env.BASE_URL ?? '/';
    const resp = await fetch(`${base}version.json`, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!resp.ok) return;
    const data = (await resp.json()) as { version?: string };
    if (typeof data.version !== 'string') return;
    if (data.version !== __APP_VERSION__ && __APP_VERSION__ !== 'dev') {
      // eslint-disable-next-line no-console
      console.warn(`[iarsma] running v${__APP_VERSION__}, network has v${data.version} — updating`);
      // Clear all SW caches and reload
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      window.location.reload();
    }
  } catch {
    // Network check failed — skip silently
  }
})();
