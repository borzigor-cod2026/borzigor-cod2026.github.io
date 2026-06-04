// ─────────────────────────────────────────────────────────────────────────────
//  Setup.gs — початкове налаштування таблиці
//
//  Виконувати кроками (кожен < 6 хв) або все разом через setupAll():
//
//    1. setupSheets()   — 13 аркушів з заголовками          (~1–2 хв)
//    2. setupSettings() — дані «Налаштування» + МРЦ-таблиця (~30 с)
//    3. setupFormats()  — формати, ширини, валідація         (~2–3 хв)
//    4. setupDashboard()   — Dashboard.gs, окремо
//    5. setupAllTriggers() — Backup.gs, окремо
//
//  Порядок 1→2→3 обов'язковий: setupFormats() читає PRODUCT_GROUPS
//  з «Налаштування», яку заповнює setupSettings().
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
//  ПУБЛІЧНІ ТОЧКИ ВХОДУ
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Запускає всі три фази послідовно.
 * Якщо таблиця нова й порожня — вкладається в 6 хв.
 * При перевищенні ліміту — запускайте кожну фазу окремо.
 */
function setupAll() {
  setupSheets();
  setupSettings();
  setupFormats();
  SpreadsheetApp.getUi().alert(
    '✅ Налаштування завершено!\n\n' +
    'Наступні кроки:\n' +
    '1. Заповніть ARCHIVE_FOLDER_ID і BACKUP_FOLDER_ID в «Налаштування»\n' +
    '2. Встановіть API_SECRET (будь-який рядок 32+ символів)\n' +
    '3. Виконайте: setAdminPin(\'ваш_pin\')\n' +
    '4. Виконайте: setupDashboard()\n' +
    '5. Виконайте: setupAllTriggers()'
  );
}

/** Зворотна сумісність — викликає setupAll(). */
function setupSpreadsheet() {
  setupAll();
}

