// Coach service worker — network-first, with an offline app shell.
const CACHE = 'coach-v7';
const SHELL = ['./', 'index.html', 'style.css', 'theme.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => /^(moeware-|coach-)/.test(k) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // App shell: network-first, but fall back to the installed copy if the
  // network fails OR the host returns an error (e.g. the site was taken down).
  if (sameOrigin) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(CACHE);
          if(SHELL.some(path=>new URL(path,self.location.href).pathname===url.pathname)) await c.put(req, fresh.clone());
          return fresh;
        }
        throw new Error('bad status ' + (fresh && fresh.status));
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      }
    })());
    return;
  }

  // Cross-origin (Gemini, news feeds): straight to network, never cached.
});

