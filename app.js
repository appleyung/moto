/* ============================================================
 * EPC Viewer — app.js (v33)
 * 職責：UI、渲染、虛擬化、縮放、滾動、PickList、匯出、檔案處理
 * 零件號判斷、頁面解析、高亮座標：完全委派給 window.EPC_BRAND[...]
 *
 * v33 修正：
 *   - 修復滾動頁面重新渲染後，零件清單「＋ PickList」按鈕狀態
 *     與 PickList 失去同步的問題（加入跨頁掃描）。
 * ============================================================ */

'use strict';

/* ================= PDF.js 初始化 ================= */
if (typeof pdfjsLib === 'undefined') {
  alert('PDF.js 載入失敗，請檢查網路連線。');
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

let jsPDF = null;
if (typeof window.jspdf !== 'undefined') { jsPDF = window.jspdf.jsPDF; }

document.addEventListener('contextmenu', e => e.preventDefault());

/* ================= 工具函式 ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function getTimestamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 與 yamaha.js 的 norm() 完全一致：
 *  全形→半形、破折號統一、去空白、大寫
 */
const normalizePartNo = s => String(s || '')
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  .replace(/[－–—]/g, '-')
  .replace(/\s+/g, '')
  .toUpperCase();

function partKeysEqual(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = normalizePartNo(a);
  const nb = normalizePartNo(b);
  if (na === nb) return true;
  return na.replace(/[-\s]/g, '') === nb.replace(/[-\s]/g, '');
}

/**
 * 依當前模式取得品牌模組
 */
var selectedLocale = 'zh';

function getBrand(mode) {
  var B = window.EPC_BRAND || {};
  var key = mode || currentMode || 'yamaha';
  key = String(key);
  if (key === 'honda' || key.indexOf('honda') === 0) {
    key = (selectedLocale === 'id') ? 'honda-id' : 'honda-jp';
  } else if (key === 'kawasaki' || key.indexOf('kawasaki') === 0) {
    key = (selectedLocale === 'id') ? 'kawasaki-id' : 'kawasaki-th';
  } else {
    // yamaha
    if (selectedLocale === 'en') key = 'yamaha-en';
    else if (selectedLocale === 'id') key = 'yamaha-id';
    else if (selectedLocale === 'th') key = 'yamaha-th';
    else key = 'yamaha';
  }
  return B[key] || B['yamaha'] || B['honda-jp'] || B['kawasaki-th'] || null;
}

/* 若 parsers 未載入，嘗試補載 yamaha.js */
function ensureBrandParsersLoaded() {
  return new Promise(function (resolve) {
    if (window.EPC_BRAND && window.EPC_BRAND.yamaha && typeof window.EPC_BRAND.yamaha.parseItems === 'function') {
      resolve(true);
      return;
    }
    var s = document.createElement('script');
    s.src = 'parsers/yamaha.js?t=' + Date.now();
    s.onload = function () {
      console.log('[epc] late-loaded yamaha', Object.keys(window.EPC_BRAND || {}));
      resolve(!!(window.EPC_BRAND && window.EPC_BRAND.yamaha));
    };
    s.onerror = function () {
      console.error('[epc] failed to load parsers/yamaha.js');
      resolve(false);
    };
    document.head.appendChild(s);
  });
}




/* ================= 記憶體監控 ================= */
const _uaStr = navigator.userAgent || '';
const _hasTouch = (navigator.maxTouchPoints || 0) > 1;
const _isIpadDesktopUA = /Macintosh/.test(_uaStr) && _hasTouch;
const _isMobileLike = /iPhone|iPad|iPod|Android|Mobile/i.test(_uaStr) || _isIpadDesktopUA;
const IS_DESKTOP_MODE = !_isMobileLike;

function getHeapInfo() {
  try {
    const m = performance && performance.memory;
    if (!m || !m.usedJSHeapSize) return null;
    return { used: m.usedJSHeapSize, total: m.totalJSHeapSize || 0, limit: m.jsHeapSizeLimit || 0 };
  } catch (e) { return null; }
}

let _heapSmooth = 0;
let siteBaselineBytes = 2.8 * 1024 * 1024;
let siteBaselineMeasured = false;

(function measureSiteBaselineOnce() {
  const doMeasure = () => {
    if (siteBaselineMeasured) return;
    siteBaselineMeasured = true;
    let bytes = 0;
    try { bytes += new Blob([document.documentElement.outerHTML]).size; } catch (e) {}
    try {
      const res = performance.getEntriesByType('resource') || [];
      for (const r of res) {
        const sz = Math.max(r.transferSize || 0, r.decodedBodySize || 0, r.encodedBodySize || 0);
        if (sz > 0) bytes += sz;
      }
    } catch (e) {}
    siteBaselineBytes = Math.max(bytes, 2.8 * 1024 * 1024);
  };
  if (document.readyState === 'complete') setTimeout(doMeasure, 600);
  else window.addEventListener('load', () => setTimeout(doMeasure, 600));
})();

function updateRamUsage() {
  const ramEl = $('ramUsage');
  if (!ramEl) return;

  let canvasBytes = 0, renderedCount = 0;
  if (renderedPages && container) {
    renderedPages.forEach(idx => {
      const pageDiv = container.querySelector(`.page-container[data-page-index="${idx}"]`);
      if (!pageDiv) return;
      const cv = pageDiv.querySelector('canvas:not(.highlight-layer)');
      if (cv && cv.width > 0) { canvasBytes += cv.width * cv.height * 4; renderedCount++; }
      const hl = pageDiv.querySelector('canvas.highlight-layer');
      if (hl && hl.width > 0) canvasBytes += hl.width * hl.height * 4;
    });
  }
  const pageShells = container ? container.querySelectorAll('.page-container').length : 0;
  const textSpans  = container ? container.querySelectorAll('.textLayer span').length : 0;
  const hitBoxes   = container ? container.querySelectorAll('.part-hit-box').length : 0;
  const domBytes   = pageShells * 2 * 1024 + textSpans * 300 + hitBoxes * 200;
  const partCount  = partInfoMap ? partInfoMap.size : 0;
  const pickCount  = pickList ? pickList.size : 0;
  const dataBytes  = partCount * 260 + pickCount * 200 + pageShells * 4 * 1024;
  const rawPdfBytes = (typeof loadedPdfFileBytes === 'number') ? loadedPdfFileBytes : 0;
  const pdfjsCacheBytes = renderedCount * 150 * 1024;

  const heap = getHeapInfo();
  let totalMB = 0;

  if (IS_DESKTOP_MODE && heap) {
    _heapSmooth = _heapSmooth === 0 ? heap.used : (_heapSmooth * 0.4 + heap.used * 0.6);
    const pdfExtraBytes = rawPdfBytes + canvasBytes + 1.5 * 1048576 + pdfjsCacheBytes;
    totalMB = (_heapSmooth + pdfExtraBytes) / 1048576;
    const ratio = heap.limit > 0 ? (heap.used / heap.limit) : 0;
    ramEl.style.color = ratio >= 0.85 ? '#dc2626' : ratio >= 0.7 ? '#d97706' : '';
    ramEl.textContent = `快取:${Math.ceil(totalMB)}M`;
  } else {
    const estimatedBytes = siteBaselineBytes + rawPdfBytes + pdfjsCacheBytes + canvasBytes + domBytes + dataBytes;
    totalMB = estimatedBytes / 1048576;
    ramEl.style.color = totalMB >= 300 ? '#dc2626' : totalMB >= 180 ? '#d97706' : '';
    ramEl.textContent = `快取:${Math.ceil(totalMB)}M`;
  }
}

/* ================= 翻譯 ================= */
const TRANSLATIONS = {};
function translateText(text) {
  if (!text) return text;
  const packs = window.EPC_TRANSFER || {};
  const order = [];
  try {
    if (currentMode === 'honda' && typeof hondaLocale !== 'undefined') {
      if (hondaLocale === 'jp') order.push('jp');
      if (hondaLocale === 'id') order.push('id');
    }
    if (currentMode === 'kawasaki' && typeof kawasakiLocale !== 'undefined') {
      if (kawasakiLocale === 'th') order.push('th');
      if (kawasakiLocale === 'id') order.push('id');
    }
  } catch (e) {}
  order.push('eng', 'jp', 'id', 'th');
  const s = String(text);
  for (const lang of order) {
    const dict = packs[lang];
    if (dict && dict[s]) return dict[s];
  }
  return s;
}

/* ================= 資料層 ================= */
const partInfoMap = new Map();
const pagePartsMap = new Map();
const pagePartKeys = new Map();
const pageTitles = new Map();
const partFigLocations = new Map();
const pickList = new Map();

let selectedKey = null;
let currentPageIndex = 0;
let isScrollingProgrammatically = false;
let navLockTimer = null;
let navLockTarget = null;
let currentSelectValue = '0';
let currentMode = 'yamaha';
let selectedBrand = 'yamaha';

let currentPdfDoc = null;
let currentFileName = '';
let renderedPages = new Set();
let pageRenderTasks = new Map();
let renderGeneration = 0;
let titleLoadToken = 0;
let userScrolling = false;
let scrollIdleTimer = null;
let navigateCount = 0;
let lastCleanupPage = 0;
let partListRenderToken = 0;
let isRenderingLocked = false;
let pendingRenderCenter = null;
let navDebounceTimer = null;
let navPendingPage = null;
let loadedPdfFileBytes = 0;
let hondaLocale = 'jp';
let kawasakiLocale = 'en';

/* ================= 縮放與渲染常數 ================= */
const _isMobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 1024;
const RENDER_SCALE = _isMobileUA ? 2.2 : 2.5;
const NEIGHBOR_SCALE_RATIO = 2.2;

function getRenderScaleForPage(pageIndex, centerIndex) {
  if (pageIndex === centerIndex) return RENDER_SCALE;
  return Math.max(2.2, RENDER_SCALE * NEIGHBOR_SCALE_RATIO);
}
const pageRenderedScale = new Map();

let scale = 1;
const viewport = $('pdfViewport');
const container = $('pdfContainer');
const scaleWrapper = $('pdfScaleWrapper');
const zoomInput = $('zoomText');
const emptyState = $('emptyState');

function zoomFactor() { return scale / RENDER_SCALE; }

function updateScaleTransform() {
  const z = zoomFactor();
  container.style.transform = 'scale(' + z + ')';
  container.style.transformOrigin = '0 0';
  const w = container.offsetWidth;
  const h = container.offsetHeight;
  if (scaleWrapper) {
    scaleWrapper.style.width = Math.max(1, w * z) + 'px';
    scaleWrapper.style.height = Math.max(1, h * z) + 'px';
  }
  try { updateHorizontalScrollLock(); } catch (e) {}
}

function contentPointFromMid(midX, midY) {
  const z = zoomFactor();
  return { x: (viewport.scrollLeft + midX) / z, y: (viewport.scrollTop + midY) / z };
}

function scrollToKeepContentAtMid(cx, cy, midX, midY) {
  const z = zoomFactor();
  viewport.scrollLeft = cx * z - midX;
  viewport.scrollTop = cy * z - midY;
}

/** 兩側預留邊距（px） */
var PDF_SIDE_MARGIN = 10;

/**
 * 最小縮放：寬度貼齊瀏覽區（兩側各留 PDF_SIDE_MARGIN）
 * → 最小時不會左右溢出，只可上下滾動
 */
function getMinZoomScale() {
  if (!viewport || !container) return 0.5;
  const pageEl =
    container.querySelector('.page-container[data-page-index="' + String(currentPageIndex || 0) + '"]') ||
    container.querySelector('.page-container') ||
    container.firstElementChild;
  let pageW = 0, pageH = 0;
  if (pageEl) {
    pageW = parseFloat(pageEl.style.width) || pageEl.offsetWidth || 0;
    pageH = parseFloat(pageEl.style.height) || pageEl.offsetHeight || 0;
  }
  if ((pageW < 1 || pageH < 1) && container.querySelector('.page-container')) {
    const any = container.querySelector('.page-container');
    pageW = parseFloat(any.style.width) || any.offsetWidth || pageW;
    pageH = parseFloat(any.style.height) || any.offsetHeight || pageH;
  }
  if (pageW < 1) return 0.5;
  const vw = Math.max(1, viewport.clientWidth - PDF_SIDE_MARGIN * 2);
  // 顯示寬 = pageW * (scale / RENDER_SCALE) ≤ vw
  return (vw / pageW) * RENDER_SCALE;
}

/** 內容寬不超過瀏覽區時：鎖左右捲動並水平置中 */
function updateHorizontalScrollLock() {
  if (!viewport) return;
  const wrap = scaleWrapper || container;
  if (!wrap) return;
  // scaleWrapper 的 width 已在 updateScaleTransform 設成乘過 z 的值
  const contentW = scaleWrapper
    ? (parseFloat(scaleWrapper.style.width) || scaleWrapper.offsetWidth || 0)
    : (container.offsetWidth * zoomFactor());
  const vw = viewport.clientWidth;
  if (contentW <= vw + 1) {
    viewport.classList.add('pdf-no-x-scroll');
    viewport.scrollLeft = 0;
    if (scaleWrapper) {
      scaleWrapper.style.marginLeft = 'auto';
      scaleWrapper.style.marginRight = 'auto';
    }
  } else {
    viewport.classList.remove('pdf-no-x-scroll');
    if (scaleWrapper) {
      scaleWrapper.style.marginLeft = '';
      scaleWrapper.style.marginRight = '';
    }
  }
}


function applyZoom(newScale, originX, originY) {
  const oldScale = scale;
  const oldZ = oldScale / RENDER_SCALE;
  const minZoom = getMinZoomScale();
  scale = Math.max(minZoom, Math.min(newScale, 5));
  if (Math.abs(scale - oldScale) < 0.0001) { zoomInput.value = Math.round(scale * 100); return; }
  if (originX === undefined || originY === undefined) {
    originX = viewport.clientWidth / 2;
    originY = viewport.clientHeight / 2;
  }
  const contentX = (viewport.scrollLeft + originX) / oldZ;
  const contentY = (viewport.scrollTop + originY) / oldZ;
  updateScaleTransform();
  zoomInput.value = Math.round(scale * 100);
  const z = zoomFactor();
  viewport.scrollLeft = contentX * z - originX;
  viewport.scrollTop = contentY * z - originY;
  try { updateHorizontalScrollLock(); } catch (e) {}
  clearTimeout(window._zoomRenderTimeout);
  window._zoomRenderTimeout = setTimeout(() => {
    updateScaleTransform();
    syncCurrentPage();
  }, 150);
}

function fitWidth() {
  if (!container.firstElementChild) return;
  const firstPage = container.firstElementChild;
  const rawWidth = parseFloat(firstPage.style.width) / RENDER_SCALE;
  if (!rawWidth) return;
  const viewportWidth = viewport.clientWidth - 40;
  applyZoom(viewportWidth / rawWidth);
}


// 瀏覽區尺寸變更時：若目前已小於新的最小縮放，同步拉回
(function () {
  if (!viewport || typeof ResizeObserver === 'undefined') return;
  let t = null;
  const ro = new ResizeObserver(function () {
    clearTimeout(t);
    t = setTimeout(function () {
      if (!currentPdfDoc) return;
      const minZ = getMinZoomScale();
      if (scale < minZ - 0.001) applyZoom(minZ);
    }, 120);
  });
  ro.observe(viewport);
})();


// 鎖左右時強制 scrollLeft = 0
if (viewport && !viewport.__epcXGuard) {
  viewport.__epcXGuard = true;
  viewport.addEventListener('scroll', function () {
    if (viewport.classList.contains('pdf-no-x-scroll') && viewport.scrollLeft !== 0) {
      viewport.scrollLeft = 0;
    }
  }, { passive: true });
}

$('btnZoomIn').onclick = () => applyZoom(scale + 0.2);
$('btnZoomOut').onclick = () => applyZoom(scale - 0.2);
zoomInput.addEventListener('keydown', e => { if (e.key === 'Enter') zoomInput.blur(); });
const handleZoomInput = () => {
  const v = parseFloat(zoomInput.value);
  if (!isNaN(v) && v >= 20 && v <= 500) applyZoom(v / 100);
  else zoomInput.value = Math.round(scale * 100);
};
zoomInput.addEventListener('change', handleZoomInput);
zoomInput.addEventListener('blur', handleZoomInput);
viewport.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    applyZoom(scale + (e.deltaY > 0 ? -0.1 : 0.1), e.clientX - rect.left, e.clientY - rect.top);
  }
}, { passive: false });

