/* Service worker của KingTele.
 * Mục tiêu: app cài trên máy luôn dùng bản mới nhất của website (cùng dữ liệu, cùng tài khoản),
 * và vẫn mở được màn hình "ngoại tuyến" khi mất mạng.
 *  - Trang HTML và API: luôn lấy từ mạng, KHÔNG lưu đệm (dữ liệu tài khoản không nằm trong bộ nhớ đệm).
 *  - CSS/JS/biểu tượng/bản dịch: ưu tiên mạng (luôn mới), chỉ dùng bản lưu khi mất mạng. */
'use strict';

const VERSION = 'kt-v2';
const STATIC = `${VERSION}-static`;
const OFFLINE = '/offline.html';
const PRECACHE = [
  OFFLINE, '/assets/base.css', '/assets/site.css', '/assets/favicon.svg', '/assets/sprite.svg',
  '/assets/i18n-core.js', '/assets/i18n.js', '/assets/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(STATIC);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                       // phông chữ Google... để trình duyệt tự xử lý
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return; // không bao giờ lưu đệm API / dữ liệu riêng

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  event.respondWith(networkFirst(req));
});
