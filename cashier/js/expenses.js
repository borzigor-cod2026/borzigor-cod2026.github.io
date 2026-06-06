// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/expenses.js — форма витрат
// ─────────────────────────────────────────────────────────────────────────────

import { getShift, saveOperation, getSettingValue } from './db.js';
import { requireAuth }             from './auth.js';
import { generateUUID, nowISO, showBanner } from './utils.js';
import { syncPending }             from './sync.js';

const EXPENSE_CATS_FALLBACK = [
  'Господарські витрати',
  'Пакети та пакування',
  'Оренда',
  'Комунальні послуги',
  'Повернення постачальнику',
  'Інше',
];

let _inited = false;

export async function initExpenses() {
  if (_inited) return;
  _inited = true;

  await _populateCategorySelect();

  document.getElementById('form-expenses')
    .addEventListener('submit', async e => { e.preventDefault(); await _submit(); });

  document.getElementById('btn-expenses-back')
    ?.addEventListener('click', () => import('./app.js').then(m => m.showScreen('pos')));
}

async function _populateCategorySelect() {
  let cats = EXPENSE_CATS_FALLBACK;
  try {
    const raw = await getSettingValue('EXPENSE_CATEGORIES');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) cats = parsed;
  } catch (_) { /* Налаштування ще не завантажені — використовуємо fallback */ }

  const sel = document.getElementById('expense-category');
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = c;
    sel.appendChild(opt);
  });
}

async function _submit() {
  const category = document.getElementById('expense-category').value;
  const amount   = parseFloat(document.getElementById('expense-amount').value);
  const desc     = document.getElementById('expense-desc').value.trim();

  if (!amount || amount <= 0) return;

  const session = requireAuth();
  const shift   = await getShift(session.shop_id);

  await saveOperation({
    uuid:        generateUUID(),
    type:        'expense',
    shift_id:    shift?.uuid ?? '',
    timestamp:   nowISO(),
    category,
    amount,
    description: desc,
    seller:      session.name,
  });

  document.getElementById('expense-amount').value = '';
  document.getElementById('expense-desc').value   = '';

  showBanner(`Витрату збережено: ${category}`, 'success');
  syncPending();
}
