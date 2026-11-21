const C = 'ht-shell-v106';
const SHELL = ['./', 'index.html', 'style.css?v=106', 'app.js?v=106', 'report.js?v=106', 'control.css?v=106', 'control.js?v=106', 'daily.css?v=106', 'daily.js?v=106', 'summary.js?v=106', 'trips.css?v=106', 'trips.js?v=106', 'maplibre-gl.js', 'maplibre-gl.css', 'manifest.webmanifest', 'icon-192.png'];
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

// ---- Web Push: alerts and ask-first Approve / Skip prompts from the droplet automation engine ----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Happy Truck', body: e.data ? e.data.text() : '' }; }
  const opts = {
    body: d.body || '', tag: d.tag || 'ht', icon: 'icon-192.png', badge: 'icon-192.png',
    data: { approval: d.approval || null, url: d.url || null }, renotify: true,
    requireInteraction: !!d.approval
  };
  if (d.approval) opts.actions = [{ action: 'approve', title: 'Approve' }, { action: 'skip', title: 'Skip' }];
  e.waitUntil(self.registration.showNotification(d.title || 'Happy Truck', opts));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  // Both actions only open the approval sheet; approving still needs the device token and the confirm word (+ PIN when live).
  const hash = d.approval ? ('#approve=' + encodeURIComponent(d.approval) + (e.action === 'skip' ? '&act=skip' : '')) : '#alerts';
  const url = self.registration.scope + hash;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); w.postMessage({ type: 'ht-open', hash }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
