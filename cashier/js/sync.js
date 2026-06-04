// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/sync.js — двигун синхронізації PWA касира з GAS-бекендом
// ─────────────────────────────────────────────────────────────────────────────

import { computeHMAC }                       from '../../shared/crypto.js';
import { API_VERSION, BACKOFF_DELAYS_MS, SYNC_STATUS } from '../../shared/constants.js';
import {
  getReadyToSync,
  getOperationByUUID,
  updateOpStatus,
  logSync,
  upsertProducts,
  upsertEmployees,
} from './db.js';

// ─── КОНФІГУРАЦІЯ ────────────────────────────────────────────────────────────
// Заповнюється при старті застосунку через configureSyncEngine()

let _gasUrl    = '';
let _apiSecret = '';
let _shopId    = '';

export function configureSyncEngine({ gasUrl, apiSecret, shopId }) {
  _gasUrl    = gasUrl;
  _apiSecret = apiSecret;
  _shopId    = shopId;
}

// ─── АВТОЗАПУСК ПРИ ПОЯВІ МЕРЕЖІ ─────────────────────────────────────────────

/**
 * Встановлює слухач navigator.onLine.
 * При відновленні зв'язку автоматично запускає syncPending().
 * Викликати один раз при старті застосунку.
 */
export function setupOnlineListener() {
  window.addEventListener('online', () => {
    syncPending();
  });
}

// ─── БЛОКУВАННЯ ПАРАЛЕЛЬНИХ ЗАПУСКІВ ─────────────────────────────────────────

let _syncInProgress = false;

// ─────────────────────────────────────────────────────────────────────────────
//  syncPending — головна функція синхронізації
//
//  Алгоритм (ТЗ 9.2):
//  1. Зібрати всі pending та error-з-минулим-retry операції з IndexedDB
//  2. Відправити пакетом на GAS (syncBatch)
//  3. Обробити кожен результат:
//     - synced   → оновити IndexedDB, оновити кеш товарів/співробітників
//     - conflict → позначити в sync_log тихо, без повідомлення (штатна ситуація)
//     - error    → збільшити лічильник спроб, встановити next_retry (backoff)
// ─────────────────────────────────────────────────────────────────────────────

export async function syncPending() {
  if (_syncInProgress)   return;
  if (!navigator.onLine) return;
  if (!_gasUrl)          return;

  _syncInProgress = true;

  try {
    const ops = await getReadyToSync();
    if (ops.length === 0) return;

    const body = JSON.stringify({
      type:       'sync_batch',
      shop_id:    _shopId,
      operations: ops,
    });

    const signature = await computeHMAC(body, _apiSecret);
    const url = `${_gasUrl}?api_version=${API_VERSION}&api_signature=${signature}`;

    let response;
    try {
      response = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (_networkErr) {
      // Мережа зникла під час запиту — операції залишаються pending
      return;
    }

    if (!response.ok) return;

    const json = await response.json();
    if (!json.success || !Array.isArray(json.results)) return;

    let hasSynced = false;

    for (const result of json.results) {
      const wasNew = await handleSyncResult(result);
      if (wasNew) hasSynced = true;
    }

    // Оновити кеш тільки якщо хоча б одна операція синхронізована
    if (hasSynced) {
      await refreshProductCache();
      await refreshEmployeeCache();
    }

  } finally {
    _syncInProgress = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Обробка результату однієї операції
//  Повертає true якщо операція отримала статус synced (для оновлення кешу)
// ─────────────────────────────────────────────────────────────────────────────

export async function handleSyncResult(result) {
  const { uuid, status, message } = result;

  switch (status) {

    // ── SYNCED ───────────────────────────────────────────────────────────────
    case SYNC_STATUS.SYNCED:
      await updateOpStatus(uuid, SYNC_STATUS.SYNCED);
      await logSync({ uuid, status: SYNC_STATUS.SYNCED });
      return true;

    // ── CONFLICT ─────────────────────────────────────────────────────────────
    // UUID вже є на сервері (повторна відправка після обриву зв'язку).
    // Штатна ситуація — не помилка, не показуємо нічого користувачу.
    case SYNC_STATUS.CONFLICT:
      await updateOpStatus(uuid, SYNC_STATUS.CONFLICT);
      await logSync({ uuid, status: SYNC_STATUS.CONFLICT });
      return false;

    // ── ERROR ─────────────────────────────────────────────────────────────────
    // Повторити з exponential backoff:
    //   attempt 1 →  1 хв (BACKOFF_DELAYS_MS[0])
    //   attempt 2 →  5 хв (BACKOFF_DELAYS_MS[1])
    //   attempt 3+ → 30 хв (BACKOFF_DELAYS_MS[2])
    case SYNC_STATUS.ERROR: {
      const current  = await getOperationByUUID(uuid);
      const attempts = ((current?.attempts) ?? 0) + 1;
      const delayIdx = Math.min(attempts - 1, BACKOFF_DELAYS_MS.length - 1);
      const delayMs  = BACKOFF_DELAYS_MS[delayIdx];
      const nextRetry = Date.now() + delayMs;

      await updateOpStatus(uuid, SYNC_STATUS.ERROR, { attempts, next_retry: nextRetry });
      await logSync({ uuid, status: SYNC_STATUS.ERROR, message: message ?? '' });
      return false;
    }

    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Оновлення кешу після успішної синхронізації
// ─────────────────────────────────────────────────────────────────────────────

export async function refreshProductCache() {
  if (!_gasUrl || !_shopId) return;
  try {
    const body = JSON.stringify({ type: 'get_products', shop_id: _shopId });
    const sig  = await computeHMAC(body, _apiSecret);
    const url  = `${_gasUrl}?api_version=${API_VERSION}&api_signature=${sig}`;
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.products)) {
      await upsertProducts(json.products);
      localStorage.setItem('products_synced_at', json.synced_at ?? new Date().toISOString());
    }
  } catch (_) {
    // Офлайн або помилка — використовуємо старий кеш
  }
}

export async function refreshEmployeeCache() {
  if (!_gasUrl || !_shopId) return;
  try {
    const body = JSON.stringify({ type: 'get_employees', shop_id: _shopId });
    const sig  = await computeHMAC(body, _apiSecret);
    const url  = `${_gasUrl}?api_version=${API_VERSION}&api_signature=${sig}`;
    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.employees)) {
      await upsertEmployees(json.employees);
      localStorage.setItem('employees_synced_at', json.synced_at ?? new Date().toISOString());
    }
  } catch (_) { /* Офлайн — залишаємо старий кеш */ }
}
