// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/pos.js — головний POS-екран
// ─────────────────────────────────────────────────────────────────────────────

import {
  findProductByBarcode,
  saveOperation,
  adjustProductStock,
  getShift,
  saveShift,
} from './db.js';

import {
  playBeep,
  playErrorBeep,
  el,
  formatCurrency,
  showBanner,
  generateUUID,
  nowISO,
} from './utils.js';

import {
  addItem,
  removeItem,
  updateQty,
  getItems,
  getTotal,
  clear,
  setReturnMode,
  isReturnMode,
} from './cart.js';

import { showQuickAddForm } from './products.js';
import { requireAuth }      from './auth.js';
import { syncPending }      from './sync.js';

let _paymentType = 'cash';  // 'cash' | 'card'

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

export function initPOS() {
  document.addEventListener('scanner:barcode', _onScan);
  document.addEventListener('cart:change',     _onCartChange);

  document.getElementById('pay-cash')?.addEventListener('click', () => _setPayment('cash'));
  document.getElementById('pay-card')?.addEventListener('click', () => _setPayment('card'));
  document.getElementById('btn-checkout')?.addEventListener('click', _submitSale);
  document.getElementById('btn-return-mode')?.addEventListener('click', _toggleReturn);

  document.getElementById('btn-manual-barcode')?.addEventListener('click', _openManualBarcode);

  document.getElementById('btn-go-expenses')?.addEventListener('click',
    () => import('./app.js').then(m => m.showScreen('expenses')));
  document.getElementById('btn-go-receipt')?.addEventListener('click',
    () => import('./app.js').then(m => m.showScreen('receipt')));
  document.getElementById('btn-go-close-shift')?.addEventListener('click',
    () => import('./app.js').then(m => m.showScreen('shift-close')));

  document.addEventListener('keydown', e => {
    if (e.key !== 'F2') return;
    if (!document.getElementById('screen-pos')?.classList.contains('is-active')) return;
    if (_isModalOpen()) return;
    e.preventDefault();
    _openManualBarcode();
  });

  window.addEventListener('online',  _updateSyncDot);
  window.addEventListener('offline', _updateSyncDot);

  // Ініціальний стан
  _renderCart([]);
  _updateSyncDot();
  updatePOSHeader();

  // ─── ФОКУС BARCODE-INPUT ─────────────────────────────────────────────────────
  // На мобільних браузерах (iOS Safari) keyboard-події надходять тільки
  // коли текстовий input у фокусі. Підтримуємо фокус постійно.

  const _bci = document.getElementById('barcode-input');

  function _refocusBarcode() {
    if (!document.getElementById('screen-pos')?.classList.contains('is-active')) return;
    if (_isModalOpen()) return;
    _bci?.focus({ preventScroll: true });
  }

  // 1. Після будь-якого кліку/тапу на POS-екрані повернути фокус
  document.getElementById('screen-pos')
    ?.addEventListener('pointerup', () => setTimeout(_refocusBarcode, 50));

  // 2. Якщо input втратив фокус (наприклад після кліку на кнопку) — повернути
  _bci?.addEventListener('blur', () => setTimeout(_refocusBarcode, 50));

  // 3. При поверненні з фону (вкладки, сон пристрою)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) _refocusBarcode();
  });
}

// ─── ОНОВЛЕННЯ ЗАГОЛОВКУ ─────────────────────────────────────────────────────

export async function updatePOSHeader() {
  try {
    const session = requireAuth();
    const shift   = await getShift(session.shop_id);

    const shopEl     = document.getElementById('hdr-shop');
    const cashierEl  = document.getElementById('hdr-cashier');
    const shiftEl    = document.getElementById('hdr-shift');

    if (shopEl)    { shopEl.textContent    = session.shop_id === 'SHOP_1' ? 'Магазин №1' : 'Магазин №2'; shopEl.hidden = false; }
    if (cashierEl) { cashierEl.textContent = session.name;                                                cashierEl.hidden = false; }
    if (shiftEl && shift) {
      const d = new Date(shift.opened_at);
      shiftEl.textContent = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
      shiftEl.hidden = false;
    }
  } catch (_) { /* Не авторизований */ }
}

// ─── SCAN ─────────────────────────────────────────────────────────────────────

async function _onScan(e) {
  // Обробляємо тільки коли POS-екран активний і немає відкритих діалогів
  const screen = document.getElementById('screen-pos');
  if (!screen?.classList.contains('is-active')) return;
  if (_isModalOpen()) return;
  await _handleBarcode(e.detail.barcode);
}

async function _handleBarcode(barcode) {
  const products = await findProductByBarcode(barcode);

  if (products.length === 0) {
    playErrorBeep();
    showQuickAddForm(barcode);
    return;
  }

  playBeep();

  let product;
  if (products.length === 1) {
    product = products[0];
  } else {
    product = await _priceDialog(products);
    if (!product) return;
  }

  if (product.stock <= 0) {
    const ok = await _stockDialog(product);
    if (!ok) return;
  }

  addItem(product, 1);
}