// ─────────────────────────────────────────────────────────────────────────────
//  ФАЗА 1 — Структура аркушів
//  Тільки заголовки + freeze. Жодних форматів, валідацій, ширин.
//  Орієнтовно: 1–2 хвилини.
// ─────────────────────────────────────────────────────────────────────────────

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(KYIV_TZ);

  _makeSheet_(ss, SHEET_SETTINGS, [
    'Параметр', 'Значення', 'Опис',
  ]);

  _makeSheet_(ss, SHEET_PRODUCTS, [
    'Магазин_ID', 'ID_Товару', 'Штрихкод', 'Назва', 'Група', 'Підгрупа',
    'Ціна_Закупки', 'Ціна_Продажі', 'Залишок', 'Обʼєм_Літрів',
    'Фортеця_Градусів', 'МРЦ_Закон', 'Активний', 'Дата_Оновлення',
  ]);

  _makeSheet_(ss, SHEET_SALES, [
    'UUID_Операції', 'Магазин_ID', 'Зміна_ID', 'Дата_Час', 'ID_Товару',
    'Штрихкод', 'Назва', 'Група', 'Кількість', 'Ціна_Продажі',
    'Ціна_Закупки', 'Сума', 'Тип_Оплати', 'Продавець', 'Повернення',
    'Статус_Синхронізації',
  ]);

  _makeSheet_(ss, SHEET_RECEIPTS, [
    'UUID_Операції', 'Магазин_ID', 'Зміна_ID', 'Дата', 'ID_Товару',
    'Штрихкод', 'Назва', 'Кількість', 'Ціна_Закупки', 'Ціна_Продажі',
    'Постачальник', 'Продавець', 'Повернення_Постачальнику',
    'Статус_Синхронізації',
  ]);

  _makeSheet_(ss, SHEET_EXPENSES, [
    'UUID_Операції', 'Магазин_ID', 'Зміна_ID', 'Дата',
    'Категорія_Витрати', 'Призначення', 'Сума',
    'Статус_Підтвердження', 'Продавець', 'Статус_Синхронізації',
  ]);

  _makeSheet_(ss, SHEET_ADMIN_CASH, [
    'UUID_Операції', 'Магазин_ID', 'Дата', 'Тип_Операції',
    'Сума', 'Призначення', 'Від_Кого', 'Підтвердив', 'Статус',
  ]);

  _makeSheet_(ss, SHEET_INVENTORY, [
    'UUID_Операції', 'Магазин_ID', 'Зміна_ID', 'Дата',
    'ID_Товару', 'Штрихкод', 'Назва', 'Пораховано_Факт',
    'Продавець', 'Статус',
  ]);

  _makeSheet_(ss, SHEET_EMPLOYEES, [
    'ПІН_Код', 'Імʼя_Продавця', 'Роль', 'Магазин_ID', 'Денна_Ставка',
    '%_Тютюнові_вироби', '%_Пиво_та_напої', '%_Мінвода_та_соки',
    '%_Алкогольні_напої', '%_Штучні_товари', '%_Кава', 'Статус',
  ]);

  _makeSheet_(ss, SHEET_PAYROLL, [
    'UUID_Операції', 'Магазин_ID', 'Дата', 'Імʼя_Співробітника', 'Роль',
    'Нараховано_Ставка', 'Нараховано_Відсоток', 'Разом_Нараховано',
    'Виплачено', 'Залишок_Боргу', 'Зміна_ID',
  ]);

  _makeSheet_(ss, SHEET_ENERGY, [
    'UUID_Операції', 'Магазин_ID', 'Дата',
    'Показання_Лічильника', 'Витрата_За_Добу',
    'Статус_Ліміту', 'Імʼя_Продавця', 'Зміна_ID',
  ]);

  _makeSheet_(ss, SHEET_WRITEOFFS, [
    'UUID_Операції', 'Магазин_ID', 'Дата', 'ID_Товару',
    'Товар', 'Кількість', 'Причина', 'Імʼя_Продавця', 'Зміна_ID',
  ]);

  _makeSheet_(ss, SHEET_LOG, [
    'UUID_Операції', 'Дата_Час', 'Тип_Операції',
    'Магазин_ID', 'Зміна_ID', 'Користувач', 'Статус', 'Помилка',
  ]);

  _makeSheet_(ss, SHEET_SHIFTS, [
    'Зміна_ID', 'Магазин_ID', 'Дата_Відкриття', 'Дата_Закриття',
    'Імʼя_Продавця', 'Разом_Готівка', 'Разом_Карта', 'Разом_Виручка',
    'Готівка_Факт', 'Розбіжність_Готівки',
    'Показання_Лічильника_Початок', 'Показання_Лічильника_Кінець',
    'Зарплата_Нарахована', 'Статус',
  ]);

  // Дашборд — заглушка; повний дашборд встановлює setupDashboard()
  const dash = getOrCreateSheet_(ss, SHEET_DASHBOARD);
  dash.clearContents().clearFormats();
  dash.getRange('A1')
      .setValue('Дашборд — запустіть setupDashboard() після setupFormats()')
      .setFontStyle('italic').setFontColor('#9E9E9E').setFontSize(12);

  removeDefaultSheets_(ss);
  SpreadsheetApp.flush();
  logOperation({ type: 'setup_sheets', status: 'ok', user: 'system' });
  Logger.log('setupSheets() завершено — 13 аркушів створено');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ФАЗА 2 — Дані «Налаштування»
//  Початкові значення параметрів + МРЦ-таблиця.
//  Запускати ПІСЛЯ setupSheets().
//  Орієнтовно: < 30 секунд.
// ─────────────────────────────────────────────────────────────────────────────

function setupSettings() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) throw new Error('Спочатку запустіть setupSheets().');

  _fillSettingsData_(sheet);

  SpreadsheetApp.flush();
  logOperation({ type: 'setup_settings', status: 'ok', user: 'system' });
  Logger.log('setupSettings() завершено');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ФАЗА 3 — Формати, ширини, валідація
//  Запускати ПІСЛЯ setupSheets() + setupSettings().
//  setupFormats() читає PRODUCT_GROUPS з «Налаштування» для валідації
//  в аркуші Товари — тому setupSettings() має виконатись першою.
//  Орієнтовно: 2–3 хвилини.
// ─────────────────────────────────────────────────────────────────────────────

