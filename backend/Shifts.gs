// ─────────────────────────────────────────────────────────────────────────────
//  SHIFTS.GS — відкриття/закриття змін, розрахунок зарплати
// ─────────────────────────────────────────────────────────────────────────────

// Відповідність: Назва групи товарів → колонка % у Співробітники.
// Зміна тут вимагає синхронної зміни в Setup.gs (headers Співробітники).
const GROUP_TO_PCT_COL_ = {
  'Тютюнові вироби': '%_Тютюнові_вироби',
  'Пиво та напої':   '%_Пиво_та_напої',
  'Мінвода та соки': '%_Мінвода_та_соки',
  'Алкогольні напої':'%_Алкогольні_напої',
  'Штучні товари':   '%_Штучні_товари',
  'Кава':            '%_Кава'
};

// ─────────────────────────────────────────────────────────────────────────────
//  ВІДКРИТТЯ ЗМІНИ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * payload: { shift_id, shop_id, seller_name, meter_start, opened_at }
 * Перевіряє що для магазину немає вже відкритої зміни.
 */
function openShift(payload) {
  const { shift_id, shop_id, seller_name, meter_start, opened_at } = payload;

  if (!shift_id || !shop_id || !seller_name) {
    return errorResponse('shift_id, shop_id, seller_name обовʼязкові', 'bad_request');
  }

  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheet  = ss.getSheetByName(SHEET_SHIFTS);
  const data   = sheet.getDataRange().getValues();
  const hdr    = data[0];
  const iShop  = hdr.indexOf('Магазин_ID');
  const iStat  = hdr.indexOf('Статус');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iShop]) === String(shop_id) && String(data[i][iStat]) === 'Відкрита') {
      return errorResponse('Магазин ' + shop_id + ' вже має відкриту зміну', 'shift_already_open');
    }
  }

  sheet.appendRow(buildShiftsRow_(hdr, {
    'Зміна_ID':                    shift_id,
    'Магазин_ID':                  shop_id,
    'Дата_Відкриття':              opened_at || nowISO(),
    'Дата_Закриття':               '',
    'Імʼя_Продавця':               seller_name,
    'Разом_Готівка':               0,
    'Разом_Карта':                 0,
    'Разом_Виручка':               0,
    'Готівка_Факт':                0,
    'Розбіжність_Готівки':         0,
    'Показання_Лічильника_Початок':Number(meter_start) || 0,
    'Показання_Лічильника_Кінець': 0,
    'Зарплата_Нарахована':         0,
    'Статус':                      'Відкрита'
  }));

  logOperation({ uuid: generateUUID(), type: 'open_shift', shopId: shop_id, shiftId: shift_id, user: seller_name, status: 'ok' });

  return successResponse({ shift_id });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ЗАКРИТТЯ ЗМІНИ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * payload: { shift_id, shop_id, actual_cash, meter_end }
 *
 * actual_cash — каса ввела «сліпо», без підказки системи.
 * Розбіжність = actual_cash − Разом_Готівка (розрахована системою).
 * Розбіжність зберігається в Зміни, у відповідь PWA НЕ повертається.
 */