// ─── КОШИК ────────────────────────────────────────────────────────────────────

function _onCartChange(e) {
  const { items, total, itemCount } = e.detail;
  _renderCart(items);

  const totalEl = document.getElementById('cart-total-amount');
  const countEl = document.getElementById('cart-item-count');
  const btn     = document.getElementById('btn-checkout');

  if (totalEl) totalEl.textContent = formatCurrency(total);
  if (countEl) countEl.textContent = `${itemCount} шт.`;
  if (btn)     btn.disabled        = items.length === 0;
}

function _renderCart(items) {
  const list = document.getElementById('cart-list');
  if (!list) return;

  if (items.length === 0) {
    list.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <span>Відскануйте товар або штрихкод</span>
      </div>`;
    return;
  }

  list.innerHTML = '';
  const ret = isReturnMode();

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = `cart-item${ret ? ' is-return' : ''}${item.stock <= 0 ? ' low-stock' : ''}`;
    row.dataset.id = item.productId;

    const qty = Math.abs(item.qty);
    row.innerHTML = `
      <span class="cart-item__name">${_esc(item.name)}</span>
      <span class="cart-item__total">${formatCurrency(item.amount)}</span>
      <div class="cart-item__controls">
        <button class="qty-btn js-minus" data-id="${_esc(item.productId)}">−</button>
        <span class="qty-value">${qty}</span>
        <button class="qty-btn js-plus"  data-id="${_esc(item.productId)}">+</button>
        <span class="cart-item__meta text-muted text-sm">${formatCurrency(item.sell_price)} / шт.</span>
        <button class="btn-remove-item js-del" data-id="${_esc(item.productId)}">×</button>
      </div>`;

    list.appendChild(row);
  });

  // Делегування подій через список
  list.querySelectorAll('.js-minus').forEach(btn =>
    btn.addEventListener('click', () => {
      const i = getItems().find(x => x.productId === btn.dataset.id);
      if (!i) return;
      const nq = Math.abs(i.qty) - 1;
      if (nq <= 0) removeItem(i.productId); else updateQty(i.productId, nq);
    }));

  list.querySelectorAll('.js-plus').forEach(btn =>
    btn.addEventListener('click', () => {
      const i = getItems().find(x => x.productId === btn.dataset.id);
      if (i) updateQty(i.productId, Math.abs(i.qty) + 1);
    }));

  list.querySelectorAll('.js-del').forEach(btn =>
    btn.addEventListener('click', () => removeItem(btn.dataset.id)));
}

// ─── ОПЛАТА ───────────────────────────────────────────────────────────────────

function _setPayment(type) {
  _paymentType = type;
  document.getElementById('pay-cash')?.classList.toggle('is-active', type === 'cash');
  document.getElementById('pay-card')?.classList.toggle('is-active', type === 'card');
}

// ─── ПРОВЕДЕННЯ ПРОДАЖУ ───────────────────────────────────────────────────────

async function _submitSale() {
  const items = getItems();
  if (items.length === 0) return;

  const session    = requireAuth();
  const { total }  = getTotal();
  const returnMode = isReturnMode();
  const shift      = await getShift(session.shop_id);

  const shiftId   = shift?.uuid ?? '';
  const timestamp = nowISO();

  // One pending operation per cart item — GAS writes one Продажі row per item
  for (const item of items) {
    await saveOperation({
      uuid:           generateUUID(),
      type:           'sale',
      shift_id:       shiftId,
      timestamp,
      payment_type:   _paymentType,
      is_return:      returnMode,
      seller:         session.name,
      product_id:     item.productId,
      barcode:        item.barcode,
      name:           item.name,
      group:          item.group,
      subgroup:       item.subgroup ?? '',
      quantity:       Math.abs(item.qty),
      price:          item.sell_price,
      purchase_price: item.purchase_price ?? 0,
      total:          item.amount,
    });
  }

  // Зменшити залишки в IndexedDB (офлайн-облік)
  for (const item of items) {
    await adjustProductStock(item.productId, -item.qty);
  }

  // Оновити підсумки зміни
  if (shift) await _updateShiftTotals(shift, items, _paymentType);

  clear();
  setReturnMode(false);
  document.getElementById('btn-return-mode')?.classList.remove('is-active');
  document.getElementById('screen-pos')?.classList.remove('return-mode');

  showBanner(
    returnMode
      ? `Повернення прийнято: ${formatCurrency(total)}`
      : `Продаж: ${formatCurrency(total)}`,
    returnMode ? 'warning' : 'success',
    1800
  );

  syncPending();
}

async function _updateShiftTotals(shift, items, paymentType) {
  const saleTotal  = items.reduce((s, i) => s + i.amount, 0);
  const gt         = shift.group_totals ?? {};
  for (const item of items) {
    gt[item.group] = (gt[item.group] ?? 0) + item.amount;
  }
  if (paymentType === 'cash') shift.sales_cash = (shift.sales_cash ?? 0) + saleTotal;
  else                        shift.sales_card = (shift.sales_card ?? 0) + saleTotal;
  shift.group_totals = gt;
  await saveShift(shift);
}

// ─── РЕЖИМ ПОВЕРНЕННЯ ─────────────────────────────────────────────────────────

function _toggleReturn() {
  const next = !isReturnMode();
  setReturnMode(next);
  document.getElementById('btn-return-mode')?.classList.toggle('is-active', next);
  document.getElementById('screen-pos')?.classList.toggle('return-mode', next);
  _renderCart(getItems());
}

// ─── SYNC DOT ─────────────────────────────────────────────────────────────────

function _updateSyncDot() {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  dot.className = navigator.onLine ? 'sync-dot' : 'sync-dot sync-dot--offline';
  dot.title     = navigator.onLine ? 'Онлайн'  : 'Офлайн';
}

// ─── ДІАЛОГИ ─────────────────────────────────────────────────────────────────

function _priceDialog(products) {
  return new Promise(resolve => {
    const ov  = _overlay('pos-price-dialog');
    const box = _modal();

    box.appendChild(el('div', 'modal__title', 'Оберіть ціну'));

    const body = el('div', 'modal__body');
    const list = el('div', 'product-choice-list');

    products.forEach(p => {
      const item  = el('div', 'product-choice-item');
      const info  = el('div', 'product-choice-info');
      info.appendChild(el('span', 'product-choice-name', p.name));
      info.appendChild(el('span', `product-choice-stock${p.stock <= 0 ? ' low' : ''}`,
        `Залишок: ${p.stock} шт.`));
      item.append(info, el('span', 'product-choice-price', `${p.sell_price.toFixed(2)} ₴`));
      item.addEventListener('click', () => { ov.remove(); resolve(p); });
      list.appendChild(item);
    });

    body.appendChild(list);

    const actions = el('div', 'modal__actions');
    const cancel  = el('button', 'btn btn--ghost', 'Скасувати');
    cancel.addEventListener('click', () => { ov.remove(); resolve(null); });
    actions.appendChild(cancel);

    box.append(body, actions);
    ov.appendChild(box);
    document.body.appendChild(ov);
  });
}

function _stockDialog(product) {
  return new Promise(resolve => {
    const ov  = _overlay('pos-stock-dialog');
    const box = _modal();

    box.appendChild(el('div', 'modal__title', 'Увага: товар відсутній'));

    const body = el('div', 'modal__body');
    const warn = el('div', 'banner banner--warning');
    warn.textContent = `«${product.name}» — залишок: ${product.stock} шт. Продати?`;
    body.appendChild(warn);

    const actions = el('div', 'modal__actions');
    const no  = el('button', 'btn btn--ghost',   'Скасувати');
    const yes = el('button', 'btn btn--warning', 'Так, продати');
    no .addEventListener('click', () => { ov.remove(); resolve(false); });
    yes.addEventListener('click', () => { ov.remove(); resolve(true);  });
    actions.append(no, yes);

    box.append(body, actions);
    ov.appendChild(box);
    document.body.appendChild(ov);
  });
}

function _isModalOpen() {
  return !!(
    document.getElementById('quick-add-overlay')        ||
    document.getElementById('pos-price-dialog')         ||
    document.getElementById('pos-stock-dialog')         ||
    document.getElementById('pos-manual-barcode-dialog')
  );
}

function _openManualBarcode() {
  const ov  = _overlay('pos-manual-barcode-dialog');
  const box = _modal();

  box.appendChild(el('div', 'modal__title', 'Введіть штрихкод вручну'));

  const body  = el('div', 'modal__body');
  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'form-input';
  input.placeholder = 'Штрихкод…';
  input.inputMode   = 'numeric';
  input.autocomplete = 'off';
  body.appendChild(input);

  const actions = el('div', 'modal__actions');
  const cancel  = el('button', 'btn btn--ghost',    'Скасувати');
  const confirm = el('button', 'btn btn--primary',  'Пошук');

  async function _submit() {
    const val = input.value.trim();
    if (!val) return;
    ov.remove();
    document.getElementById('barcode-input')?.focus({ preventScroll: true });
    await _handleBarcode(val);
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _submit(); } });
  cancel .addEventListener('click', () => { ov.remove(); document.getElementById('barcode-input')?.focus({ preventScroll: true }); });
  confirm.addEventListener('click', _submit);

  actions.append(cancel, confirm);
  box.append(body, actions);
  ov.appendChild(box);
  document.body.appendChild(ov);
  input.focus();
}

function _overlay(id) {
  document.getElementById(id)?.remove();
  const d = document.createElement('div');
  d.className = 'modal-overlay'; d.id = id;
  return d;
}

function _modal() {
  const d = document.createElement('div');
  d.className = 'modal';
  return d;
}

function _esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
