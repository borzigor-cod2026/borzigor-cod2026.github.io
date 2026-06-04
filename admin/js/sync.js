// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/sync.js — двигун синхронізації PWA адміністратора
//  Той самий алгоритм backoff що і cashier/js/sync.js
// ─────────────────────────────────────────────────────────────────────────────

import { computeHMAC }                                from '../../shared/crypto.js';
import { API_VERSION, BACKOFF_DELAYS_MS, SYNC_STATUS } from '../../shared/constants.js';
import {
  getReadyToSync, getOperationByUUID, updateOpStatus, logSync,
  upsertProducts, upsertEmployees,
} from './db.js';

let _gasUrl = '', _apiSecret = '', _shopId = '';

export function configureSyncEngine({ gasUrl, apiSecret, shopId }) {
  _gasUrl = gasUrl; _apiSecret = apiSecret; _shopId = shopId;
}

export function setupOnlineListener() {
  window.addEventListener('online', () => syncPending());
}

let _syncInProgress = false;

export async function syncPending() {
  if (_syncInProgress || !navigator.onLine || !_gasUrl) return;
  _syncInProgress = true;
  try {
    const ops = await getReadyToSync();
    if (!ops.length) return;

    const body = JSON.stringify({ type: 'sync_batch', shop_id: _shopId, operations: ops });
    const sig  = await computeHMAC(body, _apiSecret);
    const url  = `${_gasUrl}?api_version=${API_VERSION}&api_signature=${sig}`;

    let res;
    try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); }
    catch (_) { return; }

    if (!res.ok) return;
    const json = await res.json();
    if (!json.success || !Array.isArray(json.results)) return;

    let hasSynced = false;
    for (const r of json.results) {
      if (await handleSyncResult(r)) hasSynced = true;
    }
    if (hasSynced) { await refreshProductCache(); await refreshEmployeeCache(); }
  } finally {
    _syncInProgress = false;
  }
}

export async function handleSyncResult({ uuid, status, message }) {
  switch (status) {
    case SYNC_STATUS.SYNCED:
      await updateOpStatus(uuid, SYNC_STATUS.SYNCED);
      await logSync({ uuid, status: SYNC_STATUS.SYNCED });
      return true;

    case SYNC_STATUS.CONFLICT:
      await updateOpStatus(uuid, SYNC_STATUS.CONFLICT);
      await logSync({ uuid, status: SYNC_STATUS.CONFLICT });
      return false;

    case SYNC_STATUS.ERROR: {
      const cur      = await getOperationByUUID(uuid);
      const attempts = ((cur?.attempts) ?? 0) + 1;
      const delayMs  = BACKOFF_DELAYS_MS[Math.min(attempts - 1, BACKOFF_DELAYS_MS.length - 1)];
      await updateOpStatus(uuid, SYNC_STATUS.ERROR, { attempts, next_retry: Date.now() + delayMs });
      await logSync({ uuid, status: SYNC_STATUS.ERROR, message: message ?? '' });
      return false;
    }
    default: return false;
  }
}

export async function refreshProductCache() {
  if (!_gasUrl || !_shopId) return;
  try {
    const body = JSON.stringify({ type: 'get_products', shop_id: _shopId });
    const sig  = await computeHMAC(body, _apiSecret);
    const res  = await fetch(`${_gasUrl}?api_version=${API_VERSION}&api_signature=${sig}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const json = await res.json();
    if (json.success && Array.isArray(json.products)) await upsertProducts(json.products);
  } catch (_) {}
}

export async function refreshEmployeeCache() {
  if (!_gasUrl || !_shopId) return;
  try {
    const body = JSON.stringify({ type: 'get_employees', shop_id: _shopId });
    const sig  = await computeHMAC(body, _apiSecret);
    const res  = await fetch(`${_gasUrl}?api_version=${API_VERSION}&api_signature=${sig}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const json = await res.json();
    if (json.success && Array.isArray(json.employees)) await upsertEmployees(json.employees);
  } catch (_) {}
}
