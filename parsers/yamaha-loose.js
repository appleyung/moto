/* EPC V30.23 parser: yamaha-loose — Yamaha 零散手冊（XMAX 等） */
(function (global) {
  "use strict";
  global.EPC_BRAND = global.EPC_BRAND || {};

  // Yamaha 零散手冊零件號：B74-E2170-00, 93210-12B01, 5VY-11654-01
  var YAMAHA_LOOSE_REGEX = /\b(?:[0-9A-Z]{3,5}-[0-9A-Z]{4,6}-[0-9A-Z]{2}|[0-9]{5}-[0-9]{5})\b/gi;

  function isValidYamahaLoosePartNo(p) {
    const s = String(p || '').replace(/\s+/g, '').toUpperCase();
    if (!s || s.length < 8) return false;
    if (/^[0-9A-Z]{3,5}-[0-9A-Z]{4,6}-[0-9A-Z]{2}$/.test(s)) return true;
    if (/^[0-9]{5}-[0-9]{5}$/.test(s)) return true;
    return false;
  }

  function extractTitleYamahaLoose(items, pageIndex, fallback) {
    const allStr = (items || []).map(it => String(it.str || '').trim()).filter(Boolean);
    const joined = allStr.join(' ');
    // Fig. 04 CAMSHAFT & CHAIN
    let m = joined.match(/Fig\.?\s*(\d+)\s+([A-Z][A-Z\s&]{2,30})/i);
    if (m) return `${fallback}，Fig.${m[1]} ${m[2].trim()}`;
    return fallback;
  }

  function parseYamahaLooseItems(textContent, pageIndex) {
    const items = (textContent && textContent.items) || [];
    const results = [];
    const seen = new Set();

    // 收集所有文字項
    const allItems = items.filter(it => it && it.str && it.transform);

    // 找零件號
    for (const it of allItems) {
      const s = String(it.str || '').replace(/\s+/g, '').toUpperCase();
      YAMAHA_LOOSE_REGEX.lastIndex = 0;
      let m;
      while ((m = YAMAHA_LOOSE_REGEX.exec(s)) !== null) {
        const pno = m[0];
        if (!isValidYamahaLoosePartNo(pno) || seen.has(pno)) continue;
        seen.add(pno);

        const partX = it.transform[4] || 0;
        const partY = it.transform[5] || 0;

        // 找項次（左邊 X < partX 的數字，Y 接近）
        let itemNo = '';
        let bestDist = 999;
        for (const it2 of allItems) {
          const x2 = it2.transform[4] || 0;
          const y2 = it2.transform[5] || 0;
          if (x2 >= partX - 5) continue;
          if (x2 < partX - 80) continue;
          const yDiff = Math.abs(y2 - partY);
          if (yDiff > 6) continue;
          const s2 = String(it2.str || '').trim();
          if (/^\d{1,3}$/.test(s2) && yDiff < bestDist) {
            itemNo = s2;
            bestDist = yDiff;
          }
        }

        // 找數量（右邊 X > 600 的數字）
        let qty = 1;
        for (const it2 of allItems) {
          const x2 = it2.transform[4] || 0;
          const y2 = it2.transform[5] || 0;
          if (x2 < 600) continue;
          if (Math.abs(y2 - partY) > 8) continue;
          const s2 = String(it2.str || '').trim();
          if (/^\d{1,2}$/.test(s2)) {
            const n = parseInt(s2, 10);
            if (n >= 1 && n <= 20) { qty = n; break; }
          }
        }

        // 找名稱（零件號右邊的英文）
        let name = '';
        for (const it2 of allItems) {
          const x2 = it2.transform[4] || 0;
          const y2 = it2.transform[5] || 0;
          if (x2 <= partX + 50) continue;
          if (x2 > 550) continue;
          if (Math.abs(y2 - partY) > 8) continue;
          const s2 = String(it2.str || '').trim();
          if (/^[A-Z][A-Z\s,.\-]{2,40}$/i.test(s2)) { name = s2; break; }
        }

        results.push({ pno, itemNo, name: name || '（無名稱）', qty });
      }
    }
    return results;
  }

  global.EPC_BRAND['yamaha-loose'] = {
    id: 'yamaha-loose',
    YAMAHA_LOOSE_REGEX: YAMAHA_LOOSE_REGEX,
    isValidYamahaLoosePartNo: isValidYamahaLoosePartNo,
    extractTitleYamahaLoose: extractTitleYamahaLoose,
    parseYamahaLooseItems: parseYamahaLooseItems,
    isValid: isValidYamahaLoosePartNo,
    extractTitle: extractTitleYamahaLoose,
    PART_REGEX: YAMAHA_LOOSE_REGEX,
  };

  if (typeof global.isValidYamahaLoosePartNo === "undefined") global.isValidYamahaLoosePartNo = isValidYamahaLoosePartNo;
  if (typeof global.parseYamahaLooseItems === "undefined") global.parseYamahaLooseItems = parseYamahaLooseItems;
  if (typeof global.extractTitleYamahaLoose === "undefined") global.extractTitleYamahaLoose = extractTitleYamahaLoose;
})(typeof window !== "undefined" ? window : globalThis);

(function () {
  const b = window.EPC_BRAND && window.EPC_BRAND["yamaha-loose"];
  if (!b) return;
  b.highlightOffsetX = 0;
  b.highlightExpandLeft = 0;
})();
