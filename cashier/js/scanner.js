// ─────────────────────────────────────────────────────────────────────────────
//  cashier/js/scanner.js — HID-детектор + камера BarcodeDetector
//
//  Детектує штрихкоди та емітує подію 'scanner:barcode'.
//  Логіка обробки (пошук товару, звуки, кошик) — в pos.js.
// ─────────────────────────────────────────────────────────────────────────────

const HID_SPEED_THRESH = 20;       // символів/с — поріг HID vs клавіатура
const HID_MIN_LEN      = 4;        // мінімальна довжина штрихкоду
const HID_FLUSH_MS     = 80;       // мс очікування Enter після останнього символу
const CAMERA_IDLE_MS   = 60_000;   // мс без HID → відновити камеру
const CAMERA_DEBOUNCE  = 1_500;    // пауза між зчитуваннями камери
const CAMERA_POLL_MS   = 150;      // інтервал кадрів детектора (~7 fps)
const CAMERA_CHECK_MS  = 10_000;   // перевірка відновлення камери

// ─── СТАН ────────────────────────────────────────────────────────────────────

let _buf         = '';
let _bufStart    = 0;
let _hidTimer    = null;
let _hidLastSeen = 0;

let _videoEl      = null;
let _stream       = null;
let _detector     = null;
let _cameraActive = false;
let _cameraCheck  = null;

// ─── ІНІЦІАЛІЗАЦІЯ / ОЧИЩЕННЯ ─────────────────────────────────────────────────

export function initScanner({ videoElement = null } = {}) {
  _videoEl = videoElement;
  document.addEventListener('keydown', _onKeyDown);
  _cameraCheck = setInterval(_maybRestartCamera, CAMERA_CHECK_MS);
  if (_videoEl && 'BarcodeDetector' in window) startCamera();
}

export function dispose() {
  document.removeEventListener('keydown', _onKeyDown);
  clearInterval(_cameraCheck);
  clearTimeout(_hidTimer);
  stopCamera();
}

// ─────────────────────────────────────────────────────────────────────────────
//  HID ДЕТЕКЦІЯ
//
//  Кожен символ скидає таймаут: flush відбувається через HID_FLUSH_MS
//  після ОСТАННЬОГО символу, тому повільний сканер не обривається передчасно.
//
//  Вимірювання швидкості:
//    elapsed = performance.now() - _bufStart   (мс від першого до останнього символу)
//    speed   = len / elapsed * 1000            (символів/с)
//    speed > 20 → HID підтверджено
// ─────────────────────────────────────────────────────────────────────────────

function _onKeyDown(e) {
  if (e.key === 'Enter') {
    if (_buf.length >= HID_MIN_LEN) _flush();
    else _clearBuf();
    return;
  }
  if (e.key.length !== 1) return;  // Ігноруємо Shift, Ctrl, F1…
  if (_buf.length === 0) _bufStart = performance.now();
  _buf += e.key;
  clearTimeout(_hidTimer);
  _hidTimer = setTimeout(_flush, HID_FLUSH_MS);
}

function _flush() {
  clearTimeout(_hidTimer);
  const code    = _buf.trim();
  const elapsed = (performance.now() - _bufStart) || 1;
  const speed   = (code.length / elapsed) * 1000;  // символів/с
  _clearBuf();

  if (code.length < HID_MIN_LEN) return;
  if (speed < HID_SPEED_THRESH)  return;  // Людський ввід — ігноруємо

  // Підтверджено HID-сканер
  _hidLastSeen = Date.now();
  if (_cameraActive) stopCamera();

  // Очистити barcode-input якщо він утримував фокус
  const bci = document.getElementById('barcode-input');
  if (bci && document.activeElement === bci) bci.value = '';

  _emit(code);
  _setBadge('hid');
}

function _clearBuf() {
  _buf = ''; _bufStart = 0;
  clearTimeout(_hidTimer);
}

// ─────────────────────────────────────────────────────────────────────────────
//  КАМЕРА
//
//  Перемикання HID ↔ Камера:
//  - HID виявлено → stopCamera(), _hidLastSeen = now
//  - setInterval 10 с: якщо (now - _hidLastSeen) > 60 с → startCamera()
//  - Цикл 150 мс (~7 fps) + пауза 1.5 с після успішного зчитування
// ─────────────────────────────────────────────────────────────────────────────

export async function startCamera() {
  if (_cameraActive || !_videoEl || !('BarcodeDetector' in window)) return;
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    _videoEl.srcObject = _stream;
    await _videoEl.play();
    _detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
    });
    _cameraActive = true;
    document.getElementById('scanner-container')?.removeAttribute('hidden');
    _setBadge('cam');
    _scanLoop();
  } catch (err) {
    console.warn('[scanner] камера недоступна:', err.message);
  }
}

export function stopCamera() {
  _cameraActive = false;
  _stream?.getTracks().forEach(t => t.stop());
  _stream = null;
  if (_videoEl) _videoEl.srcObject = null;
  document.getElementById('scanner-container')?.setAttribute('hidden', '');
  _setBadge(null);
}

function _maybRestartCamera() {
  if (_cameraActive || !_videoEl || !('BarcodeDetector' in window)) return;
  if (Date.now() - _hidLastSeen < CAMERA_IDLE_MS) return;
  startCamera();
}

async function _scanLoop() {
  if (!_cameraActive) return;
  try {
    const hits = await _detector.detect(_videoEl);
    if (hits.length > 0) {
      _emit(hits[0].rawValue);
      await _sleep(CAMERA_DEBOUNCE);
    }
  } catch (_) { /* відео ще не готове або трек завершено */ }
  if (_cameraActive) setTimeout(_scanLoop, CAMERA_POLL_MS);
}

// ─── ХЕЛПЕРИ ─────────────────────────────────────────────────────────────────

function _emit(barcode) {
  document.dispatchEvent(
    new CustomEvent('scanner:barcode', { detail: { barcode } })
  );
}

function _setBadge(mode) {
  const badge = document.getElementById('scan-badge');
  if (!badge) return;
  if (!mode) { badge.hidden = true; return; }
  badge.hidden    = false;
  badge.className = `scan-badge scan-badge--${mode}`;
  badge.textContent = mode === 'hid' ? 'HID' : 'CAM';
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
