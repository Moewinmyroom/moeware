// Wrinkle Coach: keep one coherent installed release, including offline.
const CACHE = 'wrinkle-coach-v8';
const SHELL = ['./', 'index.html', 'style.css?v=8', 'theme.js?v=8', 'startup.js?v=8', 'app.js?v=8', 'manifest.webmanifest?v=8', 'icons/icon-192.png?v=8', 'icons/icon-180.png?v=8', 'icons/icon-512.png?v=8'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    SHELL.map(path => new Request(new URL(path, self.location.href), {cache:'reload'}))
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => /^(moeware-|coach-|wrinkle-coach-)/.test(key) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // HTML and its versioned scripts always come from the same installation.
    // Never overwrite individual installed files with a different release.
    if (request.mode === 'navigate') {
      const page = await cache.match('index.html');
      if (page) return page;
    }
    const installed = await cache.match(request);
    if (installed) return installed;
    return fetch(request);
  })());
});
