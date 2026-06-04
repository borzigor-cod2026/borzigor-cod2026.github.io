// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/db.js — обгортка IndexedDB для PWA адміністратора
//  Та сама схема, що і cashier/js/db.js, але ізольована БД (ADMIN_DB_NAME).
// ─────────────────────────────────────────────────────────────────────────────

import { ADMIN_DB_NAME, DB_VERSION, STORES } from '../../shared/constants.js';

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(ADMIN_DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORES.PENDING_OPS)) {
        const s = db.createObjectStore(STORES.PENDING_OPS, { keyPath: 'uuid' });
        s.createIndex('status',     'status',     { unique: false });
        s.createIndex('next_retry', 'next_retry', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
        const s = db.createObjectStore(STORES.PRODUCTS, { keyPath: 'id' });
        s.createIndex('barcode', 'barcode', { unique: false });
        s.createIndex('shop_id', 'shop_id', { unique: false });
        s.createIndex('group',   'group',   { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.EMPLOYEES)) {
        const s = db.createObjectStore(STORES.EMPLOYEES, { keyPath: 'pin_hash' });
        s.createIndex('shop_id', 'shop_id', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.CURRENT_SHIFT)) {
        db.createObjectStore(STORES.CURRENT_SHIFT, { keyPath: 'shop_id' });
      }

      if (!db.objectStoreNames.contains(STORES.SYNC_LOG)) {
        const s = db.createObjectStore(STORES.SYNC_LOG, { keyPath: 'uuid' });
        s.createIndex('status',    'status',    { unique: false });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => { _dbPromise = null; reject(e.target.error); };
  });

  return _dbPromise;
}

function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
function txComplete(tx) {
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(new Error('Transaction aborted')); });
}

// ─── ПРОДУКТИ (спільний код з cashier) ───────────────────────────────────────

export { normalizeProduct } from '../js/db.js';

export async function findProductByBarcode(barcode) {
  const db      = await openDB();
  const tx      = db.transaction(STORES.PRODUCTS, 'readonly');
  const results = await wrap(tx.objectStore(STORES.PRODUCTS).index('barcode').getAll(String(barcode)));
  return results
    .sort((a, b) => a.sell_price - b.sell_price)
    .map(p => ({ id: p.id, barcode: p.barcode, name: p.name, group: p.group, subgroup: p.subgroup, sell_price: p.sell_price, purchase_price: p.purchase_price, stock: p.stock, mrc: p.mrc, shop_id: p.shop_id }));
}

export async function upsertProducts(rawArray) {
  const db = await openDB();
  const tx = db.transaction(STORES.PRODUCTS, 'readwrite');
  const st = tx.objectStore(STORES.PRODUCTS);
  for (const raw of rawArray) { st.put(normalizeProductLocal(raw)); }
  await txComplete(tx);
}

export async function upsertEmployees(rawArray) {
  const db = await openDB();
  const tx = db.transaction(STORES.EMPLOYEES, 'readwrite');
  const st = tx.objectStore(STORES.EMPLOYEES);
  for (const raw of rawArray) { st.put(normalizeEmployeeLocal(raw)); }
  await txComplete(tx);
}

export async function getAllProducts(shopId) {
  const db    = await openDB();
  const tx    = db.transaction(STORES.PRODUCTS, 'readonly');
  const all   = await wrap(tx.objectStore(STORES.PRODUCTS).getAll());
  return shopId ? all.filter(p => p.shop_id === shopId) : all;
}

export async function getAllEmployees(shopId) {
  const db  = await openDB();
  const tx  = db.transaction(STORES.EMPLOYEES, 'readonly');
  const all = await wrap(tx.objectStore(STORES.EMPLOYEES).getAll());
  return shopId ? all.filter(e => e.shop_id === shopId) : all;
}

export async function saveOperation(op) {
  const db = await openDB();
  const tx = db.transaction(STORES.PENDING_OPS, 'readwrite');
  tx.objectStore(STORES.PENDING_OPS).put({ ...op, status: op.status ?? 'pending', attempts: op.attempts ?? 0, next_retry: op.next_retry ?? 0, saved_at: Date.now() });
  await txComplete(tx);
}

export async function getReadyToSync() {
  const db  = await openDB();
  const tx  = db.transaction(STORES.PENDING_OPS, 'readonly');
  const all = await wrap(tx.objectStore(STORES.PENDING_OPS).getAll());
  const now = Date.now();
  return all.filter(op => op.status === 'pending' || (op.status === 'error' && (op.next_retry ?? 0) <= now));
}

export async function getOperationByUUID(uuid) {
  const db = await openDB();
  const tx = db.transaction(STORES.PENDING_OPS, 'readonly');
  return wrap(tx.objectStore(STORES.PENDING_OPS).get(String(uuid)));
}

export async function updateOpStatus(uuid, status, extra = {}) {
  const db = await openDB();
  const tx = db.transaction(STORES.PENDING_OPS, 'readwrite');
  const st = tx.objectStore(STORES.PENDING_OPS);
  const op = await wrap(st.get(String(uuid)));
  if (op) st.put({ ...op, status, ...extra });
  await txComplete(tx);
}

export async function logSync(entry) {
  const db = await openDB();
  const tx = db.transaction(STORES.SYNC_LOG, 'readwrite');
  tx.objectStore(STORES.SYNC_LOG).put({ uuid: entry.uuid, status: entry.status, timestamp: Date.now(), message: entry.message ?? '' });
  await txComplete(tx);
}

// Локальні нормалізатори (щоб не мати циклічного імпорту)
function normalizeProductLocal(raw) {
  return {
    id:             raw['ID_Товару']          ?? raw.id              ?? '',
    barcode:        raw['Штрихкод']           ?? raw.barcode          ?? '',
    name:           raw['Назва']              ?? raw.name             ?? '',
    group:          raw['Група']              ?? raw.group            ?? '',
    subgroup:       raw['Підгрупа']           ?? raw.subgroup          ?? '',
    purchase_price: Number(raw['Ціна_Закупки']   ?? raw.purchase_price ?? 0),
    sell_price:     Number(raw['Ціна_Продажі']  ?? raw.sell_price     ?? 0),
    stock:          Number(raw['Залишок']        ?? raw.stock          ?? 0),
    mrc:            Number(raw['МРЦ_Закон']      ?? raw.mrc            ?? 0),
    active:         raw['Активний'] === true || raw.active === true,
    shop_id:        raw['Магазин_ID']         ?? raw.shop_id           ?? '',
  };
}

function normalizeEmployeeLocal(raw) {
  return {
    pin_hash:   raw['ПІН_Код']          ?? raw.pin_hash   ?? '',
    name:       raw['Імʼя_Продавця']   ?? raw.name        ?? '',
    role:       raw['Роль']             ?? raw.role        ?? 'Касир',
    shop_id:    raw['Магазин_ID']       ?? raw.shop_id     ?? '',
    daily_rate: Number(raw['Денна_Ставка'] ?? raw.daily_rate ?? 0),
    status:     raw['Статус']           ?? raw.status      ?? 'Активний',
  };
}
