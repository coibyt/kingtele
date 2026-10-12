'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const config = require('./src/config');
const { Store } = require('./src/store');
const { createAuth } = require('./src/auth');
const { createScheduler } = require('./src/scheduler');
const { createApi } = require('./src/routes');
const { createMedia } = require('./src/media');

const store = new Store(config.dataDir).init();
const token = () => store.data.settings.botToken || config.envBotToken;
const auth = createAuth({ store, config });
const media = createMedia({ store, uploadsDir: config.uploadsDir });
const scheduler = createScheduler({ store, getToken: token, uploadsDir: config.uploadsDir });

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
      "font-src https://fonts.gstatic.com", "img-src 'self' data: https:", "connect-src 'self'",
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
app.use('/api', createApi({ store, config, auth, scheduler, media }));

const view = (name) => (req, res) => res.sendFile(path.join(__dirname, 'views', name));
app.get('/app', (req, res) => (auth.session(req) ? view('app.html')(req, res) : res.redirect('/login')));
app.get('/login', (req, res) => (auth.session(req) ? res.redirect('/app') : view('login.html')(req, res)));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.production ? '7d' : 0, extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'views', '404.html')));

const server = app.listen(config.port, () => {
  console.log(`PostPilot chạy tại cổng ${config.port} (${config.production ? 'production' : 'dev'})`);
  scheduler.start();
  media.sweep();
});

async function shutdown() {
  scheduler.stop();
  server.close();
  await store.flush();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
