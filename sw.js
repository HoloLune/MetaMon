// MetaMon service worker.
// 1) Adds the cross-origin isolation headers mGBA's threaded WebAssembly needs
//    (static hosts like GitHub Pages cannot set COOP/COEP themselves).
// 2) Keeps an offline copy of the app shell (network first, cache fallback).
const CACHE = 'metamon-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function isolate(res) {
  if (!res || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = url.pathname.endsWith('/') ? url.pathname : req;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(key, res.clone()).catch(() => {});
      return isolate(res);
    } catch (err) {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return isolate(hit);
      throw err;
    }
  })());
});
