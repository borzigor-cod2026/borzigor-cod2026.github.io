// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/salary.js — перегляд і виплата зарплати
// ─────────────────────────────────────────────────────────────────────────────

import { apiCall, formatCurrency, el, qs, toast, setLoading, esc } from './utils.js';

const SCREEN_ID = 'screen-salary';

export async function initSalary() {
  setLoading(SCREEN_ID, true);
  try {
    const data = await apiCall('get_salary');
    _render(data.employees ?? []);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(SCREEN_ID, false);
  }
}

function _render(employees) {
  const list = qs('#salary-list');
  if (!list) return;

  if (employees.length === 0) {
    list.innerHTML = '<div class="empty-state">Немає даних по зарплаті</div>';
    return;
  }

  list.innerHTML = '';
  employees.forEach(emp => list.appendChild(_buildCard(emp)));
}

function _buildCard(emp) {
  const card = el('div', 'list-card salary-card');
  card.dataset.pinHash = emp.pin_hash;

  const shopName = emp.shop_id === 'shop_1' ? 'Магазин №1' : 'Магазин №2';
  const debtCls  = (emp.debt ?? 0) > 0 ? 'text-danger fw-700' : 'text-success';

  card.innerHTML = `
    <div class="list-card__header">
      <span class="salary-name fw-700">${esc(emp.name)}</span>
      <span class="badge badge--neutral">${esc(shopName)}</span>
    </div>
    <div class="salary-grid">
      <div class="salary-row">
        <span class="kpi-label">Змін відпрацьовано</span>
        <span class="kpi-value">${emp.shifts_count ?? 0}</span>
      </div>
      <div class="salary-row">
        <span class="kpi-label">Ставка</span>
        <span class="kpi-value">${formatCurrency(emp.rate_earned ?? 0)}</span>
      </div>
      <div class="salary-row">
        <span class="kpi-label">Відсоток</span>
        <span class="kpi-value">${formatCurrency(emp.pct_earned ?? 0)}</span>
      </div>
      <div class="salary-row">
        <span class="kpi-label">Нараховано</span>
        <span class="kpi-value fw-700">${formatCurrency(emp.total_earned ?? 0)}</span>
      </div>
      <div class="salary-row">
        <span class="kpi-label">Виплачено</span>
        <span class="kpi-value">${formatCurrency(emp.total_paid ?? 0)}</span>
      </div>
      <div class="salary-row">
        <span class="kpi-label">Борг</span>
        <span class="kpi-value ${debtCls}">${formatCurrency(emp.debt ?? 0)}</span>
      </div>
    </div>`;

  // Форма виплати (показується якщо є борг)
  if ((emp.debt ?? 0) > 0) {
    card.appendChild(_buildPayForm(emp));
  }

  return card;
}

function _buildPayForm(emp) {
  const wrap = el('div', 'salary-pay-form');
  wrap.innerHTML = `
    <input
      class="form-input"
      type="number"
      min="0.01"
      step="0.01"
      max="${emp.debt}"
      placeholder="Сума виплати"
      inputmode="decimal"
      aria-label="Сума виплати ${esc(emp.name)}">
    <button class="btn btn--primary btn--compact js-pay">Виплатити</button>`;

  const inp = wrap.querySelector('input');
  const btn = wrap.querySelector('.js-pay');

  btn.addEventListener('click', async () => {
    const amount = parseFloat(inp.value);
    if (!amount || amount <= 0) return;
    btn.disabled = true;
    try {
      await apiCall('salary_payment', {
        pin_hash: emp.pin_hash,
        amount,
        employee: emp.name,
      });
      toast(`Виплачено ${formatCurrency(amount)} — ${emp.name}`, 'success');
      // Перезавантажити список після виплати
      await initSalary();
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  });

  return wrap;
}
