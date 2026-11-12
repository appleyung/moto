/* EPC V30.2 parser module: yamaha — optional; app works if missing */
(function (global) {
  "use strict";
  global.EPC_BRAND = global.EPC_BRAND || {};

  // 零件號格式：3-5-2 (B6H-E5461-10)、5-5 (90387-08821)、3-5-2-2 (B6H-E5461-10-00)
  var YAMAHA_PART_REGEX = /\b[0-9A-Z]{3,5}\s*-\s*[0-9A-Z]{4,6}(?:\s*-\s*[0-9A-Z]{1,3}){0,2}\b/gi;
  function isValidYamahaPartNo(p) {
    const s = normalizePartNo(p || '');
    if (!s || s.length < 8) return false;
    // 支援 3-5-2、5-5、3-5-2-2 格式
    if (!/^[0-9A-Z]{3,5}-[0-9A-Z]{4,6}(-[0-9A-Z]{1,3}){0,2}$/.test(s)) return false;
    const first = s.split('-')[0];
    // 純 1～2 位數字開頭 = 缺字母前綴的殘段
    if (/^\d{1,2}$/.test(first)) return false;
    // 至少一段後綴
    if ((s.match(/-/g) || []).length < 1) return false;
    return true;
  }
  function preferCompleteYamahaKey(key, existingKeys) {
    const k = normalizePartNo(key);
    // 若已有更長且以本 key 結尾的完整號，則本 key 為殘段
    for (const o of existingKeys) {
      const ok = normalizePartNo(typeof o === 'string' ? o : (o && o.key) || '');
      if (!ok || ok === k) continue;
      if (ok.length > k.length && ok.endsWith(k)) return false;
      if (ok.length > k.length && ok.endsWith(k.replace(/^[A-Z]/, ''))) return false;
    }
    return true;
  }
  function cleanYamahaName(name, partNo) {
    if (!name || !partNo) return name || '';
    let result = String(name).trim();
    const key = String(partNo).replace(/[–—]/g, '-').trim();
    // 移除零件號前綴
    if (result.toUpperCase().startsWith(key.toUpperCase())) {
      result = result.substring(key.length).trim();
    }
    // 移除開頭的標點符號
    result = result.replace(/^[\s\-.:：.]+/, '').trim();
    return result;
  }
  // Yamaha 專用名稱提取：從零件號右邊提取名稱，自動移除零件號前綴
  function extractNameYamaha(lineItems, partNo, partX, nextPartX) {
    let nameItems = [];
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      const itemX = item.transform[4] || 0;
      if (itemX < partX +5) continue; //抓零件號右邊+5位置的名
      if (itemX >= nextPartX) break;
      const str = (item.str || '').trim();
      if (str.length > 0 && !str.includes(partNo) && !partNo.includes(str)) {
        nameItems.push(str);
      }
    }
    let name = nameItems.join(' ').replace(/\s+/g, ' ').trim();
    // 移除零件號前綴
    const key = partNo.replace(/[–—]/g, '-');
    if (name.toUpperCase().startsWith(key.toUpperCase())) {
      name = name.substring(key.length).replace(/^[\s\-.:：.]+/, '').trim();
    }
    return name || '（無名稱）';
  }
  function extractTitleYamaha(items, pageIndex, fallback) {
    const allStr = (items || []).map(it => String(it.str || '').trim()).filter(Boolean);
    const joined = allStr.join(' ');
    // FIG. 33 頭燈 / FIG.33 頭燈
    let m = joined.match(/FIG\.?\s*(\d+)\s*([\u4e00-\u9fff\u3040-\u30ffA-Za-z][^\n]{0,36})/i);
    if (m) {
      let title = m[2].replace(/\s+/g, ' ').trim();
      title = title.replace(/(項次|部品番號|部品名稱|備註|數量|Qty|Ref).*$/i, '').trim();
      title = title.replace(/[\|．.].*$/, '').trim();
      if (title.length >= 1 && title.length <= 30) return `${fallback}FIG.${m[1]} ${title}`;
      return `${fallback}FIG.${m[1]}`;
    }
    m = joined.match(/FIG\.\s*(\d+)/i);
    if (m) return `${fallback}FIG.${m[1]}`;
    // 無 FIG 時嘗試頁面頂部中文短標題
    for (const s of allStr) {
      if (/^[\u4e00-\u9fff]{2,12}$/.test(s) && !/項次|部品|備註|數量|頁/.test(s)) {
        return `${fallback}，${s}`;
      }
    }
    return fallback;
  }
  global.EPC_BRAND['yamaha'] = {
    id: 'yamaha',
    YAMAHA_PART_REGEX: typeof YAMAHA_PART_REGEX !== "undefined" ? YAMAHA_PART_REGEX : null,
    isValidYamahaPartNo: typeof isValidYamahaPartNo === "function" ? isValidYamahaPartNo : null,
    preferCompleteYamahaKey: typeof preferCompleteYamahaKey === "function" ? preferCompleteYamahaKey : null,
    extractTitleYamaha: typeof extractTitleYamaha === "function" ? extractTitleYamaha : null,
    isValid: typeof isValidYamahaPartNo === "function" ? isValidYamahaPartNo : null,
    extractTitle: typeof extractTitleYamaha === "function" ? extractTitleYamaha : null,
    cleanName: typeof cleanYamahaName === "function" ? cleanYamahaName : null,
    extractName: typeof extractNameYamaha === "function" ? extractNameYamaha : null,
    PART_REGEX: typeof YAMAHA_PART_REGEX !== "undefined" ? YAMAHA_PART_REGEX : null,
  };
  // Install globals only when missing — safe if another brand already defined shared names
  if (typeof global.YAMAHA_PART_REGEX === "undefined" && typeof YAMAHA_PART_REGEX !== "undefined") global.YAMAHA_PART_REGEX = YAMAHA_PART_REGEX;
  if (typeof global.isValidYamahaPartNo === "undefined" && typeof isValidYamahaPartNo === "function") global.isValidYamahaPartNo = isValidYamahaPartNo;
  if (typeof global.preferCompleteYamahaKey === "undefined" && typeof preferCompleteYamahaKey === "function") global.preferCompleteYamahaKey = preferCompleteYamahaKey;
  if (typeof global.extractTitleYamaha === "undefined" && typeof extractTitleYamaha === "function") global.extractTitleYamaha = extractTitleYamaha;
})(typeof window !== "undefined" ? window : globalThis);

(function () {
  const b = window.EPC_BRAND && window.EPC_BRAND["yamaha"];
  if (!b) return;
  b.highlightOffsetX = 0;
  b.highlightExpandLeft = 0;
})();