function setupFormats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  _fmtSettings_(ss);
  _fmtProducts_(ss);
  _fmtSales_(ss);
  _fmtReceipts_(ss);
  _fmtExpenses_(ss);
  _fmtAdminCash_(ss);
  _fmtInventory_(ss);
  _fmtEmployees_(ss);
  _fmtPayroll_(ss);
  _fmtEnergy_(ss);
  _fmtWriteoffs_(ss);
  _fmtLog_(ss);
  _fmtShifts_(ss);

  SpreadsheetApp.flush();
  logOperation({ type: 'setup_formats', status: 'ok', user: 'system' });
  Logger.log('setupFormats() завершено');
}

// ═════════════════════════════════════════════════════════════════════════════
//  ПРИВАТНЕ — ФАЗА 1: хелпер структури
// ═════════════════════════════════════════════════════════════════════════════

/** Створює або повністю скидає аркуш і записує рядок заголовків. */
function _makeSheet_(ss, name, headers) {
  const sheet = getOrCreateSheet_(ss, name);
  sheet.clearContents().clearFormats();
  applyHeaders_(sheet, headers);
  return sheet;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ПРИВАТНЕ — ФАЗА 2: дані «Налаштування»
// ═════════════════════════════════════════════════════════════════════════════

function _fillSettingsData_(sheet) {
  const productGroups    = [
    'Тютюнові вироби', 'Пиво та напої', 'Мінвода та соки',
    'Алкогольні напої', 'Штучні товари', 'Кава',
  ];
  const productSubgroups = {
    'Тютюнові вироби': ['GTI', 'Philip Morris', 'Imperial Brands', 'Інші'],
    'Пиво та напої':   ['Оболонь', 'Славутич', 'Чернігів', 'Балтика', 'Інші'],
    'Мінвода та соки': ['Росинка', 'Моршинська', 'Бон Буасон', 'Sandora', 'Інші'],
    'Алкогольні напої':['Горілка', 'Вина', 'Шампанське', 'Коньяки', 'Інші'],
    'Штучні товари':   ['Солодке', 'Морозиво', 'Сніки-снеки', 'Інше'],
    'Кава':            ['Капучіно', 'Американо', 'Латте', 'Еспресо', 'Інші'],
  };

  const settings = [
    ['ARCHIVE_FOLDER_ID',      '',                                'ID папки Google Drive для архівів'],
    ['BACKUP_FOLDER_ID',       '',                                'ID папки для резервних копій'],
    ['CURRENT_MONTH',          currentMonthKey(),                 'Поточний робочий місяць (YYYY_MM)'],
    ['DEFAULT_MARKUP_ALCOHOL', 0.15,                              'Націнка алкоголю за замовчуванням (0.15 = 15%)'],
    ['ENERGY_LIMIT_KWT',       50,                                'Денний ліміт енергоспоживання (кВт)'],
    ['ADMIN_PIN',              '',                                'PIN адміністратора (SHA-256 хеш) — setAdminPin()'],
    ['API_SECRET',             '',                                'Секрет HMAC — встановити вручну'],
    ['API_VERSION',            '2',                               'Поточна версія API'],
    ['CURRENCY_SYMBOL',        '₴',                              'Символ валюти'],
    ['PRODUCT_GROUPS',         JSON.stringify(productGroups),     'Групи товарів (JSON-масив)'],
    ['PRODUCT_SUBGROUPS',      JSON.stringify(productSubgroups),  'Підгрупи товарів (JSON-обʼєкт)'],
  ];

  // Очистити рядки даних (рядок 1 — заголовок, залишаємо)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 3).clearContent();

  sheet.getRange(2, 1, settings.length, 3).setValues(settings);

  // ── МРЦ-секція ────────────────────────────────────────────────────────────
  const mrcRow = settings.length + 3;  // рядок 14 при 11 налаштуваннях

  sheet.getRange(mrcRow, 1, 1, 3).merge()
    .setValue('МРЦ НА АЛКОГОЛЬ')
    .setFontWeight('bold').setBackground('#B71C1C').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.setRowHeight(mrcRow, 30);

  // MRC_UPDATED — латиниця → читається через getSetting(); дашборд порівнює з today
  sheet.getRange(mrcRow + 1, 1).setValue('MRC_UPDATED');
  sheet.getRange(mrcRow + 1, 2).setValue(new Date()).setNumberFormat(DATE_FORMAT);
  sheet.getRange(mrcRow + 1, 3).setValue('Дата оновлення МРЦ. Алерт якщо > 30 днів');

  sheet.getRange(mrcRow + 2, 1, 1, 2)
    .setValues([['Вид алкоголю', 'Ціна за літр (₴/л)']])
    .setFontWeight('bold').setBackground('#FFCDD2');

  // Ціни за літр (постанови Кабміну). Формула: МРЦ_пляшки ÷ обʼєм_л.
  // Приклади: Горілка 89,40 ÷ 0,5 = 178,80; Вино 67,50 ÷ 0,75 = 90,00.
  const mrcData = [['Горілка', 178.80], ['Вино', 90.00], ['Шампанське', 218.00], ['Коньяк', 384.96]];
  sheet.getRange(mrcRow + 3, 1, mrcData.length, 2).setValues(mrcData);
  sheet.getRange(mrcRow + 3, 2, mrcData.length, 1).setNumberFormat('# ##0.00');

  sheet.getRange(mrcRow + 3 + mrcData.length + 1, 1)
    .setValue('⚠ Оновлювати при виході нового постанови Кабміну')
    .setFontStyle('italic').setFontColor('#757575');
}

// ═════════════════════════════════════════════════════════════════════════════
//  ПРИВАТНЕ — ФАЗА 3: форматування кожного аркуша
// ═════════════════════════════════════════════════════════════════════════════

function _fmtSettings_(ss) {
  const s = ss.getSheetByName(SHEET_SETTINGS);
  if (!s) return;
  setColumnWidths_(s, [220, 300, 380]);
  s.setRowHeight(1, 36);
}

function _fmtProducts_(ss) {
  const s = ss.getSheetByName(SHEET_PRODUCTS);
  if (!s) return;
  s.getRange('G:I').setNumberFormat(CURRENCY_FORMAT);
  s.getRange('I:I').setNumberFormat('# ##0,###');       // Залишок — кількість
  s.getRange('L:L').setNumberFormat(CURRENCY_FORMAT);
  s.getRange('N:N').setNumberFormat(DATETIME_FORMAT);
  s.getRange('A2:A1000').setDataValidation(makeListRule_(['SHOP_1', 'SHOP_2']));
  try {
    const groups = JSON.parse(String(getSetting('PRODUCT_GROUPS') || '[]'));
    if (groups.length) s.getRange('E2:E1000').setDataValidation(makeListRule_(groups));
  } catch (_) { /* Налаштування ще не заповнені — пропустити */ }
  s.getRange('M2:M1000').setDataValidation(makeListRule_(['TRUE', 'FALSE']));
  setColumnWidths_(s, [80, 220, 120, 260, 160, 160, 110, 110, 90, 110, 110, 110, 80, 150]);
}

function _fmtSales_(ss) {
  const s = ss.getSheetByName(SHEET_SALES);
  if (!s) return;
  s.getRange('D:D').setNumberFormat(DATETIME_FORMAT);
  s.getRange('J:L').setNumberFormat(CURRENCY_FORMAT);
  s.getRange('M2:M5000').setDataValidation(makeListRule_(['Готівка', 'Картка']));
  s.getRange('P2:P5000').setDataValidation(makeListRule_(['pending', 'synced', 'error', 'conflict']));
  setColumnWidths_(s, [280, 80, 280, 150, 220, 120, 260, 140, 80, 110, 110, 110, 90, 150, 90, 100]);
}

function _fmtReceipts_(ss) {
  const s = ss.getSheetByName(SHEET_RECEIPTS);
  if (!s) return;
  s.getRange('D:D').setNumberFormat(DATETIME_FORMAT);
  s.getRange('I:J').setNumberFormat(CURRENCY_FORMAT);
  s.getRange('N2:N5000').setDataValidation(makeListRule_(['pending', 'synced', 'error', 'conflict']));
  setColumnWidths_(s, [280, 80, 280, 150, 220, 120, 260, 80, 110, 110, 180, 150, 90, 100]);
}

function _fmtExpenses_(ss) {
  const s = ss.getSheetByName(SHEET_EXPENSES);
  if (!s) return;
  s.getRange('D:D').setNumberFormat(DATETIME_FORMAT);
  s.getRange('G:G').setNumberFormat(CURRENCY_FORMAT);
  s.getRange('H2:H2000').setDataValidation(makeListRule_(['Очікує', 'Підтверджено', 'Відхилено']));
  s.getRange('J2:J2000').setDataValidation(makeListRule_(['pending', 'synced', 'error', 'conflict']));
  setColumnWidths_(s, [280, 80, 280, 150, 180, 220, 110, 130, 150, 100]);
}

function _fmtAdminCash_(ss) {
  const s = ss.getSheetByName(SHEET_ADMIN_CASH);
  if (!s) return;
  s.getRange('C:C').setNumberFormat(DATETIME_FORMAT);
  s.getRange('E:E').setNumberFormat(CURRENCY_FORMAT);
  setColumnWidths_(s, [280, 80, 150, 160, 110, 220, 150, 150, 120]);
}

function _fmtInventory_(ss) {
  const s = ss.getSheetByName(SHEET_INVENTORY);
  if (!s) return;
  s.getRange('D:D').setNumberFormat(DATETIME_FORMAT);
  s.getRange('J2:J2000').setDataValidation(makeListRule_(['Чернетка', 'Завершена', 'Затверджена']));
  setColumnWidths_(s, [280, 80, 280, 150, 220, 120, 260, 100, 150, 120]);
}

function _fmtEmployees_(ss) {
  const s = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!s) return;
  s.getRange('E:E').setNumberFormat(CURRENCY_FORMAT);
  s.getRange('F:K').setNumberFormat('0.000');            // Відсотки як десяткові дроби
  s.getRange('C2:C100').setDataValidation(makeListRule_(['Касир', 'Адміністратор']));
  s.getRange('D2:D100').setDataValidation(makeListRule_(['SHOP_1', 'SHOP_2']));
  s.getRange('L2:L100').setDataValidation(makeListRule_(['Активний', 'Заблокований']));
  s.getRange('A:A').setFontColor('#9E9E9E');             // PIN хеш — приглушити візуально
  setColumnWidths_(s, [280, 180, 120, 80, 110, 130, 130, 130, 130, 130, 130, 110]);
}

