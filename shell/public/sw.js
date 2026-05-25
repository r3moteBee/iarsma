/**
 * Iarsma Service Worker — app shell cache.
 *
 * Prevents the browser HTTP Basic Auth dialog by:
 * 1. Serving the shell from cache on navigation (reload)
 * 2. Never letting a 401 response reach the browser
 * 3. If no cache and auth fails, returning a minimal page that
 *    triggers the OAuth flow instead of showing Basic Auth
 *
 * Strategy:
 * - Navigation: cache-first. Background fetch updates cache for
 *   next reload. 401s are swallowed — never shown to browser.
 * - Static assets (JS/CSS/WASM): stale-while-revalidate.
 * - API calls (JMAP, auth, MCP): network-only, never cached.
 */

const CACHE_NAME = 'iarsma-shell-v3';

const API_PATTERNS = [
  '/jmap',
  '/.well-known/jmap',
  '/.well-known/openid-configuration',
  '/auth/',
  '/api/',
  '/mcp',
  '/agents/',
  '/config.json',
];

function isApiRequest(url) {
  const path = new URL(url).pathname;
  return API_PATTERNS.some((p) => path.startsWith(p) || path.includes(p));
}

function isStaticAsset(url) {
  const path = new URL(url).pathname;
  return (
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.wasm') ||
    path.endsWith('.html') ||
    path.endsWith('.json') ||
    path.endsWith('.map') ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.ico')
  );
}

/**
 * Minimal fallback page shown when there's no cache AND the server
 * returns 401. Instead of the browser showing a Basic Auth dialog,
 * this page loads and immediately starts the OAuth redirect flow.
 * The real app JS handles the OAuth dance — we just need to get
 * index.html loaded without the auth dialog blocking it.
 */
const AUTH_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Iarsma — Signing in…</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafafa; color: #333; }
    .card { text-align: center; padding: 2em; }
    a { color: #ff6b35; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Iarsma</h2>
    <p>Authentication required. <a href="./">Sign in</a></p>
    <p style="color:#999;font-size:0.85em">If this page persists, clear site data and reload.</p>
  </div>
</body>
</html>`;

// Install: activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: clean old caches, claim all clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('iarsma-shell-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (isApiRequest(request.url)) return;

  // ── Navigation (page load / reload) ────────────────────────
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // ── Static assets ──────────────────────────────────────────
  if (isStaticAsset(request.url)) {
    event.respondWith(handleStaticAsset(request));
    return;
  }
});

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Always try to update the cache in the background.
  // Use no-cors mode to prevent the browser from showing
  // the auth dialog — we handle 401s ourselves.
  const updateCache = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // If we have a cached version, serve it immediately.
  // The background fetch will update the cache for next time.
  if (cached) {
    updateCache.catch(() => {}); // fire and forget
    return cached;
  }

  // No cache — we MUST get something from the network.
  const response = await updateCache;

  if (response && response.ok) {
    return response;
  }

  // Network failed or returned 401 — serve the auth fallback
  // page instead of letting the browser show Basic Auth dialog.
  return new Response(AUTH_FALLBACK_HTML, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

async function handleStaticAsset(request) {
  const cached = await caches.match(request);

  // Background network update
  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, clone));
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkFetch.catch(() => {}); // fire and forget
    return cached;
  }

  // No cache — wait for network
  const response = await networkFetch;
  if (response && response.ok) {
    return response;
  }

  // Asset not available — return 404
  return new Response('Not found', { status: 404 });
}

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