/* ================= 雙指縮放 ================= */
let pinchActive = false;
let pinchBaseDist = 0;
let pinchBaseScale = 1;
let pinchContentX = 0, pinchContentY = 0;
let pinchRaf = null;
let lastPinchPts = null;
let singleFingerPan = false;
let firstTouchTime = 0;
const PINCH_SIMULTANEOUS_MS = 100;
const PINCH_MIN_DIST_START = 16;
const PINCH_MIN_DIST_MOVE = 10;

function readTwoTouches(touchList) {
  if (!touchList || touchList.length < 2) return null;
  return [
    { x: touchList[0].clientX, y: touchList[0].clientY },
    { x: touchList[1].clientX, y: touchList[1].clientY }
  ];
}
function midDistFromPts(pts) {
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  const rect = viewport.getBoundingClientRect();
  const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
  const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
  return { dist, midX, midY };
}
function armPinch(pts) {
  if (!pts) return false;
  const { dist, midX, midY } = midDistFromPts(pts);
  if (dist < PINCH_MIN_DIST_START) return false;
  const pt = contentPointFromMid(midX, midY);
  pinchBaseDist = dist;
  pinchBaseScale = scale;
  pinchContentX = pt.x;
  pinchContentY = pt.y;
  pinchActive = true;
  lastPinchPts = pts;
  singleFingerPan = false;
  return true;
}
function applyPinchFrame(pts) {
  if (!pts || !pinchActive || pinchBaseDist < PINCH_MIN_DIST_START) return;
  const { dist, midX, midY } = midDistFromPts(pts);
  if (dist < PINCH_MIN_DIST_MOVE) return;
  const minZ = (typeof getMinZoomScale === 'function') ? getMinZoomScale() : 0.5;
  const newScale = Math.max(minZ, Math.min(pinchBaseScale * (dist / pinchBaseDist), 5));
  scale = newScale;
  updateScaleTransform();
  if (zoomInput) zoomInput.value = Math.round(scale * 100);
  scrollToKeepContentAtMid(pinchContentX, pinchContentY, midX, midY);
}

viewport.addEventListener('touchstart', e => {
  const now = performance.now();
  if (e.touches.length === 1) {
    firstTouchTime = now;
    singleFingerPan = false;
    pinchActive = false;
    pinchBaseDist = 0;
    lastPinchPts = null;
    clearTimeout(window._pinchArmTimer);
    window._pinchArmTimer = setTimeout(() => { if (!pinchActive) singleFingerPan = true; }, PINCH_SIMULTANEOUS_MS);
    return;
  }
  if (e.touches.length >= 2) {
    clearTimeout(window._pinchArmTimer);
    const dt = firstTouchTime ? (now - firstTouchTime) : 0;
    const simultaneous = !firstTouchTime || dt <= PINCH_SIMULTANEOUS_MS;
    if (singleFingerPan && !simultaneous) { pinchActive = false; lastPinchPts = null; return; }
    const pts = readTwoTouches(e.touches);
    if (armPinch(pts) && e.cancelable) e.preventDefault();
  }
}, { passive: false });

viewport.addEventListener('touchmove', e => {
  if (e.touches.length === 1 && firstTouchTime) {
    const dt = performance.now() - firstTouchTime;
    if (dt > PINCH_SIMULTANEOUS_MS) singleFingerPan = true;
    return;
  }
  if (e.touches.length < 2) return;
  if (singleFingerPan && !pinchActive) return;
  if (!pinchActive) return;
  const pts = readTwoTouches(e.touches);
  lastPinchPts = pts;
  if (e.cancelable) e.preventDefault();
  if (pinchRaf) return;
  pinchRaf = requestAnimationFrame(() => {
    pinchRaf = null;
    if (lastPinchPts && pinchActive) applyPinchFrame(lastPinchPts);
  });
}, { passive: false });

function endPinchGesture() {
  if (pinchActive) {
    clearTimeout(window._zoomRenderTimeout);
    window._zoomRenderTimeout = setTimeout(() => {
      updateScaleTransform();
      syncCurrentPage();
    }, 100);
  }
  pinchActive = false;
  pinchBaseDist = 0;
  lastPinchPts = null;
  if (pinchRaf) { cancelAnimationFrame(pinchRaf); pinchRaf = null; }
}

viewport.addEventListener('touchend', e => {
  if (e.touches.length === 0) {
    clearTimeout(window._pinchArmTimer);
    singleFingerPan = false;
    firstTouchTime = 0;
    endPinchGesture();
  } else if (e.touches.length < 2) {
    endPinchGesture();
    if (firstTouchTime && (performance.now() - firstTouchTime) > PINCH_SIMULTANEOUS_MS) singleFingerPan = true;
  }
});
viewport.addEventListener('touchcancel', () => {
  clearTimeout(window._pinchArmTimer);
  singleFingerPan = false;
  firstTouchTime = 0;
  endPinchGesture();
});

/* ================= 頁面渲染 ================= */
function getPageRotation(page) { return ((page.rotate != null ? page.rotate : 0) % 360 + 360) % 360; }
function getPageViewport(page, s) { return page.getViewport({ scale: s, rotation: getPageRotation(page) }); }

function cleanupOldPages(centerIndex) {
  // 只保留「瀏覽區中心」那一頁，其餘釋放 RAM
  const keep = new Set([centerIndex]);
  const candidates = [];
  renderedPages.forEach(idx => { if (!keep.has(idx)) candidates.push(idx); });

  candidates.forEach(idx => {
    const pageDiv = container.querySelector(`.page-container[data-page-index="${idx}"]`);
    if (pageDiv) {
      pageDiv.querySelectorAll('canvas').forEach(cv => {
        cv.width = 0; cv.height = 0; cv.remove();
      });
      const tl = pageDiv.querySelector('.textLayer');
      if (tl) tl.innerHTML = '';
      pageDiv.querySelectorAll('.highlight-layer, .part-hit-box').forEach(el => el.remove());
      pageDiv.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;">載入中...</div>';
      pageDiv.classList.add('placeholder');
    }
    renderedPages.delete(idx);
    pageRenderedScale.delete(idx);
    pageRenderTasks.delete(idx);
  });
}

async function renderPagesInRange(centerIndex) {
  if (!currentPdfDoc || renderedPages.has(centerIndex)) return;
  const gen = ++renderGeneration;
  await renderSinglePage(centerIndex, gen, RENDER_SCALE, null);
}

