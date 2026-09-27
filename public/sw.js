// Service Worker for Offline transit access and PWA support
const CACHE_NAME = 'nifikishe-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/i18n.js',
  '/js/map-service.js',
  '/images/daladala.svg',
  '/images/brt.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }).catch(() => caches.match('/index.html'))
  );
});
