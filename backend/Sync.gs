// ─────────────────────────────────────────────────────────────────────────────
//  SYNC.GS — пакетна синхронізація операцій від PWA
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
//  syncBatch — головна точка входу
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Приймає пакет операцій від PWA.
 * payload.operations — масив об'єктів операцій.
 * Повертає масив результатів: [{uuid, status: 'synced'|'conflict'|'error'}]
 *
 * Дедублікація: перевірка UUID в Журнал_Операцій перед записом.
 * Конфлікт не є помилкою — PWA не показує його користувачу.
 */
function syncBatch(payload) {
  const shopId     = payload.shop_id;
  const operations = payload.operations;

  if (!shopId)                                      return errorResponse('shop_id обовʼязковий', 'bad_request');
  if (!Array.isArray(operations) || !operations.length) return errorResponse('operations порожній', 'bad_request');

  // LockService запобігає одночасним записам (два магазини синхронізуються паралельно)
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (_) {
    return errorResponse('Сервер зайнятий, спробуйте ще раз', 'lock_timeout');
  }

  try {
    const existingUUIDs = loadExistingUUIDs_();
    const results       = [];

    for (const op of operations) {
      const uuid = op.uuid;

      if (!uuid) {
        results.push({ uuid: null, status: 'error', message: 'Відсутній UUID' });
        continue;
      }

      if (existingUUIDs.has(String(uuid))) {
        // Дубль — штатна ситуація при повторній відправці через обрив зв'язку
        results.push({ uuid, status: 'conflict' });
        continue;
      }

      try {
        processOperation_(op, shopId);
        existingUUIDs.add(String(uuid));
        results.push({ uuid, status: 'synced' });
        logOperation({ uuid, type: op.type, shopId, shiftId: op.shift_id || '', user: op.seller || '', status: 'synced' });
      } catch (err) {
        results.push({ uuid, status: 'error', message: err.message });
        logOperation({ uuid, type: op.type, shopId, shiftId: op.shift_id || '', user: op.seller || '', status: 'error', error: err.message });
      }
    }

    return successResponse({ results, synced_at: nowISO() });

  } finally {
    lock.releaseLock();
  }
}

/** Завантажує множину всіх UUID з колонки A аркуша Журнал_Операцій. */
function loadExistingUUIDs_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOG);
  const last  = sheet.getLastRow();
  if (last < 2) return new Set();
  const values = sheet.getRange(2, 1, last - 1, 1).getValues();
  return new Set(values.map(r => String(r[0])).filter(Boolean));
}

// ─────────────────────────────────────────────────────────────────────────────
//  МАРШРУТИЗАЦІЯ ОПЕРАЦІЙ
// ─────────────────────────────────────────────────────────────────────────────

