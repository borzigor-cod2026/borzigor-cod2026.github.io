// ─────────────────────────────────────────────────────────────────────────────
//  ТОЧКА ВХОДУ — POST-ЗАПИТИ ВІД PWA
//
//  GAS Web Apps не підтримують кастомні HTTP-заголовки (X-Api-Version тощо).
//  Тому аутентифікаційні параметри передаються у рядку запиту:
//
//    POST https://script.google.com/macros/s/<ID>/exec
//         ?api_version=2
//         &api_signature=<HMAC-SHA256-hex>
//
//  Тіло запиту — JSON з полем "type" для маршрутизації.
// ─────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const body   = (e.postData && e.postData.contents) || '';
    const params = e.parameter || {};

    // 1. Перевірка версії API
    const vCheck = checkApiVersion(params.api_version);
    if (!vCheck.valid) return jsonResponse(vCheck.body);

    // 2. Перевірка HMAC-підпису
    if (!verifySignature(body, params.api_signature || '')) {
      logOperation({ type: 'auth_error', status: 'error', error: 'Невірний підпис' });
      return errorResponse('Невірний підпис запиту', 'unauthorized');
    }

    // 3. Парсинг тіла
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (_) {
      return errorResponse('Невалідний JSON', 'bad_request');
    }

    // 4. Маршрутизація за полем type
    const type = payload.type;
    switch (type) {
      // ── Реалізується в Sync.gs (Етап 2) ──
      case 'sync_batch':
        return syncBatch(payload);

      // ── Реалізується в Shifts.gs (Етап 2) ──
      case 'open_shift':
        return openShift(payload);

      case 'close_shift':
        return closeShift(payload);

      // ── Реалізується в Inventory.gs (Етап 2) ──
      case 'approve_inventory':
        return approveInventory(payload);

      // ── Реалізується в Archive.gs (Етап 3) ──
      case 'archive_month':
        return archiveMonth(payload);

      // ── Довідники для PWA-кешу ──
      case 'get_products':
        return handleGetProducts_(payload);

      case 'get_employees':
        return handleGetEmployees_(payload);

      case 'get_settings':
        return handleGetSettings_(payload);

      // ── Авторизація адміністратора (онлайн) ──
      case 'verify_admin':
        return handleVerifyAdmin_(payload);

      default:
        return errorResponse('Невідомий тип операції: ' + type, 'unknown_type');
    }

  } catch (err) {
    logOperation({ type: 'system_error', status: 'error', error: err.message });
    return errorResponse('Помилка сервера: ' + err.message, 'server_error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET — статус-перевірка (для тестування розгортання)
// ─────────────────────────────────────────────────────────────────────────────
function doGet(e) {
  return jsonResponse({ status: 'ok', api_version: API_CURRENT_VERSION });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ДОВІДНИКИ ДЛЯ PWA — синхронізація кешу товарів і співробітників
// ─────────────────────────────────────────────────────────────────────────────

function handleGetProducts_(payload) {
  const shopId = payload.shop_id;
  if (!shopId) return errorResponse('shop_id обовʼязковий', 'bad_request');

  const sheet      = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTS);
  const [hdr, ...rows] = sheet.getDataRange().getValues();
  const iShop      = hdr.indexOf('Магазин_ID');
  const iActive    = hdr.indexOf('Активний');

  const products = rows
    .filter(r => r[iShop] === shopId && r[iActive] === true)
    .map(r => Object.fromEntries(hdr.map((h, j) => [h, r[j]])));

  return successResponse({ products, synced_at: nowISO() });
}

function handleGetEmployees_(payload) {
  const shopId = payload.shop_id;
  if (!shopId) return errorResponse('shop_id обовʼязковий', 'bad_request');

  const sheet      = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EMPLOYEES);
  const [hdr, ...rows] = sheet.getDataRange().getValues();
  const iShop      = hdr.indexOf('Магазин_ID');
  const iStatus    = hdr.indexOf('Статус');

  const employees = rows
    .filter(r => r[iShop] === shopId && r[iStatus] === 'Активний')
    .map(r => Object.fromEntries(hdr.map((h, j) => [h, r[j]])));

  return successResponse({ employees, synced_at: nowISO() });
}

function handleGetSettings_(payload) {
  const s = getSettingsMap_();
  // Секрети не передаються клієнту
  delete s['API_SECRET'];
  delete s['ADMIN_PIN'];
  return successResponse({ settings: s, synced_at: nowISO() });
}

function handleVerifyAdmin_(payload) {
  const pinHash = payload.pin_hash;
  if (!pinHash) return errorResponse('pin_hash обовʼязковий', 'bad_request');
  const stored = getSetting('ADMIN_PIN');
  if (!stored || String(pinHash).toLowerCase() !== String(stored).toLowerCase()) {
    return errorResponse('Невірний PIN', 'unauthorized');
  }
  return successResponse({ role: 'Адміністратор' });
}
