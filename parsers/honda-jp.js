/* ============================================================
 * EPC V32 parser module: honda-jp (修正版)
 * 職責：Honda Parts Manual (日規/日本規格)
 * 
 * 修正重點：
 * 1. 修復項次抓取：針對表格結構，從零件號左側指定範圍內尋找純數字。
 * 2. 修復高亮座標：使用相對偏移量計算，避免 PDF 解析細碎導致的高亮偏移。
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

  // Honda Japan Regex: 3-5 數字 (組別) - 2-4 字母/數字 (次組別) - 1-4 字母/數字 (車身號)
  // 範例：12100-K0S-V00, 90109-KJZ-J00
  const HONDA_PART_REGEX = /\b([0-9]{3,5}[-–—][0-9A-Z]{2,4}[-–—][0-9A-Z]{1,4})\b/gi;

  function isValidHondaPartNo(p) {
    const s = norm(p);
    if (!s || s.length < 7) return false;
    // Honda 零件碼通常第一段是 3~5 位數字 (如 12100, 90109)
    const parts = s.split("-");
    if (!/^[0-9]{3,5}$/.test(parts[0])) return false;
    return true;
  }

  function cleanHondaName(name) {
    if (!name) return "";
    let result = String(name).trim();
    // 清洗常見的日文 EPC 標頭
    result = result.replace(/^(第.*章|項次|品番)\s*/i, "").trim();
    return result || "";
  }

  function extractTitleHonda(items, pageIndex, fallback) {
    const allStr = (items || []).map((it) => String(it.str || "").trim()).filter(Boolean);
    const joined = allStr.join(" ");

    // Honda JP 常見標題格式：E-6 シリンダー, CHAPTER. X-X
    let m = joined.match(/(?:CH\.?|CHAPTER|図式)\s*([0-9\-]+)\s*[\-\-]?\s*([\u4e00-\u9fff\u3040-\u30ffA-Za-z]+)/i);
    if (m) return `${fallback}，圖式：${m[1]} ${m[2]}`;

    m = joined.match(/(?:FIG\.?|Fig\.?)\s*([0-9\-]+)/i);
    if (m) return `${fallback}，圖號 FIG.${m[1]}`;

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
    const validItems = [];
    for (const it of items) {
      const str = String(it.str || "").trim();
      if (!str) continue;
      
      // 排除頁眉/頁腳的日期或章節名 (通常 Y < 200 且在頁首)
      if (/^\d{1,2}$/.test(str) && it.transform[4] < 250) continue;

      validItems.push({
        str: str,
        x: it.transform[4], 
        y: it.transform[5], // PDF 座標系統：通常左上角是原點，Y 向下增加
        w: it.width || (str.length * 6),
        h: Math.abs(it.transform[3] || 10),
      });
    }

    /* --- 2. 找出所有 Honda 零件號並計算相對座標 --- */
    const partMatches = [];
    
    // 為了提高準確度，先過濾掉明顯不是表格行的項目 (例如標題行)
    const tableItems = validItems.filter(item => item.y > 100); 

    for (const item of tableItems) {
      HONDA_PART_REGEX.lastIndex = 0;
      let m;
      while ((m = HONDA_PART_REGEX.exec(item.str)) !== null) {
        if (!isValidHondaPartNo(m[0])) continue;

        // [修正] 座標計算：精確計算零件號在當前 Text Item 中的絕對位置
        const prefixLen = item.str.indexOf(m[0]);
        // 估算字元寬度，處理 PDF 字型不定寬的問題
        const charWidth = item.w / Math.max(item.str.length, 1);
        
        partMatches.push({
          partNo: norm(m[0]),
          x: item.x + prefixLen * charWidth, 
          y: item.y,
          w: m[0].length * charWidth,
          h: item.h,
        });
      }
    }

    /* --- 3. 逐列配對 (Row Processing) --- */
    partMatches.sort((a, b) => b.y - a.y); // Y 座標大的在下方 (視 PDF 原點而定，通常 EPC Y 是向下的)
    const parts = [];
    
    for (let i = 0; i < partMatches.length; i++) {
      const pm = partMatches[i];

      // 取得同一列 (Row) 的所有素材：Y 座標差距在 20px 內視為同一行表格
      const rowItems = validItems.filter((v) => Math.abs(v.y - pm.y) < 20);

      /* [修正] 項次 (No. Ref.) 抓取邏輯 */
      // Honda EPC 的項次通常都在零件號左側，且與零件號有明顯間距。
      // 我們設定一個「項次搜尋區間」：在零件號 X 座標左方 150px 以內。
      let itemNo = "";
      let bestRefX = -1;

      for (const v of rowItems) {
        const dx = pm.x - v.x; // 距離零件號有多遠
        if (dx > 0 && dx < 200 && /^[0-9]+$/.test(v.str)) {
           // 如果找到數字，且它比之前找到的更靠左 (通常表格項次也是排序好的)
           // 但為了穩健，我們取最靠近零件號左側的數字作為項次
           if (bestRefX < v.x) {
             bestRefX = v.x;
             itemNo = v.str;
           }
        }
      }

      // 如果本行沒有抓到項次 (例如分解圖標籤)，則沿用上一列項次 (合併儲存格情境)
      if (!itemNo) {
        itemNo = parts.length > 0 ? parts[parts.length - 1].itemNo : "1";
      }

      // 提取數量與名稱 (通常在零件號右側)
      let qty = 1;
      const nameCandidates = [];
      
      for (const v of rowItems) {
        const dx = v.x - pm.x; // 相對於零件號的距離
        
        if (dx > 0 && /^[0-9]{1,3}$/.test(v.str)) {
          qty = parseInt(v.str, 10); 
        } 
        
        nameCandidates.push({ x: v.x, str: v.str });
      }

      /* [修正] 名稱拼接 */
      // 過濾掉零件號本身 (dx < 2) 和項次 (位於左側) 以及數量
      nameCandidates.sort((a, b) => a.x - b.x);
      let nameStrs = [];
      
      for (const c of nameCandidates) {
        const dx = c.x - pm.x;
        // 只取零件號右側且非數字的內容作為名稱
        if (dx > 2 && !/^[0-9]{1,3}$/.test(c.str)) {
           nameStrs.push(c.str);
        }
      }

      let name = cleanHondaName(nameStrs.join(" "));
      if (!name) continue; // 如果沒有名稱，捨棄該項目以避免污染清單

      parts.push({
        partNo: pm.partNo,
        name: name,
        qty: qty,
        itemNo: itemNo, // 現在應該能抓到正確的 No. Ref. 了
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
    // 確保座標在有效範圍內才繪製
    const hits = parts.filter(p => isFinite(p._x) && isFinite(p._y)).map(p => ({
      partNo: p.partNo, x: p._x, y: p._y, width: Math.max(p._w, 20), height: p._h
    }));
    return hits;
  }

  global.isValidHondaPartNo = isValidHondaPartNo;
  
  /* ================= 註冊模組 ================= */
  global.EPC_BRAND["honda-jp"] = {
    id: "honda-jp",
    isValid: isValidHondaPartNo,
    extractTitle: extractTitleHonda,
    parseItems: parseItems,
    highlight: highlightHonda,
    detect: function () { return 80; },
  };

})(typeof window !== "undefined" ? window : globalThis);