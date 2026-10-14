/* Cài KingTele thành ứng dụng (PWA): đăng ký service worker + nút "Cài ứng dụng". */
(() => {
  'use strict';

  // 1) Service worker (cần https hoặc localhost)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  // 2) Nút cài đặt
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inAppBrowser = /FBAN|FBAV|Instagram|Zalo|Line\/|MicroMessenger|TikTok|; wv\)/i.test(ua); // trình duyệt nhúng trong app khác
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null;

  function refresh() {
    const hide = installed();
    document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = hide; });
  }
  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; refresh(); });
  window.addEventListener('appinstalled', () => { deferred = null; refresh(); });
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', refresh);

  function help() {
    const d = document.createElement('dialog');
    d.className = 'pwa-dialog';
    d.setAttribute('aria-labelledby', 'pwa-t');
    const h = document.createElement('h2'); h.id = 'pwa-t'; h.textContent = 'Cài KingTele lên máy';
    const p = document.createElement('p');
    p.textContent = isIOS
      ? 'Mở trang này bằng Safari, bấm nút Chia sẻ rồi chọn "Thêm vào MH chính".'
      : 'Mở menu của trình duyệt (dấu ⋮ hoặc ⋯) rồi chọn "Cài đặt ứng dụng" hoặc "Thêm vào màn hình chính".';
    d.append(h, p);
    if (inAppBrowser) {
      const w = document.createElement('p');
      w.className = 'pwa-warn';
      w.textContent = 'Bạn đang mở trong trình duyệt tích hợp của ứng dụng khác. Hãy mở trang này bằng Chrome (Android) hoặc Safari (iPhone) để cài.';
      d.append(w);
    }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-primary'; b.textContent = 'Đóng';
    b.addEventListener('click', () => d.close());
    d.append(b);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
  }

  async function install() {
    if (!deferred) return help(); // iOS, Firefox, hoặc trình duyệt chưa cho phép cài trực tiếp: hướng dẫn thủ công
    const ev = deferred;
    deferred = null;
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch { help(); }
    refresh();
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('[data-reload]')) { location.reload(); return; }
    const b = e.target.closest && e.target.closest('[data-install]');
    if (b) { e.preventDefault(); install(); }
  });
})();
