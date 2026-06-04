// ─────────────────────────────────────────────────────────────────────────────
//  shared/crypto.js — криптографічні примітиви (Web Crypto API)
//
//  Використовується:
//    cashier/js/auth.js  — digestSHA256 для хешування PIN
//    cashier/js/sync.js  — computeHMAC для підпису запитів до GAS
//    admin/js/auth.js    — digestSHA256
//    admin/js/sync.js    — computeHMAC
// ─────────────────────────────────────────────────────────────────────────────

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 хеш рядка.
 * Повертає lowercase hex-рядок.
 * Відповідає серверному hashPin() у Auth.gs.
 */
export async function digestSHA256(text) {
  const encoded = new TextEncoder().encode(String(text));
  const buffer  = await crypto.subtle.digest('SHA-256', encoded);
  return bufferToHex(buffer);
}

/**
 * HMAC-SHA256 підпис тіла запиту.
 * Повертає lowercase hex-рядок.
 * Відповідає серверному computeHmac() у Auth.gs.
 *
 * Передається в URL: ?api_signature=<hex>
 * (GAS Web Apps не підтримують кастомні HTTP-заголовки)
 */
export async function computeHMAC(body, secret) {
  const enc         = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(String(body)));
  return bufferToHex(signature);
}
