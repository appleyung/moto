/* ============================================================
 * EPC V32 parser module: honda-id (修正版)
 * 職責：Honda Parts Manual (印尼規格)
 * 修正重點：
 *   1. 修復高亮座標：處理跨行/長段落解析，計算相對偏移量。
 *   2. 修復項次邏輯：強制從表格每一列的最左側抓取純數字作為 No. Ref.
 * ============================================================ */
(function (global) {
  "use strict";
  global.EPC_BRAND = global.EPC_BRAND || {};

  /* ================= 基礎工具 ================= */

  function norm(s) {
    return String(s || "")
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
      )
      .replace(/[－–—]/g, "-")
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  // Honda 零件號 Regex：鎖定 [數字組別]-[字母組別]-[車身號] (如: 12100-KIZ-T00)
  const HONDA_PART_REGEX = /\b([0-9]{3,5}[-–—][0-9A-Z]{2,4}[-–—][0-9A-Z]{1,4})\b/gi;

  function isValidHondaPartNo(p) {
    const s = norm(p);
    if (!s || s.length < 7) return false;
    // 確保格式正確 (數字段 - 字母段 - 車身號)
    const parts = s.split("-");
    if (parts.length >= 3 && !/^[0-9A-Z]+$/.test(parts[0])) return false;
    return true;
  }

  function cleanHondaName(name) {
    if (!name) return "";
    let result = String(name).trim();
    // 清洗 Indonesia 常見標頭
    result = result.replace(/^(CH\.?|FIG\.?|Item\s*\d+|Part\s*No)\s*/i, "").trim();
    return result || "";
  }

  function extractTitleHonda(items, pageIndex, fallback) {
    const allStr = (items || []).map((it) => String(it.str || "").trim()).filter(Boolean);
    const joined = allStr.join(" ");
    
    let m = joined.match(/(?:SECTION|GROUP|CH\.?|CHAPTER)\s*(\d+)\s*[-–—]?\s*([A-Za-z]{2,30})/i);
    if (m) return `第 ${pageIndex + 1} 頁，Section：${m[2]}`;

    m = joined.match(/(?:FIG\.?|Fig\.?)\s*([0-9\-]+)/i);
    if (m) return `${fallback}, FIG. ${m[1]}`;
    
    return fallback;
  }

  /* ================= 核心解析邏輯 ================= */
  const dataCache = new WeakMap();

  function processHondaData(items) {
    if (!items || !items.length) return [];
    if (dataCache.has(items)) return dataCache.get(items);
    
    const result = _processHondaDataImpl(items);
    dataCache.set(items, result);
    return result;
  }

  function _processHondaDataImpl(items) {
    /* --- 1. 過濾有效 text item --- */
    // 注意：印尼版表格通常被視為獨立的文字項目，或是長行。
    const validItems = [];
    for (const it of items) {
      const str = String(it.str || "").trim();
      if (!str) continue;
      
      // 過濾掉頁眉/頁腳的日期或標題 (通常 Y < 200)
      if (/^\d{1,2}$/.test(str) && it.transform[4] < 250) continue;

      validItems.push({
        str: str,
        x: it.transform[4], // X (左邊界)
        y: it.transform[5], // Y (頂部，通常原點在左上或左下視渲染器而定，這裡假設相對有效)
        w: it.width || (str.length * 6),
        h: Math.abs(it.transform[3] || 10),
      });
    }

    /* --- 2. 找出所有 Honda 零件號 --- */
    const partMatches = [];
    for (const item of validItems) {
      HONDA_PART_REGEX.lastIndex = 0;
      let m;
      while ((m = HONDA_PART_REGEX.exec(item.str)) !== null) {
        if (!isValidHondaPartNo(m[0])) continue;

        // [修正] 座標計算：因為一行可能有很多零件，必須算出該零件在「當前文字項目」中的相對位置
        const prefixLen = item.str.indexOf(m[0]);
        // 估算每個字元的寬度，乘以索引得到 x 偏移
        const charWidth = item.w / Math.max(item.str.length, 1);
        
        partMatches.push({
          partNo: norm(m[0]),
          x: item.x + prefixLen * charWidth, // 絕對 X 座標
          y: item.y,                        // Y 座標 (同一行通常 Y 差異極小)
          w: m[0].length * charWidth,       // 估算寬度
          h: item.h,
        });
      }
    }

    /* --- 3. 逐列配對 (Row Processing) --- */
    partMatches.sort((a, b) => b.y - a.y); // 由上往下排序 (假設 Y 向下增加或根據渲染器調整)
    const parts = [];
    
    for (let i = 0; i < partMatches.length; i++) {
      const pm = partMatches[i];

      // 取得同一列 (Row) 的所有素材：Y 座標差距在 15px 內視為同一行表格
      const rowItems = validItems.filter((v) => Math.abs(v.y - pm.y) < 15);

      /* [修正] 項次 (No. Ref.) 修復邏輯 */
      let itemNo = "";
      let minX = Infinity;
      
      // 掃描同一行所有項目，找「最左邊」且是「純數字」的項目作為 No. Ref.
      for (const v of rowItems) {
         if (v.x < minX && /^[0-9]+$/.test(v.str.trim())) {
           minX = v.x;
           itemNo = v.str.trim();
         }
      }

      let qty = 1;
      const nameCandidates = [];

      // 收集名稱與數量 (零件號右側的項目)
      for (const v of rowItems) {
        const dx = v.x - pm.x; // 相對於零件號的水平距離

        if (dx > 0 && /^[0-9]{1,2}$/.test(v.str)) {
            // 數量通常在右側且數字較小
            qty = parseInt(v.str, 10); 
        } 
        
        nameCandidates.push({ x: v.x, str: v.str });
      }

      // 如果該列沒有抓到項次 (例如表格第一欄是空的)，沿用上一列的項次
      if (!itemNo) itemNo = parts.length > 0 ? parts[parts.length - 1].itemNo : "";

      /* [修正] 名稱清洗 */
      nameCandidates.sort((a, b) => a.x - b.x); // 由左至右
      let nameStrs = [];
      for (const c of nameCandidates) {
        if (c.x > pm.x + 5 && !/^\d{1,2}$/.test(c.str)) { // 過濾掉零件號本身與數量
            nameStrs.push(c.str);
        }
      }
      
      let name = cleanHondaName(nameStrs.join(" "));
      if (!name) continue;

      parts.push({
        partNo: pm.partNo,
        name: name,
        qty: qty,
        itemNo: itemNo, // 現在會是正確的 Ref. No.
        _x: pm.x,
        _y: pm.y,
        _w: pm.w,
        _h: pm.h,
      });
    }

    return parts;
  }

  /* ================= 對外介面 ================= */
  function parseItems(items, pageIndex) {
    const parts = processHondaData(items || []);
    const title = extractTitleHonda(items || [], pageIndex, `第 ${pageIndex + 1} 頁`);
    return { keys: parts.map(p => p.partNo), parts: parts.map(p => ({ ...p, category: title })), title };
  }

  function highlightHonda(pageDiv, textContent, viewport) {
    const items = (textContent && textContent.items) || [];
    const parts = processHondaData(items);
    // 確保座標有效才繪製
    const hits = parts.filter(p => isFinite(p._x) && isFinite(p._y)).map(p => ({
      partNo: p.partNo, x: p._x, y: p._y, width: Math.max(p._w, 20), height: p._h
    }));
    return hits;
  }

  global.isValidHondaPartNo = isValidHondaPartNo;
  
  /* ================= 註冊模組 ================= */
  global.EPC_BRAND["honda-id"] = {
    id: "honda-id",
    isValid: isValidHondaPartNo,
    extractTitle: extractTitleHonda,
    parseItems: parseItems,
    highlight: highlightHonda,
    detect: function () { return 80; },
  };

})(typeof window !== "undefined" ? window : globalThis);