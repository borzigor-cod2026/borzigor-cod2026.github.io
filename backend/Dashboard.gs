// ─────────────────────────────────────────────────────────────────────────────
//  DASHBOARD.GS — налаштування дашборду власника в Google Sheets
//
//  Запускати ПІСЛЯ setupSheets() + setupSettings() + setupFormats().
//
//  Виконувати кроками або разом через setupDashboard():
//    1. setupDashboardLayout()   — структура, мітки, злиття, захист  (~1–2 хв)
//    2. setupNamedRanges()       — 37 іменованих діапазонів          (~1 хв)
//    3. setupDashboardFormulas() — SUMPRODUCT-формули                 (~1–2 хв)
//
//  Порядок 1→2→3 обовʼязковий: формули посилаються на іменовані діапазони.
//
//  Усі формули:
//  - використовують ; як роздільник (українська локаль)
//  - загорнуті в IFERROR()
//  - посилаються на іменовані діапазони, не на буквені адреси стовпців
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
//  ПУБЛІЧНІ ТОЧКИ ВХОДУ
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Запускає всі три фази послідовно.
 * Якщо перевищить 6-хвилинний ліміт — запускати кожну фазу окремо.
 */
function setupDashboard() {
  setupDashboardLayout();
  setupNamedRanges();
  setupDashboardFormulas();
  SpreadsheetApp.getUi().alert('✅ Дашборд налаштовано!');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ФАЗА 1 — Структура, мітки, кольори, злиття, захист
//  Жодних формул, жодних іменованих діапазонів.
//  Орієнтовно: 1–2 хвилини.
// ─────────────────────────────────────────────────────────────────────────────

function setupDashboardLayout() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_DASHBOARD);
  if (!sheet) throw new Error('Спочатку запустіть setupSheets().');

  sheet.clearContents().clearFormats();

  // ── Ширини стовпців ────────────────────────────────────────────────────────
  [220, 160, 160, 160, 160, 160].forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // ── Блок 1: Заголовок + вибір періоду (рядки 1–6) ─────────────────────────
  sheet.getRange('A1:F1').merge()
    .setValue('ДАШБОРД ВЛАСНИКА')
    .setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center')
    .setBackground('#1A237E').setFontColor('#FFFFFF');
  sheet.setRowHeight(1, 50);

  sheet.getRange('A3')
    .setValue('Оновлюється автоматично після кожної синхронізації')
    .setFontStyle('italic').setFontColor('#757575').setFontSize(9);

  sheet.getRange('A4').setValue('Період:').setFontWeight('bold');
  sheet.getRange('B4')
    .setValue('Сьогодні')
    .setBackground('#E3F2FD').setFontWeight('bold').setFontSize(11)
    .setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['Сьогодні', 'Вчора', 'Ця тиждень', 'Цей місяць'], true)
      .build());

  sheet.getRange('A5').setValue('З:').setFontColor('#757575');
  sheet.getRange('A6').setValue('По:').setFontColor('#757575');
  // B5, B6 — формули дат пишуться в setupDashboardFormulas()

  // ── Блок 2: KPI (рядки 8–11) ──────────────────────────────────────────────
  sectionHeader_(sheet, 'A8', 'F8', '📊 КЛЮЧОВІ ПОКАЗНИКИ', '#0D47A1');

  ['Виручка', 'Вал. прибуток', 'Маржа', 'Витрати (підтв.)', 'Чистий прибуток']
    .forEach((h, i) => {
      sheet.getRange(9, i + 2)
        .setValue(h).setFontWeight('bold').setFontColor('#37474F').setHorizontalAlignment('center');
    });

  // Рядок 10: тільки фон + висота; KPI-формули — setupDashboardFormulas()
  sheet.getRange('B10:F10').setBackground('#E8F5E9');
  sheet.setRowHeight(10, 36);

  // ── Блок 3: По магазинах (рядки 13–20) ────────────────────────────────────
  sectionHeader_(sheet, 'A13', 'F13', '🏪 ПО МАГАЗИНАХ', '#1565C0');

  [['B14', 'SHOP 1'], ['C14', 'SHOP 2'], ['D14', 'РАЗОМ']].forEach(([cell, label]) => {
    sheet.getRange(cell).setValue(label).setFontWeight('bold').setHorizontalAlignment('center');
  });

  const shopLabels = [
    'Виручка',
    'Готівка',
    'Карта',
    'Витрати (підтв.)',
    'Вал. прибуток',
    'Розбіжність готівки (адмін)',
  ];
  shopLabels.forEach((label, r) => {
    const row = 15 + r;
    sheet.getRange(row, 1).setValue(label).setFontWeight(r === 5 ? 'bold' : 'normal');
    if (r === 5) sheet.getRange(row, 1, 1, 4).setBackground('#FFF9C4');
  });
  // Формули стовпців B, C, D — setupDashboardFormulas()

  // ── Блок 4: Виручка по групах (рядки 23–31) ───────────────────────────────
  sectionHeader_(sheet, 'A23', 'F23', '🛒 ВИРУЧКА ПО ГРУПАХ', '#1B5E20');

  const groups = [
    'Тютюнові вироби', 'Пиво та напої', 'Мінвода та соки',
    'Алкогольні напої', 'Штучні товари', 'Кава',
  ];
  groups.forEach((g, i) => sheet.getRange(24 + i, 1).setValue(g));
  sheet.getRange(24 + groups.length, 1).setValue('РАЗОМ').setFontWeight('bold');
  // Формули стовпців B, C — setupDashboardFormulas()

  // ── Блок 5: Алерти (рядки 33–38) ──────────────────────────────────────────
  sectionHeader_(sheet, 'A33', 'F33', '⚠ ПОТРЕБУЮТЬ УВАГИ', '#B71C1C');

  const alertLabels = [
    'Відʼємний залишок товарів',
    'Витрати очікують підтвердження',
    'Невиплачена зарплата',
    'Нові товари від касира',
    'Актуальність МРЦ на алкоголь',
  ];
  alertLabels.forEach((label, a) => {
    const row = 34 + a;
    sheet.getRange(row, 1).setValue(label).setFontWeight('bold');
    sheet.getRange(row, 2, 1, 4).merge(); // Злиття B:E — формула: setupDashboardFormulas()
  });

  // ── Блок 6: Зарплати (рядки 43+) ──────────────────────────────────────────
  sectionHeader_(sheet, 'A43', 'F43', '💰 ЗАРПЛАТИ ЗА ПЕРІОД', '#4A148C');

  ['Продавець', 'Нараховано', 'Виплачено', 'Борг'].forEach((h, i) => {
    sheet.getRange(44, i + 1).setValue(h).setFontWeight('bold');
  });
  // Рядок 45: QUERY-формула — setupDashboardFormulas()

  protectDashboard_(sheet);
  SpreadsheetApp.flush();
  logOperation({ type: 'setup_dashboard_layout', status: 'ok', user: 'system' });
  Logger.log('setupDashboardLayout() завершено');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ФАЗА 2 — 37 іменованих діапазонів
