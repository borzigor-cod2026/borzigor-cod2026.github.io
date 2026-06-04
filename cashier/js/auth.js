// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/auth.js — авторизація касира по PIN (офлайн)
//
//  Алгоритм (ТЗ 10.1):
//  1. Касир вводить PIN
//  2. Обчислити SHA-256 від PIN
//  3. Порівняти хеш з IndexedDB (employees store)
//  4. При збігу — відкрити сесію локально, без інтернету
//  5. Сесія в пам'яті — скидається при закритті застосунку
// ─────────────────────────────────────────────────────────────────────────────

import { digestSHA256 }         from '../../shared/crypto.js';
import { findEmployeeByPinHash } from './db.js';

// Сесія в пам'яті (не localStorage, не IndexedDB)
// Скидається автоматично при перезавантаженні/закритті сторінки
let _session = null;

// ─── ВХІД ────────────────────────────────────────────────────────────────────

/**
 * Авторизує касира за PIN.
 * Повністю офлайн — порівнює хеш з локальним IndexedDB.
 *
 * @returns {Promise<{success: boolean, session?: object, error?: string}>}
 */
export async function login(pin) {
  if (!pin) {
    return { success: false, error: 'PIN не може бути порожнім' };
  }

  const pinHash = await digestSHA256(String(pin));
  let employee;
  try {
    employee = await findEmployeeByPinHash(pinHash);
  } catch (_dbErr) {
    return { success: false, error: 'Помилка бази даних. Перезавантажте сторінку.' };
  }

  if (!employee) {
    return { success: false, error: 'Невірний PIN. Спробуйте ще раз.' };
  }

  if (employee.status === 'Заблокований') {
    return { success: false, error: 'Ваш обліковий запис заблоковано. Зверніться до адміністратора.' };
  }

  _session = {
    pin_hash:    pinHash,
    name:        employee.name,
    role:        employee.role,
    shop_id:     employee.shop_id,
    daily_rate:  employee.daily_rate,
    pct:         employee.pct,
    logged_in_at: Date.now(),
  };

  return { success: true, session: getPublicSession() };
}

// ─── ВИХІД ───────────────────────────────────────────────────────────────────

export function logout() {
  _session = null;
}

// ─── ПЕРЕВІРКА СЕСІЇ ─────────────────────────────────────────────────────────

export function isAuthenticated() {
  return _session !== null;
}

/**
 * Повертає дані сесії або кидає помилку якщо не авторизований.
 * Використовується у всіх екранах що потребують автентикації.
 */
export function requireAuth() {
  if (!_session) throw new Error('Сесія не активна. Авторизуйтесь знову.');
  return _session;
}

/**
 * Публічні дані сесії (без pin_hash) для відображення в UI.
 */
export function getPublicSession() {
  if (!_session) return null;
  const { pin_hash, ...pub } = _session;
  return pub;
}