function _fmtPayroll_(ss) {
  const s = ss.getSheetByName(SHEET_PAYROLL);
  if (!s) return;
  s.getRange('C:C').setNumberFormat(DATETIME_FORMAT);
  s.getRange('F:J').setNumberFormat(CURRENCY_FORMAT);
  setColumnWidths_(s, [280, 80, 150, 180, 120, 130, 130, 130, 110, 110, 280]);
}

function _fmtEnergy_(ss) {
  const s = ss.getSheetByName(SHEET_ENERGY);
  if (!s) return;
  s.getRange('C:C').setNumberFormat(DATETIME_FORMAT);
  s.getRange('D:E').setNumberFormat('#,##0.00');
  s.getRange('F2:F2000').setDataValidation(makeListRule_(['В_нормі', 'Перевищено']));
  setColumnWidths_(s, [280, 80, 150, 160, 130, 110, 180, 280]);
}

function _fmtWriteoffs_(ss) {
  const s = ss.getSheetByName(SHEET_WRITEOFFS);
  if (!s) return;
  s.getRange('C:C').setNumberFormat(DATETIME_FORMAT);
  s.getRange('G2:G2000').setDataValidation(
    makeListRule_(['Промивка', 'Технічний злив', 'Брак', 'Пролиття', 'Прострочка'])
  );
  setColumnWidths_(s, [280, 80, 150, 220, 260, 80, 150, 180, 280]);
}

