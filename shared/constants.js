// ─────────────────────────────────────────────────────────────────────────────
//  shared/constants.js — спільні константи для PWA касира та адміністратора
// ─────────────────────────────────────────────────────────────────────────────

export const API_VERSION = '2';

// ─── IndexedDB ───────────────────────────────────────────────────────────────

export const CASHIER_DB_NAME = 'cashier_pos_v1';
export const ADMIN_DB_NAME   = 'admin_panel_v1';
export const DB_VERSION      = 3;

export const STORES = {
  PENDING_OPS:   'pending_operations',
  PRODUCTS:      'products',
  EMPLOYEES:     'employees',
  CURRENT_SHIFT: 'current_shift',
  SYNC_LOG:      'sync_log',
  SETTINGS:      'settings',
};

// ─── Статуси синхронізації (ТЗ розділ 4) ────────────────────────────────────

export const SYNC_STATUS = {
  PENDING:  'pending',   // Збережено локально, очікує відправки
  SYNCED:   'synced',    // Записано в Google Sheets
  ERROR:    'error',     // Помилка, потрібна повторна спроба
  CONFLICT: 'conflict',  // UUID вже існує на сервері — дублікат відхилено
};

// ─── Типи операцій ───────────────────────────────────────────────────────────

export const OP_TYPES = {
  SALE:            'sale',
  RECEIPT:         'receipt',
  EXPENSE:         'expense',
  WRITEOFF:        'writeoff',
  INVENTORY:       'inventory',
  NEW_PRODUCT:     'new_product',
  OPEN_SHIFT:      'open_shift',
  CLOSE_SHIFT:     'close_shift',
  CASH_COLLECTION: 'cash_collection',
};

// ─── Повторні спроби (exponential backoff, ТЗ розділ 9.2) ───────────────────
//  attempt 1 →  1 хв
//  attempt 2 →  5 хв
//  attempt 3+ → 30 хв

export const BACKOFF_DELAYS_MS = [
  1  * 60 * 1000,  //  60 000 мс
  5  * 60 * 1000,  // 300 000 мс
  30 * 60 * 1000,  // 1 800 000 мс
];

// ─── Групи товарів (мають збігатися з PRODUCT_GROUPS у Налаштуваннях GAS) ───

export const PRODUCT_GROUPS = [
  'Тютюнові вироби',
  'Пиво та напої',
  'Мінвода та соки',
  'Алкогольні напої',
  'Штучні товари',
  'Кава',
];

// ─── Формати відображення ────────────────────────────────────────────────────

export const CURRENCY_SYMBOL = '₴';

export const DATE_LOCALE_OPTIONS = {
  day:   '2-digit',
  month: '2-digit',
  year:  'numeric',
};

export const DATETIME_LOCALE_OPTIONS = {
  ...DATE_LOCALE_OPTIONS,
  hour:   '2-digit',
  minute: '2-digit',
};

export const LOCALE = 'uk-UA';
