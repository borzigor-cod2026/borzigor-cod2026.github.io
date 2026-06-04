// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/app.js — маршрутизатор екранів PWA касира
// ─────────────────────────────────────────────────────────────────────────────

import { configureSyncEngine, setupOnlineListener, refreshEmployeeCache, refreshProductCache } from './sync.js';
import { login, logout, getPublicSession } from './auth.js';
import { getAllShifts, clearShift } from './db.js';
import { initScanner }          from './scanner.js';
import { initPOS, updatePOSHeader }    from './pos.js';
import { initShiftOpen, initShiftClose, resetShiftClose } from './shift.js';
import { initExpenses }         from './expenses.js';
import { initReceipt }          from './receipt.js';

// ─── СТАН РОУТЕРА ─────────────────────────────────────────────────────────────

const SCREENS = ['login', 'shift-open', 'pos', 'shift-close', 'expenses', 'receipt'];

let _posInited        = false;
let _shiftOpenInited  = false;
let _shiftCloseInited = false;
let _expensesInited   = false;
let _receiptInited    = false;

// ─── ПУБЛІЧНИЙ API ────────────────────────────────────────────────────────────

/**
 * Перейти на інший екран.
 * Після переходу відновлює фокус на #barcode-input (для HID-сканера).
 */
export function showScreen(name) {
  SCREENS.forEach(s => {
    document.getElementById(`screen-${s}`)?.classList.toggle('is-active', s === name);
  });

  _updateHeader(name);

  // Ліниво ініціалізувати при першому показі
  if (name === 'pos' && !_posInited) {
    initPOS();
    _posInited = true;
  }
  if (name === 'shift-open' && !_shiftOpenInited) {
    initShiftOpen();
    _shiftOpenInited = true;
  }
  if (name === 'shift-close') {
    if (!_shiftCloseInited) {
      initShiftClose();
      _shiftCloseInited = true;
    } else {
      resetShiftClose();
      initShiftClose();  // Перечитує поточну зміну при повторному вході
    }
  }
  if (name === 'expenses' && !_expensesInited) {
    initExpenses();
    _expensesInited = true;
  }
  if (name === 'receipt' && !_receiptInited) {
    initReceipt();
    _receiptInited = true;
  }

  // Після будь-якого переходу — повернути фокус на barcode-input
  // Затримка 60 мс щоб браузер завершив перехід фокусу в попередньому екрані
  setTimeout(() => document.getElementById('barcode-input')?.focus(), 60);
}

// ─── ЗАГОЛОВОК ────────────────────────────────────────────────────────────────

const SCREEN_TITLES = {
  'shift-open':  'Відкрити зміну',
  'shift-close': 'Закрити зміну',
  'expenses':    'Витрата',
  'receipt':     'Прихід товару',
};

function _updateHeader(name) {
  const backBtn   = document.getElementById('hdr-back');
  const titleEl   = document.getElementById('hdr-title');
  const shopEl    = document.getElementById('hdr-shop');
  const cashierEl = document.getElementById('hdr-cashier');
  const shiftEl   = document.getElementById('hdr-shift');
  const syncDot   = document.getElementById('sync-dot');
  const scanBadge = document.getElementById('scan-badge');

  // Спочатку ховаємо все
  [backBtn, titleEl, shopEl, cashierEl, shiftEl, syncDot, scanBadge].forEach(e => {
    if (e) e.hidden = true;
  });

  if (name === 'login') {
    if (titleEl) {
      titleEl.hidden      = false;
      titleEl.textContent = 'Облік продажів';
    }
  } else if (name === 'pos') {
    [syncDot, scanBadge].forEach(e => { if (e) e.hidden = false; });
    updatePOSHeader();
  } else {
    // Вторинні екрани: стрілка назад + назва
    if (backBtn) backBtn.hidden = false;
    if (titleEl) {
      titleEl.hidden      = false;
      titleEl.textContent = SCREEN_TITLES[name] ?? '';
    }
  }
}

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  // 1. Конфігурація движка синхронізації (ключі в localStorage задає адміністратор)
  configureSyncEngine({
    gasUrl:    localStorage.getItem('gasUrl')    ?? 'https://script.google.com/macros/s/AKfycbxKvUd0aOrbb5EQU_xX117qX3Opnzs_jNK0JHjAX0HJkbb27h9TuieYRXSqxr5ThtNF/exec',
    apiSecret: localStorage.getItem('apiSecret') ?? 'H1MNaT6RrBatEs6K22BsExhjczmHreLn',
    shopId:    localStorage.getItem('shopId')    ?? '',
  });
  setupOnlineListener();

  // 2. Сканер: ініціалізувати з відео-елементом
  initScanner({ videoElement: document.getElementById('scanner-video') });

  // 3. PIN-клавіатура
  _initPinPad();

  // 4. Кнопка «назад» у заголовку
  document.getElementById('hdr-back')?.addEventListener('click', () => showScreen('pos'));

  // 5. Початкова синхронізація — завантажити список касирів і товарів з GAS
  //    перед відображенням екрана входу (потребує shopId у localStorage)
  if (navigator.onLine) {
    await Promise.allSettled([refreshEmployeeCache(), refreshProductCache()]);
  }

  // 6. Прибрати застарілі зміни (залишити найновішу, якщо є кілька)
  await _cleanupStaleShifts();

  // 7. Завжди починати з PIN — сесія зберігається тільки в пам'яті і скидається при перезавантаженні
  showScreen('login');
});

// ─── PIN ─────────────────────────────────────────────────────────────────────

function _initPinPad() {
  let pin = '';
  const dots    = document.querySelectorAll('.pin-dot');
  const errorEl = document.getElementById('login-error');

  function _syncDots() {
    dots.forEach((d, i) => d.classList.toggle('filled', i < pin.length));
  }

  document.querySelectorAll('.pin-key').forEach(key => {
    key.addEventListener('click', async () => {
      const v = key.dataset.value;

      if (v === 'del') {
        pin = pin.slice(0, -1);
      } else if (pin.length < 6) {
        pin += v;
      }

      _syncDots();
      if (errorEl) errorEl.textContent = '';

      // Пробуємо авторизацію при 4 і 6 символах
      if (pin.length === 4 || pin.length === 6) {
        const result = await login(pin);
        if (result.success) {
          pin = '';
          _syncDots();
          await _navigateAfterAuth();
        } else if (pin.length === 6) {
          // 6 символів — точно невірний PIN
          if (errorEl) errorEl.textContent = result.error ?? 'Невірний PIN';
          pin = '';
          _syncDots();
        }
        // 4 символи + невдача → продовжуємо вводити (може бути 6-значний PIN)
      }
    });
  });
}

// При старті: якщо в IndexedDB є зміни для кількох магазинів (нештатна ситуація),
// залишаємо тільки найновішу за opened_at, решту видаляємо.
async function _cleanupStaleShifts() {
  const shifts = await getAllShifts();
  if (shifts.length <= 1) return;
  shifts.sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at));
  for (const stale of shifts.slice(1)) {
    await clearShift(stale.shop_id);
  }
}

async function _navigateAfterAuth() {
  const session = getPublicSession();
  if (!session) { showScreen('login'); return; }
  // Always go through shift-open so the cashier confirms shop and meter.
  // If an active shift exists it will pre-fill those fields (see shift.js).
  showScreen('shift-open');
}

// ─── ВИХІД ПІСЛЯ ЗАКРИТТЯ ЗМІНИ ──────────────────────────────────────────────
// Викликається з shift.js після відображення зарплати

document.addEventListener('shift:closed', () => {
  logout();
  _shiftCloseInited = false;
  showScreen('login');
});
