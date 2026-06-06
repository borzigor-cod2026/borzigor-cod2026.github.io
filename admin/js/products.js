// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/products.js — управління товарами та нові товари від касира
// ─────────────────────────────────────────────────────────────────────────────

import { PRODUCT_GROUPS }   from '../../shared/constants.js';
import { apiCall, formatCurrency, el, qs, toast, setLoading, esc } from './utils.js';

const SCREEN_ID = 'screen-products';

// HID detection — same algorithm as cashier/js/scanner.js, camera-free
const HID_SPEED_THRESH = 20;  // chars/s
const HID_MIN_LEN      = 4;
const HID_FLUSH_MS     = 80;

let _allProducts = [];
let _newProducts = [];
let _inited      = false;

let _buf      = '';
let _bufStart = 0;
let _hidTimer = null;

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

export async function initProducts() {
  if (!_inited) {
    _inited = true;

    qs('#product-search')?.addEventListener('input', e => {
      _applySearch(e.target.value.trim());
    });

    document.addEventListener('keydown', _onHIDKeyDown);
  }

  setLoading(SCREEN_ID, true);
  try {
    const [newRes, allRes] = await Promise.all([
      apiCall('get_new_products'),
      apiCall('get_products', { shop_id: 'all' }),
    ]);
    _newProducts = newRes.products ?? [];
    _allProducts = allRes.products ?? [];

    _renderNewProducts(_newProducts);
    _applySearch(qs('#product-search')?.value.trim() ?? '');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    setLoading(SCREEN_ID, false);
  }
}

// ─── HID ДЕТЕКЦІЯ ─────────────────────────────────────────────────────────────

function _onHIDKeyDown(e) {
  if (!document.getElementById(SCREEN_ID)?.classList.contains('is-active')) return;

  if (e.key === 'Enter') {
    if (_buf.length >= HID_MIN_LEN) _flush();
    else _clearBuf();
    return;
  }
  if (e.key.length !== 1) return;
  if (_buf.length === 0) _bufStart = performance.now();
  _buf += e.key;
  clearTimeout(_hidTimer);
  _hidTimer = setTimeout(_flush, HID_FLUSH_MS);
}

function _flush() {
  clearTimeout(_hidTimer);
  const code    = _buf.trim();
  const elapsed = (performance.now() - _bufStart) || 1;
  const speed   = (code.length / elapsed) * 1000;
  _clearBuf();

  if (code.length < HID_MIN_LEN) return;
  if (speed < HID_SPEED_THRESH)  return;

  const input = qs('#product-search');
  if (!input) return;
  input.value = code;
  _applySearch(code);
}

function _clearBuf() {
  _buf = ''; _bufStart = 0;
  clearTimeout(_hidTimer);
}

// ─── ПОШУК ────────────────────────────────────────────────────────────────────

function _applySearch(q) {
  if (!q) {
    _renderProductList(null);
    return;
  }
  const lower = q.toLowerCase();
  _renderProductList(
    _allProducts.filter(p =>
      p.name.toLowerCase().includes(lower) ||
      String(p.barcode).includes(q) ||
      String(p.id).includes(q)
    )
  );
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

  card.appendChild(_buildEditForm(p, true));
  return card;
}

// ─── СПИСОК ВСІХ ТОВАРІВ ─────────────────────────────────────────────────────

// products === null → initial empty state (no query yet)
// products.length === 0 → query has no matches
function _renderProductList(products) {
  const list = qs('#product-list');
  if (!list) return;

  if (products === null) {
    list.innerHTML = '<div class="empty-state">Відскануйте штрих-код або введіть назву товару</div>';
    return;
  }

  if (products.length === 0) {
    list.innerHTML = '<div class="empty-state">Товарів не знайдено</div>';
    return;
  }

  list.innerHTML = '';
  products.forEach(p => {
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

  form.querySelector('.js-save-product').addEventListener('click', async () => {
    const btn = form.querySelector('.js-save-product');
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
