const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createTraffic, sourceOf, pageOf, platformOf } = require('../src/traffic');

const mk = () => {
  const store = { data: { traffic: { days: {} } }, saves: 0, save() { this.saves++; return Promise.resolve(); } };
  return { store, t: createTraffic({ store, tz: 'UTC' }) };
};
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const FBAPP = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]';
const T0 = Date.UTC(2026, 9, 15, 10, 0, 0);

test('nhận diện nguồn truy cập', () => {
  assert.strictEqual(sourceOf('https://l.facebook.com/l.php?u=x', WIN, 'kingtele.com'), 'facebook');
  assert.strictEqual(sourceOf('https://m.facebook.com/', ANDROID, 'kingtele.com'), 'facebook');
  assert.strictEqual(sourceOf('', FBAPP, 'kingtele.com'), 'facebook');                 // trình duyệt nhúng của app Facebook, không có referrer
  assert.strictEqual(sourceOf('https://www.google.com/search?q=a', WIN, 'kingtele.com'), 'google');
  assert.strictEqual(sourceOf('https://t.me/abc', WIN, 'kingtele.com'), 'telegram');
  assert.strictEqual(sourceOf('https://zalo.me/x', WIN, 'kingtele.com'), 'zalo');
  assert.strictEqual(sourceOf('', WIN, 'kingtele.com'), 'direct');
  assert.strictEqual(sourceOf('https://kingtele.com/register', WIN, 'kingtele.com'), 'direct'); // điều hướng nội bộ
  assert.strictEqual(sourceOf('https://example.org/', WIN, 'kingtele.com'), 'other');
  assert.strictEqual(sourceOf('không phải url', WIN, 'kingtele.com'), 'direct');
});

test('nhóm trang và thiết bị', () => {
  assert.deepStrictEqual(['/', '/login', '/register?ref=A1', '/app', '/app/x', '/abc'].map(pageOf), ['home', 'login', 'register', 'app', 'app', 'other']);
  assert.strictEqual(platformOf(ANDROID), 'android');
  assert.strictEqual(platformOf(WIN), 'windows');
});

test('khách duy nhất trong ngày chỉ tính một lần, lượt xem tính mọi lần mở trang', () => {
  const { t } = mk();
  const ua = { ua: WIN, siteHost: 'kingtele.com' };
  t.record({ type: 'view', vid: 'visitor0001', path: '/' }, ua, T0);
  t.record({ type: 'view', vid: 'visitor0001', path: '/register' }, ua, T0 + 1000);
  t.record({ type: 'view', vid: 'visitor0002', path: '/' }, ua, T0 + 2000);
  const s = t.summary({}, T0 + 3000);
  assert.strictEqual(s.today.visitors, 2);
  assert.strictEqual(s.today.views, 3);
});

test('"đang xem": theo ping trong 90 giây, rời trang thì biến mất', () => {
  const { t } = mk();
  const ua = { ua: ANDROID };
  t.record({ type: 'view', vid: 'visitor0001', path: '/' }, ua, T0);
  t.record({ type: 'view', vid: 'visitor0002', path: '/register' }, ua, T0);
  t.record({ type: 'view', vid: 'visitor0003', path: '/app' }, ua, T0);
  let s = t.summary({}, T0 + 10000);
  assert.strictEqual(s.online, 3);
  assert.deepStrictEqual(s.onlineByPage, { home: 1, register: 1, app: 1 });

  t.record({ type: 'ping', vid: 'visitor0001', path: '/' }, ua, T0 + 60000);   // còn xem
  t.record({ type: 'leave', vid: 'visitor0002' }, ua, T0 + 61000);             // rời đi
  s = t.summary({}, T0 + 100000);                                              // visitor0003 đã quá 90 giây không báo
  assert.strictEqual(s.online, 1);
  assert.deepStrictEqual(s.onlineByPage, { home: 1 });
  assert.strictEqual(s.today.visitors, 3);                                      // số khách trong ngày vẫn giữ nguyên
});

test('ping không làm tăng lượt xem; bot bị bỏ qua; dữ liệu sai bị từ chối', () => {
  const { t } = mk();
  assert.strictEqual(t.record({ type: 'view', vid: 'visitor0001', path: '/' }, { ua: WIN }, T0), 'ok');
  t.record({ type: 'ping', vid: 'visitor0001', path: '/' }, { ua: WIN }, T0 + 30000);
  assert.strictEqual(t.summary({}, T0 + 31000).today.views, 1);
  assert.strictEqual(t.record({ type: 'view', vid: 'botvisitor1', path: '/' }, { ua: 'Googlebot/2.1' }, T0), 'ignored');
  assert.strictEqual(t.record({ type: 'view', vid: 'x', path: '/' }, { ua: WIN }, T0), 'invalid');
  assert.strictEqual(t.record({ type: 'drop', vid: 'visitor0009', path: '/' }, { ua: WIN }, T0), 'invalid');
  assert.strictEqual(t.summary({}, T0 + 31000).today.visitors, 1);
});