async function renderSinglePage(pageIndex, gen, pageScale, _centerIndex) {
  const pageDiv = container.querySelector(`.page-container[data-page-index="${pageIndex}"]`);
  if (!pageDiv || renderedPages.has(pageIndex)) return;
  renderedPages.add(pageIndex);
  const drawScale = pageScale != null ? pageScale : RENDER_SCALE;
  pageRenderedScale.set(pageIndex, drawScale);

  try {
    if (gen != null && gen !== renderGeneration) {
      renderedPages.delete(pageIndex);
      pageRenderedScale.delete(pageIndex);
      return;
    }
    const page = await currentPdfDoc.getPage(pageIndex + 1);
    if (gen != null && gen !== renderGeneration) {
      renderedPages.delete(pageIndex);
      pageRenderedScale.delete(pageIndex);
      return;
    }
    const layoutVp = getPageViewport(page, RENDER_SCALE);
    const drawVp = getPageViewport(page, drawScale);

    pageDiv.innerHTML = '';
    pageDiv.classList.remove('placeholder');
    pageDiv.style.width = layoutVp.width + 'px';
    pageDiv.style.height = layoutVp.height + 'px';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    canvas.width = drawVp.width;
    canvas.height = drawVp.height;
    canvas.style.width = layoutVp.width + 'px';
    canvas.style.height = layoutVp.height + 'px';
    canvas.style.display = 'block';

    pageDiv.appendChild(canvas);

    const task = page.render({ canvasContext: ctx, viewport: drawVp });
    pageRenderTasks.set(pageIndex, task);
    await task.promise;
    pageRenderTasks.delete(pageIndex);

    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.width = layoutVp.width + 'px';
    textLayerDiv.style.height = layoutVp.height + 'px';
    const scaleFactor = String(layoutVp.scale);
    textLayerDiv.style.setProperty('--scale-factor', scaleFactor);
    pageDiv.style.setProperty('--scale-factor', scaleFactor);
    pageDiv.appendChild(textLayerDiv);

    const tc = await page.getTextContent();
    try {
      await pdfjsLib.renderTextLayer({
        textContent: tc, container: textLayerDiv, viewport: layoutVp, textDivs: []
      }).promise;
    } catch (tle) {
      try {
        await pdfjsLib.renderTextLayer({
          textContentSource: tc, container: textLayerDiv, viewport: layoutVp, textDivs: []
        }).promise;
      } catch (e2) { console.warn('textLayer', e2); }
    }

    // === 頁面解析：完全委派品牌模組 ===
    try {
      if (gen != null && gen !== renderGeneration) { renderedPages.delete(pageIndex); return; }
      // 每次渲染中心頁都重新解析（避免載入時空 keys 被快取後永遠不重抓）
      {
        const parsed = parsePageData(tc.items, pageIndex, currentMode);
        pagePartKeys.set(pageIndex, parsed.keys || []);
        const prevTitle = pageTitles.get(pageIndex) || '';
        if (parsed.title && (!prevTitle || prevTitle === `第 ${pageIndex + 1} 頁` || parsed.title.length >= prevTitle.length)) {
          pageTitles.set(pageIndex, parsed.title);
        }
        console.log('[epc] page', pageIndex, 'parts', (parsed.parts || []).length, 'brand', (getBrand(currentMode) || {}).id);
      }
      // 解析完立刻刷新清單（不依賴 select 是否已同步）
      currentPageIndex = pageIndex;
      if (currentSelectValue !== 'all') {
        currentSelectValue = String(pageIndex);
        updateCustomSelectUI(String(pageIndex));
      }
      renderPartList(currentSelectValue === 'all' ? 'all' : 'page', pageIndex, false);
      console.log('[epc] list refreshed page', pageIndex, 'map', (pagePartsMap.get(pageIndex) || []).length);
    } catch (pe) { console.warn('on-demand parse', pe); }

    // === 高亮：完全由品牌模組 hits 驅動 ===
    highlightPartNumbersFromContent(pageDiv, tc, layoutVp, currentMode);

    if (selectedKey) {
      setTimeout(() => { try { highlightPartOnPage(selectedKey); } catch (e) {} }, 30);
    }

    updateScaleTransform();
    updateRamUsage();
  } catch (err) {
    console.error('渲染頁面失敗:', err);
    renderedPages.delete(pageIndex);
    pageRenderTasks.delete(pageIndex);
  }
}

/* ================= 滾動同步：偵測目前頁並渲染（不置中） ================= */
let scrollTimeout = null;
function syncCurrentPage() {
  if (!currentPdfDoc || isScrollingProgrammatically) return;
  const pages = Array.from(document.querySelectorAll('.page-container'));
  if (!pages.length) return;

  const z = zoomFactor();
  const mid = viewport.scrollTop + viewport.clientHeight / 2;

  let bestPageIndex = 0, bestDist = Infinity;
  for (const page of pages) {
    const idx = parseInt(page.dataset.pageIndex, 10);
    if (isNaN(idx)) continue;
    const top = page.offsetTop * z;
    const height = page.offsetHeight * z;
    if (mid >= top && mid <= top + height) { bestPageIndex = idx; bestDist = 0; break; }
    const center = top + height / 2;
    const dist = Math.abs(center - mid);
    if (dist < bestDist) { bestDist = dist; bestPageIndex = idx; }
  }

  // 不置中、不改 scrollTop：只同步頁碼、清理、渲染
  currentPageIndex = bestPageIndex;
  cleanupOffscreenPages(bestPageIndex);
  renderPagesInRange(bestPageIndex);

  if (navLockTarget !== null) return;
  if (currentSelectValue === 'all') return;
  if (currentSelectValue !== String(bestPageIndex)) {
    currentSelectValue = String(bestPageIndex);
    updateCustomSelectUI(String(bestPageIndex));
    renderPartList('page', bestPageIndex, false);
  }
}

viewport.addEventListener('scroll', () => {
  if (isScrollingProgrammatically) return;
  userScrolling = true;
  clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => { userScrolling = false; }, 400);
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(syncCurrentPage, 80);
});

/* ================= 清理離屏快取 ================= */
function cleanupOffscreenPages(idx) {
  cleanupOldPages(idx); // 只保留中心頁
}

let _pdfPrevScrollTop = 0;
function goToPdfFirstPage() {
  if (!currentPdfDoc) return;
  isScrollingProgrammatically = true;
  navLockTarget = 0;
  clearTimeout(navLockTimer);
  viewport.scrollTo({ top: 0, behavior: 'auto' });
  if (currentSelectValue !== 'all') {
    currentSelectValue = '0';
    currentPageIndex = 0;
    updateCustomSelectUI('0');
    renderPartList('page', 0, true);
  }
  renderPagesInRange(0);
  navLockTimer = setTimeout(() => {
    isScrollingProgrammatically = false;
    navLockTarget = null;
  }, 400);
}
const btnToTop = $('btnToTop');
if (btnToTop) btnToTop.addEventListener('click', e => { e.preventDefault(); goToPdfFirstPage(); });

viewport.addEventListener('scroll', () => {
  const st = viewport.scrollTop;
  if (_pdfPrevScrollTop > 120 && st <= 3 && navLockTarget === null) {
    if (currentSelectValue !== '0' && currentSelectValue !== 'all') goToPdfFirstPage();
    else if (currentSelectValue === 'all') renderPagesInRange(0);
  }
  _pdfPrevScrollTop = st;
}, { passive: true });

window.addEventListener('scroll', () => {
  if (window.scrollY > 2) return;
  if (!currentPdfDoc) return;
  if (viewport.scrollTop > 120) goToPdfFirstPage();
}, { passive: true });

document.addEventListener('gesturestart', e => {
  if (!e.target.closest || !e.target.closest('#pdfViewport')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturechange', e => {
  if (!e.target.closest || !e.target.closest('#pdfViewport')) e.preventDefault();
}, { passive: false });
document.addEventListener('gestureend', e => {
  if (!e.target.closest || !e.target.closest('#pdfViewport')) e.preventDefault();
}, { passive: false });

(function doubleTapToolbar() {
  const bar = document.querySelector('.epc-toolbar');
  if (!bar) return;
  let lastTap = 0;
  bar.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 350) { e.preventDefault(); goToPdfFirstPage(); lastTap = 0; }
    else { lastTap = now; }
  }, { passive: false });
})();

viewport.addEventListener('touchstart', () => {
  if (navLockTarget !== null) return;
  isScrollingProgrammatically = false;
}, { passive: true });
viewport.addEventListener('mousedown', () => {
  if (navLockTarget !== null) return;
  isScrollingProgrammatically = false;
});

/* ================= 檔案處理 ================= */
function handleFiles(files, mode = 'yamaha') {
  let newPdfFile = null;
  for (const f of files) { if (/\.pdf$/i.test(f.name)) { newPdfFile = f; break; } }
  if (!newPdfFile) { alert('請提供 PDF 格式的檔案。'); return; }
  if (container.firstElementChild) {
    if (!confirm('目前已有開啟的 PDF，是否關閉舊檔並載入新的？\n（零件清單與 PickList 將一併清空）')) return;
    container.innerHTML = '';
    partInfoMap.clear();
    pagePartsMap.clear();
    pagePartKeys.clear();
    pageTitles.clear();
    partFigLocations.clear();
    pickList.clear();
    selectedKey = null;
    currentPageIndex = 0;
    renderedPages.clear();
    pageRenderedScale.clear();
    pageRenderTasks.forEach(task => { try { task.cancel(); } catch (e) {} });
    pageRenderTasks.clear();
    renderGeneration++;
    titleLoadToken++;
    isRenderingLocked = false;
    pendingRenderCenter = null;
    navigateCount = 0;
    lastCleanupPage = 0;
    userScrolling = false;
    hondaLocale = 'jp';
    kawasakiLocale = 'en';
    currentPdfDoc = null;
    currentFileName = '';
    loadedPdfFileBytes = 0;
    renderPartList('page', 0);
    renderPickList();
    scale = 1;
    applyZoom(1);
    viewport.scrollTop = 0;
  }
  currentMode = mode;
  loadPdf(newPdfFile, mode);
}

$('fileInputAuto').addEventListener('change', e => {
  if (e.target.files.length) { handleFiles(e.target.files, 'auto'); e.target.value = ''; }
});

const handleDecrypt = async (e) => {
  if (!e.target.files.length) return;
  const file = e.target.files[0];
  e.target.value = '';
  if (!/\.pdf$/i.test(file.name)) { alert('請提供 PDF 格式的檔案。'); return; }
  if (!jsPDF) { alert('解密套件未載入。'); return; }
  const loadingEl = $('loading');
  loadingEl.innerHTML = '正在解密並重新打包...<br><span style="font-size:13px;font-weight:normal;color:#64748b;">處理隱形文字層中</span>';
  loadingEl.classList.add('show');
  try {
    const arrayBuffer = await file.arrayBuffer();
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password: '' }).promise;
    } catch (err) {
      const pwd = prompt('此 PDF 受密碼保護，請輸入密碼：');
      if (pwd === null) throw new Error('使用者取消操作');
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password: pwd }).promise;
    }
    let pdfDoc = null;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vpR = getPageViewport(page, 2.0);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = vpR.width;
      canvas.height = vpR.height;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vpR }).promise;
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const vpO = getPageViewport(page, 1.0);
      const w = vpO.width, h = vpO.height;
      if (!pdfDoc) {
        pdfDoc = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'pt', format: [w, h] });
      } else {
        pdfDoc.addPage([w, h], w > h ? 'landscape' : 'portrait');
      }
      pdfDoc.addImage(imgData, 'JPEG', 0, 0, w, h);
      const tc = await page.getTextContent();
      pdfDoc.setFont('helvetica');
      tc.items.forEach(it => {
        if (/[a-zA-Z0-9]/.test(it.str)) {
          pdfDoc.setFontSize(it.height || 10);
          pdfDoc.text(it.str, it.transform[4], h - it.transform[5], { renderingMode: 3 });
        }
      });
    }
    pdfDoc.save(`${file.name.replace(/\.pdf$/i, '')}_解鎖版_${getTimestamp()}.pdf`);
    alert('✅ 解鎖成功！');
  } catch (err) {
    console.error(err);
    alert('❌ 處理失敗：\n' + err.message);
  } finally {
    loadingEl.classList.remove('show');
  }
};
$('fileInputDecrypt').addEventListener('change', handleDecrypt);

let dragCounter = 0;
const overlay = $('dragOverlay');
window.addEventListener('dragenter', e => {
  e.preventDefault();
  dragCounter++;
  if (e.dataTransfer.types.includes('Files')) overlay.classList.add('active');
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', e => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0) overlay.classList.remove('active');
});
window.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  overlay.classList.remove('active');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, 'auto');
});