//  Читає заголовки аркушів (потребує setupSheets()).
//  PeriodStart/PeriodEnd посилаються на B5/B6 дашборду.
//  Орієнтовно: < 1 хвилина.
// ─────────────────────────────────────────────────────────────────────────────

function setupNamedRanges() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const nr = (name, sheetName, colHeader) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) { Logger.log('Аркуш не знайдено: ' + sheetName); return; }
    const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = hdr.indexOf(colHeader);
    if (idx < 0) { Logger.log('Стовпець не знайдено: ' + colHeader + ' в ' + sheetName); return; }
    const col = columnToLetter_(idx + 1);
    ss.setNamedRange(name, sheet.getRange(col + ':' + col));
  };

  // ── Продажі (10) ──────────────────────────────────────────────────────────
  nr('SalesDate',         SHEET_SALES, 'Дата_Час');
  nr('SalesShop',         SHEET_SALES, 'Магазин_ID');
  nr('SalesGroup',        SHEET_SALES, 'Група');
  nr('SalesQty',          SHEET_SALES, 'Кількість');
  nr('SalesSellPrice',    SHEET_SALES, 'Ціна_Продажі');
  nr('SalesPurchaseCost', SHEET_SALES, 'Ціна_Закупки');
  nr('SalesTotal',        SHEET_SALES, 'Сума');
  nr('SalesPayment',      SHEET_SALES, 'Тип_Оплати');
  nr('SalesSeller',       SHEET_SALES, 'Продавець');
  nr('SalesReturn',       SHEET_SALES, 'Повернення');

  // ── Витрати (4) ───────────────────────────────────────────────────────────
  nr('ExpDate',   SHEET_EXPENSES, 'Дата');
  nr('ExpShop',   SHEET_EXPENSES, 'Магазин_ID');
  nr('ExpTotal',  SHEET_EXPENSES, 'Сума');
  nr('ExpStatus', SHEET_EXPENSES, 'Статус_Підтвердження');

  // ── Товари (3) ────────────────────────────────────────────────────────────
  nr('ProdShop',  SHEET_PRODUCTS, 'Магазин_ID');
  nr('ProdName',  SHEET_PRODUCTS, 'Назва');
  nr('ProdStock', SHEET_PRODUCTS, 'Залишок');

  // ── Зміни (10) ────────────────────────────────────────────────────────────
  nr('ShiftShop',       SHEET_SHIFTS, 'Магазин_ID');
  nr('ShiftOpen',       SHEET_SHIFTS, 'Дата_Відкриття');
  nr('ShiftSeller',     SHEET_SHIFTS, 'Імʼя_Продавця');
  nr('ShiftRevCash',    SHEET_SHIFTS, 'Разом_Готівка');
  nr('ShiftRevCard',    SHEET_SHIFTS, 'Разом_Карта');
  nr('ShiftRevTotal',   SHEET_SHIFTS, 'Разом_Виручка');
  nr('ShiftCashActual', SHEET_SHIFTS, 'Готівка_Факт');
  nr('ShiftCashDiff',   SHEET_SHIFTS, 'Розбіжність_Готівки');
  nr('ShiftSalary',     SHEET_SHIFTS, 'Зарплата_Нарахована');
  nr('ShiftStatus',     SHEET_SHIFTS, 'Статус');

  // ── Зарплатна_Відомість (6) ───────────────────────────────────────────────
  nr('PayrollShop',    SHEET_PAYROLL, 'Магазин_ID');
  nr('PayrollDate',    SHEET_PAYROLL, 'Дата');
  nr('PayrollName',    SHEET_PAYROLL, 'Імʼя_Співробітника');
  nr('PayrollAccrued', SHEET_PAYROLL, 'Разом_Нараховано');
  nr('PayrollPaid',    SHEET_PAYROLL, 'Виплачено');
  nr('PayrollDebt',    SHEET_PAYROLL, 'Залишок_Боргу');

  // ── Журнал_Операцій (2) ───────────────────────────────────────────────────
  nr('LogType', SHEET_LOG, 'Тип_Операції');
  nr('LogDate', SHEET_LOG, 'Дата_Час');

  // ── Дашборд: PeriodStart / PeriodEnd → B5 / B6 (2) ───────────────────────
  const dash = ss.getSheetByName(SHEET_DASHBOARD);
  if (dash) {
    ss.setNamedRange('PeriodStart', dash.getRange('B5'));
    ss.setNamedRange('PeriodEnd',   dash.getRange('B6'));
  }

  SpreadsheetApp.flush();
  logOperation({ type: 'setup_named_ranges', status: 'ok', user: 'system' });
  Logger.log('setupNamedRanges() завершено — 37 іменованих діапазонів');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ФАЗА 3 — SUMPRODUCT-формули
