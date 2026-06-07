// ─────────────────────────────────────────────────────────────────────────────
//  Admin.gs — операції каси адміністратора та адмін-дії
//
//  Дії, доступні через Code.gs doPost():
//    get_admin_cash          — журнал + баланс + категорії
//    create_admin_cash_entry — новий рядок у SHEET_ADMIN_CASH
//    add_admin_cash_category — додати категорію в ADMIN_CASH_CATEGORIES
//    get_new_products        — товари, додані касиром «на льоту» (local_ id)
//    update_product          — оновити ціну/МРЦ/групу товару
//    get_inventories         — завершені інвентаризації (не затверджені)
//    get_pending_expenses    — витрати зі статусом 'Очікує'
//    approve_expense         — підтвердити витрату
//    reject_expense          — відхилити витрату
//    get_salary              — зведення зарплат по співробітниках
//    salary_payment          — виплата зарплати
// ─────────────────────────────────────────────────────────────────────────────

// ─── ДАШБОРД ──────────────────────────────────────────────────────────────────

/**
 * get_dashboard
 * Повертає:
 *   alerts    — масив активних алертів (тільки ті що є)
 *   kpi_today — KPI за сьогодні: загальна виручка, прибуток, по магазинах
 */
function getDashboard_(payload) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Читаємо всі аркуші один раз
  const readSheet_ = name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() <= 1) return { hdr: [], rows: [] };
    const [hdr, ...rows] = sh.getDataRange().getValues();
    return { hdr, rows };
  };
  const sales   = readSheet_(SHEET_SALES);
  const exp     = readSheet_(SHEET_EXPENSES);
  const shifts  = readSheet_(SHEET_SHIFTS);
  const prods   = readSheet_(SHEET_PRODUCTS);
  const payroll = readSheet_(SHEET_PAYROLL);
  const log     = readSheet_(SHEET_LOG);

  // ── Агрегація продажів сьогодні ───────────────────────────────────────────
  const shopAgg = {
    SHOP_1: { revenue: 0, cash: 0, card: 0, purchase_cost: 0, expenses: 0 },
    SHOP_2: { revenue: 0, cash: 0, card: 0, purchase_cost: 0, expenses: 0 },
  };
  if (sales.rows.length) {
    const col = n => sales.hdr.indexOf(n);
    const [cDate, cShop, cTotal, cPay, cBuy, cQty] =
      ['Дата_Час', 'Магазин_ID', 'Сума', 'Тип_Оплати', 'Ціна_Закупки', 'Кількість'].map(col);
    for (const r of sales.rows) {
      const d = r[cDate] instanceof Date ? r[cDate] : new Date(r[cDate]);
      if (d < todayStart || d > todayEnd) continue;
      const sid = String(r[cShop] || '');
      if (!shopAgg[sid]) continue;
      const amt = Number(r[cTotal]) || 0;
      shopAgg[sid].revenue       += amt;
      shopAgg[sid].purchase_cost += (Number(r[cBuy]) || 0) * (Number(r[cQty]) || 0);
      const pay = String(r[cPay] || '');
      if      (pay === 'Готівка') shopAgg[sid].cash += amt;
      else if (pay === 'Картка')  shopAgg[sid].card += amt;
    }
  }

  // ── Витрати: підтверджені today + кількість очікуючих ─────────────────────
  let pendingExpCount = 0;
  if (exp.rows.length) {
    const col = n => exp.hdr.indexOf(n);
    const [cDate, cShop, cStatus, cSum] =
      ['Дата', 'Магазин_ID', 'Статус_Підтвердження', 'Сума'].map(col);
    for (const r of exp.rows) {
      const status = String(r[cStatus] || '');
      if (status === 'Очікує') { pendingExpCount++; continue; }
      if (status !== 'Підтверджено') continue;
      const d = r[cDate] instanceof Date ? r[cDate] : new Date(r[cDate]);
      if (d < todayStart || d > todayEnd) continue;
      const sid = String(r[cShop] || '');
      if (shopAgg[sid]) shopAgg[sid].expenses += Number(r[cSum]) || 0;
    }
  }

  // ── Зміни today: касир + розбіжність готівки ──────────────────────────────
  const shopCashier  = { SHOP_1: null, SHOP_2: null };
  const shopCashDiff = { SHOP_1: null, SHOP_2: null };
  if (shifts.rows.length) {
    const col = n => shifts.hdr.indexOf(n);
    const [cOpen, cShop, cSell, cDiff] =
      ['Дата_Відкриття', 'Магазин_ID', 'Імʼя_Продавця', 'Розбіжність_Готівки'].map(col);
    for (const r of shifts.rows) {
      const d = r[cOpen] instanceof Date ? r[cOpen] : new Date(r[cOpen]);
      if (d < todayStart || d > todayEnd) continue;
      const sid = String(r[cShop] || '');
      if (sid !== 'SHOP_1' && sid !== 'SHOP_2') continue;
      if (!shopCashier[sid]) shopCashier[sid] = String(r[cSell] || '') || null;
      shopCashDiff[sid] = (shopCashDiff[sid] ?? 0) + (Number(r[cDiff]) || 0);
    }
  }

  // ── Алерти ────────────────────────────────────────────────────────────────
  const alerts = [];

  // 1. low_stock — від'ємний залишок
  if (prods.rows.length) {
    const pStock = prods.hdr.indexOf('Залишок');
    const n = prods.rows.filter(r => (Number(r[pStock]) || 0) < 0).length;
    if (n > 0) alerts.push({ type: 'low_stock', count: n });
  }

  // 2. pending_expenses — очікують підтвердження
  if (pendingExpCount > 0) alerts.push({ type: 'pending_expenses', count: pendingExpCount });

  // 3. salary_debt — борг по зарплаті (earned - paid across all payroll rows)
  if (payroll.rows.length) {
    const pAccrued = payroll.hdr.indexOf('Разом_Нараховано');
    const pPaid    = payroll.hdr.indexOf('Виплачено');
    let earned = 0, paid = 0;
    for (const r of payroll.rows) {
      earned += Number(r[pAccrued]) || 0;
      paid   += Number(r[pPaid])    || 0;
    }
    const debt = Math.max(0, earned - paid);
    if (debt > 0) alerts.push({ type: 'salary_debt', amount: Math.round(debt * 100) / 100 });
  }

  // 4. new_products — нові товари від касира (type='new_product_on_sale' в журналі)
  if (log.rows.length) {
    const lType = log.hdr.indexOf('Тип_Операції');
    const n = log.rows.filter(r => String(r[lType]) === 'new_product_on_sale').length;
    if (n > 0) alerts.push({ type: 'new_products', count: n });
  }

  // 5. mrc_outdated — МРЦ не оновлювалось більше 30 днів
  try {
    const raw = getSetting('MRC_UPDATED');
    const mrcDate = raw instanceof Date ? raw : (raw ? new Date(String(raw)) : null);
    if (mrcDate && !isNaN(mrcDate.getTime())) {
      const daysSince = Math.floor((now - mrcDate) / 86400000);
      if (daysSince > 30 && prods.rows.length) {
        const pGroup  = prods.hdr.indexOf('Група');
        const ALCOHOL = ['Алкогольні напої', 'Пиво та напої'];
        const n = prods.rows.filter(r => pGroup >= 0 && ALCOHOL.includes(String(r[pGroup] || ''))).length;
        alerts.push({ type: 'mrc_outdated', days_since_update: daysSince, count: n });
      }
    }
  } catch (_) {}

  // ── KPI сьогодні ──────────────────────────────────────────────────────────
  const SHOP_NAMES = { SHOP_1: 'КРЕС', SHOP_2: 'Киоск ринок' };
  const r2 = n => Math.round(n * 100) / 100;
  const shops = ['SHOP_1', 'SHOP_2'].map(sid => {
    const a = shopAgg[sid];
    return {
      shop_id:   sid,
      name:      SHOP_NAMES[sid],
      revenue:   r2(a.revenue),
      cash:      r2(a.cash),
      card:      r2(a.card),
      expenses:  r2(a.expenses),
      profit:    r2(a.revenue - a.purchase_cost),
      cashier:   shopCashier[sid],
      cash_diff: shopCashDiff[sid] !== null ? r2(shopCashDiff[sid]) : null,
    };
  });

  const totalRevenue  = shops.reduce((s, sh) => s + sh.revenue, 0);
  const totalPurchase = Object.values(shopAgg).reduce((s, a) => s + a.purchase_cost, 0);
  const totalExpenses = shops.reduce((s, sh) => s + sh.expenses, 0);

  return successResponse({
    alerts,
    kpi_today: {
      total_revenue: r2(totalRevenue),
      net_profit:    r2(totalRevenue - totalPurchase - totalExpenses),
      shops,
    },
    synced_at: nowISO(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ADMIN_CASH_CATEGORIES_ = [
  'Оренда', 'Комунальні послуги', 'Податки та збори', 'Ліцензії',
  'Закупівля', 'Реклама', 'Зарплата', 'Банківські послуги', 'Інше',
];

// Відображення shop_id → людська назва для Інкасацій з SHEET_EXPENSES
const SHOP_ID_TO_NAME_ = {
  SHOP_1: 'КРЕС',
  SHOP_2: 'Киоск ринок',
};

// ─── PUBLIC ACTIONS ───────────────────────────────────────────────────────────

/**
 * get_admin_cash
 * Повертає:
 *   entries   — всі записи SHEET_ADMIN_CASH + підтверджені Інкасації з SHEET_EXPENSES,
 *               відсортовані за датою, з полем balance (наростаючий підсумок).
 *   balance   — поточний баланс каси.
 *   categories — масив категорій із налаштувань (або дефолт).
 */
function getAdminCash_(payload) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const entries = [];

  // Optional shop_id filter: SHOP_1 → 'КРЕС', SHOP_2 → 'Киоск ринок', 'all'/absent → no filter
  const filterShopId   = payload && payload.shop_id;
  const filterShopName = filterShopId && filterShopId !== 'all'
    ? SHOP_ID_TO_NAME_[filterShopId] || null
    : null;

  // 1. Читаємо SHEET_ADMIN_CASH
  const cashSheet = ss.getSheetByName(SHEET_ADMIN_CASH);
  if (cashSheet && cashSheet.getLastRow() > 1) {
    const [hdr, ...rows] = cashSheet.getDataRange().getValues();
    rows.forEach(r => {
      const o = Object.fromEntries(hdr.map((h, j) => [h, r[j]]));
      const shopName = String(o['Магазин'] || 'Загальне');
      if (filterShopName && shopName !== filterShopName) return;
      entries.push({
        uuid:           String(o['UUID_Операції'] || ''),
        date:           _toISOStr_(o['Дата']),
        type:           String(o['Тип_Операції'] || ''),
        amount:         Math.abs(Number(o['Сума']) || 0),
        payment_method: String(o['Спосіб_Оплати'] || 'Готівка'),
        shop:           shopName,
        category:       String(o['Категорія'] || ''),
        description:    String(o['Опис'] || ''),
        created_by:     String(o['Створив'] || 'admin'),
        source:         'admin_cash',
      });
    });
  }

  // 2. Читаємо підтверджені Інкасації з SHEET_EXPENSES → Прихід
  const expSheet = ss.getSheetByName(SHEET_EXPENSES);
  if (expSheet && expSheet.getLastRow() > 1) {
    const [hdr, ...rows] = expSheet.getDataRange().getValues();
    const idx = col => hdr.indexOf(col);

    const iCat    = idx('Категорія_Витрати');
    const iStatus = idx('Статус_Підтвердження');
    const iDate   = idx('Дата');
    const iSuma   = idx('Сума');
    const iUUID   = idx('UUID_Операції');
    const iShop   = idx('Магазин_ID');
    const iSeller = idx('Продавець');
    const iDesc   = idx('Призначення');

    rows
      .filter(r => r[iCat] === 'Інкасація' && r[iStatus] === 'Підтверджено')
      .forEach(r => {
        entries.push({
          uuid:           String(r[iUUID] || ''),
          date:           _toISOStr_(r[iDate]),
          type:           'Прихід',
          amount:         Math.abs(Number(r[iSuma]) || 0),
          payment_method: 'Готівка',
          shop:           SHOP_ID_TO_NAME_[r[iShop]] || String(r[iShop] || ''),
          category:       'Інкасація',
          description:    String(r[iDesc] || r[iSeller] || ''),
          created_by:     String(r[iSeller] || ''),
          source:         'expense_inkasatsia',
        });
      });
  }

  // 3. Сортуємо за датою (найстарі → найновіші)
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  // 4. Обчислюємо наростаючий баланс
  let balance = 0;
  entries.forEach(e => {
    balance += e.type === 'Прихід' ? e.amount : -e.amount;
    e.balance = balance;
  });

  // 5. Категорії
  const categories = _getAdminCashCategories_();

  return successResponse({ entries, balance, categories, synced_at: nowISO() });
}

/**
 * create_admin_cash_entry
 * Payload (existing):  { type:'Прихід'|'Витрата', amount, payment_method, shop, category, description }
 * Payload (new form):  { type:'expense', amount, date, shop_id:'SHOP_1'|'SHOP_2'|'all', category, description }
 */
function createAdminCashEntry_(payload) {
  const SHOP_ID_TO_NAME_ = { SHOP_1: 'КРЕС', SHOP_2: 'Киоск ринок', all: 'Загальне' };

  // Accept 'expense' as alias for 'Витрата'
  let type = payload.type;
  if (type === 'expense') type = 'Витрата';
  if (!type || !['Прихід', 'Витрата'].includes(type))
    return errorResponse('type: Прихід, Витрата або expense', 'bad_request');

  const sum = Number(payload.amount);
  if (!sum || sum <= 0)
    return errorResponse('amount має бути > 0', 'bad_request');

  // Accept either shop (human name) or shop_id (machine key)
  let shop = payload.shop;
  if (!shop && payload.shop_id) shop = SHOP_ID_TO_NAME_[payload.shop_id] || payload.shop_id;
  const validShops = ['КРЕС', 'Киоск ринок', 'Загальне'];
  if (!shop || !validShops.includes(shop))
    return errorResponse('shop: ' + validShops.join(' / '), 'bad_request');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ADMIN_CASH);
  if (!sheet) return errorResponse('Аркуш ' + SHEET_ADMIN_CASH + ' не знайдено', 'server_error');

  const uuid = generateUUID();
  const date = payload.date ? new Date(payload.date) : new Date();

  sheet.appendRow(buildRow_(sheet, {
    'UUID_Операції': uuid,
    'Дата':          date,
    'Тип_Операції':  type,
    'Сума':          sum,
    'Спосіб_Оплати': payload.payment_method || 'Готівка',
    'Магазин':       shop,
    'Категорія':     payload.category || 'Інше',
    'Опис':          payload.description || '',
    'Створив':       'admin',
  }));

  logOperation({ type: 'create_admin_cash', status: 'ok', user: 'admin' });
  return successResponse({ uuid, created_at: date.toISOString() });
}

/**
 * add_admin_cash_category
 * Payload: { category }
 * Додає нову категорію до ADMIN_CASH_CATEGORIES (якщо ще не існує).
 */
function addAdminCashCategory_(payload) {
  const name = String(payload.category || '').trim();
  if (!name) return errorResponse('category обовʼязковий', 'bad_request');

  const categories = _getAdminCashCategories_();
  if (!categories.includes(name)) {
    categories.push(name);
    setSetting('ADMIN_CASH_CATEGORIES', JSON.stringify(categories));
  }

  return successResponse({ categories });
}

// ─── ТОВАРИ ───────────────────────────────────────────────────────────────────

function getNewProducts_(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTS);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return successResponse({ products: [], synced_at: nowISO() });
  const [hdr, ...rows] = data;
  const iId = hdr.indexOf('ID_Товару');
  const products = rows
    .filter(r => String(r[iId]).startsWith('local_'))
    .map(r => normalizeProductRow_(hdr, r));
  return successResponse({ products, synced_at: nowISO() });
}

