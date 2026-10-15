/* Đếm khách truy cập (không cookie, không IP). Ẩn danh: chỉ có mã ngẫu nhiên của trình duyệt.
 * Tôn trọng "Do Not Track" của trình duyệt. */
(() => {
  'use strict';
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  if (/\/offline\.html$/.test(location.pathname)) return;

  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* bị chặn */ } };

  function visitorId() {
    let id = get('kt_device'); // dùng chung với thống kê cài ứng dụng
    if (!id || !/^[a-z0-9]{8,40}$/.test(id)) {
      const a = new Uint8Array(10);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a); else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      id = Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
      set('kt_device', id);
    }
    return id;
  }

  const vid = visitorId();
  function send(type) {
    try {
      fetch('/api/track', {
        method: 'POST', keepalive: true,
        headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
        body: JSON.stringify({ type, vid, path: location.pathname, ref: type === 'view' ? document.referrer : '' }),
      }).catch(() => {});
    } catch { /* không có mạng */ }
  }

  send('view');
  // "đang xem": báo mỗi 30 giây khi tab đang hiển thị
  setInterval(() => { if (document.visibilityState === 'visible') send('ping'); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') send('ping'); });
  window.addEventListener('pagehide', () => send('leave'));
})();
