// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/receipt.js — прихід товарів від постачальника
// ─────────────────────────────────────────────────────────────────────────────

import { PRODUCT_GROUPS }                    from '../../shared/constants.js';
import {
  findProductByBarcode,
  upsertProduct,
  upsertProducts,
  normalizeProduct,
  adjustProductStock,
  saveOperation,
  getShift,
}                                            from './db.js';
import { requireAuth }                       from './auth.js';
import {
  generateUUID,
  nowISO,
  showBanner,
  formatCurrency,
  exceedsTobaccoMRC,
  isBelowAlcoholMRC,
}                                            from './utils.js';
import { syncPending }                       from './sync.js';

const TOBACCO_GROUP  = 'Тютюнові вироби';
const ALCOHOL_GROUPS = new Set(['Алкогольні напої', 'Пиво та напої']);

let _inited              = false;
let _scanMode            = true;
let _currentProductMRC   = 0;   // МРЦ знайденого продукту (₴/л) — для перевірки алкоголю
let _currentProductVolume = 0;  // Обʼєм пляшки (л) — для розрахунку мінімальної ціни

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

export function initReceipt() {
  if (_inited) return;
  _inited = true;

  // Наповнити групи
  const sel = document.getElementById('rec-group');
  PRODUCT_GROUPS.forEach(g => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = g;
    sel.appendChild(opt);
  });

  // MRC-поле видиме тільки для тютюну
  sel.addEventListener('change', _onGroupChange);

  // Перевірка МРЦ при зміні ціни продажу або МРЦ
  document.getElementById('rec-sell')?.addEventListener('input', _checkMRC);
  document.getElementById('rec-mrc') ?.addEventListener('input', _checkMRC);

  // Часткове повернення — показати/приховати поле кількості повернення
  document.getElementById('rec-rejected')?.addEventListener('change', e => {
    const field = document.getElementById('rec-rejection-field');
    if (field) field.hidden = !e.target.checked;
  });

  // Перемикач сканер / ручний ввід
  document.getElementById('rec-toggle-scan')  ?.addEventListener('click', () => _setScanMode(true));
  document.getElementById('rec-toggle-manual')?.addEventListener('click', () => _setScanMode(false));

  // Сканер (слухач залишається активним, але ігнорує якщо екран неактивний)
  document.addEventListener('scanner:barcode', _onScan);

  document.getElementById('form-receipt')
    .addEventListener('submit', async e => { e.preventDefault(); await _submit(); });

  document.getElementById('btn-receipt-back')
    ?.addEventListener('click', () => import('./app.js').then(m => m.showScreen('pos')));

  _setScanMode(true);
}

export function disposeReceipt() {
  document.removeEventListener('scanner:barcode', _onScan);
  _inited = false;
}

// ─── РЕЖИМ СКАНУВАННЯ ────────────────────────────────────────────────────────

function _setScanMode(scan) {
  _scanMode = scan;
  document.getElementById('rec-toggle-scan')  ?.classList.toggle('is-active',  scan);
  document.getElementById('rec-toggle-manual')?.classList.toggle('is-active', !scan);

  const barcodeInput = document.getElementById('rec-barcode');
  if (barcodeInput) {
    barcodeInput.readOnly = scan;
    if (!scan) barcodeInput.focus();
  }
}

async function _onScan(e) {
  const screen = document.getElementById('screen-receipt');
  if (!screen?.classList.contains('is-active')) return;
  if (!_scanMode) return;

  const barcode  = e.detail.barcode;
  const products = await findProductByBarcode(barcode);

  document.getElementById('rec-barcode').value = barcode;
  _currentProductMRC    = 0;
  _currentProductVolume = 0;

  if (products.length > 0) {
    const p = products[0];
    _currentProductMRC    = p.mrc      ?? 0;
    _currentProductVolume = p.volume_l ?? 0;
    const fv = (id, val) => {
      const inp = document.getElementById(id);
      if (inp) inp.value = val ?? '';
    };
    fv('rec-name',     p.name);
    fv('rec-subgroup', p.subgroup);
    fv('rec-sell',     p.sell_price);
    fv('rec-buy',      p.purchase_price || '');

    const groupSel = document.getElementById('rec-group');
    if (groupSel) groupSel.value = p.group;
    _onGroupChange();
  }

  document.getElementById('rec-qty')?.focus();
}

// ─────────────────────────────────────────────────────────────────────────────
//  МРЦ ЛОГІКА
//
//  Тютюн (TOBACCO_GROUP):
//    - Показати поле «МРЦ на пачці» (значення з пачки, ручний ввід).
//    - При зміні sell_price або mrc: exceedsTobaccoMRC(sell, mrc)
//      → якщо true, показати попередження (продаж перевищить МРЦ+5%).
//
//  Алкоголь (ALCOHOL_GROUPS):
//    - Поле МРЦ не показуємо (беремо mrc з БД при скануванні).
//    - При зміні sell_price: isBelowAlcoholMRC(sell, _currentProductMRC)
//      → якщо true, показати попередження (ціна нижче мінімальної).
// ─────────────────────────────────────────────────────────────────────────────

