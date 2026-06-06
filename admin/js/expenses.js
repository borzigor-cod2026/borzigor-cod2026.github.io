// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/expenses.js — затвердження / відхилення витрат касирів
// ─────────────────────────────────────────────────────────────────────────────

import { apiCall, formatCurrency, formatDateTime, el, qs, toast, setLoading, esc } from './utils.js';

const SCREEN_ID = 'screen-expenses';

export async function initExpenses() {
  setLoading(SCREEN_ID, true);
  try {
    const data = await apiCall('get_pending_expenses');
    _render(data.expenses ?? []);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(SCREEN_ID, false);
  }
}

function _render(expenses) {
  const list = qs('#expenses-list');
  if (!list) return;

  if (expenses.length === 0) {
    list.innerHTML = '<div class="empty-state">Немає витрат на затвердження</div>';
    return;
  }

  list.innerHTML = '';
  expenses.forEach(exp => list.appendChild(_buildRow(exp)));
}

function _buildRow(exp) {
  const card = el('div', 'list-card');
  card.dataset.uuid = exp.uuid;

  card.innerHTML = `
    <div class="list-card__header">
      <span class="badge badge--neutral">${esc(exp.shop_id === 'SHOP_1' ? 'Магазин №1' : 'Магазин №2')}</span>
      <span class="list-card__time text-muted text-sm">${formatDateTime(exp.timestamp)}</span>
    </div>
    <div class="list-card__body">
      <div class="list-card__title">${esc(exp.category)}</div>
      <div class="list-card__amount fw-700">${formatCurrency(exp.amount)}</div>
      ${exp.description ? `<div class="list-card__desc text-muted text-sm">${esc(exp.description)}</div>` : ''}
      <div class="text-sm text-muted">${esc(exp.employee)}</div>
    </div>
    <div class="list-card__actions">
      <button class="btn btn--danger  btn--compact js-reject"  data-uuid="${esc(exp.uuid)}">Відхилити</button>
      <button class="btn btn--success btn--compact js-confirm" data-uuid="${esc(exp.uuid)}">Підтвердити</button>
    </div>`;

  card.querySelector('.js-reject') .addEventListener('click', () => _act(exp.uuid, 'reject',  card));
  card.querySelector('.js-confirm').addEventListener('click', () => _act(exp.uuid, 'confirm', card));

  return card;
}

async function _act(uuid, action, card) {
  const type = action === 'confirm' ? 'approve_expense' : 'reject_expense';
  try {
    card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    await apiCall(type, { uuid });
    card.classList.add(action === 'confirm' ? 'list-card--done' : 'list-card--rejected');
    setTimeout(() => card.remove(), 600);
    toast(action === 'confirm' ? 'Витрату підтверджено' : 'Витрату відхилено',
          action === 'confirm' ? 'success' : 'warning');
  } catch (err) {
    card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    toast(err.message, 'error');
  }
}