function updateProduct_(payload) {
  const product = payload.product;
  if (!product || !product.id) return errorResponse("product.id обов'язковий", 'bad_request');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PRODUCTS);
  const data  = sheet.getDataRange().getValues();
  const hdr   = data[0];
  const iId   = hdr.indexOf('ID_Товару');
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iId]) === String(product.id)) { rowIndex = i + 1; break; }
  }
  if (rowIndex < 0) return errorResponse('Товар не знайдено: ' + product.id, 'not_found');
  const updates = {
    'Ціна_Закупки':    product.purchase_price,
    'МРЦ_Закон':       product.mrc,
    'Обʼєм_Літрів':    product.volume_l,
    'Фортеця_Градусів': product.strength,
    'Група':           product.group,
    'Дата_Оновлення':  new Date(),
  };
  for (const [colName, val] of Object.entries(updates)) {
    if (val === undefined || val === null) continue;
    const idx = hdr.indexOf(colName);
    if (idx >= 0) sheet.getRange(rowIndex, idx + 1).setValue(val);
  }
  logOperation({ type: 'update_product', status: 'ok', user: 'admin', error: 'id:' + product.id });
  return successResponse({ updated: true });
}

// ─── ІНВЕНТАРИЗАЦІЯ ───────────────────────────────────────────────────────────

