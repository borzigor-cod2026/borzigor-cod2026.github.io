// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/reports.js — звіти по змінах
//
//  Розбіжність_Готівки (cash_diff) відображається ТІЛЬКИ тут і в dashboard.js.
//  Це ADMIN-ONLY поле — ніколи не передається в cashier PWA і не відображається
//  касиру. Реалізовано окремою функцією _buildDiffCell() для явного маркування.
// ─────────────────────────────────────────────────────────────────────────────

import { apiCall, formatCurrency, formatDate, formatDateTime, el, qs, toast, setLoading, esc, diffBadge } from './utils.js';

const SCREEN_ID = 'screen-reports';

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

export function initReports() {
  const form = qs('#report-filter-form');
  if (!form) return;

  // Встановити дату за замовчуванням: сьогодні
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = qs('#rep-date-from');
  const dateTo   = qs('#rep-date-to');
  if (dateFrom && !dateFrom.value) dateFrom.value = today;
  if (dateTo   && !dateTo.value)   dateTo.value   = today;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    await _loadReports();
  });
}

async function _loadReports() {
  const shopId   = qs('#rep-shop')?.value ?? 'all';
  const dateFrom = qs('#rep-date-from')?.value ?? '';
  const dateTo   = qs('#rep-date-to')?.value   ?? '';

  setLoading(SCREEN_ID, true);
  try {
    const data = await apiCall('get_reports', { shop_id: shopId, date_from: dateFrom, date_to: dateTo });
    _render(data.shifts ?? []);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(SCREEN_ID, false);
  }
}

// ─── РЕНДЕР ЗВІТУ ─────────────────────────────────────────────────────────────

function _render(shifts) {
  const container = qs('#report-container');
  if (!container) return;

  if (shifts.length === 0) {
    container.innerHTML = '<div class="empty-state">Даних за вибраний період немає</div>';
    return;
  }

  container.innerHTML = '';

  // Підсумковий рядок
  const totals = _calcTotals(shifts);
  container.appendChild(_buildSummaryCard(totals));

  // Таблиця змін
  const wrap  = el('div', 'table-wrap');
  const table = el('table', 'report-table');

  table.innerHTML = `
    <thead>
      <tr>
        <th>Дата / Касир</th>
        <th class="text-right">Виручка</th>
        <th class="text-right">Готівка</th>
        <th class="text-right">Картка</th>
        <th class="text-right">Витрати</th>
        <th class="text-right">Зарплата</th>
        <th class="text-right">Прибуток</th>
        <th class="text-right">Розбіжність</th>
      </tr>
    </thead>`;

  const tbody = el('tbody');
  shifts.forEach(shift => tbody.appendChild(_buildShiftRow(shift)));
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function _buildShiftRow(shift) {
  const tr = el('tr');

  // ── Розбіжність_Готівки ─────────────────────────────────────────────────
  //
  //  ADMIN-ONLY: відображається лише в адмін-панелі.
  //  Формула: cash_blind (введено касиром) - cash_expected (розраховано системою).
  //  Ніколи не надсилається в cashier PWA і не відображається на екранах касира.
  //
  const diffCell = _buildCashDiffCell(shift.cash_diff);

  tr.innerHTML = `
    <td>
      <div class="fw-600">${formatDate(shift.opened_at)}</div>
      <div class="text-sm text-muted">${esc(shift.cashier ?? '')}</div>
      <div class="text-xs text-muted">${esc(shift.shop_id === 'shop_1' ? 'Магазин №1' : 'Магазин №2')}</div>
    </td>
    <td class="text-right fw-700">${formatCurrency(shift.revenue    ?? 0)}</td>
    <td class="text-right">${formatCurrency(shift.cash      ?? 0)}</td>
    <td class="text-right">${formatCurrency(shift.card      ?? 0)}</td>
    <td class="text-right text-warning">${formatCurrency(shift.expenses  ?? 0)}</td>
    <td class="text-right">${formatCurrency(shift.salary    ?? 0)}</td>
    <td class="text-right text-success fw-700">${formatCurrency(shift.profit ?? 0)}</td>`;

  tr.appendChild(diffCell);
  return tr;
}

// Розбіжність_Готівки — виділена окремою функцією для явного маркування ADMIN-ONLY
function _buildCashDiffCell(cashDiff) {
  const td = el('td', 'text-right');
  if (cashDiff !== undefined && cashDiff !== null) {
    td.appendChild(diffBadge(cashDiff));
  } else {
    td.textContent = '—';
  }
  return td;
}

function _buildSummaryCard(totals) {
  const card = el('div', 'kpi-summary card');
  card.innerHTML = `
    <div class="kpi-row">
      <span class="kpi-label">Виручка (всього)</span>
      <span class="kpi-value fw-700">${formatCurrency(totals.revenue)}</span>
    </div>
    <div class="kpi-row">
      <span class="kpi-label">Готівка</span>
      <span class="kpi-value">${formatCurrency(totals.cash)}</span>
    </div>
    <div class="kpi-row">
      <span class="kpi-label">Картка</span>
      <span class="kpi-value">${formatCurrency(totals.card)}</span>
    </div>
    <div class="kpi-row">
      <span class="kpi-label">Витрати</span>
      <span class="kpi-value text-warning">${formatCurrency(totals.expenses)}</span>
    </div>
    <div class="kpi-row">
      <span class="kpi-label">Зарплата</span>
      <span class="kpi-value">${formatCurrency(totals.salary)}</span>
    </div>
    <div class="kpi-row">
      <span class="kpi-label">Прибуток</span>
      <span class="kpi-value text-success fw-700">${formatCurrency(totals.profit)}</span>
    </div>`;
  return card;
}

function _calcTotals(shifts) {
  return shifts.reduce((acc, s) => ({
    revenue:  acc.revenue  + (s.revenue  ?? 0),
    cash:     acc.cash     + (s.cash     ?? 0),
    card:     acc.card     + (s.card     ?? 0),
    expenses: acc.expenses + (s.expenses ?? 0),
    salary:   acc.salary   + (s.salary   ?? 0),
    profit:   acc.profit   + (s.profit   ?? 0),
  }), { revenue: 0, cash: 0, card: 0, expenses: 0, salary: 0, profit: 0 });
}
