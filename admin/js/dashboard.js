// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/dashboard.js — зведення: алерти + KPI сьогодні
//
//  Розбіжність_Готівки (cash_diff) відображається ТІЛЬКИ тут і в reports.js.
//  Ніколи не передається в cashier PWA.
// ─────────────────────────────────────────────────────────────────────────────

import { apiCall, formatCurrency, formatDateTime, el, qs, toast, setLoading, diffBadge } from './utils.js';

const SCREEN_ID = 'screen-dashboard';

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

export async function initDashboard() {
  setLoading(SCREEN_ID, true);
  try {
    const data = await apiCall('get_dashboard');
    _renderAlerts(data.alerts       ?? []);
    _renderKPI   (data.kpi_today);
  } catch (err) {
    toast(err.message, 'error');
    qs(`#${SCREEN_ID} .dash-content`)?.replaceChildren(
      _errorCard(err.message)
    );
  } finally {
    setLoading(SCREEN_ID, false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  АЛЕРТИ
//
//  Алерти завантажуються з GAS. Секція відображається ТІЛЬКИ якщо є хоча б
//  один алерт. Кожен тип має свій текст і колір.
//
//  Типи алертів:
//  - low_stock          → red    «Від'ємний залишок»
//  - pending_expenses   → amber  «Витрати на затвердження»
//  - energy_limit       → amber  «Перевищено ліміт електроенергії»
//  - salary_debt        → amber  «Борг по зарплаті»
//  - mrc_outdated       → amber  «МРЦ не оновлювалось N днів»
//  - new_products       → amber  «Нові товари від касира»
// ─────────────────────────────────────────────────────────────────────────────

const ALERT_CFG = {
  low_stock:        { cls: 'alert-card--danger',  label: a => `Від'ємний залишок: ${a.count} позицій`                              },
  pending_expenses: { cls: 'alert-card--warning', label: a => `Витрати на затвердження: ${a.count}`                                },
  energy_limit:     { cls: 'alert-card--warning', label: a => `Ліміт електроенергії перевищено: ${a.used_kwh} кВт·год`             },
  salary_debt:      { cls: 'alert-card--warning', label: a => `Борг по зарплаті: ${formatCurrency(a.amount)}`                      },
  mrc_outdated:     { cls: 'alert-card--warning', label: a => `МРЦ не оновлювалось ${a.days_since_update} днів: ${a.count} товарів` },
  new_products:     { cls: 'alert-card--warning', label: a => `Нові товари від касира: ${a.count}`                                 },
};

function _renderAlerts(alerts) {
  const section = qs('#dash-alerts');
  if (!section) return;

  if (alerts.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  const list = qs('#dash-alert-list');
  if (!list) return;

  list.innerHTML = '';
  alerts.forEach(a => {
    const cfg  = ALERT_CFG[a.type];
    if (!cfg) return;
    const card = el('div', `alert-card ${cfg.cls}`);
    card.textContent = cfg.label(a);
    list.appendChild(card);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  KPI СЬОГОДНІ
//
//  Верхній рядок: загальна виручка + прибуток обох магазинів.
//  Далі: по кожному магазину — виручка, готівка, картка, витрати, прибуток,
//        ім'я касира, і ТІЛЬКИ ДЛЯ АДМІНА — Розбіжність_Готівки (cash_diff).
// ─────────────────────────────────────────────────────────────────────────────

function _renderKPI(kpi) {
  const container = qs('#dash-kpi');
  if (!container || !kpi) return;
  container.innerHTML = '';

  // Загальний підсумок
  const summary = el('div', 'kpi-summary card');
  summary.innerHTML = `
    <div class="kpi-row">
      <span class="kpi-label">Виручка обох магазинів</span>
      <span class="kpi-value kpi-value--main">${formatCurrency(kpi.total_revenue ?? 0)}</span>
    </div>
    <div class="kpi-row">
      <span class="kpi-label">Чистий прибуток</span>
      <span class="kpi-value kpi-value--profit">${formatCurrency(kpi.net_profit ?? 0)}</span>
    </div>`;
  container.appendChild(summary);

  // По кожному магазину
  (kpi.shops ?? []).forEach(shop => {
    const card = el('div', 'shop-kpi-card card');

    const cashierLine = shop.cashier
      ? `<div class="kpi-row"><span class="kpi-label">Касир</span><span class="kpi-value text-sm">${shop.cashier}</span></div>`
      : '';

    // ── Розбіжність_Готівки ────────────────────────────────────────────────
    // Показується ТІЛЬКИ в адмін-панелі. Ніколи не передається касиру.
    const diffRow = _buildCashDiffRow(shop.cash_diff);

    card.innerHTML = `
      <div class="shop-kpi-header">${shop.name ?? shop.shop_id}</div>
      <div class="kpi-row">
        <span class="kpi-label">Виручка</span>
        <span class="kpi-value fw-700">${formatCurrency(shop.revenue ?? 0)}</span>
      </div>
      <div class="kpi-row">
        <span class="kpi-label">Готівка</span>
        <span class="kpi-value">${formatCurrency(shop.cash ?? 0)}</span>
      </div>
      <div class="kpi-row">
        <span class="kpi-label">Картка</span>
        <span class="kpi-value">${formatCurrency(shop.card ?? 0)}</span>
      </div>
      <div class="kpi-row">
        <span class="kpi-label">Витрати</span>
        <span class="kpi-value text-warning">${formatCurrency(shop.expenses ?? 0)}</span>
      </div>
      <div class="kpi-row">
        <span class="kpi-label">Прибуток</span>
        <span class="kpi-value text-success fw-700">${formatCurrency(shop.profit ?? 0)}</span>
      </div>
      ${cashierLine}`;

    // Вставляємо рядок розбіжності готівки після побудови card
    if (diffRow) card.appendChild(diffRow);

    container.appendChild(card);
  });
}

// Розбіжність_Готівки — окрема функція щоб підкреслити що це ADMIN-ONLY поле
function _buildCashDiffRow(cashDiff) {
  if (cashDiff === undefined || cashDiff === null) return null;
  const row  = el('div', 'kpi-row kpi-row--diff');
  const lbl  = el('span', 'kpi-label', 'Розбіжність готівки');
  row.append(lbl, diffBadge(cashDiff));
  return row;
}

function _errorCard(msg) {
  const d = el('div', 'alert-card alert-card--danger');
  d.textContent = `Помилка завантаження: ${msg}`;
  return d;
}
