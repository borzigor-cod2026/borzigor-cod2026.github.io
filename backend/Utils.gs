// ─────────────────────────────────────────────────────────────────────────────
//  Константи винесено в AAA_Constants.gs (завантажується першим).
// ─────────────────────────────────────────────────────────────────────────────
//  UUID / ЧАС
// ─────────────────────────────────────────────────────────────────────────────
function generateUUID() {
  return Utilities.getUuid();
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Форматує дату в часовому поясі Києва.
 * fmt — Java SimpleDateFormat патерн, напр. 'dd.MM.yyyy HH:mm'
 */
function formatKyivDate(date, fmt) {
  return Utilities.formatDate(
    date instanceof Date ? date : new Date(date),
    KYIV_TZ,
    fmt || 'dd.MM.yyyy HH:mm'
  );
}

function currentMonthKey() {
  return Utilities.formatDate(new Date(), KYIV_TZ, 'yyyy_MM');
}

// ─────────────────────────────────────────────────────────────────────────────
//  НАЛАШТУВАННЯ
//  Читає рядки A:B з аркуша Налаштування.
//  Ключами вважаються тільки рядки у форматі UPPER_CASE (A-Z, 0-9, _),
//  тому рядки МРЦ-таблиці (з кирилицею/пробілами) ігноруються.
// ─────────────────────────────────────────────────────────────────────────────
function getSettingsMap_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) throw new Error('Аркуш «Налаштування» не знайдено');

  const values = sheet.getRange('A2:B30').getValues();
  const map    = {};
  for (const [key, val] of values) {
    const k = String(key).trim();
    if (k && /^[A-Z][A-Z0-9_]+$/.test(k)) {
      map[k] = val;
    }
  }
  return map;
}

function getSetting(key) {
  const map = getSettingsMap_();
  const v   = map[key];
  return v === undefined ? null : v;
}

function setSetting(key, newValue) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  const col   = sheet.getRange('A2:A30').getValues();
  for (let i = 0; i < col.length; i++) {
    if (String(col[i][0]).trim() === key) {
      sheet.getRange(i + 2, 2).setValue(newValue);
      return;
    }
  }
  // Якщо ключ не знайдено — дописати в кінець блоку налаштувань
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1).setValue(key);
  sheet.getRange(lastRow + 1, 2).setValue(newValue);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ЖУРНАЛ ОПЕРАЦІЙ
// ─────────────────────────────────────────────────────────────────────────────
function logOperation(params) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_LOG);
  if (!sheet) return;

  sheet.appendRow([
    params.uuid    || generateUUID(),
    nowISO(),
    params.type    || '',
    params.shopId  || '',
    params.shiftId || '',
    params.user    || 'system',
    params.status  || 'ok',
    params.error   || ''
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
//  HTTP ВІДПОВІДІ
// ─────────────────────────────────────────────────────────────────────────────
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function successResponse(data) {
  return jsonResponse(Object.assign({ success: true }, data || {}));
}

function errorResponse(message, code) {
  return jsonResponse({ success: false, error: message, code: code || 'error' });
}
