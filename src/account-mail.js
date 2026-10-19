'use strict';
// Email tài khoản: xác nhận email khi đăng ký (admin bật/tắt), quên mật khẩu, và email quảng bá có link hủy nhận.
// Token xác nhận/đặt lại mật khẩu chỉ lưu dạng băm SHA-256, dùng một lần và có hạn.
const crypto = require('crypto');
const express = require('express');
const M = require('./mail-text');
const { limiter, hashPassword } = require('./auth');
const tgSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const VERIFY_TTL = 24 * 3600 * 1000;
const RESET_TTL = 3600 * 1000;
const COOLDOWN = 60 * 1000;
const MAX_BROADCAST = 300;
const GAP_MS = 1500;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const langOf = (l) => (typeof l === 'string' && /^[a-z]{2}$/.test(l) ? l : 'en');

function createAccountMail({ store, config, mailer }) {
  const d = () => store.data;
  const base = () => (config.baseUrl || 'https://kingtele.com').replace(/\/+$/, '');
  const required = () => !!d().settings.requireEmailVerify;
  const byEmail = (email) => d().users.find((u) => u.email === email);
  const forgotIp = limiter(8, 15 * 60000);
  const forgotMail = limiter(3, 3600000);
  const resendIp = limiter(8, 15 * 60000);
  let job = null;

  async function sendVerification(user, lang) {
    const token = newToken();
    const mail = M.verify(lang, user.name, `${base()}/verify-email?token=${token}`);
    await mailer.send({ to: user.email, ...mail });
    // Chỉ ghi token sau khi gửi thành công để không để lại token thừa.
    Object.assign(user, { verifyHash: sha(token), verifyExpires: Date.now() + VERIFY_TTL, verifySentAt: Date.now(), lang: langOf(lang) });
  }

  const unsubSig = (id) => crypto.createHmac('sha256', d().settings.sessionSecret).update(`unsub:${id}`).digest('base64url').slice(0, 32);
  const unsubUrl = (u) => `${base()}/unsubscribe?u=${u.id}&t=${unsubSig(u.id)}`;

  /** Router công khai gắn vào /api (trước bước xác thực). */
  function publicRouter() {
    const r = express.Router();
    const csrf = (req) => req.get('x-requested-with') === 'postpilot';

    r.post('/forgot', wrap(async (req, res) => {
      if (!csrf(req)) return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
      if (!mailer.configured) throw bad('Chức năng gửi email tạm thời chưa khả dụng.', 503);
      const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 254);
      if (forgotIp.blocked(req.ip)) throw bad('Bạn yêu cầu quá nhiều lần. Vui lòng thử lại sau.', 429);
      forgotIp.hit(req.ip);
      const u = EMAIL_RE.test(email) ? byEmail(email) : null;
      // Luôn trả lời giống nhau để không lộ email nào đã đăng ký.
      if (u && !u.disabled && !forgotMail.blocked(email) && Date.now() - (u.resetSentAt || 0) > COOLDOWN) {
        forgotMail.hit(email);
        const token = newToken();
        try {
          await mailer.send({ to: u.email, ...M.reset(langOf(req.body.lang || u.lang), u.name, `${base()}/reset?token=${token}`) });
          Object.assign(u, { resetHash: sha(token), resetExpires: Date.now() + RESET_TTL, resetSentAt: Date.now() });
          await store.save();
        } catch (e) { console.error('[mail] password reset email failed:', e.code || e.message); }
      }
      res.json({ ok: true });
    }));

    r.post('/reset', wrap(async (req, res) => {
      if (!csrf(req)) return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
      const token = String((req.body || {}).token || '');
      const password = String((req.body || {}).password || '');
      if (password.length < 8 || password.length > 200) throw bad('Mật khẩu mới cần từ 8 ký tự trở lên');
      const h = sha(token);
      const u = token && d().users.find((x) => x.resetHash && x.resetHash === h && x.resetExpires > Date.now());
      if (!u) throw bad('Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.');
      u.passwordHash = await hashPassword(password);
      u.resetHash = ''; u.resetExpires = 0;
      if (u.emailVerified === false) u.emailVerified = true; // đã chứng minh quyền dùng hộp thư
      await store.save();
      res.json({ ok: true });
    }));

    r.post('/verify/resend', wrap(async (req, res) => {
      if (!csrf(req)) return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
      if (!mailer.configured) throw bad('Chức năng gửi email tạm thời chưa khả dụng.', 503);
      if (resendIp.blocked(req.ip)) throw bad('Bạn yêu cầu quá nhiều lần. Vui lòng thử lại sau.', 429);
      resendIp.hit(req.ip);
      const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 254);
      const u = EMAIL_RE.test(email) ? byEmail(email) : null;
      if (u && u.emailVerified === false && !u.disabled && Date.now() - (u.verifySentAt || 0) > COOLDOWN) {
        try { await sendVerification(u, req.body.lang || u.lang); await store.save(); }
        catch (e) { console.error('[mail] resend verification email failed:', e.code || e.message); }
      }
      res.json({ ok: true });
    }));
    return r;
  }

  /** GET /verify-email?token=...: xác nhận rồi chuyển về trang đăng nhập. */
  async function verifyPage(req, res) {
    const token = String(req.query.token || '');
    const h = sha(token);
    const u = token && d().users.find((x) => x.verifyHash && x.verifyHash === h && x.verifyExpires > Date.now());
    if (!u) return res.redirect('/login?verified=0');
    u.emailVerified = true; u.verifyHash = ''; u.verifyExpires = 0;
    await store.save();
    res.redirect('/login?verified=1');
  }

  /** GET /unsubscribe: hủy nhận email quảng bá (không cần đăng nhập, có chữ ký HMAC). */
  async function unsubscribePage(req, res) {
    const u = d().users.find((x) => x.id === String(req.query.u || ''));
    const t = String(req.query.t || '');
    const ok = u && t.length === 32 && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(unsubSig(u.id)));
    if (ok) { u.marketingOptOut = true; await store.save(); }
    res.status(ok ? 200 : 400).type('html').send(M.unsubPage(ok));
  }

  /** Router quản trị gắn vào /api/admin/email. */
  function adminRouter() {
    const r = express.Router();
    const recipients = (audience) => d().users.filter((u) => u.email && !u.disabled && !u.marketingOptOut && u.emailVerified !== false && (audience !== 'verified' || u.emailVerified === true));

    r.get('/status', (req, res) => {
      const users = d().users;
      res.json({
        ...mailer.status(), requireEmailVerify: required(),
        counts: { users: users.length, verified: users.filter((u) => u.emailVerified === true).length, unverified: users.filter((u) => u.emailVerified === false).length, optedOut: users.filter((u) => u.marketingOptOut).length },
        audience: { all: recipients('all').length, verified: recipients('verified').length },
        job,
      });
    });

    r.put('/settings', wrap(async (req, res) => {
      const on = !!(req.body && req.body.requireEmailVerify);
      if (on && !mailer.configured) throw bad('Chưa cấu hình SMTP nên chưa thể bật xác nhận email.');
      d().settings.requireEmailVerify = on;
      await store.save();
      res.json({ ok: true });
    }));

    r.post('/test', wrap(async (req, res) => {
      const to = String((req.body || {}).to || '').trim().toLowerCase();
      if (!EMAIL_RE.test(to)) throw bad('Email không hợp lệ');
      if (!mailer.configured) throw bad('Chưa cấu hình SMTP');
      try { await mailer.send({ to, ...M.test('vi') }); } catch (e) { throw bad(`Không gửi được email: ${e.code || 'SMTP'}`); }
      res.json({ ok: true });
    }));

    r.post('/broadcast', wrap(async (req, res) => {
      const subject = String((req.body || {}).subject || '').trim().slice(0, 150);
      const body = String((req.body || {}).body || '').trim().slice(0, 10000);
      if (!subject || !body) throw bad('Nhập tiêu đề và nội dung email');
      if (!mailer.configured) throw bad('Chưa cấu hình SMTP');
      if (job && !job.done) throw bad('Đang có đợt gửi khác, vui lòng chờ');
      const list = recipients(req.body.audience).slice(0, MAX_BROADCAST);
      if (!list.length) throw bad('Chưa có người nào để gửi');
      const j = job = { id: crypto.randomUUID(), total: list.length, sent: 0, failed: 0, done: false, startedAt: Date.now() };
      (async () => {
        for (const u of list) {
          try {
            const personal = body.replace(/\{ten\}/gi, u.name);
            const mail = M.marketing(u.lang, subject, personal, unsubUrl(u));
            await mailer.send({ to: u.email, ...mail, headers: { 'List-Unsubscribe': `<${unsubUrl(u)}>` } });
            j.sent++;
          } catch { j.failed++; }
          await tgSleep(GAP_MS);
        }
        j.done = true;
      })().catch(() => { j.done = true; });
      res.status(202).json(j);
    }));
    return r;
  }

  return { required, sendVerification, publicRouter, adminRouter, verifyPage, unsubscribePage };
}

module.exports = { createAccountMail };
