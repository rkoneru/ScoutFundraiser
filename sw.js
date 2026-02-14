// Service Worker for Scout Fundraiser PWA
const CACHE_NAME = 'scoutfundraiser-v2';
const QR_CODE_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './jsqr.min.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Install event - cache files and activate immediately
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache)
          .then(() => cache.add(new Request(QR_CODE_CDN, { mode: 'no-cors' })).catch(() => undefined));
      })
  );
  self.skipWaiting();
});

// Fetch event - network-first strategy
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const isQrCdn = event.request.url === QR_CODE_CDN;
        const canCache = (response.ok && response.type === 'basic') || (isQrCdn && response.type === 'opaque');
        if (canCache) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
