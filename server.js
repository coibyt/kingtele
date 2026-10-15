'use strict';
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./src/config');
const { Store } = require('./src/store');
const { createAuth } = require('./src/auth');
const { createScheduler } = require('./src/scheduler');
const { createApi } = require('./src/routes');
const { createMedia } = require('./src/media');
const { createPoints } = require('./src/points');
const { createPwaStats } = require('./src/pwa-stats');
const { createTraffic } = require('./src/traffic');
const { startToolBot } = require('./src/chatid-tool');

const store = new Store(config.dataDir).init();
// Token bot của từng thành viên; tài khoản admin dùng token trong Cài đặt hoặc biến môi trường.
const tokenFor = (userId) => {
  if (userId === 'admin') return store.data.settings.botToken || config.envBotToken;
  const u = store.data.users.find((x) => x.id === userId);
  return (u && u.botToken) || '';
};
const isActive = (userId) => userId === 'admin' || store.data.users.some((u) => u.id === userId && !u.disabled);
const points = createPoints({ store, config });
const pwaStats = createPwaStats({ store });
const traffic = createTraffic({ store, tz: config.defaultTz });
if (points.migrate()) store.save();
const auth = createAuth({ store, config, points });
const media = createMedia({ store, uploadsDir: config.uploadsDir });
const scheduler = createScheduler({ store, getToken: tokenFor, isActive, uploadsDir: config.uploadsDir, points });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Hostinger đặt app sau reverse proxy

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com", "style-src-attr 'unsafe-inline'",
      "font-src https://fonts.gstatic.com", "img-src 'self' data: https:", "connect-src 'self'", "frame-src https://www.youtube-nocookie.com",
      "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
    ].join('; '),
  });
  if (config.production && req.protocol === 'http' && req.hostname !== 'localhost') {
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});

app.use(express.json({ limit: '100kb' }));
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));
const chatIdTool = config.toolBotToken ? startToolBot({ token: config.toolBotToken }) : null; // bot của công cụ /cong-cu/lay-id-nhom-telegram
app.use('/api', createApi({ store, config, auth, scheduler, media, tokenFor, points, pwaStats, traffic, chatIdTool }));

// CDN của nhà cung cấp hosting có thể bỏ header Cache-Control, nên gắn mã phiên bản (?v=) vào mọi file /assets
// trong HTML: mỗi lần deploy là một địa chỉ mới, điện thoại luôn tải bản mới.
const ASSET_VERSION = (() => {
  const h = crypto.createHash('sha1');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return walk(f);
    const st = fs.statSync(f);
    h.update(`${f}:${st.size}:${Math.round(st.mtimeMs)}`);
  });
  try { walk(path.join(__dirname, 'public', 'assets')); } catch { /* không có thì dùng mã rỗng */ }
  return h.digest('hex').slice(0, 10);
})();
const htmlCache = new Map();
const page = (file, status = 200) => (req, res) => {
  let html = htmlCache.get(file);
  if (!html) {
    html = fs.readFileSync(file, 'utf8').replace(/__YT_ID__/g, config.toolYoutubeId).replace(/(["'])(\/assets\/[^"'?]+\.(?:js|css))\1/g, `$1$2?v=${ASSET_VERSION}$1`);
    htmlCache.set(file, html);
  }
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(html);
};
const view = (name) => page(path.join(__dirname, 'views', name));
app.get('/', page(path.join(__dirname, 'public', 'index.html')));
app.get('/cong-cu/lay-id-nhom-telegram', view('tool-chat-id.html'));
app.get('/app', (req, res) => (auth.session(req) ? view('app.html')(req, res) : res.redirect('/login')));
app.get('/login', (req, res) => (auth.session(req) ? res.redirect('/app') : view('login.html')(req, res)));
app.get('/register', (req, res) => (auth.session(req) ? res.redirect('/app') : view('register.html')(req, res)));

app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, file) => {
    // Mã giao diện/ngôn ngữ đổi theo từng lần deploy: luôn xác thực lại bằng ETag để người dùng thấy bản mới ngay.
    res.setHeader('Cache-Control', /\.(html|js|css|webmanifest)$/.test(file) ? 'no-cache' : 'public, max-age=604800');
  },
}));
app.use(page(path.join(__dirname, 'views', '404.html'), 404));

const server = app.listen(config.port, () => {
  console.log(`KingTele chạy tại cổng ${config.port} (${config.production ? 'production' : 'dev'})`);
  scheduler.start();
  media.sweep();
  setInterval(() => traffic.flush(), 60000).unref(); // ghi số liệu truy cập xuống đĩa mỗi phút
});

async function shutdown() {
  scheduler.stop();
  server.close();
  await traffic.flush();
  await store.flush();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
