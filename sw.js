const CACHE_PREFIX = "pci-citation-tracker-";
const CACHE_NAME = CACHE_PREFIX + "v14-offline-fallback";

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
  // cache.addAll() is all-or-nothing: one entry that 404s or times out
  // rejects the whole install, the worker never activates, and the app is
  // left with no offline cache at all. Cache each entry on its own so a
  // single failure costs only that entry.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(
      APP_SHELL.map(path => cache.add(path).catch(err => {
        console.warn("[Citation Tracker SW] could not precache", path, err);
      }))
    ))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Both the network and the cache can come up empty on a navigation: the cache
// was evicted, it is a first visit on a dead connection, or a private window.
// That used to reach respondWith() as undefined, which the browser reports as
// "FetchEvent resulted in a network error" and paints as a blank page -
// indistinguishable from the app itself being broken. Say what happened.
function offlineFallbackResponse() {
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>Citation Tracker</title><style>",
    ":root{color-scheme:light dark}",
    "body{margin:0;min-height:100vh;display:flex;align-items:center;",
    "justify-content:center;padding:16px;background:#F5F6F9;color:#10233F;",
    "font:500 15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}",
    "@media(prefers-color-scheme:dark){body{background:#0E163B;color:#fff}}",
    "div{max-width:22rem;text-align:center}",
    "h1{margin:0 0 .5rem;font-size:19px}",
    "p{margin:0;opacity:.75}",
    "</style></head><body><div>",
    "<h1>Citation Tracker is offline</h1>",
    "<p>No connection, and this device has no cached copy of the app yet. ",
    "Reconnect and reload.</p>",
    "</div></body></html>"
  ].join("");
  return new Response(html, {
    status: 503,
    statusText: "Offline",
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0"
    }
  });
}

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
        .then(response => response ? injectSharedBoot(response) : offlineFallbackResponse())
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
