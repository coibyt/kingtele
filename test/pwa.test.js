const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pub = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));

function pngSize(file) {
  const b = fs.readFileSync(path.join(pub, file));
  assert.strictEqual(b.toString('latin1', 1, 4), 'PNG', `${file} không phải PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('manifest đủ điều kiện cài đặt (tên, start_url, standalone, biểu tượng 192/512 + maskable)', () => {
  assert.ok(manifest.name && manifest.short_name);
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.start_url, '/app');
  assert.strictEqual(manifest.scope, '/');
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose}`);
  assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'));
  for (const i of manifest.icons) {
    const [w, h] = pngSize(i.src.replace(/^\//, ''));
    assert.strictEqual(`${w}x${h}`, i.sizes, i.src);
  }
  for (const s of manifest.shortcuts) assert.ok(s.url.startsWith('/app'));
});

test('apple-touch-icon là PNG 180x180', () => {
  assert.deepStrictEqual(pngSize('assets/icons/apple-touch-icon.png'), [180, 180]);
});

test('mọi trang đều khai báo manifest, nạp pwa.js và có viewport-fit=cover (trừ trang tĩnh phụ)', () => {
  const pages = ['index.html', '../views/app.html', '../views/login.html', '../views/register.html', '../views/404.html', 'offline.html'];
  for (const p of pages) {
    const html = read(p);
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/, p);
    assert.match(html, /viewport-fit=cover/, p);
    assert.match(html, /\/assets\/pwa\.js/, p);
  }
  for (const p of pages.slice(0, 5)) assert.match(read(p), /apple-touch-icon/, p);
});

test('trang không dùng script/sự kiện nội tuyến (CSP script-src self)', () => {
  for (const p of ['index.html', '../views/app.html', '../views/login.html', '../views/register.html', '../views/404.html', 'offline.html']) {
    const html = read(p);
    assert.doesNotMatch(html, /\son[a-z]+="/i, `${p} có sự kiện nội tuyến`);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${p} có script nội tuyến`);
  }
});

test('trang chủ và bảng điều khiển có nút cài ứng dụng', () => {
  assert.match(read('index.html'), /data-install/);
  assert.match(read('../views/app.html'), /data-install/);
});

// ---- service worker ----
function loadSw() {
  const listeners = {};
  const cacheStore = new Map();
  const cache = {
    addAll: async (urls) => urls.forEach((u) => cacheStore.set(u, 'precached')),
    put: async (req, res) => cacheStore.set(typeof req === 'string' ? req : req.url, res),
    match: async (req) => cacheStore.get(typeof req === 'string' ? req : req.url),
  };
  const sandbox = {
    self: { addEventListener: (t, f) => { listeners[t] = f; }, location: { origin: 'https://kingtele.com' }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => [], match: async (r) => cacheStore.get(typeof r === 'string' ? r : r.url), delete: async () => true },
    URL, fetch: async () => { throw new Error('offline'); },
  };
  vm.runInNewContext(read('sw.js'), sandbox);
  return { listeners, cacheStore, sandbox };
}
const fetchEvt = (url, extra = {}) => {
  let responded = null;
  return { request: { method: 'GET', url, mode: 'cors', ...extra }, respondWith: (p) => { responded = p; }, get responded() { return responded; } };
};

test('service worker: không đụng tới API, POST, hay tên miền khác', () => {
  const { listeners } = loadSw();
  for (const e of [fetchEvt('https://kingtele.com/api/posts'), fetchEvt('https://kingtele.com/api/media/x.png'), fetchEvt('https://fonts.gstatic.com/a.woff2'), fetchEvt('https://kingtele.com/healthz'), fetchEvt('https://kingtele.com/x', { method: 'POST' })]) {
    listeners.fetch(e);
    assert.strictEqual(e.responded, null, e.request.url);
  }
});

test('service worker: điều hướng khi mất mạng trả về trang ngoại tuyến; tài nguyên dùng mạng trước, bản lưu khi mất mạng', async () => {
  const { listeners, cacheStore, sandbox } = loadSw();
  await listeners.install({ waitUntil: (p) => p });
  assert.ok(cacheStore.has('/offline.html'));
  const nav = fetchEvt('https://kingtele.com/app', { mode: 'navigate' });
  listeners.fetch(nav);
  assert.strictEqual(await nav.responded, 'precached');

  // có mạng: lấy bản mới và lưu lại; mất mạng: dùng bản đã lưu
  sandbox.fetch = async () => ({ ok: true, type: 'basic', clone() { return 'FRESH'; } });
  const e1 = fetchEvt('https://kingtele.com/assets/app.js'); listeners.fetch(e1);
  const fresh = await e1.responded;
  assert.strictEqual(fresh.ok, true);
  sandbox.fetch = async () => { throw new Error('offline'); };
  const e2 = fetchEvt('https://kingtele.com/assets/app.js'); listeners.fetch(e2);
  assert.strictEqual(await e2.responded, 'FRESH');
  const e3 = fetchEvt('https://kingtele.com/assets/chua-co.js'); listeners.fetch(e3);
  await assert.rejects(e3.responded);
});

test('server phục vụ service worker không bị lưu đệm cứng', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /no-cache/);
});

