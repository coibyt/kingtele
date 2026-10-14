'use strict';
/**
 * Thống kê lượt cài ứng dụng (PWA). Không lưu IP hay thông tin cá nhân của khách chưa đăng nhập:
 * mỗi thiết bị chỉ có một mã ngẫu nhiên (do trình duyệt tạo) + loại thiết bị suy ra từ User-Agent.
 *
 * Sự kiện từ trình duyệt:
 *  banner_shown  - thanh mời cài đã hiện với thiết bị này
 *  install_click - khách bấm nút/thanh "Cài ứng dụng"
 *  installed     - trình duyệt báo đã cài xong (Chrome/Edge/Android)
 *  app_open      - đang mở bằng ứng dụng đã cài (cách duy nhất để biết trên iPhone)
 */
const TYPES = new Set(['banner_shown', 'install_click', 'installed', 'app_open']);
const DEVICE_RE = /^[a-z0-9]{8,40}$/;
const MAX_DEVICES = 50000;
const DAY = 86400000;

function platformOf(ua = '') {
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os x/i.test(ua)) return ua.includes('Mobile') ? 'ios' : 'mac'; // iPadOS giả danh Mac
  if (/linux|cros/i.test(ua)) return 'linux';
  return 'other';
}

function createPwaStats({ store }) {
  const devices = () => store.data.pwa.devices;

  function prune() {
    const ids = Object.keys(devices());
    if (ids.length <= MAX_DEVICES) return;
    const cutoff = Date.now() - 30 * DAY;
    for (const id of ids) { const d = devices()[id]; if (!d.installedAt && d.last < cutoff) delete devices()[id]; }
  }

  /** Ghi một sự kiện. Trả về true nếu hợp lệ. */
  function record({ type, device }, ua, userId) {
    if (!TYPES.has(type) || !DEVICE_RE.test(String(device || ''))) return false;
    const now = Date.now();
    let d = devices()[device];
    if (!d) { d = devices()[device] = { first: now, last: now, platform: platformOf(ua), clicks: 0 }; prune(); }
    d.last = now;
    if (userId && !d.userId) d.userId = userId;
    if (type === 'banner_shown' && !d.banner) d.banner = now;
    if (type === 'install_click') d.clicks = (d.clicks || 0) + 1;
    if (type === 'installed' && !d.installedAt) { d.installedAt = now; d.source = 'event'; }
    if (type === 'app_open') {
      d.appOpenedAt = now;
      if (!d.installedAt) { d.installedAt = now; d.source = 'app'; }
    }
    return true;
  }

  /** Tổng hợp cho trang quản trị. dayKey(ts) -> chuỗi ngày theo múi giờ của quản trị viên. */
  function summary({ dayKey, nameOf }) {
    const list = Object.values(devices());
    const now = Date.now();
    const installed = list.filter((d) => d.installedAt);
    const byPlatform = {};
    for (const d of installed) byPlatform[d.platform] = (byPlatform[d.platform] || 0) + 1;

    const perDay = {};
    for (const d of installed) { const k = dayKey(d.installedAt); perDay[k] = (perDay[k] || 0) + 1; }
    const chart = Array.from({ length: 30 }, (_, i) => {
      const t = now - (29 - i) * DAY;
      const k = dayKey(t);
      return { t, installs: perDay[k] || 0 };
    });

    return {
      installs: installed.length,
      installs7: installed.filter((d) => d.installedAt >= now - 7 * DAY).length,
      installs30: installed.filter((d) => d.installedAt >= now - 30 * DAY).length,
      active7: list.filter((d) => d.appOpenedAt && d.appOpenedAt >= now - 7 * DAY).length,
      clicks: list.reduce((n, d) => n + (d.clicks || 0), 0),
      bannerShown: list.filter((d) => d.banner).length,
      byPlatform, chart,
      recent: installed.sort((a, b) => b.installedAt - a.installedAt).slice(0, 20)
        .map((d) => ({ at: d.installedAt, platform: d.platform, source: d.source, member: d.userId ? nameOf(d.userId) : '' })),
    };
  }

  return { record, summary, platformOf };
}

module.exports = { createPwaStats, platformOf };
