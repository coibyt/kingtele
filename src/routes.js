'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeSchedule, nextRun, isValidTz } = require('./schedule');
const tg = require('./telegram');
const { NAME_RE } = require('./media');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MB = 1024 * 1024;

function createApi({ store, config, auth, scheduler, media, tokenFor }) {
  const api = express.Router();
  const d = () => store.data;

  // Mọi dữ liệu đều thuộc về một thành viên (userId). 'admin' là tài khoản quản trị.
  const mine = (list, req) => list.filter((x) => x.userId === req.user.id);
  const own = (list, req, id) => list.find((x) => x.id === id && x.userId === req.user.id);
  const prefs = (req) => (req.user.id === 'admin' ? d().settings : d().users.find((u) => u.id === req.user.id) || {});
  const tzOf = (req) => prefs(req).timezone || config.defaultTz;
  const token = (req) => tokenFor(req.user.id);
  const isAdmin = (req) => req.user.role === 'admin';

  api.post('/login', auth.login);
  api.post('/register', auth.register);
  api.post('/logout', auth.logout);
  api.get('/me', (req, res) => {
    const u = auth.session(req);
    u ? res.json({ user: u, registrationOpen: config.registrationOpen }) : res.status(401).json({ error: 'Chưa đăng nhập' });
  });
  api.get('/config', (req, res) => res.json({ registrationOpen: config.registrationOpen }));

  api.use(auth.requireAuth);
  api.post('/account/password', wrap(auth.changePassword));

  // ---------- Ảnh / video ----------
  api.post('/upload', wrap(async (req, res) => {
    const quota = isAdmin(req) ? Infinity : config.maxUploadMB * MB;
    const out = await media.upload(req, req.user.id, quota);
    await store.save();
    media.sweep();
    res.status(201).json(out);
  }));

  api.get('/media/:file', (req, res) => {
    const f = req.params.file;
    if (!NAME_RE.test(f) || media.owner(f) !== req.user.id) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(f, { root: media.dir }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ---------- Tổng quan ----------
  api.get('/overview', (req, res) => {
    const posts = mine(d().posts, req), groups = mine(d().groups, req), logs = mine(d().logs, req);
    const tz = tzOf(req);
    const day = 86400000, now = Date.now();
    const dayKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(t);
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const start = now - (6 - i) * day;
      return { label: new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: tz }).format(start), key: dayKey(start), ok: 0, error: 0 };
    });
    const since = now - 7 * day;
    let ok7 = 0, err7 = 0;
    for (const l of logs) {
      if (l.at < since) break;
      const b = buckets.find((x) => x.key === dayKey(l.at));
      if (b) b[l.status === 'ok' ? 'ok' : 'error']++;
      l.status === 'ok' ? ok7++ : err7++;
    }
    res.json({
      groups: groups.length,
      activePosts: posts.filter((p) => p.status === 'active').length,
      totalPosts: posts.length,
      sent7: ok7, failed7: err7,
      rate: ok7 + err7 ? Math.round((ok7 / (ok7 + err7)) * 100) : null,
      chart: buckets.map(({ label, ok, error }) => ({ label, ok, error })),
      upcoming: posts.filter((p) => p.status === 'active' && p.nextRunAt)
        .sort((a, b) => a.nextRunAt - b.nextRunAt).slice(0, 6)
        .map((p) => ({ id: p.id, title: p.title, nextRunAt: p.nextRunAt, timezone: p.timezone, groups: p.groupIds.length })),
      recent: logs.slice(0, 6),
      botConfigured: !!token(req),
      dataSafe: isAdmin(req) ? config.dataSafe : true,
      timezone: tz,
    });
  });

  // ---------- Nhóm ----------
  api.get('/groups', (req, res) => res.json(mine(d().groups, req)));

  api.post('/groups', wrap(async (req, res) => {
    const groups = mine(d().groups, req);
    if (!isAdmin(req) && groups.length >= config.maxGroups) throw bad(`Mỗi tài khoản tối đa ${config.maxGroups} nhóm`);
    let chatId = str(req.body.chatId, 100);
    if (!chatId) throw bad('Nhập Chat ID hoặc @username của nhóm');
    if (/^-?\d+$/.test(chatId) === false && !chatId.startsWith('@')) chatId = `@${chatId}`;
    if (groups.some((g) => String(g.chatId).toLowerCase() === chatId.toLowerCase())) throw bad('Nhóm này đã có trong danh sách');
    let title = str(req.body.title, 120), type = 'group', verified = false;
    if (!token(req)) throw bad('Hãy kết nối bot Telegram của bạn ở mục Cài đặt trước khi thêm nhóm');
    try {
      const chat = await tg.getChat(token(req), chatId);
      title = title || chat.title || chat.username || chatId;
      type = chat.type; verified = true;
      chatId = String(chat.id);
    } catch (e) {
      throw bad(`Bot không truy cập được nhóm này: ${e.message}. Hãy thêm bot vào nhóm (và cấp quyền đăng bài nếu là kênh).`);
    }
    if (groups.some((g) => String(g.chatId) === chatId)) throw bad('Nhóm này đã có trong danh sách');
    const g = { id: crypto.randomUUID(), userId: req.user.id, chatId, title: title || chatId, type, note: str(req.body.note, 200), verified, createdAt: Date.now() };
    d().groups.push(g);
    await store.save();
    res.status(201).json(g);
  }));

  api.post('/groups/:id/verify', wrap(async (req, res) => {
    const g = own(d().groups, req, req.params.id);
    if (!g) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    try {
      const chat = await tg.getChat(token(req), g.chatId);
      Object.assign(g, { title: chat.title || chat.username || g.title, type: chat.type, verified: true });
      await store.save();
      res.json(g);
    } catch (e) {
      g.verified = false; await store.save();
      throw bad(e.message);
    }
  }));

  api.delete('/groups/:id', wrap(async (req, res) => {
    const g = own(d().groups, req, req.params.id);
    if (!g) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    d().groups.splice(d().groups.indexOf(g), 1);
    for (const p of mine(d().posts, req)) p.groupIds = p.groupIds.filter((id) => id !== g.id);
    await store.save();
    res.json({ ok: true });
  }));

  // ---------- Bài đăng ----------
  function parsePost(req, existing) {
    const body = req.body;
    const title = str(body.title, 120);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const imageUrl = str(body.imageUrl, 1000);
    if (!title) throw bad('Nhập tiêu đề (chỉ để bạn dễ quản lý)');
    let mediaObj = null;
    if (body.media && body.media.file) {
      const f = String(body.media.file);
      if (!NAME_RE.test(f) || media.owner(f) !== req.user.id || !fs.existsSync(path.join(media.dir, f))) throw bad('File ảnh/video không còn tồn tại, hãy tải lên lại');
      const kind = { jpg: 'image', png: 'image', webp: 'image', gif: 'animation', mp4: 'video', mov: 'video' }[f.split('.').pop()];
      const keep = existing && existing.media && existing.media.file === f ? existing.media : null;
      mediaObj = { file: f, kind, name: str(body.media.name, 100) || f, size: Number(body.media.size) || 0, fileId: keep ? keep.fileId || '' : '' };
    }
    if (!text && !imageUrl && !mediaObj) throw bad('Bài đăng cần có nội dung, ảnh hoặc video');
    if (text.length > 4096) throw bad('Nội dung tối đa 4096 ký tự');
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) throw bad('Link ảnh phải bắt đầu bằng https://');
    const parseMode = ['none', 'HTML', 'MarkdownV2'].includes(body.parseMode) ? body.parseMode : 'none';
    const buttons = (Array.isArray(body.buttons) ? body.buttons : []).slice(0, 6)
      .map((b) => ({ text: str(b && b.text, 64), url: str(b && b.url, 500) })).filter((b) => b.text || b.url);
    for (const b of buttons) if (!b.text || !/^https?:\/\//i.test(b.url)) throw bad('Mỗi nút cần tên và link bắt đầu bằng http(s)://');
    const timezone = isValidTz(body.timezone) ? body.timezone : tzOf(req);
    const groupIds = [...new Set(Array.isArray(body.groupIds) ? body.groupIds : [])].filter((id) => own(d().groups, req, id));
    if (!groupIds.length) throw bad('Chọn ít nhất một nhóm để đăng');
    let schedule;
    try { schedule = normalizeSchedule(body.schedule); } catch (e) { throw bad(e.message); }
    return { title, text, imageUrl: mediaObj ? '' : imageUrl, media: mediaObj, parseMode, buttons, timezone, groupIds, schedule, silent: !!body.silent, noPreview: !!body.noPreview };
  }

  api.get('/posts', (req, res) => res.json(mine(d().posts, req)));

  api.post('/posts', wrap(async (req, res) => {
    if (!isAdmin(req) && mine(d().posts, req).length >= config.maxPosts) throw bad(`Mỗi tài khoản tối đa ${config.maxPosts} bài đăng. Hãy xoá bớt bài cũ.`);
    const data = parsePost(req);
    const next = nextRun(data.schedule, data.timezone, Date.now(), true);
    if (!next && data.schedule.type === 'once') throw bad('Thời điểm đăng đã ở trong quá khứ');
    const post = { id: crypto.randomUUID(), userId: req.user.id, ...data, status: 'active', nextRunAt: next, lastRunAt: null, sentCount: 0, failCount: 0, createdAt: Date.now() };
    d().posts.unshift(post);
    await store.save();
    res.status(201).json(post);
  }));

  api.put('/posts/:id', wrap(async (req, res) => {
    const post = own(d().posts, req, req.params.id);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    const data = parsePost(req, post);
    const next = nextRun(data.schedule, data.timezone, Date.now(), true);
    if (!next && data.schedule.type === 'once') throw bad('Thời điểm đăng đã ở trong quá khứ');
    const oldFile = post.media && post.media.file;
    Object.assign(post, data, { nextRunAt: next, status: post.status === 'paused' ? 'paused' : 'active' });
    await store.save();
    if (oldFile && oldFile !== (post.media && post.media.file)) { await media.remove(oldFile); await store.save(); }
    res.json(post);
  }));

  api.post('/posts/:id/status', wrap(async (req, res) => {
    const post = own(d().posts, req, req.params.id);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    if (req.body.status === 'paused') post.status = 'paused';
    else if (req.body.status === 'active') {
      const next = nextRun(post.schedule, post.timezone, Date.now(), true);
      if (!next) throw bad('Lịch đã hết hạn - hãy sửa bài và chọn thời điểm mới');
      post.status = 'active'; post.nextRunAt = next;
    } else throw bad('Trạng thái không hợp lệ');
    await store.save();
    res.json(post);
  }));

  api.post('/posts/:id/send-now', wrap(async (req, res) => {
    const post = own(d().posts, req, req.params.id);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    if (!token(req)) throw bad('Chưa kết nối bot Telegram - vào Cài đặt');
    if (scheduler.isRunning(post.id)) throw bad('Bài đang được gửi, vui lòng chờ');
    const results = await scheduler.runPost(post, 'manual');
    await store.save();
    res.json({ results });
  }));

  api.delete('/posts/:id', wrap(async (req, res) => {
    const post = own(d().posts, req, req.params.id);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    d().posts.splice(d().posts.indexOf(post), 1);
    if (post.media) await media.remove(post.media.file);
    await store.save();
    res.json({ ok: true });
  }));

  // ---------- Nhật ký ----------
  api.get('/logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const status = req.query.status;
    res.json(mine(d().logs, req).filter((l) => !status || l.status === status).slice(0, limit));
  });
  api.delete('/logs', wrap(async (req, res) => {
    d().logs = d().logs.filter((l) => l.userId !== req.user.id);
    await store.save();
    res.json({ ok: true });
  }));

  // ---------- Cài đặt ----------
  const mask = (t) => (t ? `${t.slice(0, 4)}••••••${t.slice(-4)}` : '');
  api.get('/settings', (req, res) => {
    const p = prefs(req);
    res.json({
      timezone: tzOf(req), tokenMasked: mask(token(req)),
      tokenSource: p.botToken ? 'app' : (isAdmin(req) && config.envBotToken) ? 'env' : null,
      dataSafe: isAdmin(req) ? config.dataSafe : true,
      user: req.user,
    });
  });

  api.put('/settings', wrap(async (req, res) => {
    const p = prefs(req);
    if (req.body.timezone !== undefined) {
      if (!isValidTz(req.body.timezone)) throw bad('Múi giờ không hợp lệ');
      p.timezone = req.body.timezone;
    }
    if (typeof req.body.botToken === 'string' && req.body.botToken.trim()) {
      const t = req.body.botToken.trim();
      if (!/^\d+:[\w-]{30,}$/.test(t)) throw bad('Token không đúng định dạng (dạng 123456:ABC...)');
      p.botToken = t;
    }
    if (req.body.clearToken) p.botToken = '';
    await store.save();
    res.json({ ok: true });
  }));

  api.post('/settings/test', wrap(async (req, res) => {
    try {
      const me = await tg.getMe(token(req));
      res.json({ ok: true, username: me.username, name: me.first_name });
    } catch (e) { throw bad(e.message); }
  }));

  api.get('/export', (req, res) => {
    const strip = (p) => (p.media ? { ...p, media: { ...p.media, fileId: undefined } } : p);
    res.setHeader('Content-Disposition', `attachment; filename="postpilot-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ groups: mine(d().groups, req), posts: mine(d().posts, req).map(strip), logs: mine(d().logs, req), settings: { timezone: tzOf(req) } });
  });

  // ---------- Quản trị ----------
  const admin = express.Router();
  admin.use(auth.requireAdmin);

  admin.get('/users', (req, res) => {
    const dayAgo = Date.now() - 86400000;
    const count = (list, id) => list.filter((x) => x.userId === id).length;
    const users = d().users.map((u) => ({
      id: u.id, name: u.name, email: u.email, disabled: !!u.disabled, createdAt: u.createdAt, hasBot: !!u.botToken,
      groups: count(d().groups, u.id), posts: count(d().posts, u.id),
      sent: d().logs.filter((l) => l.userId === u.id && l.status === 'ok').length,
      storageMB: Math.round((media.userBytes(u.id) / MB) * 10) / 10,
    })).sort((a, b) => b.createdAt - a.createdAt);
    res.json({
      users,
      totals: { users: users.length, posts: d().posts.length, groups: d().groups.length, sent24h: d().logs.filter((l) => l.at > dayAgo && l.status === 'ok').length },
      registrationOpen: config.registrationOpen,
    });
  });

  const target = (req) => {
    const u = d().users.find((x) => x.id === req.params.id);
    if (!u) throw bad('Không tìm thấy thành viên', 404);
    return u;
  };

  admin.post('/users/:id/disable', wrap(async (req, res) => {
    target(req).disabled = !!req.body.disabled;
    await store.save();
    res.json({ ok: true });
  }));

  admin.post('/users/:id/reset-password', wrap(async (req, res) => {
    const u = target(req);
    const temp = crypto.randomBytes(9).toString('base64url');
    u.passwordHash = await auth.hashPassword(temp);
    await store.save();
    res.json({ password: temp });
  }));

  admin.delete('/users/:id', wrap(async (req, res) => {
    const u = target(req);
    const files = d().posts.filter((p) => p.userId === u.id && p.media).map((p) => p.media.file);
    d().posts = d().posts.filter((p) => p.userId !== u.id);
    d().groups = d().groups.filter((g) => g.userId !== u.id);
    d().logs = d().logs.filter((l) => l.userId !== u.id);
    d().users = d().users.filter((x) => x.id !== u.id);
    for (const f of files) await media.remove(f);
    for (const [f, v] of Object.entries(d().uploads)) if (v.u === u.id) await media.remove(f);
    await store.save();
    res.json({ ok: true });
  }));

  api.use('/admin', admin);

  api.use((req, res) => res.status(404).json({ error: 'Không tìm thấy' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500) console.error('[api]', err);
    res.status(status).json({ error: status === 500 ? 'Lỗi máy chủ' : err.message });
  });

  return api;
}

module.exports = { createApi };