//  Потребує: іменовані діапазони (setupNamedRanges()).
//  Орієнтовно: 1–2 хвилини.
// ─────────────────────────────────────────────────────────────────────────────

function setupDashboardFormulas() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_DASHBOARD);
  if (!sheet) throw new Error('Спочатку запустіть setupDashboardLayout().');

  // ── Блок 1: Дати періоду (B5, B6) ─────────────────────────────────────────
  sheet.getRange('B5').setFormula(
    '=IFERROR(IF(B4="Сьогодні";TODAY();IF(B4="Вчора";TODAY()-1;IF(B4="Ця тиждень";TODAY()-WEEKDAY(TODAY();2)+1;DATE(YEAR(TODAY());MONTH(TODAY());1))));TODAY())'
  ).setNumberFormat(DATE_FORMAT);

  sheet.getRange('B6').setFormula(
    '=IFERROR(IF(B4="Вчора";TODAY()-1;TODAY());TODAY())'
  ).setNumberFormat(DATE_FORMAT);

  // ── Блок 2: KPI рядок 10 (B10:F10) ───────────────────────────────────────
  sheet.getRange('B10')
    .setFormula('=IFERROR(SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*SalesTotal);0)')
    .setNumberFormat(CURRENCY_FORMAT).setFontSize(13).setFontWeight('bold');

  sheet.getRange('C10')
    .setFormula('=IFERROR(B10-SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*SalesQty*SalesPurchaseCost);0)')
    .setNumberFormat(CURRENCY_FORMAT).setFontSize(13).setFontWeight('bold');

  sheet.getRange('D10')
    .setFormula('=IFERROR(IF(B10=0;0;C10/B10);0)')
    .setNumberFormat('0.0%').setFontSize(13).setFontWeight('bold');

  sheet.getRange('E10')
    .setFormula('=IFERROR(SUMPRODUCT((ExpDate>=PeriodStart)*(ExpDate<=PeriodEnd)*(ExpStatus="Підтверджено")*ExpTotal);0)')
    .setNumberFormat(CURRENCY_FORMAT).setFontSize(13).setFontWeight('bold');

  sheet.getRange('F10')
    .setFormula('=IFERROR(C10-E10;0)')
    .setNumberFormat(CURRENCY_FORMAT).setFontSize(13).setFontWeight('bold');

  // ── Блок 3: По магазинах — формули рядків 15–20 ───────────────────────────
  const shopFormulaRows = [
    shopFormula_('SalesTotal', 'SalesShop'),
    shopPaymentFormula_('Готівка'),
    shopPaymentFormula_('Картка'),
    shopExpFormula_(),
    shopGpFormula_(),
    shopCashDiffFormula_(),
  ];
  shopFormulaRows.forEach((fmls, r) => {
    const row = 15 + r;
    sheet.getRange(row, 2).setFormula(fmls[0]).setNumberFormat(CURRENCY_FORMAT);
    sheet.getRange(row, 3).setFormula(fmls[1]).setNumberFormat(CURRENCY_FORMAT);
    sheet.getRange(row, 4)
      .setFormula('=IFERROR(B' + row + '+C' + row + ';0)')
      .setNumberFormat(CURRENCY_FORMAT);
  });

  // ── Блок 4: Виручка по групах — формули рядків 24–29 ──────────────────────
  const groups = [
    'Тютюнові вироби', 'Пиво та напої', 'Мінвода та соки',
    'Алкогольні напої', 'Штучні товари', 'Кава',
  ];
  groups.forEach((g, i) => {
    const row      = 24 + i;
    const groupEsc = g.replace(/"/g, '""');
    sheet.getRange(row, 2)
      .setFormula('=IFERROR(SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesGroup="' + groupEsc + '")*SalesTotal);0)')
      .setNumberFormat(CURRENCY_FORMAT);
    sheet.getRange(row, 3)
      .setFormula('=IFERROR(IF(B10=0;0;B' + row + '/B10);0)')
      .setNumberFormat('0.0%').setFontColor('#757575');
  });
  const razomRow = 24 + groups.length;
  sheet.getRange(razomRow, 2).setFormula('=B10').setNumberFormat(CURRENCY_FORMAT).setFontWeight('bold');

  // ── Блок 5: Алерти — формули рядків 34–38 ─────────────────────────────────
  // Клітинки B34:B38 є першими клітинками злитих діапазонів B:E (злито в фазі 1)
  const alertFormulas = [
    '=IFERROR(IF(COUNTIF(ProdStock;"<0")>0;"⚠ "&COUNTIF(ProdStock;"<0")&" товар(ів) з відʼємним залишком";"✅ Норма");"✅")',
    '=IFERROR(IF(COUNTIF(ExpStatus;"Очікує")>0;"⚠ "&COUNTIF(ExpStatus;"Очікує")&" витрата(и) без підтвердження";"✅ Норма");"✅")',
    '=IFERROR(IF(SUMIF(PayrollDebt;">"&0;PayrollDebt)>0;"⚠ Борг "&TEXT(SUMIF(PayrollDebt;">"&0;PayrollDebt);"# ##0,00 ₴");"✅ Виплачено");"✅")',
    '=IFERROR(IF(COUNTIF(LogType;"new_product_on_sale")>0;"⚠ "&COUNTIF(LogType;"new_product_on_sale")&" товар(ів) потребують доповнення картки";"✅ Норма");"✅")',
    '=IFERROR(IF(TODAY()-VLOOKUP("MRC_UPDATED";' + SHEET_SETTINGS + '!$A:$B;2;FALSE)>30;"⚠ МРЦ не оновлювались "&(TODAY()-VLOOKUP("MRC_UPDATED";' + SHEET_SETTINGS + '!$A:$B;2;FALSE))&" днів";"✅ Актуально");"✅ Актуально")',
  ];
  alertFormulas.forEach((formula, a) => {
    sheet.getRange(34 + a, 2).setFormula(formula);
  });

  // ── Блок 6: Зарплати — QUERY-формула рядок 45 ─────────────────────────────
  sheet.getRange(45, 1)
    .setFormula(
      '=IFERROR(QUERY({PayrollName;PayrollAccrued;PayrollPaid;PayrollDebt};"SELECT Col1, SUM(Col2), SUM(Col3), SUM(Col4) WHERE Col2 IS NOT NULL GROUP BY Col1 LABEL SUM(Col2) \'\', SUM(Col3) \'\', SUM(Col4) \'\' ";0);"Немає даних за цей період")'
    ).setFontSize(10);

  SpreadsheetApp.flush();
  logOperation({ type: 'setup_dashboard_formulas', status: 'ok', user: 'system' });
  Logger.log('setupDashboardFormulas() завершено');
}

