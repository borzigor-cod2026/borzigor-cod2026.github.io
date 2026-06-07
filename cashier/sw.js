// ─────────────────────────────────────────────────────────────────────────────
//  cashier/sw.js — Service Worker PWA касира
//
//  Стратегія: Cache-first з авто-кешуванням нових ресурсів.
//  GAS API запити ніколи не кешуються (завжди мережа).
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME    = 'cashier-v4';
const GAS_HOSTNAME  = 'script.google.com';

// Файли shell-кешу — завантажуються при install
const SHELL = [
  '/cashier/',
  '/cashier/index.html',
  '/cashier/manifest.json',
  '/cashier/css/main.css',
  '/cashier/js/app.js',
  '/cashier/js/db.js',
  '/cashier/js/sync.js',
  '/cashier/js/auth.js',
  '/cashier/js/scanner.js',
  '/cashier/js/cart.js',
  '/cashier/js/pos.js',
  '/cashier/js/shift.js',
  '/cashier/js/expenses.js',
  '/cashier/js/receipt.js',
  '/cashier/js/products.js',
  '/cashier/js/utils.js',
  '/shared/crypto.js',
  '/shared/constants.js',
];

// ─── INSTALL ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // GAS API → завжди мережа (ніколи не кешувати відповіді сервера)
  if (url.hostname === GAS_HOSTNAME) {
    return;
  }

  // POST-запити → завжди мережа
  if (event.request.method !== 'GET') {
    return;
  }

  // App shell та статичні ресурси: cache-first, з авто-кешуванням нових файлів
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Кешувати тільки успішні same-origin відповіді
        if (
          response.ok &&
          response.type === 'basic' &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Офлайн і немає кешу — для навігації повернути index.html
        if (event.request.mode === 'navigate') {
          return caches.match('/cashier/index.html');
        }
      });
    })
  );
});