// ---- thanh mời cài ứng dụng: chạy chính public/assets/pwa.js với DOM giả ----
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.className = ''; this.listeners = {}; this.parent = null; this.hidden = false; }
  append(...n) { n.forEach((x) => { if (x instanceof El) x.parent = this; this.children.push(x); }); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  click() { (this.listeners.click || []).forEach((f) => f({ target: this })); }
  find(cls) { for (const c of this.children) { if (c instanceof El) { if (c.className.split(' ').includes(cls)) return c; const d = c.find(cls); if (d) return d; } } return null; }
}

function harness({ ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36', platform = 'Linux armv8l', touch = 5, standalone = false, storage = {}, related = null } = {}) {
  const docL = {}, winL = {};
  const classes = new Set();
  const body = new El('body');
  body.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c) };
  const sandbox = {
    navigator: { userAgent: ua, platform, maxTouchPoints: touch, serviceWorker: undefined, ...(related ? { getInstalledRelatedApps: related } : {}) },
    location: { protocol: 'http:', hostname: 'example.test' },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    document: {
      body, createElement: (t) => new El(t), querySelectorAll: () => [],
      addEventListener: (t, f) => { (docL[t] = docL[t] || []).push(f); },
    },
    Date, Number, String,
  };
  sandbox.window = { addEventListener: (t, f) => { (winL[t] = winL[t] || []).push(f); }, matchMedia: () => ({ matches: standalone, addEventListener() {} }) };
  vm.runInNewContext(read('assets/pwa.js'), sandbox);
  const fireDoc = (t) => (docL[t] || []).forEach((f) => f({ target: body }));
  const fireWin = (t, ev = {}) => (winL[t] || []).forEach((f) => f({ preventDefault() {}, ...ev }));
  const banner = () => body.find('install-banner');
  return { storage, fireDoc, fireWin, banner, hasClass: (c) => classes.has(c), api: sandbox.window.KT_PWA };
}
const tick = () => new Promise((r) => setImmediate(r));

test('quyết định hiện thanh mời cài', () => {
  const { shouldShowBanner: f } = harness().api;
  const base = { standalone: false, installedFlag: false, snoozedUntil: 0, now: 1000, hasPrompt: true, isIOS: false, inApp: false };
  assert.strictEqual(f(base), true);
  assert.strictEqual(f({ ...base, standalone: true }), false);
  assert.strictEqual(f({ ...base, installedFlag: true }), false);
  assert.strictEqual(f({ ...base, snoozedUntil: 2000 }), false);
  assert.strictEqual(f({ ...base, snoozedUntil: 500 }), true);
  assert.strictEqual(f({ ...base, hasPrompt: false }), false);                  // trình duyệt không cài được
  assert.strictEqual(f({ ...base, hasPrompt: false, isIOS: true }), true);      // iPhone Safari: cài thủ công
  assert.strictEqual(f({ ...base, hasPrompt: false, isIOS: true, inApp: true }), false);
});

