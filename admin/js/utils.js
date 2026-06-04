// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/utils.js — утиліти адмін-панелі
// ─────────────────────────────────────────────────────────────────────────────

import { computeHMAC }                        from '../../shared/crypto.js';
import { API_VERSION, CURRENCY_SYMBOL, LOCALE,
         DATE_LOCALE_OPTIONS, DATETIME_LOCALE_OPTIONS } from '../../shared/constants.js';

// ─── API CALL ─────────────────────────────────────────────────────────────────
//
//  Всі запити до GAS підписуються HMAC.
//  Конфігурація зберігається в localStorage під ключами admin_gasUrl / admin_apiSecret.

export async function apiCall(type, payload = {}) {
  const gasUrl    = localStorage.getItem('admin_gasUrl')    ?? 'https://script.google.com/macros/s/AKfycbxKvUd0aOrbb5EQU_xX117qX3Opnzs_jNK0JHjAX0HJkbb27h9TuieYRXSqxr5ThtNF/exec';
  const apiSecret = localStorage.getItem('admin_apiSecret') ?? 'H1MNaT6RrBatEs6K22BsExhjczmHreLn';

  if (!gasUrl || !apiSecret) throw new Error('GAS не налаштовано. Зверніться до розробника.');
  if (!navigator.onLine)     throw new Error('Немає підключення до мережі.');

  const body      = JSON.stringify({ type, ...payload });
  const signature = await computeHMAC(body, apiSecret);
  const url       = `${gasUrl}?api_version=${API_VERSION}&api_signature=${encodeURIComponent(signature)}`;

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? `Помилка: ${type}`);
  return json;
}

// ─── ФОРМАТИ ─────────────────────────────────────────────────────────────────

export function formatCurrency(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
         ' ' + CURRENCY_SYMBOL;
}

export function formatDate(dateOrISO) {
  const d = dateOrISO instanceof Date ? dateOrISO : new Date(dateOrISO);
  return d.toLocaleDateString(LOCALE, DATE_LOCALE_OPTIONS);
}

export function formatDateTime(dateOrISO) {
  const d = dateOrISO instanceof Date ? dateOrISO : new Date(dateOrISO);
  return d.toLocaleString(LOCALE, DATETIME_LOCALE_OPTIONS);
}

// ─── DOM ─────────────────────────────────────────────────────────────────────

export const qs    = (sel, ctx = document) => ctx.querySelector(sel);
export const qsAll = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
export const show  = e => { if (e) e.hidden = false; };
export const hide  = e => { if (e) e.hidden = true; };

export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text)      node.textContent = text;
  return node;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────

export function toast(message, type = 'info', ms = 3000) {
  document.querySelector('.admin-toast')?.remove();
  const t = el('div', `admin-toast admin-toast--${type}`);
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// ─── LOADING ─────────────────────────────────────────────────────────────────

export function setLoading(screenId, on) {
  const scr = document.getElementById(screenId);
  if (!scr) return;
  let spinner = scr.querySelector('.screen-spinner');
  if (on) {
    if (!spinner) {
      spinner = el('div', 'screen-spinner');
      spinner.innerHTML = '<div class="spinner"></div>';
      scr.prepend(spinner);
    }
    spinner.hidden = false;
  } else if (spinner) {
    spinner.hidden = true;
  }
}

// ─── ESCAPE ───────────────────────────────────────────────────────────────────

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─── DIFF BADGE ───────────────────────────────────────────────────────────────

export function diffBadge(value) {
  const n    = Number(value) || 0;
  const cls  = n < 0 ? 'badge--danger' : n > 0 ? 'badge--warning' : 'badge--neutral';
  const sign = n > 0 ? '+' : '';
  const span = el('span', `badge ${cls}`);
  span.textContent = sign + formatCurrency(n);
  return span;
}
