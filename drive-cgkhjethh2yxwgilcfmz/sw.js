const C = 'ht-shell-v68';
const SHELL = ['./', 'index.html', 'style.css?v=68', 'app.js?v=68', 'report.js?v=68', 'control.css?v=68', 'control.js?v=68', 'maplibre-gl.js', 'maplibre-gl.css', 'manifest.webmanifest', 'icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const hadOld = keys.some(k => k !== C);
    await Promise.all(keys.filter(k => k !== C).map(k => caches.delete(k)));
    await self.clients.claim();
    if (!hadOld) return;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'ht-sw-updated', v: C });
  })());
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // tiles etc: browser default
  // encrypted tracker data, weekly report json/txt, and mp3s: always network (stream audio, never precache)
  if (u.pathname.includes('/d/') || u.pathname.includes('/report/') || /\.(json|mp3)$/i.test(u.pathname)) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      const cp = r.clone();
      caches.open(C).then(c => c.put(e.request, cp));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
