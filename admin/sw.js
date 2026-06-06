// ─────────────────────────────────────────────────────────────────────────────
//  admin/sw.js — Service Worker PWA адміністратора
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME   = 'admin-v4';
const GAS_HOSTNAME = 'script.google.com';

const SHELL = [
  '/admin/',
  '/admin/index.html',
  '/admin/manifest.json',
  '/admin/css/main.css',
  '/admin/js/app.js',
  '/admin/js/db.js',
  '/admin/js/sync.js',
  '/admin/js/auth.js',
  '/admin/js/dashboard.js',
  '/admin/js/expenses.js',
  '/admin/js/inventory.js',
  '/admin/js/salary.js',
  '/admin/js/products.js',
  '/admin/js/cash.js',
  '/admin/js/reports.js',
  '/admin/js/utils.js',
  '/shared/crypto.js',
  '/shared/constants.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.hostname === GAS_HOSTNAME) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic' && url.origin === self.location.origin) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('/admin/index.html');
      });
    })
  );
});
