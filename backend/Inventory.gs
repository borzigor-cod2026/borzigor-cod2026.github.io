// ─────────────────────────────────────────────────────────────────────────────
//  INVENTORY.GS — затвердження інвентаризації
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Затверджує інвентаризаційний сеанс.
 *
 * payload.inventory_shift_id — Зміна_ID сеансу інвентаризації.
 *
 * Дії:
 *  - Рядки зі статусом «Завершена» → перезаписати Залишок в Товари, змінити статус на «Затверджена»
 *  - Рядки зі статусом «Чернетка» → видалити (незавершені позиції)
 *
 * updateStock_() визначено в Sync.gs (доступна з усіх файлів проекту).
 */
function approveInventory(payload) {
  const shiftId    = payload.inventory_shift_id;
  const shopId     = payload.shop_id  || '';
  const approvedBy = payload.approved_by || 'admin';

  if (!shiftId) return errorResponse('inventory_shift_id обовʼязковий', 'bad_request');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_INVENTORY);

  // Читаємо всі дані один раз
  const data    = sheet.getDataRange().getValues();
  const hdr     = data[0];
  const iShift   = hdr.indexOf('Зміна_ID');
  const iProduct = hdr.indexOf('ID_Товару');
  const iCounted = hdr.indexOf('Пораховано_Факт');
  const iStatus  = hdr.indexOf('Статус');
  const iShopCol = hdr.indexOf('Магазин_ID');

  if (iShift < 0 || iProduct < 0 || iCounted < 0 || iStatus < 0) {
    return errorResponse('Структура аркуша Інвентаризація не відповідає очікуваній', 'schema_error');
  }

  let updatedCount = 0;
  const draftRows  = [];  // Рядки для видалення (знизу вгору щоб не зсувати індекси)

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][iShift]) !== String(shiftId)) continue;

    const status    = String(data[i][iStatus]);
    const productId = String(data[i][iProduct]);
    const rowShopId = iShopCol >= 0 ? String(data[i][iShopCol]) : shopId;

    if (status === 'Чернетка') {
      draftRows.push(i + 1);  // Зберігаємо номер рядка (1-based)
      continue;
    }

    if (status === 'Завершена') {
      const counted = Number(data[i][iCounted]);

      // inventory: delta = нове значення (не різниця!)
      updateStock_('inventory', productId, counted, rowShopId);

      // Змінити статус на «Затверджена» (column iStatus, row i+1, 1-based)
      sheet.getRange(i + 1, iStatus + 1).setValue('Затверджена');
      updatedCount++;
    }
  }

  // Видалити чернеткові рядки знизу вгору (видалення знизу не зсуває вищі рядки)
  for (let j = draftRows.length - 1; j >= 0; j--) {
    sheet.deleteRow(draftRows[j]);
  }

  logOperation({
    uuid:    generateUUID(),
    type:    'approve_inventory',
    shopId:  shopId,
    shiftId: shiftId,
    user:    approvedBy,
    status:  'ok',
    error:   `Затверджено: ${updatedCount}, видалено чернеток: ${draftRows.length}`
  });

  return successResponse({
    updated_count:  updatedCount,
    deleted_drafts: draftRows.length
  });
}
