// ─────────────────────────────────────────────────────────────────────────────
//  admin/sw.js — Service Worker PWA адміністратора
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME   = 'admin-v6';
const GAS_HOSTNAME = 'script.google.com';

const SHELL = [
  '/admin/',
  '/admin/index.html',
  '/admin/manifest.json',
  '/admin/css/main.css',
  '/admin/js/app.js?v=6',
  '/admin/js/db.js?v=6',
  '/admin/js/sync.js?v=6',
  '/admin/js/auth.js?v=6',
  '/admin/js/dashboard.js?v=6',
  '/admin/js/expenses.js?v=6',
  '/admin/js/inventory.js?v=6',
  '/admin/js/salary.js?v=6',
  '/admin/js/products.js?v=6',
  '/admin/js/cash.js?v=6',
  '/admin/js/reports.js?v=6',
  '/admin/js/utils.js?v=6',
  '/shared/crypto.js?v=6',
  '/shared/constants.js?v=6',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        SHELL.map(url =>
          fetch(url, { cache: 'no-store' }).then(res => {
            if (res.ok) return cache.put(url.split('?')[0], res);
          })
        )
      )
    ).then(() => self.skipWaiting())
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
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, toCache));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('/admin/index.html');
      });
    })
  );
});