/* ================= 語言 / 品牌 / 上傳選單 ================= */
document.addEventListener('DOMContentLoaded', () => {
  const closeAllMenus = () => {
    document.querySelectorAll('.toolbar-dropdown-menu').forEach(m => {
      m.classList.remove('open');
      m.style.display = 'none';
    });
  };

  // 語言
  const btnLang = document.getElementById('btnLangSelect');
  const langMenu = document.getElementById('langMenu');
  const langLabels = { zh: '中', en: '英', id: '印', th: '泰' };
  if (btnLang && langMenu) {
    btnLang.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = !langMenu.classList.contains('open');
      closeAllMenus();
      if (willOpen) {
        langMenu.classList.add('open');
        langMenu.style.display = 'block';
      }
    });
    langMenu.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newLang = btn.dataset.lang;
        closeAllMenus();
        if (!newLang || newLang === selectedLocale) return;
        selectedLocale = newLang;
        btnLang.textContent = langLabels[newLang] || newLang;
        // 同步舊 honda/kawasaki locale
        if (newLang === 'id') { hondaLocale = 'id'; kawasakiLocale = 'id'; }
        else if (newLang === 'th') { kawasakiLocale = 'th'; hondaLocale = 'jp'; }
        else { hondaLocale = 'jp'; kawasakiLocale = 'th'; }

        if (!currentPdfDoc) return;
        await switchBrandAndReparseAll(selectedBrand || currentMode);
      });
    });
  }

  // 品牌
  const btnBrand = document.getElementById('btnBrandSelect');
  const brandMenu = document.getElementById('brandMenu');
  if (btnBrand && brandMenu) {
    btnBrand.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = !brandMenu.classList.contains('open');
      closeAllMenus();
      if (willOpen) {
        brandMenu.classList.add('open');
        brandMenu.style.display = 'block';
      }
    });
    brandMenu.querySelectorAll('.brand-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newBrand = btn.dataset.brand;
        closeAllMenus();
        if (!newBrand) return;
        const oldBrand = selectedBrand;
        selectedBrand = newBrand;
        currentMode = newBrand;
        btnBrand.textContent = newBrand === 'yamaha' ? 'Y' : (newBrand === 'honda' ? 'H' : 'K');
        btnBrand.classList.remove('brand-yamaha', 'brand-honda', 'brand-kawasaki');
        btnBrand.classList.add('brand-' + newBrand);
        if (!currentPdfDoc) return;
        if (newBrand === oldBrand) return;
        await switchBrandAndReparseAll(newBrand);
      });
    });
  }

  // 上傳
  const btnUpload = document.getElementById('btnUploadPdf');
  const uploadMenu = document.getElementById('uploadMenu');
  if (btnUpload && uploadMenu) {
    btnUpload.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = !uploadMenu.classList.contains('open');
      closeAllMenus();
      if (willOpen) {
        uploadMenu.classList.add('open');
        uploadMenu.style.display = 'block';
      }
    });
    document.getElementById('btnUploadPdfDirect')?.addEventListener('click', e => {
      e.stopPropagation();
      closeAllMenus();
      document.getElementById('fileInputAuto')?.click();
    });
    document.getElementById('btnUploadImg')?.addEventListener('click', e => {
      e.stopPropagation();
      closeAllMenus();
      document.getElementById('fileInputImage')?.click();
    });
    document.getElementById('btnUploadMultiPdf')?.addEventListener('click', e => {
      e.stopPropagation();
      closeAllMenus();
      document.getElementById('fileInputMultiPdf')?.click();
    });
    document.getElementById('btnDecrypt')?.addEventListener('click', e => {
      e.stopPropagation();
      closeAllMenus();
      document.getElementById('fileInputDecrypt')?.click();
    });
  }

  document.addEventListener('click', () => closeAllMenus());
});

/* ================= 品牌切換：重新解析並重繪 ================= */
async function switchBrandAndReparseAll(brand) {
  if (!currentPdfDoc) return;

  const loadingEl = $('loading');
  if (loadingEl) {
    loadingEl.innerHTML = `<div style="text-align:center;line-height:1.8">正在切換至「${brand}」並重新解析…</div>`;
    loadingEl.classList.add('show');
  }

  try {
    pageRenderTasks.forEach(task => { try { task.cancel(); } catch (e) {} });
    pageRenderTasks.clear();
    renderGeneration++;
    titleLoadToken++;

    partInfoMap.clear();
    pagePartsMap.clear();
    pagePartKeys.clear();
    pageTitles.clear();
    partFigLocations.clear();
    selectedKey = null;

    if (brand === 'honda') hondaLocale = 'jp';
    else if (brand === 'kawasaki') kawasakiLocale = 'en';

    const renderedList = [...renderedPages];
    for (let ri = 0; ri < renderedList.length; ri++) {
      const pageIdx = renderedList[ri];
      const pageDiv = container.querySelector(`.page-container[data-page-index="${pageIdx}"]`);
      if (!pageDiv) continue;

      pageDiv.querySelectorAll('.highlight-layer, .part-hit-box, .pick-marker, [data-part-focus="1"]')
        .forEach(el => el.remove());

      try {
        const page = await currentPdfDoc.getPage(pageIdx + 1);
        const tc = await page.getTextContent();
        const vp = getPageViewport(page, RENDER_SCALE);

        const parsed = parsePageData(tc.items || [], pageIdx, brand);
        pagePartKeys.set(pageIdx, parsed.keys || []);
        pageTitles.set(pageIdx, parsed.title || `第 ${pageIdx + 1} 頁`);

        highlightPartNumbersFromContent(pageDiv, tc, vp, brand);
      } catch (e) {
        console.warn('reparse rendered page failed', pageIdx, e);
      }

      if (ri % 3 === 2) {
        await new Promise(r => setTimeout(r, _isMobileUA ? 8 : 0));
      }
    }

    rebuildAssemblyOptions();
    updateCustomSelectUI(currentSelectValue);

    if (currentSelectValue === 'all') {
      renderPartList('all', 0, false);
    } else {
      renderPartList('page', currentPageIndex, false);
    }

    if (selectedKey) {
      setTimeout(() => { try { highlightPartOnPage(selectedKey); } catch (e) {} }, 30);
    }

    setTimeout(() => {
      try { loadAllTitlesBackground(currentPdfDoc, brand); } catch (e) {}
    }, 150);

  } catch (err) {
    console.error('切換品牌失敗:', err);
    alert('切換品牌失敗：' + err.message);
  } finally {
    if (loadingEl) loadingEl.classList.remove('show');
  }
}

/* ================= 品牌/語言偵測 ================= */
async function detectManualKind(pdf, fileName) {
  let sample = '';
  const fname = String(fileName || '');
  if (/kawasaki|ninja|zx-?\d|zx25|zx-25/i.test(fname)) sample += ' Kawasaki Ninja ZX25 ';
  if (/thai|ไทย|泰國|thailand/i.test(fname)) sample += ' สมุดภาพอะไหล่ ';
  if (/kawasaki|ninja|zx/i.test(fname) && /\bind\b|indo|印尼|indonesia/i.test(fname)) sample += ' (IN) Kawasaki ';
  if (/honda|adv\s*160|pcx|vario|beat|scoopy/i.test(fname)) sample += ' HONDA ADV160 PARTS CATALOG DAFTAR ISI KELOMPOK ';

  const probe = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 25, 30, 40, Math.min(60, pdf.numPages)];
  for (const si of probe) {
    if (si < 1 || si > pdf.numPages) continue;
    try {
      const page = await pdf.getPage(si);
      const tc = await page.getTextContent();
      sample += ' ' + (tc.items || []).map(x => x.str || '').join(' ');
    } catch (e) {}
  }

  const kanaCount = (sample.match(/[\u3040-\u30ff]/g) || []).length;
  const thCharCount = (sample.match(/[\u0e00-\u0e7f]/g) || []).length;
  const zhCharCount = (sample.match(/[\u4e00-\u9fa5]/g) || []).length;

  const packs = window.EPC_TRANSFER || {};
  const featureWords = { eng: new Set(), jp: new Set(), id: new Set(), th: new Set() };
  const fallbackWords = {
    eng: ['screw', 'bolt', 'nut', 'seal', 'gasket', 'washer', 'bearing', 'spring', 'shaft', 'piston', 'cylinder', 'gear', 'brake', 'hose', 'cover', 'valve', 'clamp', 'filter'],
    jp: ['ボルト', 'ナット', 'シール', 'パッキン', 'ベアリング', 'スプリング', 'ワッシャ', 'シャフト', 'ピストン', 'シリンダ', 'ギア', 'ブレーキ', 'ホース', 'ハンドル', 'カバー', 'マフラー'],
    id: ['baut', 'mur', 'ring', 'seal', 'paking', 'bearing', 'pegas', 'poros', 'piston', 'silinder', 'gir', 'roda', 'rem', 'knalpot', 'kampas', 'klep', 'karet', 'tali', 'cincin', 'busi'],
    th: ['สกรู', 'น็อต', 'ซีล', 'ปะเก็น', 'ตลับลูกปืน', 'สปริง', 'แหวน', 'เพลา', 'ลูกสูบ', 'กระบอก', 'เฟือง', 'เบรก', 'ท่อ', 'ยาง']
  };

  for (const lang of ['eng', 'jp', 'id', 'th']) {
    if (packs[lang]) {
      Object.keys(packs[lang]).forEach(k => { if (k.length > 2) featureWords[lang].add(k); });
      Object.values(packs[lang]).forEach(v => { if (typeof v === 'string' && v.length > 2) featureWords[lang].add(v); });
    }
    if (fallbackWords[lang]) fallbackWords[lang].forEach(w => featureWords[lang].add(w));
  }

  const sampleLower = sample.toLowerCase();
  const scores = { id: 0, eng: 0, jp: 0 };
  for (const lang of ['eng', 'jp', 'id']) {
    let count = 0;
    featureWords[lang].forEach(word => {
      if (word.length < 2) return;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      const matches = sampleLower.match(regex);
      if (matches) count += matches.length;
    });
    scores[lang] = count;
  }

  let detectedMode = 'kawasaki';
  if (/honda|adv\s*160|pcx|vario|beat|scoopy/i.test(fname) || /\bHONDA\b/i.test(sample)) detectedMode = 'honda';
  else if (/yamaha/i.test(fname) || /\bYAMAHA\b/i.test(sample)) detectedMode = 'yamaha';

  let detectedLocale = 'en';
  if (kanaCount > 10) detectedLocale = 'jp';
  else if (thCharCount > 10) detectedLocale = 'th';
  else if (zhCharCount > 10) detectedLocale = 'zh';
  else {
    if (scores.id > scores.eng && scores.id >= 2) detectedLocale = 'id';
    else if (scores.jp >= 2) detectedLocale = 'jp';
    else if (scores.eng > 0) detectedLocale = 'en';
  }

  if (detectedMode === 'honda') {
    if (kanaCount > 5) detectedLocale = 'jp';
    else if (detectedLocale === 'zh' || detectedLocale === 'th') detectedLocale = 'id';
  }

  return {
    mode: detectedMode,
    hondaLocale: detectedMode === 'honda' ? detectedLocale : 'en',
    kawasakiLocale: detectedMode === 'kawasaki' ? detectedLocale : 'en',
    kind: `${detectedMode}-${detectedLocale}`,
    scores,
    weak: false
  };
}

