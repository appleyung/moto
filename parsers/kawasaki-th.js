/* EPC V30.2 parser module: kawasaki-th — optional; app works if missing */
(function (global) {
  "use strict";
  global.EPC_BRAND = global.EPC_BRAND || {};

  var KAWASAKI_PART_REGEX = /(?:^|[^A-Z0-9])(\d{5}\s*-\s*\d{3,6}(?:\s*-\s*[A-Z0-9]{1,8})?|\d{3}[A-Z]{1,2}\d{4}[A-Z0-9]{0,4})(?=[^A-Z0-9]|$)/gi;
  function isValidKawasakiPartNo(p) {
    const s = normalizePartNo(p || '');
    if (!s || s.length < 7 || s.length > 16) return false;
    // 特殊：130BA0510
    if (/^\d{3}[A-Z]{1,2}\d{4}[A-Z0-9]{0,4}$/i.test(s)) return true;
    // 標準兩段／三段
    if (!/^\d{5}-\d{3,6}(-[A-Z0-9]{1,6})?$/i.test(s)) return false;
    const segs = s.split('-');
    // 拒絕黏上下一號：55028-0825-66056054（第三段過長純數字）
    if (segs[2]) {
      if (segs[2].length > 6) return false;
      if (/^\d{4,}$/.test(segs[2])) return false; // 色碼最多 3 位如 660
    }
    return true;
  }
  function sanitizeKawasakiKey(key) {
    const s = normalizePartNo(key || '');
    if (isValidKawasakiPartNo(s)) return s;
    // 55028-0825-66056054 → 試 55028-0825-660
    const m = s.match(/^(\d{5}-\d{3,6})(?:-([A-Z0-9]{1,6}))?/i);
    if (m) {
      const cand = m[2] && !/^\d{4,}$/.test(m[2]) ? m[1] + '-' + m[2] : m[1];
      if (isValidKawasakiPartNo(cand)) return cand;
      if (isValidKawasakiPartNo(m[1])) return m[1];
    }
    return s;
  }
  function kawasakiTableItems(items) {
    const list = (items || []).filter(it => it && it.transform && String(it.str || '').length);
    if (list.length < 8) return list;
    const xs = list.map(it => it.transform[4] || 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    if (maxX - minX < 50) return list;
    const cut = minX + (maxX - minX) * 0.28;
    const right = list.filter(it => (it.transform[4] || 0) >= cut);
    return right.length >= Math.max(6, list.length * 0.25) ? right : list;
  }
  function kawasakiTextRect(viewport, it) {
    const str = String(it.str || '');
    const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
    const x = tx[4];
    const y = tx[5];
    // 文字前進方向與垂直方向
    const hx = tx[0], hy = tx[1];
    const vx = tx[2], vy = tx[3];
    const hLen = Math.hypot(hx, hy) || 0.001;
    const vLen = Math.hypot(vx, vy) || 0.001;
    const fontH = vLen || ((it.height || 10) * viewport.scale) || 10;
    let textW = (it.width && it.width > 0) ? (it.width * (hLen / (it.transform && Math.hypot(it.transform[0], it.transform[1]) || 1))) : (str.length * fontH * 0.55);
    // 若 width 是未乘 viewport 的 PDF 單位
    if (it.width && it.width > 0 && textW < fontH * 0.5) {
      textW = it.width * viewport.scale;
    }
    textW = Math.min(Math.max(textW, fontH * 1.2), fontH * 16);
    // 四角
    const ux = hx / hLen, uy = hy / hLen;
    const nx = vx / vLen, ny = vy / vLen;
    // 基線往上一個字高
    const x0 = x - nx * fontH * 0.85;
    const y0 = y - ny * fontH * 0.85;
    const corners = [
      [x0, y0],
      [x0 + ux * textW, y0 + uy * textW],
      [x0 + ux * textW + nx * fontH * 1.15, y0 + uy * textW + ny * fontH * 1.15],
      [x0 + nx * fontH * 1.15, y0 + ny * fontH * 1.15]
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      minX = Math.min(minX, c[0]);
      minY = Math.min(minY, c[1]);
      maxX = Math.max(maxX, c[0]);
      maxY = Math.max(maxY, c[1]);
    }
    // 若幾乎是豎條且字串較長，強制加寬（橫向可讀零件號）
    let bw = maxX - minX, bh = maxY - minY;
    if (bh > bw * 2 && str.length >= 6) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      bw = Math.max(bw, fontH * Math.min(14, str.length * 0.55));
      bh = Math.max(fontH * 1.15, Math.min(bh, fontH * 1.4));
      minX = cx - bw / 2;
      minY = cy - bh / 2;
      maxX = minX + bw;
      maxY = minY + bh;
    }
    return { minX, minY, maxX, maxY, fontH, bw: maxX - minX, bh: maxY - minY };
  }
  function limitKawasakiTitle(fallback, body) {
    const b = String(body || '').replace(/^\s*[，,]\s*/, '').trim();
    if (!b) return fallback;
    const clipped = b.length > 30 ? b.slice(0, 30) : b;
    return `${fallback}，${clipped}`;
  }
  function extractTitleKawasaki(items, pageIndex, fallback) {
    const allText = (items || []).map(it => String(it.str || '')).join(' ');
    // 直接找 "This page covers:" 後的內容
    let m = allText.match(/This\s+page\s+covers\s*:?\s*([^\n|]{3,80})/i);
    if (m) {
      let title = m[1].replace(/\s+/g, ' ').trim();
      title = title.split(/\s+(Ref\.?\s*No|Part\s*No|Description|Quantity|GROUP)/i)[0].trim();
      title = title.replace(/[-–—\s,]+$/, '').trim();
      if (title.length >= 3 && title.length <= 70) return title;
    }
    // nospace 後備
    const ns = (items || []).map(it => String(it.str || '')).join('').replace(/\s+/g, '');
    m = ns.match(/Thispagecovers:?([A-Za-z(][^\d]{2,60}?)(?:Ref|Part|Description|Quantity|GROUP)/i);
    if (m) {
      let title = m[1].replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-–—]+/g, '-').trim();
      if (title.length >= 3) return title;
    }
    return fallback;
  }
  function parseKawasakiItems(items, pageCategory) {
    const pageKeys = [];
    const loc = (typeof kawasakiLocale !== 'undefined' && kawasakiLocale === 'th') ? 'th' : 'id';
    const allItems = (items || []).filter(it => it && it.transform && String(it.str || '').length);
    if (!allItems.length) return pageKeys;

    // 泰國版：若 pageCategory 空或是 GROUP NO，改用 extractTitleKawasaki
    if (loc === 'th' && (!pageCategory || /GROUP\s*NO/i.test(pageCategory) || pageCategory.length < 3)) {
      const tt = extractTitleKawasaki(items, 0, '');
      if (tt && tt.length >= 3 && !/^GROUP/i.test(tt)) pageCategory = tt;
    }

    // 泰國版直接用列解析（欄解析數量不準）
    if (loc === 'th') {
      // skip to row parser
    } else {
    // 偵測旋轉：零件號是否「同 X、Y 分散」→ 直欄版面（與 Honda 印尼類似）
    const probeParts = [];
    const probeRe = new RegExp(KAWASAKI_PART_REGEX.source, 'gi');
    for (const it of allItems) {
      const s = String(it.str || '').replace(/[－–—]/g, '-').replace(/\s+/g, '');
      probeRe.lastIndex = 0;
      const m = probeRe.exec(s);
      if (m) {
        const pno = normalizePartNo(m[1] || m[0]);
        if (isValidKawasakiPartNo(pno)) {
          probeParts.push({ x: it.transform[4] || 0, y: it.transform[5] || 0, pno, it });
        }
      }
    }
    let columnLayout = false;
    if (probeParts.length >= 3) {
      const xs = probeParts.map(p => p.x), ys = probeParts.map(p => p.y);
      const xRange = Math.max(...xs) - Math.min(...xs);
      const yRange = Math.max(...ys) - Math.min(...ys);
      columnLayout = xRange > yRange * 1.4;
    }

    // —— 旋轉／直欄：依 X 分欄，每欄為一列（項次→零件→品名→數量）——
    if (columnLayout && loc === 'id') {
      const snap = 5;
      const cols = new Map();
      for (const it of allItems) {
        const key = Math.round((it.transform[4] || 0) / snap) * snap;
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(it);
      }
      const seen = new Set();
      const colKeys = [...cols.keys()].sort((a, b) => a - b);
      for (const ck of colKeys) {
        const col = cols.get(ck).slice().sort((a, b) => (a.transform[5] || 0) - (b.transform[5] || 0));
        let itemNo = '';
        let partNo = '';
        let name = '';
        const qtys = [];
        let foundPart = false;
        for (const it of col) {
          const s = String(it.str || '').replace(/[－–—]/g, '-').trim();
          if (!s) continue;
          if (!foundPart && /^\d{1,5}[A-Z]?$/i.test(s) && s.length <= 6) {
            itemNo = s;
            continue;
          }
          const compact = s.replace(/\s+/g, '');
          probeRe.lastIndex = 0;
          const pm = probeRe.exec(compact);
          if (pm && !partNo) {
            const pno = normalizePartNo(pm[1] || pm[0]);
            if (isValidKawasakiPartNo(pno)) {
              partNo = pno;
              foundPart = true;
              let rest = compact.replace(pno, '').replace(/-/g, ' ').trim();
              if (/[A-Za-z]{3,}/.test(rest)) name = rest;
              continue;
            }
          }
          if (foundPart) {
            if (/^[1-9]\d{0,1}$/.test(s)) { qtys.push({ n: parseInt(s, 10), x: it.transform[4] || 0 }); continue; }
            if (/^[A-Za-z][A-Za-z0-9\-\/,=.#+\s]{2,}$/.test(s)) {
              name = name ? (name + ' ' + s) : s;
            }
          }
        }
        if (!partNo || seen.has(partNo)) continue;
        seen.add(partNo);
        name = (name || '').replace(/\s+/g, ' ').trim();
        if (!/[A-Za-z]{3,}/.test(name)) name = '';
        // 取最右的數字作為數量
        let qty = 1;
        if (qtys.length) {
          qtys.sort((a, b) => b.x - a.x);
          qty = qtys[0].n;
        }
        const dispName = name ? translateText(name) : '';
        if (!partInfoMap.has(partNo)) {
          partInfoMap.set(partNo, {
            name: dispName || '（無名稱）', rawName: dispName, qty: qty || 1,
            category: pageCategory || '未分類', itemNo: itemNo || ''
          });
        } else {
          const info = partInfoMap.get(partNo);
          if (dispName && (!info.name || info.name === '（無名稱）')) { info.name = dispName; info.rawName = dispName; }
          if (itemNo) info.itemNo = itemNo;
          if (qty >= 1) info.qty = qty;
        }
        if (!pageKeys.includes(partNo)) pageKeys.push(partNo);
      }
      // 不提早返回，讓列解析可更新數量
      // if (pageKeys.length >= 2) return pageKeys;
    }
    } // end else for non-Thai column parser

    // —— 一般橫列版面 ——
    let srcItems = loc === 'id' ? allItems : kawasakiTableItems(items);
    if (!srcItems.length) srcItems = allItems;
    const yTol = loc === 'id' ? 7 : 4.5;
    const sorted = srcItems.slice().sort((a, b) => {
      const dy = (b.transform[5] || 0) - (a.transform[5] || 0);
      if (Math.abs(dy) > yTol) return dy;
      return (a.transform[4] || 0) - (b.transform[4] || 0);
    });

    let fullText = '';
    let lastY = null, lastRight = null;
    for (const it of sorted) {
      const str = String(it.str || '').replace(/[－–—]/g, '-');
      if (!str) continue;
      const x = it.transform[4] || 0;
      const y = it.transform[5] || 0;
      const w = it.width || str.length * 4;
      if (fullText) {
        const sameLine = lastY != null && Math.abs(y - lastY) <= yTol;
        const prev = fullText.slice(-1);
        const glue = sameLine && /[A-Z0-9.-]/i.test(prev) && /[A-Z0-9.-]/i.test(str[0]);
        if (!glue) {
          if (!sameLine) fullText += '\n';
          else if (lastRight != null && x > lastRight + 1.2) fullText += ' ';
        }
      }
      fullText += str;
      lastY = y;
      lastRight = x + w;
    }

    const re = new RegExp(KAWASAKI_PART_REGEX.source, 'gi');
    const matches = [];
    let m;
    while ((m = re.exec(fullText)) !== null) {
      const raw = (m[1] || m[0]).replace(/^[^0-9]+/, '');
      const pno = normalizePartNo(raw);
      if (!isValidKawasakiPartNo(pno)) continue;
      matches.push({ pno, index: m.index, end: m.index + m[0].length });
    }
    matches.sort((a, b) => a.index - b.index || b.pno.length - a.pno.length);
    const seen = new Set();
    const finalMatches = [];
    for (const f of matches) {
      if (seen.has(f.pno)) continue;
      if ([...seen].some(s => s.startsWith(f.pno + '-'))) continue;
      for (let i = finalMatches.length - 1; i >= 0; i--) {
        if (f.pno.startsWith(finalMatches[i].pno) && f.pno.length > finalMatches[i].pno.length) {
          seen.delete(finalMatches[i].pno);
          finalMatches.splice(i, 1);
        }
      }
      seen.add(f.pno);
      finalMatches.push(f);
    }

    for (let mi = 0; mi < finalMatches.length; mi++) {
      const f = finalMatches[mi];
      const lineStart = fullText.lastIndexOf('\n', f.index) + 1;
      const lineEndIdx = fullText.indexOf('\n', f.end);
      const lineStr = fullText.slice(lineStart, lineEndIdx < 0 ? fullText.length : lineEndIdx);
      const before = fullText.slice(lineStart, f.index);
      let itemNo = '';
      const pref = f.pno.split('-')[0];
      const refAtStart = before.match(/^\s*(\d{2,5}[A-Z]?)\s+/i);
      if (refAtStart && (refAtStart[1] === pref || refAtStart[1].replace(/[A-Z]$/i, '') === pref)) {
        itemNo = refAtStart[1];
      } else if (/^\d{5}$/.test(pref)) itemNo = pref;

      let afterEnd = mi + 1 < finalMatches.length ? finalMatches[mi + 1].index : Math.min(fullText.length, f.end + 100);
      let after = fullText.slice(f.end, afterEnd);
      if (lineStr) {
        const li = lineStr.toUpperCase().indexOf(f.pno);
        if (li >= 0) after = lineStr.slice(li + f.pno.length);
      }
      after = after.replace(/^[-–]?[A-Z0-9]{1,8}(?=[^A-Z0-9]|$)/i, '').replace(/^[^A-Za-z\u0E00-\u0E7F]+/, '');
      after = after.split(/\d{5}\s*-\s*\d{3,6}/)[0].split('\n')[0];

      let qty = 1;
      try {
        const qtyCol = [];
        for (const it of allItems) {
          const x = it.transform[4] || 0;
          if (x < 700) continue;
          const s = String(it.str || '').trim();
          if (/^\d{1,2}$/.test(s)) {
            const n = parseInt(s, 10);
            if (n >= 1 && n <= 20) qtyCol.push({ n, y: it.transform[5] || 0 });
          }
        }
        let partY = null;
        const pref = f.pno.split('-')[0];
        for (const it of allItems) {
          const s = String(it.str || '').replace(/[－–—]/g, '-').replace(/\s+/g, '');
          const x = it.transform[4] || 0;
          if (x < 360 || x > 450) continue;
          if (s === f.pno || s.startsWith(pref + '-') || s === pref) {
            partY = it.transform[5];
            break;
          }
        }
        if (partY != null && qtyCol.length) {
          let best = null, bestDist = 15;
          for (const q of qtyCol) {
            const d = Math.abs(q.y - partY);
            if (d < bestDist) { bestDist = d; best = q; }
          }
          if (best) qty = best.n;
        }
      } catch (e) {}
      let name = '';
      const en = after.match(/[A-Za-z][A-Za-z0-9\-\/,=.#+\s]{2,60}/);
      if (en) {
        name = en[0].trim();
        const ti = name.search(/[\u0E00-\u0E7F]/);
        if (ti > 0) name = name.slice(0, ti).trim();
      }
      name = (name || '')
        .replace(/\b\d{5}-\d{3,6}(-[A-Z0-9]+)?\b/gi, '')
        .replace(/[A-Z]?\d{4,6}[A-Z]?/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (!/[A-Za-z]{3,}/.test(name)) name = '';

      const key = f.pno;
      const dispName = name ? translateText(name) : '';
      if (!partInfoMap.has(key)) {
        partInfoMap.set(key, {
          name: dispName || '（無名稱）', rawName: dispName, qty: qty || 1,
          category: pageCategory || '未分類', itemNo: itemNo || ''
        });
      } else {
        const info = partInfoMap.get(key);
        if (dispName && (!info.name || info.name === '（無名稱）')) { info.name = dispName; info.rawName = dispName; }
        if (itemNo) info.itemNo = itemNo;
        // 只在找到有效數量時更新（X>700 的數量欄）
        if (qty >= 1 && qty <= 20) info.qty = qty;
      }
      if (!pageKeys.includes(key)) pageKeys.push(key);
    }
    return pageKeys;
  }
  global.EPC_BRAND['kawasaki-th'] = {
    id: 'kawasaki-th',
    locale: 'th',
    KAWASAKI_PART_REGEX: typeof KAWASAKI_PART_REGEX !== "undefined" ? KAWASAKI_PART_REGEX : null,
    isValidKawasakiPartNo: typeof isValidKawasakiPartNo === "function" ? isValidKawasakiPartNo : null,
    sanitizeKawasakiKey: typeof sanitizeKawasakiKey === "function" ? sanitizeKawasakiKey : null,
    kawasakiTableItems: typeof kawasakiTableItems === "function" ? kawasakiTableItems : null,
    kawasakiTextRect: typeof kawasakiTextRect === "function" ? kawasakiTextRect : null,
    limitKawasakiTitle: typeof limitKawasakiTitle === "function" ? limitKawasakiTitle : null,
    extractTitleKawasaki: typeof extractTitleKawasaki === "function" ? extractTitleKawasaki : null,
    parseKawasakiItems: typeof parseKawasakiItems === "function" ? parseKawasakiItems : null,
    isValid: typeof isValidKawasakiPartNo === "function" ? isValidKawasakiPartNo : null,
    extractTitle: typeof extractTitleKawasaki === "function" ? extractTitleKawasaki : null,
    parseItems: typeof parseKawasakiItems === "function" ? parseKawasakiItems : null,
    PART_REGEX: typeof KAWASAKI_PART_REGEX !== "undefined" ? KAWASAKI_PART_REGEX : null,
    sanitize: typeof sanitizeKawasakiKey === "function" ? sanitizeKawasakiKey : null,
  };
  // Install globals only when missing — safe if another brand already defined shared names
  if (typeof global.KAWASAKI_PART_REGEX === "undefined" && typeof KAWASAKI_PART_REGEX !== "undefined") global.KAWASAKI_PART_REGEX = KAWASAKI_PART_REGEX;
  if (typeof global.isValidKawasakiPartNo === "undefined" && typeof isValidKawasakiPartNo === "function") global.isValidKawasakiPartNo = isValidKawasakiPartNo;
  if (typeof global.sanitizeKawasakiKey === "undefined" && typeof sanitizeKawasakiKey === "function") global.sanitizeKawasakiKey = sanitizeKawasakiKey;
  if (typeof global.kawasakiTableItems === "undefined" && typeof kawasakiTableItems === "function") global.kawasakiTableItems = kawasakiTableItems;
  if (typeof global.kawasakiTextRect === "undefined" && typeof kawasakiTextRect === "function") global.kawasakiTextRect = kawasakiTextRect;
  if (typeof global.limitKawasakiTitle === "undefined" && typeof limitKawasakiTitle === "function") global.limitKawasakiTitle = limitKawasakiTitle;
  if (typeof global.extractTitleKawasaki === "undefined" && typeof extractTitleKawasaki === "function") global.extractTitleKawasaki = extractTitleKawasaki;
  // Thai 版強制覆蓋（id.js 先載入）
  if (typeof parseKawasakiItems === "function") global.parseKawasakiItems = parseKawasakiItems;
})(typeof window !== "undefined" ? window : globalThis);

// Kawasaki Thailand: shift highlight left 50 and expand to cover full part number
(function () {
  if (typeof window === "undefined") return;
  window.EPC_BRAND = window.EPC_BRAND || {};
  const b = window.EPC_BRAND["kawasaki-th"];
  if (b) {
    b.highlightOffsetX = -50;
    b.highlightExpandLeft = 50;
  }
})();

// Kawasaki Thailand custom highlight: covers full part number including special format (130BA0512)
(function () {
  if (typeof window === "undefined") return;
  window.EPC_BRAND = window.EPC_BRAND || {};
  const b = window.EPC_BRAND["kawasaki-th"];
  if (!b) return;

  b.highlight = function (pageDiv, textContent, viewport, helpers) {
    if (!textContent || !textContent.items) return false;
    const { partInfoMap, pagePartKeys, bindPartEvent, normalizePartNo, pdfjsLib } = helpers || {};
    if (!pdfjsLib) return false;

    const items = (textContent.items || []).filter(it => it && it.transform && String(it.str || '').length);
    if (!items.length) return false;

    // Create highlight canvas
    const hlCanvas = document.createElement('canvas');
    hlCanvas.className = 'highlight-layer';
    hlCanvas.width = viewport.width;
    hlCanvas.height = viewport.height;
    hlCanvas.style.width = viewport.width + 'px';
    hlCanvas.style.height = viewport.height + 'px';
    pageDiv.appendChild(hlCanvas);
    const ctx = hlCanvas.getContext('2d');
    ctx.fillStyle = 'rgba(255, 235, 59, 0.45)';

    const pageIdx = parseInt(pageDiv.dataset.pageIndex, 10);
    const seen = new Set();
    const OFFSET_X = 0; // shift left to cover full part number

    // Patterns: standard 12046-0621 and special 130BA0512
    const reStd = /\d{5}\s*-\s*\d{3,6}(?:\s*-\s*[A-Z0-9]{1,6})?/gi;
    const reSpecial = /\d{3}[A-Z]{1,2}\d{4}[A-Z0-9]{0,4}/gi;

    // Group items by approximate Y (same row)
    const rows = new Map();
    for (const it of items) {
      const y = Math.round((it.transform[5] || 0) / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(it);
    }

    for (const [yKey, rowItems] of rows) {
      rowItems.sort((a, b) => (a.transform[4] || 0) - (b.transform[4] || 0));
      let concat = '';
      const pieces = [];
      for (const it of rowItems) {
        const s = String(it.str || '').replace(/[－–—]/g, '-');
        const start = concat.length;
        concat += s;
        pieces.push({ it, start, end: concat.length, s });
        // add space if gap
        const next = rowItems[rowItems.indexOf(it) + 1];
        if (next && (next.transform[4] || 0) > (it.transform[4] || 0) + (it.width || 20) + 2) {
          concat += ' ';
        }
      }

      // Find all part numbers in this row
      const matches = [];
      reStd.lastIndex = 0;
      let m;
      while ((m = reStd.exec(concat)) !== null) {
        matches.push({ raw: m[0], index: m.index, end: m.index + m[0].length, type: 'std' });
      }
      reSpecial.lastIndex = 0;
      while ((m = reSpecial.exec(concat)) !== null) {
        // avoid duplicates if already matched as part of std
        const already = matches.some(x => m.index >= x.index && m.index < x.end);
        if (!already) matches.push({ raw: m[0], index: m.index, end: m.index + m[0].length, type: 'special' });
      }

      for (const match of matches) {
        const key = normalizePartNo ? normalizePartNo(match.raw.replace(/\s+/g, '')) : match.raw.replace(/\s+/g, '').toUpperCase();
        if (!key || key.length < 7) continue;
        const dedupe = key + '@' + yKey;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);

        // Find the piece that contains the start of this match
        let originPiece = pieces[0];
        for (const p of pieces) {
          if (match.index >= p.start && match.index < p.end) { originPiece = p; break; }
        }
        if (!originPiece) continue;

        const tx = pdfjsLib.Util.transform(viewport.transform, originPiece.it.transform);
        const fontH = Math.hypot(tx[2], tx[3]) || ((originPiece.it.height || 10) * viewport.scale) || 12;
        const charW = fontH * 0.55;
        const bw = Math.max(charW * key.length, fontH * 4);
        const bh = Math.max(fontH * 1.0, 11);

        // Shift left by 50 to cover the first part of the part number
        const left = tx[4] + OFFSET_X;
        const top = tx[5] - bh * 0.75;

        ctx.fillRect(left, top, bw - 35, bh);

        const hit = document.createElement('div');
        hit.className = 'part-hit-box';
        hit.style.left = left + 'px';
        hit.style.top = top + 'px';
        hit.style.width = (bw - 35) + 'px';
        hit.style.height = bh  +'px';
        hit.dataset.partKey = key;
        pageDiv.appendChild(hit);
        if (bindPartEvent) bindPartEvent(hit, key);

        // Update partInfoMap
        if (partInfoMap) {
          if (!partInfoMap.has(key)) {
            partInfoMap.set(key, { name: '（無名稱）', qty: 1, category: '未分類', itemNo: '' });
          }
          // For special format (130BA0512), try to find itemNo from left column
          if (match.type === 'special' && !partInfoMap.get(key).itemNo) {
            // Look for a short alphanumeric to the left on same row
            for (const p of pieces) {
              if (p.end <= match.index) {
                const leftStr = p.s.trim();
                if (/^\d{1,4}[A-Z]?$/i.test(leftStr) && leftStr.length <= 5) {
                  partInfoMap.get(key).itemNo = leftStr.toUpperCase();
                  break;
                }
              }
            }
          }
        }
        if (pagePartKeys && !isNaN(pageIdx)) {
          let lst = pagePartKeys.get(pageIdx);
          if (!lst) { lst = []; pagePartKeys.set(pageIdx, lst); }
          if (!lst.includes(key)) lst.push(key);
        }
      }
    }
    return true; // handled
  };
})();
