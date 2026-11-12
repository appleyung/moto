if (typeof pdfjsLib === 'undefined') {
  alert('PDF.js 載入失敗，請檢查網路連線。');
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}
let jsPDF = null;
if (typeof window.jspdf !== 'undefined') { jsPDF = window.jspdf.jsPDF; }

document.addEventListener('contextmenu', e => e.preventDefault());

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function getTimestamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ================= 記憶體監控（桌面實測 / 手機估算） ================= */
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
  const partCount  = (typeof partInfoMap !== 'undefined' && partInfoMap) ? partInfoMap.size : 0;
  const pickCount  = (typeof pickList    !== 'undefined' && pickList)    ? pickList.size    : 0;
  const dataBytes  = partCount * 260 + pickCount * 200 + pageShells * 4 * 1024;
  const rawPdfBytes = (typeof loadedPdfFileBytes === 'number') ? loadedPdfFileBytes : 0;
  const pdfjsCacheBytes = renderedCount * 150 * 1024;

  const heap = getHeapInfo();
  const prefix = IS_DESKTOP_MODE ? 'RAM' : '內存';
  let totalMB = 0;

  // 桌面 + Chromium：實測
  if (IS_DESKTOP_MODE && heap) {
    _heapSmooth = _heapSmooth === 0 ? heap.used : (_heapSmooth * 0.4 + heap.used * 0.6);
    const pdfExtraBytes = rawPdfBytes + canvasBytes + 1.5 * 1048576 + pdfjsCacheBytes;
    totalMB = (_heapSmooth + pdfExtraBytes) / 1048576;
    const ratio = heap.limit > 0 ? (heap.used / heap.limit) : 0;
    ramEl.style.color = ratio >= 0.85 ? '#dc2626' : ratio >= 0.7 ? '#d97706' : '';
    ramEl.textContent = `快取:${Math.ceil(totalMB)}M`;
    ramEl.title =
      `【桌面實測 + 補齊】\n──────────────────────\n` +
      `JS 堆：${(heap.used/1048576).toFixed(2)} M / 上限 ${(heap.limit/1048576).toFixed(0)} M（${(ratio*100).toFixed(0)}%）\n` +
      `PDF 原檔：${(rawPdfBytes/1048576).toFixed(2)} M\n` +
      `Canvas（${renderedCount} 頁）：${(canvasBytes/1048576).toFixed(2)} M\n` +
      `worker base：1.50 M\n` +
      `worker 快取：${(pdfjsCacheBytes/1048576).toFixed(2)} M\n──────────────────────\n` +
      `合計 ≈ ${totalMB.toFixed(2)} M`;
    return;
  }

  // 手機 / 無 performance.memory：估算
  const estimatedBytes =
    siteBaselineBytes + rawPdfBytes + pdfjsCacheBytes + canvasBytes + domBytes + dataBytes;
  totalMB = estimatedBytes / 1048576;
  ramEl.style.color = totalMB >= 300 ? '#dc2626' : totalMB >= 180 ? '#d97706' : '';
  ramEl.textContent = `快取:${Math.ceil(totalMB)}M`;
  ramEl.title =
    `【估算】\n──────────────────────\n合計 ≈ ${totalMB.toFixed(1)} M\n` +
    `網頁本體：${(siteBaselineBytes/1048576).toFixed(2)} M\n` +
    `PDF 原檔：${(rawPdfBytes/1048576).toFixed(2)} M\n` +
    `PDF.js 快取：${(pdfjsCacheBytes/1048576).toFixed(2)} M\n` +
    `Canvas（${renderedCount} 頁）：${(canvasBytes/1048576).toFixed(2)} M\n` +
    `DOM：${(domBytes/1048576).toFixed(2)} M\n` +
    `應用資料：${(dataBytes/1048576).toFixed(2)} M`;
}
// setInterval(updateRamUsage, 1000); // disabled


/* ================= 下拉選單邏輯 ================= */
if ($('btnMenuToggle')) /* menu removed V20.110 */
document.addEventListener('click', (e) => {
  if ($('dropdownMenu') && !e.target.closest('.menu-wrapper')) {
    $('dropdownMenu').classList.remove('open');
  }
});

/* ================= 翻譯字典 ================= */
const TRANSLATIONS = {}; 
function translateText(text) {
  if (!text) return text;
  const packs = window.EPC_TRANSFER || {};
  // Prefer active locale packs, then eng
  const order = [];
  try {
    if (typeof currentMode !== 'undefined' && currentMode === 'honda' && typeof hondaLocale !== 'undefined') {
      if (hondaLocale === 'jp') order.push('jp');
      if (hondaLocale === 'id') order.push('id');
    }
    if (typeof currentMode !== 'undefined' && currentMode === 'kawasaki' && typeof kawasakiLocale !== 'undefined') {
      if (kawasakiLocale === 'th') order.push('th');
      if (kawasakiLocale === 'id') order.push('id');
    }
  } catch (e) {}
  order.push('eng', 'jp', 'id', 'th');
  let s = String(text);
  for (const lang of order) {
    const dict = packs[lang];
    if (!dict) continue;
    if (dict[s]) return dict[s];
  }
  return s;
}

/* ================= 資料層 ================= */
// Honda：5-xxx-xxx（第三段可至5碼如 NA0ZB），禁止與下一號黏連
// V20.90：完整 Honda 號才算（xxxxx-xxx-xxx / xxxxx-xxxxx-xx / xxxxx-xxxxx），不抓 14401-K29、SCZ-0404 半截

/* moved to brand module */


/* moved to brand module */


/* moved to brand module */


/* moved to brand module */


const partInfoMap = new Map();          
const pagePartKeys = new Map();         
const pageTitles = new Map();
/** 部品番號索引：零件號 → { fig, item } */
const partFigLocations = new Map();
const pickList = new Map();             
let selectedKey = null;                 
let currentPageIndex = 0;
let isScrollingProgrammatically = false;
let navLockTimer = null;
let navLockTarget = null;
let currentSelectValue = 'all';
let currentMode = 'yamaha'; 
let currentPdfDoc = null; 
let renderedPages = new Set();
// pageRenderedScale 見上方 RENDER_SCALE 區塊
let pageRenderTasks = new Map(); // V20.60：可取消的 render task
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
let loadedPdfFileBytes = 0; // 上傳 PDF 原始大小
let hondaLocale = 'jp';
let kawasakiLocale = 'en';

const normalizePartNo = s => String(s).replace(/[－–—]/g, '-').replace(/\s+/g, '').toUpperCase();
/** Yamaha 完整號：B74-F3141-00 / 2CM-F3166-00 / 93399-99932；拒絕 74-F3141-00 這類缺前綴殘段 */

/* moved to brand module */


/* moved to brand module */


function normalizeText(t) {
  return t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
          .replace(/[－–—]/g, '-').replace(/\s+/g, '').toUpperCase();
}
function parsePartNo(rawStr, mode = 'yamaha') {
  let cleanStr = normalizeText(rawStr);
  if (mode === 'kawasaki') return { partNo: cleanStr, itemNo: '' };
  if (!cleanStr.includes('-')) return { partNo: cleanStr, itemNo: '' };
  let parts = cleanStr.split('-'), itemNo = '';
  if (parts.length >= 2) {
    let first = parts[0];
    if (first.length > 5 && /^[A-Z0-9]+$/.test(first)) { 
      itemNo = first.substring(0, first.length - 5); 
      parts[0] = first.substring(first.length - 5); 
    }
  }
  return { partNo: parts.join('-'), itemNo };
}

/* ================= 縮放與原生滑動（V20.16：雙指縮放 + 同時平移，類似手機瀏覽器） ================= */
const _isMobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 1024;
// V20.60 B：手機降低解析度，減少閃退
const RENDER_SCALE = _isMobileUA ? 2.0 : 2.5;
/** 鄰頁相對倍率：當前頁 1.0×RENDER_SCALE，前後頁 0.5×RENDER_SCALE */
const NEIGHBOR_SCALE_RATIO = 0.5;
function getRenderScaleForPage(pageIndex, centerIndex) {
  if (pageIndex === centerIndex) return RENDER_SCALE;
  return Math.max(0.5, RENDER_SCALE * NEIGHBOR_SCALE_RATIO);
}
const pageRenderedScale = new Map(); // pageIndex → 實際用來畫 canvas 的 scale

let scale = 1;
const viewport = $('pdfViewport');
const container = $('pdfContainer');
const scaleWrapper = $('pdfScaleWrapper');
const zoomInput = $('zoomText');
const emptyState = $('emptyState');

// V20.47：改用 transform:scale，避免 CSS zoom 在 iOS 單指→雙指跳動
function zoomFactor() {
  return scale / RENDER_SCALE;
}

function updateScaleTransform() {
  const z = zoomFactor();
  container.style.transform = 'scale(' + z + ')';
  container.style.transformOrigin = '0 0';
  // 讓捲動區域等於「視覺大小」
  const w = container.offsetWidth;
  const h = container.offsetHeight;
  if (scaleWrapper) {
    scaleWrapper.style.width = Math.max(1, w * z) + 'px';
    scaleWrapper.style.height = Math.max(1, h * z) + 'px';
  }
}

function contentPointFromMid(midX, midY) {
  const z = zoomFactor();
  return {
    x: (viewport.scrollLeft + midX) / z,
    y: (viewport.scrollTop + midY) / z
  };
}

function scrollToKeepContentAtMid(cx, cy, midX, midY) {
  const z = zoomFactor();
  viewport.scrollLeft = cx * z - midX;
  viewport.scrollTop = cy * z - midY;
}

function applyZoom(newScale, originX, originY, skipReflow) {
  const oldScale = scale;
  const oldZ = oldScale / RENDER_SCALE;
  scale = Math.max(0.2, Math.min(newScale, 5));
  if (Math.abs(scale - oldScale) < 0.0001) {
    zoomInput.value = Math.round(scale * 100);
    return;
  }

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

$('btnZoomIn').onclick = () => applyZoom(scale + 0.2);
$('btnZoomOut').onclick = () => applyZoom(scale - 0.2);
zoomInput.addEventListener('keydown', e => { if (e.key === 'Enter') zoomInput.blur(); });
const handleZoomInput = () => {
  let v = parseFloat(zoomInput.value);
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

// ---- 雙指：縮放（V20.50：100ms 內第二指落下視為同時按下）----
//   PINCH_SIMULTANEOUS_MS = 100  第一指與第二指間隔 ≤100ms 可捏合
//   PINCH_MIN_DIST_START  = 16px
//   PINCH_MIN_DIST_MOVE   = 10px
let pinchActive = false;
let pinchBaseDist = 0;
let pinchBaseScale = 1;
let pinchContentX = 0, pinchContentY = 0;
let pinchRaf = null;
let lastPinchPts = null;
let singleFingerPan = false;
let firstTouchTime = 0; // 本輪第一指 touchstart 時間
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
  singleFingerPan = false; // 已進入合法捏合
  return true;
}

function applyPinchFrame(pts) {
  if (!pts || !pinchActive || pinchBaseDist < PINCH_MIN_DIST_START) return;
  const { dist, midX, midY } = midDistFromPts(pts);
  if (dist < PINCH_MIN_DIST_MOVE) return;
  const newScale = Math.max(0.2, Math.min(pinchBaseScale * (dist / pinchBaseDist), 5));
  scale = newScale;
  updateScaleTransform();
  if (zoomInput) zoomInput.value = Math.round(scale * 100);
  scrollToKeepContentAtMid(pinchContentX, pinchContentY, midX, midY);
}

viewport.addEventListener('touchstart', e => {
  const now = performance.now();

  if (e.touches.length === 1) {
    firstTouchTime = now;
    singleFingerPan = false; // 先不鎖定，等超過 100ms 或開始移動再當單指平移
    pinchActive = false;
    pinchBaseDist = 0;
    lastPinchPts = null;
    // 延遲標記：100ms 內若沒有第二指，才算單指拖曳手勢
    clearTimeout(window._pinchArmTimer);
    window._pinchArmTimer = setTimeout(() => {
      if (!pinchActive) singleFingerPan = true;
    }, PINCH_SIMULTANEOUS_MS);
    return;
  }

  if (e.touches.length >= 2) {
    clearTimeout(window._pinchArmTimer);
    const dt = firstTouchTime ? (now - firstTouchTime) : 0;
    // 兩指同時（同一次 touchstart 已有 2 指）或間隔 ≤100ms
    const simultaneous = !firstTouchTime || dt <= PINCH_SIMULTANEOUS_MS;

    if (singleFingerPan && !simultaneous) {
      // 單指已拖超過 100ms 後才加第二指 → 不縮放
      pinchActive = false;
      lastPinchPts = null;
      return;
    }

    const pts = readTwoTouches(e.touches);
    if (armPinch(pts) && e.cancelable) e.preventDefault();
  }
}, { passive: false });

// 單指若在 100ms 內就開始明顯移動，仍允許等第二指；超過 100ms 的 move 視為平移鎖定
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
    window._zoomRenderTimeout = setTimeout(() => { updateScaleTransform(); syncCurrentPage(); }, 100);
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
    // 剩一指：若已超過時間窗則維持 singleFingerPan
    if (firstTouchTime && (performance.now() - firstTouchTime) > PINCH_SIMULTANEOUS_MS) {
      singleFingerPan = true;
    }
  }
});
viewport.addEventListener('touchcancel', () => {
  clearTimeout(window._pinchArmTimer);
  singleFingerPan = false;
  firstTouchTime = 0;
  endPinchGesture();
});

/* ================= 核心：動態渲染與釋放 (V20.60：旋轉 + 穩定) ================= */
function getPageRotation(page) {
  const r = page && (page.rotate != null ? page.rotate : 0);
  return ((r % 360) + 360) % 360;
}
function getPageViewport(page, scale) {
  return page.getViewport({ scale: scale, rotation: getPageRotation(page) });
}


async function renderPagesInRange(centerIndex) {
  if (!currentPdfDoc) return;
  const gen = ++renderGeneration;

  // 固定預載 前1 + 本頁 + 後1 = 共 3 頁（之後勿改）
  const start = Math.max(0, centerIndex - 1);
  const end = Math.min(currentPdfDoc.numPages - 1, centerIndex + 1);

  // ① 釋放範圍外
  pageRenderTasks.forEach((task, idx) => {
    try { task.cancel(); } catch (e) {}
    if (idx < start || idx > end) pageRenderTasks.delete(idx);
  });

  const toRemove = [];
  renderedPages.forEach(idx => {
    if (idx < start || idx > end) toRemove.push(idx);
  });

  toRemove.forEach(idx => {
    if (pageRenderTasks.has(idx)) {
      try { pageRenderTasks.get(idx).cancel(); } catch (e) {}
      pageRenderTasks.delete(idx);
    }
    const pageDiv = container.querySelector(`.page-container[data-page-index="${idx}"]`);
    if (pageDiv) {
      pageDiv.querySelectorAll('canvas').forEach(c => {
        try { c.width = 0; c.height = 0; } catch (e) {}
      });
      pageDiv.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;">載入中...</div>';
      pageDiv.classList.add('placeholder');
    }
    renderedPages.delete(idx);
  });

  // cleanup 暫時停用（避免 startCleanup 錯誤干擾解析）
  navigateCount++;
  updateRamUsage();
  await new Promise(r => setTimeout(r, 50));
  await new Promise(r => requestAnimationFrame(() => r()));
  if (gen !== renderGeneration) return;

  await new Promise(r => setTimeout(r, 100));
  if (gen !== renderGeneration) return;

  // V20.103：本頁高倍率、鄰頁 0.5×；角色變了要重繪
  const order = [centerIndex, centerIndex - 1, centerIndex + 1]
    .filter((idx, i, arr) => idx >= start && idx <= end && arr.indexOf(idx) === i);
  for (const i of order) {
    if (gen !== renderGeneration) return;
    const wantScale = getRenderScaleForPage(i, centerIndex);
    const hadScale = pageRenderedScale.get(i);
    if (renderedPages.has(i) && hadScale === wantScale) continue;
    // 倍率角色改變：先清掉再畫
    if (renderedPages.has(i)) {
      if (pageRenderTasks.has(i)) {
        try { pageRenderTasks.get(i).cancel(); } catch (e) {}
        pageRenderTasks.delete(i);
      }
      const pageDiv = container.querySelector(`.page-container[data-page-index="${i}"]`);
      if (pageDiv) {
        pageDiv.querySelectorAll('canvas').forEach(c => {
          try { c.width = 0; c.height = 0; } catch (e) {}
        });
        // 佔位高度用「當前頁倍率」的版面尺寸，避免捲動跳動
        try {
          const page = await currentPdfDoc.getPage(i + 1);
          const layoutVp = getPageViewport(page, RENDER_SCALE);
          pageDiv.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px;">載入中...</div>';
          pageDiv.classList.add('placeholder');
          pageDiv.style.width = layoutVp.width + 'px';
          pageDiv.style.height = layoutVp.height + 'px';
        } catch (e) {
          pageDiv.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;">載入中...</div>';
          pageDiv.classList.add('placeholder');
        }
      }
      renderedPages.delete(i);
      pageRenderedScale.delete(i);
    }
    await renderSinglePage(i, gen, wantScale, centerIndex);
  }
}