function getInventories_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const invData = ss.getSheetByName(SHEET_INVENTORY).getDataRange().getValues();
  if (invData.length <= 1) return successResponse({ inventories: [], synced_at: nowISO() });
  const prodData = ss.getSheetByName(SHEET_PRODUCTS).getDataRange().getValues();
  const [invHdr, ...invRows] = invData;
  const [prodHdr, ...prodRows] = prodData;

  const iStatus  = invHdr.indexOf('Статус');
  const iShift   = invHdr.indexOf('Зміна_ID');
  const iShop    = invHdr.indexOf('Магазин_ID');
  const iDate    = invHdr.indexOf('Дата');
  const iProdId  = invHdr.indexOf('ID_Товару');
  const iBarcode = invHdr.indexOf('Штрихкод');
  const iName    = invHdr.indexOf('Назва');
  const iCounted = invHdr.indexOf('Пораховано_Факт');

  const piId    = prodHdr.indexOf('ID_Товару');
  const piStock = prodHdr.indexOf('Залишок');
  const stockMap = {};
  for (const r of prodRows) stockMap[String(r[piId] || '')] = Number(r[piStock]) || 0;

  const groups = {};
  for (const row of invRows) {
    if (String(row[iStatus]) !== 'Завершена') continue;
    const shiftId = String(row[iShift] || '');
    if (!shiftId) continue;
    if (!groups[shiftId]) {
      groups[shiftId] = {
        shift_id:  shiftId,
        shop_id:   String(row[iShop] || ''),
        timestamp: _toISOStr_(iDate >= 0 ? row[iDate] : null),
        items:     [],
      };
    }
    const productId = String(row[iProdId] || '');
    groups[shiftId].items.push({
      product_id:     productId,
      barcode:        iBarcode >= 0 ? String(row[iBarcode] || '') : '',
      name:           iName    >= 0 ? String(row[iName]    || '') : '',
      actual_count:   Number(row[iCounted]) || 0,
      expected_stock: stockMap[productId] ?? null,
    });
  }
  return successResponse({ inventories: Object.values(groups), synced_at: nowISO() });
}

