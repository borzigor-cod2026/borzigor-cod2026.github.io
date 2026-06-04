// ─────────────────────────────────────────────────────────────────────────────
//  AAA_Constants.gs — всі глобальні константи бекенду
//
//  Файл починається з "AAA_" щоб Apps Script завантажував його ПЕРШИМ
//  (алфавітний порядок). Всі інші .gs файли можуть вільно використовувати
//  ці константи без ризику ReferenceError.
// ─────────────────────────────────────────────────────────────────────────────

// ─── НАЗВИ АРКУШІВ ───────────────────────────────────────────────────────────

const SHEET_SETTINGS   = 'Налаштування';
const SHEET_PRODUCTS   = 'Товари';
const SHEET_SALES      = 'Продажі';
const SHEET_RECEIPTS   = 'Прихід';
const SHEET_EXPENSES   = 'Витрати';
const SHEET_ADMIN_CASH = 'Каса_Адміністратора';
const SHEET_INVENTORY  = 'Інвентаризація';
const SHEET_EMPLOYEES  = 'Співробітники';
const SHEET_PAYROLL    = 'Зарплатна_Відомість';
const SHEET_ENERGY     = 'Енергооблік';
const SHEET_WRITEOFFS  = 'Списання';
const SHEET_LOG        = 'Журнал_Операцій';
const SHEET_SHIFTS     = 'Зміни';
const SHEET_DASHBOARD  = 'Дашборд';

// ─── ФОРМАТИ ─────────────────────────────────────────────────────────────────
//  DATE_FORMAT / DATETIME_FORMAT — для setNumberFormat() в Google Sheets.
//  Для Utilities.formatDate() використовується Java SimpleDateFormat окремо.

const KYIV_TZ         = 'Europe/Kiev';
const DATE_FORMAT     = 'DD.MM.YYYY';
const DATETIME_FORMAT = 'DD.MM.YYYY HH:mm';
const CURRENCY_FORMAT = '# ##0,00 ₴';

// ─── ВЕРСІЯ API ───────────────────────────────────────────────────────────────

const API_CURRENT_VERSION = '2';
