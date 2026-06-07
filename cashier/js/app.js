// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/app.js — маршрутизатор екранів PWA касира
// ─────────────────────────────────────────────────────────────────────────────

import { configureSyncEngine, setupOnlineListener, refreshEmployeeCache, refreshProductCache, refreshSettingsCache } from './sync.js';
import { login, logout, getPublicSession } from './auth.js';
import { getAllShifts, clearShift } from './db.js';
import { initScanner }          from './scanner.js';
import { initPOS, updatePOSHeader }    from './pos.js';
import { initShiftOpen, initShiftClose, resetShiftClose } from './shift.js';
import { initExpenses }         from './expenses.js';
import { initReceipt }          from './receipt.js';

// ─── СТАН РОУТЕРА ─────────────────────────────────────────────────────────────

const SCREENS = ['login', 'setup', 'shift-open', 'pos', 'shift-close', 'expenses', 'receipt'];

let _posInited        = false;
let _shiftOpenInited  = false;
let _shiftCloseInited = false;
let _expensesInited   = false;
let _receiptInited    = false;
let _setupInited      = false;

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
  if (name === 'setup') {
    _prefillSetup();
    if (!_setupInited) { _initSetupScreen(); _setupInited = true; }
  }

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
  setTimeout(() => document.getElementById('barcode-input')?.focus({ preventScroll: true }), 60);
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
  const setupBtn  = document.getElementById('hdr-setup');

  // Спочатку ховаємо все
  [backBtn, titleEl, shopEl, cashierEl, shiftEl, syncDot, scanBadge, setupBtn].forEach(e => {
    if (e) e.hidden = true;
  });

  if (name === 'login') {
    if (titleEl) {
      titleEl.hidden      = false;
      titleEl.textContent = 'Облік продажів';
    }
    if (setupBtn) setupBtn.hidden = false;
  } else if (name === 'setup') {
    if (titleEl) {
      titleEl.hidden      = false;
      titleEl.textContent = 'Налаштування';
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
    gasUrl:    localStorage.getItem('gasUrl')    ?? '',
    apiSecret: localStorage.getItem('apiSecret') ?? '',
    shopId:    localStorage.getItem('shopId')    ?? '',
  });
  setupOnlineListener();

  // 2. Сканер: ініціалізувати з відео-елементом
  initScanner({ videoElement: document.getElementById('scanner-video') });

  // 3. PIN-клавіатура
  _initPinPad();

  // 4. Кнопки заголовку
  document.getElementById('hdr-back')?.addEventListener('click', () => showScreen('pos'));
  document.getElementById('hdr-setup')?.addEventListener('click', () => _showAdminPinModal());

  // 5. Якщо налаштування відсутні — одразу відкрити екран первинного налаштування
  if (!localStorage.getItem('gasUrl') || !localStorage.getItem('shopId')) {
    showScreen('setup');
    return;
  }

  // 6. Початкова синхронізація — завантажити список касирів і товарів з GAS
  //    перед відображенням екрана входу (потребує shopId у localStorage)
  if (navigator.onLine) {
    await Promise.allSettled([refreshEmployeeCache(), refreshProductCache(), refreshSettingsCache()]);
  }

  // 7. Прибрати застарілі зміни (залишити найновішу, якщо є кілька)
  await _cleanupStaleShifts();

  // 8. Завжди починати з PIN — сесія зберігається тільки в пам'яті і скидається при перезавантаженні
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
  // Refresh catalogues right after login so the cashier always has fresh data.
  if (navigator.onLine) {
    await Promise.allSettled([refreshProductCache(), refreshEmployeeCache(), refreshSettingsCache()]);
  }
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

// ─── МОДАЛЬНЕ ВІКНО: ПЕРЕВІРКА PIN АДМІНІСТРАТОРА ─────────────────────────────

