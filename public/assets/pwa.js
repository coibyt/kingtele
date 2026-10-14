/* Cài KingTele thành ứng dụng (PWA):
 *  - đăng ký service worker
 *  - nút "Cài ứng dụng" (data-install)
 *  - thanh mời cài nổi bật: chỉ hiện với khách CHƯA cài; ẩn hẳn khi đã cài. */
(() => {
  'use strict';

  const KEY_INSTALLED = 'kt_app_installed';
  const KEY_SNOOZE = 'kt_install_snooze';
  const SNOOZE_MS = 24 * 3600 * 1000; // khách bấm × thì nhắc lại sau 1 ngày

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* localStorage bị chặn */ } },
  };

  /**
   * Có nên hiện thanh mời cài không?
   * - đang chạy trong app (standalone) hoặc đã đánh dấu đã cài  -> không
   * - khách vừa bấm × (chưa hết 1 ngày)                       -> không
   * - trình duyệt cho cài trực tiếp (hasPrompt) hoặc iPhone/iPad Safari (cài thủ công) -> có
   * - trình duyệt không cài được (Firefox máy tính, trình duyệt nhúng của app khác)    -> không
   */
  function shouldShowBanner({ standalone, installedFlag, snoozedUntil, now, hasPrompt, isIOS, inApp }) {
    if (standalone || installedFlag) return false;
    if (snoozedUntil && now < snoozedUntil) return false;
    if (hasPrompt) return true;
    return !!isIOS && !inApp;
  }

  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|Instagram|Zalo|Line\/|MicroMessenger|TikTok|; wv\)/i.test(ua); // trình duyệt nhúng trong app khác
  const mq = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : { matches: false };
  const standalone = () => mq.matches || navigator.standalone === true;
  let deferred = null;
  let banner = null;

  window.KT_PWA = { shouldShowBanner };

  // Báo sự kiện cho server để quản trị viên xem thống kê lượt cài (chỉ gồm mã thiết bị ngẫu nhiên, không có thông tin cá nhân)
  function deviceId() {
    let id = store.get('kt_device');
    if (!id || !/^[a-z0-9]{8,40}$/.test(id)) {
      const a = new Uint8Array(10);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a); else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      id = Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
      store.set('kt_device', id);
    }
    return id;
  }
  function report(type) {
    try {
      fetch('/api/pwa/event', {
        method: 'POST', keepalive: true,
        headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
        body: JSON.stringify({ type, device: deviceId() }),
      }).catch(() => {});
    } catch { /* không có mạng / fetch: bỏ qua */ }
  }

  // 1) Service worker (cần https hoặc localhost)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  // 2) Trạng thái đã cài hay chưa
  const markInstalled = () => { store.set(KEY_INSTALLED, '1'); deferred = null; refresh(); };
  if (standalone()) {
    store.set(KEY_INSTALLED, '1'); // đang chạy trong app => chắc chắn đã cài
    try {
      if (!sessionStorage.getItem('kt_open_rep')) { sessionStorage.setItem('kt_open_rep', '1'); report('app_open'); }
    } catch { report('app_open'); }
  }
  // Chrome (Android/máy tính): hỏi trình duyệt xem ứng dụng đã cài trên máy chưa, kể cả khi đang mở bằng tab thường
  if (navigator.getInstalledRelatedApps) {
    navigator.getInstalledRelatedApps().then((apps) => { if (apps && apps.some((a) => a.platform === 'webapp')) markInstalled(); }).catch(() => {});
  }

  function visible() {
    return shouldShowBanner({
      standalone: standalone(),
      installedFlag: store.get(KEY_INSTALLED) === '1',
      snoozedUntil: Number(store.get(KEY_SNOOZE)) || 0,
      now: Date.now(),
      hasPrompt: !!deferred,
      isIOS, inApp,
    });
  }

  function refresh() {
    const hide = standalone() || store.get(KEY_INSTALLED) === '1';
    document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = hide; });
    if (visible()) showBanner(); else hideBanner();
  }

  // 3) Thanh mời cài nổi bật
  function showBanner() {
    if (banner || !document.body) return;
    banner = document.createElement('aside');
    banner.className = 'install-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cài ứng dụng KingTele');

    const icon = document.createElement('img');
    icon.src = '/assets/icons/icon-192.png'; icon.alt = ''; icon.width = 48; icon.height = 48;

    const text = document.createElement('div');
    text.className = 'ib-text';
    const t = document.createElement('strong'); t.textContent = 'Cài ứng dụng KingTele';
    const s = document.createElement('span'); s.textContent = 'Mở nhanh từ màn hình chính, luôn cập nhật cùng website.';
    text.append(t, s);

    const go = document.createElement('button');
    go.type = 'button'; go.className = 'btn btn-primary ib-go'; go.textContent = 'Cài ngay';
    go.setAttribute('data-install-now', '');

    const close = document.createElement('button');
    close.type = 'button'; close.className = 'ib-close'; close.setAttribute('aria-label', 'Đóng'); close.textContent = '×';
    close.addEventListener('click', () => { store.set(KEY_SNOOZE, String(Date.now() + SNOOZE_MS)); hideBanner(); });

    banner.append(icon, text, go, close);
    document.body.append(banner);
    document.body.classList.add('has-install-banner');
    if (!store.get('kt_banner_rep')) { store.set('kt_banner_rep', '1'); report('banner_shown'); }
  }

  function hideBanner() {
    if (banner) { banner.remove(); banner = null; }
    if (document.body) document.body.classList.remove('has-install-banner');
  }

  document.addEventListener('DOMContentLoaded', refresh);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; refresh(); });
  window.addEventListener('appinstalled', () => { report('installed'); markInstalled(); });
  if (mq.addEventListener) mq.addEventListener('change', () => { if (standalone()) store.set(KEY_INSTALLED, '1'); refresh(); });

  // 4) Hộp hướng dẫn cài thủ công
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
    if (inApp) {
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
    if (!deferred) return help(); // iPhone, Firefox, hoặc trình duyệt chưa cho cài trực tiếp: hướng dẫn thủ công
    const ev = deferred;
    deferred = null;
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      if (choice && choice.outcome === 'accepted') { report('installed'); return markInstalled(); }
    } catch { help(); }
    refresh();
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest && t.closest('[data-reload]')) { location.reload(); return; }
    if (t.closest && t.closest('[data-install], [data-install-now]')) { e.preventDefault(); report('install_click'); install(); }
  });
})();
