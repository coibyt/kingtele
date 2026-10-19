const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createAuth } = require('../src/auth');
const { createAccountMail } = require('../src/account-mail');

async function boot({ verify = true, failSend = false } = {}) {
  const store = { data: { users: [], settings: { sessionSecret: 'secret', requireEmailVerify: verify } }, save: async () => {} };
  const config = { baseUrl: 'http://site.test', adminUser: 'admin', adminPassword: 'x', registrationOpen: true, maxUsers: 100, production: false };
  const mailer = { configured: true, sent: [], send: async (m) => { if (mailer.fail) throw new Error('smtp down'); mailer.sent.push(m); }, status: () => ({}) };
  mailer.fail = failSend;
  const accountMail = createAccountMail({ store, config, mailer });
  const auth = createAuth({ store, config, points: { initUser() {}, touchIp() {} }, accountMail });
  const app = express();
  app.use(express.json());
  app.post('/api/register', auth.register);
  app.post('/api/login', auth.login);
  app.use('/api', accountMail.publicRouter());
  app.get('/verify-email', (req, res) => accountMail.verifyPage(req, res));
  app.get('/unsubscribe', (req, res) => accountMail.unsubscribePage(req, res));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' }, body: JSON.stringify(body), redirect: 'manual' });
  return { store, mailer, url, post, close: () => server.close() };
}
const tokenOf = (mail) => /token=([\w-]+)/.exec(mail.text)[1];

test('đăng ký khi bật xác nhận: gửi email, chưa đăng nhập được cho tới khi bấm liên kết; email tiếng Việt theo ngôn ngữ', async () => {
  const t = await boot();
  const reg = await t.post('/api/register', { name: 'An', email: 'an@example.test', password: 'Password-1', lang: 'vi' });
  assert.strictEqual(reg.status, 201);
  assert.strictEqual((await reg.json()).verify, true);
  assert.ok(!reg.headers.get('set-cookie'), 'chưa cấp phiên');
  assert.strictEqual(t.mailer.sent.length, 1);
  assert.match(t.mailer.sent[0].subject, /Xác nhận/);
  const login1 = await t.post('/api/login', { username: 'an@example.test', password: 'Password-1' });
  assert.strictEqual(login1.status, 403);
  assert.strictEqual((await login1.json()).needVerify, true);
  const v = await fetch(`${t.url}/verify-email?token=${tokenOf(t.mailer.sent[0])}`, { redirect: 'manual' });
  assert.strictEqual(v.headers.get('location'), '/login?verified=1');
  assert.strictEqual((await t.post('/api/login', { username: 'an@example.test', password: 'Password-1' })).status, 200);
  const again = await fetch(`${t.url}/verify-email?token=${tokenOf(t.mailer.sent[0])}`, { redirect: 'manual' });
  assert.strictEqual(again.headers.get('location'), '/login?verified=0'); // dùng một lần
  t.close();
});

test('tắt xác nhận: đăng ký vào thẳng; gửi email lỗi khi bật thì không tạo tài khoản', async () => {
  const off = await boot({ verify: false });
  const r = await off.post('/api/register', { name: 'Bo', email: 'bo@example.test', password: 'Password-1' });
  assert.strictEqual(r.status, 201);
  assert.ok(r.headers.get('set-cookie'));
  assert.strictEqual(off.mailer.sent.length, 0);
  assert.strictEqual(off.store.data.users[0].emailVerified, undefined);
  off.close();

  const bad = await boot({ failSend: true });
  const r2 = await bad.post('/api/register', { name: 'Cu', email: 'cu@example.test', password: 'Password-1' });
  assert.strictEqual(r2.status, 502);
  assert.strictEqual(bad.store.data.users.length, 0);
  bad.close();
});

test('quên mật khẩu: không lộ email nào đã đăng ký, token một lần, đặt lại xong đăng nhập bằng mật khẩu mới', async () => {
  const t = await boot({ verify: false });
  await t.post('/api/register', { name: 'Di', email: 'di@example.test', password: 'Old-Password-1' });
  const none = await t.post('/api/forgot', { email: 'nobody@example.test' });
  assert.strictEqual(none.status, 200);
  assert.strictEqual(t.mailer.sent.length, 0);
  assert.strictEqual((await t.post('/api/forgot', { email: 'di@example.test', lang: 'en' })).status, 200);
  assert.strictEqual(t.mailer.sent.length, 1);
  assert.match(t.mailer.sent[0].subject, /Reset/);
  const token = tokenOf(t.mailer.sent[0]);
  assert.strictEqual((await t.post('/api/reset', { token: 'sai', password: 'New-Password-1' })).status, 400);
  assert.strictEqual((await t.post('/api/reset', { token, password: 'short' })).status, 400);
  assert.strictEqual((await t.post('/api/reset', { token, password: 'New-Password-1' })).status, 200);
  assert.strictEqual((await t.post('/api/login', { username: 'di@example.test', password: 'New-Password-1' })).status, 200);
  assert.strictEqual((await t.post('/api/login', { username: 'di@example.test', password: 'Old-Password-1' })).status, 401);
  assert.strictEqual((await t.post('/api/reset', { token, password: 'Another-Password-1' })).status, 400);
  t.close();
});

test('hủy nhận email quảng bá: chữ ký sai bị từ chối', async () => {
  const t = await boot({ verify: false });
  await t.post('/api/register', { name: 'Em', email: 'em@example.test', password: 'Password-1' });
  const u = t.store.data.users[0];
  assert.strictEqual((await fetch(`${t.url}/unsubscribe?u=${u.id}&t=${'x'.repeat(32)}`)).status, 400);
  assert.ok(!u.marketingOptOut);
  t.close();
});