// ═════════════════════════════════════════════════════════════════════════════
//  ДОПОМІЖНИКИ ДЛЯ ФОРМУЛ — повертають масив [shop1_formula, shop2_formula]
// ═════════════════════════════════════════════════════════════════════════════

function shopFormula_(totalRange, shopRange) {
  return [
    '=IFERROR(SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesShop="SHOP_1")*SalesTotal);0)',
    '=IFERROR(SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesShop="SHOP_2")*SalesTotal);0)',
  ];
}

function shopPaymentFormula_(paymentType) {
  return [
    '=IFERROR(SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesShop="SHOP_1")*(SalesPayment="' + paymentType + '")*SalesTotal);0)',
    '=IFERROR(SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesShop="SHOP_2")*(SalesPayment="' + paymentType + '")*SalesTotal);0)',
  ];
}

function shopExpFormula_() {
  return [
    '=IFERROR(SUMPRODUCT((ExpDate>=PeriodStart)*(ExpDate<=PeriodEnd)*(ExpShop="SHOP_1")*(ExpStatus="Підтверджено")*ExpTotal);0)',
    '=IFERROR(SUMPRODUCT((ExpDate>=PeriodStart)*(ExpDate<=PeriodEnd)*(ExpShop="SHOP_2")*(ExpStatus="Підтверджено")*ExpTotal);0)',
  ];
}

