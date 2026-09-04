const CACHE_PREFIX = "pci-citation-tracker-";
const CACHE_NAME = CACHE_PREFIX + "v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/logo.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GETs. The whole app is static and
// runs entirely offline (data lives in IndexedDB), so a cached shell paints
// instantly and the background fetch refreshes it for next open. Update path:
// bump CACHE_NAME.
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (!response || !response.ok) return response;
        const copy = response.clone();
        return caches.open(CACHE_NAME)
          .then(cache => cache.put(request, copy))
          .catch(() => {})
          .then(() => response);
      }).catch(() => cached || caches.match("./index.html"));
      if (cached) event.waitUntil(network);
      return cached || network;
    })
  );
});
