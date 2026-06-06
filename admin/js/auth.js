// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/auth.js — авторизація адміністратора
//
//  На відміну від касира, адмін авторизується ОНЛАЙН:
//  PIN-хеш надсилається до GAS, де перевіряється відносно ADMIN_PIN з Налаштувань.
//  Це захищає від злому оффлайн-кешу.
//
//  Алгоритм:
//  1. Адмін вводить PIN
//  2. PIN хешується SHA-256
//  3. Хеш передається до GAS в підписаному запиті
//  4. GAS порівнює з ADMIN_PIN у листі Налаштування
//  5. При успіху — сесія в пам'яті
// ─────────────────────────────────────────────────────────────────────────────

import { digestSHA256, computeHMAC } from '../../shared/crypto.js';
import { API_VERSION }                from '../../shared/constants.js';

let _gasUrl    = '';
let _apiSecret = '';
let _session   = null;

export function configureAuth({ gasUrl, apiSecret }) {
  _gasUrl    = gasUrl;
  _apiSecret = apiSecret;
}

// ─── ОНЛАЙН-АВТОРИЗАЦІЯ ──────────────────────────────────────────────────────

export async function login(pin) {
  if (!pin) return { success: false, error: 'PIN не може бути порожнім' };
  if (!navigator.onLine) return { success: false, error: 'Для входу в адмін-панель потрібне підключення до мережі' };

  const gasUrl    = localStorage.getItem('admin_gasUrl')    ?? _gasUrl;
  const apiSecret = localStorage.getItem('admin_apiSecret') ?? _apiSecret;

  const pinHash = await digestSHA256(String(pin));

  const body      = JSON.stringify({ type: 'verify_admin', pin_hash: pinHash });
  const signature = await computeHMAC(body, apiSecret);
  const url       = `${gasUrl}?api_version=${API_VERSION}&api_signature=${signature}`;

  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
  } catch (_) {
    return { success: false, error: 'Немає зв\'язку з сервером. Перевірте інтернет.' };
  }

  const json = await res.json();
  if (!json.success) {
    return { success: false, error: 'Невірний PIN адміністратора' };
  }

  _session = {
    role:         'Адміністратор',
    logged_in_at: Date.now(),
  };

  return { success: true };
}

export function logout() {
  _session = null;
}

export function isAuthenticated() {
  return _session !== null;
}

export function requireAuth() {
  if (!_session) throw new Error('Сесія адміністратора не активна');
  return _session;
}
