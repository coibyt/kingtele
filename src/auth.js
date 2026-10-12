'use strict';
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'pp_session';
const TTL = 7 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const b64 = (s) => Buffer.from(s).toString('base64url');

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 64);
  const exp = Buffer.from(k, 'base64');
  return exp.length === key.length && crypto.timingSafeEqual(exp, key);
}

/** Giới hạn số lần thử theo khoá (IP / email). */
function limiter(max, windowMs) {
  const m = new Map();
  const live = (k) => { const e = m.get(k); if (e && e.until > Date.now()) return e; m.delete(k); return null; };
  return {
    blocked: (k) => { const e = live(k); return !!e && e.count >= max; },
    hit: (k) => { const e = live(k) || { count: 0, until: Date.now() + windowMs }; e.count++; m.set(k, e); },
    reset: (k) => m.delete(k),
  };
}

function createAuth({ store, config }) {
  const secret = () => store.data.settings.sessionSecret;
  const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const adminUser = () => ({ id: 'admin', role: 'admin', name: config.adminUser, email: '' });
  const publicUser = (u) => ({ id: u.id, role: 'user', name: u.name, email: u.email });
  const DUMMY = hashPassword('dummy-password-for-timing');

  function issue(id) {
    const payload = b64(JSON.stringify({ u: id, exp: Date.now() + TTL }));
    return `${payload}.${sign(payload)}`;
  }

  function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = sign(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return d.exp > Date.now() ? d : null;
    } catch { return null; }
  }

  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  /** Người dùng hiện tại (đã kiểm tra còn tồn tại và chưa bị khoá) hoặc null. */
  function session(req) {
    const d = verify(parseCookies(req)[COOKIE]);
    if (!d) return null;
    if (d.u === 'admin') return adminUser();
    const u = store.data.users.find((x) => x.id === d.u);
    return u && !u.disabled ? publicUser(u) : null;
  }

  function setCookie(res, req, value, maxAge) {
    const secure = req.secure || config.production;
    res.append('Set-Cookie',
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAge / 1000)}${secure ? '; Secure' : ''}`);
  }

  const loginIp = limiter(10, 15 * 60000);
  const loginId = limiter(8, 15 * 60000);
  const regIp = limiter(5, 60 * 60000);

  async function login(req, res) {
    const ip = req.ip;
    const ident = String((req.body || {}).username || '').trim().toLowerCase().slice(0, 254);
    const password = String((req.body || {}).password || '').slice(0, 200);
    if (loginIp.blocked(ip) || loginId.blocked(ident)) {
      return res.status(429).json({ error: 'Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.' });
    }
    let id = null, locked = false;
    if (ident && ident === String(config.adminUser).toLowerCase()) {
      if (safeEq(password, config.adminPassword)) id = 'admin';
    } else {
      const u = store.data.users.find((x) => x.email === ident);
      const ok = await verifyPassword(password, u ? u.passwordHash : await DUMMY);
      if (u && ok) { if (u.disabled) locked = true; else id = u.id; }
    }
    if (locked) return res.status(403).json({ error: 'Tài khoản đã bị khoá. Liên hệ quản trị viên.' });
    if (!id) {
      loginIp.hit(ip); loginId.hit(ident);
      return res.status(401).json({ error: 'Sai email hoặc mật khẩu' });
    }
    loginIp.reset(ip); loginId.reset(ident);
    setCookie(res, req, issue(id), TTL);
    res.json({ ok: true });
  }

  async function register(req, res) {
    if (!config.registrationOpen) return res.status(403).json({ error: 'Hiện chưa mở đăng ký tài khoản mới.' });
    const b = req.body || {};
    if (b.website) return res.status(400).json({ error: 'Yêu cầu không hợp lệ' }); // honeypot chống bot
    if (regIp.blocked(req.ip)) return res.status(429).json({ error: 'Bạn tạo tài khoản quá nhiều lần. Thử lại sau.' });
    const name = String(b.name || '').trim().slice(0, 60);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Nhập họ tên (ít nhất 2 ký tự)' });
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Email không hợp lệ' });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Mật khẩu cần từ 8 ký tự trở lên' });
    if (email === String(config.adminUser).toLowerCase() || store.data.users.some((u) => u.email === email)) {
      regIp.hit(req.ip);
      return res.status(409).json({ error: 'Email này đã được đăng ký. Hãy đăng nhập.' });
    }
    if (store.data.users.length >= config.maxUsers) return res.status(403).json({ error: 'Hệ thống đã đạt giới hạn thành viên.' });
    regIp.hit(req.ip);
    const user = {
      id: crypto.randomUUID(), name, email, passwordHash: await hashPassword(password),
      botToken: '', timezone: '', disabled: false, createdAt: Date.now(),
    };
    store.data.users.push(user);
    await store.save();
    setCookie(res, req, issue(user.id), TTL);
    res.status(201).json({ ok: true });
  }

  async function changePassword(req, res) {
    if (req.user.id === 'admin') return res.status(400).json({ error: 'Tài khoản quản trị đổi mật khẩu qua biến môi trường ADMIN_PASSWORD.' });
    const { current, next } = req.body || {};
    const u = store.data.users.find((x) => x.id === req.user.id);
    if (!u || !(await verifyPassword(String(current || ''), u.passwordHash))) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
    if (String(next || '').length < 8 || String(next).length > 200) return res.status(400).json({ error: 'Mật khẩu mới cần từ 8 ký tự trở lên' });
    u.passwordHash = await hashPassword(String(next));
    await store.save();
    res.json({ ok: true });
  }

  function logout(req, res) {
    setCookie(res, req, '', 0);
    res.json({ ok: true });
  }

  /** Chặn API khi chưa đăng nhập; mutation phải kèm header chống CSRF. */
  function requireAuth(req, res, next) {
    const user = session(req);
    if (!user) return res.status(401).json({ error: 'Chưa đăng nhập' });
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'postpilot') {
      return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
    }
    req.user = user;
    next();
  }

  const requireAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Chỉ quản trị viên' }));

  return { login, register, changePassword, logout, requireAuth, requireAdmin, session, hashPassword };
}

module.exports = { createAuth, hashPassword, verifyPassword };
