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

test('API điểm: 500 điểm khi đăng ký, điểm danh +50 một lần mỗi ngày, mã giới thiệu qua link', async () => {
  const a = client(), b = client();
  await a('POST', '/api/register', { name: 'Chi', email: 'chi@example.com', password: 'longenough3' }, { 'x-forwarded-for': '10.1.1.1' });
  const p = await a('GET', '/api/points');
  assert.strictEqual(p.json.balance, 500);
  assert.match(p.json.refLink, /\/register\?ref=[0-9A-F]{8}$/);
  assert.strictEqual((await a('POST', '/api/points/checkin')).json.balance, 550);
  assert.strictEqual((await a('POST', '/api/points/checkin')).status, 400);
  assert.strictEqual((await a('GET', '/api/me')).json.points, 550);

  const code = p.json.refCode;
  await b('POST', '/api/register', { name: 'Dung', email: 'dung@example.com', password: 'longenough4', ref: code }, { 'x-forwarded-for': '10.2.2.2' });
  const after = await a('GET', '/api/points');
  assert.strictEqual(after.json.referrals.length, 1);
  assert.strictEqual(after.json.referrals[0].status, 'pending');
  assert.strictEqual(after.json.referrals[0].name, 'D***'); // che tên người được giới thiệu

  const admin = client();
  await admin('POST', '/api/login', { username: 'boss', password: 'AdminPass123' });
  const users = (await admin('GET', '/api/admin/users')).json.users;
  const chi = users.find((u) => u.email === 'chi@example.com');
  assert.strictEqual(chi.regIp, '10.1.1.1');
  assert.strictEqual((await admin('POST', `/api/admin/users/${chi.id}/points`, { amount: 100, note: 'thưởng' })).json.points, 650);
  assert.strictEqual((await a('GET', '/api/points')).json.history[0].reason, 'admin');
  assert.strictEqual((await admin('GET', '/api/points')).json.unlimited, true);
});