function shopGpFormula_() {
  return [
    '=IFERROR(SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesShop="SHOP_1")*SalesTotal)-SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesShop="SHOP_1")*SalesQty*SalesPurchaseCost);0)',
    '=IFERROR(SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesShop="SHOP_2")*SalesTotal)-SUMPRODUCT((SalesDate>=PeriodStart)*(SalesDate<=PeriodEnd)*(SalesShop="SHOP_2")*SalesQty*SalesPurchaseCost);0)',
  ];
}

function shopCashDiffFormula_() {
  return [
    '=IFERROR(SUMPRODUCT((ShiftOpen>=PeriodStart)*(ShiftOpen<=PeriodEnd)*(ShiftShop="SHOP_1")*ShiftCashDiff);0)',
    '=IFERROR(SUMPRODUCT((ShiftOpen>=PeriodStart)*(ShiftOpen<=PeriodEnd)*(ShiftShop="SHOP_2")*ShiftCashDiff);0)',
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
//  СТИЛІЗАЦІЯ ТА ЗАХИСТ
// ═════════════════════════════════════════════════════════════════════════════

function sectionHeader_(sheet, fromCell, toCell, text, bgColor) {
  const range = sheet.getRange(fromCell + ':' + toCell);
  range.merge()
    .setValue(text)
    .setFontWeight('bold').setFontSize(11)
    .setBackground(bgColor).setFontColor('#FFFFFF')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(parseInt(fromCell.replace(/[A-Z]/g, ''), 10), 30);
}

function protectDashboard_(sheet) {
  const protection = sheet.protect();
  protection.setDescription('Дашборд захищено — тільки перегляд');
  protection.setWarningOnly(true);
}

// ═════════════════════════════════════════════════════════════════════════════
//  УТИЛІТА: номер стовпця → літера (1→A, 26→Z, 27→AA)
// ═════════════════════════════════════════════════════════════════════════════

function columnToLetter_(col) {
  let letter = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter    = String.fromCharCode(65 + rem) + letter;
    col       = Math.floor((col - 1) / 26);
  }
  return letter;
}
