// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/products.js — управління товарами та нові товари від касира
// ─────────────────────────────────────────────────────────────────────────────

import { PRODUCT_GROUPS }   from '../../shared/constants.js';
import { apiCall, formatCurrency, el, qs, toast, setLoading, esc } from './utils.js';

const SCREEN_ID   = 'screen-products';

let _allProducts  = [];
let _newProducts  = [];

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

export async function initProducts() {
  setLoading(SCREEN_ID, true);
  try {
    const [newRes, allRes] = await Promise.all([
      apiCall('get_new_products'),
      apiCall('get_products', { shop_id: 'all' }),
    ]);
    _newProducts = newRes.products  ?? [];
    _allProducts = allRes.products  ?? [];

    _renderNewProducts(_newProducts);
    _renderProductList(_allProducts);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(SCREEN_ID, false);
  }

  // Пошук
  qs('#product-search')?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    _renderProductList(q
      ? _allProducts.filter(p =>
          p.name.toLowerCase().includes(q) || String(p.barcode).includes(q))
      : _allProducts
    );
  });
}

// ─── НОВІ ТОВАРИ ВІД КАСИРА ───────────────────────────────────────────────────

function _renderNewProducts(products) {
  const section = qs('#new-products-section');
  const list    = qs('#new-products-list');
  if (!section || !list) return;

  section.hidden = products.length === 0;
  list.innerHTML = '';
  products.forEach(p => list.appendChild(_buildNewProductCard(p)));
}

function _buildNewProductCard(p) {
  const card = el('div', 'list-card');
  card.dataset.id = p.id;

  card.innerHTML = `
    <div class="list-card__header">
      <span class="badge badge--warning">Новий від касира</span>
      <span class="text-sm text-muted">${esc(p.barcode)}</span>
    </div>
    <div class="list-card__title">${esc(p.name)}</div>
    <div class="text-sm text-muted">${esc(p.group)} / ${esc(p.subgroup ?? '')}</div>
    <div class="fw-700">${formatCurrency(p.sell_price)}</div>`;

  // Форма редагування полів що касир не знає
  const form = _buildEditForm(p, true);
  card.appendChild(form);
  return card;
}

// ─── СПИСОК ВСІХ ТОВАРІВ ─────────────────────────────────────────────────────

function _renderProductList(products) {
  const list = qs('#product-list');
  if (!list) return;

  if (products.length === 0) {
    list.innerHTML = '<div class="empty-state">Товарів не знайдено</div>';
    return;
  }

  list.innerHTML = '';
  products.slice(0, 200).forEach(p => {
    const row = el('div', 'product-row');
    row.innerHTML = `
      <div class="product-row__info">
        <span class="product-row__name">${esc(p.name)}</span>
        <span class="text-xs text-muted">${esc(p.barcode)}</span>
      </div>
      <span class="product-row__price">${formatCurrency(p.sell_price)}</span>
      <button class="btn btn--outline btn--compact js-edit-btn">Ред.</button>`;

    let formVisible = false;
    let formEl = null;

    row.querySelector('.js-edit-btn').addEventListener('click', () => {
      if (formVisible) {
        formEl?.remove();
        formEl = null;
        formVisible = false;
        return;
      }
      formEl = _buildEditForm(p, false);
      row.appendChild(formEl);
      formVisible = true;
    });

    list.appendChild(row);
  });
}

// ─── ФОРМА РЕДАГУВАННЯ ───────────────────────────────────────────────────────

function _buildEditForm(p, showGroupSelect) {
  const form = el('div', 'edit-form');

  const isTobacco = p.group === 'Тютюнові вироби';
  const hasAlcohol = p.group === 'Алкогольні напої' || p.group === 'Пиво та напої';

  form.innerHTML = `
    <div class="edit-grid">
      ${showGroupSelect ? `
      <div class="form-group">
        <label class="form-label">Група</label>
        <select class="form-select ef-group"></select>
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">Ціна закупки, ₴</label>
        <input class="form-input ef-buy" type="number" min="0" step="0.01"
               value="${p.purchase_price || ''}" inputmode="decimal">
      </div>
      <div class="form-group">
        <label class="form-label">МРЦ (закон), ₴</label>
        <input class="form-input ef-mrc" type="number" min="0" step="0.01"
               value="${p.mrc || ''}" inputmode="decimal">
      </div>
      <div class="form-group">
        <label class="form-label">Обʼєм, л</label>
        <input class="form-input ef-vol" type="number" min="0" step="0.001"
               value="${p.volume_l || ''}" inputmode="decimal">
      </div>
      <div class="form-group">
        <label class="form-label">Фортеця, %</label>
        <input class="form-input ef-str" type="number" min="0" step="0.1"
               value="${p.strength || ''}" inputmode="decimal">
      </div>
    </div>
    <button class="btn btn--primary btn--full js-save-product">Зберегти</button>`;

  if (showGroupSelect) {
    const sel = form.querySelector('.ef-group');
    PRODUCT_GROUPS.forEach(g => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = g;
      if (g === p.group) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  form.querySelector('.js-save-product').addEventListener('click', async btn => {
    btn = form.querySelector('.js-save-product');
    btn.disabled = true;
    try {
      const updated = {
        id:             p.id,
        purchase_price: parseFloat(form.querySelector('.ef-buy')?.value) || 0,
        mrc:            parseFloat(form.querySelector('.ef-mrc')?.value) || 0,
        volume_l:       parseFloat(form.querySelector('.ef-vol')?.value) || 0,
        strength:       parseFloat(form.querySelector('.ef-str')?.value) || 0,
      };
      if (showGroupSelect) {
        updated.group = form.querySelector('.ef-group')?.value;
      }
      await apiCall('update_product', { product: updated });
      toast('Товар збережено', 'success');
      // Оновити кеш
      const idx = _allProducts.findIndex(x => x.id === p.id);
      if (idx >= 0) _allProducts[idx] = { ..._allProducts[idx], ...updated };
      if (showGroupSelect) form.closest('.list-card')?.remove();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  return form;
}
