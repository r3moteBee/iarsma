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