function _showAdminPinModal() {
  let modal = document.getElementById('modal-admin-pin');
  if (!modal) {
    modal = document.createElement('div');
    modal.id        = 'modal-admin-pin';
    modal.className = 'modal-overlay';
    modal.hidden    = true;
    modal.innerHTML = `
      <div class="modal" style="background:var(--c-primary)">
        <p class="modal__title" style="color:#fff">Доступ до налаштувань</p>
        <p style="font-size:.875rem;color:rgba(255,255,255,.72);text-align:center;margin-bottom:12px">
          Введіть PIN адміністратора або менеджера
        </p>
        <div class="pin-dots">
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
          <div class="pin-dot"></div>
        </div>
        <p id="modal-admin-pin-error"
           style="color:#FFCDD2;font-size:.875rem;min-height:1.3em;margin-top:4px;text-align:center"
           role="alert"></p>
        <div id="modal-admin-pin-keyboard" class="pin-keyboard" style="margin:8px auto 0"
             role="group" aria-label="Цифрова клавіатура">
          <button class="pin-key" data-value="1">1</button>
          <button class="pin-key" data-value="2">2</button>
          <button class="pin-key" data-value="3">3</button>
          <button class="pin-key" data-value="4">4</button>
          <button class="pin-key" data-value="5">5</button>
          <button class="pin-key" data-value="6">6</button>
          <button class="pin-key" data-value="7">7</button>
          <button class="pin-key" data-value="8">8</button>
          <button class="pin-key" data-value="9">9</button>
          <button class="pin-key pin-key--empty" aria-hidden="true" tabindex="-1"></button>
          <button class="pin-key" data-value="0">0</button>
          <button class="pin-key pin-key--backspace" data-value="del" aria-label="Видалити">⌫</button>
        </div>
        <div class="modal__actions" style="margin-top:12px">
          <button id="modal-admin-pin-cancel" class="btn btn--outline"
                  style="color:#fff;border-color:rgba(255,255,255,.35);flex:1">Скасувати</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  const dots     = modal.querySelectorAll('.pin-dot');
  const errorEl  = document.getElementById('modal-admin-pin-error');
  const keyboard = document.getElementById('modal-admin-pin-keyboard');
  const cancelBtn = document.getElementById('modal-admin-pin-cancel');

  let pin = '';

  function _syncDots() {
    dots.forEach((d, i) => d.classList.toggle('filled', i < pin.length));
  }

  pin = '';
  errorEl.textContent = '';
  _syncDots();
  modal.hidden = false;

  modal.onclick   = (e) => { if (e.target === modal) modal.hidden = true; };
  cancelBtn.onclick = () => { modal.hidden = true; };

  keyboard.onclick = async (e) => {
    const key = e.target.closest('[data-value]');
    if (!key) return;

    const v = key.dataset.value;
    if (v === 'del') {
      pin = pin.slice(0, -1);
    } else if (pin.length < 6) {
      pin += v;
    }

    _syncDots();
    errorEl.textContent = '';

    if (pin.length !== 4 && pin.length !== 6) return;

    keyboard.style.pointerEvents = 'none';
    const result = await login(pin);
    keyboard.style.pointerEvents = '';

    if (result.success) {
      const role    = result.session?.role ?? '';
      const allowed = role === 'Адміністратор' || role === 'Менеджер';
      logout();
      if (!allowed) {
        errorEl.textContent = 'Доступ заборонено';
        pin = '';
        _syncDots();
        return;
      }
      modal.hidden = true;
      showScreen('setup');
      return;
    }

    if (pin.length === 6) {
      errorEl.textContent = 'Доступ заборонено';
      pin = '';
      _syncDots();
    }
    // 4 цифри + невдача → продовжуємо вводити (може бути 6-значний PIN)
  };
}

// ─── ЕКРАН НАЛАШТУВАНЬ ────────────────────────────────────────────────────────

function _prefillSetup() {
  const urlEl    = document.getElementById('setup-gas-url');
  const secretEl = document.getElementById('setup-api-secret');
  const shopEl   = document.getElementById('setup-shop-id');
  const backBtn  = document.getElementById('btn-setup-back');
  const errorEl  = document.getElementById('setup-error');
  const statusEl = document.getElementById('setup-status');

  if (urlEl)    urlEl.value    = localStorage.getItem('gasUrl')    ?? '';
  if (secretEl) secretEl.value = localStorage.getItem('apiSecret') ?? '';
  if (shopEl)   shopEl.value   = localStorage.getItem('shopId')    ?? '';
  if (errorEl)  errorEl.textContent  = '';
  if (statusEl) statusEl.textContent = '';

  // Кнопка «Назад» — тільки якщо налаштування вже існують (прийшли з логіну)
  if (backBtn) backBtn.hidden = !(localStorage.getItem('gasUrl') && localStorage.getItem('shopId'));
}

function _initSetupScreen() {
  const form     = document.getElementById('form-setup');
  const errorEl  = document.getElementById('setup-error');
  const statusEl = document.getElementById('setup-status');
  const saveBtn  = document.getElementById('btn-setup-save');

  document.getElementById('btn-setup-back')?.addEventListener('click', () => showScreen('login'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = '';

    const gasUrl    = document.getElementById('setup-gas-url').value.trim();
    const apiSecret = document.getElementById('setup-api-secret').value.trim();
    const shopId    = document.getElementById('setup-shop-id').value.trim();

    if (!gasUrl || !apiSecret || !shopId) {
      if (errorEl) errorEl.textContent = 'Заповніть усі поля';
      return;
    }

    localStorage.setItem('gasUrl',    gasUrl);
    localStorage.setItem('apiSecret', apiSecret);
    localStorage.setItem('shopId',    shopId);

    configureSyncEngine({ gasUrl, apiSecret, shopId });

    if (saveBtn)  saveBtn.disabled    = true;
    if (statusEl) statusEl.textContent = 'Підключення до сервера…';

    if (navigator.onLine) {
      await Promise.allSettled([
        refreshEmployeeCache(),
        refreshProductCache(),
        refreshSettingsCache(),
      ]);
    }

    if (saveBtn)  saveBtn.disabled    = false;
    if (statusEl) statusEl.textContent = '';

    showScreen('login');
  });
}