function processOperation_(op, shopId) {
  switch (op.type) {
    case 'sale':           appendSale_(op, shopId);           break;
    case 'receipt':        appendReceipt_(op, shopId);        break;
    case 'expense':        appendExpense_(op, shopId);        break;
    case 'writeoff':       appendWriteoff_(op, shopId);       break;
    case 'inventory':      appendInventoryItem_(op, shopId);  break;
    case 'new_product':    appendNewProduct_(op, shopId);     break;
    case 'cash_collection':appendCashCollection_(op, shopId); break;
    case 'open_shift':     appendOpenShift_(op, shopId);      break;
    case 'close_shift':    appendCloseShift_(op, shopId);     break;
    default:
      throw new Error('Невідомий тип операції: ' + op.type);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  СЛУЖБОВИЙ: побудова рядка за іменами колонок
//  Читає заголовки аркуша один раз і повертає масив значень у правильному порядку.
//  Це захищає від зміни порядку колонок у Setup.gs.
// ─────────────────────────────────────────────────────────────────────────────

function buildRow_(sheet, obj) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.map(h => (obj[h] !== undefined ? obj[h] : ''));
}

/**
 * Конвертує ISO-рядок або Date у JavaScript Date.
 * Google Sheets зберігає Date-об'єкти як числові дати — тільки так SUMPRODUCT
 * в дашборді може порівнювати дати (>=PeriodStart). Рядки ISO порівнювати не можна.
 */
function toSheetDate_(isoOrDate) {
  if (!isoOrDate) return new Date();
  return isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ПРОДАЖІ
// ─────────────────────────────────────────────────────────────────────────────

function appendSale_(op, shopId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SALES);

  sheet.appendRow(buildRow_(sheet, {
    'UUID_Операції':        op.uuid,
    'Магазин_ID':           shopId,
    'Зміна_ID':             op.shift_id      || '',
    'Дата_Час':             toSheetDate_(op.timestamp),
    'ID_Товару':            op.product_id    || '',
    'Штрихкод':             op.barcode       || '',
    'Назва':                op.name          || '',
    'Група':                op.group         || '',
    'Кількість':            Number(op.quantity)       || 0,
    'Ціна_Продажі':         Number(op.price)          || 0,
    'Ціна_Закупки':         Number(op.purchase_price) || 0,
    'Сума':                 Number(op.total)          || 0,
    'Тип_Оплати':           op.payment_type  || 'Готівка',
    'Продавець':            op.seller        || '',
    'Повернення':           op.is_return     ? true : false,
    'Статус_Синхронізації': 'synced'
  }));

  if (op.product_id && op.quantity) {
    const delta = op.is_return ? +Number(op.quantity) : -Number(op.quantity);
    updateStock_('sale', op.product_id, delta, shopId);
    if (!op.is_return) checkStockAlert_(op.product_id, op.name, op.seller, shopId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ПРИХІД ТОВАРУ
// ─────────────────────────────────────────────────────────────────────────────

function appendReceipt_(op, shopId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECEIPTS);

  sheet.appendRow(buildRow_(sheet, {
    'UUID_Операції':          op.uuid,
    'Магазин_ID':             shopId,
    'Зміна_ID':               op.shift_id            || '',
    'Дата':                   toSheetDate_(op.timestamp),
    'ID_Товару':              op.product_id          || '',
    'Штрихкод':               op.barcode             || '',
    'Назва':                  op.name                || '',
    'Кількість':              Number(op.quantity)    || 0,
    'Ціна_Закупки':           Number(op.purchase_price) || 0,
    'Ціна_Продажі':           Number(op.sell_price)  || 0,
    'Постачальник':           op.supplier            || '',
    'Продавець':              op.seller              || '',
    'Повернення_Постачальнику':op.return_to_supplier ? true : false,
    'Статус_Синхронізації':   'synced'
  }));

  if (op.product_id && op.quantity) {
    const delta = op.return_to_supplier ? -Number(op.quantity) : +Number(op.quantity);
    updateStock_('receipt', op.product_id, delta, shopId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ВИТРАТИ
// ─────────────────────────────────────────────────────────────────────────────

function appendExpense_(op, shopId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXPENSES);

  sheet.appendRow(buildRow_(sheet, {
    'UUID_Операції':        op.uuid,
    'Магазин_ID':           shopId,
    'Зміна_ID':             op.shift_id    || '',
    'Дата':                 toSheetDate_(op.timestamp),
    'Категорія_Витрати':    op.category    || '',
    'Призначення':          op.description || '',
    'Сума':                 Number(op.amount) || 0,
    'Статус_Підтвердження': 'Очікує',
    'Продавець':            op.seller      || '',
    'Статус_Синхронізації': 'synced'
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  СПИСАННЯ
// ─────────────────────────────────────────────────────────────────────────────

function appendWriteoff_(op, shopId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_WRITEOFFS);

  sheet.appendRow(buildRow_(sheet, {
    'UUID_Операції': op.uuid,
    'Магазин_ID':    shopId,
    'Дата':          toSheetDate_(op.timestamp),
    'ID_Товару':     op.product_id  || '',
    'Товар':         op.name        || '',
    'Кількість':     Number(op.quantity) || 0,
    'Причина':       op.reason      || '',
    'Імʼя_Продавця': op.seller      || '',
    'Зміна_ID':      op.shift_id    || ''
  }));

  if (op.product_id && op.quantity) {
    updateStock_('writeoff', op.product_id, -Number(op.quantity), shopId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ІНВЕНТАРИЗАЦІЯ (окремий рядок на кожну позицію)
//  Залишок не змінюється тут — тільки після approveInventory()
// ─────────────────────────────────────────────────────────────────────────────

function appendInventoryItem_(op, shopId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_INVENTORY);

  sheet.appendRow(buildRow_(sheet, {
    'UUID_Операції': op.uuid,
    'Магазин_ID':    shopId,
    'Зміна_ID':      op.shift_id || '',
    'Дата':          toSheetDate_(op.timestamp),
    'ID_Товару':     op.product_id || '',
    'Штрихкод':      op.barcode    || '',
    'Назва':         op.name       || '',
    'Пораховано_Факт':Number(op.counted) || 0,
    'Продавець':     op.seller     || '',
    'Статус':        op.status     || 'Завершена'
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  НОВИЙ ТОВАР (сценарій B — касир додає невідомий штрихкод)
// ─────────────────────────────────────────────────────────────────────────────

function appendNewProduct_(op, shopId) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_PRODUCTS);

  const productId = op.product_id || (op.barcode + '_' + (op.price || 0) + '_' + shopId);

  // Перевірити чи товар вже існує (щоб не дублювати)
  const data  = sheet.getDataRange().getValues();
  const hdr   = data[0];
  const iId   = hdr.indexOf('ID_Товару');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iId]) === String(productId)) return; // Вже є
  }

  sheet.appendRow(buildRow_(sheet, {
    'Магазин_ID':       shopId,
    'ID_Товару':        productId,
    'Штрихкод':         op.barcode          || '',
    'Назва':            op.name             || '',
    'Група':            op.group            || '',
    'Підгрупа':         op.subgroup         || '',
    'Ціна_Закупки':     Number(op.purchase_price) || 0,
    'Ціна_Продажі':     Number(op.price)    || 0,
    'Залишок':          0,   // Стане −1 після першого продажу
    'Обʼєм_Літрів':     '',
    'Фортеця_Градусів': '',
    'МРЦ_Закон':        '',
    'Активний':         true,
    'Дата_Оновлення':   nowISO()
  }));

  // Адмін бачить в дашборді що потрібно доповнити картку товару
  logOperation({
    uuid:    op.uuid,
    type:    'new_product_on_sale',
    shopId,
    shiftId: op.shift_id || '',
    user:    op.seller   || '',
    status:  'ok',
    error:   `Касир додав: ${op.name} (${op.barcode})`
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ІНКАСАЦІЯ
// ─────────────────────────────────────────────────────────────────────────────

function appendCashCollection_(op, shopId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ADMIN_CASH);

  sheet.appendRow(buildRow_(sheet, {
    'UUID_Операції': op.uuid,
    'Магазин_ID':    shopId,
    'Дата':          toSheetDate_(op.timestamp),
    'Тип_Операції':  'Інкасація',
    'Сума':          Number(op.amount) || 0,
    'Призначення':   op.description || 'Інкасація',
    'Від_Кого':      op.seller      || '',
    'Підтвердив':    '',
    'Статус':        'Очікує'
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  ВІДКРИТТЯ / ЗАКРИТТЯ ЗМІНИ (через sync_batch)
//  Делегують до openShift / closeShift у Shifts.gs.
//  Ідемпотентні: повторна відправка після обриву мережі не є помилкою.
// ─────────────────────────────────────────────────────────────────────────────

function appendOpenShift_(op, shopId) {
  const resp = openShift({
    shift_id:    op.shift_id,
    shop_id:     shopId,
    seller_name: op.seller,
    meter_start: Number(op.meter) || 0,
    opened_at:   op.timestamp,
  });
  const data = JSON.parse(resp.getContent());
  // shift_already_open — ідемпотентно, не помилка при повторній відправці
  if (!data.success && data.code !== 'shift_already_open') {
    throw new Error(data.error || 'open_shift failed');
  }
}

function appendCloseShift_(op, shopId) {
  const resp = closeShift({
    shift_id:    op.shift_id,
    shop_id:     shopId,
    actual_cash: Number(op.cash_blind) || 0,
    meter_end:   Number(op.meter_end)  || 0,
  });
  const data = JSON.parse(resp.getContent());
  // already_closed — ідемпотентно, не помилка при повторній відправці
  if (!data.success && data.code !== 'already_closed') {
    throw new Error(data.error || 'close_shift failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  updateStock_ — зміна залишку товару
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Оновлює поле Залишок у аркуші Товари.
 * Для типу 'inventory' — перезаписує (delta = нове значення).
 * Для решти — дельта (+/-).
 * Колонки шукаються за іменем, не за позицією.
 *
 * Викликається з syncBatch() і approveInventory().
 */
function updateStock_(operationType, productId, delta, shopId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTS);
  const data  = sheet.getDataRange().getValues();
  const hdr   = data[0];

  const iId    = hdr.indexOf('ID_Товару');
  const iStock = hdr.indexOf('Залишок');
  const iDate  = hdr.indexOf('Дата_Оновлення');

  if (iId < 0 || iStock < 0) throw new Error('Колонку ID_Товару або Залишок не знайдено в Товари');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iId]) === String(productId)) {
      const stockRange = sheet.getRange(i + 1, iStock + 1);

      if (operationType === 'inventory') {
        stockRange.setValue(delta);  // Для інвентаризації delta — це нове значення
      } else {
        stockRange.setValue((Number(data[i][iStock]) || 0) + delta);
      }

      if (iDate >= 0) sheet.getRange(i + 1, iDate + 1).setValue(nowISO());
      return;
    }
  }

  // Товар не знайдено — не кидаємо виключення, щоб не зупинити весь пакет
  logOperation({
    type:   'stock_update_warning',
    shopId: shopId || '',
    status: 'error',
    error:  `Товар ${productId} не знайдено в Товари`
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Перевірка від'ємного залишку після продажу → запис алерту в журнал
// ─────────────────────────────────────────────────────────────────────────────

function checkStockAlert_(productId, productName, seller, shopId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTS);
  const data  = sheet.getDataRange().getValues();
  const hdr   = data[0];
  const iId   = hdr.indexOf('ID_Товару');
  const iSt   = hdr.indexOf('Залишок');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iId]) === String(productId)) {
      const stock = Number(data[i][iSt]) || 0;
      if (stock < 0) {
        logOperation({
          uuid:   generateUUID(),
          type:   'stock_below_zero',
          shopId: shopId || '',
          user:   seller || '',
          status: 'ok',
          error:  `${productName} залишок: ${stock}`
        });
      }
      return;
    }
  }
}