// ─── ВИТРАТИ ─────────────────────────────────────────────────────────────────

function getPendingExpenses_(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXPENSES);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return successResponse({ expenses: [], synced_at: nowISO() });
  const [hdr, ...rows] = data;
  const iStatus = hdr.indexOf('Статус_Підтвердження');
  const iUuid   = hdr.indexOf('UUID_Операції');
  const iShop   = hdr.indexOf('Магазин_ID');
  const iDate   = hdr.indexOf('Дата');
  const iCat    = hdr.indexOf('Категорія_Витрати');
  const iDesc   = hdr.indexOf('Призначення');
  const iSum    = hdr.indexOf('Сума');
  const iSeller = hdr.indexOf('Продавець');
  const expenses = rows
    .filter(r => String(r[iStatus]) === 'Очікує')
    .map(r => ({
      uuid:        String(r[iUuid]   || ''),
      shop_id:     String(r[iShop]   || ''),
      timestamp:   _toISOStr_(r[iDate]),
      category:    String(r[iCat]    || ''),
      amount:      Number(r[iSum])   || 0,
      description: String(r[iDesc]   || ''),
      employee:    String(r[iSeller] || ''),
    }));
  return successResponse({ expenses, synced_at: nowISO() });
}

function approveExpense_(payload) {
  if (!payload.uuid) return errorResponse("uuid обов'язковий", 'bad_request');
  return _setExpenseStatus_(payload.uuid, 'Підтверджено');
}

