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

const { lookup: lookupChatId, MESSAGES: MSG } = require('./chatid-tool');

function createApi({ store, config, auth, scheduler, media, tokenFor, points, pwaStats, traffic, chatIdTool, fb, zalo, mod, inbox, accountMail }) {
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
    u ? res.json({ user: u, registrationOpen: config.registrationOpen, points: points.balanceOf(u.id) }) : res.status(401).json({ error: 'Chưa đăng nhập' });
  });
  api.get('/config', (req, res) => res.json({ registrationOpen: config.registrationOpen }));
  if (accountMail) api.use(accountMail.publicRouter());

  // Công cụ miễn phí lấy ID nhóm Telegram: không cần đăng nhập. 30 lượt tra/10 phút/IP.
  const toolHits = new Map();
  api.get('/tool/info', (req, res) => res.json({ bot: chatIdTool ? chatIdTool.username() : '' }));
  api.post('/tool/chat-id', wrap(async (req, res) => {
    if (req.get('x-requested-with') !== 'postpilot') return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
    const now = Date.now();
    const h = toolHits.get(req.ip) && toolHits.get(req.ip).until > now ? toolHits.get(req.ip) : { n: 0, until: now + 600e3 };
    if (++h.n > 30) return res.status(429).json({ error: MSG.rate });
    toolHits.set(req.ip, h);
    if (toolHits.size > 5000) for (const [k, v] of toolHits) if (v.until < now) toolHits.delete(k);
    try {
      res.json(await lookupChatId(str(req.body && req.body.input, 300), config.toolBotToken));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.status ? e.message : MSG.generic });
    }
  }));

  // Thống kê cài ứng dụng: khách chưa đăng nhập cũng gửi được. Giới hạn 120 sự kiện/giờ/IP, chỉ nhận loại sự kiện cho phép.
  const pwaHits = new Map();
  // Đếm khách truy cập (ẩn danh). Bỏ qua quản trị viên và bot; giới hạn 1200 sự kiện/giờ/IP.
  const trackHits = new Map();
  api.post('/track', (req, res) => {
    if (req.get('x-requested-with') !== 'postpilot') return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
    const now = Date.now();
    const h = trackHits.get(req.ip) && trackHits.get(req.ip).until > now ? trackHits.get(req.ip) : { n: 0, until: now + 3600e3 };
    if (++h.n > 1200) return res.status(429).json({ error: 'Quá nhiều yêu cầu' });
    trackHits.set(req.ip, h);
    const who = auth.session(req);
    if (who && who.role === 'admin') return res.status(204).end();
    const r = traffic.record(req.body || {}, { ua: req.get('user-agent') || '', siteHost: req.hostname });
    if (r === 'invalid') return res.status(400).json({ error: 'Sự kiện không hợp lệ' });
    res.status(204).end();
  });

  api.post('/pwa/event', wrap(async (req, res) => {
    if (req.get('x-requested-with') !== 'postpilot') return res.status(403).json({ error: 'Yêu cầu không hợp lệ' });
    const now = Date.now();
    const h = pwaHits.get(req.ip) && pwaHits.get(req.ip).until > now ? pwaHits.get(req.ip) : { n: 0, until: now + 3600e3 };
    if (++h.n > 120) return res.status(429).json({ error: 'Quá nhiều yêu cầu' });
    pwaHits.set(req.ip, h);
    const who = auth.session(req);
    if (!pwaStats.record(req.body || {}, req.get('user-agent') || '', who ? who.id : '')) return res.status(400).json({ error: 'Sự kiện không hợp lệ' });
    await store.save();
    res.status(204).end();
  }));

  api.use(auth.requireAuth);
  if (fb) api.use('/fb', fb.router({ config }));
  if (zalo) api.use('/zalo', zalo.router());
  if (mod) api.use('/mod', mod.router());
  if (inbox) api.use('/inbox', inbox.router());
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
      return { t: start, key: dayKey(start), ok: 0, error: 0 };
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
      chart: buckets.map(({ t, ok, error }) => ({ t, ok, error })),
      upcoming: posts.filter((p) => p.status === 'active' && p.nextRunAt)
        .sort((a, b) => a.nextRunAt - b.nextRunAt).slice(0, 6)
        .map((p) => ({ id: p.id, title: p.title, nextRunAt: p.nextRunAt, timezone: p.timezone, groups: p.groupIds.length })),
      recent: logs.slice(0, 6),
      botConfigured: !!token(req),
      dataSafe: isAdmin(req) ? config.dataSafe : true,
      timezone: tz,
      points: points.balanceOf(req.user.id),
    });
  });

  // ---------- Điểm King ----------
  api.get('/points', (req, res) => {
    const u = points.userOf(req.user.id);
    if (!u) return res.json({ unlimited: true });
    const base = config.baseUrl || `${req.protocol}://${req.get('host')}`;
    res.json({ ...points.summary(u, tzOf(req)), refLink: `${base}/register?ref=${u.refCode}` });
  });

  api.post('/points/checkin', wrap(async (req, res) => {
    const u = points.userOf(req.user.id);
    if (!u) throw bad('Tài khoản quản trị không dùng Điểm King');
    const r = points.checkin(u, tzOf(req));
    if (!r.ok) throw bad('Hôm nay bạn đã điểm danh rồi. Quay lại vào ngày mai nhé!');
    await store.save();
    res.json({ ok: true, amount: r.amount, balance: u.points });
  }));

  // ---------- Nhóm ----------
  api.get('/groups', (req, res) => res.json(mine(d().groups, req)));

  // Tìm các nhóm/kênh mà bot của thành viên đã được thêm vào (để khách không phải tự đọc Chat ID)
  api.get('/groups/discover', wrap(async (req, res) => {
    if (!token(req)) throw bad('Hãy kết nối bot Telegram của bạn ở mục Cài đặt trước khi thêm nhóm');
    let updates;
    try { updates = await (mod ? mod.updates(req.user.id, token(req)) : tg.getUpdates(token(req))); } catch (e) {
      if (e.code === 409) throw bad('Bot đang gắn với dịch vụ khác (webhook) nên không dò được nhóm. Hãy nhập Chat ID thủ công.');
      throw bad(e.message);
    }
    const have = new Set(mine(d().groups, req).map((g) => String(g.chatId)));
    res.json(tg.chatsFromUpdates(updates).filter((c) => !have.has(c.chatId)));
  }));

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
    if (mod) mod.sync();
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
    if (!points.has(req.user.id)) throw bad('Không đủ Điểm King. Hãy điểm danh hoặc giới thiệu bạn bè để nhận thêm.', 402);
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
    res.setHeader('Content-Disposition', `attachment; filename="kingtele-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ fbGroups: mine(d().fbGroups, req), fbTasks: mine(d().fbTasks, req), groups: mine(d().groups, req), posts: mine(d().posts, req).map(strip), logs: mine(d().logs, req), settings: { timezone: tzOf(req) } });
  });

  // ---------- Quản trị ----------
  const admin = express.Router();
  admin.use(auth.requireAdmin);

  admin.get('/users', (req, res) => {
    const dayAgo = Date.now() - 86400000;
    const count = (list, id) => list.filter((x) => x.userId === id).length;
    const users = d().users.map((u) => ({
      id: u.id, name: u.name, email: u.email, disabled: !!u.disabled, createdAt: u.createdAt, hasBot: !!u.botToken,
      isAdmin: !!u.isAdmin, ipCount: u.regIp ? d().users.filter((x) => x.regIp === u.regIp).length : 0,
      points: u.points, regIp: u.regIp || '', referredBy: u.referredBy ? (d().users.find((x) => x.id === u.referredBy) || {}).name || '?' : '',
      referral: u.referral ? u.referral.status : '',
      groups: count(d().groups, u.id), posts: count(d().posts, u.id),
      sent: d().logs.filter((l) => l.userId === u.id && l.status === 'ok').length,
      storageMB: Math.round((media.userBytes(u.id) / MB) * 10) / 10,
    })).sort((a, b) => b.createdAt - a.createdAt);
    res.json({
      users,
      totals: { users: users.length, posts: d().posts.length, groups: d().groups.length, sent24h: d().logs.filter((l) => l.at > dayAgo && l.status === 'ok').length },
      registrationOpen: config.registrationOpen,
      owner: req.user.id === 'admin',
      settings: { maxAccountsPerIp: Number(d().settings.maxAccountsPerIp) || null },
    });
  });

  admin.get('/traffic', (req, res) => {
    const signupsByDay = {};
    for (const u of d().users) { const k = traffic.dayKey(u.createdAt); signupsByDay[k] = (signupsByDay[k] || 0) + 1; }
    res.json(traffic.summary({ signupsByDay }));
  });

  admin.get('/pwa', (req, res) => {
    const tz = tzOf(req);
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    const nameOf = (id) => (id === 'admin' ? req.user.name : (d().users.find((u) => u.id === id) || {}).name || '');
    res.json({ ...pwaStats.summary({ dayKey: (t) => fmt.format(t), nameOf }), timezone: tz });
  });

  admin.put('/settings', wrap(async (req, res) => {
    const v = req.body.maxAccountsPerIp;
    if (v === null || v === undefined || v === '') delete d().settings.maxAccountsPerIp; // để trống = không giới hạn
    else {
      const n = Math.trunc(Number(v));
      if (!Number.isFinite(n) || n < 1 || n > 10000) throw bad('Số tài khoản mỗi IP phải từ 1 đến 10000 (hoặc để trống nếu không giới hạn)');
      d().settings.maxAccountsPerIp = n;
    }
    await store.save();
    res.json({ maxAccountsPerIp: Number(d().settings.maxAccountsPerIp) || null });
  }));

  const owner = (req, res, next) => (req.user.id === 'admin' ? next() : res.status(403).json({ error: 'Chỉ tài khoản quản trị chính mới làm được việc này' }));
  // Quản trị viên phụ không được khoá / đặt lại mật khẩu / xoá quản trị viên khác.
  const guard = (req, u) => { if (u.isAdmin && req.user.id !== 'admin') throw bad('Chỉ tài khoản quản trị chính mới thao tác được với quản trị viên', 403); };

  const target = (req) => {
    const u = d().users.find((x) => x.id === req.params.id);
    if (!u) throw bad('Không tìm thấy thành viên', 404);
    return u;
  };

  admin.post('/users/:id/role', owner, wrap(async (req, res) => {
    target(req).isAdmin = !!req.body.admin;
    await store.save();
    res.json({ ok: true });
  }));

  admin.post('/users/:id/disable', wrap(async (req, res) => {
    const u = target(req); guard(req, u);
    u.disabled = !!req.body.disabled;
    await store.save();
    res.json({ ok: true });
  }));

  admin.post('/users/:id/points', wrap(async (req, res) => {
    const u = target(req);
    const amount = Math.trunc(Number(req.body.amount));
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000000) throw bad('Số điểm không hợp lệ');
    points.grant(u, amount, str(req.body.note, 120));
    await store.save();
    res.json({ points: u.points });
  }));

  admin.post('/users/:id/reset-password', wrap(async (req, res) => {
    const u = target(req); guard(req, u);
    const temp = crypto.randomBytes(9).toString('base64url');
    u.passwordHash = await auth.hashPassword(temp);
    await store.save();
    res.json({ password: temp });
  }));

  admin.delete('/users/:id', wrap(async (req, res) => {
    const u = target(req); guard(req, u);
    const files = d().posts.filter((p) => p.userId === u.id && p.media).map((p) => p.media.file);
    d().posts = d().posts.filter((p) => p.userId !== u.id);
    d().groups = d().groups.filter((g) => g.userId !== u.id);
    for (const k of ['fbGroups', 'fbTasks', 'fbDue', 'zaloContacts', 'modQueue', 'botContacts', 'filterLog']) d()[k] = d()[k].filter((x) => x.userId !== u.id);
    d().logs = d().logs.filter((l) => l.userId !== u.id);
    d().users = d().users.filter((x) => x.id !== u.id);
    for (const f of files) await media.remove(f);
    for (const [f, v] of Object.entries(d().uploads)) if (v.u === u.id) await media.remove(f);
    await store.save();
    res.json({ ok: true });
  }));

  if (accountMail) admin.use('/email', accountMail.adminRouter());
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
