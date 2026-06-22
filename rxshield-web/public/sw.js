const CACHE_NAME = 'rxshield-cache-v2';

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

// Paths that should use Cache-First strategy to preserve offline loading and save bandwidth
const CACHE_FIRST_PATHS = [
  '/models/',
  '/database/',
  '/wasm/'
];

// Install Event
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

// Activate Event - Purge old caches immediately
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

// Fetch Event - Hybrid Caching Strategy
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Avoid intercepting dev HMR or Chrome extensions
  if (url.pathname.includes('/_next/webpack-hmr') || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return;
  }

  // Check if this path should use Cache-First
  const useCacheFirst = CACHE_FIRST_PATHS.some(path => url.pathname.includes(path)) || 
                        url.pathname.endsWith('.wasm') || 
                        url.pathname.endsWith('.onnx') || 
                        url.pathname.endsWith('.db');

  if (useCacheFirst) {
    // 1. Cache-First Strategy for Large Binary Files (Models, DB, Wasm)
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        }).catch((err) => {
          console.error(`[Service Worker] Cache-first fetch failed for: ${url.pathname}`, err);
          return new Response('Offline and asset not cached.', { status: 503 });
        });
      })
    );
  } else {
    // 2. Network-First Strategy for HTML, JS, CSS, and general application assets
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        }
        return networkResponse;
      }).catch(async () => {
        // Network failed (offline), check cache
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // If not in cache and requesting HTML page, return 404 fallback
        const acceptHeader = event.request.headers.get('accept');
        if (acceptHeader && acceptHeader.includes('text/html')) {
          const fallback = await caches.match('/404.html');
          if (fallback) return fallback;
        }
        return new Response('Network request failed and no cached version is available.', { status: 504 });
      })
    );
  }
});
