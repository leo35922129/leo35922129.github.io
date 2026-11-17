const C = 'ht-shell-v57';
const SHELL = ['./', 'index.html', 'style.css?v=57', 'app.js?v=57', 'report.js?v=57', 'maplibre-gl.js', 'maplibre-gl.css', 'manifest.webmanifest', 'icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return; // tiles etc: browser default
  // encrypted tracker data, weekly report json/txt, and mp3s: always network (stream audio, never precache)
  if (u.pathname.includes('/d/') || u.pathname.includes('/report/') || /\.(json|mp3)$/i.test(u.pathname)) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});
