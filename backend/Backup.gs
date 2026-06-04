// ─────────────────────────────────────────────────────────────────────────────
//  BACKUP.GS — щоденне резервне копіювання оперативної таблиці
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Зберігає копію оперативної таблиці в папку BACKUP_FOLDER_ID.
 * Формат імені: Backup_YYYY-MM-DD (за часовим поясом Europe/Kiev).
 * Зберігаються тільки останні 7 копій — старші видаляються.
 *
 * Викликається time-based тригером щодня о 03:00 (Europe/Kiev).
 * Щоб встановити тригер: виконати setupBackupTrigger() один раз вручну.
 */
function dailyBackup() {
  const folderId = getSetting('BACKUP_FOLDER_ID');
  if (!folderId) {
    logOperation({ type: 'daily_backup', status: 'error', error: 'BACKUP_FOLDER_ID не налаштовано в Налаштуваннях' });
    return;
  }

  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const backupName  = 'Backup_' + Utilities.formatDate(new Date(), KYIV_TZ, 'yyyy-MM-dd');

  try {
    const folder     = DriveApp.getFolderById(String(folderId));
    const backupFile = ss.copy(backupName);
    DriveApp.getFileById(backupFile.getId()).moveTo(folder);

    // Видалити копії старші 7 днів
    deleteOldBackups_(folder, 7);

    logOperation({ type: 'daily_backup', status: 'ok', error: backupName + ' створено' });

  } catch (err) {
    logOperation({ type: 'daily_backup', status: 'error', error: err.message });
  }
}

/** Видаляє backup-файли, залишаючи тільки keepCount найновіших. */
function deleteOldBackups_(folder, keepCount) {
  const files    = [];
  const iterator = folder.getFilesByType(MimeType.GOOGLE_SHEETS);

  while (iterator.hasNext()) {
    const file = iterator.next();
    if (file.getName().startsWith('Backup_')) {
      files.push(file);
    }
  }

  // Сортувати від найновішого до найстарішого
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());

  // Видалити все, що виходить за межу keepCount
  for (let i = keepCount; i < files.length; i++) {
    files[i].setTrashed(true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ВСТАНОВЛЕННЯ ТРИГЕРА
//  Виконати один раз вручну: Розширення → Apps Script → Виконати → setupBackupTrigger
// ─────────────────────────────────────────────────────────────────────────────

function setupBackupTrigger() {
  // Видалити існуючий тригер щоб не дублювати
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyBackup')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('dailyBackup')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone(KYIV_TZ)
    .create();

  Logger.log('Тригер dailyBackup встановлено: щодня о 03:00 Europe/Kiev');
}

/**
 * Встановлює тригер archiveMonth: 1-го числа кожного місяця о 02:00.
 * Виконати один раз вручну після розгортання.
 */
function setupArchiveTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'archiveMonth_')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('archiveMonth_')
    .timeBased()
    .onMonthDay(1)
    .atHour(2)
    .inTimezone(KYIV_TZ)
    .create();

  Logger.log('Тригер archiveMonth_ встановлено: 1-го числа кожного місяця о 02:00 Europe/Kiev');
}

/** Встановлює обидва тригери за один виклик. */
function setupAllTriggers() {
  setupBackupTrigger();
  setupArchiveTrigger();
  SpreadsheetApp.getUi().alert('✅ Тригери встановлено:\n• Backup: щодня 03:00\n• Archive: 1-го числа 02:00\n(часовий пояс: Europe/Kiev)');
}
