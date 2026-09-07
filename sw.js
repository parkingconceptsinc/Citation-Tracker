const CACHE_PREFIX = "pci-citation-tracker-";
const CACHE_NAME = CACHE_PREFIX + "v6-force-shared-sync";

const APP_SHELL = [
  "./",
  "./index.html",
  "./shared-sync.js",
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
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then(clients => Promise.all(clients.map(client => {
        try {
          const u = new URL(client.url);
          if (u.origin !== self.location.origin || !u.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
          if (u.searchParams.get("_pciShared") === "v6") return;
          u.searchParams.set("_pciShared", "v6");
          return client.navigate(u.href).catch(() => {});
        } catch (_) {}
      })))
  );
});

function injectSharedSync(response) {
  if (!response) return response;
  return response.text().then(html => {
    if (!/shared-sync\.js/.test(html)) {
      html = html.replace(/<\/body>/i, '<script src="./shared-sync.js"></script>\n</body>');
    }
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-cache');
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate" || /\/(?:index\.html)?$/.test(url.pathname);
  if (isNavigation) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .catch(() => caches.match("./index.html"))
        .then(response => injectSharedSync(response))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request, { cache: "no-store" }).then(response => {
        if (!response || !response.ok) return response;
        const copy = response.clone();
        return caches.open(CACHE_NAME)
          .then(cache => cache.put(request, copy))
          .catch(() => {})
          .then(() => response);
      }).catch(() => cached);
      if (cached) event.waitUntil(network);
      return cached || network;
    })
  );
});
