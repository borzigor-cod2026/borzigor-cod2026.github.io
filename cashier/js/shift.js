// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/shift.js — відкриття та закриття зміни
// ─────────────────────────────────────────────────────────────────────────────

import { getShift, saveShift, clearShift, saveOperation } from './db.js';
import { requireAuth }                                     from './auth.js';
import { generateUUID, nowISO, formatCurrency }            from './utils.js';
import { syncPending }                                     from './sync.js';

const SHOPS = [
  { id: 'shop_1', name: 'Магазин №1' },
  { id: 'shop_2', name: 'Магазин №2' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  ВІДКРИТТЯ ЗМІНИ
// ─────────────────────────────────────────────────────────────────────────────

export function initShiftOpen() {
  const sel = document.getElementById('shift-shop');
  SHOPS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = s.name;
    sel.appendChild(opt);
  });

  // Попередньо вибрати магазин касира
  try {
    const session = requireAuth();
    if (session?.shop_id) sel.value = session.shop_id;
  } catch (_) {}

  document.getElementById('form-shift-open')
    .addEventListener('submit', async e => { e.preventDefault(); await _openShift(); });
}

async function _openShift() {
  const shopId = document.getElementById('shift-shop').value;
  const meter  = parseFloat(document.getElementById('shift-meter-start').value);
  if (!shopId || isNaN(meter)) return;

  const session  = requireAuth();
  const shiftUUID = generateUUID();
  const now       = nowISO();

  const shiftRecord = {
    shop_id:      shopId,
    uuid:         shiftUUID,
    opened_at:    now,
    meter_start:  meter,
    employee:     session.name,
    pin_hash:     session.pin_hash,
    daily_rate:   session.daily_rate  ?? 0,
    pct:          session.pct         ?? {},
    sales_cash:   0,
    sales_card:   0,
    group_totals: {},
  };

  await saveShift(shiftRecord);

  await saveOperation({
    uuid:      generateUUID(),
    type:      'open_shift',
    shift_id:  shiftUUID,
    timestamp: now,
    shop_id:   shopId,
    meter:     meter,
    seller:    session.name,
  });

  syncPending();

  const { showScreen } = await import('./app.js');
  showScreen('pos');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ЗАКРИТТЯ ЗМІНИ
//
//  Сліпий ввід готівки (ТЗ 16.2):
//  Касиру НЕ показуємо: очікувану суму, системні підсумки, різницю.
//  Касир рахує фізичну готівку самостійно та вводить суму.
//  Після відправки — показуємо ТІЛЬКИ нараховану зарплату.
// ─────────────────────────────────────────────────────────────────────────────

export async function initShiftClose() {
  // Перевірити що зміна є
  try {
    const session = requireAuth();
    const shift   = await getShift(session.shop_id);
    if (!shift) {
      const { showScreen } = await import('./app.js');
      showScreen('pos');
      return;
    }
    _bindShiftCloseForm(shift);
  } catch (_) {
    const { showScreen } = await import('./app.js');
    showScreen('login');
  }
}

function _bindShiftCloseForm(shift) {
  // Прибираємо старий listener щоб не дублювати при повторному виклику
  const form = document.getElementById('form-shift-close');
  const newForm = form.cloneNode(true);
  form.replaceWith(newForm);

  newForm.addEventListener('submit', async e => {
    e.preventDefault();
    await _closeShift(shift);
  });

  document.getElementById('btn-shift-close-back')
    ?.addEventListener('click', () => import('./app.js').then(m => m.showScreen('pos')));
}

async function _closeShift(shift) {
  const cashBlind = parseFloat(document.getElementById('shift-cash-blind').value);
  const meterEnd  = parseFloat(document.getElementById('shift-meter-end').value);
  if (isNaN(cashBlind) || isNaN(meterEnd)) return;

  const session = requireAuth();
  const now     = nowISO();

  // Розрахунок зарплати тільки для внутрішнього запису
  const salary = _calcSalary(shift);

  await saveOperation({
    uuid:        generateUUID(),
    type:        'close_shift',
    shift_id:    shift.uuid,
    timestamp:   now,
    cash_blind:  cashBlind,
    meter_end:   meterEnd,
    seller:      session.name,
    salary_calc: salary,
    total_cash:  shift.sales_cash ?? 0,
    total_card:  shift.sales_card ?? 0,
  });

  await clearShift(shift.shop_id);
  syncPending();

  _showResult(salary);
}

// ─── Розрахунок зарплати ─────────────────────────────────────────────────────
//  Зарплата = денна ставка + Σ (виручка_по_групі × % / 100)
//  Відображається касиру ОДНИМ рядком — без деталізації по групах.

function _calcSalary(shift) {
  let salary   = shift.daily_rate   ?? 0;
  const gt     = shift.group_totals ?? {};
  const pct    = shift.pct          ?? {};
  for (const [group, total] of Object.entries(gt)) {
    salary += (total * (pct[group] ?? 0)) / 100;
  }
  return Math.round(salary * 100) / 100;
}

function _showResult(salary) {
  document.getElementById('form-shift-close').hidden = true;
  const result = document.getElementById('shift-close-result');
  if (result) {
    result.hidden = false;
    const amtEl = document.getElementById('shift-salary-amount');
    if (amtEl) amtEl.textContent = formatCurrency(salary);
  }
  // «OK» — вийти, дати наступному касиру увійти
  document.getElementById('btn-after-close')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('shift:closed'));
  }, { once: true });
}

// Скинути форму коли знову заходимо на екран закриття зміни
export function resetShiftClose() {
  const form   = document.getElementById('form-shift-close');
  const result = document.getElementById('shift-close-result');
  if (form)   form.hidden   = false;
  if (result) result.hidden = true;
  ['shift-cash-blind', 'shift-meter-end'].forEach(id => {
    const inp = document.getElementById(id);
    if (inp) inp.value = '';
  });
}
