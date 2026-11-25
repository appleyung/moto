/**
 * EPC 離線 Service Worker
 * - 預快取本站檔案 + CDN 外部 JS
 * - 離線優先用快取；線上則更新快取
 * - respondWith 永不拋錯（避免 Safari FetchEvent 白屏）
 */
const CACHE = 'mot-cache-v20261125offline1';

const LOCAL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sidebar.js',
  './calc.html',
  './manifest.json',
  './sw.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './parsers/yamaha.js',
  './parsers/yamaha-en.js',
  './parsers/yamaha-id.js',
  './parsers/yamaha-th.js',
  './parsers/honda-jp.js',
  './parsers/honda-id.js',
  './parsers/kawasaki-id.js',
  './parsers/kawasaki-th.js',
  './i18n/transfer-eng.js',
  './i18n/transfer-jp.js',
  './i18n/transfer-id.js',
  './i18n/transfer-th.js'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

function isSameOrigin(url) {
  try { return new URL(url, self.location.href).origin === self.location.origin; }
  catch (e) { return false; }
}

function isCdn(url) {
  return /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com/i.test(url);
}

/** 安全回應：永遠回 Response，不 throw */
function safeRespond(promise) {
  return promise.catch(function () {
    return new Response('離線且無快取', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  });
}

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    // 本站：逐一加入，單一失敗不整批中斷
    for (const url of LOCAL_ASSETS) {
      try {
        await cache.add(url);
      } catch (err) {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res && res.ok) await cache.put(url, res.clone());
        } catch (e2) {
          console.warn('[sw] local skip', url, e2);
        }
      }
    }
    // CDN：同樣容錯
    for (const url of CDN_ASSETS) {
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-cache' });
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(url, res.clone());
        }
      } catch (err) {
        console.warn('[sw] cdn skip', url, err);
      }
    }
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 略過非 http(s)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const same = isSameOrigin(req.url);
  const cdn = isCdn(req.url);

  // 導航：網路優先，失敗回 index.html 快取（App 殼）
  if (req.mode === 'navigate') {
    e.respondWith(safeRespond((async function () {
      try {
        const net = await fetch(req);
        if (net && net.ok) {
          const cache = await caches.open(CACHE);
          cache.put('./index.html', net.clone()).catch(function () {});
          return net;
        }
      } catch (err) {}
      const cached = await caches.match('./index.html') || await caches.match(req);
      if (cached) return cached;
      return new Response('<!DOCTYPE html><html><body><h1>離線</h1><p>請先連網開啟一次以完成快取。</p></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    })()));
    return;
  }

  // 本站靜態 / CDN：快取優先，背景更新
  if (same || cdn) {
    e.respondWith(safeRespond((async function () {
      const cached = await caches.match(req) || await caches.match(req.url);
      if (cached) {
        // 背景更新
        fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(CACHE).then(function (c) { c.put(req, res.clone()); }).catch(function () {});
          }
        }).catch(function () {});
        return cached;
      }
      // 無快取 → 網路
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone()).catch(function () {});
        }
        return res;
      } catch (err) {
        // 嘗試去掉 query 再 match（?v=xxx）
        const bare = req.url.split('?')[0];
        const byPath = await caches.match(bare);
        if (byPath) return byPath;
        throw err;
      }
    })()));
    return;
  }

  // 其他請求：網路，失敗再快取
  e.respondWith(safeRespond(
    fetch(req).catch(function () {
      return caches.match(req).then(function (c) {
        return c || new Response('', { status: 504 });
      });
    })
  ));
});
