/* ===========================================================================
   service-worker.js — minimal app-shell cache for offline use.

   We cache the static shell (HTML/CSS/JS/manifest/icons) so the app loads
   offline. We deliberately do NOT cache camera streams or recordings.
   Strategy: cache-first for the shell, network fallback for everything else.
   =========================================================================== */

const CACHE = 'teleprom-v1';

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/storage.js',
  './js/teleprompter.js',
  './js/recorder.js',
  './js/save.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Drop old caches on version bump.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET; let the network handle everything else.
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Runtime-cache same-origin successful responses.
          if (res && res.ok && new URL(req.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // offline + uncached → undefined (browser handles)
    })
  );
});
