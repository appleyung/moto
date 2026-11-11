/* EPC V30.2 parser module: honda-jp — optional; app works if missing */
(function (global) {
  "use strict";
  global.EPC_BRAND = global.EPC_BRAND || {};

  var HONDA_PART_REGEX = /\b\d{5}\s*[-－–—]\s*[A-Z0-9]{2,5}\s*[-－–—]\s*[A-Z0-9]{2,5}\b|\b\d{5}\s*[-－–—]\s*[A-Z0-9]{5}\b/gi;
  function isValidHondaPartNo(pno) {
    if (!pno) return false;
    const s = String(pno).replace(/\s+/g, '').toUpperCase();
    if (!/^\d{5}-[A-Z0-9]{2,5}-[A-Z0-9]{2,5}$/.test(s) && !/^\d{5}-[A-Z0-9]{5}$/.test(s)) return false;
    if (s.length < 11 || s.length > 22) return false;
    return true;
  }
  function isJapaneseTitleJunk(s) {
    if (!s) return true;
    const t = String(s).replace(/[()（）\s]/g, '');
    return /関連|見出|番号|使用個数|使用|個数|部品名|部品番号|適用|号機|タイプ|初号|終号|頁|ページ|参照|注記|備考|索引|INDEX|GROUP|希望小売|価格/i.test(t);
  }
  function extractTitleJapanese(items, pageIndex, fallback) {
    const rows = items.filter(it => it && String(it.str || '').trim() && it.transform).map(it => {
      const str = String(it.str).trim();
      const tr = it.transform;
      const h = Math.hypot(tr[2], tr[3]) || (it.height || 0) || 8;
      return { str, x: tr[4], y: tr[5], h };
    });
    if (!rows.length) return fallback;
    const joined = rows.map(r => r.str).join(' ');

    let code = '';
    let codeRow = null;
    for (const r of rows) {
      const cm = r.str.match(/([EF]-\d{1,3}(?:-\d{1,3})?)/i);
      if (cm) { code = cm[1].toUpperCase(); codeRow = r; break; }
    }

    let best = { sc: -1, text: '' };
    const maxH = Math.max(...rows.map(r => r.h), 1);

    const scoreJa = (s, h, near) => {
      if (!s || s.length < 2 || s.length > 40) return -1;
      if (isJapaneseTitleJunk(s)) return -1;
      if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(s)) return -1;
      let sc = s.length + 50;
      if (/^[\u30a0-\u30ffー\u4e00-\u9fff\/\s]+$/.test(s)) sc += 40;
      if (h >= 11) sc += 20;
      if (h >= maxH * 0.85) sc += 25;
      if (near) sc += 40;
      if (/\//.test(s)) sc += 15; // リヤー… / ライセンス…
      if (/[()（）]/.test(s)) sc -= 50;
      return sc;
    };

    for (const r of rows) {
      let s = r.str.replace(/\s+/g, ' ').trim();
      s = s.replace(/\b[EF]-\d{1,3}(?:-\d{1,3})?\b/gi, '').replace(/[()（）]/g, ' ').trim();
      if (!s) continue;
      const near = codeRow && (
        Math.abs(r.y - codeRow.y) < 18 || Math.abs(r.x - codeRow.x) < 18 ||
        (Math.abs(r.y - codeRow.y) < 55 && Math.abs(r.x - codeRow.x) < 350)
      );
      const sc = scoreJa(s, r.h, near);
      if (sc > best.sc) best = { sc, text: s };
    }

    // 合併相鄰日文碎片（PDF 常把標題拆開）
    if (codeRow) {
      const nearRows = rows.filter(r =>
        Math.abs(r.y - codeRow.y) < 20 || (Math.abs(r.y - codeRow.y) < 60 && Math.abs(r.x - codeRow.x) < 400)
      ).sort((a, b) => a.x - b.x || a.y - b.y);
      let merged = '';
      for (const r of nearRows) {
        const p = r.str.replace(/\b[EF]-\d{1,3}(?:-\d{1,3})?\b/gi, '').trim();
        if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(p) && !isJapaneseTitleJunk(p)) merged += p;
      }
      merged = merged.replace(/\s+/g, '').trim();
      if (merged.length >= 3) {
        const sc = scoreJa(merged, 14, true) + 30;
        if (sc > best.sc) best = { sc, text: merged };
      }
    }

    // 整串：F-38-10リヤーコンビネーションライト
    const compact = joined.replace(/\s+/g, '');
    let m;
    const re = /([EF]-\d{1,3}(?:-\d{1,3})?)([\u3040-\u30ff\u4e00-\u9fff][\u3040-\u30ff\u4e00-\u9fffー\/]{2,36})/g;
    while ((m = re.exec(compact)) !== null) {
      let tp = m[2];
      if (isJapaneseTitleJunk(tp)) continue;
      // 斜線標題只取前段較完整者也可保留全段
      const sc = scoreJa(tp, 14, true) + 25;
      if (sc > best.sc) {
        best = { sc, text: tp };
        if (!code) code = m[1].toUpperCase();
      }
    }

    if (code && best.text && best.sc >= 0 && !isJapaneseTitleJunk(best.text)) return `${fallback}，${code} ${best.text}`;
    if (code) return `${fallback}，${code}`;
    return fallback;
  }
  global.EPC_BRAND['honda-jp'] = {
    id: 'honda-jp',
    locale: 'jp',
    HONDA_PART_REGEX: typeof HONDA_PART_REGEX !== "undefined" ? HONDA_PART_REGEX : null,
    isValidHondaPartNo: typeof isValidHondaPartNo === "function" ? isValidHondaPartNo : null,
    isJapaneseTitleJunk: typeof isJapaneseTitleJunk === "function" ? isJapaneseTitleJunk : null,
    extractTitleJapanese: typeof extractTitleJapanese === "function" ? extractTitleJapanese : null,
    isValid: typeof isValidHondaPartNo === "function" ? isValidHondaPartNo : null,
    PART_REGEX: typeof HONDA_PART_REGEX !== "undefined" ? HONDA_PART_REGEX : null,
    extractTitle: typeof extractTitleJapanese === "function" ? extractTitleJapanese : null,
  };
  // Install globals only when missing — safe if another brand already defined shared names
  if (typeof global.HONDA_PART_REGEX === "undefined" && typeof HONDA_PART_REGEX !== "undefined") global.HONDA_PART_REGEX = HONDA_PART_REGEX;
  if (typeof global.isValidHondaPartNo === "undefined" && typeof isValidHondaPartNo === "function") global.isValidHondaPartNo = isValidHondaPartNo;
  if (typeof global.isJapaneseTitleJunk === "undefined" && typeof isJapaneseTitleJunk === "function") global.isJapaneseTitleJunk = isJapaneseTitleJunk;
  if (typeof global.extractTitleJapanese === "undefined" && typeof extractTitleJapanese === "function") global.extractTitleJapanese = extractTitleJapanese;
})(typeof window !== "undefined" ? window : globalThis);