async function renderSinglePage(pageIndex, gen, pageScale, centerIndex) {
  const pageDiv = container.querySelector(`.page-container[data-page-index="${pageIndex}"]`);
  if (!pageDiv || renderedPages.has(pageIndex)) return;
  
  const drawScale = pageScale != null ? pageScale : RENDER_SCALE;
  const isNeighbor = centerIndex != null && pageIndex !== centerIndex;
  // 高亮範圍：當前頁 ±1（與 3 頁渲染窗一致）
  const doHighlight = centerIndex == null || Math.abs(pageIndex - centerIndex) <= 1;
  renderedPages.add(pageIndex);
  pageRenderedScale.set(pageIndex, drawScale);
  
  try {
    if (gen != null && gen !== renderGeneration) { renderedPages.delete(pageIndex); pageRenderedScale.delete(pageIndex); return; }
    const page = await currentPdfDoc.getPage(pageIndex + 1);
    if (gen != null && gen !== renderGeneration) { renderedPages.delete(pageIndex); pageRenderedScale.delete(pageIndex); return; }
    // 版面尺寸永遠用 RENDER_SCALE，捲動高度一致；實際像素用 drawScale
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
    // 鄰頁低解析：canvas 拉伸填滿版面
    canvas.style.width = layoutVp.width + 'px';
    canvas.style.height = layoutVp.height + 'px';
    canvas.style.display = 'block';
    if (isNeighbor) canvas.style.imageRendering = 'auto';
    pageDiv.appendChild(canvas);
    
    if (pageRenderTasks.has(pageIndex)) {
      try { pageRenderTasks.get(pageIndex).cancel(); } catch (e) {}
    }
    const task = page.render({ canvasContext: ctx, viewport: drawVp });
    pageRenderTasks.set(pageIndex, task);
    try {
      await task.promise;
    } catch (re) {
      if (re && (re.name === 'RenderingCancelledException' || /cancel/i.test(String(re.message || re)))) {
        renderedPages.delete(pageIndex);
        pageRenderedScale.delete(pageIndex);
        pageRenderTasks.delete(pageIndex);
        return;
      }
      throw re;
    }
    pageRenderTasks.delete(pageIndex);
    if (gen != null && gen !== renderGeneration) {
      try { pageDiv.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;">載入中...</div>'; pageDiv.classList.add('placeholder'); } catch (e) {}
      renderedPages.delete(pageIndex);
      pageRenderedScale.delete(pageIndex);
      return;
    }
    
    // 文字層與高亮：一律用 layout（高倍率）座標系，鄰頁可略過文字層省 CPU
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.width = layoutVp.width + 'px'; 
    textLayerDiv.style.height = layoutVp.height + 'px';
    // PDF.js TextLayer 要求 --scale-factor === viewport.scale
    const scaleFactor = String(layoutVp.scale);
    textLayerDiv.style.setProperty('--scale-factor', scaleFactor);
    pageDiv.style.setProperty('--scale-factor', scaleFactor);
    pageDiv.appendChild(textLayerDiv);
    
    const tc = await page.getTextContent();
    // 僅當前頁建立完整 textLayer；鄰頁跳過（省記憶體與時間）
    if (!isNeighbor) {
      try {
        await pdfjsLib.renderTextLayer({ textContent: tc, container: textLayerDiv, viewport: layoutVp, textDivs: [] }).promise;
      } catch (tle) {
        // 新版 API：textContentSource
        try {
          await pdfjsLib.renderTextLayer({ textContentSource: tc, container: textLayerDiv, viewport: layoutVp, textDivs: [] }).promise;
        } catch (e2) { console.warn('textLayer', e2); }
      }
    }

    try {
      if (gen != null && gen !== renderGeneration) { renderedPages.delete(pageIndex); return; }
      // 川崎：每次渲染用最新 text 再解析，避免開檔抽字不完整
      if (currentMode === 'kawasaki') {
        const parsed = parsePageData(tc.items, pageIndex, currentMode);
        pagePartKeys.set(pageIndex, parsed.keys || []);
        const prevTitle = pageTitles.get(pageIndex) || '';
        if (parsed.title && (!prevTitle || prevTitle === `第 ${pageIndex + 1} 頁` || parsed.title.length >= prevTitle.length)) {
          pageTitles.set(pageIndex, parsed.title);
        }
        try { if (pageIndex === currentPageIndex) renderPartList('page', pageIndex); } catch (e) {}
      } else if (!(pagePartKeys.has(pageIndex) && (pagePartKeys.get(pageIndex) || []).length > 0)) {
        const parsed = parsePageData(tc.items, pageIndex, currentMode);
        if (parsed.keys && parsed.keys.length) pagePartKeys.set(pageIndex, parsed.keys);
        else if (!pagePartKeys.has(pageIndex)) pagePartKeys.set(pageIndex, []);
        const prevTitle = pageTitles.get(pageIndex) || '';
        if (parsed.title && (!prevTitle || prevTitle === `第 ${pageIndex + 1} 頁` || parsed.title.length >= prevTitle.length)) {
          pageTitles.set(pageIndex, parsed.title);
        }
      }
      if (currentSelectValue === 'all' || String(currentSelectValue) === String(pageIndex) || currentPageIndex === pageIndex) {
        renderPartList(currentSelectValue === 'all' ? 'all' : 'page', pageIndex, false);
        updateCustomSelectUI(currentSelectValue);
      }
    } catch (pe) { console.warn('on-demand parse', pe); }

    // 高亮：渲染窗內 3 頁皆做（當前 ±1），不再僅當前頁
    if (doHighlight) highlightPartNumbersFromContent(pageDiv, tc, layoutVp, currentMode);
    // 若目前有選取的零件，渲染完成後補上藍色焦點
    if (typeof selectedKey === 'string' && selectedKey) {
      setTimeout(() => { try { highlightPartOnPage(selectedKey); } catch (e) {} }, 30);
    }
    // V20.65：高亮掃到的零件寫入 pagePartKeys 後，刷新清單
    if (currentMode === 'honda') {
      try {
        const idx = parseInt(pageDiv.dataset.pageIndex, 10);
        if (!isNaN(idx) && (currentSelectValue === 'all' || String(currentSelectValue) === String(idx) || currentPageIndex === idx)) {
          renderPartList(currentSelectValue === 'all' ? 'all' : 'page', idx, false);
        }
      } catch (e) {}
    }
    updateScaleTransform();
    updateRamUsage(); // 渲染完成後立即更新容量
    
  } catch (err) {
    console.error("渲染頁面失敗:", err);
    renderedPages.delete(pageIndex);
  }
}

/* ================= 滾動監聽與當前頁面同步 ================= */
let scrollTimeout = null;
function syncCurrentPage() {
  if (!currentPdfDoc) return;
  if (isScrollingProgrammatically || navLockTarget !== null) return;
  const pages = Array.from(document.querySelectorAll('.page-container'));
  if (!pages.length) return;

  // V20.27：用 scrollTop + offsetTop×zoom 判斷瀏覽區正中心落在哪一頁
  // （避免 iOS 上 CSS zoom 造成 getBoundingClientRect 失準）
  const z = zoomFactor();
  const paddingTop = parseFloat(getComputedStyle(viewport).paddingTop) || 0;
  // 瀏覽區正中心對應到「已縮放內容」的 Y
  const mid = viewport.scrollTop + viewport.clientHeight / 2 - paddingTop * 0;

  let bestPageIndex = 0;
  let bestDist = Infinity;

  for (const page of pages) {
    const idx = parseInt(page.dataset.pageIndex, 10);
    if (isNaN(idx)) continue;
    // page 在 pdfContainer 內；container 有 zoom，捲動座標系約為 offset×z
    const top = page.offsetTop * z;
    const height = page.offsetHeight * z;
    const bottom = top + height;
    const center = top + height / 2;

    if (mid >= top && mid <= bottom) {
      bestPageIndex = idx;
      bestDist = 0;
      break;
    }
    const dist = Math.abs(center - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestPageIndex = idx;
    }
  }

  renderPagesInRange(bestPageIndex);

  if (currentSelectValue === 'all') return;

  if (currentSelectValue !== String(bestPageIndex)) {
    currentSelectValue = String(bestPageIndex);
    updateCustomSelectUI(String(bestPageIndex));
    currentPageIndex = bestPageIndex;
    renderPartList('page', bestPageIndex, true);
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

// V20.29：iPhone 點狀態列回到頂部 → PDF 回到第 1 頁
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
if (btnToTop) btnToTop.addEventListener('click', (e) => { e.preventDefault(); goToPdfFirstPage(); });
viewport.addEventListener('scroll', () => {
  const st = viewport.scrollTop;
  // 狀態列點擊典型：從較大 scrollTop 瞬間回到接近 0
  if (_pdfPrevScrollTop > 120 && st <= 3 && navLockTarget === null) {
    if (currentSelectValue !== '0' && currentSelectValue !== 'all') {
      goToPdfFirstPage();
    } else if (currentSelectValue === 'all') {
      renderPagesInRange(0);
    }
  }
  _pdfPrevScrollTop = st;
}, { passive: true });

// 若系統捲的是 window 而非 pdfViewport，也接到並轉成 PDF 回頂
window.addEventListener('scroll', () => {
  if (window.scrollY > 2) return;
  if (!currentPdfDoc) return;
  if (viewport.scrollTop > 120) goToPdfFirstPage();
}, { passive: true });

// 禁止瀏覽器預設縮放手勢（雙指／雙擊），但 PDF 區內的自訂雙指縮放仍可用
document.addEventListener('gesturestart', (e) => {
  if (!e.target.closest || !e.target.closest('#pdfViewport')) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturechange', (e) => {
  if (!e.target.closest || !e.target.closest('#pdfViewport')) e.preventDefault();
}, { passive: false });
document.addEventListener('gestureend', (e) => {
  if (!e.target.closest || !e.target.closest('#pdfViewport')) e.preventDefault();
}, { passive: false });

// 雙擊上方工具列 → 回到第 1 頁（iOS 狀態列／動態島點擊無法被網頁直接接收時的替代）
(function() {
  const bar = document.querySelector('.epc-toolbar');
  if (!bar) return;
  let lastTap = 0;
  bar.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 350) {
      e.preventDefault();
      goToPdfFirstPage();
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }, { passive: false });
})();

// 使用者手動拖曳時才解除換頁鎖定；點按鈕換頁期間不要清掉
viewport.addEventListener('touchstart', (e) => {
  if (navLockTarget !== null) return; // 程式換頁鎖定中
  isScrollingProgrammatically = false;
}, { passive: true });
viewport.addEventListener('mousedown', () => {
  if (navLockTarget !== null) return;
  isScrollingProgrammatically = false;
});

/* ================= 檔案處理與旋轉修正 ================= */
function handleFiles(files, mode = 'yamaha') {
  let newPdfFile = null;
  for (const f of files) { if (/\.pdf$/i.test(f.name)) { newPdfFile = f; break; } }
  if (!newPdfFile) { alert('請提供 PDF 格式的檔案。'); return; }
  if (container.firstElementChild) {
    if (!confirm('目前已有開啟的 PDF，是否關閉舊檔並載入新的？\n（零件清單與 PickList 將一併清空）')) return;
    container.innerHTML = '';
    partInfoMap.clear(); pagePartKeys.clear(); pageTitles.clear(); partFigLocations.clear(); pickList.clear(); selectedKey = null; currentPageIndex = 0;
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
    hondaLocale = 'jp'; currentPdfDoc = null; loadedPdfFileBytes = 0;
    renderPartList('page', 0); renderPickList();
    scale = 1; applyZoom(1); viewport.scrollTop = 0;
  }
  currentMode = mode;
  loadPdf(newPdfFile, mode);
}

$('btnUploadPdf') && $('btnUploadPdf').addEventListener('click', () => $('fileInputAuto').click());
$('btnDecrypt') && $('btnDecrypt').addEventListener('click', () => $('fileInputDecrypt').click());
$('fileInputAuto').addEventListener('change', e => {
  if (e.target.files.length) { handleFiles(e.target.files, 'auto'); e.target.value = ''; }
});

/* 旋轉功能已移除 — 以下為死碼佔位避免誤用
$('fileInputRotate_REMOVED').addEventListener('change', async (e) => {
  if (!e.target.files.length) return;
  const file = e.target.files[0]; e.target.value = '';
  if (!/\.pdf$/i.test(file.name)) { alert('請提供 PDF 格式的檔案。'); return; }
  if (typeof PDFLib === 'undefined') { alert('PDF 修改套件未載入，請確認網路連線。'); return; }
  const loadingEl = $('loading');
  loadingEl.innerHTML = '正在修改頁面屬性...<br><span style="font-size:13px;font-weight:normal;color:#64748b;">強制全部頁面橫放並轉正</span>';
  loadingEl.classList.add('show');
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    pages.forEach(page => {
      page.setRotation(PDFLib.degrees(0));
      const { width, height } = page.getSize();
      if (height > width) page.setSize(height, width);
    });
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name.replace(/\.pdf$/i, '')}_landscape_${getTimestamp()}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    alert('✅ 處理完成！已保留原始畫質與文字，並將頁面轉為橫放。');
  } catch (err) {
    console.error(err); alert('❌ 處理失敗：\n' + err.message);
  } finally { loadingEl.classList.remove('show'); }
});

*/
const handleDecrypt = async (e) => {
  if (!e.target.files.length) return;
  const file = e.target.files[0]; e.target.value = '';
  if (!/\.pdf$/i.test(file.name)) { alert('請提供 PDF 格式的檔案。'); return; }
  if (!jsPDF) { alert('解密套件未載入。'); return; }
  const loadingEl = $('loading');
  loadingEl.innerHTML = '正在解密並重新打包...<br><span style="font-size:13px;font-weight:normal;color:#64748b;">處理隱形文字層中</span>';
  loadingEl.classList.add('show');
  try {
    const arrayBuffer = await file.arrayBuffer();
    let pdf;
    try { pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password: '' }).promise; }
    catch (err) {
      const pwd = prompt('此 PDF 受密碼保護，請輸入密碼：');
      if (pwd === null) throw new Error('使用者取消操作');
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password: pwd }).promise;
    }
    let pdfDoc = null;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vpR = getPageViewport(page, 2.0);
      const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
      canvas.width = vpR.width; canvas.height = vpR.height;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vpR }).promise;
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const vpO = getPageViewport(page, 1.0);
      const w = vpO.width, h = vpO.height;
      if (!pdfDoc) pdfDoc = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'pt', format: [w, h] });
      else pdfDoc.addPage([w, h], w > h ? 'landscape' : 'portrait');
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
  } catch (err) { console.error(err); alert('❌ 處理失敗：\n' + err.message); }
  finally { loadingEl.classList.remove('show'); }
};
$('fileInputDecrypt').addEventListener('change', handleDecrypt);