function _fmtLog_(ss) {
  const s = ss.getSheetByName(SHEET_LOG);
  if (!s) return;
  s.getRange('B:B').setNumberFormat(DATETIME_FORMAT);
  setColumnWidths_(s, [280, 150, 180, 80, 280, 150, 90, 350]);
}

function _fmtShifts_(ss) {
  const s = ss.getSheetByName(SHEET_SHIFTS);
  if (!s) return;
  s.getRange('C:D').setNumberFormat(DATETIME_FORMAT);
  s.getRange('F:J').setNumberFormat(CURRENCY_FORMAT);   // Готівка + Карта + Виручка + Факт + Розбіжність
  s.getRange('M:M').setNumberFormat(CURRENCY_FORMAT);   // Зарплата_Нарахована
  s.getRange('K:L').setNumberFormat('#,##0.00');         // Показання лічильника (кВт·год)
  s.getRange('N2:N2000').setDataValidation(makeListRule_(['Відкрита', 'Закрита']));
  setColumnWidths_(s, [280, 80, 150, 150, 180, 110, 110, 110, 110, 150, 160, 160, 130, 90]);
}

// ═════════════════════════════════════════════════════════════════════════════
//  СЛУЖБОВІ ДОПОМІЖНИКИ
// ═════════════════════════════════════════════════════════════════════════════

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function styleHeader_(range) {
  range
    .setFontWeight('bold')
    .setBackground('#37474F')
    .setFontColor('#FFFFFF')
    .setWrap(true)
    .setVerticalAlignment('middle');
}

