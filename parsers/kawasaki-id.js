/* EPC V30.2 parser module: kawasaki-id — optional; app works if missing */
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
    const loc = (typeof kawasakiLocale !== 'undefined' && kawasakiLocale === 'th') ? 'th' : 'id';
    const strs = (items || []).map(it => String(it.str || '')).filter(Boolean);
    // 無空白串：對抗單字元拆分
    const nospace = strs.join('').replace(/\s+/g, '');
    // 有空白串（黏字母）
    let joined = '';
    const sorted = (items || []).filter(it => it && it.transform && String(it.str || '').length).slice().sort((a, b) => {
      const dy = (b.transform[5] || 0) - (a.transform[5] || 0);
      if (Math.abs(dy) > 5) return dy;
      return (a.transform[4] || 0) - (b.transform[4] || 0);
    });
    let lastY = null, lastR = null;
    for (const it of sorted) {
      const s = String(it.str || '');
      const x = it.transform[4] || 0, y = it.transform[5] || 0;
      const w = it.width || s.length * 3;
      if (joined) {
        const same = lastY != null && Math.abs(y - lastY) <= 5;
        const prev = joined.slice(-1);
        const glue = same && /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(s[0]);
        if (!glue) {
          if (!same) joined += ' | ';
          else if (lastR != null && x > lastR + 1.2) joined += ' ';
        }
      }
      joined += s;
      lastY = y; lastR = x + w;
    }
    const compact = joined.replace(/([A-Za-z])\s+(?=[A-Za-z])/g, '$1').replace(/ +/g, ' ');

    if (loc === 'th') {
      let head = '';
      // Engine-เครื่องยนต์（nospace 最穩）
      let m = nospace.match(/(Engine|Chassis|Frame|Electrical|Transmission)[-–—]?([\u0E00-\u0E7F]{2,24})/i);
      if (m) head = m[1] + '-' + m[2];
      else {
        m = compact.match(/\b(Engine|Chassis|Frame|Electrical|Transmission)\s*[-–—]\s*([\u0E00-\u0E7F]{2,24})/i);
        if (m) head = m[1] + '-' + m[2];
      }

      let sub = '';
      // This page covers: Oil Pump-ปั๊มน้ำมันเครื่อง
      m = nospace.match(/Thispagecovers:?([A-Za-z][A-Za-z0-9\/,]{2,35})[-–—]?([\u0E00-\u0E7F]{0,24})/i);
      if (m) {
        sub = m[1] + (m[2] ? '-' + m[2] : '');
      } else {
        m = compact.match(/This\s*page\s*covers\s*:?\s*([A-Za-z][A-Za-z0-9\/\(\),\s]{2,40})\s*[-–]?\s*([\u0E00-\u0E7F]{0,24})/i);
        if (m) sub = (m[1].replace(/\s+/g, ' ').trim() + (m[2] ? '-' + m[2] : '')).trim();
      }
      if (sub && /Quantity|ZX25|GMFNN|RefNo|PartNo/i.test(sub)) sub = '';

      let groupNo = '';
      m = nospace.match(/GROUPNO\.?(\d{1,3})/i) || compact.match(/GROUP\s*NO\.?\s*(\d{1,3})/i);
      if (m) groupNo = m[1];

      if (head && sub) return limitKawasakiTitle(fallback, head + ' / ' + sub);
      if (head) return limitKawasakiTitle(fallback, head);
      if (sub) {
        if (groupNo) return limitKawasakiTitle(fallback, 'Group ' + groupNo + ' ' + sub);
        return limitKawasakiTitle(fallback, sub);
      }
      if (groupNo) return limitKawasakiTitle(fallback, 'Group ' + groupNo);
      return fallback;
    }

    // 印尼／英文川崎：8. Crankshaft / 30. Swingarm / Pictorial Index
    let m = nospace.match(/(\d{1,3})\.([A-Z][A-Za-z][A-Za-z0-9\/\-()]{1,42})/);
    if (m) {
      let body = m[2].replace(/([a-z])([A-Z])/g, '$1 $2'); // CamelCase 略分詞可選
      // 在關鍵詞邊界截斷
      body = body.split(/(?:RefNo|PartNo|Description|SpecCode|Quantity|F\d{3,}|\d{5}-)/i)[0];
      // 常見節名還原空格
      body = body
        .replace(/^(Cylinder)(Head|Piston)/i, '$1 $2')
        .replace(/^(Air)(Cleaner)/i, '$1 $2')
        .replace(/^(Front|Rear)(Brake|Hub|Fender|Wheel)/i, '$1 $2')
        .replace(/^(Engine)(Mount)/i, '$1 $2')
        .replace(/^(Gear)(Change)/i, '$1 $2')
        .replace(/^(Oil)(Pump|Pan)/i, '$1 $2')
        .replace(/^(Water)(Pipe)/i, '$1 $2')
        .replace(/^(Brake)(Pedal)/i, '$1 $2')
        .replace(/^(Throttle)(Body)/i, '$1 $2')
        .replace(/(Shock)(Absorber)/i, '$1 $2')
        .replace(/(Connecting)(Rod)/i, '$1 $2')
        .trim();
      if (body.length >= 3 && body.length <= 45 && !/^(Ref|Part|No)$/i.test(body))
        return limitKawasakiTitle(fallback, m[1] + '. ' + body);
    }
    m = compact.match(/\b(\d{1,3})\.\s*([A-Z][A-Za-z0-9\/\-,()\s]{2,48})/);
    if (m) {
      let body = m[2].replace(/\s+/g, ' ').trim();
      body = body.split(/\s+Ref\.?\s*No|\s+Part\s*No|\s+Description|\s+Spec\s*Code|\s+Quantity|\s+\d{5}-/i)[0].trim();
      if (/^(Ref|Part|No)$/i.test(body)) body = '';
      if (body.length >= 3 && body.length <= 40 && !/\d{5}-/.test(body))
        return limitKawasakiTitle(fallback, m[1] + '. ' + body);
    }
    m = compact.match(/This\s*page\s*covers\s*:?\s*([^\n|]{3,60})/i);
    if (m) {
      let title = m[1].replace(/\s+/g, ' ').replace(/\s*Ref\.?\s*No.*$/i, '').replace(/\s*GROUP\s*NO.*$/i, '').trim();
      if (title.length >= 3 && title.length <= 50) return limitKawasakiTitle(fallback, title);
    }
    if (/Pictorial\s*Index/i.test(compact) || /PictorialIndex/i.test(nospace))
      return limitKawasakiTitle(fallback, 'Pictorial Index');
    if (/Color\s*Combination\s*Parts\s*List/i.test(compact) || /ColorCombinationPartsList/i.test(nospace))
      return limitKawasakiTitle(fallback, 'Color Combination Parts List');
    // 常見章名無編號
    m = compact.match(/\b((?:Cylinder Head|Crankshaft|Swingarm|Front Brake|Rear Hub|Engine Mount|Camshaft|Muffler|Clutch|Transmission|Frame|Fairing)[A-Za-z0-9\/\-\s()]{0,20})\b/i);
    if (m) {
      const title = m[1].replace(/\s+/g, ' ').trim().slice(0, 40);
      if (title.length >= 4) return limitKawasakiTitle(fallback, title);
    }
    return fallback;
  }
  function parseKawasakiItems(items, pageCategory) {
    const pageKeys = [];
    const loc = (typeof kawasakiLocale !== 'undefined' && kawasakiLocale === 'th') ? 'th' : 'id';
    const allItems = (items || []).filter(it => it && it.transform && String(it.str || '').length);
    if (!allItems.length) return pageKeys;

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
            if (/^[1-9]\d{0,1}$/.test(s)) { qtys.push(parseInt(s, 10)); continue; }
            if (/^[A-Za-z][A-Za-z0-9\-\/,=.#+\s]{2,}$/.test(s)) {
              name = name ? (name + ' ' + s) : s;
            }
          }
        }
        if (!partNo || seen.has(partNo)) continue;
        seen.add(partNo);
        name = (name || '').replace(/\s+/g, ' ').trim();
        if (!/[A-Za-z]{3,}/.test(name)) name = '';
        const qty = qtys.length ? qtys[0] : 1;
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
      if (pageKeys.length >= 2) return pageKeys;
      // 欄解析失敗則退回一般列解析
    }

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
        let partY = null, partX = null;
        for (const it of allItems) {
          const s = String(it.str || '').replace(/[－–—]/g, '-').replace(/\s+/g, '');
          if (s === f.pno || (s.indexOf(pref) === 0 && /\d{5}-/.test(s))) {
            partY = it.transform[5]; partX = it.transform[4]; break;
          }
        }
        if (partY != null) {
          let bestX = -Infinity, bestN = null;
          for (const it of allItems) {
            if (Math.abs((it.transform[5] || 0) - partY) > 8) continue;
            if (partX != null && (it.transform[4] || 0) < partX) continue;
            const s = String(it.str || '').trim();
            if (!/^[1-9]\d{0,1}$/.test(s)) continue;
            const n = parseInt(s, 10);
            if (n >= 1 && n <= 99 && (it.transform[4] || 0) >= bestX) {
              bestX = it.transform[4] || 0; bestN = n;
            }
          }
          if (bestN != null) qty = bestN;
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
        if (qty >= 1 && qty <= 99) info.qty = qty;
      }
      if (!pageKeys.includes(key)) pageKeys.push(key);
    }
    return pageKeys;
  }
  global.EPC_BRAND['kawasaki-id'] = {
    id: 'kawasaki-id',
    locale: 'id',
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
  if (typeof global.parseKawasakiItems === "undefined" && typeof parseKawasakiItems === "function") global.parseKawasakiItems = parseKawasakiItems;
})(typeof window !== "undefined" ? window : globalThis);
