// 构建时替换为产物内容哈希（见 vite.config.js），新版本激活后删除旧缓存。
const CACHE = 'virtual-home-__BUILD_VERSION__';
const ROOT = new URL('./', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(ROOT, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`首页缓存失败：${response.status}`);
    const html = await response.clone().text();
    await cache.put(ROOT, response);
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => new URL(match[1], self.registration.scope))
      .filter(url => url.protocol !== 'data:' && url.origin === self.location.origin && !url.pathname.includes('/cdn-cgi/'));
    // 任一资源下载失败就放弃本次安装，旧版本和它的离线缓存继续可用。
    await Promise.all(urls.map(async url => {
      const asset = await fetch(url.href);
      if (!asset.ok) throw new Error(`资源缓存失败：${url.pathname}`);
      await cache.put(url.href, asset);
    }));
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
