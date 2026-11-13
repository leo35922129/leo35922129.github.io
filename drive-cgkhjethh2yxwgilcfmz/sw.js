const C = 'ht-shell-v19';
const SHELL = ['./', 'index.html', 'style.css?v=19', 'app.js?v=19', 'maplibre-gl.js', 'maplibre-gl.css', 'manifest.webmanifest', 'icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // tiles etc: browser default
  if (u.pathname.includes('/d/') || u.pathname.endsWith('.json')) return; // data: always network
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
