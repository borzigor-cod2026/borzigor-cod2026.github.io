// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/cash.js — каса адміністратора
//
//  Перезавантажує дані при кожному показі екрану (як dashboard/reports).
//  Форма та кнопка "+" ініціалізуються один раз.
// ─────────────────────────────────────────────────────────────────────────────

import { apiCall, formatCurrency, formatDateTime, el, qs, toast, setLoading, esc } from './utils.js';

const SCREEN_ID = 'screen-cash';

let _categories        = [];
let _formInited        = false;
let _expenseFormInited = false;

// ─── ТОЧКА ВХОДУ ──────────────────────────────────────────────────────────────

export async function initCash() {
  setLoading(SCREEN_ID, true);
  try {
    const data = await apiCall('get_admin_cash');
    _categories = data.categories ?? [];
    _renderBalance(data.balance ?? 0);
    _populateCategorySelect();
    // Показуємо журнал від новіших до старіших
    _renderHistory([...(data.entries ?? [])].reverse());
    _renderAdminExpenses(data.entries ?? []);

    if (!_formInited) {
      _initForm();
      _initAddCategory();
      _formInited = true;
    }
    if (!_expenseFormInited) {
      _initExpenseForm();
      _expenseFormInited = true;
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(SCREEN_ID, false);
  }
}

// ─── БАЛАНС ───────────────────────────────────────────────────────────────────

function _renderBalance(balance) {
  const block = qs('#cash-balance');
  if (!block) return;
  block.textContent = formatCurrency(balance);
  block.className = 'cash-balance ' +
    (balance > 0 ? 'cash-balance--positive' : balance < 0 ? 'cash-balance--negative' : '');
}

// ─── КАТЕГОРІЇ ────────────────────────────────────────────────────────────────

function _populateCategorySelect() {
  const sel = qs('#cash-category');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = _categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (_categories.includes(prev)) sel.value = prev;
}

// ─── ЖУРНАЛ ───────────────────────────────────────────────────────────────────

function _renderHistory(entries) {
  const hist = qs('#cash-history');
  if (!hist) return;

  if (!entries.length) {
    hist.innerHTML = '<div class="empty-state">Операцій ще немає</div>';
    return;
  }

  hist.innerHTML = '';
  entries.forEach(e => hist.appendChild(_buildCard(e)));
}

function _buildCard(e) {
  const isIncome = e.type === 'Прихід';
  const card     = el('div', 'list-card');

  const sourceLabel = e.source === 'expense_inkasatsia' ? ' · Інкасація' : '';
  const sign        = isIncome ? '+' : '−';
  const amtCls      = isIncome ? 'text-success' : 'text-danger';
  const badgeCls    = isIncome ? 'badge--success' : 'badge--danger';

  card.innerHTML = `
    <div class="list-card__header">
      <span class="badge ${badgeCls}">${esc(e.type)}</span>
      <span class="text-muted text-sm">${esc(e.shop)}${esc(sourceLabel)}</span>
      <span class="list-card__time text-muted text-sm">${formatDateTime(e.date)}</span>
    </div>
    <div class="list-card__body">
      <div class="list-card__title">${esc(e.category)}</div>
      ${e.description ? `<div class="list-card__desc text-muted text-sm">${esc(e.description)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <span class="${amtCls} fw-700" style="font-size:1.05rem">${sign}${formatCurrency(e.amount)}</span>
        <span class="text-muted text-sm">Баланс: ${formatCurrency(e.balance)}</span>
      </div>
    </div>`;

  return card;
}

// ─── ФОРМА ЗАПИСУ ─────────────────────────────────────────────────────────────

function _initForm() {
  const form = qs('#cash-entry-form');
  if (!form) return;

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn    = form.querySelector('[type="submit"]');
    const amount = parseFloat(qs('#cash-amount')?.value);

    if (!amount || amount <= 0) {
      toast('Введіть суму більше 0', 'error');
      return;
    }

    btn.disabled = true;
    try {
      await apiCall('create_admin_cash_entry', {
        type:           qs('#cash-type')?.value,
        amount,
        payment_method: qs('#cash-payment')?.value,
        shop:           qs('#cash-shop')?.value,
        category:       qs('#cash-category')?.value,
        description:    qs('#cash-desc')?.value.trim(),
      });
      toast('Операцію записано', 'success');
      qs('#cash-amount').value = '';
      qs('#cash-desc').value   = '';
      await initCash();   // перезавантажити баланс + журнал
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// ─── АДМІН ВИТРАТИ ────────────────────────────────────────────────────────────

function _initExpenseForm() {
  const dateInput = qs('#exp-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  const form = qs('#admin-expense-form');
  if (!form) return;

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn    = form.querySelector('[type="submit"]');
    const amount = parseFloat(qs('#exp-amount')?.value);

    if (!amount || amount <= 0) {
      toast('Введіть суму більше 0', 'error');
      return;
    }

    btn.disabled = true;
    try {
      await apiCall('create_admin_cash_entry', {
        type:        'expense',
        date:        qs('#exp-date')?.value,
        amount,
        category:    qs('#exp-category')?.value,
        shop_id:     qs('#exp-shop')?.value,
        description: qs('#exp-desc')?.value.trim(),
      });
      toast('Витрату записано', 'success');
      qs('#exp-amount').value = '';
      qs('#exp-desc').value   = '';
      await initCash();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function _renderAdminExpenses(entries) {
  const list = qs('#admin-expense-list');
  if (!list) return;

  const expenses = [...entries]
    .filter(e => e.type === 'Витрата' && e.source === 'admin_cash')
    .slice(-50)
    .reverse();

  if (!expenses.length) {
    list.innerHTML = '<div class="empty-state">Витрат ще немає</div>';
    return;
  }

  list.innerHTML = '';
  expenses.forEach(e => {
    const card = el('div', 'list-card');
    card.innerHTML = `
      <div class="list-card__header">
        <span class="badge badge--danger">Витрата</span>
        <span class="text-muted text-sm">${esc(e.shop)}</span>
        <span class="list-card__time text-muted text-sm">${formatDateTime(e.date)}</span>
      </div>
      <div class="list-card__body">
        <div class="list-card__title">${esc(e.category)}</div>
        ${e.description ? `<div class="list-card__desc text-muted text-sm">${esc(e.description)}</div>` : ''}
        <div style="margin-top:6px">
          <span class="text-danger fw-700" style="font-size:1.05rem">−${formatCurrency(e.amount)}</span>
        </div>
      </div>`;
    list.appendChild(card);
  });
}

// ─── ДОДАТИ КАТЕГОРІЮ ─────────────────────────────────────────────────────────

function _initAddCategory() {
  const btn = qs('#btn-add-cash-category');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const name = prompt('Назва нової категорії:');
    if (!name?.trim()) return;

    btn.disabled = true;
    try {
      const data = await apiCall('add_admin_cash_category', { category: name.trim() });
      _categories = data.categories ?? _categories;
      _populateCategorySelect();
      qs('#cash-category').value = name.trim();
      toast(`Категорію "${name.trim()}" додано`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}
