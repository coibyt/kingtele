'use strict';
// Hộp thư bot: ghi nhận người đã nhắn tin cho bot của thành viên, tự động trả lời (cá nhân hoá) và gửi tin tới họ.
// Telegram không cho bot nhắn cho người chưa từng nhắn với bot và không cho lấy danh sách thành viên nhóm,
// nên danh sách người nhận chỉ gồm những người tự nhắn /start hoặc nhắn tin cho bot. Người dùng có thể /stop để hủy nhận.
const express = require('express');
const crypto = require('crypto');
const tg = require('./telegram');
const T = require('./inbox-text');

const MAX_CONTACTS = 5000;
const MAX_RULES = 10;
const MAX_TEXT = 4000;
const PER_MINUTE = 30;     // tối đa số tin trả lời tự động mỗi phút / bot, chống bị làm ngập
const SEND_GAP_MS = 400;   // giãn cách khi gửi hàng loạt, tránh giới hạn tốc độ của Telegram
const MAX_BROADCAST = 1000;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id);

/** Thay {ten}, {ho_ten}, {username} bằng thông tin người nhận. Văn bản thuần (không parse_mode) nên tên không thể chèn mã. */
function personalize(text, c) {
  const first = c.firstName || c.name || '';
  return String(text)
    .replace(/\{ho_ten\}/gi, c.name || first)
    .replace(/\{ten\}/gi, first || c.name || '')
    .replace(/\{username\}/gi, c.username ? `@${c.username}` : (c.name || first));
}

/** Chọn nội dung trả lời: quy tắc từ khoá khớp đầu tiên, nếu không thì lời chào mặc định. */
function pickReply(inbox, text) {
  const t = String(text || '').toLowerCase();
  const rule = (inbox.rules || []).find((r) => r.keyword && t.includes(r.keyword.toLowerCase()));
  return rule ? rule.text : inbox.text || '';
}

const isBlockedErr = (e) => e.code === 403 || /chat not found|user is deactivated|bot was blocked/i.test(e.message || '');

