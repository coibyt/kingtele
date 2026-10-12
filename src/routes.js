'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeSchedule, nextRun, isValidTz } = require('./schedule');
const tg = require('./telegram');
const { NAME_RE } = require('./media');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function createApi({ store, config, auth, scheduler, media }) {
  const api = express.Router();
  const token = () => store.data.settings.botToken || config.envBotToken;
  const tzOf = () => store.data.settings.timezone || config.defaultTz;
  const find = (list, id) => list.find((x) => x.id === id);

  api.post('/login', auth.login);
  api.post('/logout', auth.logout);
  api.get('/me', (req, res) => {
    const s = auth.session(req);
    s ? res.json({ user: s.u }) : res.status(401).json({ error: 'Chưa đăng nhập' });
  });

  api.use(auth.requireAuth);

  // ---------- Ảnh / video ----------
  api.post('/upload', wrap(async (req, res) => {
    const out = await media.upload(req);
    media.sweep();
    res.status(201).json(out);
  }));

  api.get('/media/:file', (req, res) => {
    if (!NAME_RE.test(req.params.file)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(req.params.file, { root: media.dir }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // ---------- Tổng quan ----------
  api.get('/overview', (req, res) => {
    const { posts, groups, logs } = store.data;
    const day = 86400000, now = Date.now();
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const start = new Date(now - (6 - i) * day);
      return { label: new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: tzOf() }).format(start), ok: 0, error: 0, from: start.getTime() };
    });
    const since = now - 7 * day;
    let ok7 = 0, err7 = 0;
    for (const l of logs) {
      if (l.at < since) break;
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: tzOf() }).format(l.at);
      const b = buckets.find((x) => new Intl.DateTimeFormat('en-CA', { timeZone: tzOf() }).format(x.from) === key);
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
      botConfigured: !!token(),
      timezone: tzOf(),
    });
  });

  // ---------- Nhóm ----------
  api.get('/groups', (req, res) => res.json(store.data.groups));

  api.post('/groups', wrap(async (req, res) => {
    let chatId = str(req.body.chatId, 100);
    if (!chatId) throw bad('Nhập Chat ID hoặc @username của nhóm');
    if (/^-?\d+$/.test(chatId) === false && !chatId.startsWith('@')) chatId = `@${chatId}`;
    if (store.data.groups.some((g) => String(g.chatId).toLowerCase() === chatId.toLowerCase())) throw bad('Nhóm này đã có trong danh sách');
    let title = str(req.body.title, 120), type = 'group', verified = false;
    if (token()) {
      try {
        const chat = await tg.getChat(token(), chatId);
        title = title || chat.title || chat.username || chatId;
        type = chat.type; verified = true;
        chatId = String(chat.id);
      } catch (e) {
        throw bad(`Bot không truy cập được nhóm này: ${e.message}. Hãy thêm bot vào nhóm (và cấp quyền đăng bài nếu là kênh).`);
      }
    }
    const g = { id: crypto.randomUUID(), chatId, title: title || chatId, type, note: str(req.body.note, 200), verified, createdAt: Date.now() };
    store.data.groups.push(g);
    await store.save();
    res.status(201).json(g);
  }));

  api.post('/groups/:id/verify', wrap(async (req, res) => {
    const g = find(store.data.groups, req.params.id);
    if (!g) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    try {
      const chat = await tg.getChat(token(), g.chatId);
      Object.assign(g, { title: chat.title || chat.username || g.title, type: chat.type, verified: true });
      await store.save();
      res.json(g);
    } catch (e) {
      g.verified = false; await store.save();
      throw bad(e.message);
    }
  }));

  api.delete('/groups/:id', wrap(async (req, res) => {
    const { groups, posts } = store.data;
    const i = groups.findIndex((g) => g.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
    groups.splice(i, 1);
    for (const p of posts) p.groupIds = p.groupIds.filter((id) => id !== req.params.id);
    await store.save();
    res.json({ ok: true });
  }));

  // ---------- Bài đăng ----------
  function parsePost(body, existing) {
    const title = str(body.title, 120);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const imageUrl = str(body.imageUrl, 1000);
    if (!title) throw bad('Nhập tiêu đề (chỉ để bạn dễ quản lý)');
    let mediaObj = null;
    if (body.media && body.media.file) {
      const f = String(body.media.file);
      if (!NAME_RE.test(f) || !fs.existsSync(path.join(media.dir, f))) throw bad('File ảnh/video không còn tồn tại, hãy tải lên lại');
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
    const timezone = isValidTz(body.timezone) ? body.timezone : tzOf();
    const groupIds = [...new Set(Array.isArray(body.groupIds) ? body.groupIds : [])].filter((id) => find(store.data.groups, id));
    if (!groupIds.length) throw bad('Chọn ít nhất một nhóm để đăng');
    let schedule;
    try { schedule = normalizeSchedule(body.schedule); } catch (e) { throw bad(e.message); }
    return { title, text, imageUrl: mediaObj ? '' : imageUrl, media: mediaObj, parseMode, buttons, timezone, groupIds, schedule, silent: !!body.silent, noPreview: !!body.noPreview };
  }

  api.get('/posts', (req, res) => res.json(store.data.posts));

  api.post('/posts', wrap(async (req, res) => {
    const data = parsePost(req.body);
    const next = nextRun(data.schedule, data.timezone, Date.now(), true);
    if (!next && data.schedule.type === 'once') throw bad('Thời điểm đăng đã ở trong quá khứ');
    const post = { id: crypto.randomUUID(), ...data, status: 'active', nextRunAt: next, lastRunAt: null, sentCount: 0, failCount: 0, createdAt: Date.now() };
    store.data.posts.unshift(post);
    await store.save();
    res.status(201).json(post);
  }));

  api.put('/posts/:id', wrap(async (req, res) => {
    const post = find(store.data.posts, req.params.id);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    const data = parsePost(req.body, post);
    const next = nextRun(data.schedule, data.timezone, Date.now(), true);
    if (!next && data.schedule.type === 'once') throw bad('Thời điểm đăng đã ở trong quá khứ');
    const oldFile = post.media && post.media.file;
    Object.assign(post, data, { nextRunAt: next, status: post.status === 'paused' ? 'paused' : 'active' });
    await store.save();
    if (oldFile && oldFile !== (post.media && post.media.file)) await media.remove(oldFile);
    res.json(post);
  }));

  api.post('/posts/:id/status', wrap(async (req, res) => {
    const post = find(store.data.posts, req.params.id);
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
    const post = find(store.data.posts, req.params.id);
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    if (!token()) throw bad('Chưa cấu hình token bot - vào Cài đặt');
    if (scheduler.isRunning(post.id)) throw bad('Bài đang được gửi, vui lòng chờ');
    const results = await scheduler.runPost(post, 'manual');
    await store.save();
    res.json({ results });
  }));

  api.delete('/posts/:id', wrap(async (req, res) => {
    const i = store.data.posts.findIndex((p) => p.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    const [gone] = store.data.posts.splice(i, 1);
    await store.save();
    if (gone.media) await media.remove(gone.media.file);
    res.json({ ok: true });
  }));

  // ---------- Nhật ký ----------
  api.get('/logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const status = req.query.status;
    res.json(store.data.logs.filter((l) => !status || l.status === status).slice(0, limit));
  });
  api.delete('/logs', wrap(async (req, res) => { store.data.logs = []; await store.save(); res.json({ ok: true }); }));

  // ---------- Cài đặt ----------
  const mask = (t) => (t ? `${t.slice(0, 4)}••••••${t.slice(-4)}` : '');
  api.get('/settings', (req, res) => {
    const s = store.data.settings;
    res.json({ timezone: tzOf(), tokenMasked: mask(token()), tokenSource: s.botToken ? 'app' : config.envBotToken ? 'env' : null });
  });

  api.put('/settings', wrap(async (req, res) => {
    const s = store.data.settings;
    if (req.body.timezone !== undefined) {
      if (!isValidTz(req.body.timezone)) throw bad('Múi giờ không hợp lệ');
      s.timezone = req.body.timezone;
    }
    if (typeof req.body.botToken === 'string' && req.body.botToken.trim()) {
      const t = req.body.botToken.trim();
      if (!/^\d+:[\w-]{30,}$/.test(t)) throw bad('Token không đúng định dạng (dạng 123456:ABC...)');
      s.botToken = t;
    }
    if (req.body.clearToken) s.botToken = '';
    await store.save();
    res.json({ ok: true });
  }));

  api.post('/settings/test', wrap(async (req, res) => {
    try {
      const me = await tg.getMe(token());
      res.json({ ok: true, username: me.username, name: me.first_name });
    } catch (e) { throw bad(e.message); }
  }));

  api.get('/export', (req, res) => {
    const { settings, ...rest } = store.data;
    res.setHeader('Content-Disposition', `attachment; filename="postpilot-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ ...rest, settings: { timezone: settings.timezone } });
  });

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
