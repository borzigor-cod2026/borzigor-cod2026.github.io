// ─────────────────────────────────────────────────────────────────────────────
//  HMAC-SHA256 ПЕРЕВІРКА ПІДПИСУ
// ─────────────────────────────────────────────────────────────────────────────

function bytesToHex_(bytes) {
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/**
 * Обчислює HMAC-SHA256 від рядка body з ключем secret.
 * Повертає hex-рядок нижнього регістру.
 */
function computeHmac(body, secret) {
  const raw = Utilities.computeHmacSha256Signature(
    String(body),
    String(secret),
    Utilities.Charset.UTF_8
  );
  return bytesToHex_(raw);
}

/**
 * Перевіряє підпис запиту від PWA.
 *
 * GAS Web Apps не підтримують кастомні HTTP-заголовки, тому PWA передає:
 *   POST ?api_version=2&api_signature=<HMAC-SHA256-hex>
 *
 * signature — hex-рядок з URL-параметра api_signature
 * body      — сирий рядок тіла запиту (e.postData.contents)
 *
 * ПЛАТФОРМНЕ ОБМЕЖЕННЯ: GAS Web Apps завжди повертають HTTP 200.
 * Невірний підпис не може дати HTTP 403 — замість цього повертається
 * JSON {success:false, code:'unauthorized'}.
 * Клієнт перевіряє: json.success === false && json.code === 'unauthorized'.
 */
function verifySignature(body, signature) {
  const secret = getSetting('API_SECRET');
  if (!secret) {
    logOperation({ type: 'auth_error', status: 'error', error: 'API_SECRET не налаштовано' });
    return false;
  }

  const expected = computeHmac(String(body), String(secret));
  const sig      = String(signature);

  // Константний час порівняння — захист від timing-атак
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PIN-КОД
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Повертає SHA-256 хеш рядка у hex нижнього регістру.
 * Використовується для хешування PIN і зберігання в аркуші Співробітники.
 */
function hashPin(pin) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(pin),
    Utilities.Charset.UTF_8
  );
  return bytesToHex_(raw);
}

/**
 * Перевіряє PIN адміністратора відносно хешу з листа Налаштування.
 */
function verifyAdminPin(pin) {
  const stored = getSetting('ADMIN_PIN');
  if (!stored) return false;
  return hashPin(String(pin)) === String(stored).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
//  ВЕРСІЯ API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Перевіряє версію API з запиту.
 * Повертає { valid: true } або { valid: false, body: <об'єкт помилки для jsonResponse> }
 */
function checkApiVersion(requestedVersion) {
  const current = String(getSetting('API_VERSION') || API_CURRENT_VERSION);
  if (String(requestedVersion) !== current) {
    return {
      valid: false,
      body:  { success: false, error: 'version_mismatch', expected: current, code: 'version_mismatch' }
    };
  }
  return { valid: true };
}