/* ================= PDF 載入 ================= */
async function loadPdf(file, mode = 'yamaha') {
  const loadingEl = $('loading');
  loadingEl.classList.add('show');
  emptyState.style.display = 'none';

  try { pageRenderTasks.forEach(task => { try { task.cancel(); } catch (e) {} }); } catch (e) {}
  pageRenderTasks.clear();
  renderedPages.clear();
  pageRenderedScale.clear();
  container.innerHTML = '';
  isRenderingLocked = false;
  pendingRenderCenter = null;
  navPendingPage = null;
  clearTimeout(navDebounceTimer);
  renderGeneration++;
  titleLoadToken++;
  navigateCount = 0;
  lastCleanupPage = 0;

  try {
    const buf = await file.arrayBuffer();
    loadedPdfFileBytes = buf.byteLength || 0;
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: buf, password: '' }).promise;
    } catch (e) {
      if (e.name === 'PasswordException') {
        const pwd = prompt('此 PDF 需要密碼，請輸入：');
        if (pwd === null) throw new Error('使用者取消輸入密碼。');
        pdf = await pdfjsLib.getDocument({ data: buf, password: pwd }).promise;
      } else throw e;
    }

    currentPdfDoc = pdf;
    currentFileName = (file && file.name) || '';
    mode = selectedBrand || 'yamaha';
    currentMode = mode;
    hondaLocale = 'jp';
    kawasakiLocale = 'en';

    try {
      loadingEl.innerHTML = '<div style="text-align:center;line-height:1.8">正在辨識語言…</div>';
      const det = await detectManualKind(pdf, file && file.name);
      if (mode === 'honda') hondaLocale = det.hondaLocale || 'jp';
      if (mode === 'kawasaki') kawasakiLocale = det.kawasakiLocale || 'en';
    } catch (e) { console.warn(e); }

    loadingEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div>快速解析資料中，請稍候…</div>
        <div id="progressText" style="font-size:14px;color:#64748b;font-weight:normal;">0 / ${pdf.numPages}</div>
        <div style="width: 240px; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div id="progressBar" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.1s;"></div>
        </div>
      </div>`;

    const localeLabel = mode === 'yamaha' ? 'Yamaha'
      : mode === 'kawasaki'
        ? (kawasakiLocale === 'th' ? 'Kawasaki 泰文'
          : kawasakiLocale === 'zh' ? 'Kawasaki 中文'
          : kawasakiLocale === 'jp' ? 'Kawasaki 日文'
          : 'Kawasaki 印尼/英文')
        : (hondaLocale === 'id' ? 'Honda 印尼' : hondaLocale === 'jp' ? 'Honda 日本' : 'Honda');

    const okBrand = await ensureBrandParsersLoaded();
    if (!okBrand) {
      console.error('[epc] EPC_BRAND.yamaha still missing after late load');
    }
    const total = pdf.numPages;
    for (let i = 1; i <= total; i++) {
      $('progressText').textContent = `正在打開手冊（${localeLabel}）… ${i} / ${total}`;
      $('progressBar').style.width = `${(i / total) * 100}%`;

      const page = await pdf.getPage(i);
      const vpPDF = getPageViewport(page, RENDER_SCALE);
      const pageIndex = i - 1;

      pagePartKeys.set(pageIndex, []);
      pageTitles.set(pageIndex, `第 ${pageIndex + 1} 頁`);

      try {
        const tc = await page.getTextContent();
        const parsed = parsePageData(tc.items || [], pageIndex, mode);
        pagePartKeys.set(pageIndex, parsed.keys || []);
        let title = parsed.title || `第 ${pageIndex + 1} 頁`;
        try {
          const et = extractPageTitleOnly(tc.items || [], pageIndex, mode);
          if (et && et !== `第 ${pageIndex + 1} 頁`) {
            if (!title || title === `第 ${pageIndex + 1} 頁` || et.length >= title.length) title = et;
          }
        } catch (e) {}
        pageTitles.set(pageIndex, title);
      } catch (e) {}

      const pageDiv = document.createElement('div');
      pageDiv.className = 'page-container placeholder';
      pageDiv.dataset.pageIndex = pageIndex;
      pageDiv.style.width = vpPDF.width + 'px';
      pageDiv.style.height = vpPDF.height + 'px';
      pageDiv.innerHTML = '<div>載入中...</div>';
      container.appendChild(pageDiv);

      if (i % 6 === 0) await new Promise(r => setTimeout(r, _isMobileUA ? 12 : 0));
      else if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
    }

    rebuildAssemblyOptions();
    currentSelectValue = '0';
    updateCustomSelectUI(0);
    console.log('[epc] parsed parts=', partInfoMap.size, 'pagesWithParts=', pagePartsMap.size);
    renderPartList('page', 0, true);

    await renderPagesInRange(0);
    setTimeout(function () {
      try {
        // 載入後直接套用「取大者」最小縮放（貼滿寬或高）
        applyZoom(getMinZoomScale());
      } catch (e) {
        try { fitWidth(); } catch (e2) {}
      }
    }, 120);
    setTimeout(() => { try { loadAllTitlesBackground(pdf, mode); } catch (e) {} }, 150);

    // 手機無 Console：0 筆時在清單顯示診斷
    if (partInfoMap.size === 0) {
      var box = document.getElementById('partList');
      var keys = Object.keys(window.EPC_BRAND || {});
      var b = (typeof getBrand === 'function') ? getBrand(mode) : null;
      var msg = '無零件資料。\n品牌鍵: ' + (keys.join(',') || '(空＝parsers未載入)') +
        '\ngetBrand: ' + (b && b.id) +
        '\nmode: ' + mode +
        '\nlocale: ' + (typeof selectedLocale !== 'undefined' ? selectedLocale : '?') +
        '\n請確認 index.html 有 <script src="parsers/yamaha.js">\n且檔案在 epc/parsers/yamaha.js';
      if (box) box.innerHTML = '<pre style="font-size:11px;padding:12px;white-space:pre-wrap;color:#64748b;">' + msg + '</pre>';
      console.warn('[epc] zero parts', msg);
    }

  } catch (err) {
    console.error(err);
    alert('讀取 PDF 失敗：' + err.message);
    container.innerHTML = '';
    emptyState.style.display = 'block';
  } finally {
    loadingEl.classList.remove('show');
  }
}

/* ================= 頁面解析（委派品牌） ================= */
function parsePageData(items, pageIndex, mode = 'yamaha') {
  const fallback = `第 ${pageIndex + 1} 頁`;
  const brand = getBrand(mode);

  if (brand && typeof brand.parseItems === 'function') {
    try {
      const result = brand.parseItems(items || [], pageIndex);
      if (result && result.keys) {
        const partsWithCategory = (result.parts || []).map(p => ({
          ...p,
          category: result.title || fallback
        }));
        pagePartsMap.set(pageIndex, partsWithCategory);

        if (result.parts) {
          result.parts.forEach(p => {
            partInfoMap.set(p.partNo, {
              name: p.name || '（無名稱）',
              qty: p.qty || 1,
              itemNo: p.itemNo || '',
              category: result.title || fallback
            });
          });
        }
        return {
          keys: result.keys,
          parts: partsWithCategory,
          title: result.title || fallback
        };
      }
    } catch (e) { console.warn('brand parseItems', e); }
  }

  let title = fallback;
  if (brand && typeof brand.extractTitle === 'function') {
    try { title = brand.extractTitle(items || [], pageIndex, fallback) || fallback; }
    catch (e) {}
  }
  return { keys: [], parts: [], title };
}

function extractPageTitleOnly(items, pageIndex, mode) {
  const fallback = `第 ${pageIndex + 1} 頁`;
  if (!items || !items.length) return fallback;
  const brand = getBrand(mode);
  if (brand && typeof brand.extractTitle === 'function') {
    try { return brand.extractTitle(items, pageIndex, fallback) || fallback; }
    catch (e) { return fallback; }
  }
  return fallback;
}

async function loadAllTitlesBackground(pdf, mode) {
  const token = ++titleLoadToken;
  const total = pdf.numPages;
  const isWeakTitle = (tt, pageNo) => {
    if (!tt) return true;
    const s = String(tt).trim();
    if (s === `第 ${pageNo} 頁`) return true;
    if (/^第 \d+ 頁，[:：\s]*$/.test(s)) return true;
    if (s.length < 8) return true;
    return false;
  };
  const tryExtract = async (pageNum) => {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    return extractPageTitleOnly(tc.items || [], pageNum - 1, mode) || `第 ${pageNum} 頁`;
  };

  for (let i = 1; i <= total; i++) {
    if (token !== titleLoadToken || currentPdfDoc !== pdf) return;
    try {
      const prev = pageTitles.get(i - 1);
      if (prev && !isWeakTitle(prev, i)) {
        if (i % 5 === 0 || i === total) {
          try { rebuildAssemblyOptions(); updateCustomSelectUI(currentSelectValue); } catch (e) {}
        }
        continue;
      }
      const tt = await tryExtract(i);
      if (!prev || isWeakTitle(prev, i) || (tt && tt.length > String(prev).length)) pageTitles.set(i - 1, tt);
    } catch (e) {
      if (!pageTitles.has(i - 1)) pageTitles.set(i - 1, `第 ${i} 頁`);
    }
    if (i % 8 === 0) { try { if (pdf.cleanup) pdf.cleanup(); } catch (e) {} }
    if (i % 5 === 0 || i === total) {
      try { rebuildAssemblyOptions(); updateCustomSelectUI(currentSelectValue); } catch (e) {}
    }
    if (i % 3 === 0) await new Promise(r => setTimeout(r, _isMobileUA ? 30 : 4));
    else await new Promise(r => setTimeout(r, 0));
  }

  if (token !== titleLoadToken || currentPdfDoc !== pdf) return;
  const weakPages = [];
  for (let i = 1; i <= total; i++) { if (isWeakTitle(pageTitles.get(i - 1), i)) weakPages.push(i); }
  for (const i of weakPages) {
    if (token !== titleLoadToken || currentPdfDoc !== pdf) return;
    try {
      const tt = await tryExtract(i);
      if (tt && !isWeakTitle(tt, i)) pageTitles.set(i - 1, tt);
    } catch (e) {}
    await new Promise(r => setTimeout(r, _isMobileUA ? 20 : 0));
  }

  if (token === titleLoadToken) {
    try { rebuildAssemblyOptions(); updateCustomSelectUI(currentSelectValue); } catch (e) {}
  }
}

/* ================= 高亮（完全由品牌 hits 驅動） ================= */
function highlightPartNumbersFromContent(pageDiv, textContent, viewport, mode = 'yamaha') {
  if (!textContent || !textContent.items || !textContent.items.length) return;

  const brand = getBrand(mode);
  if (!brand || typeof brand.highlight !== 'function') return;

  let hits = [];
  try {
    hits = brand.highlight(pageDiv, textContent, viewport) || [];
  } catch (e) {
    console.warn('brand highlight', e);
    return;
  }
  if (!hits.length) return;

  const hlCanvas = document.createElement('canvas');
  hlCanvas.className = 'highlight-layer';
  hlCanvas.width = viewport.width;
  hlCanvas.height = viewport.height;
  hlCanvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1;';
  pageDiv.appendChild(hlCanvas);
  const ctx = hlCanvas.getContext('2d');
  ctx.fillStyle = 'rgba(255, 235, 59, 0.45)';

  const pageIdx = parseInt(pageDiv.dataset.pageIndex, 10);

  for (const h of hits) {
    if (!h || !h.partNo) continue;
    const drawX = h.x * viewport.scale;
    const drawY = viewport.height - ((h.y + h.height) * viewport.scale);
    const drawW = h.width * viewport.scale;
    const drawH = h.height * viewport.scale;
    if (!isFinite(drawX) || !isFinite(drawY) || !isFinite(drawW) || !isFinite(drawH)) continue;

    ctx.fillRect(drawX, drawY, drawW, drawH);

    if (!isNaN(pageIdx)) {
      const hitBox = document.createElement('div');
      hitBox.className = 'part-hit-box';
      hitBox.style.cssText = `position:absolute; left:${drawX}px; top:${drawY}px; width:${drawW}px; height:${drawH}px; cursor:pointer; z-index:5;`;
      hitBox.title = `點擊加入：${h.partNo}`;
      hitBox.addEventListener('click', (e) => {
        e.stopPropagation();
        addToPickList(h.partNo, pageIdx);
        hitBox.style.background = 'rgba(76, 175, 80, 0.4)';
        setTimeout(() => { hitBox.style.background = 'transparent'; }, 300);
      });
      pageDiv.appendChild(hitBox);
    }
  }
}

/* ================= 下拉選單 ================= */
function rebuildAssemblyOptions() {
  const optionsBox = $('customOptions');
  let html = `<div class="custom-option" data-val="all">⭐ 顯示所有零件</div>`;
  for (let i = 0; i < pageTitles.size; i++) {
    html += `<div class="custom-option" data-val="${i}">${esc(pageTitles.get(i))}</div>`;
  }
  optionsBox.innerHTML = html;

  optionsBox.querySelectorAll('.custom-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.getAttribute('data-val');
      currentSelectValue = val;
      $('customOptions').classList.remove('open');
      updateCustomSelectUI(val);
      if (val === 'all') {
        renderPartList('all', 0, true);
      } else {
        const idx = parseInt(val, 10);
        if (!isNaN(idx)) {
          currentPageIndex = idx;
          renderPartList('page', idx, true);
          scrollToPage(idx);
        }
      }
    });
  });
}

function updateCustomSelectUI(val) {
  const trigger = $('customSelectTrigger');
  if (val === 'all') trigger.textContent = '⭐ 顯示所有零件';
  else {
    const idx = parseInt(val, 10);
    trigger.textContent = pageTitles.get(idx) || `第 ${idx + 1} 頁`;
  }
  document.querySelectorAll('.custom-option').forEach(opt => {
    opt.classList.toggle('selected', opt.getAttribute('data-val') === val);
  });
}

$('customSelectTrigger').addEventListener('click', (e) => {
  e.stopPropagation();
  const optsContainer = $('customOptions');
  const trigger = $('customSelectTrigger');
  const isOpen = optsContainer.classList.toggle('open');
  if (isOpen) {
    const rect = trigger.getBoundingClientRect();
    optsContainer.style.top = (rect.bottom + 4) + 'px';
    optsContainer.style.left = rect.left + 'px';
    optsContainer.style.width = rect.width + 'px';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const selectedOpt = optsContainer.querySelector('.custom-option.selected');
        if (selectedOpt) {
          optsContainer.scrollTop = Math.max(0, selectedOpt.offsetTop - (optsContainer.clientHeight / 2) + (selectedOpt.clientHeight / 2));
        }
      });
    });
  }
});

document.addEventListener('click', () => $('customOptions').classList.remove('open'));

/**
 * 將指定頁對齊到「PDF 瀏覽區」頂部（不是整頁視窗中心）
 * 用 getBoundingClientRect 計算，避免 transform scale 造成 offsetTop 誤差
 */
function scrollToPage(pageIndex) {
  navLockTarget = pageIndex;
  isScrollingProgrammatically = true;
  clearTimeout(navLockTimer);

  // 換頁：清空其他頁快取，只保留目標頁
  try {
    if (typeof cleanupOldPages === 'function') cleanupOldPages(pageIndex);
    // 強制目標頁可重新渲染（避免 has() 跳過）
    renderedPages.delete(pageIndex);
    pageRenderedScale.delete(pageIndex);
    if (typeof pageRenderTasks !== 'undefined' && pageRenderTasks && pageRenderTasks.delete) {
      pageRenderTasks.delete(pageIndex);
    }
  } catch (e) { console.warn('scrollToPage cache clear', e); }

  const MARGIN_TOP = 8; // 與瀏覽區頂部預留

  function alignPageTop() {
    if (!viewport) return;
    const pageDiv = container && container.querySelector('.page-container[data-page-index="' + pageIndex + '"]');
    if (!pageDiv) return;
    try {
      const vRect = viewport.getBoundingClientRect();
      const pRect = pageDiv.getBoundingClientRect();
      // 對齊「瀏覽區內容區」頂部（扣除 padding），避免與視覺中心不一致
      const padTop = parseFloat(getComputedStyle(viewport).paddingTop) || 0;
      const delta = pRect.top - vRect.top - padTop - MARGIN_TOP;
      if (Math.abs(delta) > 0.5) {
        viewport.scrollTop = Math.max(0, viewport.scrollTop + delta);
      }
      try { updateHorizontalScrollLock(); } catch (e) {}
    } catch (e) {
      // 後備：舊算法
      const ratio = scale / RENDER_SCALE;
      const targetTop = pageDiv.offsetTop * ratio;
      viewport.scrollTo({ top: Math.max(0, targetTop - MARGIN_TOP), behavior: 'auto' });
    }
  }

  let pageDiv = container && container.querySelector('.page-container[data-page-index="' + pageIndex + '"]');
  if (!pageDiv) {
    // 先建佔位再對齊
    Promise.resolve(renderPagesInRange(pageIndex)).then(function () {
      requestAnimationFrame(function () {
        alignPageTop();
        requestAnimationFrame(alignPageTop);
      });
    });
  } else {
    alignPageTop();
    // 渲染完成後高度可能變，再對齊一次
    Promise.resolve(renderPagesInRange(pageIndex)).then(function () {
      requestAnimationFrame(function () {
        alignPageTop();
        requestAnimationFrame(alignPageTop);
      });
    });
    pageDiv.style.transition = 'box-shadow .25s';
    pageDiv.style.boxShadow = '0 0 0 3px #fbbf24, 0 4px 16px rgba(251,191,36,0.55)';
  }

  navLockTimer = setTimeout(function () {
    pageDiv = container && container.querySelector('.page-container[data-page-index="' + pageIndex + '"]');
    if (pageDiv) pageDiv.style.boxShadow = '';
    // 最後再對齊一次，確保與瀏覽區頂部一致
    alignPageTop();
    if (navLockTarget === pageIndex) {
      isScrollingProgrammatically = false;
      navLockTarget = null;
    }
  }, 480);
}

$('btnPrevPage').addEventListener('click', () => {
  const options = Array.from(document.querySelectorAll('.custom-option'));
  const currIdx = options.findIndex(o => o.getAttribute('data-val') === currentSelectValue);
  if (currIdx > 0) options[currIdx - 1].click();
});
$('btnNextPage').addEventListener('click', () => {
  const options = Array.from(document.querySelectorAll('.custom-option'));
  const currIdx = options.findIndex(o => o.getAttribute('data-val') === currentSelectValue);
  if (currIdx >= 0 && currIdx < options.length - 1) options[currIdx + 1].click();
});

/* ================= 零件清單 ================= */
function isIndexPageTitle(title) {
  return /索引|番號索引|部品番号|Number\s*Index|PART\s*INDEX/i.test(String(title || ''));
}
function findPageByFigNumber(figNum) {
  if (figNum == null || !pageTitles) return null;
  const re = new RegExp('FIG\\.?\\s*' + String(figNum) + '\\b', 'i');
  for (const [idx, title] of pageTitles.entries()) {
    if (re.test(String(title || ''))) return idx;
  }
  return null;
}
function findPageForPart(key) {
  if (!key || !pagePartKeys) return null;
  try {
    const norm = normalizePartNo(key);
    if (partFigLocations) {
      const loc = partFigLocations.get(norm) || partFigLocations.get(key);
      if (loc && loc.fig != null) {
        const figPage = findPageByFigNumber(loc.fig);
        if (figPage != null) return figPage;
      }
    }
    const info = partInfoMap.get(key) || partInfoMap.get(norm);
    if (info && info.category) {
      const m = String(info.category).match(/FIG\.?\s*(\d+)/i);
      if (m) {
        const figPage = findPageByFigNumber(parseInt(m[1], 10));
        if (figPage != null) return figPage;
      }
    }
    let indexFallback = null;
    for (const [pageIdx, list] of pagePartKeys.entries()) {
      if (!list) continue;
      let hit = false;
      for (const item of list) {
        const k = typeof item === 'string' ? item : (item && item.key);
        if (!k) continue;
        if (k === key || normalizePartNo(k) === norm) { hit = true; break; }
      }
      if (!hit) continue;
      const title = pageTitles.get(pageIdx) || '';
      if (isIndexPageTitle(title)) { if (indexFallback == null) indexFallback = pageIdx; continue; }
      return pageIdx;
    }
    return indexFallback;
  } catch (e) { console.warn('findPageForPart', e); return null; }
}

function clearPartFocusHighlight() {
  if (!container) return;
  container.querySelectorAll('[data-part-focus="1"]').forEach(el => {
    el.style.outline = '';
    el.style.background = '';
    el.style.boxShadow = '';
    delete el.dataset.partFocus;
  });
}

function applyBlueFocusStyle(el) {
  el.dataset.partFocus = '1';
  el.style.outline = '2px solid #2563eb';
  el.style.background = 'rgba(37, 99, 235, 0.4)';
  el.style.boxShadow = '0 0 0 1px rgba(37, 99, 235, 0.55)';
}

function highlightPartOnPage(key) {
  if (!key || !container) return false;
  clearPartFocusHighlight();

  let targetPart = null;
  let targetPageIdx = -1;

  for (const [pageIdx, partsArray] of pagePartsMap.entries()) {
    const found = partsArray.find(p => partKeysEqual(p.partNo, key));
    if (found) { targetPart = found; targetPageIdx = pageIdx; break; }
  }

  if (targetPart && targetPart._x !== undefined) {
    const pageDiv = container.querySelector(`.page-container[data-page-index="${targetPageIdx}"]`);
    if (pageDiv) {
      const layoutH = parseFloat(pageDiv.style.height);
      const x = targetPart._x * RENDER_SCALE;
      const y = layoutH - (targetPart._y * RENDER_SCALE) - (targetPart._h * RENDER_SCALE);
      const w = (targetPart._w + 4) * RENDER_SCALE;
      const h = (targetPart._h) * RENDER_SCALE;

      const focusBox = document.createElement('div');
      focusBox.dataset.partFocus = '1';
      focusBox.style.cssText = `position:absolute; left:${x}px; top:${y}px; width:${w}px; height:${h}px; border:2px solid #2563eb; background:rgba(37, 99, 235, 0.3); pointer-events:none; z-index:10; transition: opacity 0.3s;`;
      pageDiv.appendChild(focusBox);

      setTimeout(() => {
        if (focusBox.parentNode) {
          focusBox.style.opacity = '0';
          setTimeout(() => focusBox.remove(), 300);
        }
      }, 3000);

      return true;
    }
  }

  let matched = [];
  container.querySelectorAll('[data-part-key]').forEach(el => {
    if (partKeysEqual(el.dataset.partKey, key)) matched.push(el);
  });
  if (!matched.length) {
    const pageIdx = findPageForPart(key);
    const pageDiv = pageIdx != null ? container.querySelector(`.page-container[data-page-index="${pageIdx}"]`) : null;
    const scope = pageDiv || container;
    const compactKey = normalizePartNo(key).replace(/[-\s]/g, '');
    scope.querySelectorAll('.textLayer span').forEach(span => {
      const raw = (span.textContent || '')
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/[－–—]/g, '-');
      const trimmed = raw.trim();
      const compact = trimmed.replace(/[-\s]/g, '').toUpperCase();
      if (!compact) return;
      if (partKeysEqual(trimmed, key) || compact === compactKey) matched.push(span);
    });
  }
  if (!matched.length) return false;

  matched.forEach(el => {
    applyBlueFocusStyle(el);
    if (el.tagName === 'SPAN') el.style.color = 'transparent';
  });
  return true;
}