function rejectExpense_(payload) {
  if (!payload.uuid) return errorResponse("uuid обов'язковий", 'bad_request');
  return _setExpenseStatus_(payload.uuid, 'Відхилено');
}

function _setExpenseStatus_(uuid, newStatus) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXPENSES);
  const data  = sheet.getDataRange().getValues();
  const hdr   = data[0];
  const iUuid   = hdr.indexOf('UUID_Операції');
  const iStatus = hdr.indexOf('Статус_Підтвердження');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iUuid]) === String(uuid)) {
      sheet.getRange(i + 1, iStatus + 1).setValue(newStatus);
      const opType = newStatus === 'Підтверджено' ? 'approve_expense' : 'reject_expense';
      logOperation({ type: opType, status: 'ok', user: 'admin', error: uuid });
      return successResponse({ updated: true, uuid, status: newStatus });
    }
  }
  return errorResponse('Витрату не знайдено: ' + uuid, 'not_found');
}

// ─── ЗАРПЛАТА ─────────────────────────────────────────────────────────────────

function getSalary_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const empData = ss.getSheetByName(SHEET_EMPLOYEES).getDataRange().getValues();
  const [empHdr, ...empRows] = empData;
  const ePin  = empHdr.indexOf('ПІН_Код');
  const eName = empHdr.indexOf('Імʼя_Продавця');
  const eShop = empHdr.indexOf('Магазин_ID');
  const empMap = {};
  for (const r of empRows) {
    const name = String(r[eName] || '');
    if (name) empMap[name] = { pin_hash: String(r[ePin] || ''), shop_id: String(r[eShop] || '') };
  }

  const payData = ss.getSheetByName(SHEET_PAYROLL).getDataRange().getValues();
  if (payData.length <= 1) return successResponse({ employees: [], synced_at: nowISO() });
  const [payHdr, ...payRows] = payData;
  const pName  = payHdr.indexOf('Імʼя_Співробітника');
  const pShop  = payHdr.indexOf('Магазин_ID');
  const pRate  = payHdr.indexOf('Нараховано_Ставка');
  const pPct   = payHdr.indexOf('Нараховано_Відсоток');
  const pTotal = payHdr.indexOf('Разом_Нараховано');
  const pPaid  = payHdr.indexOf('Виплачено');
  const pShift = payHdr.indexOf('Зміна_ID');

  const agg = {};
  for (const r of payRows) {
    const name = String(r[pName] || '');
    if (!name) continue;
    if (!agg[name]) agg[name] = { rate_earned: 0, pct_earned: 0, total_earned: 0, total_paid: 0, shifts_count: 0, shop_id: String(r[pShop] || '') };
    agg[name].rate_earned  += Number(r[pRate])  || 0;
    agg[name].pct_earned   += Number(r[pPct])   || 0;
    agg[name].total_earned += Number(r[pTotal]) || 0;
    agg[name].total_paid   += Number(r[pPaid])  || 0;
    const shiftId = String(r[pShift] || '');
    if (shiftId && shiftId !== 'payment') agg[name].shifts_count++;
  }

  const employees = Object.entries(agg).map(([name, d]) => ({
    name,
    shop_id:      empMap[name]?.shop_id  ?? d.shop_id,
    pin_hash:     empMap[name]?.pin_hash ?? '',
    shifts_count: d.shifts_count,
    rate_earned:  d.rate_earned,
    pct_earned:   d.pct_earned,
    total_earned: d.total_earned,
    total_paid:   d.total_paid,
    debt:         Math.max(0, d.total_earned - d.total_paid),
  }));
  return successResponse({ employees, synced_at: nowISO() });
}

