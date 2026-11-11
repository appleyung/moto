/* EPC V30.2 parser module: honda-id — optional; app works if missing */
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
  function isIdTitleJunk(s) {
    if (!s) return true;
    if (/TIDAK\s*ADA|INFORMASI|Kode\s*Parts|Parts\s*Catalog|No\.?\s*Seri|Deskripsi|Jumlah|L\.O\.N|Nomor\s*ref|F\.R\.T/i.test(s)) return true;
    if (/^(NO\.?|REF\.?|PART|SERI|KODE|TYPE\d*)$/i.test(s)) return true;
    if (/\bCBS\b|\bABS\b/i.test(s) && !/BRAKE|MASTER|CYLINDER|SWITCH/i.test(s)) return true;
    if (/^ADV\d+[A-Z]?$/i.test(s)) return true;
    if (/\d{5}-/.test(s)) return true;
    if (/^(NOTICE|MASTER|LABEL|TUBE|COVER)$/i.test(s.trim())) return true;
    return false;
  }
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
  function extractTitleIndonesian(items, pageIndex, fallback) {
    return extractTitleIndonesianOrEn(items, pageIndex, fallback);
  }
  global.EPC_BRAND["honda-id"] = {
    id: "honda-id",
    locale: "id",
    PART_REGEX: HONDA_PART_REGEX,
    isValid: isValidHondaPartNo,
    isValidHondaPartNo: isValidHondaPartNo,
    isIdTitleJunk: isIdTitleJunk,
    extractTitle: extractTitleIndonesianOrEn,
    extractTitleIndonesian: extractTitleIndonesian,
    extractTitleIndonesianOrEn: extractTitleIndonesianOrEn
  };
  if (typeof global.HONDA_PART_REGEX === "undefined") global.HONDA_PART_REGEX = HONDA_PART_REGEX;
  if (typeof global.isValidHondaPartNo !== "function") global.isValidHondaPartNo = isValidHondaPartNo;
  if (typeof global.isIdTitleJunk !== "function") global.isIdTitleJunk = isIdTitleJunk;
  if (typeof global.extractTitleIndonesianOrEn !== "function") global.extractTitleIndonesianOrEn = extractTitleIndonesianOrEn;
  if (typeof global.extractTitleIndonesian !== "function") global.extractTitleIndonesian = extractTitleIndonesian;
})(typeof window !== "undefined" ? window : globalThis);