function partExistsOnPage(key, pageIdx) {
  if (key == null || pageIdx == null) return false;
  const arr = pagePartsMap.get(pageIdx) || pagePartsMap.get(Number(pageIdx)) || [];
  if (arr.some(function (p) { return p && partKeysEqual(p.partNo, key); })) return true;
  const keys = pagePartKeys.get(pageIdx) || pagePartKeys.get(Number(pageIdx)) || [];
  for (let i = 0; i < keys.length; i++) {
    const k = typeof keys[i] === 'string' ? keys[i] : (keys[i] && (keys[i].partNo || keys[i].key));
    if (k && partKeysEqual(k, key)) return true;
  }
  return false;
}

/**
 * @param {string} key
 * @param {object} [opts]
 * @param {boolean} [opts.stayOnCurrent]  零件清單：只在當前頁高亮，不跳頁
 * @param {boolean} [opts.preferCurrent]  PickList：當前頁有就留在當前頁，沒有才跳頁
 * @param {number}  [opts.hintPage]       PickList 記錄的頁碼（當前頁沒有時優先）
 */
function jumpToPart(key, opts) {
  if (!key) return;
  if (!currentPdfDoc) { console.warn('no pdf'); return; }
  opts = opts || {};

  selectedKey = key;
  const cur = currentPageIndex || 0;

  // 零件清單：只處理當前頁
  if (opts.stayOnCurrent) {
    clearPartFocusHighlight();
    if (!partExistsOnPage(key, cur)) {
      // 當前頁沒有此零件：不跳頁，只更新選取樣式
      try {
        renderPartList(currentSelectValue === 'all' ? 'all' : 'page', cur, false);
      } catch (e) {}
      return;
    }
    if (!renderedPages.has(cur)) {
      renderedPages.delete(cur);
      renderPagesInRange(cur);
    }
    let tries = 0;
    const tryHl = () => {
      tries++;
      if (highlightPartOnPage(key)) return;
      if (tries >= 20) return;
      setTimeout(tryHl, 120);
    };
    setTimeout(tryHl, 50);
    return;
  }

  // PickList：先當前頁，沒有再跳
  let targetPage = null;
  if (opts.preferCurrent && partExistsOnPage(key, cur)) {
    targetPage = cur;
  } else {
    if (opts.hintPage != null && !isNaN(Number(opts.hintPage))) {
      const hp = Number(opts.hintPage);
      if (partExistsOnPage(key, hp)) targetPage = hp;
    }
    if (targetPage === null) {
      for (const [pageIdx, partsArray] of pagePartsMap.entries()) {
        const found = partsArray.find(p => partKeysEqual(p.partNo, key));
        if (found) { targetPage = pageIdx; break; }
      }
    }
    if (targetPage === null) targetPage = findPageForPart(key);
  }

  if (targetPage === null || targetPage === undefined) {
    alert('找不到此零件所在的 PDF 頁面。');
    return;
  }

  const alreadyOnPage = (currentPageIndex === targetPage);

  if (currentSelectValue !== 'all') {
    currentSelectValue = String(targetPage);
    updateCustomSelectUI(String(targetPage));
  }

  if (!alreadyOnPage) {
    currentPageIndex = targetPage;
    renderedPages.clear();
    pageRenderedScale.clear();
    renderPartList('page', targetPage, false);
    scrollToPage(targetPage);
  } else {
    cleanupOffscreenPages(currentPageIndex);
    renderedPages.delete(currentPageIndex);
    renderPartList(currentSelectValue === 'all' ? 'all' : 'page', targetPage, false);
    renderPagesInRange(targetPage);
  }

  clearPartFocusHighlight();
  let tries = 0;
  const tryHl = () => {
    tries++;
    if (highlightPartOnPage(key)) return;
    if (tries >= 25) return;
    setTimeout(tryHl, 160);
  };
  setTimeout(tryHl, alreadyOnPage ? 50 : 220);
}