function applyHeaders_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  styleHeader_(range);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 36);
}

function setColumnWidths_(sheet, widths) {
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

function makeListRule_(list) {
  return SpreadsheetApp.newDataValidation().requireValueInList(list, true).build();
}

function removeDefaultSheets_(ss) {
  ['Sheet1', 'Аркуш1', 'Лист1', 'Arkush1'].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
}

/**
 * Встановлює PIN адміністратора (SHA-256 хеш) в «Налаштування».
 * Виклик: setAdminPin('ваш_pin')
 */
function setAdminPin(pin) {
  if (!pin) throw new Error('PIN не може бути порожнім');
  setSetting('ADMIN_PIN', hashPin(String(pin)));
  Logger.log('ADMIN_PIN встановлено');
}

// ─────────────────────────────────────────────────────────────────────────────
//  updateMrcTableHeaders — оновлення МРЦ-таблиці до формату «ціна за літр»
//
//  Для ІСНУЮЧИХ таблиць: перейменовує заголовок і вписує нові ціни за літр.
//  Для НОВИХ таблиць: _fillSettingsData_() вже записує правильні значення.
//  Безпечно запускати повторно.
// ─────────────────────────────────────────────────────────────────────────────

function updateMrcTableHeaders() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) throw new Error('Аркуш «Налаштування» не знайдено. Запустіть setupSheets().');

  // Рядки МРЦ-таблиці: header = 16, дані = 17–20
  // (визначено структурою _fillSettingsData_: 11 налаштувань + 3 рядки зазору = рядок 14,
  //  +2 = рядок 16 для заголовка стовпців, +3..+6 = рядки 17–20 для даних)
  sheet.getRange(16, 2).setValue('Ціна за літр (₴/л)');

  sheet.getRange(17, 2, 4, 1).setValues([
    [178.80],   // Горілка:    89,40 ÷ 0,5  = 178,80 ₴/л
    [ 90.00],   // Вино:       67,50 ÷ 0,75 =  90,00 ₴/л
    [218.00],   // Шампанське: 163,50 ÷ 0,75 = 218,00 ₴/л
    [384.96],   // Коньяк:     192,48 ÷ 0,5  = 384,96 ₴/л
  ]);

  // Переконатися що формат числовий (₴/л)
  sheet.getRange(17, 2, 4, 1).setNumberFormat('# ##0.00');

  SpreadsheetApp.flush();
  logOperation({ type: 'update_mrc_headers', status: 'ok', user: 'system' });
  Logger.log('updateMrcTableHeaders() завершено — МРЦ переведено в ₴/л');
  SpreadsheetApp.getUi().alert(
    '✅ МРЦ-таблицю оновлено.\n\n' +
    'Горілка:    178,80 ₴/л\n' +
    'Вино:        90,00 ₴/л\n' +
    'Шампанське: 218,00 ₴/л\n' +
    'Коньяк:     384,96 ₴/л\n\n' +
    'Заголовок стовпця: «Ціна за літр (₴/л)»'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  fixAllFormats — виправлення числових форматів у всіх аркушах
//
//  Безпечно запускати повторно: змінює лише формати, не чіпає значення.
//  Запускати після setupSheets() + setupSettings() + setupFormats().
//
//  Перший крок: встановлює локаль uk_UA — без цього формат # ##0,00 ₴
//  рендерить невірно в таблицях з локаллю English (89 → "089 ₴").
// ─────────────────────────────────────────────────────────────────────────────

function fixAllFormats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Встановити локаль — без uk_UA формат # ##0,00 ₴ рендерить невірно
  ss.setSpreadsheetLocale('uk_UA');

  // Хелпер: знайти стовпець за назвою заголовка та застосувати формат
  const applyFmt = (sheetName, colHeader, format) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log('[fixAllFormats] Аркуш не знайдено: ' + sheetName);
      return;
    }
    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    const hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const idx = hdr.indexOf(colHeader);
    if (idx < 0) {
      Logger.log('[fixAllFormats] Стовпець "' + colHeader + '" не знайдено в «' + sheetName + '»');
      return;
    }
    // Застосувати від рядка 2 до кінця аркуша (включаючи порожні рядки для майбутніх даних)
    sheet.getRange(2, idx + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(format);
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  1. Налаштування — рядкові адреси (нема стовпців-заголовків)
  // ══════════════════════════════════════════════════════════════════════════
  const sett = ss.getSheetByName(SHEET_SETTINGS);
  if (sett) {
    sett.getRange('B2:B30').setNumberFormat('@');             // скидання: текст для всього діапазону
    sett.getRange('B5') .setNumberFormat('0,00%');            // DEFAULT_MARKUP_ALCOHOL → 15,00%
    sett.getRange('B6') .setNumberFormat('#,##0');            // ENERGY_LIMIT_KWT → ціле число
    sett.getRange('B17:B20').setNumberFormat('# ##0.00');     // МРЦ за літр → 178,80 (без ₴, заголовок вже містить ₴/л)
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  2. Товари
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_PRODUCTS, 'Ціна_Закупки',     CURRENCY_FORMAT);
  applyFmt(SHEET_PRODUCTS, 'Ціна_Продажі',     CURRENCY_FORMAT);
  applyFmt(SHEET_PRODUCTS, 'МРЦ_Закон',        CURRENCY_FORMAT);
  applyFmt(SHEET_PRODUCTS, 'Залишок',          '# ##0,###');
  applyFmt(SHEET_PRODUCTS, 'Обʼєм_Літрів',    '#,##0.##');
  applyFmt(SHEET_PRODUCTS, 'Фортеця_Градусів', '#,##0.##');
  applyFmt(SHEET_PRODUCTS, 'Дата_Оновлення',   DATETIME_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  3. Продажі
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_SALES, 'Дата_Час',      DATETIME_FORMAT);
  applyFmt(SHEET_SALES, 'Ціна_Продажі', CURRENCY_FORMAT);
  applyFmt(SHEET_SALES, 'Ціна_Закупки', CURRENCY_FORMAT);
  applyFmt(SHEET_SALES, 'Сума',         CURRENCY_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  4. Прихід
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_RECEIPTS, 'Дата',          DATETIME_FORMAT);
  applyFmt(SHEET_RECEIPTS, 'Ціна_Закупки', CURRENCY_FORMAT);
  applyFmt(SHEET_RECEIPTS, 'Ціна_Продажі', CURRENCY_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  5. Витрати
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_EXPENSES, 'Дата', DATETIME_FORMAT);
  applyFmt(SHEET_EXPENSES, 'Сума', CURRENCY_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  6. Каса_Адміністратора
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_ADMIN_CASH, 'Дата', DATETIME_FORMAT);
  applyFmt(SHEET_ADMIN_CASH, 'Сума', CURRENCY_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  7. Інвентаризація
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_INVENTORY, 'Дата', DATETIME_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  8. Співробітники — ставка + 6 колонок відсотків
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_EMPLOYEES, 'Денна_Ставка',        CURRENCY_FORMAT);
  applyFmt(SHEET_EMPLOYEES, '%_Тютюнові_вироби',   '0.000');
  applyFmt(SHEET_EMPLOYEES, '%_Пиво_та_напої',     '0.000');
  applyFmt(SHEET_EMPLOYEES, '%_Мінвода_та_соки',   '0.000');
  applyFmt(SHEET_EMPLOYEES, '%_Алкогольні_напої',  '0.000');
  applyFmt(SHEET_EMPLOYEES, '%_Штучні_товари',     '0.000');
  applyFmt(SHEET_EMPLOYEES, '%_Кава',              '0.000');

  // ══════════════════════════════════════════════════════════════════════════
  //  9. Зарплатна_Відомість
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_PAYROLL, 'Дата',                DATETIME_FORMAT);
  applyFmt(SHEET_PAYROLL, 'Нараховано_Ставка',   CURRENCY_FORMAT);
  applyFmt(SHEET_PAYROLL, 'Нараховано_Відсоток', CURRENCY_FORMAT);
  applyFmt(SHEET_PAYROLL, 'Разом_Нараховано',    CURRENCY_FORMAT);
  applyFmt(SHEET_PAYROLL, 'Виплачено',           CURRENCY_FORMAT);
  applyFmt(SHEET_PAYROLL, 'Залишок_Боргу',       CURRENCY_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  10. Енергооблік
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_ENERGY, 'Дата',                 DATETIME_FORMAT);
  applyFmt(SHEET_ENERGY, 'Показання_Лічильника', '#,##0.00');
  applyFmt(SHEET_ENERGY, 'Витрата_За_Добу',      '#,##0.00');

  // ══════════════════════════════════════════════════════════════════════════
  //  11. Списання
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_WRITEOFFS, 'Дата', DATETIME_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  12. Журнал_Операцій
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_LOG, 'Дата_Час', DATETIME_FORMAT);

  // ══════════════════════════════════════════════════════════════════════════
  //  13. Зміни
  // ══════════════════════════════════════════════════════════════════════════
  applyFmt(SHEET_SHIFTS, 'Дата_Відкриття',                DATETIME_FORMAT);
  applyFmt(SHEET_SHIFTS, 'Дата_Закриття',                 DATETIME_FORMAT);
  applyFmt(SHEET_SHIFTS, 'Разом_Готівка',                 CURRENCY_FORMAT);
  applyFmt(SHEET_SHIFTS, 'Разом_Карта',                   CURRENCY_FORMAT);
  applyFmt(SHEET_SHIFTS, 'Разом_Виручка',                 CURRENCY_FORMAT);
  applyFmt(SHEET_SHIFTS, 'Готівка_Факт',                  CURRENCY_FORMAT);
  applyFmt(SHEET_SHIFTS, 'Розбіжність_Готівки',           CURRENCY_FORMAT);
  applyFmt(SHEET_SHIFTS, 'Зарплата_Нарахована',           CURRENCY_FORMAT);
  applyFmt(SHEET_SHIFTS, 'Показання_Лічильника_Початок', '#,##0.00');
  applyFmt(SHEET_SHIFTS, 'Показання_Лічильника_Кінець',  '#,##0.00');

  SpreadsheetApp.flush();
  logOperation({ type: 'fix_formats', status: 'ok', user: 'system' });
  Logger.log('fixAllFormats() завершено — формати виправлено в 13 аркушах');
  SpreadsheetApp.getUi().alert('✅ fixAllFormats() завершено. Локаль встановлено uk_UA.');
}