function closeShift(payload) {
  const { shift_id, shop_id, actual_cash, meter_end } = payload;

  if (!shift_id || !shop_id)              return errorResponse('shift_id та shop_id обовʼязкові', 'bad_request');
  if (actual_cash === undefined || actual_cash === null)
                                          return errorResponse('actual_cash обовʼязковий', 'bad_request');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SHIFTS);
  const found = findShiftRow_(sheet, shift_id);

  if (!found)                             return errorResponse('Зміну не знайдено: ' + shift_id, 'not_found');

  const { row, rowIndex, hdr } = found;
  if (String(row[hdr.indexOf('Статус')]) === 'Закрита') {
    return errorResponse('Зміна вже закрита', 'already_closed');
  }

  // ── Підрахунок виручки з Продажі ──────────────────────────────────────────
  const totals       = calcShiftTotals_(shift_id);
  const expectedCash = totals.cash;

  // ── Розбіжність готівки (адмін бачить, касир — ніколи) ───────────────────
  const cashDiff = Number(actual_cash) - expectedCash;

  // ── Показання лічильника та енергооблік ───────────────────────────────────
  const meterStart = Number(row[hdr.indexOf('Показання_Лічильника_Початок')]) || 0;
  const meterEndVal = Number(meter_end) || 0;
  const energyUsed  = meterEndVal > 0 ? (meterEndVal - meterStart) : 0;
  const sellerName  = String(row[hdr.indexOf('Імʼя_Продавця')] || '');

  appendEnergyRecord_(shift_id, shop_id, meterEndVal, energyUsed, sellerName);

  // ── Зарплати всіх продавців зміни ─────────────────────────────────────────
  // Один магазин — один продавець, але архітектура підтримує підміну
  const sellers     = getShiftSellers_(shift_id);
  let totalSalary   = 0;
  for (const name of sellers) {
    const result  = calculateSalary_(shift_id, name, shop_id);
    totalSalary  += result.total;
  }

  // ── Оновлення рядка Зміни ─────────────────────────────────────────────────
  // Використовуємо імена колонок, не буквені адреси
  function setCol_(colName, value) {
    const idx = hdr.indexOf(colName);
    if (idx < 0) return;
    sheet.getRange(rowIndex, idx + 1).setValue(value);
  }

  setCol_('Дата_Закриття',                nowISO());
  setCol_('Разом_Готівка',                totals.cash);
  setCol_('Разом_Карта',                  totals.card);
  setCol_('Разом_Виручка',                totals.cash + totals.card);
  setCol_('Готівка_Факт',                 Number(actual_cash));
  setCol_('Розбіжність_Готівки',          cashDiff);          // Лише адмін
  setCol_('Показання_Лічильника_Кінець',  meterEndVal);
  setCol_('Зарплата_Нарахована',          totalSalary);
  setCol_('Статус',                       'Закрита');

  logOperation({ uuid: generateUUID(), type: 'close_shift', shopId: shop_id, shiftId: shift_id, user: sellerName, status: 'ok' });

  // Розбіжність_Готівки НЕ включається у відповідь касиру
  return successResponse({
    shift_id,
    total_cash:    totals.cash,
    total_card:    totals.card,
    total_revenue: totals.cash + totals.card,
    salary:        totalSalary
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  РОЗРАХУНОК ЗАРПЛАТИ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Алгоритм (ТЗ 8.6):
 *  1. Вибрати продажі по shiftId + sellerName, виключити повернення
 *  2. Згрупувати суми по полю «Група»
 *  3. Для кожної групи: сума × відсоток з картки Співробітника
 *  4. Підсумок = денна ставка + сума відсоткових нарахувань
 *  5. Записати рядок у Зарплатна_Відомість
 *
 * Повертає: { rate, percentages: {group: {sales, pct, earned}}, total }
 */
function calculateSalary_(shiftId, sellerName, shopId) {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const salesSh   = ss.getSheetByName(SHEET_SALES);
  const empSh     = ss.getSheetByName(SHEET_EMPLOYEES);
  const payrollSh = ss.getSheetByName(SHEET_PAYROLL);

  // ── Крок 1: продажі продавця за зміною ───────────────────────────────────
  const salesData = salesSh.getDataRange().getValues();
  const sHdr      = salesData[0];
  const sShift    = sHdr.indexOf('Зміна_ID');
  const sSeller   = sHdr.indexOf('Продавець');
  const sGroup    = sHdr.indexOf('Група');
  const sTotal    = sHdr.indexOf('Сума');
  const sReturn   = sHdr.indexOf('Повернення');

  // ── Крок 2: групування продажів по полю «Група» ──────────────────────────
  const groupSales = {};
  for (let i = 1; i < salesData.length; i++) {
    const row = salesData[i];
    if (String(row[sShift])  !== String(shiftId))   continue;
    if (String(row[sSeller]) !== String(sellerName)) continue;
    if (row[sReturn] === true || String(row[sReturn]).toUpperCase() === 'TRUE') continue;

    const group = String(row[sGroup]);
    if (!group) continue;
    groupSales[group] = (groupSales[group] || 0) + (Number(row[sTotal]) || 0);
  }

  // ── Картка співробітника ──────────────────────────────────────────────────
  const empData = empSh.getDataRange().getValues();
  const eHdr    = empData[0];
  const iName   = eHdr.indexOf('Імʼя_Продавця');
  const iRate   = eHdr.indexOf('Денна_Ставка');
  const iRole   = eHdr.indexOf('Роль');

  let dailyRate    = 0;
  let employeeRole = '';
  let empRow       = null;

  for (let i = 1; i < empData.length; i++) {
    if (String(empData[i][iName]) === String(sellerName)) {
      dailyRate    = Number(empData[i][iRate]) || 0;
      employeeRole = String(empData[i][iRole] || '');
      empRow       = empData[i];
      break;
    }
  }

  // ── Крок 3: відсоткові нарахування по групах ─────────────────────────────
  //
  //  Маппінг GROUP_TO_PCT_COL_:
  //    'Тютюнові вироби' → '%_Тютюнові_вироби'  (колонка F у Співробітники)
  //    'Пиво та напої'   → '%_Пиво_та_напої'     (колонка G)
  //    'Мінвода та соки' → '%_Мінвода_та_соки'   (колонка H)
  //    'Алкогольні напої'→ '%_Алкогольні_напої'  (колонка I)
  //    'Штучні товари'   → '%_Штучні_товари'     (колонка J)
  //    'Кава'            → '%_Кава'              (колонка K)
  //
  //  Значення в клітинці — десяткова дробь: 0.01 = 1%
  //
  const percentageDetails = {};
  let totalPercent = 0;

  for (const [group, sales] of Object.entries(groupSales)) {
    const pctColName = GROUP_TO_PCT_COL_[group];
    if (!pctColName || !empRow) continue;

    const pctIdx = eHdr.indexOf(pctColName);
    if (pctIdx < 0) continue;

    const pct    = Number(empRow[pctIdx]) || 0;
    const earned = sales * pct;
    percentageDetails[group] = { sales, pct, earned };
    totalPercent += earned;
  }

  // ── Крок 4: підсумок ──────────────────────────────────────────────────────
  const total = dailyRate + totalPercent;

  // ── Крок 5: запис у Зарплатна_Відомість ──────────────────────────────────
  payrollSh.appendRow(buildPayrollRow_(payrollSh, {
    'UUID_Операції':    generateUUID(),
    'Магазин_ID':       shopId,
    'Дата':             nowISO(),
    'Імʼя_Співробітника':sellerName,
    'Роль':             employeeRole,
    'Нараховано_Ставка': dailyRate,
    'Нараховано_Відсоток':totalPercent,
    'Разом_Нараховано': total,
    'Виплачено':        0,       // Виплата фіксується окремою операцією
    'Залишок_Боргу':    total,
    'Зміна_ID':         shiftId
  }));

  return { rate: dailyRate, percentages: percentageDetails, total };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ДОПОМІЖНІ ФУНКЦІЇ
// ─────────────────────────────────────────────────────────────────────────────

/** Знаходить рядок зміни по Зміна_ID. Повертає {row, rowIndex, hdr} або null. */
function findShiftRow_(sheet, shiftId) {
  const data  = sheet.getDataRange().getValues();
  const hdr   = data[0];
  const iId   = hdr.indexOf('Зміна_ID');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iId]) === String(shiftId)) {
      return { row: data[i], rowIndex: i + 1, hdr };
    }
  }
  return null;
}