function renderPartList(mode = 'page', pageIdx = 0, scrollToTop = false) {
  const box = $('partList');
  let renderItems = [];
  let keys = [];
  const q = $('partSearch').value.trim().toUpperCase();

  if (q) {
    keys = [...partInfoMap.keys()].filter(k => {
      const info = partInfoMap.get(k);
      if (!info) return false;
      return String(k).toUpperCase().includes(q)
        || String(info.name || '').toUpperCase().includes(q)
        || String(info.itemNo || '').toUpperCase().includes(q);
    });
    renderItems = keys.sort((a, b) => {
      const infoA = partInfoMap.get(a), infoB = partInfoMap.get(b);
      const numA = parseFloat(infoA && infoA.itemNo) || 999;
      const numB = parseFloat(infoB && infoB.itemNo) || 999;
      return numA - numB;
    });
  } else if (mode === 'all') {
    keys = [...partInfoMap.keys()];
    renderItems = keys.sort((a, b) => {
      const infoA = partInfoMap.get(a), infoB = partInfoMap.get(b);
      const numA = parseInt(infoA && infoA.itemNo, 10) || 999;
      const numB = parseInt(infoB && infoB.itemNo, 10) || 999;
      return numA - numB;
    });
  } else {
    renderItems = pagePartsMap.get(pageIdx) || pagePartsMap.get(Number(pageIdx)) || [];
    if (renderItems.length === 0) renderItems = pagePartKeys.get(pageIdx) || pagePartKeys.get(Number(pageIdx)) || [];
  }

  $('listCount').textContent = renderItems.length;

  if (!renderItems.length) {
    const totalAll = partInfoMap ? partInfoMap.size : 0;
    const brandId = ((typeof getBrand === 'function' && getBrand(currentMode)) || {}).id || '?';
    box.innerHTML = `<p style="color:var(--muted);font-size:13px;text-align:center;padding:30px 14px;">無零件資料。<br><span style="font-size:11px;opacity:.8">總共 ${totalAll} 筆 · 本頁 ${pageIdx} · ${brandId}</span></p>`;
    if (scrollToTop) box.scrollTop = 0;
    return;
  }

  const token = ++partListRenderToken;
  box.innerHTML = '';
  if (scrollToTop) box.scrollTop = 0;

  const bindRow = (row) => {
    row.addEventListener('click', e => {
      if (e.target.closest('.add-btn')) return;
      const key = row.dataset.key;
      selectedKey = key;
      if (key) jumpToPart(key, { stayOnCurrent: true });
      else renderPartList(mode, pageIdx);
    });
    row.style.cursor = 'pointer';
    row.title = '點擊：在當前頁高亮（不跳頁）';
  };
  const bindBtn = (btn) => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addToPickList(btn.dataset.add, currentPageIndex);
    });
  };

  const makeRowHtml = (item) => {
    let key, info;
    if (typeof item === 'string') {
      key = item;
      info = partInfoMap.get(key);
    } else {
      key = item.partNo;
      info = item;
    }
    if (!info) info = { name: '（無名稱）', qty: 1, category: '未分類', itemNo: '' };

    // 【精準修復】確保 pageIdx 有值，並掃描全域 PickList 以同步按鈕狀態
    const safePageIdx = (typeof pageIdx === 'number' && !isNaN(pageIdx)) ? pageIdx : 0;
    let pickData = pickList.get(key + '@p' + safePageIdx);
    if (!pickData) {
      for (const [k, v] of pickList) {
        if (v.partKey && partKeysEqual(v.partKey, key)) {
          pickData = v;
          break;
        }
      }
    }
    
    const inPick = pickData !== undefined;
    const btnText = inPick ? `✓ 已加入 (${pickData.qty})` : '＋ PickList';
    const btnClass = inPick ? 'add-btn added' : 'add-btn';
    
    const safeKey = key || '';
    const sel = partKeysEqual(safeKey, selectedKey) ? ' selected' : '';
    const itemPrefix = info.itemNo ? `<span style="color:#94a3b8;font-size:12px;margin-right:6px;">[${esc(info.itemNo)}]</span>` : '';

    return `<div class="part-row${sel}" data-key="${esc(safeKey)}">
      <span class="pno">${itemPrefix}${esc(safeKey)}</span>
      <span class="pname">${esc(info.name)}</span>
      <span class="pmeta"><span class="qty">×${info.qty}</span><br>${esc(info.category || '')}</span>
      <button class="${btnClass}" data-add="${esc(safeKey)}">${btnText}</button>
    </div>`;
  };

  const batchSize = 30;
  let offset = 0;
  const appendBatch = () => {
    if (token !== partListRenderToken) return;
    const frag = document.createDocumentFragment();
    const wrap = document.createElement('div');
    const end = Math.min(offset + batchSize, renderItems.length);
    let chunk = '';
    for (let i = offset; i < end; i++) chunk += makeRowHtml(renderItems[i]);
    wrap.innerHTML = chunk;
    while (wrap.firstChild) {
      const node = wrap.firstChild;
      frag.appendChild(node);
      if (node.classList && node.classList.contains('part-row')) bindRow(node);
      const btn = node.querySelector && node.querySelector('.add-btn');
      if (btn) bindBtn(btn);
    }
    box.appendChild(frag);
    offset = end;
    if (offset < renderItems.length) requestAnimationFrame(appendBatch);
  };
  appendBatch();
}

$('partSearch').addEventListener('input', () => {
  renderPartList(currentSelectValue === 'all' ? 'all' : 'page', currentPageIndex);
});

/* ================= PickList ================= */
function highlightPickListItems() {
  if (currentMode !== 'yamaha') return;
  const pageDiv = document.querySelector('.page-container[data-page-index="' + currentPageIndex + '"]');
  if (!pageDiv) return;
  pageDiv.querySelectorAll('.pick-marker').forEach(el => el.remove());
  const itemNos = new Set();
  for (const [k, v] of pickList) {
    if (v.pageIndex === currentPageIndex && v.itemNo) itemNos.add(String(v.itemNo));
  }
  if (!itemNos.size) return;
  const canvas = pageDiv.querySelector('canvas');
  if (!canvas) return;
  const items = pageDiv._textItems || [];
  for (const it of items) {
    const s = String(it.str || '').trim();
    if (!itemNos.has(s)) continue;
    if (!/^\d{1,3}$/.test(s)) continue;
    const x = it.transform[4] || 0;
    const y = it.transform[5] || 0;
    if (x > 300) continue;
    const marker = document.createElement('div');
    marker.className = 'pick-marker';
    marker.style.cssText = 'position:absolute;left:' + (x - 2) + 'px;top:' + (y - 10) + 'px;width:16px;height:14px;border:2px solid #e11d48;border-radius:2px;pointer-events:none;z-index:5;';
    pageDiv.appendChild(marker);
  }
}

function addToPickList(key, pageIdx) {
  if (!key) return;
  key = String(key).trim();
  if (!key) return;

  let info = partInfoMap.get(key);

  const pIdx = (pageIdx != null) ? pageIdx : (typeof currentPageIndex !== 'undefined' ? currentPageIndex : 0);
  const pickKey = key + '@p' + pIdx;

  // 檢查是否已存在相同零件號（合併）
  for (const [k, v] of pickList) {
    if (partKeysEqual(v.partKey || '', key)) {
      pickList.get(k).qty += (info && info.qty ? info.qty : 1);
      renderPickList();
      if (typeof highlightPickListItems === 'function') highlightPickListItems();
      return;
    }
  }

  // 從頁面資料取得零件資訊
  const pageParts = pagePartsMap.get(pIdx) || [];
  const foundInPage = pageParts.find(p => partKeysEqual(p.partNo, key));
  if (foundInPage) info = foundInPage;

  if (!info) info = { name: '（無名稱）', qty: 1, category: '未分類', itemNo: '' };

  pickList.set(pickKey, {
    partKey: key,
    pageIndex: pIdx,
    name: info.name || '（無名稱）',
    qty: info.qty || 1,
    category: info.category || '未分類',
    itemNo: info.itemNo || ''
  });

  renderPickList();
  if (typeof highlightPickListItems === 'function') highlightPickListItems();
}

function setPickQty(key, qty) {
  if (!pickList.has(key)) return;
  if (qty <= 0) pickList.delete(key);
  else pickList.get(key).qty = qty;
  renderPickList();
}

function updatePartButtons() {
  document.querySelectorAll('.add-btn').forEach(btn => {
    const key = btn.dataset.add;
    let pickData = null;
    for (const [k, v] of pickList) {
      const cleanKey = v.partKey || k.split('@p')[0];
      if (partKeysEqual(cleanKey, key)) { pickData = v; break; }
    }
    if (pickData) {
      btn.textContent = `✓ 已加入 (${pickData.qty})`;
      btn.classList.add('added');
    } else {
      btn.textContent = '＋ PickList';
      btn.classList.remove('added');
    }
  });
}

function renderPickList() {
  const box = $('pickListBox');
  $('pickCount').textContent = pickList.size;
  {
    const b = document.getElementById('btnClearPick');
    if (b) {
      if (pickList.size > 0) b.removeAttribute('disabled');
      else b.setAttribute('disabled', 'disabled');
    }
  }

  if (!pickList.size) {
    box.innerHTML = '<div class="pick-empty"><strong>PickList 是空的</strong>從「零件清單」或圖面點擊加入</div>';
    $('pickSummary').textContent = '';
    updatePartButtons();
    return;
  }

  let html = '';
  let totalQty = 0;
  for (const [pickKey, data] of pickList) {
    totalQty += data.qty;
    const partKey = data.partKey || pickKey.split('@p')[0];
    const pIdx = data.pageIndex != null ? data.pageIndex : 0;
    const itemPrefix = data.itemNo ? `<span style="color:#94a3b8;font-size:12px;margin-right:6px;">[${esc(data.itemNo)}]</span>` : '';
    const sel = partKeysEqual(partKey, selectedKey) ? ' selected' : '';

    html += `<div class="pick-item${sel}" data-key="${esc(pickKey)}" data-part="${esc(partKey)}" data-page="${pIdx}">
      <div class="pick-item-top">
        <span class="pk-no">${itemPrefix}${esc(partKey)}</span>
        <span class="pk-name">${esc(data.name)}</span>
        <span class="pk-cat">${esc(data.category)} · 第 ${pIdx+1} 頁</span>
      </div>
      <div class="pick-item-bottom">
        <div class="pick-ctrl">
          <button data-pk-dec="${esc(pickKey)}">−</button>
          <input type="number" min="1" value="${data.qty}" data-pk-input="${esc(pickKey)}">
          <button data-pk-inc="${esc(pickKey)}">+</button>
        </div>
      </div>
    </div>`;
  }
  box.innerHTML = html;
  $('pickSummary').textContent = `共 ${pickList.size} 種零件，合計 ${totalQty} 件`;

  box.querySelectorAll('.pick-item').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.pick-ctrl')) return;
      const pickKey = row.dataset.key;
      const partKey = row.dataset.part || pickKey;
      const pIdx = parseInt(row.dataset.page, 10);
      if (!pickKey || !partKey) return;

      selectedKey = partKey;

      box.querySelectorAll('.pick-item').forEach(r => {
        r.classList.toggle('selected', r === row);
      });
      document.querySelectorAll('#partList .part-row').forEach(r => {
        r.classList.toggle('selected', partKeysEqual(r.dataset.key, partKey));
      });

      // PickList：先試當前頁，沒有才跳到零件所在頁
      jumpToPart(partKey, {
        preferCurrent: true,
        hintPage: isNaN(pIdx) ? undefined : pIdx
      });
    });
  });
  box.querySelectorAll('[data-pk-dec]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const cur = pickList.get(b.dataset.pkDec);
    if (cur) setPickQty(b.dataset.pkDec, cur.qty - 1);
  });
  box.querySelectorAll('[data-pk-inc]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const cur = pickList.get(b.dataset.pkInc);
    if (cur) setPickQty(b.dataset.pkInc, cur.qty + 1);
  });
  box.querySelectorAll('[data-pk-input]').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('change', () => {
      let v = parseInt(inp.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      setPickQty(inp.dataset.pkInput, v);
    });
  });
  updatePartButtons();
}