test('so sánh hôm qua, đăng ký, nguồn và thiết bị 7 ngày, biểu đồ 30 ngày', () => {
  const { t } = mk();
  const DAY = 86400000;
  t.record({ type: 'view', vid: 'visitor0001', path: '/', ref: 'https://l.facebook.com/' }, { ua: ANDROID, siteHost: 'x' }, T0 - DAY);
  t.record({ type: 'view', vid: 'visitor0002', path: '/' }, { ua: WIN }, T0 - DAY);
  t.record({ type: 'view', vid: 'visitor0003', path: '/', ref: 'https://www.google.com/' }, { ua: WIN }, T0);
  const s = t.summary({ signupsByDay: { '2026-10-15': 2, '2026-10-14': 1 } }, T0 + 1000);
  assert.strictEqual(s.today.visitors, 1);
  assert.strictEqual(s.yesterday.visitors, 2);
  assert.strictEqual(s.today.signups, 2);
  assert.strictEqual(s.yesterday.signups, 1);
  assert.deepStrictEqual(s.sources, { facebook: 1, direct: 1, google: 1 });
  assert.deepStrictEqual(s.platforms, { android: 1, windows: 2 });
  assert.strictEqual(s.chart.length, 30);
  assert.strictEqual(s.chart[29].visitors, 1);
  assert.strictEqual(s.chart[28].visitors, 2);
  assert.strictEqual(s.visitors7, 3);
});

test('chỉ ghi đĩa khi có thay đổi (không ghi mỗi sự kiện)', async () => {
  const { t, store } = mk();
  await t.flush();
  assert.strictEqual(store.saves, 0);
  for (let i = 0; i < 20; i++) t.record({ type: 'ping', vid: 'visitor0001', path: '/' }, { ua: WIN }, T0 + i);
  assert.strictEqual(store.saves, 0);
  await t.flush();
  assert.strictEqual(store.saves, 1);
  await t.flush();
  assert.strictEqual(store.saves, 1);
});

// ---- phía trình duyệt: analytics.js ----
function runClient({ dnt = false, pathname = '/', referrer = '', visibility = 'visible', storage = {} } = {}) {
  const calls = [], winL = {}, docL = {}, intervals = [];
  const sandbox = {
    navigator: { doNotTrack: dnt ? '1' : null },
    location: { pathname },
    document: { referrer, visibilityState: visibility, addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); } },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    fetch: (url, opts) => { calls.push({ url, ...JSON.parse(opts.body), headers: opts.headers }); return Promise.resolve(); },
    setInterval: (f, ms) => { intervals.push({ f, ms }); return 1; },
    Uint8Array, Array, Math, JSON, RegExp,
  };
  sandbox.window = { addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'analytics.js'), 'utf8'), sandbox);
  return { calls, intervals, storage, fireWin: (t) => (winL[t] || []).forEach((f) => f()), fireDoc: (t) => (docL[t] || []).forEach((f) => f()), sandbox };
}

test('analytics.js: gửi view khi mở trang, ping mỗi 30 giây, leave khi rời', () => {
  const c = runClient({ pathname: '/register', referrer: 'https://l.facebook.com/' });
  assert.strictEqual(c.calls.length, 1);
  assert.deepStrictEqual([c.calls[0].type, c.calls[0].path, c.calls[0].ref], ['view', '/register', 'https://l.facebook.com/']);
  assert.match(c.calls[0].vid, /^[a-z0-9]{8,40}$/);
  assert.strictEqual(c.calls[0].url, '/api/track');
  assert.strictEqual(c.calls[0].headers['x-requested-with'], 'postpilot');
  assert.strictEqual(c.intervals[0].ms, 30000);
  c.intervals[0].f();
  assert.strictEqual(c.calls[1].type, 'ping');
  assert.strictEqual(c.calls[1].ref, '');                 // chỉ gửi referrer ở lượt view
  c.fireWin('pagehide');
  assert.strictEqual(c.calls[2].type, 'leave');
});

test('analytics.js: tab bị ẩn thì không ping; tôn trọng Do Not Track; dùng chung mã thiết bị', () => {
  const hidden = runClient({ visibility: 'hidden' });
  const before = hidden.calls.length;
  hidden.intervals[0].f();
  assert.strictEqual(hidden.calls.length, before);

  const dnt = runClient({ dnt: true });
  assert.strictEqual(dnt.calls.length, 0);
  assert.strictEqual(dnt.intervals.length, 0);

  const a = runClient({ storage: { kt_device: 'devicesame01' } });
  assert.strictEqual(a.calls[0].vid, 'devicesame01');
});
