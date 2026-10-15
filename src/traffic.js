'use strict';
/**
 * Thống kê truy cập website, thân thiện quyền riêng tư: không lưu IP, không dùng cookie theo dõi.
 * Mỗi trình duyệt có một mã ngẫu nhiên (localStorage). Sự kiện từ trình duyệt:
 *   view  - mở một trang        ping  - đang xem (30 giây/lần khi tab hiển thị)        leave - rời trang
 *
 * - "Đang xem ngay bây giờ": mã có ping/view trong ONLINE_MS gần nhất (chỉ giữ trong bộ nhớ).
 * - Số liệu theo ngày (giữ 90 ngày): lượt xem, khách duy nhất, nguồn truy cập, loại thiết bị. Ghi đĩa mỗi phút.
 */
const DAY = 86400000;
const ONLINE_MS = 90000;
const KEEP_DAYS = 90;
const MAX_VISITORS_PER_DAY = 100000;
const TYPES = new Set(['view', 'ping', 'leave']);
const VID_RE = /^[a-z0-9]{8,40}$/;
const BOT_RE = /bot\b|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python-requests|facebookexternalhit|preview/i;

const platformOf = (ua = '') => {
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os x/i.test(ua)) return /mobile/i.test(ua) ? 'ios' : 'mac';
  if (/linux|cros/i.test(ua)) return 'linux';
  return 'other';
};

/** Nguồn truy cập: dựa vào trang giới thiệu (referrer) và trình duyệt nhúng của app (Facebook, Zalo...). */
function sourceOf(ref = '', ua = '', siteHost = '') {
  if (/FBAN|FBAV/.test(ua)) return 'facebook';
  if (/Zalo/i.test(ua)) return 'zalo';
  if (!ref) return 'direct';
  let host = '';
  try { host = new URL(ref).hostname.toLowerCase(); } catch { return 'direct'; }
  if (siteHost && (host === siteHost || host.endsWith(`.${siteHost}`))) return 'direct'; // tự điều hướng trong site
  if (/(^|\.)(facebook|fb|instagram|messenger)\.(com|me)$|(^|\.)l\.facebook\.com$/.test(host)) return 'facebook';
  if (/(^|\.)google\./.test(host)) return 'google';
  if (/(^|\.)(t\.me|telegram\.org|telegram\.me)$|web\.telegram/.test(host)) return 'telegram';
  if (/(^|\.)(zalo\.me|zaloapp\.com|zalo\.vn)$/.test(host)) return 'zalo';
  return 'other';
}

function pageOf(path = '/') {
  const p = String(path).split('?')[0].split('#')[0];
  if (p === '/' || p === '/index.html') return 'home';
  if (p === '/login') return 'login';
  if (p === '/register') return 'register';
  if (p === '/app' || p.startsWith('/app/')) return 'app';
  return 'other';
}

function createTraffic({ store, tz = 'Asia/Ho_Chi_Minh' }) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const dayKey = (t) => fmt.format(t);
  const online = new Map(); // vid -> { last, page }
  let dirty = false;

  const days = () => store.data.traffic.days;
  const today = (now) => {
    const k = dayKey(now);
    return days()[k] || (days()[k] = { views: 0, pages: {}, v: {} });
  };

  function prune(now) {
    for (const k of Object.keys(days())) if (now - Date.parse(`${k}T00:00:00Z`) > KEEP_DAYS * DAY) { delete days()[k]; dirty = true; }
    for (const [id, o] of online) if (now - o.last > ONLINE_MS * 4) online.delete(id);
  }

  /** Ghi một sự kiện. Trả về 'ok' | 'invalid' | 'ignored' (bot). */
  function record({ type, vid, path, ref }, { ua = '', siteHost = '' } = {}, now = Date.now()) {
    if (!TYPES.has(type) || !VID_RE.test(String(vid || ''))) return 'invalid';
    if (BOT_RE.test(ua)) return 'ignored';
    if (type === 'leave') { online.delete(vid); return 'ok'; }

    const page = pageOf(path);
    online.set(vid, { last: now, page });
    const d = today(now);
    if (!d.v[vid] && Object.keys(d.v).length < MAX_VISITORS_PER_DAY) {
      d.v[vid] = `${platformOf(ua)}|${sourceOf(type === 'view' ? ref : '', ua, siteHost)}`;
    }
    if (type === 'view') { d.views++; d.pages[page] = (d.pages[page] || 0) + 1; }
    dirty = true;
    if (Math.random() < 0.01) prune(now);
    return 'ok';
  }

  /** signupsByDay: { 'YYYY-MM-DD': số đăng ký }. */
  function summary({ signupsByDay = {} } = {}, now = Date.now()) {
    const cut = now - ONLINE_MS;
    const byPage = {};
    let n = 0;
    for (const o of online.values()) if (o.last >= cut) { n++; byPage[o.page] = (byPage[o.page] || 0) + 1; }

    const dayStat = (t) => {
      const k = dayKey(t);
      const d = days()[k];
      return { visitors: d ? Object.keys(d.v).length : 0, views: d ? d.views : 0, signups: signupsByDay[k] || 0 };
    };
    const chart = Array.from({ length: 30 }, (_, i) => { const t = now - (29 - i) * DAY; return { t, ...dayStat(t) }; });

    const sources = {}, platforms = {};
    for (let i = 0; i < 7; i++) {
      const d = days()[dayKey(now - i * DAY)];
      if (!d) continue;
      for (const val of Object.values(d.v)) {
        const [p, s] = val.split('|');
        platforms[p] = (platforms[p] || 0) + 1;
        sources[s] = (sources[s] || 0) + 1;
      }
    }
    return {
      online: n, onlineByPage: byPage,
      today: dayStat(now), yesterday: dayStat(now - DAY),
      visitors7: chart.slice(-7).reduce((a, c) => a + c.visitors, 0),
      views7: chart.slice(-7).reduce((a, c) => a + c.views, 0),
      chart, sources, platforms, timezone: tz,
    };
  }

  /** Ghi xuống đĩa nếu có thay đổi (gọi định kỳ, không ghi mỗi sự kiện). */
  function flush() { if (dirty) { dirty = false; return store.save(); } return Promise.resolve(); }

  return { record, summary, flush, dayKey, sourceOf, pageOf, onlineCount: (now = Date.now()) => [...online.values()].filter((o) => o.last >= now - ONLINE_MS).length };
}

module.exports = { createTraffic, sourceOf, pageOf, platformOf };
