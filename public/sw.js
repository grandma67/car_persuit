// Offline support for the installed app.
// Pages and the manifest: network-first (so a new deploy is picked up), falling back to the cache.
// Everything else same-origin (hashed Vite assets, icons): cache-first, filled on demand.
// Only this game's cache is read: other apps on the same github.io origin have their own.
// Bump CACHE when cached files change without changing their URL.
const CACHE = 'car-pursuit-v2';
const fromCache = (req) => caches.open(CACHE).then((c) => c.match(req));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('car-pursuit-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate' || req.url.endsWith('/manifest.webmanifest')) {
    const key = req.mode === 'navigate' ? './' : req;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() => fromCache(key)),
    );
    return;
  }

  event.respondWith(
    fromCache(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
