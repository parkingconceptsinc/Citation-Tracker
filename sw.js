/* ACTPROD retired (plan of 08-11-2026, step 1.2): this app moved to pciapps.com.
   This worker replaces the old one. It deletes every cache the old app left and reloads the open tabs, so an installed
   app shows the "we moved" page instead of the cached launcher. With no fetch handler, everything comes from the network. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key);
  await self.clients.claim();
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {});
})()));
