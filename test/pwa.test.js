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
