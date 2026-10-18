'use strict';
// Facebook (nhóm): Facebook không cho phần mềm tự đăng vào Nhóm bằng cách chính thức, nên KingTele làm lịch nhắc kèm đăng nhanh:
// đến giờ, bài được đưa vào hàng đợi mục Đến hạn (kèm nhắc qua Telegram nếu có), người dùng bấm sao chép + mở nhóm rồi tự đăng.
// KingTele không hỏi, không lưu mật khẩu hay phiên đăng nhập Facebook của bất kỳ ai.
const express = require('express');
const crypto = require('crypto');
const tg = require('./telegram');
const { normalizeSchedule, nextRun, isValidTz } = require('./schedule');

const MAX_GROUPS = 50;
const MAX_TASKS = 50;
const MAX_DUE = 100;
const STALE_MS = 10 * 60000;
const HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com', 'fb.me']);

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Chỉ nhận link https tới facebook.com; trả URL chuẩn hoá hoặc '' nếu sai. */
function cleanFbUrl(raw) {
  let s = str(raw, 500);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (!HOSTS.has(u.hostname.toLowerCase())) return '';
    u.protocol = 'https:';
    u.username = ''; u.password = ''; u.hash = '';
    return u.toString();
  } catch { return ''; }
}

function createFb({ store, getToken, isActive = () => true, publicUrl = 'https://kingtele.com' }) {
  const d = () => store.data;
  let timer = null;

  const prefsOf = (userId) => (userId === 'admin' ? d().settings : d().users.find((u) => u.id === userId) || {});

  /** Nhắc qua Telegram (nếu người dùng đã nhập Chat ID của mình). Không bao giờ ném lỗi. Không trừ Điểm King. */
  async function remind(item) {
    try {
      const chatId = prefsOf(item.userId).reminderChatId;
      const token = getToken(item.userId);
      if (!chatId || !token) return;
      await tg.callRaw(token, 'sendMessage', { chat_id: chatId, text: `⏰ Facebook · ${item.title}\n${publicUrl}/app#facebook`, link_preview_options: { is_disabled: true } });
    } catch { /* nhắc là phần thêm, lỗi thì bỏ qua */ }
  }

  /** Đưa bài vào hàng đợi mục Đến hạn với bản chụp nội dung + nhóm tại thời điểm này. */
  function enqueue(task) {
    const items = task.groupIds
      .map((id) => d().fbGroups.find((g) => g.id === id && g.userId === task.userId)).filter(Boolean)
      .map((g) => ({ groupId: g.id, name: g.name, url: g.url, done: false }));
    const item = { id: crypto.randomUUID(), userId: task.userId, taskId: task.id, title: task.title, text: task.text, link: task.link, items, dueAt: Date.now() };
    d().fbDue.unshift(item);
    const mine = d().fbDue.filter((x) => x.userId === task.userId);
    for (const old of mine.slice(MAX_DUE)) d().fbDue.splice(d().fbDue.indexOf(old), 1);
    task.runCount = (task.runCount || 0) + 1;
    task.lastRunAt = item.dueAt;
    return item;
  }

  async function tick() {
    const now = Date.now();
    const due = d().fbTasks.filter((t) => t.status === 'active' && t.nextRunAt && t.nextRunAt <= now && isActive(t.userId));
    for (const t of due) {
      const stale = t.schedule.type !== 'once' && now - t.nextRunAt > STALE_MS;
      const item = stale ? null : enqueue(t);
      t.nextRunAt = nextRun(t.schedule, t.timezone, Date.now());
      if (!t.nextRunAt) t.status = 'done';
      if (item) await remind(item);
    }
    if (due.length) await store.save();
  }

  function parseTask(req, mineGroups) {
    const b = req.body || {};
    const title = str(b.title, 120);
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    const link = b.link ? cleanLink(b.link) : '';
    if (!title) throw bad('Nhập tiêu đề (chỉ để bạn dễ quản lý)');
    if (!text) throw bad('Nhập nội dung bài đăng');
    if (text.length > 8000) throw bad('Nội dung quá dài');
    const groupIds = [...new Set(Array.isArray(b.groupIds) ? b.groupIds : [])].filter((id) => mineGroups.some((g) => g.id === id));
    if (!groupIds.length) throw bad('Chọn ít nhất một nhóm Facebook');
    let schedule;
    try { schedule = normalizeSchedule(b.schedule); } catch (e) { throw bad(e.message); }
    if (schedule.type === 'interval') throw bad('Kiểu lịch không hợp lệ');
    const timezone = isValidTz(b.timezone) ? b.timezone : 'Asia/Ho_Chi_Minh';
    return { title, text, link, groupIds, schedule, timezone };
  }
  const cleanLink = (v) => {
    const s = str(v, 500);
    if (!/^https?:\/\//i.test(s)) throw bad('Link phải bắt đầu bằng http:// hoặc https://');
    return s;
  };

  /** Router gắn vào /api/fb (đã qua xác thực). */
  function router({ config }) {
    const r = express.Router();
    const uid = (req) => req.user.id;
    const mine = (list, req) => list.filter((x) => x.userId === uid(req));
    const own = (list, req, id) => list.find((x) => x.id === id && x.userId === uid(req));
    const tzOf = (req) => prefsOf(uid(req)).timezone || config.defaultTz;

    r.get('/groups', (req, res) => res.json(mine(d().fbGroups, req)));
    r.post('/groups', wrap(async (req, res) => {
      const name = str(req.body && req.body.name, 100);
      const url = cleanFbUrl(req.body && req.body.url);
      if (!name) throw bad('Nhập tên nhóm');
      if (!url) throw bad('Link nhóm phải là địa chỉ facebook.com, ví dụ https://www.facebook.com/groups/tennhom');
      const list = mine(d().fbGroups, req);
      if (list.length >= MAX_GROUPS) throw bad(`Tối đa ${MAX_GROUPS} nhóm Facebook`);
      if (list.some((g) => g.url === url)) throw bad('Nhóm này đã được thêm');
      const g = { id: crypto.randomUUID(), userId: uid(req), name, url, createdAt: Date.now() };
      d().fbGroups.push(g);
      await store.save();
      res.status(201).json(g);
    }));
    r.delete('/groups/:id', wrap(async (req, res) => {
      const g = own(d().fbGroups, req, req.params.id);
      if (!g) return res.status(404).json({ error: 'Không tìm thấy' });
      d().fbGroups.splice(d().fbGroups.indexOf(g), 1);
      for (const t of mine(d().fbTasks, req)) t.groupIds = t.groupIds.filter((id) => id !== g.id);
      await store.save();
      res.json({ ok: true });
    }));

    r.get('/tasks', (req, res) => res.json(mine(d().fbTasks, req)));
    const upsert = (existing) => wrap(async (req, res) => {
      if (existing) { if (!own(d().fbTasks, req, req.params.id)) return res.status(404).json({ error: 'Không tìm thấy' }); }
      else if (mine(d().fbTasks, req).length >= MAX_TASKS) throw bad(`Tối đa ${MAX_TASKS} bài hẹn giờ Facebook`);
      const data = parseTask(req, mine(d().fbGroups, req));
      const next = nextRun(data.schedule, data.timezone, Date.now(), true);
      if (!next && data.schedule.type === 'once') throw bad('Thời điểm đăng đã ở trong quá khứ');
      let t;
      if (existing) { t = own(d().fbTasks, req, req.params.id); Object.assign(t, data, { nextRunAt: next, status: t.status === 'paused' ? 'paused' : 'active' }); }
      else { t = { id: crypto.randomUUID(), userId: uid(req), ...data, status: 'active', nextRunAt: next, lastRunAt: null, runCount: 0, createdAt: Date.now() }; d().fbTasks.unshift(t); }
      await store.save();
      res.status(existing ? 200 : 201).json(t);
    });
    r.post('/tasks', upsert(false));
    r.put('/tasks/:id', upsert(true));
    r.post('/tasks/:id/status', wrap(async (req, res) => {
      const t = own(d().fbTasks, req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Không tìm thấy' });
      if (req.body.status === 'paused') t.status = 'paused';
      else if (req.body.status === 'active') {
        const next = nextRun(t.schedule, t.timezone, Date.now(), true);
        if (!next) throw bad('Lịch đã hết hạn - hãy sửa bài và chọn thời điểm mới');
        t.status = 'active'; t.nextRunAt = next;
      } else throw bad('Trạng thái không hợp lệ');
      await store.save();
      res.json(t);
    }));
    r.post('/tasks/:id/due-now', wrap(async (req, res) => {
      const t = own(d().fbTasks, req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Không tìm thấy' });
      const item = enqueue(t);
      await store.save();
      res.json(item);
    }));
    r.delete('/tasks/:id', wrap(async (req, res) => {
      const t = own(d().fbTasks, req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Không tìm thấy' });
      d().fbTasks.splice(d().fbTasks.indexOf(t), 1);
      await store.save();
      res.json({ ok: true });
    }));

    // Hàng đợi đến hạn
    r.get('/due', (req, res) => res.json(mine(d().fbDue, req)));
    r.post('/due/:id/items/:groupId', wrap(async (req, res) => {
      const item = own(d().fbDue, req, req.params.id);
      const it = item && item.items.find((x) => x.groupId === req.params.groupId);
      if (!it) return res.status(404).json({ error: 'Không tìm thấy' });
      it.done = !!(req.body && req.body.done);
      await store.save();
      res.json(item);
    }));
    r.delete('/due/:id', wrap(async (req, res) => {
      const item = own(d().fbDue, req, req.params.id);
      if (!item) return res.status(404).json({ error: 'Không tìm thấy' });
      d().fbDue.splice(d().fbDue.indexOf(item), 1);
      await store.save();
      res.json({ ok: true });
    }));

    // Chat ID Telegram của chính người dùng để nhận nhắc (dùng bot đã kết nối ở Cài đặt)
    r.get('/reminder', (req, res) => res.json({ chatId: prefsOf(uid(req)).reminderChatId || '' }));
    r.put('/reminder', wrap(async (req, res) => {
      const v = str(req.body && req.body.chatId, 40);
      if (v && !/^-?\d{5,20}$/.test(v)) throw bad('Chat ID nhắc việc không hợp lệ');
      prefsOf(uid(req)).reminderChatId = v;
      await store.save();
      res.json({ ok: true });
    }));
    // Tự nhận diện Chat ID cá nhân: người dùng nhắn /start cho bot của mình rồi bấm nút (Telegram giữ tin ~24 giờ).
    r.get('/reminder/discover', wrap(async (req, res) => {
      const token = getToken(uid(req));
      if (!token) throw bad('Chưa kết nối bot Telegram - vào Cài đặt');
      let updates;
      try { updates = await tg.getUpdates(token); } catch (e) { throw bad(e.code === 409 ? 'Bot đang gắn với dịch vụ khác (webhook) nên không dò được nhóm. Hãy nhập Chat ID thủ công.' : e.message); }
      const last = [...updates].reverse().find((u) => u.message && u.message.chat && u.message.chat.type === 'private' && u.message.from && !u.message.from.is_bot);
      if (!last) return res.json({ chatId: '' });
      res.json({ chatId: String(last.message.chat.id), name: [last.message.from.first_name, last.message.from.last_name].filter(Boolean).join(' ') });
    }));
    r.post('/reminder/test', wrap(async (req, res) => {
      const chatId = prefsOf(uid(req)).reminderChatId;
      const token = getToken(uid(req));
      if (!token) throw bad('Chưa kết nối bot Telegram - vào Cài đặt');
      if (!chatId) throw bad('Nhập Chat ID nhắc việc trước');
      try { await tg.callRaw(token, 'sendMessage', { chat_id: chatId, text: `⏰ KingTele · ${publicUrl}/app#facebook` }); } catch (e) { throw bad(e.message); }
      res.json({ ok: true });
    }));
    return r;
  }

  return {
    tick, router, enqueue,
    start() { if (!timer) { timer = setInterval(() => tick().catch(console.error), 15000); tick().catch(console.error); } },
    stop() { clearInterval(timer); timer = null; },
  };
}

module.exports = { createFb, cleanFbUrl };
