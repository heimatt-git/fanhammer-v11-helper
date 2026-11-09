/* Service worker : réseau d'abord (toujours la dernière version), cache en secours hors ligne. */
const CACHE = 'fanhammer-v10';
const CORE = ['./', 'index.html', 'engine.js', 'hunter.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'data/index.json', 'data/mon_armee.json'];
self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    try {
      const idx = await (await fetch('data/index.json', { cache: 'no-store' })).json();
      await Promise.all(idx.factions.map(function (f) { return c.add(f.file).catch(function () {}); }));
    } catch (err) { /* hors ligne à l'installation : le reste se mettra en cache à l'usage */ }
    self.skipWaiting();
  })());
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async function () {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(req, { cache: 'no-cache' });
      if (r && r.ok) c.put(req, r.clone());
      return r;
    } catch (err) {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') { const home = await c.match('index.html'); if (home) return home; }
      throw err;
    }
  })());
});