function createInbox({ store, getToken, points, api = tg, onChange = () => {} }) {
  const d = () => store.data;
  const prefsOf = (id) => (id === 'admin' ? d().settings : d().users.find((u) => u.id === id) || {});
  const inboxOf = (id) => { const p = prefsOf(id); if (!p.inbox) p.inbox = { enabled: false, text: '', cooldownHours: 24, rules: [] }; return p.inbox; };
  const contactsOf = (id) => d().botContacts.filter((c) => c.userId === id);
  const windows = new Map(); // userId -> {n, until}
  const jobs = new Map();    // userId -> trạng thái đợt gửi gần nhất
  const send = (token, chatId, text) => api.callRaw(token, 'sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } });

  const wants = (userId) => !!inboxOf(userId).enabled;

  /** Nhận tin nhắn riêng gửi cho bot của userId. */
  async function onPrivate(userId, token, m) {
    const inbox = inboxOf(userId);
    if (!inbox.enabled || !m.from || m.from.is_bot) return;
    const now = Date.now();
    let c = contactsOf(userId).find((x) => x.tgId === String(m.from.id));
    const isNew = !c;
    if (!c) {
      if (contactsOf(userId).length >= MAX_CONTACTS) return;
      c = { id: crypto.randomUUID(), userId, tgId: String(m.from.id), firstName: m.from.first_name || '', name: fullName(m.from), username: m.from.username || '', firstSeen: now, lastSeen: now, lastText: '', msgCount: 0, optedOut: false, blocked: false, lastReplyAt: 0 };
      d().botContacts.push(c);
    }
    Object.assign(c, { firstName: m.from.first_name || c.firstName, name: fullName(m.from), username: m.from.username || '', lastSeen: now, blocked: false, msgCount: c.msgCount + 1, lastText: str(m.text || m.caption || '', 200) });
    const cmd = (m.text || '').trim().toLowerCase().split(/[\s@]/)[0];
    let reply = '';
    if (cmd === '/stop') { c.optedOut = true; reply = T.stopped; }
    else {
      if (cmd === '/start' && c.optedOut) { c.optedOut = false; await send(token, c.tgId, T.resumed).catch(() => {}); }
      const cooled = now - c.lastReplyAt >= (inbox.cooldownHours || 24) * 3600000;
      if (!c.optedOut && (isNew || cooled || cmd === '/start')) reply = pickReply(inbox, m.text);
    }
    await store.save();
    if (!reply) return;
    const w = windows.get(userId) && windows.get(userId).until > now ? windows.get(userId) : { n: 0, until: now + 60000 };
    windows.set(userId, w);
    if (++w.n > PER_MINUTE) return;
    try { await send(token, c.tgId, personalize(reply, c)); c.lastReplyAt = Date.now(); await store.save(); }
    catch (e) { if (isBlockedErr(e)) { c.blocked = true; await store.save(); } }
  }

  /** Gửi một tin cá nhân hoá tới một người; trừ 1 Điểm King khi thành công. */
  async function sendTo(userId, c, text) {
    const token = getToken(userId);
    if (!token) throw bad('Chưa kết nối bot Telegram - vào Cài đặt');
    if (c.optedOut || c.blocked) throw bad('Người này đã chặn bot hoặc hủy nhận tin');
    if (!points.has(userId)) throw bad('Không đủ Điểm King. Hãy điểm danh hoặc giới thiệu bạn bè để nhận thêm.', 402);
    try { await send(token, c.tgId, personalize(text, c)); }
    catch (e) { if (isBlockedErr(e)) { c.blocked = true; await store.save(); throw bad('Người này đã chặn bot hoặc hủy nhận tin'); } throw bad(e.message); }
    points.spend(userId); points.afterSend(userId);
    await store.save();
  }

  async function runBroadcast(userId, list, text, job) {
    for (const c of list) {
      if (job.cancelled) break;
      try { await sendTo(userId, c, text); job.sent++; }
      catch (e) {
        job.failed++;
        if (e.status === 402) { job.error = e.message; break; }
      }
      await tg.sleep(SEND_GAP_MS);
    }
    job.done = true;
  }

  function router() {
    const r = express.Router();
    const uid = (req) => req.user.id;
    const find = (req) => contactsOf(uid(req)).find((c) => c.id === req.params.id);
    const sendable = (req, audience) => contactsOf(uid(req)).filter((c) => !c.optedOut && !c.blocked && (audience !== 'active7' || c.lastSeen >= Date.now() - 7 * 86400000));

    r.get('/status', wrap(async (req, res) => {
      const i = inboxOf(uid(req));
      const list = contactsOf(uid(req));
      let bot = '';
      try { if (getToken(uid(req))) bot = (await api.getMe(getToken(uid(req)))).username || ''; } catch { /* bỏ qua */ }
      res.json({
        enabled: !!i.enabled, text: i.text || '', cooldownHours: i.cooldownHours || 24, rules: i.rules || [], bot,
        counts: { total: list.length, active: list.filter((c) => !c.optedOut && !c.blocked).length, optedOut: list.filter((c) => c.optedOut).length, blocked: list.filter((c) => c.blocked).length },
        job: jobs.get(uid(req)) || null,
      });
    }));

    r.put('/settings', wrap(async (req, res) => {
      const b = req.body || {};
      const i = inboxOf(uid(req));
      if (b.enabled && !getToken(uid(req))) throw bad('Chưa kết nối bot Telegram - vào Cài đặt');
      const rules = (Array.isArray(b.rules) ? b.rules : []).map((x) => ({ keyword: str(x && x.keyword, 60), text: str(x && x.text, MAX_TEXT) })).filter((x) => x.keyword || x.text);
      if (rules.length > MAX_RULES) throw bad(`Tối đa ${MAX_RULES} quy tắc`);
      if (rules.some((x) => !x.keyword || !x.text)) throw bad('Từ khoá và nội dung trả lời không được để trống');
      const text = typeof b.text === 'string' ? b.text.trim() : '';
      if (text.length > MAX_TEXT) throw bad(`Tin nhắn tối đa ${MAX_TEXT} ký tự`);
      Object.assign(i, { enabled: !!b.enabled, text, rules, cooldownHours: Math.min(168, Math.max(1, Math.floor(Number(b.cooldownHours)) || 24)) });
      await store.save();
      onChange();
      res.json({ ok: true });
    }));

    r.get('/contacts', (req, res) => res.json([...contactsOf(uid(req))].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 300)));
    r.delete('/contacts/:id', wrap(async (req, res) => {
      const c = find(req);
      if (!c) return res.status(404).json({ error: 'Không tìm thấy' });
      d().botContacts.splice(d().botContacts.indexOf(c), 1);
      await store.save();
      res.json({ ok: true });
    }));

    r.post('/contacts/:id/send', wrap(async (req, res) => {
      const c = find(req);
      if (!c) return res.status(404).json({ error: 'Không tìm thấy' });
      const text = str(req.body && req.body.text, MAX_TEXT + 1);
      if (!text) throw bad('Nhập nội dung tin nhắn');
      if (text.length > MAX_TEXT) throw bad(`Tin nhắn tối đa ${MAX_TEXT} ký tự`);
      await sendTo(uid(req), c, text);
      res.json({ ok: true });
    }));

    r.post('/broadcast', wrap(async (req, res) => {
      const text = str(req.body && req.body.text, MAX_TEXT + 1);
      if (!text) throw bad('Nhập nội dung tin nhắn');
      if (text.length > MAX_TEXT) throw bad(`Tin nhắn tối đa ${MAX_TEXT} ký tự`);
      const prev = jobs.get(uid(req));
      if (prev && !prev.done) throw bad('Đang có đợt gửi khác, vui lòng chờ');
      if (!getToken(uid(req))) throw bad('Chưa kết nối bot Telegram - vào Cài đặt');
      const list = sendable(req, req.body && req.body.audience).slice(0, MAX_BROADCAST);
      if (!list.length) throw bad('Chưa có người nào để gửi');
      const job = { id: crypto.randomUUID(), total: list.length, sent: 0, failed: 0, done: false, error: '', startedAt: Date.now() };
      jobs.set(uid(req), job);
      runBroadcast(uid(req), list, text, job).catch(() => { job.done = true; });
      res.status(202).json(job);
    }));
    r.get('/broadcast', (req, res) => res.json(jobs.get(uid(req)) || null));
    r.get('/audience', (req, res) => res.json({ all: sendable(req, 'all').length, active7: sendable(req, 'active7').length }));
    return r;
  }

  return { router, onPrivate, wants, personalize, pickReply, sendTo };
}

module.exports = { createInbox, personalize, pickReply };
