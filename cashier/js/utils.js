// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/utils.js — утиліти формату, UUID, звуки, DOM
// ─────────────────────────────────────────────────────────────────────────────

import {
  CURRENCY_SYMBOL,
  LOCALE,
  DATE_LOCALE_OPTIONS,
  DATETIME_LOCALE_OPTIONS,
} from '../../shared/constants.js';

// ─── UUID ─────────────────────────────────────────────────────────────────────

export function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback для старих браузерів
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── ДАТА / ЧАС ──────────────────────────────────────────────────────────────

/**
 * Форматує дату в форматі ДД.ММ.РРРР (українська локаль).
 */
export function formatDate(dateOrISO) {
  const d = dateOrISO instanceof Date ? dateOrISO : new Date(dateOrISO);
  return d.toLocaleDateString(LOCALE, DATE_LOCALE_OPTIONS);
}

/**
 * Форматує дату і час: ДД.ММ.РРРР ГГ:ХХ
 */
export function formatDateTime(dateOrISO) {
  const d = dateOrISO instanceof Date ? dateOrISO : new Date(dateOrISO);
  return d.toLocaleDateString(LOCALE, DATETIME_LOCALE_OPTIONS);
}

/**
 * Повертає поточний час в ISO 8601 UTC.
 * Використовується при створенні операцій.
 */
export function nowISO() {
  return new Date().toISOString();
}

// ─── ФОРМАТУВАННЯ ВАЛЮТИ / ЧИСЕЛ ─────────────────────────────────────────────

/**
 * Форматує суму у вигляді «1 234,56 ₴» (українська локаль).
 * Використовується скрізь де відображається ціна або сума.
 */
export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return (
    num.toLocaleString(LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    ' ' +  // non-breaking space
    CURRENCY_SYMBOL
  );
}

/**
 * Форматує кількість (до 3 знаків після коми, без зайвих нулів).
 */
export function formatQty(num) {
  return Number(num || 0).toLocaleString(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

// ─── ПЕРЕВІРКИ МРЦ ───────────────────────────────────────────────────────────

/**
 * ТЮТЮН (ТЗ 16.6): ціна продажу НЕ МОЖЕ ПЕРЕВИЩУВАТИ МРЦ × 1.05.
 * Повертає true якщо sellPrice > mrc * 1.05 → показати попередження касиру.
 *
 * МРЦ на тютюн — це МАКСИМАЛЬНА ціна (+5% допуск).
 */
export function exceedsTobaccoMRC(sellPrice, mrc) {
  if (!mrc || mrc <= 0) return false;
  return Number(sellPrice) > Number(mrc) * 1.05;
}

/**
 * АЛКОГОЛЬ (ТЗ 16.7): ціна продажу НЕ МОЖЕ БУТИ НИЖЧОЮ за мінімальну (МРЦ).
 * Повертає true якщо sellPrice < minPrice → показати попередження касиру.
 *
 * МРЦ на алкоголь — це МІНІМАЛЬНА ціна (постанова Кабміну).
 */
export function isBelowAlcoholMRC(sellPrice, minPricePerLiter, volumeLiters) {
  if (!minPricePerLiter || minPricePerLiter <= 0) return false;
  if (!volumeLiters     || volumeLiters     <= 0) return false;
  return Number(sellPrice) < Number(minPricePerLiter) * Number(volumeLiters);
}

/**
 * Повертає true якщо залишок = 0 або від'ємний (ТЗ 13.1).
 */
export function isLowOrZeroStock(stock) {
  return Number(stock) <= 0;
}

// ─── ЗВУКОВІ СИГНАЛИ (Web Audio API, без файлів) ─────────────────────────────

/**
 * Одиночний bip — товар знайдено (ТЗ 12.6).
 */
export function playBeep() {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1800;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (_) { /* AudioContext може бути заблокований без user gesture */ }
}

/**
 * Подвійний bip-bip — штрихкод не знайдено (ТЗ 13.2).
 */
export function playErrorBeep() {
  try {
    const ctx = new AudioContext();
    [0, 0.2].forEach(delay => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 900;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.12);
    });
  } catch (_) {}
}

// ─── DOM HELPERS ──────────────────────────────────────────────────────────────

/** querySelector з контекстом */
export const qs = (sel, ctx = document) => ctx.querySelector(sel);

/** querySelectorAll → Array */
export const qsAll = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

export const show = el => { if (el) el.hidden = false; };
export const hide = el => { if (el) el.hidden = true; };

/** Встановити textContent безпечно */
export function setText(sel, text, ctx = document) {
  const el = qs(sel, ctx);
  if (el) el.textContent = text;
}

/**
 * Створити DOM-елемент зі списком класів та вмістом.
 * el('div', 'card card--active', 'Текст')
 */
export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text)      node.textContent = text;
  return node;
}

/**
 * Показати тимчасовий баннер у верхній частині екрана.
 * type: 'info' | 'warning' | 'error' | 'success'
 */
export function showBanner(message, type = 'info', durationMs = 3000) {
  // Видалити попередній баннер якщо є
  document.querySelector('.flash-banner')?.remove();

  const banner = el('div', `banner banner--${type} flash-banner`);
  banner.textContent = message;
  banner.style.cssText = 'position:fixed;top:calc(var(--header-height) + 8px);left:50%;transform:translateX(-50%);z-index:1000;max-width:90vw;white-space:nowrap;pointer-events:none';
  document.body.appendChild(banner);

  setTimeout(() => banner.remove(), durationMs);
}