function salaryPayment_(payload) {
  const { pin_hash, amount, employee } = payload;
  if (!pin_hash) return errorResponse("pin_hash обов'язковий", 'bad_request');
  const sum = Number(amount);
  if (!sum || sum <= 0) return errorResponse('amount має бути > 0', 'bad_request');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
  const [empHdr, ...empRows] = empSheet.getDataRange().getValues();
  const ePin  = empHdr.indexOf('ПІН_Код');
  const eName = empHdr.indexOf('Імʼя_Продавця');
  const eShop = empHdr.indexOf('Магазин_ID');
  let empName = employee || '';
  let shopId  = '';
  for (const r of empRows) {
    if (String(r[ePin]) === String(pin_hash)) {
      empName = String(r[eName] || empName);
      shopId  = String(r[eShop] || '');
      break;
    }
  }

  const payrollSheet = ss.getSheetByName(SHEET_PAYROLL);
  payrollSheet.appendRow(buildRow_(payrollSheet, {
    'UUID_Операції':       generateUUID(),
    'Магазин_ID':          shopId,
    'Дата':                new Date(),
    'Імʼя_Співробітника':  empName,
    'Роль':                '',
    'Нараховано_Ставка':   0,
    'Нараховано_Відсоток': 0,
    'Разом_Нараховано':    0,
    'Виплачено':           sum,
    'Залишок_Боргу':       0,
    'Зміна_ID':            'payment',
  }));
  logOperation({ type: 'salary_payment', status: 'ok', user: 'admin', error: empName + ':' + sum });
  return successResponse({ paid: sum, employee: empName });
}

