// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/db.js — обгортка IndexedDB для PWA касира
// ─────────────────────────────────────────────────────────────────────────────

import { CASHIER_DB_NAME, DB_VERSION, STORES } from '../../shared/constants.js';

// ─── ВІДКРИТТЯ БД ─────────────────────────────────────────────────────────────

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(CASHIER_DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // ── pending_operations ─────────────────────────────────────────────────
      // Черга операцій що очікують синхронізації
      if (!db.objectStoreNames.contains(STORES.PENDING_OPS)) {
        const s = db.createObjectStore(STORES.PENDING_OPS, { keyPath: 'uuid' });
        s.createIndex('status',     'status',     { unique: false });
        s.createIndex('next_retry', 'next_retry', { unique: false });
        s.createIndex('shift_id',   'shift_id',   { unique: false });
      }

      // ── products ───────────────────────────────────────────────────────────
      // Локальний кеш товарів. barcode — НЕ унікальний:
      // один штрихкод може мати кілька цін (різний ID_Товару).
      if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
        const s = db.createObjectStore(STORES.PRODUCTS, { keyPath: 'id' });
        s.createIndex('barcode', 'barcode', { unique: false });  // ← не унікальний
        s.createIndex('shop_id', 'shop_id', { unique: false });
        s.createIndex('group',   'group',   { unique: false });
      }

      // ── employees ──────────────────────────────────────────────────────────
      // PIN зберігається як SHA-256 хеш — вихідний PIN ніде не записується
      if (!db.objectStoreNames.contains(STORES.EMPLOYEES)) {
        const s = db.createObjectStore(STORES.EMPLOYEES, { keyPath: 'pin_hash' });
        s.createIndex('shop_id', 'shop_id', { unique: false });
        s.createIndex('name',    'name',    { unique: false });
      }

      // ── current_shift ──────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains(STORES.CURRENT_SHIFT)) {
        db.createObjectStore(STORES.CURRENT_SHIFT, { keyPath: 'shop_id' });
      }

      // ── sync_log ───────────────────────────────────────────────────────────
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

// ─── УТИЛІТИ ─────────────────────────────────────────────────────────────────

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error('Transaction aborted'));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ТОВАРИ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Повертає МАСИВ товарів з даним штрихкодом, відсортований за ціною зростанням.
 *
 * Причина масиву: один штрихкод може мати кілька цін
 * (напр. Bond по 100 ₴ і Bond по 110 ₴ — різні позиції).
 * PWA показує діалог вибору якщо знайдено > 1 результату.
 *
 * Поля кожного об'єкту: id, barcode, name, group, subgroup,
 *   sell_price, purchase_price, stock, mrc, volume_l, strength, shop_id
 */
export async function findProductByBarcode(barcode) {
  const db      = await openDB();
  const tx      = db.transaction(STORES.PRODUCTS, 'readonly');
  const index   = tx.objectStore(STORES.PRODUCTS).index('barcode');
  const results = await wrap(index.getAll(String(barcode)));

  return results
    .filter(p => p.active === true)                    // Тільки активні
    .sort((a, b) => a.sell_price - b.sell_price)       // Від найдешевшої ціни
    .map(p => ({                                       // Нормалізований вивід
      id:             p.id,
      barcode:        p.barcode,
      name:           p.name,
      group:          p.group,
      subgroup:       p.subgroup,
      sell_price:     p.sell_price,
      purchase_price: p.purchase_price,
      stock:          p.stock,
      mrc:            p.mrc,        // Мінімальна роздрібна ціна (для перевірки)
      volume_l:       p.volume_l,
      strength:       p.strength,
      shop_id:        p.shop_id,
    }));
}

export async function findProductById(productId) {
  const db = await openDB();
  const tx = db.transaction(STORES.PRODUCTS, 'readonly');
  return wrap(tx.objectStore(STORES.PRODUCTS).get(String(productId)));
}

