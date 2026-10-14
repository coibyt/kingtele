const test = require('node:test');
const assert = require('node:assert');
const { createPwaStats, platformOf } = require('../src/pwa-stats');

const mk = () => {
  const store = { data: { pwa: { devices: {} } } };
  return { store, stats: createPwaStats({ store }) };
};
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile/15E148 Safari/604.1';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

test('nhận dạng loại thiết bị từ User-Agent', () => {
  assert.strictEqual(platformOf(ANDROID), 'android');
  assert.strictEqual(platformOf(IPHONE), 'ios');
  assert.strictEqual(platformOf(WIN), 'windows');
  assert.strictEqual(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605'), 'mac');
  assert.strictEqual(platformOf('Mozilla/5.0 (X11; Linux x86_64) Firefox/130'), 'linux');
  assert.strictEqual(platformOf(''), 'other');
});

test('từ chối sự kiện lạ hoặc mã thiết bị sai', () => {
  const { stats, store } = mk();
  assert.strictEqual(stats.record({ type: 'hack', device: 'abcdefgh12' }, ANDROID), false);
  assert.strictEqual(stats.record({ type: 'installed', device: '../etc' }, ANDROID), false);
  assert.strictEqual(stats.record({ type: 'installed', device: 'AB' }, ANDROID), false);
  assert.strictEqual(stats.record({ type: 'installed' }, ANDROID), false);
  assert.strictEqual(stats.record(null || {}, ANDROID), false);
  assert.deepStrictEqual(store.data.pwa.devices, {});
});

test('mỗi thiết bị chỉ tính một lượt cài dù báo nhiều lần', () => {
  const { stats } = mk();
  for (let i = 0; i < 3; i++) stats.record({ type: 'installed', device: 'dev1abcdef' }, ANDROID);
  stats.record({ type: 'app_open', device: 'dev1abcdef' }, ANDROID);
  const s = stats.summary({ dayKey, nameOf: () => '' });
  assert.strictEqual(s.installs, 1);
  assert.strictEqual(s.active7, 1);
  assert.deepStrictEqual(s.byPlatform, { android: 1 });
});

test('iPhone: mở app lần đầu được tính là một lượt cài (không có sự kiện installed)', () => {
  const { stats } = mk();
  stats.record({ type: 'app_open', device: 'iosdevice01' }, IPHONE);
  const s = stats.summary({ dayKey, nameOf: () => '' });
  assert.strictEqual(s.installs, 1);
  assert.strictEqual(s.recent[0].source, 'app');
  assert.strictEqual(s.recent[0].platform, 'ios');
});

test('đếm riêng: bấm nút cài, thanh mời đã hiện (mỗi thiết bị một lần), người xem chưa cài', () => {
  const { stats } = mk();
  stats.record({ type: 'banner_shown', device: 'devaaaaaa1' }, ANDROID);
  stats.record({ type: 'banner_shown', device: 'devaaaaaa1' }, ANDROID);
  stats.record({ type: 'banner_shown', device: 'devbbbbbb2' }, WIN);
  stats.record({ type: 'install_click', device: 'devaaaaaa1' }, ANDROID);
  stats.record({ type: 'install_click', device: 'devaaaaaa1' }, ANDROID);
  stats.record({ type: 'installed', device: 'devaaaaaa1' }, ANDROID);
  const s = stats.summary({ dayKey, nameOf: () => '' });
  assert.strictEqual(s.bannerShown, 2);
  assert.strictEqual(s.clicks, 2);
  assert.strictEqual(s.installs, 1);
});

test('biểu đồ 30 ngày, lượt cài 7 ngày, và gắn tên thành viên nếu đã đăng nhập', () => {
  const { stats, store } = mk();
  stats.record({ type: 'installed', device: 'devmember01' }, WIN, 'u1');
  stats.record({ type: 'installed', device: 'devanon0001' }, ANDROID);
  store.data.pwa.devices.devold00001 = { first: 1, last: 1, platform: 'mac', installedAt: Date.now() - 20 * 86400000, source: 'event' };
  const s = stats.summary({ dayKey, nameOf: (id) => (id === 'u1' ? 'Lan' : '') });
  assert.strictEqual(s.chart.length, 30);
  assert.strictEqual(s.installs, 3);
  assert.strictEqual(s.installs7, 2);
  assert.strictEqual(s.installs30, 3);
  assert.strictEqual(s.chart.reduce((n, c) => n + c.installs, 0), 3);
  assert.strictEqual(s.recent.find((r) => r.platform === 'windows').member, 'Lan');
  assert.strictEqual(s.recent.find((r) => r.platform === 'android').member, '');
});
