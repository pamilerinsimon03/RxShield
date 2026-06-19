const CACHE_NAME = 'rxshield-cache-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/404.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/database/rxshield_core.db',
  '/models/crnn_int8.onnx',
  '/wasm/ort-wasm-simd-threaded.wasm',
  '/wasm/ort-wasm-simd-threaded.mjs',
  '/wasm/ort-wasm-simd-threaded.jspi.wasm',
  '/wasm/ort-wasm-simd-threaded.jspi.mjs'
];

// Install Event - Pre-cache critical core shell assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching critical assets...');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.error('[Service Worker] Error during addAll: ', err);
      });
    })
  );
});

// Activate Event - Claim clients and purge old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting obsolete cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Strict Cache-First Strategy with Network Fallback
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Avoid intercepting NextJS hot-reloading dev server events or Chrome extensions
  if (url.pathname.includes('/_next/webpack-hmr') || url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        console.log(`[Service Worker] Cache Hit: ${url.pathname}`);
        return cachedResponse;
      }

      console.log(`[Service Worker] Cache Miss: ${url.pathname} - Fetching from network...`);
      return fetch(event.request).then((networkResponse) => {
        // Check if response is valid before caching
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
          return networkResponse;
        }

        // Cache the dynamically fetched resource
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch((err) => {
        console.error(`[Service Worker] Fetch failed for: ${url.pathname}`, err);
        
        // Return 404 page fallback if we are offline and page/file is not cached
        const acceptHeader = event.request.headers.get('accept');
        if (acceptHeader && acceptHeader.includes('text/html')) {
          return caches.match('/404.html');
        }
      });
    })
  );
});