test('khách chưa cài: có sự kiện cài đặt thì thanh nổi bật xuất hiện', () => {
  const h = harness();
  h.fireDoc('DOMContentLoaded');
  assert.strictEqual(h.banner(), null);               // chưa chắc cài được -> chưa hiện
  h.fireWin('beforeinstallprompt');
  assert.ok(h.banner());
  assert.ok(h.hasClass('has-install-banner'));
  assert.ok(h.banner().find('ib-go'));
});

test('khách đã cài (đang chạy trong app) thì không bao giờ hiện, và được ghi nhớ đã cài', () => {
  const h = harness({ standalone: true });
  h.fireDoc('DOMContentLoaded'); h.fireWin('beforeinstallprompt');
  assert.strictEqual(h.banner(), null);
  assert.strictEqual(h.storage.kt_app_installed, '1');
});

test('đã được ghi nhớ là đã cài (mở lại bằng tab thường) thì không hiện', () => {
  const h = harness({ storage: { kt_app_installed: '1' } });
  h.fireDoc('DOMContentLoaded'); h.fireWin('beforeinstallprompt');
  assert.strictEqual(h.banner(), null);
});

test('Chrome báo ứng dụng đã cài trên máy (getInstalledRelatedApps) thì ẩn thanh', async () => {
  const h = harness({ related: async () => [{ platform: 'webapp', url: 'https://kingtele.com/manifest.webmanifest' }] });
  await tick();
  h.fireDoc('DOMContentLoaded'); h.fireWin('beforeinstallprompt');
  assert.strictEqual(h.banner(), null);
  assert.strictEqual(h.storage.kt_app_installed, '1');
});

test('bấm × thì ẩn và nhắc lại sau 1 ngày', () => {
  const h = harness();
  h.fireDoc('DOMContentLoaded'); h.fireWin('beforeinstallprompt');
  h.banner().find('ib-close').click();
  assert.strictEqual(h.banner(), null);
  assert.ok(Number(h.storage.kt_install_snooze) > Date.now() + 23 * 3600e3);
  h.fireWin('beforeinstallprompt');
  assert.strictEqual(h.banner(), null); // đang trong thời gian tạm ẩn

  const later = harness({ storage: { kt_install_snooze: String(Date.now() - 1000) } }); // hết hạn tạm ẩn
  later.fireDoc('DOMContentLoaded'); later.fireWin('beforeinstallprompt');
  assert.ok(later.banner());
});

test('cài xong (appinstalled) thì thanh biến mất ngay và không hiện lại', () => {
  const h = harness();
  h.fireDoc('DOMContentLoaded'); h.fireWin('beforeinstallprompt');
  assert.ok(h.banner());
  h.fireWin('appinstalled');
  assert.strictEqual(h.banner(), null);
  assert.strictEqual(h.storage.kt_app_installed, '1');
  assert.strictEqual(h.hasClass('has-install-banner'), false);
  h.fireWin('beforeinstallprompt');
  assert.strictEqual(h.banner(), null);
});

test('iPhone Safari thấy thanh mời (cài thủ công); trình duyệt nhúng và Firefox máy tính thì không', () => {
  const ios = harness({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile Safari/604.1', platform: 'iPhone' });
  ios.fireDoc('DOMContentLoaded');
  assert.ok(ios.banner());

  const fb = harness({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile [FBAN/FBIOS;FBAV/450]', platform: 'iPhone' });
  fb.fireDoc('DOMContentLoaded');
  assert.strictEqual(fb.banner(), null);

  const ff = harness({ ua: 'Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0', platform: 'Win32', touch: 0 });
  ff.fireDoc('DOMContentLoaded');
  assert.strictEqual(ff.banner(), null);
});