// ─── ПРИВАТНІ ХЕЛПЕРИ ─────────────────────────────────────────────────────────

function normalizeProductRow_(hdr, row) {
  const g = colName => { const i = hdr.indexOf(colName); return i >= 0 ? row[i] : undefined; };
  const d = g('Дата_Оновлення');
  return {
    id:             String(g('ID_Товару')           ?? ''),
    barcode:        String(g('Штрихкод')            ?? ''),
    name:           String(g('Назва')               ?? ''),
    group:          String(g('Група')               ?? ''),
    subgroup:       String(g('Підгрупа')            ?? ''),
    purchase_price: Number(g('Ціна_Закупки'))       || 0,
    sell_price:     Number(g('Ціна_Продажі'))       || 0,
    stock:          Number(g('Залишок'))            || 0,
    volume_l:       Number(g('Обʼєм_Літрів'))       || 0,
    strength:       Number(g('Фортеця_Градусів'))    || 0,
    mrc:            Number(g('МРЦ_Закон'))          || 0,
    active:         g('Активний') === true,
    shop_id:        String(g('Магазин_ID')          ?? ''),
    updated_at:     d instanceof Date ? d.toISOString() : String(d ?? ''),
  };
}

// ─── PRIVATE ──────────────────────────────────────────────────────────────────

function _getAdminCashCategories_() {
  try {
    const raw = getSetting('ADMIN_CASH_CATEGORIES');
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (_) { /* fallback */ }
  return [...DEFAULT_ADMIN_CASH_CATEGORIES_];
}

function _toISOStr_(val) {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string' && val) return val;
  return new Date(0).toISOString();
}