/** Повертає унікальних продавців зміни з аркуша Продажі. */
function getShiftSellers_(shiftId) {
  const sheet  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SALES);
  const data   = sheet.getDataRange().getValues();
  const hdr    = data[0];
  const iShift  = hdr.indexOf('Зміна_ID');
  const iSeller = hdr.indexOf('Продавець');

  const sellers = new Set();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iShift]) === String(shiftId) && data[i][iSeller]) {
      sellers.add(String(data[i][iSeller]));
    }
  }
  return [...sellers];
}

/** Підраховує виручку готівкою та картою по Зміна_ID з аркуша Продажі. */
function calcShiftTotals_(shiftId) {
  const sheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SALES);
  const data     = sheet.getDataRange().getValues();
  const hdr      = data[0];
  const iShift   = hdr.indexOf('Зміна_ID');
  const iTotal   = hdr.indexOf('Сума');
  const iPayment = hdr.indexOf('Тип_Оплати');

  let cash = 0, card = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iShift]) !== String(shiftId)) continue;
    // Повернення вже записані з від'ємними сумами → просто додаємо
    const amount  = Number(data[i][iTotal]) || 0;
    const payment = String(data[i][iPayment]);
    if (payment === 'Готівка') cash += amount;
    else if (payment === 'Картка') card += amount;
  }
  return { cash, card };
}

/** Записує рядок в Енергооблік при закритті зміни. */
function appendEnergyRecord_(shiftId, shopId, meterEnd, usage, sellerName) {
  const limit  = Number(getSetting('ENERGY_LIMIT_KWT')) || 50;
  const status = usage > limit ? 'Перевищено' : 'В_нормі';
  const sheet  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ENERGY);

  sheet.appendRow(buildEnergyRow_(sheet, {
    'UUID_Операції':       generateUUID(),
    'Магазин_ID':          shopId,
    'Дата':                nowISO(),
    'Показання_Лічильника':meterEnd,
    'Витрата_За_Добу':     usage,
    'Статус_Ліміту':       status,
    'Імʼя_Продавця':       sellerName || '',
    'Зміна_ID':            shiftId
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
//  buildRow_ helpers — по одному на кожен аркуш (читають headers один раз)
// ─────────────────────────────────────────────────────────────────────────────

function buildShiftsRow_(hdr, obj)  { return hdr.map(h => obj[h] !== undefined ? obj[h] : ''); }
function buildPayrollRow_(sheet, obj) {
  const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return hdr.map(h => obj[h] !== undefined ? obj[h] : '');
}
function buildEnergyRow_(sheet, obj) {
  const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return hdr.map(h => obj[h] !== undefined ? obj[h] : '');
}
