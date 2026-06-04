// ─────────────────────────────────────────────────────────────────────────────
//  ARCHIVE.GS — щомісячне архівування оперативних даних
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
//  archiveMonth — точка входу (викликається тригером 1-го числа о 02:00)
//  і через doPost type: 'archive_month' (тільки від адміністратора)
// ─────────────────────────────────────────────────────────────────────────────

function archiveMonth(payload) {
  return archiveMonth_();
}

function archiveMonth_() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const monthKey  = getSetting('CURRENT_MONTH') || currentMonthKey();

  // ── Крок 1: перевірити що всі зміни закриті ──────────────────────────────
  const openShifts = countOpenShifts_(ss);
  if (openShifts > 0) {
    const msg = `Архівування скасовано: ${openShifts} зміна(и) ще відкрита. Спочатку закрийте всі зміни.`;
    logOperation({ type: 'archive_month', status: 'error', error: msg });
    return errorResponse(msg, 'open_shifts_exist');
  }

  // ── Крок 2: створити архівну таблицю ─────────────────────────────────────
  const archiveFolderId = getSetting('ARCHIVE_FOLDER_ID');
  const archiveName     = 'Archive_' + monthKey;
  let archiveSS;

  try {
    archiveSS = SpreadsheetApp.create(archiveName);
    if (archiveFolderId) {
      const folder = DriveApp.getFolderById(String(archiveFolderId));
      DriveApp.getFileById(archiveSS.getId()).moveTo(folder);
    }
  } catch (err) {
    logOperation({ type: 'archive_month', status: 'error', error: 'Не вдалося створити архів: ' + err.message });
    return errorResponse('Не вдалося створити архів: ' + err.message, 'create_failed');
  }

  // ── Кроки 3–5: копіювання + перевірка цілісності + очищення ─────────────
  // Масив тут, а не на рівні файлу — SHEET_* константи гарантовано ініціалізовані
  const ARCHIVE_SHEET_NAMES = [
    SHEET_SALES,      // Продажі
    SHEET_RECEIPTS,   // Прихід
    SHEET_EXPENSES,   // Витрати
    SHEET_ADMIN_CASH, // Каса_Адміністратора
    SHEET_PAYROLL,    // Зарплатна_Відомість
    SHEET_ENERGY,     // Енергооблік
    SHEET_WRITEOFFS,  // Списання
    SHEET_LOG,        // Журнал_Операцій
    SHEET_SHIFTS      // Зміни (закриті)
  ];
  const integrityErrors = [];

  for (const sheetName of ARCHIVE_SHEET_NAMES) {
    const sourceSheet = ss.getSheetByName(sheetName);
    if (!sourceSheet) continue;

    const sourceLastRow = sourceSheet.getLastRow();
    if (sourceLastRow <= 1) continue; // Тільки заголовок — нічого архівувати

    // Отримати всі дані включно з заголовком
    const allData      = sourceSheet.getDataRange().getValues();
    const headerRow    = allData[0];
    const dataRows     = allData.slice(1);
    const sourceCount  = dataRows.length;

    // Створити аркуш в архіві
    let archiveSheet = archiveSS.getSheetByName(sheetName);
    if (!archiveSheet) {
      archiveSheet = archiveSS.insertSheet(sheetName);
    }
    archiveSheet.clearContents();

    // Записати заголовок та дані
    archiveSheet.getRange(1, 1, 1,         headerRow.length).setValues([headerRow]);
    archiveSheet.getRange(2, 1, sourceCount, headerRow.length).setValues(dataRows);

    // ── ПЕРЕВІРКА ЦІЛІСНОСТІ ──────────────────────────────────────────────
    // Порівняти кількість рядків у архіві та джерелі.
    // Очищення відбувається ТІЛЬКИ якщо count-и співпадають.
    const archiveCount = archiveSheet.getLastRow() - 1; // Мінус рядок заголовка
    if (archiveCount !== sourceCount) {
      integrityErrors.push(
        `${sheetName}: очікувалось ${sourceCount} рядків, в архіві ${archiveCount}`
      );
      continue; // Не очищуємо — залишаємо дані в оперативній таблиці
    }

    // ── ОЧИЩЕННЯ: видалити дані, зберегти заголовок ───────────────────────
    if (sourceLastRow > 1) {
      sourceSheet.getRange(2, 1, sourceLastRow - 1, sourceSheet.getLastColumn()).clearContent();
    }
  }

  // Видалити порожній Sheet1 що Google створює автоматично
  const defaultSheet = archiveSS.getSheetByName('Sheet1');
  if (defaultSheet && archiveSS.getSheets().length > 1) {
    archiveSS.deleteSheet(defaultSheet);
  }

  // ── Крок 6: оновити CURRENT_MONTH на наступний місяць ────────────────────
  if (integrityErrors.length === 0) {
    const nextMonth = getNextMonthKey_(monthKey);
    setSetting('CURRENT_MONTH', nextMonth);
  }

  // ── Крок 7: записати результат в журнал ──────────────────────────────────
  if (integrityErrors.length > 0) {
    const errMsg = 'Архів створено, але є помилки цілісності: ' + integrityErrors.join('; ');
    logOperation({ type: 'archive_month', status: 'error', error: errMsg });
    return successResponse({
      archive_name:     archiveName,
      archive_id:       archiveSS.getId(),
      integrity_errors: integrityErrors,
      warning:          'Деякі листи НЕ очищені через помилку цілісності'
    });
  }

  logOperation({
    type:   'archive_month',
    status: 'ok',
    error:  `Архів ${archiveName} створено успішно`
  });

  return successResponse({
    archive_name: archiveName,
    archive_id:   archiveSS.getId(),
    new_month:    getSetting('CURRENT_MONTH')
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ДОПОМІЖНИКИ
// ─────────────────────────────────────────────────────────────────────────────

/** Повертає кількість відкритих змін у поточній оперативній таблиці. */
function countOpenShifts_(ss) {
  const sheet = ss.getSheetByName(SHEET_SHIFTS);
  if (!sheet || sheet.getLastRow() <= 1) return 0;

  const data    = sheet.getDataRange().getValues();
  const hdr     = data[0];
  const iStatus = hdr.indexOf('Статус');
  if (iStatus < 0) return 0;

  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iStatus]) === 'Відкрита') count++;
  }
  return count;
}

/**
 * Обчислює ключ наступного місяця з поточного (формат YYYY_MM).
 * '2026_06' → '2026_07', '2026_12' → '2027_01'
 */
function getNextMonthKey_(currentKey) {
  const parts = String(currentKey).split('_');
  let year    = parseInt(parts[0], 10);
  let month   = parseInt(parts[1], 10);

  month++;
  if (month > 12) { month = 1; year++; }

  return year + '_' + String(month).padStart(2, '0');
}