let dragCounter = 0; const overlay = $('dragOverlay');
window.addEventListener('dragenter', e => { e.preventDefault(); dragCounter++; if (e.dataTransfer.types.includes('Files')) overlay.classList.add('active'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', e => { e.preventDefault(); dragCounter--; if (dragCounter === 0) overlay.classList.remove('active'); });
window.addEventListener('drop', e => {
  e.preventDefault(); dragCounter = 0; overlay.classList.remove('active');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, 'auto');
});

/* ================= 載入 PDF ================= */

async function detectManualKind(pdf, fileName) {
  let sample = '';
  const fname = String(fileName || '');
  // 檔名先判（封面可能是圖、抽不到字）
  if (/kawasaki|ninja|zx-?\d|zx25|zx-25/i.test(fname)) sample += ' Kawasaki Ninja ZX25 ';
  if (/thai|ไทย|泰國|thailand/i.test(fname)) sample += ' สมุดภาพอะไหล่ ';
  // 僅在檔名已含川崎時，ind/indo 才加成印尼川崎
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
  let scoreHondaId = 0, scoreHondaJp = 0, scoreYamaha = 0, scoreYamahaLoose = 0, scoreKawasakiTh = 0, scoreKawasakiId = 0;
  const add = (score, re, w, cap) => { const m = sample.match(re); return score + (m ? w * Math.min(m.length, cap) : 0); };
  scoreHondaId = add(scoreHondaId, /Deskripsi/gi, 8, 6);
  scoreHondaId = add(scoreHondaId, /Jumlah/gi, 6, 6);
  scoreHondaId = add(scoreHondaId, /KELOMPOK/gi, 10, 6);
  scoreHondaId = add(scoreHondaId, /PETUNJUK/gi, 5, 4);
  scoreHondaId = add(scoreHondaId, /TIDAK\s*ADA\s*INFORMASI/gi, 6, 3);
  scoreHondaId = add(scoreHondaId, /No\.?\s*Ref/gi, 3, 4);
  if (/[\u3040-\u30ff]{8,}/.test(sample)) scoreHondaId = Math.max(0, scoreHondaId - 15);

  scoreHondaJp = add(scoreHondaJp, /部品番号/g, 10, 6);
  scoreHondaJp = add(scoreHondaJp, /使用個数/g, 8, 6);
  scoreHondaJp = add(scoreHondaJp, /見出番号/g, 8, 6);
  scoreHondaJp = add(scoreHondaJp, /部品名/g, 4, 6);
  scoreHondaJp = add(scoreHondaJp, /[\u30a0-\u30ff]{4,}/g, 2, 8);
  if (scoreHondaId >= 12) scoreHondaJp = 0;

  scoreYamaha = add(scoreYamaha, /FIG\.?\s*\d+/gi, 6, 10);
  scoreYamaha = add(scoreYamaha, /項次/g, 5, 6);
  scoreYamaha = add(scoreYamaha, /部品番號/g, 8, 6);
  scoreYamaha = add(scoreYamaha, /部品名稱/g, 5, 6);
  if (scoreHondaId >= 10) scoreYamaha = Math.max(0, scoreYamaha - 12);
  if (scoreHondaJp >= 10) scoreYamaha = Math.max(0, scoreYamaha - 8);

  // Yamaha 零散手冊（XMAX 等）
  scoreYamahaLoose = add(scoreYamahaLoose, /Fig\.\s*\d+\s+[A-Z]/gi, 8, 8);
  scoreYamahaLoose = add(scoreYamahaLoose, /Ref\.\s*No\./gi, 6, 4);
  scoreYamahaLoose = add(scoreYamahaLoose, /Product\s*Code:/gi, 4, 2);
  scoreYamahaLoose = add(scoreYamahaLoose, /Colour\s*Type:/gi, 4, 2);
  if (scoreYamahaLoose >= 10) scoreYamaha = Math.max(0, scoreYamaha - 6);

  // Kawasaki 品牌與版式（權重提高，避免誤判 Yamaha）
  const hasKawasakiBrand = /Kawasaki/i.test(sample);
  const hasPartsCatalog = /Parts\s*Catalog(ue)?/i.test(sample);
  const thChars = sample.match(/[\u0E00-\u0E7F]{2,}/g);
  if (hasKawasakiBrand) { scoreKawasakiTh += 20; scoreKawasakiId += 20; }
  if (hasPartsCatalog && hasKawasakiBrand) { scoreKawasakiTh += 6; scoreKawasakiId += 8; }
  if (thChars) scoreKawasakiTh += Math.min(thChars.length, 15) * 5;
  if (/สมุดภาพอะไหล่|หมายเลขอะไหล่|ชื่ออะไหล่/.test(sample)) scoreKawasakiTh += 16;
  if (/\(IN\)|Ninja\s*ZX|ZX-?25R|ZX\d+F[A-Z]{4}/i.test(sample) && hasKawasakiBrand) scoreKawasakiId += 10;
  if (/Kawasaki\s*Motors/i.test(sample)) scoreKawasakiId += 8;
  // 川崎常見：項次數字與零件號前段相同（例 11056 / 11056-0716）
  const refLike = (sample.match(/\b(\d{5})\s+\1\s*-/g) || []).length;
  if (hasKawasakiBrand && refLike) {
    scoreKawasakiTh += Math.min(refLike, 5) * 3;
    scoreKawasakiId += Math.min(refLike, 5) * 3;
  }
  if (thChars && thChars.length >= 2) scoreKawasakiId = 0;
  if (!hasKawasakiBrand) {
    scoreKawasakiTh = 0;
    scoreKawasakiId = 0;
  }
  // 有 Kawasaki 字樣且沒有 HONDA：壓制 Yamaha／Honda 誤分
  if (hasKawasakiBrand && !/\bHONDA\b/i.test(sample)) {
    scoreYamaha = Math.min(scoreYamaha, 4);
    scoreHondaId = Math.min(scoreHondaId, 4);
    scoreHondaJp = Math.min(scoreHondaJp, 4);
  }

  const ranked = [
    { kind: 'honda-id', mode: 'honda', locale: 'id', kLoc: 'en', score: scoreHondaId },
    { kind: 'honda-jp', mode: 'honda', locale: 'jp', kLoc: 'en', score: scoreHondaJp },
    { kind: 'yamaha', mode: 'yamaha', locale: 'en', kLoc: 'en', score: scoreYamaha },
    { kind: 'yamaha-loose', mode: 'yamaha-loose', locale: 'en', kLoc: 'en', score: scoreYamahaLoose },
    { kind: 'kawasaki-th', mode: 'kawasaki', locale: 'en', kLoc: 'th', score: scoreKawasakiTh },
    { kind: 'kawasaki-id', mode: 'kawasaki', locale: 'en', kLoc: 'id', score: scoreKawasakiId },
  ].sort((a, b) => b.score - a.score);
  // Honda 強特徵：不可被川崎強制蓋掉
  scoreHondaId = add(scoreHondaId, /\bHONDA\b/gi, 12, 4);
  scoreHondaId = add(scoreHondaId, /DAFTAR\s*ISI/gi, 12, 3);
  scoreHondaId = add(scoreHondaId, /PARTS\s*CATALOG/gi, 4, 3);
  scoreHondaId = add(scoreHondaId, /ADV\s*160|PCX|VARIO|BEAT/gi, 8, 4);
  scoreHondaId = add(scoreHondaId, /Honda\s*Motor/gi, 10, 3);
  scoreHondaId = add(scoreHondaId, /KELOMPOK\s*(MESIN|RANGKA)/gi, 10, 4);
  scoreHondaId = add(scoreHondaId, /INDEKS\s*(NOMOR|NAMA)\s*PART/gi, 8, 3);
  // 有 HONDA 無 Kawasaki → 壓川崎分
  if (/\bHONDA\b/i.test(sample) && !/Kawasaki/i.test(sample)) {
    scoreKawasakiTh = 0;
    scoreKawasakiId = 0;
  }
  // 重新排序（Honda 分數可能已變）
  const ranked2 = [
    { kind: 'honda-id', mode: 'honda', locale: 'id', kLoc: 'en', score: scoreHondaId },
    { kind: 'honda-jp', mode: 'honda', locale: 'jp', kLoc: 'en', score: scoreHondaJp },
    { kind: 'yamaha', mode: 'yamaha', locale: 'en', kLoc: 'en', score: scoreYamaha },
    { kind: 'yamaha-loose', mode: 'yamaha-loose', locale: 'en', kLoc: 'en', score: scoreYamahaLoose },
    { kind: 'kawasaki-th', mode: 'kawasaki', locale: 'en', kLoc: 'th', score: scoreKawasakiTh },
    { kind: 'kawasaki-id', mode: 'kawasaki', locale: 'en', kLoc: 'id', score: scoreKawasakiId },
  ].sort((a, b) => b.score - a.score);

  // 品牌硬規則：真正的川崎才強制（有 Kawasaki 字且沒有 HONDA 主導）
  const hasHondaBrand = /\bHONDA\b/i.test(sample) || /Honda\s*Motor/i.test(sample);
  const forceKawasaki = !hasHondaBrand && (
    /Kawasaki/i.test(sample)
    || /kawasaki|ninja|zx-?25|zx25/i.test(fname)
    || (/สมุดภาพอะไหล่|หมายเลขอะไหล่/.test(sample))
    || (thChars && thChars.length >= 5 && /Parts\s*Catalog/i.test(sample))
  );
  if (forceKawasaki) {
    const isTh = (thChars && thChars.length >= 2)
      || /thai|ไทย|泰國|thailand|สมุดภาพ/i.test(fname + sample);
    return {
      mode: 'kawasaki',
      hondaLocale: 'en',
      kawasakiLocale: isTh ? 'th' : 'id',
      kind: isTh ? 'kawasaki-th' : 'kawasaki-id',
      scores: ranked2,
      weak: false
    };
  }
  const best = ranked2[0];
  if (scoreHondaId >= 12 && scoreHondaId >= (best ? best.score : 0)) {
    return { mode: 'honda', hondaLocale: 'id', kawasakiLocale: 'en', kind: 'honda-id', scores: ranked2, weak: false };
  }
  if (!best || best.score < 6) {
    return { mode: 'yamaha', hondaLocale: 'en', kawasakiLocale: 'en', kind: 'yamaha', scores: ranked2, weak: true };
  }
  return {
    mode: best.mode,
    hondaLocale: best.mode === 'honda' ? best.locale : 'en',
    kawasakiLocale: best.mode === 'kawasaki' ? best.kLoc : 'en',
    kind: best.kind,
    scores: ranked2,
    weak: best.score < 10
  };
}

async function loadPdf(file, mode = 'yamaha') {
  const loadingEl = $('loading');
  loadingEl.classList.add('show');
  emptyState.style.display = 'none';

  // V20.81：重載必清狀態，避免崩潰後 isRenderingLocked 卡死白屏
  try {
    pageRenderTasks.forEach(task => { try { task.cancel(); } catch (e) {} });
  } catch (e) {}
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
    try { pdf = await pdfjsLib.getDocument({ data: buf, password: '' }).promise; }
    catch (e) {
      if (e.name === 'PasswordException') {
        const pwd = prompt('此 PDF 需要密碼，請輸入：');
        if (pwd === null) throw new Error('使用者取消輸入密碼。');
        pdf = await pdfjsLib.getDocument({ data: buf, password: pwd }).promise;
      } else throw e;
    }
    
    currentPdfDoc = pdf;
    hondaLocale = 'jp';
    kawasakiLocale = 'en';
    if (mode === 'auto' || mode === 'honda' || mode === 'yamaha' || mode === 'kawasaki') {
      try {
        loadingEl.innerHTML = '<div style="text-align:center;line-height:1.8">正在辨識手冊類型…</div>';
        const det = await detectManualKind(pdf, file && file.name);
        if (mode === 'auto') {
          mode = det.mode;
          currentMode = det.mode;
          hondaLocale = det.hondaLocale;
          kawasakiLocale = det.kawasakiLocale;
        } else if (mode === 'honda') {
          hondaLocale = det.mode === 'honda' ? det.hondaLocale : 'jp';
        } else if (mode === 'kawasaki') {
          kawasakiLocale = det.kawasakiLocale || 'id';
        } else {
          hondaLocale = 'en';
        }
        console.log('[EPC] detect', det);
      } catch (e) {
        console.warn(e);
        if (mode === 'auto') { mode = 'yamaha'; currentMode = 'yamaha'; }
      }
    }
    currentMode = mode;
    
    loadingEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
        <div>快速解析資料中，請稍候…</div>
        <div id="progressText" style="font-size:14px;color:#64748b;font-weight:normal;">0 / ${pdf.numPages}</div>
        <div style="width: 240px; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
          <div id="progressBar" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.1s;"></div>
        </div>
      </div>`;
      
    const localeLabel = mode === 'yamaha' ? 'Yamaha'
      : mode === 'kawasaki' ? (kawasakiLocale === 'th' ? 'Kawasaki 泰文' : 'Kawasaki 印尼')
      : (hondaLocale === 'id' ? 'Honda 印尼' : hondaLocale === 'jp' ? 'Honda 日本' : 'Honda');

    const total = pdf.numPages;
    for (let i = 1; i <= total; i++) {
      $('progressText').textContent = `正在打開手冊（${localeLabel}）… ${i} / ${total}`;
      $('progressBar').style.width = `${(i / total) * 100}%`;

      const page = await pdf.getPage(i);
      const vpPDF = getPageViewport(page, RENDER_SCALE);
      const pageIndex = i - 1;

      pagePartKeys.set(pageIndex, []);
      pageTitles.set(pageIndex, `第 ${pageIndex + 1} 頁`);

      // V20.111：開檔同步抽字一次 → 標題＋零件（川崎／Yamaha／Honda 皆適用）
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
        // 川崎：標題仍弱時再抽一次
        if (mode === 'kawasaki' && (!title || title === `第 ${pageIndex + 1} 頁`)) {
          try {
            const et2 = extractTitleKawasaki(tc.items || [], pageIndex, `第 ${pageIndex + 1} 頁`);
            if (et2 && et2 !== `第 ${pageIndex + 1} 頁`) title = et2;
          } catch (e) {}
        }
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
    currentSelectValue = "0";
    updateCustomSelectUI(0);
    renderPartList('page', 0, true);

    await renderPagesInRange(0);
    setTimeout(fitWidth, 100);
    // 全手冊背景確保標題：不擋開檔，掃完全部頁後刷新下拉
    setTimeout(() => {
      try { loadAllTitlesBackground(pdf, mode); } catch (e) {}
    }, 150);

    
  } catch (err) {
    console.error(err); alert('讀取 PDF 失敗：' + err.message);
    container.innerHTML = ''; emptyState.style.display = 'block';
  } finally { loadingEl.classList.remove('show'); }
}

/* ================= 僅提取頁標題（開檔背景用） ================= */

/* moved to brand module */



/* moved to brand module */


/** 依 hondaLocale 分流：jp 日文 / id 印尼 / 其他英文欄位 */
function extractPageTitleOnly(items, pageIndex, mode) {
  const fallback = `第 ${pageIndex + 1} 頁`;
  if (!items || !items.length) return fallback;
  if (mode === 'yamaha') return extractTitleYamaha(items, pageIndex, fallback);
  if (mode === 'kawasaki') return extractTitleKawasaki(items, pageIndex, fallback);
  const locale = (typeof hondaLocale !== 'undefined' && hondaLocale) ? hondaLocale : 'jp';
  if (locale === 'id' || locale === 'en') {
    return extractTitleIndonesianOrEn(items, pageIndex, fallback);
  }
  return extractTitleJapanese(items, pageIndex, fallback);
}


/* moved to brand module */


/* moved to brand module */




/* moved to brand module */

/** 若誤抓成長號，試著裁成合法川崎號 */

/* moved to brand module */



/** 依 text item 的 transform 計算在 viewport 上的軸對齊外框（處理旋轉字） */

/* moved to brand module */



/* moved to brand module */



/* moved to brand module */




/* moved to brand module */



/* moved to brand module */


function extractTitleIndonesianOrEn(items, pageIndex, fallback) {
  const rows = items.filter(it => it && String(it.str || '').trim() && it.transform).map(it => {
    const str = String(it.str).trim();
    const tr = it.transform;
    const h = Math.hypot(tr[2], tr[3]) || (it.height || 0) || 8;
    return { str, x: tr[4], y: tr[5], h };
  });
  if (!rows.length) return fallback;
  const joined = rows.map(r => r.str).join(' ');
  const codeCount = (joined.match(/\b[EF]-\d+/g) || []).length;

  const kel = joined.match(/\b(KELOMPOK\s+[A-Z]+)\b/i);
  if (kel && codeCount >= 2) return `${fallback}，${kel[1].toUpperCase()}`;
  if (codeCount >= 4) return kel ? `${fallback}，${kel[1].toUpperCase()}` : fallback;
  if (codeCount === 0) return fallback;

  let code = '';
  let codeRow = null;
  for (const r of rows) {
    const cm = r.str.match(/^([EF]-\d{1,3}(?:-\d{1,3})?)$/i);
    if (cm) { code = cm[1].toUpperCase(); codeRow = r; break; }
  }
  if (!code) {
    const cm = joined.match(/\b([EF]-\d{1,3}(?:-\d{1,3})?)\b/i);
    if (cm) code = cm[1].toUpperCase();
  }

  const scoreEn = (s, h, near) => {
    if (!s || s.length < 2 || s.length > 48) return -1;
    if (isIdTitleJunk(s)) return -1;
    if (/PEKERJAAN|Pemeriksaan|Penggantian|PELEPASAN|PEMASANGAN|TERMASUK|CATATAN|REM BELAKANG/i.test(s)) return -1;
    if (!/^[A-Z]/.test(s) && !/[A-Za-z]{3,}/.test(s)) return -1;
    const words = s.trim().split(/\s+/).filter(Boolean);
    let sc = s.length + words.length * 12;
    if (words.length >= 2) sc += 25;
    if (/\(/.test(s) && /ADV|CYLINDER|MASTER|BRAKE/i.test(s)) sc += 15;
    if (h >= 10) sc += 15;
    if (near) sc += 30;
    if (words.length === 1 && s.length <= 6) sc -= 20;
    return sc;
  };

  let best = { sc: -1, text: '' };
  for (const r of rows) {
    let s = r.str.replace(/\s+/g, ' ').trim();
    if (/^([EF]-\d)/i.test(s)) {
      const rest = s.replace(/^[EF]-\d{1,3}(?:-\d{1,3})?\s*/i, '').trim();
      if (rest.length >= 3) s = rest; else continue;
    }
    const near = codeRow && (
      Math.abs(r.y - codeRow.y) < 15 || Math.abs(r.x - codeRow.x) < 15 ||
      (Math.abs(r.y - codeRow.y) < 45 && Math.abs(r.x - codeRow.x) < 300)
    );
    if (/^[A-Z][A-Za-z0-9 .()/,\-]{1,45}$/.test(s) || /[A-Z]{2,}/.test(s)) {
      const sc = scoreEn(s, r.h, near);
      if (sc > best.sc) best = { sc, text: s };
    }
  }

  const rePair = /\b([EF]-\d{1,3}(?:-\d{1,3})?)\s+([A-Z][A-Za-z0-9 .()/,\-]{2,48})/g;
  let m;
  while ((m = rePair.exec(joined)) !== null) {
    let tp = m[2].replace(/\s+/g, ' ').trim();
    tp = tp.replace(/\s+(No\.?|Ref\.?|Deskripsi|Jumlah|F\.R\.T).*$/i, '').trim();
    if (isIdTitleJunk(tp) || /PEKERJAAN|Pemeriksaan|Penggantian|PELEPASAN/i.test(tp)) continue;
    const sc = scoreEn(tp, 12, true) + 20;
    if (sc > best.sc) {
      best = { sc, text: tp };
      if (!code) code = m[1].toUpperCase();
    }
  }

  if (best.text && isIdTitleJunk(best.text)) best = { sc: -1, text: '' };
  if (code && best.text && best.sc >= 0) return `${fallback}，${code} ${best.text}`;
  if (code) return `${fallback}，${code}`;
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
    let _tt = extractPageTitleOnly(tc.items, pageNum - 1, mode);
    if (mode === 'kawasaki' && isWeakTitle(_tt, pageNum)) {
      try {
        const et2 = extractTitleKawasaki(tc.items || [], pageNum - 1, `第 ${pageNum} 頁`);
        if (et2 && !isWeakTitle(et2, pageNum)) _tt = et2;
      } catch (e) {}
    }
    if (hondaLocale === 'jp' && (isJapaneseTitleJunk(_tt) || /関連見出|使用個数/.test(_tt))) {
      _tt = `第 ${pageNum} 頁`;
      const items2 = tc.items || [];
      const ja = items2.map(x => String(x.str || '').trim()).filter(s =>
        /[\u3040-\u30ff\u4e00-\u9fff]/.test(s) && s.length >= 3 && s.length <= 24 && !isJapaneseTitleJunk(s));
      if (ja.length) {
        ja.sort((a, b) => b.length - a.length);
        const cm = items2.map(x => String(x.str || '')).join(' ').match(/\b([EF]-\d{1,3}(?:-\d{1,3})?)\b/i);
        _tt = `第 ${pageNum} 頁，${cm ? cm[1].toUpperCase() + ' ' : ''}${ja[0]}`;
      }
    }
    if (hondaLocale === 'id' && (isIdTitleJunk(_tt) || /TIDAK\s*ADA|REM BELAKANG|PEKERJAAN|Pemeriksaan/i.test(_tt || ''))) {
      const joined = (tc.items || []).map(x => String(x.str || '')).join(' ');
      const cm = joined.match(/\b([EF]-\d{1,3}(?:-\d{1,3})?)\b/i);
      const kel = joined.match(/\b(KELOMPOK\s+[A-Z]+)\b/i);
      if (kel) _tt = `第 ${pageNum} 頁，${kel[1].toUpperCase()}`;
      else if (cm) _tt = `第 ${pageNum} 頁，${cm[1].toUpperCase()}`;
      else if (isWeakTitle(_tt, pageNum)) _tt = `第 ${pageNum} 頁`;
    }
    return _tt || `第 ${pageNum} 頁`;
  };

  // 第一遍：全部頁
  for (let i = 1; i <= total; i++) {
    if (token !== titleLoadToken || currentPdfDoc !== pdf) return;
    try {
      const prev = pageTitles.get(i - 1);
      // 已有好標題不降級
      if (prev && !isWeakTitle(prev, i)) {
        if (i % 5 === 0 || i === total) {
          try { rebuildAssemblyOptions(); updateCustomSelectUI(currentSelectValue); } catch (e) {}
        }
        continue;
      }
      const _tt = await tryExtract(i);
      if (!prev || isWeakTitle(prev, i) || (_tt && _tt.length > String(prev).length)) {
        pageTitles.set(i - 1, _tt);
      }
    } catch (e) {
      if (!pageTitles.has(i - 1)) pageTitles.set(i - 1, `第 ${i} 頁`);
    }
    if (i % 8 === 0) {
      try { if (pdf.cleanup) pdf.cleanup(); } catch (e) {}
    }
    if (i % 5 === 0 || i === total) {
      try { rebuildAssemblyOptions(); updateCustomSelectUI(currentSelectValue); } catch (e) {}
    }
    if (i % 3 === 0) await new Promise(r => setTimeout(r, _isMobileUA ? 30 : 4));
    else await new Promise(r => setTimeout(r, 0));
  }

  // 第二遍：只重試仍弱的頁（最多再掃一次）
  if (token !== titleLoadToken || currentPdfDoc !== pdf) return;
  const weakPages = [];
  for (let i = 1; i <= total; i++) {
    if (isWeakTitle(pageTitles.get(i - 1), i)) weakPages.push(i);
  }
  for (const i of weakPages) {
    if (token !== titleLoadToken || currentPdfDoc !== pdf) return;
    try {
      const _tt = await tryExtract(i);
      if (_tt && !isWeakTitle(_tt, i)) pageTitles.set(i - 1, _tt);
    } catch (e) {}
    await new Promise(r => setTimeout(r, _isMobileUA ? 20 : 0));
  }

  if (token === titleLoadToken) {
    try { rebuildAssemblyOptions(); updateCustomSelectUI(currentSelectValue); } catch (e) {}
  }
}

async function loadAllYamahaPartsBackground(pdf) {
  const token = ++titleLoadToken; // 共用取消：重載檔案時中止
  const total = pdf.numPages;
  for (let i = 1; i <= total; i++) {
    if (currentPdfDoc !== pdf) return;
    try {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const parsed = parsePageData(tc.items, i - 1, 'yamaha');
      if (parsed.keys && parsed.keys.length) {
        pagePartKeys.set(i - 1, parsed.keys);
        if (parsed.title && (!pageTitles.get(i - 1) || pageTitles.get(i - 1) === `第 ${i} 頁`)) {
          pageTitles.set(i - 1, parsed.title);
        }
      }
    } catch (e) {}
    if (i % 8 === 0) {
      try { if (pdf.cleanup) pdf.cleanup(); } catch (e) {}
      try {
        if (currentSelectValue === 'all') renderPartList('all', 0, false);
        rebuildAssemblyOptions();
      } catch (e) {}
    }
    if (i % 3 === 0) await new Promise(r => setTimeout(r, _isMobileUA ? 40 : 6));
  }
  try {
    rebuildAssemblyOptions();
    if (currentSelectValue === 'all') renderPartList('all', 0, false);
    else renderPartList('page', currentPageIndex, false);
  } catch (e) {}
}

function parsePageData(items, pageIndex, mode = 'yamaha') {
  if (!items || !items.length) return { keys: [], title: `第 ${pageIndex + 1} 頁` };

  // 本頁若出現印尼欄位標題，強制走印尼解析
  // 必須掃整頁：表頭常在頁面下方，只取前 80 個字元會誤判成非印尼頁
  const pageTextSample = items.map(it => it.str || '').join(' ');
  // 語系鎖定：印尼手冊→印尼解析；日文手冊→日文解析
  const pageIsHondaId = mode === 'honda' && hondaLocale === 'id';
  const pageIsHondaJp = mode === 'honda' && (hondaLocale === 'jp' || hondaLocale === 'th');
  
  const linesMap = {};
  items.forEach(item => {
    if (!item.str.trim()) return;
    const y = Math.round(item.transform[5]);
    const yTolerance = mode === 'yamaha' ? 12 : (mode === 'honda' ? (pageIsHondaId ? 6 : 4) : 8); 
    let k = Object.keys(linesMap).find(k => Math.abs(k - y) <= yTolerance);
    if (!k) { k = y; linesMap[k] = []; }
    linesMap[k].push(item);
  });
  
  let sortedLines = Object.keys(linesMap).map(y => ({ y: parseInt(y, 10), items: linesMap[y] })).sort((a, b) => b.y - a.y);

  let pageCategory = '';
  // 優先使用各手冊的 extractTitle
  if (mode === 'kawasaki' && typeof extractTitleKawasaki === 'function') {
    pageCategory = extractTitleKawasaki(items, 0, '') || '';
  } else if (mode === 'yamaha' && typeof extractTitleYamaha === 'function') {
    pageCategory = extractTitleYamaha(items, 0, '') || '';
  } else if (mode === 'honda') {
    const loc = (typeof hondaLocale !== 'undefined' && hondaLocale) ? hondaLocale : 'jp';
    if ((loc === 'id' || loc === 'en') && typeof extractTitleIndonesianOrEn === 'function') {
      pageCategory = extractTitleIndonesianOrEn(items, 0, '') || '';
    } else if (typeof extractTitleJapanese === 'function') {
      pageCategory = extractTitleJapanese(items, 0, '') || '';
    }
  }
  if (pageCategory && pageCategory.length >= 3 && !/^第\s*\d+\s*頁$/.test(pageCategory)) {
    // 已有品牌標題，跳過通用迴圈
  } else {
  
  for (let i = 0; i < sortedLines.length; i++) {
    const lineItems = sortedLines[i].items;
    const lineText = lineItems.map(x => x.str).join(' ').trim();
    
    const figMatch = lineText.match(/(FIG\.\s*\d+\s*[\u4e00-\u9fa5A-Za-z0-9\s]+)/i);
    if (figMatch && figMatch[1].length < 30) { pageCategory = figMatch[1].trim(); break; }

    // Honda 日文/印尼文目錄常見標題：E-10 / F-48 等 + 名稱（避免抓到索引頁的多個 F- 代碼）
    const hondaTitleMatch = lineText.match(/\b([EF]-\d+(?:-\d+)?)\s+([^\d\n]{2,50}?)(?:\s*$|\s{2,}|\d{4}\.\d{2}|使用|部品)/i);
    if (hondaTitleMatch) {
      let titlePart = hondaTitleMatch[2].replace(/\s+/g, ' ').trim();
      // 過濾掉明顯是索引或無意義的短字串、或包含太多代碼的
      if (titlePart.length >= 2 && titlePart.length < 40 &&
          !/部品|番号|No\.|Ref|Part|Deskripsi|Jumlah|グループ|GROUP/i.test(titlePart) &&
          !/^[EF]-\d+/.test(titlePart)) {
        pageCategory = (hondaTitleMatch[1] + ' ' + titlePart).trim();
        break;
      }
    }
    // 備用：純 E-xx / F-xx 標題行（後面有日文名稱）
    const hondaSimple = lineText.match(/^\s*([EF]-\d+(?:-\d+)?)\s+(.+)$/i);
    if (hondaSimple && hondaSimple[2].trim().length > 1 && hondaSimple[2].trim().length < 35 &&
        !/部品|番号|No\.|見出|希望|使用/i.test(hondaSimple[2])) {
      pageCategory = (hondaSimple[1] + ' ' + hondaSimple[2].trim()).trim();
      break;
    }

    if (/This page covers/i.test(lineText)) {
       const m = lineText.match(/This page covers:?\s*(.+)/i);
       if (m && m[1].trim().length > 0) {
         let t0 = m[1].replace(/\s*Ref\.?\s*No.*$/i, '').replace(/\s*Part\s*No.*$/i, '').trim();
         if (t0.length > 0 && t0.length < 55) {
           // 向前找 GROUP NO
           let g = '';
           for (let k = Math.max(0, i - 3); k <= i; k++) {
             const lt = (sortedLines[k] && sortedLines[k].items || []).map(x => x.str).join(' ');
             const gm = lt.match(/GROUP\s*NO\.?\s*(\d{1,3})/i);
             if (gm) g = gm[1];
           }
           pageCategory = g ? (`Group ${g} ${t0}`) : t0;
           break;
         }
       }
       let nextLine = sortedLines[i+1];
       if (nextLine) {
           let rawTitle = nextLine.items.map(x => x.str).join(' ').replace(/\s+/g, ' ').trim();
           if (rawTitle.length > 0 && rawTitle.length < 55 && !/Ref\.?\s*No|Part\s*No/i.test(rawTitle)) {
             pageCategory = rawTitle; break;
           }
       }
    }
    // 31. Suspension/Shock Absorber
    if (!pageCategory) {
      const hm = lineText.match(/^\s*(\d{1,3})\.\s*([A-Z][A-Za-z0-9\/\-,\s]{2,48})/);
      if (hm && !/Part\s*No|Description|Ref\.?\s*No/i.test(hm[0])) {
        pageCategory = (hm[1] + '. ' + hm[2].replace(/\s+/g, ' ').trim()).slice(0, 50);
        break;
      }
    }
  }
  } // end else (no brand title)

  // V20.71：旋轉印尼頁標題 — F-10 / STEERING STEM 常為不同文字塊
  if (!pageCategory && mode === 'honda') {
    const allStr = (items || []).map(it => String(it.str || '').trim()).filter(Boolean);
    const joined = allStr.join(' ');
    // 1) 同一字串已有 E-12 TITLE
    let m = joined.match(/\b([EF]-\d{1,3}(?:-\d{1,3})?)\s+([A-Z][A-Z0-9 ,./&\-]{2,40})/);
    if (m && !/REF|PART|DESKRIPSI|JUMLAH|NOMOR/i.test(m[2])) {
      pageCategory = (m[1] + ' ' + m[2].replace(/\s+/g, ' ').trim()).trim();
    }
    // 2) 代碼與標題分離（旋轉後常見）
    if (!pageCategory) {
      let code = '';
      let title = '';
      for (const s of allStr) {
        const cm = s.match(/^([EF]-\d{1,3}(?:-\d{1,3})?)$/i);
        if (cm) { code = cm[1].toUpperCase(); continue; }
        // 全大寫英文標題（如 STEERING STEM），排除品名（含逗號）與表頭
        if (/^[A-Z][A-Z0-9 /&\-]{2,40}$/.test(s) &&
            !/,/.test(s) &&
            !/^(NO\.?|REF\.?|PART|DESKRIPSI|JUMLAH|SERI|KODE|ADV\d|CBS|ABS|FR\.?|HONDA|TYPE\d*)$/i.test(s) &&
            !/^\d/.test(s) && s.split(/\s+/).length <= 5) {
          if (!title || s.length > title.length) title = s;
        }
      }
      if (code && title) pageCategory = code + ' ' + title;
      else if (code) pageCategory = code;
      else if (title) pageCategory = title;
    }
    // 3) 從「F-10STEERING」黏字拆開
    if (!pageCategory) {
      const sticky = joined.match(/\b([EF]-\d{1,3})([A-Z][A-Z ]{3,40})/);
      if (sticky) pageCategory = sticky[1] + ' ' + sticky[2].replace(/\s+/g, ' ').trim();
    }
  }

  let lastItemNo = '', lastPartName = '';
  const pageKeys = [];
  const hondaCandidates = []; // V20.7: 收集後再依位置排序，確保順序與項次正確

  // V20.113：川崎整頁列解析（泰文／印尼表）
  if (mode === 'kawasaki') {
    // 依語系呼叫對應解析
    const parser = (typeof kawasakiLocale !== 'undefined' && kawasakiLocale === 'th' && window.EPC_BRAND && window.EPC_BRAND['kawasaki-th'] && window.EPC_BRAND['kawasaki-th'].parseItems)
      ? window.EPC_BRAND['kawasaki-th'].parseItems
      : parseKawasakiItems;
    const ks = parser(items, pageCategory);
    ks.forEach(k => { if (!pageKeys.includes(k)) pageKeys.push(k); });
  }

  // V20.70：Rotate=90 時表格以「欄(同X)」為一列零件（PDF.js 實測）
  if (mode === 'honda') {
    const allItems = (items || []).filter(it => it && String(it.str || '').trim() && it.transform);
    const rePart = new RegExp(HONDA_PART_REGEX.source, 'gi');

    // 找出所有零件號 item 的座標，判斷列向 or 欄向
    const partHits = [];
    for (const it of allItems) {
      const raw = String(it.str).replace(/[－–—]/g, '-').replace(/\s+/g, '');
      rePart.lastIndex = 0;
      const m = rePart.exec(raw);
      if (!m) continue;
      const pno = normalizePartNo(m[0]);
      if (!isValidHondaPartNo(pno)) continue;
      partHits.push({
        partNo: pno,
        x: it.transform[4],
        y: it.transform[5],
        str: String(it.str)
      });
    }

    if (partHits.length) {
      const xs = partHits.map(p => p.x);
      const ys = partHits.map(p => p.y);
      const xRange = Math.max(...xs) - Math.min(...xs);
      const yRange = Math.max(...ys) - Math.min(...ys);
      // 零件號幾乎同一 Y、X 分散 → 旋轉後「欄=一項」
      const columnLayout = partHits.length >= 2 && xRange > yRange * 1.5;

      if (pageIsHondaId) {
        // 依 X 分欄（每欄 = 表格的一列項次）
        const snap = 4;
        const cols = new Map();
        for (const it of allItems) {
          const key = Math.round(it.transform[4] / snap) * snap;
          if (!cols.has(key)) cols.set(key, []);
          cols.get(key).push(it);
        }

        const seen = new Set();
        const colKeys = [...cols.keys()].sort((a, b) => a - b);
        for (const ck of colKeys) {
          const col = cols.get(ck).slice().sort((a, b) => a.transform[5] - b.transform[5]);
          let itemNo = '';
          let partNo = '';
          let name = '';
          const qtys = [];
          let foundPart = false;

          for (const it of col) {
            const s = String(it.str).replace(/[－–—]/g, '-').trim();
            if (!s) continue;

            // 項次：零件號出現前的純數字
            if (!foundPart && /^\d{1,2}$/.test(s)) {
              const n = parseInt(s, 10);
              if (n >= 1 && n <= 99) itemNo = String(n);
              continue;
            }

            rePart.lastIndex = 0;
            const pm = rePart.exec(s.replace(/\s+/g, ''));
            if (pm && !partNo) {
              const pno = normalizePartNo(pm[0]);
              if (pno && isValidHondaPartNo(pno)) {
                partNo = pno;
                foundPart = true;
                // 同一字串內可能帶品名
                let rest = s.replace(new RegExp(HONDA_PART_REGEX.source, 'i'), '').trim();
                rest = rest.replace(/[.]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
                if (rest.length >= 3) name = rest;
                continue;
              }
            }

            if (foundPart) {
              if (/^\d{1,2}$/.test(s)) {
                const n = parseInt(s, 10);
                if (n >= 1 && n <= 99) qtys.push(n);
                continue;
              }
              if (/^[-–—]+$/.test(s)) continue;
              // 品名片段
              if (!/^\d{5}/.test(s)) {
                const frag = s.replace(/[.]{2,}/g, ' ').trim();
                if (frag) name = name ? (name + ' ' + frag) : frag;
              }
            }
          }

          if (!partNo || !isValidHondaPartNo(partNo) || seen.has(partNo)) continue;
          seen.add(partNo);
          name = (name || '').replace(/\s+/g, ' ').trim();
          // 品名裡若全是零件號碎片則清空
          name = name.replace(new RegExp(HONDA_PART_REGEX.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
          if (!name || /^[\d\-A-Z\s]{0,4}$/i.test(name)) name = '（同項替代）';
          const qty = qtys.length ? qtys[0] : 1;
          const y0 = col[0] ? col[0].transform[5] : 0;
          hondaCandidates.push({
            key: partNo,
            name,
            qty,
            itemNo: itemNo || '',
            category: pageCategory || '未分類',
            y: y0,
            x: ck
          });
        }

        // 繼承：無項次的欄（替代零件）用上一項次；無品名用上一品名
        let lastI = '', lastN = '';
        for (const c of hondaCandidates) {
          if (c.itemNo) lastI = c.itemNo;
          else if (lastI) c.itemNo = lastI;
          if (c.name && c.name !== '（同項替代）') lastN = c.name;
          else if (lastN && c.name === '（同項替代）') c.name = lastN;
        }
      } else {
        // 非欄向：沿用 Y 分行（日文橫表）
        const sorted = allItems.slice().sort((a, b) => {
          const ay = a.transform[5], by = b.transform[5];
          if (Math.abs(ay - by) > 3) return by - ay;
          return a.transform[4] - b.transform[4];
        });
        let pageStr = '', lastY = null;
        for (const it of sorted) {
          const y = it.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 3) pageStr += '\n';
          else if (pageStr && !/\s$/.test(pageStr)) pageStr += ' ';
          pageStr += String(it.str).replace(/[－–—]/g, '-');
          lastY = y;
        }
        let locLastItem = '', locLastName = '';
        const seen = new Set();
        for (const text of pageStr.split('\n')) {
          let line = text.replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
          if (!/\d{5}-[A-Z0-9]/i.test(line)) continue;
          const re = new RegExp(HONDA_PART_REGEX.source, 'gi');
          let m;
          while ((m = re.exec(line)) !== null) {
            const pno = normalizePartNo(m[0].replace(/\s+/g, ''));
            if (!pno || seen.has(pno)) continue;
            seen.add(pno);
            const before = line.slice(0, m.index);
            let itemNo = '';
            const mi = before.match(/(?:^|\s)(\d{1,3})\)?\s*$/);
            if (mi) { const n = parseInt(mi[1], 10); if (n >= 1 && n <= 99) itemNo = String(n); }
            if (!itemNo) itemNo = locLastItem;
            else locLastItem = itemNo;
            let after = line.slice(m.index + m[0].length);
            let qty = 1;
            const qm = after.match(/(\d{1,2})(?:\s+(\d{1,2}))?\s*$/);
            if (qm) { qty = parseInt(qm[1], 10) || 1; after = after.slice(0, qm.index); }
            let name = after.replace(/[.]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
            if (!name || name.length < 2) name = locLastName || '（同項替代）';
            else locLastName = name;
            hondaCandidates.push({
              key: pno, name, qty, itemNo, category: pageCategory || '未分類', y: 0, x: 0
            });
          }
        }
      }
    }
  }

  sortedLines.forEach(line => {
    line.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let rawLineText = line.items.map(i => i.str).join(' ').trim();
    // 表頭列略過；但同一行若已有零件號則仍解析
    if (/Page covers|GROUP NO|This catalog|Engine-|Kawasaki|หมายเลขอะไหล่|ชื่ออะไหล่|Description|部品|名稱|名称|項次|DR\d+|備註|番號|Kode Parts|Nama part/i.test(rawLineText)) {
      if (!/\d{5}\s*[-－–—]/.test(rawLineText)) return;
    }
    if (/^(No\.?\s*Ref|No\.?\s*Part|Deskripsi|Jumlah)\b/i.test(rawLineText) && !/\d{5}\s*[-－–—]/.test(rawLineText)) return;

    if (mode === 'yamaha') {
      let fullStr = '', charToX = [];
      for (let i = 0; i < line.items.length; i++) {
        const item = line.items[i];
        if (i > 0) {
          const prevRight = line.items[i-1].transform[4] + (line.items[i-1].width || (line.items[i-1].str.length * 5));
          if (item.transform[4] - prevRight > 5) { fullStr += ' '; charToX.push(item.transform[4]); }
        }
        fullStr += item.str;
        const w = item.width || (item.str.length * 5);
        for (let c = 0; c < item.str.length; c++) charToX.push(item.transform[4] + (c * (w / item.str.length)));
      }
      
      let cleanStr = fullStr.replace(/[－–—]/g, '-');
      const regex = new RegExp(YAMAHA_PART_REGEX.source, 'gi');
      let match, matches = [];
      while ((match = regex.exec(cleanStr)) !== null) {
        const pno = normalizePartNo(match[0]);
        if (!isValidYamahaPartNo(pno)) continue;
        matches.push({ partNo: pno, start: match.index, end: match.index + match[0].length });
      }
      // 去掉被更完整號覆蓋的殘段
      matches = matches.filter((p, i, arr) =>
        !arr.some((o, j) => j !== i && o.partNo !== p.partNo && o.partNo.endsWith(p.partNo))
      );
      
      if (matches.length > 0) {
        for (let pIdx = 0; pIdx < matches.length; pIdx++) {
          const part = matches[pIdx];
          const partX = charToX[part.start] !== undefined ? charToX[part.start] : 0;
          
          let detectedItemNo = '';
          for (let i = 0; i < line.items.length; i++) {
            const item = line.items[i];
            if (item.transform[4] >= partX - 5) break; 
            const str = item.str.trim();
            if (/^\d{1,3}$/.test(str)) detectedItemNo = str;
          }
          if (detectedItemNo) lastItemNo = detectedItemNo;
          else detectedItemNo = lastItemNo;

          let nextPartX = Infinity;
          if (pIdx + 1 < matches.length) nextPartX = charToX[matches[pIdx+1].start];
          
          let regionItems = [];
          for (let i = 0; i < line.items.length; i++) {
            const item = line.items[i];
            if (item.transform[4] > partX - 5 && item.transform[4] < nextPartX - 5) {
              const str = item.str.trim();
              if (!/用於|黑|白|灰|紅|山葉黑/.test(str) && !/^[\(\)\[\]\{\}\s\-\.]+$/.test(str)) regionItems.push(item);
            }
          }
          
          let qty = 1, qtyItemIdx = -1;
          for (let i = regionItems.length - 1; i >= 0; i--) {
            if (/^\d{1,3}$/.test(regionItems[i].str.trim())) { qty = parseInt(regionItems[i].str.trim(), 10); qtyItemIdx = i; break; }
          }
          if (qtyItemIdx === -1 && regionItems.length > 0) {
            const lastItem = regionItems[regionItems.length - 1];
            const trailingNum = lastItem.str.match(/(\d+)\s*$/);
            if (trailingNum) { qty = parseInt(trailingNum[1], 10); lastItem.str = lastItem.str.replace(/(\d+)\s*$/, '').trim(); }
          }
          
          // 使用品牌專用的名稱提取函數
          let lastPartName = '';
          if (window.EPC_BRAND && window.EPC_BRAND['yamaha'] && window.EPC_BRAND['yamaha'].extractName) {
            lastPartName = window.EPC_BRAND['yamaha'].extractName(regionItems, part.partNo, partX, nextPartX);
          } else {
            // 備用：簡單提取
            let nameItems = [];
            for (let i = 0; i < regionItems.length; i++) {
              if (i === qtyItemIdx) continue;
              const str = regionItems[i].str.trim();
              if (str.length > 0 && !str.includes(part.partNo)) nameItems.push(str);
            }
            lastPartName = nameItems.join(' ').replace(/\s+/g, ' ').trim();
          }
          lastPartName = translateText(lastPartName);
          
          if (!isValidYamahaPartNo(part.partNo)) continue;
          if (!partInfoMap.has(part.partNo)) partInfoMap.set(part.partNo, { name: lastPartName || '（無名稱）', rawName: lastPartName, qty: qty || 1, category: pageCategory || '未分類', itemNo: detectedItemNo });
          else if (lastPartName && (!partInfoMap.get(part.partNo).name || partInfoMap.get(part.partNo).name === '（無名稱）')) {
            partInfoMap.get(part.partNo).name = lastPartName;
            partInfoMap.get(part.partNo).rawName = lastPartName;
          }
          
          pageKeys.push({ key: part.partNo, name: lastPartName || '（無名稱）', qty: qty || 1, category: pageCategory || '未分類', itemNo: detectedItemNo });
        }
      }
      return; 
    }

    // ===== Honda / Kawasaki 解析 =====
    let cleanLineText = rawLineText.replace(/[－–—]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');

    if (mode === 'kawasaki') return;

        // ===== Honda 專用（不套用 Yamaha 邏輯）=====
    if (mode !== 'honda') return;

    // V20.61 C：印尼 Honda — No.Ref / No.Part / Deskripsi / Jumlah
    if (pageIsHondaId) return; // V20.63 整頁掃描已處理


    {
      const lineY = line.y || (line.items[0] ? Math.round(line.items[0].transform[5]) : 0);
      let fullStr = '', charToX = [];
      for (let i = 0; i < line.items.length; i++) {
        const item = line.items[i];
        if (i > 0) {
          const prev = line.items[i-1];
          const prevRight = prev.transform[4] + (prev.width || (prev.str.length * 5));
          const gap = item.transform[4] - prevRight;
          if (gap > 1.5 || /^\d/.test(item.str) || (/[A-Z0-9]$/.test(prev.str) && !/^[A-Z0-9]/.test(item.str))) {
            fullStr += ' ';
            charToX.push(item.transform[4]);
          }
        }
        fullStr += item.str;
        const w = item.width || (item.str.length * 5);
        for (let c = 0; c < item.str.length; c++) charToX.push(item.transform[4] + (c * (w / Math.max(1, item.str.length))));
      }

      let cleanStr = fullStr.replace(/[－–—]/g, '-').replace(/\s*-\s*/g, '-');
      const regex = new RegExp(HONDA_PART_REGEX.source, 'gi');
      let match, matches = [];
      while ((match = regex.exec(cleanStr)) !== null) {
        matches.push({
          partNo: normalizePartNo(match[0]),
          start: match.index,
          end: match.index + match[0].length,
          raw: match[0]
        });
      }
      if (matches.length === 0) return;

      for (let pIdx = 0; pIdx < matches.length; pIdx++) {
        const part = matches[pIdx];
        const partX = (charToX[part.start] !== undefined) ? charToX[part.start] : 0;

        // V20.52 項次：Honda 表「見出番号」緊貼零件號左側，不可要求過大間距
        let detectedItemNo = '';
        const partY = lineY;
        // 1) 同一行字串中，零件號左側最近的 1–2 位數字
        const before = cleanStr.slice(0, part.start);
        const mItem = before.match(/(\d{1,2})\s*[-－–—\s]*$/);
        if (mItem) {
          const n = parseInt(mItem[1], 10);
          if (n >= 1 && n <= 99) detectedItemNo = String(n);
        }
        // 2) 座標：左側、同一列、最靠近零件號的純數字
        if (!detectedItemNo) {
          let bestItemDist = Infinity;
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const str = (it.str || '').trim();
            if (!/^\d{1,2}$/.test(str)) continue;
            const n = parseInt(str, 10);
            if (n < 1 || n > 99) continue;
            const itX = it.transform[4];
            const itY = Math.round(it.transform[5]);
            if (itX >= partX - 1) continue; // 必須在零件號左側
            if (partX - itX > 80) continue; // 不要遠到圖上的標註數字
            const yDist = Math.abs(itY - partY);
            if (yDist > 10) continue;
            const dist = yDist * 2000 + (partX - itX);
            if (dist < bestItemDist) {
              bestItemDist = dist;
              detectedItemNo = str;
            }
          }
        }

        // 向右收集同一列（Y 更嚴，避免 8+9 項品名黏在一起）
        let rightItems = [];
        for (const it of items) {
          const str = (it.str || '').trim();
          if (!str) continue;
          const itX = it.transform[4];
          const itY = Math.round(it.transform[5]);
          if (itX <= partX + 5) continue;
          if (Math.abs(itY - partY) > 3) continue;
          rightItems.push({ str, x: itX });
        }
        rightItems.sort((a, b) => a.x - b.x);

        // V20.51 數量：右側多欄數字，取「從最右邊數起的第一個」
        let qty = 1;
        let qtyZoneX = Infinity;
        for (let i = rightItems.length - 1; i >= 0; i--) {
          const s = rightItems[i].str;
          if (!/^\d{1,2}$/.test(s)) continue;
          const n = parseInt(s, 10);
          if (n < 1 || n > 99) continue;
          qty = n;
          qtyZoneX = rightItems[i].x;
          for (let j = i; j >= 0; j--) {
            if (/^\d{1,2}$/.test(rightItems[j].str)) {
              const nn = parseInt(rightItems[j].str, 10);
              if (nn >= 1 && nn <= 99) qtyZoneX = rightItems[j].x;
              else break;
            } else if (/^[･・\.…\-\s]+$/.test(rightItems[j].str)) {
              continue;
            } else {
              break;
            }
          }
          break;
        }

        // V20.54 品名：只取「本零件 → 下一個零件」之間（或到數量欄），绝不跨項
        let nameFromLine = '';
        {
          const endLimit = (pIdx + 1 < matches.length) ? matches[pIdx + 1].start : cleanStr.length;
          let after = cleanStr.slice(part.end, endLimit);
          after = after.replace(/(?:\s+\d{1,2}){1,10}\s*$/g, '');
          after = after.replace(/[･・…\.]{2,}/g, ' ');
          after = after.replace(/^\s*\d{1,2}\s+/, '');
          after = after.replace(HONDA_PART_REGEX, '');
          after = after.replace(/\s+/g, ' ').trim();
          nameFromLine = after;
        }
        // 座標備援：僅 |dy|<=3 且在本零件與下一零件 X 之間
        let nextPartX = Infinity;
        if (pIdx + 1 < matches.length) {
          const ns = matches[pIdx + 1].start;
          nextPartX = (charToX[ns] !== undefined) ? charToX[ns] : Infinity;
        }
        let nameItems = [];
        for (const ri of rightItems) {
          if (ri.x >= qtyZoneX - 2) continue;
          if (ri.x >= nextPartX - 2) continue;
          const s = ri.str;
          if (!s) continue;
          if (/^\d{1,2}$/.test(s)) continue;
          if (/^\d+$/.test(s)) continue;
          const norm = normalizeText(s);
          if (norm.includes(part.partNo) || part.partNo.includes(norm)) continue;
          if (HONDA_PART_REGEX.test(s.replace(/\s/g, ''))) continue;
          if (/^[\(\)\[\]\{\}\s\-\.･・…]+$/.test(s)) continue;
          if (/^\d{1,3}(,\d{3})*$/.test(s)) continue;
          nameItems.push(s);
        }
        // 優先用字串切片；若明顯像被截斷成空，再用座標
        let rawName = nameFromLine;
        if (!rawName || rawName.length < 2) rawName = nameItems.join(' ');
        rawName = rawName.replace(/^\d{1,2}\s+/, '').replace(/\s+/g, ' ').trim();
        let thisPartName = translateText(
          rawName.replace(/[･・…\.]{2,}/g, '').trim()
        ).replace(/^[\s\.\-･・…]+/, '').trim();

        thisPartName = thisPartName
          .replace(/価格|価\s*格|希望|小売|使用|個数|適用|号機|初号機|終号機|タイプ|TYPE|WW|150A?|\bJ\b|\bL\b|見出|番号|部品名|部品番号/gi, '')
          .replace(/\d{1,3},\d{3}/g, ' ')
          .replace(/\b\d{1,3}\s*[-–—]{1,2}\s*\d{0,3}\b/g, ' ')
          .replace(/(?:\s*[-–—]\s*)+$/g, '')
          .replace(/\s+\d{1,4}(?:\s+\d{1,4}){1,6}\s*$/g, '')
          .replace(/\s+\d{2,4}\s*$/g, '')
          .replace(/[\.･・…]{2,}/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();

        let finalName = thisPartName || '';
        // 去掉點線、誤併入的數量／適用／頁碼數字與符號
        finalName = finalName
          .replace(/[\.･・…]{2,}/g, ' ')
          .replace(/\d{1,3},\d{3}/g, ' ')
          .replace(/\b\d{1,3}\s*[-–—]{1,2}\s*\d{0,3}\b/g, ' ')
          .replace(/\s+\d{2,4}\s*$/g, '')
          .replace(/\s+\d{1,3}(?:\s+\d{1,3}){1,6}\s*$/g, '')
          .replace(/(?:\s*[-–—]\s*)+$/g, '')
          .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const nameIsEmpty = !finalName
          || finalName.length < 2
          || /^[\.･・…\s\-–—_*]+$/.test(finalName)
          || /^[\d\s,\.\-–—]+$/.test(finalName)
          || /^（無名稱）$/.test(finalName);
        if (nameIsEmpty) {
          finalName = lastPartName || '（同項替代）';
        } else {
          lastPartName = finalName;
        }
        let finalItemNo = detectedItemNo || '';
        if (finalItemNo && parseInt(finalItemNo, 10) > 80) finalItemNo = '';
        // V20.56：一項多次零件 — 無項次則繼承上一項次
        if (!finalItemNo && lastItemNo) finalItemNo = lastItemNo;
        if (finalItemNo) lastItemNo = finalItemNo;

        hondaCandidates.push({
          key: part.partNo,
          name: finalName || '（無名稱）',
          qty: qty || 1,
          itemNo: finalItemNo,
          category: pageCategory || '未分類',
          y: lineY,
          x: partX
        });
      }
    }
  });

  // V20.10：嚴格依零件號的 Y 座標由上而下（PDF y 越大越上面），再依 X 由左到右
  if (hondaCandidates.length > 0) {
    hondaCandidates.sort((a, b) => {
      const ia = parseInt(a.itemNo, 10), ib = parseInt(b.itemNo, 10);
      const ha = !isNaN(ia), hb = !isNaN(ib);
      if (ha && hb && ia !== ib) return ia - ib; // 依項次
      if (ha && !hb) return -1;
      if (!ha && hb) return 1;
      if (Math.abs(a.y - b.y) > 8) return b.y - a.y;
      return a.x - b.x;
    });
    // 排序後再補一次項次繼承（避免分行順序造成漏補）
    let _hi = '';
    for (const c of hondaCandidates) {
      if (c.itemNo) _hi = c.itemNo;
      else if (_hi) c.itemNo = _hi;
    }
    for (const c of hondaCandidates) {
      if (!partInfoMap.has(c.key)) {
        partInfoMap.set(c.key, {
          name: c.name,
          rawName: c.name,
          qty: c.qty,
          category: c.category,
          itemNo: c.itemNo
        });
      } else {
        const existing = partInfoMap.get(c.key);
        if ((!existing.itemNo || existing.itemNo === '') && c.itemNo) existing.itemNo = c.itemNo;
        if ((existing.name === '（無名稱）' || !existing.name) && c.name && c.name !== '（無名稱）') {
          existing.name = c.name;
          existing.rawName = c.name;
        }
      }
      if (!pageKeys.includes(c.key)) pageKeys.push(c.key);
    }
  }
  
  // V20.65 保底：Honda 候選有資料但 pageKeys 仍空時強制灌入
  if (mode === 'honda' && hondaCandidates.length && !pageKeys.length) {
    for (const c of hondaCandidates) {
      if (!partInfoMap.has(c.key)) {
        partInfoMap.set(c.key, { name: c.name, rawName: c.name, qty: c.qty, category: c.category, itemNo: c.itemNo });
      }
      if (!pageKeys.includes(c.key)) pageKeys.push(c.key);
    }
  }

  // 過濾日文表頭誤當標題
  if (mode !== 'yamaha') {
    if (pageCategory && isJapaneseTitleJunk(pageCategory)) pageCategory = '';
    if (pageCategory && /\(\s*関連|\(\s*見出|関連見出/.test(pageCategory)) pageCategory = '';
  }

  // 標題：背景預載優先；若是 junk 或只有圖號則用本頁 extract 覆蓋
  let finalTitle = pageTitles.get(pageIndex) || `第 ${pageIndex + 1} 頁`;
  const titleIsWeak = !finalTitle || finalTitle === `第 ${pageIndex + 1} 頁` ||
    isJapaneseTitleJunk(finalTitle) || /関連見出|使用個数/.test(finalTitle) ||
    /^第 \d+ 頁，[EF]-\d+(?:-\d+)?$/.test(finalTitle) ||
    /^第 \d+ 頁，[:：\s]*$/.test(finalTitle) ||
    (finalTitle.length < 12 && /第 \d+ 頁/.test(finalTitle));
  if (titleIsWeak) {
    const extracted = extractPageTitleOnly(items, pageIndex, mode);
    if (extracted && !isJapaneseTitleJunk(extracted) && extracted !== `第 ${pageIndex + 1} 頁`) {
      finalTitle = extracted;
    } else if (pageCategory && !isJapaneseTitleJunk(pageCategory)) {
      finalTitle = `第 ${pageIndex + 1} 頁，${translateText(pageCategory)}`;
    }
  }

  // V20.43：部品番號索引「零件號 + FIG-項次」例如 90269-06802  29-8 → FIG.29 第8項
  try {
    const joined = (items || []).map(it => String(it.str || '')).join('  ');
    const indexRe = /([A-Z0-9]{2,}(?:-[A-Z0-9]{2,}){1,4})\s+(\d{1,3})\s*[-–—]\s*(\d{1,3})/gi;
    let im;
    while ((im = indexRe.exec(joined)) !== null) {
      const pno = (typeof normalizePartNo === 'function') ? normalizePartNo(im[1]) : im[1].toUpperCase();
      const fig = parseInt(im[2], 10);
      const item = parseInt(im[3], 10);
      if (!pno || isNaN(fig) || isNaN(item)) continue;
      if (!partFigLocations.has(pno)) {
        partFigLocations.set(pno, { fig, item, indexPage: pageIndex });
      }
    }
  } catch (err) { /* ignore index parse errors */ }

  return { keys: pageKeys, title: finalTitle };
}


/* ================= 圖面熱點與直接加入 ================= */
function bindPartEvent(el, key) {
  if (currentMode === 'kawasaki') key = sanitizeKawasakiKey(key);
  let info = partInfoMap.get(key);
  if (!info) {
    // 建一筆後備，避免點擊無反應
    info = { name: '（無名稱）', qty: 1, category: '未分類', itemNo: '' };
    partInfoMap.set(key, info);
  }
  el.title = `點擊加入：${key}\n品名：${info.name}\n數量：${info.qty}`;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    addToPickList(key, currentPageIndex); 
    el.style.setProperty('background', 'rgba(76, 175, 80, 0.9)', 'important');
    el.style.setProperty('box-shadow', '0 0 0 3px rgba(76, 175, 80, 0.45)', 'important');
    setTimeout(() => {
      el.style.removeProperty('background');
      el.style.removeProperty('box-shadow');
    }, 300);
  });
}

// V20.23：用 PDF textContent 的真實座標畫高亮，縮放時與圖面比例一致

function getBrandHighlightOptions(mode) {
  const B = (typeof window !== "undefined" && window.EPC_BRAND) ? window.EPC_BRAND : {};
  let key = mode;
  try {
    if (mode === "kawasaki") {
      key = (typeof kawasakiLocale !== "undefined" && kawasakiLocale === "th") ? "kawasaki-th" : "kawasaki-id";
    } else if (mode === "honda") {
      key = (typeof hondaLocale !== "undefined" && hondaLocale === "id") ? "honda-id" : "honda-jp";
    }
  } catch (e) {}
  const b = B[key] || B[mode] || {};
  return {
    brandKey: key,
    offsetX: (typeof b.highlightOffsetX === "number") ? b.highlightOffsetX : 0,
    expandLeft: (typeof b.highlightExpandLeft === "number") ? b.highlightExpandLeft : 0,
    custom: (typeof b.highlight === "function") ? b.highlight : null
  };
}

function highlightPartNumbersFromContent(pageDiv, textContent, viewport, mode = 'yamaha') {
  if (!textContent || !textContent.items || !textContent.items.length) return;
  // 品牌檔可提供專用高亮；app.js 只負責畫布與事件綁定
  const hlOpts = getBrandHighlightOptions(mode);
  if (hlOpts.custom) {
    try {
      const handled = hlOpts.custom(pageDiv, textContent, viewport, {
        partInfoMap, pagePartKeys, bindPartEvent, normalizePartNo, pdfjsLib
      });
      if (handled !== false) return;
    } catch (e) { console.warn('brand highlight', e); }
  }

  let regexSource = HONDA_PART_REGEX.source;
  if (mode === 'kawasaki') regexSource = KAWASAKI_PART_REGEX.source;
  else if (mode === 'yamaha') regexSource = YAMAHA_PART_REGEX.source;
  const regex = new RegExp(regexSource, 'gi');

  const hlCanvas = document.createElement('canvas');
  hlCanvas.className = 'highlight-layer';
  hlCanvas.width = viewport.width;
  hlCanvas.height = viewport.height;
  hlCanvas.style.width = viewport.width + 'px';
  hlCanvas.style.height = viewport.height + 'px';
  pageDiv.appendChild(hlCanvas);
  const ctx = hlCanvas.getContext('2d');
  ctx.fillStyle = 'rgba(255, 235, 59, 0.45)';

  const seen = new Set();

  // Honda：零件號常被拆成多個 text item，需同列拼接後再匹配，高亮才完整
  if (mode === 'honda') {
    const items = textContent.items.filter(it => it && it.str && it.transform);
    const used = new Set();
    for (let i = 0; i < items.length; i++) {
      if (used.has(i)) continue;
      const baseY = items[i].transform[5];
      let j = i;
      let concat = '';
      const pieces = [];
      while (j < items.length && Math.abs(items[j].transform[5] - baseY) < 2.5) {
        const raw = items[j].str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[－–—]/g, '-');
        const startInConcat = concat.length;
        concat += raw;
        pieces.push({ idx: j, raw, start: startInConcat, end: concat.length, item: items[j] });
        used.add(j);
        j++;
        // 同列下一個 item 應大致向右
        if (j < items.length && items[j].transform[4] < items[j-1].transform[4] - 5) break;
      }
      const lineStr = concat.replace(/\s*[-－–—]\s*/g, '-');
      regex.lastIndex = 0;
      let m;
      while ((m = regex.exec(lineStr)) !== null) {
        const key = normalizePartNo(m[0].replace(/\s+/g, ''));
        if (!key || key.length < 8) continue;
        const dedupe = key + '@' + Math.round(baseY) + '@' + m.index;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        if (!partInfoMap.has(key)) {
          partInfoMap.set(key, { name: '（無名稱）', qty: 1, category: '未分類', itemNo: '' });
        }
        // 同步寫入本頁清單，避免解析漏掉時清單為 0
        try {
          const pIdx = parseInt(pageDiv.dataset.pageIndex, 10);
          if (!isNaN(pIdx)) {
            let lst = pagePartKeys.get(pIdx);
            if (!lst) { lst = []; pagePartKeys.set(pIdx, lst); }
            if (!lst.some(x => (typeof x === 'string' ? x : x.key) === key)) lst.push(key);
          }
        } catch (e) {}
        // 對應到第一個有重疊的 piece 作為原點，寬度用整段估算
        let origin = pieces[0].item;
        for (const p of pieces) {
          if (m.index >= p.start && m.index < p.end) { origin = p.item; break; }
        }
        const tx = pdfjsLib.Util.transform(viewport.transform, origin.transform);
        const fontH = Math.hypot(tx[2], tx[3]) || ((origin.height || 10) * viewport.scale) || 10;
        const w = Math.min(Math.max(m[0].length * fontH * 0.58, fontH * 2), fontH * 0.62 * 16);
        // 項次 1 位與 2 位寬度不同：依實際位數右移，避免 1 位時高亮偏太多
        const beforeStr = lineStr.slice(0, m.index);
        const pref = beforeStr.match(/(\d{1,2})(\s*)$/);
        let xOff = 0;
        if (pref) {
          const digits = pref[1].length; // 1 或 2
          const spaces = pref[2] ? pref[2].length : 0;
          // 約：每位數字 0.55em + 空白少許
          xOff = fontH * (0.58 * digits + 0.25 * Math.min(spaces, 2) + 0.15);
        }
        const x = tx[4] + xOff;
        const y = tx[5] - fontH * 0.85;
        ctx.fillRect(x, y, w, fontH * 1.15);
        const hit = document.createElement('div');
        hit.className = 'part-hit-box';
        hit.style.left = x + 'px';
        hit.style.top = y + 'px';
        hit.style.width = w + 'px';
        hit.style.height = (fontH * 1.15) + 'px';
        hit.dataset.partKey = key;
        pageDiv.appendChild(hit);
        bindPartEvent(hit, key);
      }
    }
    return;
  }

  // 川崎：逐零件號找文字項，強制在 viewport 畫橫向黃框（不依賴同 Y 拼接）
  if (mode === 'kawasaki') {
    const items = (textContent.items || []).filter(it => it && it.transform && String(it.str || '').length);
    const pageIdx = parseInt(pageDiv.dataset.pageIndex, 10);
    const keysFromPage = (!isNaN(pageIdx) && pagePartKeys.get(pageIdx)) ? [...pagePartKeys.get(pageIdx)] : [];
    // 也從本頁文字再掃一輪零件號
    const re = new RegExp(KAWASAKI_PART_REGEX.source, 'gi');
    const foundKeys = new Set(keysFromPage.map(k => typeof k === 'string' ? k : (k && k.key)).filter(Boolean));
    for (const it of items) {
      const s = String(it.str || '').replace(/[－–—]/g, '-');
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s)) !== null) {
        const pno = normalizePartNo((m[1] || m[0]).replace(/^[^0-9]+/, ''));
        if (isValidKawasakiPartNo(pno)) foundKeys.add(pno);
      }
    }
    // 鄰近拼接再掃（防拆字）
    const sorted = items.slice().sort((a, b) => {
      const dy = (b.transform[5] || 0) - (a.transform[5] || 0);
      if (Math.abs(dy) > 8) return dy;
      return (a.transform[4] || 0) - (b.transform[4] || 0);
    });
    for (let i = 0; i < sorted.length; i++) {
      let concat = '';
      const group = [];
      const y0 = sorted[i].transform[5];
      const x0 = sorted[i].transform[4];
      for (let j = i; j < Math.min(i + 12, sorted.length); j++) {
        const it = sorted[j];
        const dy = Math.abs((it.transform[5] || 0) - y0);
        const dx = Math.abs((it.transform[4] || 0) - x0);
        // 同列或同欄都允許
        if (dy > 10 && dx > 10) break;
        if (dy > 10 && group.length) {
          // 換列但可能是直欄：若 X 接近則繼續
          if (Math.abs((it.transform[4] || 0) - (group[0].transform[4] || 0)) > 12) break;
        }
        concat += String(it.str || '').replace(/[－–—]/g, '-');
        group.push(it);
      }
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(concat)) !== null) {
        const pno = normalizePartNo((m[1] || m[0]).replace(/^[^0-9]+/, ''));
        if (isValidKawasakiPartNo(pno)) foundKeys.add(pno);
      }
    }

    for (const key of foundKeys) {
      if (!isValidKawasakiPartNo(key)) continue;
      const compactKey = key.replace(/-/g, '');
      const pref = key.split('-')[0];
      // 只接受「完整／近完整」零件號文字，排除純 Ref（13031）與中段碎片（39-0951）
      const matchedItems = [];
      for (const it of items) {
        let s = String(it.str || '').replace(/[－–—]/g, '-').replace(/\s+/g, '').toUpperCase();
        if (!s || s.length < 7) continue;
        // 必須像零件號：含 - 或為特殊 130BA0612 形
        const looksPart = /-/.test(s) || /^\d{3}[A-Z]{1,2}\d{4}/.test(s);
        if (!looksPart) continue;
        // 正規化後比對
        const ns = normalizePartNo(s);
        if (ns === key) { matchedItems.push(it); continue; }
        if (ns.replace(/-/g, '') === compactKey) { matchedItems.push(it); continue; }
        // 允許拆開的連續片段組出完整號（下方 group 再處理）
        if (key.startsWith(ns) && ns.length >= 8 && ns.includes('-')) matchedItems.push(it);
      }
      // 若單 item 沒找到，嘗試同列拼接命中後，用含完整 key 的 pieces
      if (!matchedItems.length) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const y0 = it.transform[5] || 0;
          let concat = '';
          const group = [];
          for (let j = i; j < items.length; j++) {
            const jt = items[j];
            if (Math.abs((jt.transform[5] || 0) - y0) > 5) break;
            if (group.length && (jt.transform[4] || 0) < (group[group.length - 1].transform[4] || 0) - 8) break;
            concat += String(jt.str || '').replace(/[－–—]/g, '-');
            group.push(jt);
            if (concat.length > 40) break;
          }
          const ncat = normalizePartNo(concat.replace(/\s+/g, ''));
          if (ncat.includes(key) || normalizePartNo(concat).includes(key)) {
            // 只取內容像此零件號的 items
            for (const g of group) {
              const gs = String(g.str || '').replace(/[－–—]/g, '-').replace(/\s+/g, '');
              if (!gs) continue;
              if (key.includes(normalizePartNo(gs)) && (gs.includes('-') || gs.length >= 5)) {
                // 排除純 Ref：若 gs 剛好等於前綴且無 dash
                if (gs === pref && !gs.includes('-')) continue;
                matchedItems.push(g);
              }
            }
            if (matchedItems.length) break;
          }
        }
      }
      // 仍沒有：跳過，不要用 Ref 濫標
      if (!matchedItems.length) continue;

      // 優先選含 '-' 且最接近完整 key 的 item 作為錨點
      matchedItems.sort((a, b) => {
        const sa = String(a.str || '');
        const sb = String(b.str || '');
        const score = (s) => (s.includes('-') ? 10 : 0) + Math.min(s.length, 20);
        return score(sb) - score(sa);
      });
      const anchor = matchedItems[0];
      const tx0 = pdfjsLib.Util.transform(viewport.transform, anchor.transform);
      let fontH = Math.hypot(tx0[2], tx0[3]) || ((anchor.height || 10) * viewport.scale) || 12;
      // 合併同列匹配項的水平範圍
      let minX = tx0[4], maxX = tx0[4];
      for (const it of matchedItems) {
        const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]) || fontH;
        fontH = Math.max(fontH, fh);
        let w = (it.width && it.width > 0) ? it.width * viewport.scale : String(it.str || '').length * fh * 0.55;
        w = Math.min(Math.max(w, fh * 0.8), fh * 12);
        minX = Math.min(minX, tx[4]);
        maxX = Math.max(maxX, tx[4] + w);
      }
      let bw = Math.max(maxX - minX, fontH * 0.55 * Math.min(key.length, 16));
      let bh = Math.max(fontH * 1.15, 11);
      // 強制橫向
      if (bh > bw) { const c = (minX + maxX) / 2; bw = Math.max(bw, fontH * 0.55 * key.length); minX = c - bw / 2; }
      // 品牌檔控制：kawasaki-th offsetX=-50（向左），expandLeft=50（加寬保持右緣）
      const offX = hlOpts.offsetX || 0;
      const expL = hlOpts.expandLeft || 0;
      const left = minX + offX;
      const drawW = bw + expL;
      const top = tx0[5] - bh * 0.85;
      const dedupe = key + '@' + Math.round(left) + '@' + Math.round(top);
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      if (!partInfoMap.has(key)) {
        partInfoMap.set(key, { name: '（無名稱）', qty: 1, category: '未分類', itemNo: '' });
      }
      try {
        if (!isNaN(pageIdx)) {
          let lst = pagePartKeys.get(pageIdx);
          if (!lst) { lst = []; pagePartKeys.set(pageIdx, lst); }
          if (!lst.includes(key)) lst.push(key);
        }
      } catch (e) {}

      ctx.fillRect(left, top, drawW, bh);
      const hit = document.createElement('div');
      hit.className = 'part-hit-box';
      hit.style.left = left + 'px';
      hit.style.top = top + 'px';
      hit.style.width = drawW + 'px';
      hit.style.height = bh + 'px';
      hit.dataset.partKey = key;
      pageDiv.appendChild(hit);
      bindPartEvent(hit, key);
    }
    return;
  }

  for (const item of textContent.items) {
    if (!item.str || !item.transform) continue;
    let raw = item.str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[－–—]/g, '-');
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(raw)) !== null) {
      const key = normalizePartNo((m[1] || m[0]).replace(/^[^0-9A-Z]+/i, '').replace(/\s+/g, ''));
      if (!key) continue;
      if (mode === 'kawasaki' && !isValidKawasakiPartNo(key)) continue;
      if (mode === 'yamaha' && !isValidYamahaPartNo(key)) continue;
      const dedupe = key + '@' + Math.round(item.transform[4]) + ',' + Math.round(item.transform[5]);
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      if (!partInfoMap.has(key)) {
        partInfoMap.set(key, { name: '（無名稱）', qty: 1, category: '未分類', itemNo: '' });
      }
      try {
        const pIdx = parseInt(pageDiv.dataset.pageIndex, 10);
        if (!isNaN(pIdx)) {
          let lst = pagePartKeys.get(pIdx);
          if (!lst) { lst = []; pagePartKeys.set(pIdx, lst); }
          if (!lst.some(x => (typeof x === 'string' ? x : x && x.key) === key)) lst.push(key);
        }
      } catch (e) {}

      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontH = Math.hypot(tx[2], tx[3]) || ((item.height || 10) * viewport.scale) || 10;
      let w = (item.width && item.width > 0)
        ? (item.width * viewport.scale)
        : (m[0].length * fontH * 0.55);
      if (raw.length > m[0].length + 2) {
        w = w * (m[0].length / Math.max(raw.length, 1));
      }
      w = Math.min(Math.max(w, fontH * 1.5), fontH * 0.62 * 18);

      const x = tx[4];
      const y = tx[5] - fontH * 0.85;

      ctx.fillRect(x, y, w, fontH * 1.15);

      const hit = document.createElement('div');
      hit.className = 'part-hit-box';
      hit.style.left = x + 'px';
      hit.style.top = y + 'px';
      hit.style.width = w + 'px';
      hit.style.height = (fontH * 1.15) + 'px';
      hit.dataset.partKey = key;
      pageDiv.appendChild(hit);
      bindPartEvent(hit, key);
    }
  }
}

/* ================= 頁面選擇器與跳頁 ================= */
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
  document.querySelectorAll('.custom-option').forEach(opt => opt.classList.toggle('selected', opt.getAttribute('data-val') === val));
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
        if (selectedOpt) optsContainer.scrollTop = Math.max(0, selectedOpt.offsetTop - (optsContainer.clientHeight / 2) + (selectedOpt.clientHeight / 2));
      });
    });
  }
});

document.addEventListener('click', () => $('customOptions').classList.remove('open'));

// V20.28：程式換頁期間鎖定目標頁，避免快速連點時 sync 拉回中間頁
// V20.87：回到 V77 簡單跳頁（無防抖佇列、無渲染鎖排隊）
function scrollToPage(pageIndex) {
  const pageDiv = container.querySelector(`.page-container[data-page-index="${pageIndex}"]`);
  if (!pageDiv) {
    renderPagesInRange(pageIndex);
    return;
  }

  navLockTarget = pageIndex;
  isScrollingProgrammatically = true;
  clearTimeout(navLockTimer);

  const ratio = scale / RENDER_SCALE;
  const targetTop = pageDiv.offsetTop * ratio;
  viewport.scrollTo({ top: Math.max(0, targetTop - 20), behavior: 'auto' });

  renderPagesInRange(pageIndex);

  pageDiv.style.transition = 'box-shadow .25s';
  pageDiv.style.boxShadow = '0 0 0 3px #fbbf24, 0 4px 16px rgba(251,191,36,0.55)';

  navLockTimer = setTimeout(() => {
    pageDiv.style.boxShadow = '';
    if (navLockTarget === pageIndex) {
      isScrollingProgrammatically = false;
      navLockTarget = null;
    }
  }, 450);
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

/* ================= 零件清單渲染 ================= */
// V20.43：優先用索引的 FIG.xx，其次正式零件頁，避開「索引」頁
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
    const norm = (typeof normalizePartNo === 'function') ? normalizePartNo(key) : String(key).toUpperCase();

    // 1) 索引表：29-8 → FIG.29
    if (typeof partFigLocations !== 'undefined' && partFigLocations) {
      const loc = partFigLocations.get(norm) || partFigLocations.get(key);
      if (loc && loc.fig != null) {
        const figPage = findPageByFigNumber(loc.fig);
        if (figPage != null) return figPage;
      }
    }

    // 2) category 含 FIG. n
    const info = partInfoMap.get(key) || partInfoMap.get(norm);
    if (info && info.category) {
      const m = String(info.category).match(/FIG\.?\s*(\d+)/i);
      if (m) {
        const figPage = findPageByFigNumber(parseInt(m[1], 10));
        if (figPage != null) return figPage;
      }
    }

    // 3) pagePartKeys：非索引頁優先
    let indexFallback = null;
    for (const [pageIdx, list] of pagePartKeys.entries()) {
      if (!list) continue;
      let hit = false;
      for (const item of list) {
        const k = typeof item === 'string' ? item : (item && item.key);
        if (!k) continue;
        if (k === key || ((typeof normalizePartNo === 'function' ? normalizePartNo(k) : String(k).toUpperCase()) === norm)) {
          hit = true; break;
        }
      }
      if (!hit) continue;
      const title = pageTitles.get(pageIdx) || '';
      if (isIndexPageTitle(title)) {
        if (indexFallback == null) indexFallback = pageIdx;
        continue;
      }
      return pageIdx;
    }
    return indexFallback;
  } catch (e) {
    console.warn('findPageForPart', e);
    return null;
  }
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

function partKeysEqual(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = (typeof normalizePartNo === 'function') ? normalizePartNo(a) : String(a);
  const nb = (typeof normalizePartNo === 'function') ? normalizePartNo(b) : String(b);
  if (na === nb) return true;
  const ca = String(na).replace(/[-\s]/g, '').toUpperCase();
  const cb = String(nb).replace(/[-\s]/g, '').toUpperCase();
  return ca === cb;
}

function applyBlueFocusStyle(el) {
  el.dataset.partFocus = '1';
  el.style.outline = '2px solid #2563eb';
  el.style.background = 'rgba(37, 99, 235, 0.4)';
  el.style.boxShadow = '0 0 0 1px rgba(37, 99, 235, 0.55)';
}

// V20.40：藍色固定高亮；比對更寬；textLayer 後備；重試更久
function highlightPartOnPage(key) {
  if (!key || !container) return false;
  let matched = [];

  // 1) 有 data-part-key 的熱區／高亮盒
  container.querySelectorAll('[data-part-key]').forEach(el => {
    if (partKeysEqual(el.dataset.partKey, key)) matched.push(el);
  });

  // 2) 後備：textLayer 精確比對
  if (!matched.length) {
    const pageIdx = findPageForPart(key);
    const pageDiv = pageIdx != null
      ? container.querySelector(`.page-container[data-page-index="${pageIdx}"]`)
      : null;
    const scope = pageDiv || container;
    const compactKey = String((typeof normalizePartNo === 'function') ? normalizePartNo(key) : key)
      .replace(/[-\s]/g, '').toUpperCase();
    scope.querySelectorAll('.textLayer span').forEach(span => {
      const raw = (span.textContent || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/[－–—]/g, '-');
      const trimmed = raw.trim();
      const compact = trimmed.replace(/[-\s]/g, '').toUpperCase();
      if (!compact) return;
      if (partKeysEqual(trimmed, key) || compact === compactKey) matched.push(span);
    });
  }

  if (!matched.length) return false;
  // 找到後才清舊高亮並套用 — 重試過程不閃爍
  clearPartFocusHighlight();
  matched.forEach(el => {
    applyBlueFocusStyle(el);
    if (el.classList && el.classList.contains('textLayer') === false && el.tagName === 'SPAN') {
      el.style.color = 'transparent';
    }
  });
  return true;
}

function jumpToPart(key) {
  if (!key) return;
  if (!currentPdfDoc) { console.warn('no pdf'); return; }
  let pageIdx = findPageForPart(key);
  if (pageIdx === null || pageIdx === undefined) {
    // 後備：掃一遍 pagePartKeys（含索引頁）
    const norm = (typeof normalizePartNo === 'function') ? normalizePartNo(key) : String(key).toUpperCase();
    for (const [idx, list] of pagePartKeys.entries()) {
      if (!list) continue;
      for (const item of list) {
        const k = typeof item === 'string' ? item : (item && item.key);
        if (!k) continue;
        if (k === key || ((typeof normalizePartNo === 'function' ? normalizePartNo(k) : String(k).toUpperCase()) === norm)) {
          pageIdx = idx; break;
        }
      }
      if (pageIdx != null) break;
    }
  }
  if (pageIdx === null || pageIdx === undefined) {
    alert('找不到此零件所在的 PDF 頁面。');
    return;
  }
  // 若目前頁已有此零件，不跳到其他頁（避免共用螺栓號跳錯頁）
  try {
    const curKeys = pagePartKeys.get(currentPageIndex) || [];
    const norm = (typeof normalizePartNo === 'function') ? normalizePartNo(key) : String(key).toUpperCase();
    const onCurrent = curKeys.some(item => {
      const k = typeof item === 'string' ? item : (item && item.key);
      if (!k) return false;
      if (k === key) return true;
      const nk = (typeof normalizePartNo === 'function') ? normalizePartNo(k) : String(k).toUpperCase();
      return nk === norm;
    });
    if (onCurrent) pageIdx = currentPageIndex;
  } catch (e) {}

  const alreadyOnPage = (currentPageIndex === pageIdx);

  selectedKey = key;
  // 保持清單篩選：若在「全部」模式不強制改頁下拉
  if (currentSelectValue !== 'all') {
    currentSelectValue = String(pageIdx);
    updateCustomSelectUI(String(pageIdx));
  }
  if (!alreadyOnPage) {
    currentPageIndex = pageIdx;
  }
  renderPartList(currentSelectValue === 'all' ? 'all' : 'page', pageIdx, false);

  if (!alreadyOnPage) {
    scrollToPage(pageIdx);
  } else {
    renderPagesInRange(pageIdx);
  }

  clearPartFocusHighlight(); // 只在換選取時清一次
  let tries = 0;
  const tryHl = () => {
    tries++;
    if (highlightPartOnPage(key)) return;
    if (tries >= 20) return;
    setTimeout(tryHl, 180);
  };
  setTimeout(tryHl, alreadyOnPage ? 80 : 280);
}

function renderPartList(mode = 'page', pageIdx = 0, scrollToTop = false) {
  const box = $('partList');
  let keys = [];
  const q = $('partSearch').value.trim().toUpperCase();
  
  if (q) {
    // V20.42：項次→零件號碼→品名→數量；數字搜尋只打在項次/零件號；過濾不完整號碼
    const allKeys = [...partInfoMap.keys()];
    const isDigitQuery = /^\d+$/.test(q);
    const qCompact = q.replace(/[-\s]/g, '');
    const scored = [];

    const looksComplete = (k) => {
      const s = String(k);
      const hy = (s.match(/-/g) || []).length;
      return hy >= 2 && s.length >= 10;
    };

    for (const k of allKeys) {
      const info = partInfoMap.get(k);
      if (!info) continue;
      const itemNo = String(info.itemNo || '').trim();
      const partNo = String(k).toUpperCase();
      const partNoCompact = partNo.replace(/[-\s]/g, '');
      const name = String(info.name || '').toUpperCase();
      const rawName = String(info.rawName || '').toUpperCase();
      const qty = String(info.qty != null ? info.qty : '');

      // 若存在更完整的同號（例如 1CF-F8379 vs 1CF-F8379-00），略過短的
      if (!looksComplete(k)) {
        const compact = partNoCompact;
        const hasLonger = allKeys.some(other => {
          if (other === k) return false;
          if (!looksComplete(other)) return false;
          const oc = String(other).toUpperCase().replace(/[-\s]/g, '');
          return oc.startsWith(compact) || compact.startsWith(oc);
        });
        if (hasLonger) continue;
      }

      let rank = 0;
      if (itemNo && itemNo.toUpperCase() === q) rank = 1;
      else if (itemNo && itemNo.toUpperCase().includes(q)) rank = 2;
      else if (partNo.includes(q) || partNoCompact.includes(qCompact)) rank = 3;
      else if (!isDigitQuery && (name === q || rawName === q)) rank = 4;
      else if (!isDigitQuery && (name.includes(q) || rawName.includes(q))) {
        // 品名命中但排除「品名裡只是另一個零件號」的髒資料
        const nameLooksLikePartSoup = /[A-Z0-9]{2,}-[A-Z0-9]{2,}/.test(name) && name.split(/\s+/).length >= 2;
        if (nameLooksLikePartSoup && !name.startsWith(q)) continue;
        rank = 5;
      } else if (qty && qty === q) rank = 6;
      else continue;

      const itemNum = parseInt(itemNo, 10);
      scored.push({
        key: k,
        rank,
        itemNum: isNaN(itemNum) ? 99999 : itemNum,
        partNo,
        complete: looksComplete(k) ? 0 : 1
      });
    }
    scored.sort((a, b) => a.rank - b.rank || a.complete - b.complete || a.itemNum - b.itemNum || a.partNo.localeCompare(b.partNo));
    keys = scored.map(s => s.key).filter(k => currentMode !== 'yamaha' || isValidYamahaPartNo(k));
  } else {
    if (mode === 'all') keys = [...partInfoMap.keys()];
    else keys = pagePartKeys.get(pageIdx) || [];
  }

  // Yamaha：去掉缺前綴殘段（74-F3141-00），只留完整號（B74-F3141-00）
  if (currentMode === 'yamaha') {
    const normKeys = keys.map(x => typeof x === 'string' ? x : (x && x.key)).filter(Boolean);
    const filtered = normKeys.filter(k => isValidYamahaPartNo(k));
    const deduped = filtered.filter(k =>
      !filtered.some(o => o !== k && o.length > k.length && (o.endsWith(k) || o.endsWith(k.replace(/^[A-Z]/, ''))))
    );
    // 保留原結構（string 或 object）
    keys = keys.filter(x => {
      const k = typeof x === 'string' ? x : (x && x.key);
      return k && deduped.includes(k);
    });
  }

  $('listCount').textContent = keys.length;
  
  if (!keys.length) {
    box.innerHTML = `<p style="color:var(--muted);font-size:13px;text-align:center;padding:30px 14px;">無零件資料。</p>`;
    if (scrollToTop) box.scrollTop = 0;
    return;
  }

  // V20.78：分批插入（每批 30），降低手機 DOM 一次插入壓力
  const token = ++partListRenderToken;
  box.innerHTML = '';
  if (scrollToTop) box.scrollTop = 0;

  const bindRow = (row) => {
    row.addEventListener('click', e => {
      if (e.target.closest('.add-btn')) return;
      const key = row.dataset.key;
      selectedKey = key;
      if (key) jumpToPart(key);
      else renderPartList(mode, pageIdx);
    });
    row.style.cursor = 'pointer';
    row.title = '點擊：跳至 PDF 位置';
  };
  const bindBtn = (btn) => {
    btn.addEventListener('click', e => { e.stopPropagation(); addToPickList(btn.dataset.add, currentPageIndex); });
  };

  const makeRowHtml = (itemOrKey) => {
    let key = typeof itemOrKey === 'string' ? itemOrKey : itemOrKey.key;
    let info = typeof itemOrKey === 'string' ? partInfoMap.get(key) : itemOrKey;
    if (!info) return '';
    const pickData = pickList.get(key);
    const inPick = pickData !== undefined;
    const btnText = inPick ? `✓ 已加入 (${pickData.qty})` : '＋ PickList';
    const btnClass = inPick ? 'add-btn added' : 'add-btn';
    const sel = key === selectedKey ? ' selected' : '';
    const itemPrefix = info.itemNo ? `<span style="color:#94a3b8;font-size:12px;margin-right:6px;">[${esc(info.itemNo)}]</span>` : '';
    return `<div class="part-row${sel}" data-key="${esc(key)}">
      <span class="pno">${itemPrefix}${esc(key)}</span>
      <span class="pname">${esc(info.name)}</span>
      <span class="pmeta"><span class="qty">×${info.qty}</span><br>${esc(info.category)}</span>
      <button class="${btnClass}" data-add="${esc(key)}">${btnText}</button>
    </div>`;
  };

  const batchSize = 30;
  let offset = 0;
  const appendBatch = () => {
    if (token !== partListRenderToken) return;
    const frag = document.createDocumentFragment();
    const wrap = document.createElement('div');
    const end = Math.min(offset + batchSize, keys.length);
    let chunk = '';
    for (let i = offset; i < end; i++) chunk += makeRowHtml(keys[i]);
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
    if (offset < keys.length) requestAnimationFrame(appendBatch);
  };
  appendBatch();
}

$('partSearch').addEventListener('input', () => renderPartList(currentSelectValue === 'all' ? 'all' : 'page', currentPageIndex));

/* ================= PickList ================= */

// PickList 紅色項次標記
function highlightPickListItems() {
  if (currentMode !== 'yamaha') return;
  const pageDiv = document.querySelector('.page-container[data-page-index="' + currentPageIndex + '"]');
  if (!pageDiv) return;
  // 移除舊的紅色標記
  pageDiv.querySelectorAll('.pick-marker').forEach(el => el.remove());
  // 取得本頁 PickList 的項次
  const itemNos = new Set();
  for (const [k, v] of pickList) {
    if (v.pageIndex === currentPageIndex && v.itemNo) itemNos.add(String(v.itemNo));
  }
  if (!itemNos.size) return;
  // 在圖上找項次數字並加紅框
  const canvas = pageDiv.querySelector('canvas');
  if (!canvas) return;
  const items = pageDiv._textItems || [];
  for (const it of items) {
    const s = String(it.str || '').trim();
    if (!itemNos.has(s)) continue;
    if (!/^\d{1,3}$/.test(s)) continue;
    const x = it.transform[4] || 0;
    const y = it.transform[5] || 0;
    // 只標記圖區（左邊，X < 300）
    if (x > 300) continue;
    const marker = document.createElement('div');
    marker.className = 'pick-marker';
    marker.style.cssText = 'position:absolute;left:' + (x - 2) + 'px;top:' + (y - 10) + 'px;width:16px;height:14px;border:2px solid #e11d48;border-radius:2px;pointer-events:none;z-index:5;';
    pageDiv.appendChild(marker);
  }
}
function addToPickList(key, pageIdx) {
  if (!key) return;
  if (currentMode === 'kawasaki') key = sanitizeKawasakiKey(key);
  if (currentMode === 'kawasaki' && !isValidKawasakiPartNo(key)) return;
  // 用 pageIndex 分開同零件不同頁
  const pIdx = (pageIdx != null) ? pageIdx : (typeof currentPageIndex !== 'undefined' ? currentPageIndex : 0);
  const pickKey = key + '@p' + pIdx;
  let info = partInfoMap.get(key);
  if (!info) {
    for (const [k, v] of partInfoMap.entries()) {
      if (k === key || k.startsWith(key) || key.startsWith(k.split('-').slice(0, 2).join('-'))) {
        if (v && v.name && v.name !== '（無名稱）') { info = { ...v }; break; }
      }
    }
  }
  if (!info) info = { name: '（無名稱）', qty: 1, category: '未分類', itemNo: '' };
  if (pickList.has(pickKey)) pickList.get(pickKey).qty += (info.qty || 1);
  else pickList.set(pickKey, { partKey: key, pageIndex: pIdx, name: info.name || '（無名稱）', qty: info.qty || 1, category: info.category || '未分類', itemNo: info.itemNo || '' });
  renderPickList();
  if (typeof highlightPickListItems === 'function') highlightPickListItems();
}

function setPickQty(key, qty) {
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
      if (cleanKey === key) { pickData = v; break; }
    }
    if (pickData) { btn.textContent = `✓ 已加入 (${pickData.qty})`; btn.classList.add('added'); }
    else { btn.textContent = '＋ PickList'; btn.classList.remove('added'); }
  });
}

function renderPickList() {
  const box = $('pickListBox');
  $('pickCount').textContent = pickList.size;
  {
    const b = document.getElementById('btnClearPick');
    if (b) {
      b.disabled = pickList.size === 0;
      if (pickList.size > 0) b.removeAttribute('disabled');
      else b.setAttribute('disabled', 'disabled');
    }
  }

  if (!pickList.size) {
    box.innerHTML = '<div class="pick-empty"><strong>PickList 是空的</strong>從「零件清單」或圖面點擊加入</div>';
    $('pickSummary').textContent = ''; updatePartButtons(); return;
  }
  let html = '', totalQty = 0;
  for (const [pickKey, data] of pickList) {
    totalQty += data.qty;
    const partKey = data.partKey || pickKey.split('@p')[0];
    const pIdx = data.pageIndex != null ? data.pageIndex : 0;
    const itemPrefix = data.itemNo ? `<span style="color:#94a3b8;font-size:12px;margin-right:6px;">[${esc(data.itemNo)}]</span>` : '';
    const sel = pickKey === selectedKey ? ' selected' : '';
    html += `<div class="pick-item${sel}" data-key="${esc(pickKey)}" data-part="${esc(partKey)}" data-page="${pIdx}" title="點擊：跳至第 ${pIdx+1} 頁並藍色高亮">
      <div class="pick-item-top">
        <div>
          <div class="pk-no">${esc(partKey)}</div>
          <div class="pk-name">${itemPrefix}${esc(data.name)}</div>
          <span class="pk-cat">${esc(data.category)} · 第 ${pIdx+1} 頁</span>
        </div>
        <button class="del-pk" data-del-pk="${esc(pickKey)}" title="移除">✕</button>
      </div>
      <div class="pick-item-bottom">
        <div class="pick-qty">
          <button data-pk-dec="${esc(pickKey)}">−</button>
          <input type="number" min="1" value="${data.qty}" data-pk-input="${esc(pickKey)}">
          <button data-pk-inc="${esc(pickKey)}">+</button>
        </div>
      </div>
    </div>`;
  }
  box.innerHTML = html;
  $('pickSummary').textContent = `共 ${pickList.size} 種零件，合計 ${totalQty} 件`;

  // 點擊列：與零件清單相同 → jumpToPart + 藍色高亮
  box.querySelectorAll('.pick-item').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.del-pk, .pick-qty, button, input')) return;
      const pickKey = row.dataset.key;
      const partKey = row.dataset.part || pickKey;
      const pIdx = parseInt(row.dataset.page, 10);
      if (!pickKey) return;
      selectedKey = pickKey;
      if (!isNaN(pIdx)) {
        // 先跳到該頁
        const pageDiv = container.querySelector(`.page-container[data-page-index="${pIdx}"]`);
        if (pageDiv) pageDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      jumpToPart(partKey);
      // 同步選中樣式
      box.querySelectorAll('.pick-item').forEach(r => r.classList.toggle('selected', r.dataset.key === key));
    });
  });
  box.querySelectorAll('[data-del-pk]').forEach(b => b.onclick = (e) => { e.stopPropagation(); setPickQty(b.dataset.delPk, 0); });
  box.querySelectorAll('[data-pk-dec]').forEach(b => b.onclick = (e) => { e.stopPropagation(); setPickQty(b.dataset.pkDec, pickList.get(b.dataset.pkDec).qty - 1); });
  box.querySelectorAll('[data-pk-inc]').forEach(b => b.onclick = (e) => { e.stopPropagation(); setPickQty(b.dataset.pkInc, pickList.get(b.dataset.pkInc).qty + 1); });
  box.querySelectorAll('[data-pk-input]').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('change', () => { let v = parseInt(inp.value, 10); if (isNaN(v) || v < 1) v = 1; setPickQty(inp.dataset.pkInput, v); });
  });
  updatePartButtons(); 
}

(function bindClearPick() {
  const btn = document.getElementById('btnClearPick');
  if (!btn) return;
  const doClear = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (!pickList.size) return;
    if (!confirm('確定清空 PickList？（共 ' + pickList.size + ' 種零件）')) return;
    pickList.clear();
    renderPickList();
  };
  btn.addEventListener('click', doClear);
  btn.onclick = doClear;
})();

/* ================= 分頁切換 ================= */
function switchView(name) {
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.panel-view').forEach(v => v.classList.toggle('active', v.id === 'view' + name.charAt(0).toUpperCase() + name.slice(1)));
}
document.querySelectorAll('.sidebar-tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

/* ================= 匯出 Modal ================= */
const modal = $('modal');
$('btnExportPick').addEventListener('click', () => {
  if (!pickList.size) { alert('PickList 是空的。'); return; }
  modal.classList.add('open'); buildModalContent();
});
$('btnClose').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('mousedown', e => { if (e.target === modal) modal.classList.remove('open'); });

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
  catch { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} document.body.removeChild(ta); return ok; }
}
$('btnCopy').addEventListener('click', async () => {
  // 複製不含表頭；品名去掉重複零件號；數量 xN
  let t = '';
  for (const [k, d] of pickList) {
    const cleanKey = (d.partKey || k.split('@p')[0]).replace(/[–—]/g, '-');
    let pureName = (d.name || '').trim();
    let nameNorm = pureName.replace(/[–—]/g, '-');
    if (nameNorm.toUpperCase().startsWith(cleanKey.toUpperCase())) {
      pureName = nameNorm.substring(cleanKey.length).replace(/^[\s\-]+/, '').trim();
    }
    if (!pureName) pureName = d.name || '';
    t += `${cleanKey}\t${pureName}\tx${d.qty}\n`;
  }
  const ok = await copyText(t), btn = $('btnCopy'), orig = btn.innerHTML;
  btn.innerHTML = ok ? '✅ 已複製' : '❌ 複製失敗';
  setTimeout(() => btn.innerHTML = orig, 2000);
});
$('btnPrint').addEventListener('click', () => window.print());
$('btnExcel').addEventListener('click', () => {
  const csvEsc = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  let csv = '零件號碼,產品名稱,數量\n', total = 0;
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
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `PickList_${getTimestamp()}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});

/* ================= 側欄／下方面板單一收合鈕 ================= */
(function initSidebarCollapse() {
  const layout = document.querySelector('.layout');
  const btn = $('btnSidebarCollapse');
  if (!layout || !btn) return;
  function isMobilePortrait() {
    return window.matchMedia('(max-width: 768px) and (orientation: portrait)').matches;
  }
  function syncIcon() {
    const collapsed = layout.classList.contains('panel-collapsed');
    btn.textContent = collapsed ? '↓' : '↑';
    btn.title = collapsed ? '展開清單' : '收起清單';
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    layout.classList.toggle('panel-collapsed');
    syncIcon();
    // 不呼叫 fitWidth，避免收合／展開時 PDF 畫面倍率變動
  
// 
;
// 手掌／三指拖曳移動 PDF
(function() {
  const container = document.getElementById('pdfContainer');
  if (!container) return;
  let palmStart = null;
  container.addEventListener('touchstart', e => {
    if (e.touches.length >= 3) {
      palmStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, sx: container.scrollLeft, sy: container.scrollTop };
      e.preventDefault();
    }
  }, { passive: false });
  container.addEventListener('touchmove', e => {
    if (palmStart && e.touches.length >= 3) {
      const dx = e.touches[0].clientX - palmStart.x;
      const dy = e.touches[0].clientY - palmStart.y;
      container.scrollLeft = palmStart.sx - dx;
      container.scrollTop = palmStart.sy - dy;
      e.preventDefault();
    }
  }, { passive: false });
  container.addEventListener('touchend', () => { palmStart = null; });
})();
});
  window.addEventListener('resize', syncIcon);
  syncIcon();
})();

