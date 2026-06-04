// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/products.js — форма швидкого додавання нового товару
//
//  Виклик: showQuickAddForm(barcode)
//  1. Показати модальну форму; штрихкод вже вписано (read-only).
//  2. На збереженні:
//     а. Записати у IndexedDB (upsertProducts)
//     б. Створити pending-операцію 'new_product'
//     в. Додати у кошик через addItem()
// ─────────────────────────────────────────────────────────────────────────────

import { PRODUCT_GROUPS }                                  from '../../shared/constants.js';
import { generateUUID, nowISO, isBelowAlcoholMRC }         from './utils.js';
import { upsertProducts, normalizeProduct, saveOperation } from './db.js';
import { getPublicSession }                                from './auth.js';
import { addItem }                                         from './cart.js';

const ALCOHOL_GROUPS = new Set(['Алкогольні напої', 'Пиво та напої']);

const OVERLAY_ID = 'quick-add-overlay';

// ─── ПУБЛІЧНИЙ API ────────────────────────────────────────────────────────────

export function showQuickAddForm(barcode) {
  _render(String(barcode));
}

// ─── РЕНДЕР ──────────────────────────────────────────────────────────────────

function _render(barcode) {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id        = OVERLAY_ID;

  const modal = document.createElement('div');
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal__title">Новий товар</div>
    <div class="modal__body">
      <div class="quick-add-barcode">${_esc(barcode)}</div>
      <form id="quick-add-form" class="flex flex-col gap" novalidate style="margin-top:12px">

        <div class="form-group">
          <label class="form-label" for="qa-name">Назва <span style="color:var(--c-danger)">*</span></label>
          <input id="qa-name" class="form-input" type="text" required
                 autocomplete="off" placeholder="Назва товару">
        </div>

        <div class="form-group">
          <label class="form-label" for="qa-group">Група <span style="color:var(--c-danger)">*</span></label>
          <select id="qa-group" class="form-select" required></select>
        </div>

        <div class="form-group">
          <label class="form-label" for="qa-subgroup">Підгрупа <span style="color:var(--c-danger)">*</span></label>
          <input id="qa-subgroup" class="form-input" type="text" required
                 autocomplete="off" placeholder="Напр: сигарети, пиво 0.5 л">
        </div>

        <div class="flex gap">
          <div class="form-group flex-1">
            <label class="form-label" for="qa-sell">Ціна продажу, ₴ <span style="color:var(--c-danger)">*</span></label>
            <input id="qa-sell" class="form-input" type="number"
                   min="0.01" step="0.01" required placeholder="0.00" inputmode="decimal">
          </div>
          <div class="form-group flex-1">
            <label class="form-label" for="qa-buy">Закупка, ₴</label>
            <input id="qa-buy" class="form-input" type="number"
                   min="0" step="0.01" value="0" inputmode="decimal">
          </div>
        </div>

        <!-- МРЦ за літр + обʼєм — для алкогольних груп -->
        <div id="qa-mrc-field" class="form-group" hidden>
          <label class="form-label" for="qa-mrc">МРЦ за літр (₴/л)</label>
          <input id="qa-mrc" class="form-input" type="number"
                 min="0" step="0.01" placeholder="0.00" inputmode="decimal">
        </div>
        <div id="qa-vol-field" class="form-group" hidden>
          <label class="form-label" for="qa-vol">Обʼєм пляшки, л</label>
          <input id="qa-vol" class="form-input" type="number"
                 min="0" step="0.001" value="0.5" inputmode="decimal">
        </div>
        <div id="qa-warn-alcohol" class="banner banner--danger" hidden></div>

        <div class="form-group">
          <label class="form-label" for="qa-qty">Кількість</label>
          <input id="qa-qty" class="form-input" type="number"
                 min="1" step="1" value="1" inputmode="numeric">
        </div>

      </form>
    </div>
    <div class="modal__actions">
      <button type="button" id="qa-cancel" class="btn btn--ghost">Скасувати</button>
      <button type="button" id="qa-save"   class="btn btn--primary">Зберегти та додати</button>
    </div>
  `;

  // Наповнити групи
  const sel = modal.querySelector('#qa-group');
  PRODUCT_GROUPS.forEach(g => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = g;
    sel.appendChild(opt);
  });

  // Показати/приховати МРЦ поле залежно від групи; перевірити ціну
  const _onGroupOrPriceChange = () => {
    const group    = sel.value;
    const mrcField = modal.querySelector('#qa-mrc-field');
    const volField = modal.querySelector('#qa-vol-field');
    const warn     = modal.querySelector('#qa-warn-alcohol');
    const isAlc    = ALCOHOL_GROUPS.has(group);
    if (mrcField) mrcField.hidden = !isAlc;
    if (volField) volField.hidden = !isAlc;
    if (warn) {
      const sell = parseFloat(modal.querySelector('#qa-sell').value) || 0;
      const mrc  = parseFloat(modal.querySelector('#qa-mrc')?.value) || 0;
      const vol  = parseFloat(modal.querySelector('#qa-vol')?.value) || 0;
      const fail = isAlc && mrc > 0 && sell > 0 && vol > 0 && isBelowAlcoholMRC(sell, mrc, vol);
      if (fail) {
        const minPrice = (mrc * vol).toFixed(2).replace('.', ',');
        warn.textContent = `⚠ Мінімальна ціна для ${vol}л: ${minPrice} ₴`;
      }
      warn.hidden = !fail;
    }
  };

  sel.addEventListener('change', _onGroupOrPriceChange);
  modal.querySelector('#qa-sell').addEventListener('input', _onGroupOrPriceChange);
  modal.querySelector('#qa-mrc') ?.addEventListener('input', _onGroupOrPriceChange);
  modal.querySelector('#qa-vol') ?.addEventListener('input', _onGroupOrPriceChange);

  modal.querySelector('#qa-cancel').addEventListener('click', () => overlay.remove());
  modal.querySelector('#qa-save').addEventListener('click', () => _save(barcode, modal, overlay));

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modal.querySelector('#qa-name').focus();
}

// ─── ЗБЕРЕЖЕННЯ ──────────────────────────────────────────────────────────────

async function _save(barcode, modal, overlay) {
  const name = modal.querySelector('#qa-name').value.trim();
  const grp  = modal.querySelector('#qa-group').value;
  const sub  = modal.querySelector('#qa-subgroup').value.trim();
  const sell = parseFloat(modal.querySelector('#qa-sell').value);
  const buy  = parseFloat(modal.querySelector('#qa-buy').value)  || 0;
  const mrc  = parseFloat(modal.querySelector('#qa-mrc')?.value) || 0;
  const vol  = parseFloat(modal.querySelector('#qa-vol')?.value) || 0;
  const qty  = Math.max(1, parseInt(modal.querySelector('#qa-qty').value, 10) || 1);

  if (!name || !sub || !(sell > 0)) return;

  const shopId  = getPublicSession()?.shop_id ?? '';

  const raw = {
    id:             `local_${generateUUID()}`,
    barcode,
    name,
    group:          grp,
    subgroup:       sub,
    sell_price:     sell,
    purchase_price: buy,
    stock:          qty,
    mrc,
    volume_l:       vol,
    strength:       0,
    active:         true,
    shop_id:        shopId,
    updated_at:     nowISO(),
  };

  const product = normalizeProduct(raw);

  // а. Записати у локальний кеш
  await upsertProducts([product]);

  // б. Поставити у чергу синхронізації
  await saveOperation({
    uuid:           generateUUID(),
    type:           'new_product',
    product_id:     raw.id,
    barcode:        raw.barcode,
    name:           raw.name,
    group:          raw.group,
    subgroup:       raw.subgroup,
    price:          raw.sell_price,
    purchase_price: raw.purchase_price,
    seller:         getPublicSession()?.name ?? '',
    timestamp:      nowISO(),
  });

  // в. Додати у кошик
  addItem(product, qty);

  overlay.remove();
}

// ─── УТИЛІТИ ─────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
