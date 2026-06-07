// ─────────────────────────────────────────────────────────────────────────────
//  admin/js/app.js — маршрутизатор адмін-панелі
// ─────────────────────────────────────────────────────────────────────────────

import { configureAuth, login, logout, isAuthenticated }  from './auth.js';
import { configureSyncEngine, setupOnlineListener }       from './sync.js';
import { initDashboard }  from './dashboard.js';
import { initExpenses }   from './expenses.js';
import { initInventory }  from './inventory.js';
import { initSalary }     from './salary.js';
import { initProducts }   from './products.js';
import { initCash }       from './cash.js';
import { initReports }    from './reports.js';

// ─── SCREENS ─────────────────────────────────────────────────────────────────

const SCREENS = ['login', 'home', 'dashboard', 'expenses', 'inventory', 'salary', 'products', 'cash', 'reports'];

const SECTION_SCREENS = ['dashboard', 'expenses', 'inventory', 'salary', 'products', 'cash', 'reports'];

let _activeScreen = null;

export function showScreen(name) {
  // Auth guard — redirect to login if not authenticated
  if (name !== 'login' && !isAuthenticated()) {
    _activateScreen('login');
    return;
  }

  _activateScreen(name);

  // Lazy-init section screens; dashboard and reports reload every time for fresh data
  if (name === 'dashboard') initDashboard();
  if (name === 'expenses')  initExpenses();
  if (name === 'inventory') initInventory();
  if (name === 'salary')    initSalary();
  if (name === 'products')  initProducts();
  if (name === 'cash')      initCash();
  if (name === 'reports')   initReports();
}

function _activateScreen(name) {
  SCREENS.forEach(s => {
    document.getElementById(`screen-${s}`)?.classList.toggle('is-active', s === name);
  });
  _activeScreen = name;
  _updateHeader(name);
}

function _updateHeader(name) {
  const isSection = SECTION_SCREENS.includes(name);
  document.getElementById('btn-back')?.toggleAttribute('hidden', !isSection);
  document.getElementById('btn-logout')?.toggleAttribute('hidden', name !== 'home');
}

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Читати конфіг з localStorage (fallback до hardcoded у utils.js та auth.js)
  const gasUrl    = localStorage.getItem('admin_gasUrl')    ?? '';
  const apiSecret = localStorage.getItem('admin_apiSecret') ?? '';
  configureAuth({ gasUrl, apiSecret });
  configureSyncEngine({ gasUrl, apiSecret, shopId: 'all' });
  setupOnlineListener();

  // Картки головного меню
  document.querySelectorAll('.home-card[data-screen]').forEach(card => {
    card.addEventListener('click', () => showScreen(card.dataset.screen));
  });

  // Кнопка "← Назад"
  document.getElementById('btn-back')?.addEventListener('click', () => showScreen('home'));

  // Кнопка виходу
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    logout();
    showScreen('login');
  });

  // PIN-клавіатура
  _initPinPad();

  showScreen(isAuthenticated() ? 'home' : 'login');
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
      if (v === 'del') pin = pin.slice(0, -1);
      else if (pin.length < 6) pin += v;

      _syncDots();
      if (errorEl) errorEl.textContent = '';

      if (pin.length === 4 || pin.length === 6) {
        key.closest('.pin-keyboard')?.querySelectorAll('.pin-key').forEach(k => { k.disabled = true; });

        const result = await login(pin);

        key.closest('.pin-keyboard')?.querySelectorAll('.pin-key').forEach(k => { k.disabled = false; });

        if (result.success) {
          pin = ''; _syncDots();
          // Use _activateScreen directly to bypass the auth guard timing issue on iOS Safari
          _activateScreen('home');
        } else if (pin.length === 6 || !result.maybeMore) {
          if (errorEl) errorEl.textContent = result.error ?? 'Невірний PIN';
          pin = ''; _syncDots();
        }
      }
    });
  });
}
