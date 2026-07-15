// Bump this on every deploy-affecting change so old caches are purged.
const CACHE_NAME = 'coral-v3';
const STATIC_ASSETS = [
  '/apple-touch-icon.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: for the app shell (HTML) and JS/CSS, ALWAYS go to network — never serve a
// stale cached bundle, which causes broken/blurry renders after a deploy. Only fall
// back to cache when genuinely offline. Non-app requests pass straight through.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  const url = new URL(event.request.url);
  const isAppCode =
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.html');

  if (isAppCode) {
    // Network-only for app code; on hard offline, fall back to the shell.
    event.respondWith(
      fetch(event.request).catch(() =>
        event.request.mode === 'navigate'
          ? caches.match('/index.html')
          : new Response('Offline', { status: 503 }),
      ),
    );
    return;
  }

  // Other static assets: network-first, cache as a nice-to-have offline fallback.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((c) => c || new Response('Offline', { status: 503 }))),
  );
});