/** Зберігає масив товарів (повний перезапис відповідних записів). */
export async function upsertProducts(rawArray) {
  const db = await openDB();
  const tx = db.transaction(STORES.PRODUCTS, 'readwrite');
  const st = tx.objectStore(STORES.PRODUCTS);
  for (const raw of rawArray) {
    st.put(normalizeProduct(raw));
  }
  await txComplete(tx);
}

/** Зберігає або оновлює один товар (вже нормалізований об'єкт). */
export async function upsertProduct(product) {
  const db = await openDB();
  const tx = db.transaction(STORES.PRODUCTS, 'readwrite');
  tx.objectStore(STORES.PRODUCTS).put(product);
  await txComplete(tx);
}

/** Оновлює залишок одного товару після продажу (офлайн-оновлення кешу). */
export async function adjustProductStock(productId, delta) {
  const db      = await openDB();
  const tx      = db.transaction(STORES.PRODUCTS, 'readwrite');
  const st      = tx.objectStore(STORES.PRODUCTS);
  const product = await wrap(st.get(String(productId)));
  if (product) {
    product.stock = (product.stock || 0) + delta;
    st.put(product);
  }
  await txComplete(tx);
}

export function normalizeProduct(raw) {
  return {
    id:             raw['ID_Товару']          ?? raw.id              ?? '',
    barcode:        raw['Штрихкод']           ?? raw.barcode          ?? '',
    name:           raw['Назва']              ?? raw.name             ?? '',
    group:          raw['Група']              ?? raw.group            ?? '',
    subgroup:       raw['Підгрупа']           ?? raw.subgroup          ?? '',
    purchase_price: Number(raw['Ціна_Закупки']   ?? raw.purchase_price ?? 0),
    sell_price:     Number(raw['Ціна_Продажі']  ?? raw.sell_price     ?? 0),
    stock:          Number(raw['Залишок']        ?? raw.stock          ?? 0),
    volume_l:       Number(raw['Обʼєм_Літрів']   ?? raw.volume_l      ?? 0),
    strength:       Number(raw['Фортеця_Градусів']?? raw.strength      ?? 0),
    mrc:            Number(raw['МРЦ_Закон']      ?? raw.mrc            ?? 0),
    active:         raw['Активний'] === true || raw.active === true,
    shop_id:        raw['Магазин_ID']         ?? raw.shop_id           ?? '',
    updated_at:     raw['Дата_Оновлення']      ?? raw.updated_at       ?? '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  СПІВРОБІТНИКИ
// ─────────────────────────────────────────────────────────────────────────────

/** Повертає співробітника за SHA-256 хешем PIN. */
export async function findEmployeeByPinHash(pinHash) {
  const db = await openDB();
  const tx = db.transaction(STORES.EMPLOYEES, 'readonly');
  return wrap(tx.objectStore(STORES.EMPLOYEES).get(String(pinHash)));
}

export async function upsertEmployees(rawArray) {
  const db = await openDB();
  const tx = db.transaction(STORES.EMPLOYEES, 'readwrite');
  const st = tx.objectStore(STORES.EMPLOYEES);
  for (const raw of rawArray) {
    st.put(normalizeEmployee(raw));
  }
  await txComplete(tx);
}

export function normalizeEmployee(raw) {
  return {
    pin_hash:   raw['ПІН_Код']          ?? raw.pin_hash        ?? '',
    name:       raw['Імʼя_Продавця']   ?? raw.name             ?? '',
    role:       raw['Роль']             ?? raw.role             ?? 'Касир',
    shop_id:    raw['Магазин_ID']       ?? raw.shop_id          ?? '',
    daily_rate: Number(raw['Денна_Ставка'] ?? raw.daily_rate    ?? 0),
    pct: {
      'Тютюнові вироби': Number(raw['%_Тютюнові_вироби'] ?? 0),
      'Пиво та напої':   Number(raw['%_Пиво_та_напої']   ?? 0),
      'Мінвода та соки': Number(raw['%_Мінвода_та_соки'] ?? 0),
      'Алкогольні напої':Number(raw['%_Алкогольні_напої']?? 0),
      'Штучні товари':   Number(raw['%_Штучні_товари']   ?? 0),
      'Кава':            Number(raw['%_Кава']            ?? 0),
    },
    status:     raw['Статус'] ?? raw.status ?? 'Активний',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ПОТОЧНА ЗМІНА
// ─────────────────────────────────────────────────────────────────────────────

export async function getShift(shopId) {
  const db = await openDB();
  const tx = db.transaction(STORES.CURRENT_SHIFT, 'readonly');
  return wrap(tx.objectStore(STORES.CURRENT_SHIFT).get(String(shopId)));
}

export async function getAllShifts() {
  const db = await openDB();
  const tx = db.transaction(STORES.CURRENT_SHIFT, 'readonly');
  return wrap(tx.objectStore(STORES.CURRENT_SHIFT).getAll());
}

export async function saveShift(shiftData) {
  const db = await openDB();
  const tx = db.transaction(STORES.CURRENT_SHIFT, 'readwrite');
  tx.objectStore(STORES.CURRENT_SHIFT).put(shiftData);
  await txComplete(tx);
}

export async function clearShift(shopId) {
  const db = await openDB();
  const tx = db.transaction(STORES.CURRENT_SHIFT, 'readwrite');
  tx.objectStore(STORES.CURRENT_SHIFT).delete(String(shopId));
  await txComplete(tx);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ЧЕРГА ОПЕРАЦІЙ
// ─────────────────────────────────────────────────────────────────────────────

/** Зберігає операцію зі статусом pending. */
export async function saveOperation(op) {
  const db = await openDB();
  const tx = db.transaction(STORES.PENDING_OPS, 'readwrite');
  tx.objectStore(STORES.PENDING_OPS).put({
    ...op,
    status:     op.status     ?? 'pending',
    attempts:   op.attempts   ?? 0,
    next_retry: op.next_retry ?? 0,
    saved_at:   Date.now(),
  });
  await txComplete(tx);
}

/**
 * Повертає операції готові до синхронізації:
 *   - статус 'pending'
 *   - статус 'error' і next_retry <= зараз
 */
export async function getReadyToSync() {
  const db  = await openDB();
  const tx  = db.transaction(STORES.PENDING_OPS, 'readonly');
  const all = await wrap(tx.objectStore(STORES.PENDING_OPS).getAll());
  const now = Date.now();
  return all.filter(op =>
    op.status === 'pending' ||
    (op.status === 'error' && (op.next_retry ?? 0) <= now)
  );
}

/** Знаходить одну операцію за UUID (потрібно для оновлення лічильника спроб). */
export async function getOperationByUUID(uuid) {
  const db = await openDB();
  const tx = db.transaction(STORES.PENDING_OPS, 'readonly');
  return wrap(tx.objectStore(STORES.PENDING_OPS).get(String(uuid)));
}

/** Оновлює статус операції та додаткові поля. */
export async function updateOpStatus(uuid, status, extra = {}) {
  const db = await openDB();
  const tx = db.transaction(STORES.PENDING_OPS, 'readwrite');
  const st = tx.objectStore(STORES.PENDING_OPS);
  const op = await wrap(st.get(String(uuid)));
  if (op) st.put({ ...op, status, ...extra });
  await txComplete(tx);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ЖУРНАЛ СИНХРОНІЗАЦІЙ
// ─────────────────────────────────────────────────────────────────────────────

export async function logSync(entry) {
  const db = await openDB();
  const tx = db.transaction(STORES.SYNC_LOG, 'readwrite');
  tx.objectStore(STORES.SYNC_LOG).put({
    uuid:      entry.uuid,
    status:    entry.status,
    timestamp: Date.now(),
    message:   entry.message ?? '',
  });
  await txComplete(tx);
}