function _onGroupChange() {
  const group    = document.getElementById('rec-group').value;
  const mrcField = document.getElementById('rec-mrc-field');
  if (mrcField) mrcField.hidden = group !== TOBACCO_GROUP;
  _checkMRC();
}

function _checkMRC() {
  const group   = document.getElementById('rec-group').value;
  const sell    = parseFloat(document.getElementById('rec-sell')?.value) || 0;
  const mrcVal  = parseFloat(document.getElementById('rec-mrc')?.value)  || 0;

  const tobWarn = document.getElementById('rec-warn-tobacco');
  const alcWarn = document.getElementById('rec-warn-alcohol');
  if (tobWarn) tobWarn.hidden = true;
  if (alcWarn) alcWarn.hidden = true;

  if (group === TOBACCO_GROUP) {
    // Попередження якщо ціна продажу > МРЦ × 1.05
    if (mrcVal > 0 && sell > 0 && exceedsTobaccoMRC(sell, mrcVal)) {
      if (tobWarn) tobWarn.hidden = false;
    }
  } else if (ALCOHOL_GROUPS.has(group)) {
    if (_currentProductMRC > 0 && _currentProductVolume > 0 && sell > 0
        && isBelowAlcoholMRC(sell, _currentProductMRC, _currentProductVolume)) {
      if (alcWarn) {
        const minPrice = formatCurrency(_currentProductMRC * _currentProductVolume);
        alcWarn.textContent = `⚠ Мінімальна ціна для ${_currentProductVolume}л: ${minPrice}`;
        alcWarn.hidden = false;
      }
    }
  }
}

// ─── ЗБЕРЕЖЕННЯ ПРИХОДУ ───────────────────────────────────────────────────────

async function _submit() {
  const barcode  = document.getElementById('rec-barcode').value.trim();
  const name     = document.getElementById('rec-name').value.trim();
  const group    = document.getElementById('rec-group').value;
  const subgroup = document.getElementById('rec-subgroup').value.trim();
  const qty      = parseFloat(document.getElementById('rec-qty').value)      || 0;
  const buy      = parseFloat(document.getElementById('rec-buy').value)      || 0;
  const sell     = parseFloat(document.getElementById('rec-sell').value)     || 0;
  const supplier = document.getElementById('rec-supplier').value.trim();
  const mrc      = parseFloat(document.getElementById('rec-mrc')?.value)     || 0;
  const rejected = document.getElementById('rec-rejected')?.checked          ?? false;
  const rejQty   = rejected
    ? (parseFloat(document.getElementById('rec-rej-qty').value) || 0)
    : 0;

  if (!barcode || !name || qty <= 0 || sell <= 0) return;

  const session = requireAuth();
  const shift   = await getShift(session.shop_id);

  // Оновити локальний кеш товарів
  const products = await findProductByBarcode(barcode);
  const netQty   = qty - rejQty;
  if (products.length > 0) {
    const existing = products[0];

    // Оновити залишок
    if (netQty !== 0) await adjustProductStock(existing.id, netQty);

    // Оновити МРЦ для тютюну (якщо вказано на пачці)
    if (group === TOBACCO_GROUP && mrc > 0 && mrc !== existing.mrc) {
      await upsertProducts([normalizeProduct({ ...existing, mrc })]);
    }
  } else {
    // Новий товар — додати до локального кешу щоб сканер міг його знайти
    await upsertProduct({
      id:             `local_${generateUUID()}`,
      barcode,
      name,
      group,
      subgroup,
      sell_price:     sell,
      purchase_price: buy,
      stock:          netQty,
      mrc,
      volume_l:       0,
      strength:       0,
      shop_id:        session.shop_id,
      active:         true,
      updated_at:     nowISO(),
    });
  }

  await saveOperation({
    uuid:           generateUUID(),
    type:           'receipt',
    shift_id:       shift?.uuid  ?? '',
    timestamp:      nowISO(),
    seller:         session.name,
    barcode,
    name,
    group,
    subgroup,
    quantity:       qty,
    rejected_qty:   rejQty,
    purchase_price: buy,
    sell_price:     sell,
    mrc:            group === TOBACCO_GROUP ? mrc : 0,
    supplier,
  });

  showBanner(`Прийнято: ${name} — ${qty} шт.`, 'success');
  _resetForm();
  syncPending();
}

function _resetForm() {
  [
    'rec-barcode', 'rec-name', 'rec-subgroup',
    'rec-qty',     'rec-buy',  'rec-sell',
    'rec-supplier','rec-mrc',  'rec-rej-qty',
  ].forEach(id => {
    const inp = document.getElementById(id);
    if (inp) inp.value = '';
  });

  const rej = document.getElementById('rec-rejected');
  if (rej) rej.checked = false;
  const rejField = document.getElementById('rec-rejection-field');
  if (rejField) rejField.hidden = true;

  _currentProductMRC    = 0;
  _currentProductVolume = 0;
  _onGroupChange();

  if (_scanMode) document.getElementById('rec-barcode')?.focus();
}
