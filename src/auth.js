'use strict';
const crypto = require('crypto');

const COOKIE = 'pp_session';
const TTL = 7 * 24 * 3600 * 1000;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const b64 = (s) => Buffer.from(s).toString('base64url');

function createAuth({ store, config }) {
  const secret = () => store.data.settings.sessionSecret;
  const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

  function issue(user) {
    const payload = b64(JSON.stringify({ u: user, exp: Date.now() + TTL }));
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

  const session = (req) => verify(parseCookies(req)[COOKIE]);

  function setCookie(res, req, value, maxAge) {
    const secure = req.secure || config.production;
    res.append('Set-Cookie',
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAge / 1000)}${secure ? '; Secure' : ''}`);
  }

  // Giới hạn đăng nhập sai: 5 lần / 15 phút / IP
  const fails = new Map();
  const locked = (ip) => { const f = fails.get(ip); return f && f.count >= 5 && f.until > Date.now(); };

  function login(req, res) {
    const ip = req.ip;
    if (locked(ip)) return res.status(429).json({ error: 'Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.' });
    const { username, password } = req.body || {};
    const ok = safeEq(username || '', config.adminUser) & safeEq(password || '', config.adminPassword);
    if (!ok) {
      const f = fails.get(ip) && fails.get(ip).until > Date.now() ? fails.get(ip) : { count: 0 };
      f.count++; f.until = Date.now() + 15 * 60000; fails.set(ip, f);
      return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    fails.delete(ip);
    setCookie(res, req, issue(config.adminUser), TTL);
    res.json({ ok: true });
  }

  function logout(req, res) {
    setCookie(res, req, '', 0);
    res.json({ ok: true });
  }

  /** Chặn API khi chưa đăng nhập; mutation phải kèm header chống CSRF. */
  function requireAuth(req, res, next) {
    if (!session(req)) return res.status(401).json({ error: 'Chưa đăng nhập' });
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'postpilot') {
      return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
    }
    next();
  }

  return { login, logout, requireAuth, session };
}

module.exports = { createAuth };
