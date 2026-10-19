const CACHE = 'virtual-home-v4';
const ROOT = new URL('./', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const response = await fetch(ROOT);
      if (response.ok) {
        await cache.put(ROOT, response.clone());
        const html = await response.text();
        const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map(match => match[1])
          .filter(url => !url.startsWith('data:'));
        await Promise.all(urls.map(async url => {
          try {
            const absolute = new URL(url, self.registration.scope);
            if (absolute.origin !== self.location.origin || absolute.pathname.includes('/cdn-cgi/')) return;
            const asset = await fetch(absolute.href);
            if (asset.ok) await cache.put(absolute.href, asset);
          } catch {}
        }));
      }
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/cdn-cgi/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match(ROOT)))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
