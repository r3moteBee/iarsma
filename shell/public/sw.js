/**
 * Iarsma Service Worker — app shell cache.
 *
 * Strategy:
 * - Static assets (JS, CSS, WASM, HTML): cache-first. On install,
 *   the shell is pre-cached. On fetch, serve from cache, falling
 *   back to network. Network responses update the cache for next time.
 * - API calls (JMAP, MCP, auth): network-only. Never cached.
 * - On activate: clean up old cache versions.
 *
 * This prevents the browser HTTP Basic Auth dialog on reload — the
 * shell is served from cache without hitting Stalwart's auth layer.
 */

const CACHE_NAME = 'iarsma-shell-v1';

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

// Install: pre-cache the app shell entry point
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache the shell HTML — the JS/CSS/WASM will be cached on first fetch
      // via the fetch handler's stale-while-revalidate strategy.
      return cache.addAll(['./']).catch(() => {
        // If the initial cache fails (e.g., auth required), that's OK —
        // the fetch handler will cache on first successful load.
      });
    }),
  );
  // Activate immediately without waiting for existing tabs to close
  self.skipWaiting();
});

// Activate: clean old caches, claim all clients
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

// Fetch: cache-first for static assets, network-only for API
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // API calls: always network, never cache
  if (isApiRequest(request.url)) return;

  // Navigation requests (page reload): serve cached shell HTML
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        // Try the root index as fallback (SPA routing)
        return caches.match('./').then((shell) => {
          if (shell) return shell;
          // Last resort: try network (may trigger auth dialog on first load)
          return fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          });
        });
      }),
    );
    return;
  }

  // Static assets: cache-first with network update
  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // Serve cached immediately, update in background
        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => cached); // Offline: fall back to cache

        return cached || networkFetch;
      }),
    );
    return;
  }
});

// Listen for version update messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
