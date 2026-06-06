// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/inventory.js — затвердження результатів інвентаризації
// ─────────────────────────────────────────────────────────────────────────────

import { apiCall, formatDateTime, el, qs, toast, setLoading, esc } from './utils.js';

const SCREEN_ID = 'screen-inventory';

export async function initInventory() {
  setLoading(SCREEN_ID, true);
  try {
    const data = await apiCall('get_inventories');
    _render(data.inventories ?? []);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(SCREEN_ID, false);
  }
}

function _render(inventories) {
  const container = qs('#inventory-list');
  if (!container) return;

  if (inventories.length === 0) {
    container.innerHTML = '<div class="empty-state">Немає інвентаризацій для затвердження</div>';
    return;
  }

  container.innerHTML = '';
  inventories.forEach(inv => container.appendChild(_buildCard(inv)));
}

function _buildCard(inv) {
  const shopName = inv.shop_id === 'SHOP_1' ? 'Магазин №1' : 'Магазин №2';
  const card     = el('div', 'list-card');
  card.dataset.shiftId = inv.shift_id;

  // Заголовок картки
  const header = el('div', 'list-card__header');
  header.innerHTML = `
    <span class="badge badge--neutral">${esc(shopName)}</span>
    <span class="text-muted text-sm">${formatDateTime(inv.timestamp)}</span>`;
  card.appendChild(header);

  // Таблиця позицій
  const table = el('table', 'inv-table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Товар</th>
        <th class="text-right">Очікувано</th>
        <th class="text-right">Факт</th>
        <th class="text-right">Різниця</th>
      </tr>
    </thead>`;

  const tbody = el('tbody');
  (inv.items ?? []).forEach(item => {
    const diff  = (item.actual_count ?? 0) - (item.expected_stock ?? 0);
    const cls   = diff < 0 ? 'text-danger fw-bold' : diff > 0 ? 'text-warning' : '';
    const sign  = diff > 0 ? '+' : '';
    const tr    = el('tr');
    tr.innerHTML = `
      <td>${esc(item.name)}</td>
      <td class="text-right">${item.expected_stock ?? '—'}</td>
      <td class="text-right">${item.actual_count   ?? '—'}</td>
      <td class="text-right ${cls}">${sign}${diff}</td>`;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  card.appendChild(table);

  // Кнопка затвердження
  const actions = el('div', 'list-card__actions');
  const btn     = el('button', 'btn btn--primary btn--full', 'Затвердити');
  btn.addEventListener('click', () => _approve(inv.shift_id, card));
  actions.appendChild(btn);
  card.appendChild(actions);

  return card;
}

async function _approve(shiftId, card) {
  const btn = card.querySelector('button');
  if (btn) btn.disabled = true;
  try {
    await apiCall('approve_inventory', { shift_id: shiftId });
    card.classList.add('list-card--done');
    setTimeout(() => card.remove(), 600);
    toast('Інвентаризацію затверджено', 'success');
  } catch (err) {
    if (btn) btn.disabled = false;
    toast(err.message, 'error');
  }
}
