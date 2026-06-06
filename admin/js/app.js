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

const SCREENS = ['login', 'dashboard', 'expenses', 'inventory', 'salary', 'products', 'cash', 'reports'];

const NAV_SCREENS = ['dashboard', 'expenses', 'inventory', 'salary', 'products', 'cash', 'reports'];

let _activeScreen = null;

export function showScreen(name) {
  SCREENS.forEach(s => {
    document.getElementById(`screen-${s}`)?.classList.toggle('is-active', s === name);
  });

  _activeScreen = name;
  _updateNav(name);
  // Показати кнопку виходу на всіх екранах крім логіну
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.hidden = name === 'login';

  // Ліниво ініціалізувати при першому показі
  // Dashboard і reports перезавантажуються при кожному показі (свіжі дані)
  if (name === 'dashboard') initDashboard();
  if (name === 'expenses')  initExpenses();
  if (name === 'inventory') initInventory();
  if (name === 'salary')    initSalary();
  if (name === 'products')  initProducts();
  if (name === 'cash')      initCash();
  if (name === 'reports')   initReports();
}

function _updateNav(name) {
  const nav = document.getElementById('admin-nav');
  if (!nav) return;
  nav.hidden = name === 'login';
  nav.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.screen === name);
  });
}

// ─── ІНІЦІАЛІЗАЦІЯ ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Читати конфіг з localStorage
  const gasUrl    = localStorage.getItem('admin_gasUrl')    ?? '';
  const apiSecret = localStorage.getItem('admin_apiSecret') ?? '';
  configureAuth({ gasUrl, apiSecret });
  configureSyncEngine({ gasUrl, apiSecret, shopId: 'all' });
  setupOnlineListener();

  // Навігація по табах
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  });

  // Кнопка виходу
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    logout();
    showScreen('login');
  });

  // PIN-клавіатура
  _initPinPad();

  showScreen(isAuthenticated() ? 'dashboard' : 'login');
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
          showScreen('dashboard');
        } else if (pin.length === 6 || !result.maybeMore) {
          if (errorEl) errorEl.textContent = result.error ?? 'Невірний PIN';
          pin = ''; _syncDots();
        }
      }
    });
  });
}