(function bindClearPick() {
  const btn = document.getElementById('btnClearPick');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pickList.size) return;
    if (!confirm('確定清空 PickList？（共 ' + pickList.size + ' 種零件）')) return;
    pickList.clear();
    renderPickList();
  });
})();

/* ================= 分頁切換 ================= */
function switchView(name) {
  document.querySelectorAll('.sidebar-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === name);
  });
  document.querySelectorAll('.panel-view').forEach(v => {
    v.classList.toggle('active', v.id === 'view' + name.charAt(0).toUpperCase() + name.slice(1));
  });
}
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

/* ================= 匯出 ================= */
const modal = $('modal');
$('btnExportPick').addEventListener('click', () => {
  if (!pickList.size) { alert('PickList 是空的。'); return; }
  modal.classList.add('open');
  buildModalContent();
});
$('btnClose').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('mousedown', e => {
  if (e.target === modal) modal.classList.remove('open');
});

function buildModalContent() {
  let totalQty = 0, rows = '';
  for (const [key, d] of pickList) {
    totalQty += d.qty;
    const displayKey = d.partKey || key.split('@p')[0];
    rows += `<tr><td>${esc(displayKey)}</td><td>${esc(d.name)}</td><td>${d.qty}</td></tr>`;
  }
  $('modalBody').innerHTML = `
    <table class="modal-table">
      <thead><tr><th>零件號碼</th><th>產品名稱</th><th>數量</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="2" style="border:none;padding-top:10px;">合計 ${pickList.size} 種</th><th style="border:none;padding-top:10px;">${totalQty} 件</th></tr></tfoot>
    </table>
    <p style="color:#7b8794;font-size:12px;margin-top:12px;">建立時間：${new Date().toLocaleString()}</p>`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

$('btnCopy').addEventListener('click', async () => {
  let t = '';
  for (const [k, d] of pickList) {
    const cleanKey = (d.partKey || k.split('@p')[0]).replace(/[–—]/g, '-');
    let pureName = (d.name || '').trim();
    const nameNorm = pureName.replace(/[–—]/g, '-');
    if (nameNorm.toUpperCase().startsWith(cleanKey.toUpperCase())) {
      pureName = nameNorm.substring(cleanKey.length).replace(/^[\s\-]+/, '').trim();
    }
    if (!pureName) pureName = d.name || '';
    t += `${cleanKey}\t${pureName}\tx${d.qty}\n`;
  }
  const ok = await copyText(t);
  const btn = $('btnCopy');
  const orig = btn.innerHTML;
  btn.innerHTML = ok ? '✅ 已複製' : '❌ 複製失敗';
  setTimeout(() => btn.innerHTML = orig, 2000);
});

$('btnPrint').addEventListener('click', () => window.print());

$('btnExcel').addEventListener('click', () => {
  const csvEsc = v => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let csv = '零件號碼,產品名稱,數量\n';
  let total = 0;
  for (const [k, d] of pickList) {
    total += d.qty;
    const cleanKey = (d.partKey || k.split('@p')[0]).replace(/[–—]/g, '-');
    let pureName = (d.name || '').trim();
    if (pureName.toUpperCase().startsWith(cleanKey.toUpperCase())) {
      pureName = pureName.substring(cleanKey.length).replace(/^[\s\-]+/, '').trim();
    }
    csv += [cleanKey, pureName || d.name, d.qty].map(csvEsc).join(',') + '\n';
  }
  csv += `,合計,${total}\n`;
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `PickList_${getTimestamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

/* ================= 側欄收合 ================= */
(function initSidebarCollapse() {
  const layout = document.querySelector('.layout');
  const btn = $('btnSidebarCollapse');
  if (!layout || !btn) return;

  function syncIcon() {
    const collapsed = layout.classList.contains('panel-collapsed');
    const isLandscape = window.matchMedia('(orientation: landscape)').matches && window.innerWidth <= 1024;
    btn.textContent = collapsed ? '放' : '收';
    btn.title = collapsed ? '展開清單' : '收起清單';

    const listTab = document.querySelector('.sidebar-tab[data-view="list"]');
    const pickTab = document.querySelector('.sidebar-tab[data-view="pick"]');
    if (isLandscape && collapsed) {
      if (listTab) {
        const cnt = listTab.querySelector('.cnt');
        listTab.innerHTML = '零' + (cnt ? cnt.outerHTML : '');
      }
      if (pickTab) {
        const cnt = pickTab.querySelector('.cnt');
        pickTab.innerHTML = 'L' + (cnt ? cnt.outerHTML : '');
      }
    } else {
      if (listTab && !listTab.innerHTML.includes('零件清單')) {
        const cnt = listTab.querySelector('.cnt');
        listTab.innerHTML = '📋 零件清單' + (cnt ? cnt.outerHTML : '');
      }
      if (pickTab && !pickTab.innerHTML.includes('PickList')) {
        const cnt = pickTab.querySelector('.cnt');
        pickTab.innerHTML = '🛒 PickList' + (cnt ? cnt.outerHTML : '');
      }
    }
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    layout.classList.toggle('panel-collapsed');
    syncIcon();
  });
  window.addEventListener('resize', syncIcon);
  syncIcon();
})();

/* ================= 初始化 ================= */
renderPartList('page', 0, true);
renderPickList();
updateRamUsage();

/* ================= 多 PDF 合併 ================= */
document.getElementById('fileInputMultiPdf')?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const loadingEl = document.getElementById('loading');
  loadingEl.classList.add('show');
  loadingEl.innerHTML = '<div style="text-align:center">正在處理 PDF…</div>';
  try {
    const { PDFDocument } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
    const merged = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      loadingEl.innerHTML = `<div style="text-align:center">正在處理 ${i + 1} / ${files.length}…</div>`;
      const bytes = await file.arrayBuffer();
      let doc;
      try {
        doc = await PDFDocument.load(bytes);
      } catch (err) {
        throw new Error(`檔案「${file.name}」無法載入，可能受到密碼保護或不支援該格式。`);
      }
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const mergedBytes = await merged.save();
    const blob = new Blob([mergedBytes], { type: 'application/pdf' });
    const mergedFile = new File([blob], 'merged.pdf', { type: 'application/pdf' });
    loadingEl.classList.remove('show');
    handleFiles([mergedFile], selectedBrand || 'yamaha');
  } catch (err) {
    loadingEl.classList.remove('show');
    alert('合併 PDF 失敗：' + err.message);
  }
  e.target.value = '';
});

/* ================= 圖片上傳（預留） ================= */
document.getElementById('fileInputImage')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  console.log('圖片上傳:', file.name);
  alert('圖片識別功能開發中：' + file.name);
  e.target.value = '';
});

/* ================= 計算機 ================= */
function setSidebarCollapsed(collapsed) {
  const layout = document.querySelector('.layout');
  const btn = document.getElementById('btnSidebarCollapse');
  if (!layout) return;
  if (collapsed) layout.classList.add('panel-collapsed');
  else layout.classList.remove('panel-collapsed');
  if (btn) btn.textContent = collapsed ? '放' : '收';
  try {
    if (typeof updateHorizontalScrollLock === 'function') updateHorizontalScrollLock();
    if (typeof getMinZoomScale === 'function' && typeof applyZoom === 'function' && currentPdfDoc) {
      const minZ = getMinZoomScale();
      if (scale < minZ - 0.001) applyZoom(minZ);
    }
  } catch (e) {}
}

function isLandscape() {
  try {
    return window.matchMedia && window.matchMedia('(orientation: landscape)').matches;
  } catch (e) {
    return window.innerWidth > window.innerHeight;
  }
}

function openCalc() {
  const layout = document.querySelector('.layout');
  if (!layout) return;
  let calcFrame = document.getElementById('calcIframeContainer');
  const landscape = isLandscape();

  if (calcFrame) {
    calcFrame.style.display = 'flex';
    applyCalcMode(calcFrame, landscape);
    layout.classList.add('calc-open');
    setSidebarCollapsed(true);
    return;
  }

  layout.classList.add('calc-open');
  setSidebarCollapsed(true);

  calcFrame = document.createElement('div');
  calcFrame.id = 'calcIframeContainer';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:#f5f6f8;border-bottom:1px solid #e3e6ea;padding:0 16px;height:44px;flex-shrink:0;';
  header.innerHTML = '<span style="font-weight:bold;font-size:15px;color:#1f2933;">計算機</span>';

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '✕ 關閉';
  closeBtn.style.cssText = 'background:none;border:none;color:#dc2626;font-size:14px;cursor:pointer;font-weight:bold;padding:4px 8px;border-radius:4px;';
  closeBtn.onmouseover = () => { closeBtn.style.background = '#fee2e2'; };
  closeBtn.onmouseout = () => { closeBtn.style.background = 'none'; };
  closeBtn.onclick = () => {
    calcFrame.remove();
    layout.classList.remove('calc-open');
    document.body.classList.remove('calc-fullscreen');
    setSidebarCollapsed(false);
  };
  header.appendChild(closeBtn);

  const iframe = document.createElement('iframe');
  iframe.src = 'calc.html';
  iframe.style.cssText = 'flex:1;width:100%;border:none;background:#fff;';

  calcFrame.appendChild(header);
  calcFrame.appendChild(iframe);
  applyCalcMode(calcFrame, landscape);
  // 全屏掛 body；非全屏掛 layout
  if (landscape) document.body.appendChild(calcFrame);
  else {
    layout.style.position = 'relative';
    layout.appendChild(calcFrame);
  }
}

function applyCalcMode(calcFrame, landscape) {
  if (!calcFrame) return;
  if (landscape) {
    document.body.classList.add('calc-fullscreen');
    calcFrame.classList.add('calc-fs');
    // 橫屏全螢幕：貼齊螢幕，安全區交給 calc.html 內部處理
    calcFrame.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;margin:0;padding:0;background:#f1f5f9;z-index:5000;display:flex;flex-direction:column;box-sizing:border-box;';
    if (calcFrame.parentElement !== document.body) document.body.appendChild(calcFrame);
  } else {
    document.body.classList.remove('calc-fullscreen');
    calcFrame.classList.remove('calc-fs');
    calcFrame.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:#fff;z-index:1200;display:flex;flex-direction:column;';
    const layout = document.querySelector('.layout');
    if (layout && calcFrame.parentElement !== layout) {
      layout.style.position = 'relative';
      layout.appendChild(calcFrame);
    }
  }
  // 保持 header/iframe 結構
  const header = calcFrame.querySelector('div');
  const iframe = calcFrame.querySelector('iframe');
  if (header) header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:#f5f6f8;border-bottom:1px solid #e3e6ea;padding:0 16px;height:44px;flex-shrink:0;';
  if (iframe) iframe.style.cssText = 'flex:1;width:100%;border:none;background:#fff;';
}

document.getElementById('btnCalc')?.addEventListener('click', openCalc);

// 旋轉時若計算機開著，切換全屏／非全屏
window.addEventListener('orientationchange', function () {
  const calcFrame = document.getElementById('calcIframeContainer');
  if (!calcFrame) return;
  setTimeout(function () { applyCalcMode(calcFrame, isLandscape()); }, 100);
});
window.addEventListener('resize', function () {
  const calcFrame = document.getElementById('calcIframeContainer');
  if (!calcFrame) return;
  applyCalcMode(calcFrame, isLandscape());
});

//--------以下是下載到手機--------//

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=20261122b')
      .then(function (reg) {
        console.log('SW 註冊成功');
        try { reg.update(); } catch (e) {}
      })
      .catch(err => console.error('SW 註冊失敗:', err));
    // 清掉舊 cache（避免手機一直用舊 yamaha.js）
    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        keys.forEach(function (k) {
          if (k !== 'mot-cache-v20261122b') caches.delete(k);
        });
      });
    }
  });
}