/* ================= 初始化 ================= */
renderPartList('page', 0, true);
renderPickList();
updateRamUsage();
// 圖片上傳識別
document.getElementById('btnUploadImage')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('uploadMenu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('btnUploadImg')?.addEventListener('click', () => {
  document.getElementById('uploadMenu').style.display = 'none';
  document.getElementById('fileInputImage')?.click();
});
document.getElementById('btnUploadMultiPdf')?.addEventListener('click', () => {
  document.getElementById('uploadMenu').style.display = 'none';
  document.getElementById('fileInputMultiPdf')?.click();
});
document.addEventListener('click', () => {
  const menu = document.getElementById('uploadMenu');
  if (menu) menu.style.display = 'none';
});

// 多 PDF 合併
document.getElementById('fileInputMultiPdf')?.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  if (files.length === 1) {
    handleFiles(e.target.files, 'auto');
    return;
  }
  // 合併多個 PDF
  try {
    const { PDFDocument } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
    const merged = await PDFDocument.create();
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const doc = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const mergedBytes = await merged.save();
    const blob = new Blob([mergedBytes], { type: 'application/pdf' });
    const mergedFile = new File([blob], 'merged.pdf', { type: 'application/pdf' });
    handleFiles([mergedFile], 'auto');
  } catch (err) {
    alert('合併 PDF 失敗：' + err.message);
  }
  e.target.value = '';
});
document.getElementById('fileInputImage')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  // TODO: 圖片識別邏輯
  console.log('圖片上傳:', file.name);
  alert('圖片識別功能開發中：' + file.name);
  e.target.value = '';
});

// 計算機按鈕
document.getElementById('btnCalc')?.addEventListener('click', () => {
  const calcW = Math.min(1100, screen.availWidth * 0.7);
const calcH = Math.min(750, screen.availHeight * 0.7);
const calcL = window.screenX + Math.max(50, (window.outerWidth - calcW) / 2);
const calcT = window.screenY + Math.max(30, (window.outerHeight - calcH) / 3);
const w = window.open('calc.html', 'calc', 'width=' + calcW + ',height=' + calcH + ',left=' + calcL + ',top=' + calcT + ',resizable=yes,scrollbars=yes');
  if (!w) alert('請允許彈出視窗');
});
