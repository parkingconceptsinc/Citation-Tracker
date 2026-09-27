const CACHE_PREFIX = "pci-citation-tracker-";
const CACHE_NAME = CACHE_PREFIX + "v13-no-forced-reload";

const APP_SHELL = [
  "./",
  "./index.html",
  "./shared-sync.js",
  "./shared-ui.js",
  "./manifest.json",
  "./assets/logo.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", event => {
  // No skipWaiting(): a new version installs in the background and only
  // takes over once every open tab/iframe using the old one has closed.
  // It used to call skipWaiting() and force every open client to reload
  // immediately (see below) to push a one-time shared-sync migration out
  // right away. That migration finished weeks ago; what's left of the
  // mechanism now just means any deploy that changes this file can hit an
  // already-open Citation Tracker (e.g. embedded in Management's iframe)
  // mid-load, reported as it either asking to "open in browser" (the
  // embedding app's own 9s frame-load fallback) or hanging — the forced
  // client.navigate() below competing with the page's own in-flight load.
  // Trade-off accepted: a tab/iframe that's never closed across a deploy
  // stays on the old version until it is (this is the standard, safe
  // service-worker default everywhere — not an oversight). Closing the
  // Citation Tracker panel in Management already navigates its iframe to
  // about:blank, which drops that client, so the common case still
  // updates the next time it's reopened.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function injectSharedBoot(response) {
  if (!response) return response;
  return response.text().then(html => {
    if (!/shared-sync\.js/.test(html)) {
      // The legacy index boots with refresh() against IndexedDB. Suppress that
      // initial local read on controlled navigations so shared-sync owns the
      // only boot refresh.
      html = html.replace(
        /bind\(\);\s*applyLang\(\);\s*refresh\(\);/,
        'bind();\napplyLang();\nwindow.__PCI_SHARED_BOOT_PENDING__ = true;'
      );
      html = html.replace(
        /<\/body>/i,
        '<script src="./shared-sync.js"></script>\n<script src="./shared-ui.js"></script>\n</body>'
      );
    }
    const headers = new Headers(response.headers);
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "no-store, max-age=0");
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
        .then(response => injectSharedBoot(response))
    );
    return;
  }

  // Critical shared runtime files are network-first and fall back to the
  // current versioned cache only when offline.
  if (/\/(?:shared-sync|shared-ui)\.js$/.test(url.pathname)) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).then(response => {
        if (!response || !response.ok) throw new Error("shared runtime fetch failed");
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {}));
        return response;
      }).catch(() => caches.match(request))
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
