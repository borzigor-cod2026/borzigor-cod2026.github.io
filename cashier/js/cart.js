// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/cart.js — кошик покупця (чистий модуль без DOM)
//
//  Ключ елемента = product.id (унікальний навіть при однаковому штрихкоді,
//  бо різні ціни зберігаються як окремі товари в IndexedDB).
//
//  Режим повернення: всі qty та amount від'ємні.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, CartItem>} */
const _items = new Map();
let   _returnMode = false;

// ─── ЗАПИС ───────────────────────────────────────────────────────────────────

/**
 * Додати товар до кошика.
 * Якщо товар вже є (однаковий product.id) — збільшити кількість.
 * qty завжди передається як додатне; знак визначається returnMode.
 */
export function addItem(product, qty = 1) {
  const sign = _returnMode ? -1 : 1;
  const q    = Math.max(1, Math.abs(qty)) * sign;

  if (_items.has(product.id)) {
    const item  = _items.get(product.id);
    item.qty   += q;
    item.amount = item.qty * item.sell_price;
    if (item.qty === 0) _items.delete(product.id);
  } else {
    _items.set(product.id, {
      productId:      product.id,
      barcode:        product.barcode,
      name:           product.name,
      group:          product.group,
      subgroup:       product.subgroup       ?? '',
      sell_price:     product.sell_price,
      purchase_price: product.purchase_price ?? 0,
      mrc:            product.mrc            ?? 0,
      stock:          product.stock          ?? 0,
      qty:            q,
      amount:         q * product.sell_price,
    });
  }
  _emit();
}

/** Видалити рядок з кошика. */
export function removeItem(productId) {
  if (_items.delete(productId)) _emit();
}

/**
 * Встановити кількість рядка.
 * Мінімальне |qty| = 1; знак визначається returnMode.
 */
export function updateQty(productId, qty) {
  const item = _items.get(productId);
  if (!item) return;
  const sign  = _returnMode ? -1 : 1;
  const q     = Math.max(1, Math.abs(qty)) * sign;
  item.qty    = q;
  item.amount = q * item.sell_price;
  _emit();
}

/** Очистити кошик і скинути returnMode. */
export function clear() {
  _items.clear();
  _returnMode = false;
  _emit();
}

// ─── ЧИТАННЯ ─────────────────────────────────────────────────────────────────

/** Повернути масив рядків кошика (копія). */
export function getItems() {
  return [..._items.values()];
}

/**
 * Повернути підсумок.
 * @returns {{ total: number, itemCount: number }}
 *   total     — сума (від'ємна у returnMode)
 *   itemCount — загальна кількість одиниць (завжди ≥ 0)
 */
export function getTotal() {
  let total     = 0;
  let itemCount = 0;
  for (const item of _items.values()) {
    total     += item.amount;
    itemCount += Math.abs(item.qty);
  }
  return { total, itemCount };
}

// ─── РЕЖИМ ПОВЕРНЕННЯ ────────────────────────────────────────────────────────

export function setReturnMode(enabled) {
  _returnMode = !!enabled;
}

export function isReturnMode() {
  return _returnMode;
}

// ─── ВНУТРІШНЄ СПОВІЩЕННЯ ────────────────────────────────────────────────────

function _emit() {
  document.dispatchEvent(
    new CustomEvent('cart:change', {
      detail: { items: getItems(), ...getTotal() },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  @typedef {Object} CartItem
//  @property {string} productId
//  @property {string} barcode
//  @property {string} name
//  @property {string} group
//  @property {string} subgroup
//  @property {number} sell_price
//  @property {number} purchase_price
//  @property {number} mrc
//  @property {number} stock
//  @property {number} qty     — від'ємне при returnMode
//  @property {number} amount  — qty * sell_price
// ─────────────────────────────────────────────────────────────────────────────
