const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let proc, dir;

const client = () => {
  let cookie = '';
  const call = async (method, url, body, extra = {}) => {
    const r = await fetch(BASE + url, {
      method,
      headers: { 'x-requested-with': 'postpilot', cookie, ...(body && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...extra },
      body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = {}; try { json = JSON.parse(text); } catch { /* không phải JSON */ }
    return { status: r.status, json };
  };
  return call;
};

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-mu-'));
  proc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'AdminPass123', NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server không khởi động');
});
test.after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('đăng ký: validate, trùng email, tự đăng nhập', async () => {
  const a = client();
  assert.strictEqual((await a('POST', '/api/register', { name: 'A', email: 'x', password: '12345678' })).status, 400);
  assert.strictEqual((await a('POST', '/api/register', { name: 'An', email: 'an@example.com', password: 'short' })).status, 400);
  assert.strictEqual((await a('POST', '/api/register', { name: 'An', email: 'an@example.com', password: 'longenough1', website: 'bot' })).status, 400);
  assert.strictEqual((await a('POST', '/api/register', { name: 'An', email: 'An@Example.com', password: 'longenough1' })).status, 201);
  assert.strictEqual((await a('GET', '/api/me')).json.user.email, 'an@example.com');
  assert.strictEqual((await client()('POST', '/api/register', { name: 'An2', email: 'an@example.com', password: 'longenough1' })).status, 409);
});

test('đăng nhập bằng email, sai mật khẩu bị từ chối', async () => {
  const c = client();
  assert.strictEqual((await c('POST', '/api/login', { username: 'an@example.com', password: 'wrong-pass' })).status, 401);
  assert.strictEqual((await c('POST', '/api/login', { username: 'an@example.com', password: 'longenough1' })).status, 200);
});

test('dữ liệu mỗi thành viên tách biệt', async () => {
  const a = client(), b = client();
  await a('POST', '/api/login', { username: 'an@example.com', password: 'longenough1' });
  await b('POST', '/api/register', { name: 'Binh', email: 'binh@example.com', password: 'longenough2' });

  // chưa có bot -> không thêm được nhóm
  assert.strictEqual((await a('POST', '/api/groups', { chatId: '@abc' })).status, 400);

  // upload của A: B không xem được, không gắn được vào bài
  const up = await a('POST', '/api/upload', PNG, { 'content-type': 'application/octet-stream' });
  assert.strictEqual(up.status, 201);
  assert.strictEqual((await a('GET', `/api/media/${up.json.file}`)).status, 200);
  assert.strictEqual((await b('GET', `/api/media/${up.json.file}`)).status, 404);

  assert.deepStrictEqual((await b('GET', '/api/groups')).json, []);
  assert.deepStrictEqual((await b('GET', '/api/posts')).json, []);
  assert.strictEqual((await b('GET', '/api/overview')).json.groups, 0);
  assert.strictEqual((await b('GET', '/api/admin/users')).status, 403);
});

test('admin xem/khoá/đặt lại mật khẩu/xoá thành viên', async () => {
  const admin = client();
  assert.strictEqual((await admin('POST', '/api/login', { username: 'boss', password: 'AdminPass123' })).status, 200);
  const list = await admin('GET', '/api/admin/users');
  assert.strictEqual(list.json.totals.users, 2);
  const binh = list.json.users.find((u) => u.email === 'binh@example.com');

  await admin('POST', `/api/admin/users/${binh.id}/disable`, { disabled: true });
  const b = client();
  assert.strictEqual((await b('POST', '/api/login', { username: 'binh@example.com', password: 'longenough2' })).status, 403);
  await admin('POST', `/api/admin/users/${binh.id}/disable`, { disabled: false });

  const reset = await admin('POST', `/api/admin/users/${binh.id}/reset-password`);
  assert.strictEqual((await b('POST', '/api/login', { username: 'binh@example.com', password: reset.json.password })).status, 200);

  assert.strictEqual((await admin('DELETE', `/api/admin/users/${binh.id}`)).status, 200);
  assert.strictEqual((await b('GET', '/api/me')).status, 401); // phiên cũ mất hiệu lực
});

test('đổi mật khẩu cần mật khẩu hiện tại', async () => {
  const a = client();
  await a('POST', '/api/login', { username: 'an@example.com', password: 'longenough1' });
  assert.strictEqual((await a('POST', '/api/account/password', { current: 'nope', next: 'newpassword1' })).status, 400);
  assert.strictEqual((await a('POST', '/api/account/password', { current: 'longenough1', next: 'newpassword1' })).status, 200);
  const c = client();
  assert.strictEqual((await c('POST', '/api/login', { username: 'an@example.com', password: 'newpassword1' })).status, 200);
});
