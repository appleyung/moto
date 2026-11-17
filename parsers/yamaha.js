/* ============================================================
 * EPC V31 parser module: yamaha
 * 職責：只做「文字解析 + 座標回傳」
 *   - parseItems(items, pageIndex) → { keys, parts, title }
 *   - extractTitle(items, pageIndex, fallback) → string
 *   - highlight(pageDiv, textContent, viewport) → [{ partNo, x, y, width, height }]
 *   - isValid(str) → boolean
 * 座標語意：一律為 PDF 原始座標（未乘 scale、未反轉 Y）
 * 繪製、互動、DOM 操作：全部由 app.js 負責
 * ============================================================ */
(function (global) {
  "use strict";
  global.EPC_BRAND = global.EPC_BRAND || {};

  /* ================= 基礎工具 ================= */

  /**
   * 正規化零件號：
   *   全形 → 半形、破折號統一為 '-'、去空白、轉大寫
   * 與 app.js 的 normalizePartNo() 完全一致
   */
  function norm(s) {
    return String(s || '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[－–—]/g, '-')
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  /**
   * Yamaha 零件號 regex：
   *   2~5 碼英數 + '-' + 3~6 碼英數 + 可選 1~2 段（每段 1~3 碼）
   * 例：5VY-1111-00、1WS-F3100-00、2C0-12100-01
   */
  const YAMAHA_PART_REGEX = /[0-9A-Z]{2,5}[－–—-][0-9A-Z]{3,6}(?:[－–—-][0-9A-Z]{2,5}){0,2}/gi;

  /**
   * 判斷是否為合法 Yamaha 零件號
   */
  function isValidYamahaPartNo(p) {
    const s = norm(p);
    if (!s || s.length < 7) return false;
    if (!/^[0-9A-Z]{2,5}-[0-9A-Z]{3,6}(-[0-9A-Z]{2,5}){0,2}$/.test(s)) return false;
    const parts = s.split('-');
    // 首段若為 1~2 位純數字，視為項次而非零件號開頭
    if (/^\d{1,2}$/.test(parts[0])) return false;
    return true;
  }

  /**
   * 清理零件名稱：
   *   去掉開頭的零件號、常見表頭字樣、前導標點
   */
  function cleanYamahaName(name, partNo) {
    if (!name) return '';
    let result = String(name).trim();
    const key = norm(partNo);
    if (key && result.toUpperCase().startsWith(key)) {
      result = result.substring(key.length).trim();
    }
    result = result
      .replace(/Model Name|Product Code|Colour Type|項次|部品番號|部品名稱|備註|數量|Qty|Ref|Description|Part No|Remarks|DR31/gi, '')
      .trim();
    result = result.replace(/^[\s\-.:：.、\d]+/, '').trim();
    return result || '';
  }

  /* ================= 標題擷取 ================= */

  function extractTitleYamaha(items, pageIndex, fallback) {
    const allStr = (items || [])
      .map(it => String(it.str || '').trim())
      .filter(Boolean);
    const joined = allStr.join(' ');

    // 優先：FIG.xx 加上後續標題文字
    let m = joined.match(/(?:FIG\.?|Fig\.?)\s*(\d+)\s*([\u4e00-\u9fff\u3040-\u30ffA-Za-z][^\n]{0,36})/i);
    if (m) {
      let title = m[2].replace(/\s+/g, ' ').trim();
      title = title
        .replace(/(Model Name|Product Code|Colour Type|項次|部品番號|部品名稱|備註|數量|Qty|Ref|Description|Part No|Remarks).*$/i, '')
        .trim();
      return title ? `${fallback}，FIG.${m[1]} ${title}` : `${fallback}，FIG.${m[1]}`;
    }

    // 次選：只有 FIG.xx
    m = joined.match(/(?:FIG\.?|Fig\.?)\s*(\d+)/i);
    if (m) return `${fallback}，FIG.${m[1]}`;

    return fallback;
  }

  /* ================= 核心解析（帶 WeakMap 快取） ================= */

  /**
   * 快取：items 陣列 → 解析後的 parts
   * app.js 的 parseItems 與 highlight 若傳入同一個 items 引用，只計算一次
   */
  const dataCache = new WeakMap();

  function processYamahaData(items) {
    if (!items || !items.length) return [];
    if (dataCache.has(items)) return dataCache.get(items);
    const result = _processYamahaDataImpl(items);
    dataCache.set(items, result);
    return result;
  }

  /**
   * 實際解析邏輯（不改動原演算法，僅整理結構）
   */
  function _processYamahaDataImpl(items) {
    /* --- 1. 過濾有效 text item（排除項次欄的 1~2 位數字） --- */
    const validItems = [];
    for (const it of items) {
      const str = String(it.str || '').trim();
      if (!str) continue;
      if (/^\d{1,2}$/.test(str) && it.transform[4] < 250) continue;
      validItems.push({
        str: str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || (str.length * 6),
        h: Math.abs(it.transform[3] || 10)
      });
    }

    /* --- 2. 找出所有零件號（含座標） --- */
    const partMatches = [];
    for (const item of validItems) {
      YAMAHA_PART_REGEX.lastIndex = 0;
      let m;
      while ((m = YAMAHA_PART_REGEX.exec(item.str)) !== null) {
        if (!isValidYamahaPartNo(m[0])) continue;

        // 嘗試從同一 item 開頭抓項次（例："12 5VY-1111-00" → itemNo=12）
        let itemNo = '';
        const prefixMatch = item.str.match(/^(\d{1,2})\s*([0-9A-Z]{2,5}-)/i);
        if (prefixMatch) itemNo = prefixMatch[1];
        let adjX = item.x;
        let adjW = item.w;
        if(itemNo){
	        const prefixLen = itemNo.length + 1;
	        const charW = item.w / Math.max(item.str.length, 1);
	        adjX = item.x + prefixLen * charW;
	        adjW = Math.max(item.w - prefixLen * charW, 20);
        }
        partMatches.push({
          partNo: norm(m[0]),
          x: adjX,
          y: item.y,
          w: adjW,
          h: item.h,
          extractedItemNo: itemNo
        });
      }
    }

    /* --- 3. 依 Y 座標由上往下排序，逐列配對名稱與數量 --- */
    partMatches.sort((a, b) => b.y - a.y);
    const parts = [];
    let lastItemNo = '';

    for (let i = 0; i < partMatches.length; i++) {
      const pm = partMatches[i];
      const nextPm = partMatches[i + 1];

      // 該列的 Y 下界：取「下一列 Y 與本列 Y 的中點」；最後一列則往下 20
      const lowerBound = nextPm ? (pm.y + nextPm.y) / 2 : pm.y - 20;

      let itemNo = pm.extractedItemNo;
      let qty = 1;
      const nameCandidates = [];

      // 取同一列的所有 text item
      const rowItems = validItems.filter(v => v.y <= pm.y + 8 && v.y > lowerBound);

      for (const v of rowItems) {
        const dx = v.x - pm.x;

        // 左側：項次（例：「12」）
        if (!itemNo && dx < -5 && dx >= -150) {
          if (/^\d{1,2}$/.test(v.str)) itemNo = v.str;
        }
        // 右側：名稱或數量
        else if (dx > 0) {
          if (/Model Name|Product Code|Colour Type|DR31/i.test(v.str)) break;

          if (dx < 180 && !/^[\-\_\=\+\|\.\s]+$/.test(v.str) && !/^\d{1,2}$/.test(v.str)) {
            nameCandidates.push({ x: v.x, str: v.str });
          } else if (dx >= 180 && /^\d{1,2}$/.test(v.str)) {
            qty = parseInt(v.str, 10) || 1;
          }
        }
      }

      // 項次沿用上一列（合併儲存格情境）
      if (itemNo) lastItemNo = itemNo;
      else itemNo = lastItemNo;

      // 名稱：依 X 座標由左至右拼接
      nameCandidates.sort((a, b) => a.x - b.x);
      const nameStrs = [];
      for (const c of nameCandidates) {
        if (!/^\d{1,2}$/.test(c.str)) nameStrs.push(c.str);
      }
      let name = nameStrs.join(' ').trim();
      name = cleanYamahaName(name, pm.partNo);

      // 無項次 → 視為非零件列
      if (!itemNo) continue;
      // 無名稱且項次非本列自帶 → 視為跨列殘留
      if (!name && itemNo !== pm.extractedItemNo) continue;

      parts.push({
        partNo: pm.partNo,
        name: name || '（無名稱）',
        qty: qty,
        itemNo: itemNo,
        _x: pm.x,
        _y: pm.y,
        _w: pm.w,
        _h: pm.h
      });
    }

    /* --- 4. 依項次數字排序 --- */
    parts.sort((a, b) => (parseInt(a.itemNo, 10) || 999) - (parseInt(b.itemNo, 10) || 999));
    return parts;
  }

  /* ================= 對外介面 ================= */

  /**
   * 解析單頁：
   *   回傳 { keys, parts, title }
   *   parts 每項含 partNo / name / qty / itemNo / _x / _y / _w / _h / category
   */
  function parseItems(items, pageIndex) {
    const parts = processYamahaData(items || []);
    const title = extractTitleYamaha(items || [], pageIndex, `第 ${pageIndex + 1} 頁`);

    const partsWithCategory = parts.map(p => ({
      ...p,
      category: title
    }));

    const keys = partsWithCategory.map(p => p.partNo);
    return { keys, parts: partsWithCategory, title };
  }

  /**
   * 高亮：只回傳 hits，不碰 DOM
   *   每個 hit：{ partNo, x, y, width, height }
   *   x/y/width/height 為 PDF 原始座標
   *   app.js 負責乘 viewport.scale、Y 軸反轉、畫 canvas、建 hit-box
   */
  function highlightYamaha(pageDiv, textContent, viewport) {
    const items = (textContent && textContent.items) || [];
    // 與 parseItems 共用同一份快取，避免重複計算
    const parts = processYamahaData(items);

    const hits = [];
    for (const p of parts) {
      if (!p.partNo) continue;
      if (!isFinite(p._x) || !isFinite(p._y) || !isFinite(p._w) || !isFinite(p._h)) continue;

      hits.push({
        partNo: p.partNo,
        x: p._x,
        y: p._y,
        width: p._w + 2,   // 微幅外擴，視覺上更貼合
        height: p._h - 2   // 微幅內縮，避免與下一列重疊
      });
    }
    return hits;
  }

  /* ================= 全域註冊 ================= */

  global.isValidYamahaPartNo = isValidYamahaPartNo;
  global.preferCompleteYamahaKey = function () { return true; };

  global.EPC_BRAND['yamaha'] = {
    id: 'yamaha',
    isValid: isValidYamahaPartNo,
    isValidYamahaPartNo: isValidYamahaPartNo,
    preferCompleteYamahaKey: global.preferCompleteYamahaKey,
    extractTitle: extractTitleYamaha,
    extractTitleYamaha: extractTitleYamaha,
    cleanName: cleanYamahaName,
    parseItems: parseItems,
    highlight: highlightYamaha,
    // 供 app.js 的 detectManualKind 使用（若未來需要）
    detect: function () { return 100; }
  };
})(typeof window !== 'undefined' ? window : globalThis);