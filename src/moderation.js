'use strict';
// Duyệt bài trong nhóm Telegram. Telegram không cho bot giữ tin trước khi mọi người thấy, nên cách làm là:
//   1) thành viên gửi tin → bot sao chép tin cho admin (kèm nút Duyệt/Từ chối) rồi xoá tin gốc trong nhóm;
//   2) admin duyệt → bot copyMessage đăng lại vào nhóm (giữ nguyên định dạng, ảnh, video...), ghi tên người gửi.
// Mỗi thành viên KingTele dùng bot riêng của họ, nên mỗi người bật duyệt có một vòng long polling riêng.
const express = require('express');
const crypto = require('crypto');
const tg = require('./telegram');
const T = require('./moderation-text');

const MAX_POLLERS = 50;
const KEEP = 200;
const ADMIN_TTL = 5 * 60000;
const NOTICE_MS = 15000;
const WARN_EVERY = 3600000;

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const nameOf = (u) => ([u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id)).slice(0, 80);

/** Loại nội dung của tin nhắn người dùng ('' = tin dịch vụ, bỏ qua). */
function kindOf(m) {
  if (m.text) return 'text';
  for (const k of ['photo', 'video', 'animation', 'document', 'voice', 'audio', 'video_note', 'sticker', 'poll']) if (m[k]) return k;
  return '';
}

function createModeration({ store, getToken, isActive = () => true, api = tg }) {
  const d = () => store.data;
  const pollers = new Map();
  let timer = null;

  const prefsOf = (id) => (id === 'admin' ? d().settings : d().users.find((u) => u.id === id) || {});
  const approverOf = (id) => prefsOf(id).reminderChatId || '';
  const modGroups = (id) => d().groups.filter((g) => g.userId === id && g.moderated);
  const raw = (token, method, payload) => api.callRaw(token, method, payload);

  async function isExempt(p, token, chatId, from) {
    let c = p.adminCache.get(chatId);
    if (!c || c.at < Date.now() - ADMIN_TTL) {
      try { c = { at: Date.now(), ids: new Set((await raw(token, 'getChatAdministrators', { chat_id: chatId })).map((a) => String(a.user.id))) }; }
      catch { c = { at: Date.now(), ids: new Set() }; }
      p.adminCache.set(chatId, c);
    }
    return c.ids.has(String(from.id));
  }

  async function handleMessage(userId, p, m) {
    if (!m.chat || !['group', 'supergroup'].includes(m.chat.type)) return;
    const g = modGroups(userId).find((x) => x.chatId === String(m.chat.id));
    if (!g || !m.from || m.from.is_bot || m.sender_chat) return;
    const kind = kindOf(m);
    const approver = approverOf(userId);
    if (!kind || !approver || String(m.from.id) === String(approver)) return;
    if (await isExempt(p, p.token, String(m.chat.id), m.from)) return;

    const id = crypto.randomUUID();
    const author = nameOf(m.from);
    let hold;
    try {
      hold = await raw(p.token, 'copyMessage', {
        chat_id: approver, from_chat_id: m.chat.id, message_id: m.message_id,
        reply_markup: { inline_keyboard: [[{ text: T.approveBtn, callback_data: `mod:a:${id}` }, { text: T.rejectBtn, callback_data: `mod:r:${id}` }]] },
      });
    } catch { return; }
    try {
      await raw(p.token, 'deleteMessage', { chat_id: m.chat.id, message_id: m.message_id });
    } catch {
      raw(p.token, 'deleteMessage', { chat_id: approver, message_id: hold.message_id }).catch(() => {});
      if (Date.now() - p.warnedAt > WARN_EVERY) { p.warnedAt = Date.now(); raw(p.token, 'sendMessage', { chat_id: approver, text: T.cantDelete(g.title) }).catch(() => {}); }
      return;
    }
    d().modQueue.unshift({
      id, userId, groupId: g.id, groupTitle: g.title, chatId: String(m.chat.id), authorId: String(m.from.id), authorName: author, kind,
      preview: (m.text || m.caption || '').slice(0, 300), holdChatId: String(approver), holdMsgId: hold.message_id, status: 'pending', createdAt: Date.now(), decidedAt: null,
    });
    const mine = d().modQueue.filter((x) => x.userId === userId);
    for (const old of mine.slice(KEEP)) d().modQueue.splice(d().modQueue.indexOf(old), 1);
    await store.save();
    raw(p.token, 'sendMessage', { chat_id: approver, reply_to_message_id: hold.message_id, text: T.held(author, g.title) }).catch(() => {});
    raw(p.token, 'sendMessage', { chat_id: m.chat.id, text: T.notice(author) })
      .then((n) => setTimeout(() => raw(p.token, 'deleteMessage', { chat_id: m.chat.id, message_id: n.message_id }).catch(() => {}), NOTICE_MS).unref())
      .catch(() => {});
  }

  /** Duyệt hoặc từ chối một bài. Ném lỗi nếu Telegram không đăng lại được. */
  async function decide(item, approve) {
    if (item.status !== 'pending') throw bad('Bài này đã được xử lý');
    const token = getToken(item.userId);
    item.status = 'working';
    try {
      if (approve) {
        const out = await raw(token, 'copyMessage', { chat_id: item.chatId, from_chat_id: item.holdChatId, message_id: item.holdMsgId });
        raw(token, 'sendMessage', { chat_id: item.chatId, reply_to_message_id: out.message_id, text: T.published(item.authorName) }).catch(() => {});
      }
    } catch (e) { item.status = 'pending'; throw bad(e.message); }
    item.status = approve ? 'approved' : 'rejected';
    item.decidedAt = Date.now();
    raw(token, 'editMessageReplyMarkup', { chat_id: item.holdChatId, message_id: item.holdMsgId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await store.save();
    return item;
  }

  async function handleCallback(userId, p, cq) {
    const m = /^mod:([ar]):([\w-]{36})$/.exec(cq.data || '');
    const item = m && d().modQueue.find((x) => x.id === m[2] && x.userId === userId);
    const answer = (text) => raw(p.token, 'answerCallbackQuery', { callback_query_id: cq.id, text: String(text).slice(0, 180) }).catch(() => {});
    if (!item || String(cq.from.id) !== String(approverOf(userId))) return answer(T.handled);
    try { await decide(item, m[1] === 'a'); answer(m[1] === 'a' ? T.approved : T.rejected); } catch (e) { answer(e.message); }
  }

  async function handle(userId, p, u) {
    if (u.callback_query) return handleCallback(userId, p, u.callback_query);
    if (u.message) return handleMessage(userId, p, u.message);
  }

  async function loop(userId, p) {
    let offset = 0;
    while (!p.stopped) {
      try {
        const ups = await raw(p.token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query', 'my_chat_member', 'channel_post'] }, { timeoutMs: 40000 });
        for (const u of ups) {
          offset = u.update_id + 1;
          p.recent.push(u); if (p.recent.length > 100) p.recent.shift();
          await handle(userId, p, u).catch(() => {});
        }
        p.error = '';
      } catch (e) {
        if (e.code === 409) { p.error = 'webhook'; break; }
        if (e.code === 401) { p.error = 'token'; break; }
        await tg.sleep(5000);
      }
    }
    p.dead = true;
  }

  /** Đồng bộ danh sách vòng polling với các nhóm đang bật duyệt. */
  function sync() {
    const want = new Set(d().groups.filter((g) => g.moderated).map((g) => g.userId).filter((id) => isActive(id) && getToken(id) && approverOf(id)));
    for (const [id, p] of pollers) {
      if (!want.has(id) || p.token !== getToken(id)) { p.stopped = true; pollers.delete(id); }
      else if (p.dead) pollers.delete(id); // thử lại (vd. sau khi gỡ webhook)
    }
    for (const id of want) {
      if (pollers.has(id) || pollers.size >= MAX_POLLERS) continue;
      const p = { token: getToken(id), stopped: false, dead: false, error: '', recent: [], adminCache: new Map(), warnedAt: 0 };
      pollers.set(id, p);
      loop(id, p).catch(() => { p.dead = true; });
    }
  }

  /** Cập nhật gần đây của bot: dùng bộ nhớ của vòng polling nếu đang chạy (getUpdates không chạy song song được). */
  async function updates(userId, token) {
    const p = pollers.get(userId);
    return p && !p.dead ? p.recent.slice() : tg.getUpdates(token);
  }

  function router() {
    const r = express.Router();
    const uid = (req) => req.user.id;
    const mine = (req) => d().modQueue.filter((x) => x.userId === uid(req));
    const myGroup = (req) => d().groups.find((g) => g.id === req.params.id && g.userId === uid(req));

    r.get('/status', (req, res) => {
      const p = pollers.get(uid(req));
      res.json({
        approverChatId: approverOf(uid(req)),
        error: p && p.error ? p.error : '',
        groups: d().groups.filter((g) => g.userId === uid(req) && ['group', 'supergroup'].includes(g.type)).map((g) => ({ id: g.id, title: g.title, moderated: !!g.moderated })),
      });
    });

    r.post('/groups/:id/toggle', wrap(async (req, res) => {
      const g = myGroup(req);
      if (!g) return res.status(404).json({ error: 'Không tìm thấy nhóm' });
      if (!req.body || !req.body.enabled) { g.moderated = false; await store.save(); sync(); return res.json({ ok: true }); }
      const token = getToken(uid(req));
      const approver = approverOf(uid(req));
      if (!['group', 'supergroup'].includes(g.type)) throw bad('Chỉ áp dụng cho nhóm, không áp dụng cho kênh');
      if (!token) throw bad('Chưa kết nối bot Telegram - vào Cài đặt');
      if (!approver) throw bad('Hãy lưu Chat ID admin nhận bài chờ duyệt trước');
      try {
        const me = await tg.getMe(token);
        const member = await raw(token, 'getChatMember', { chat_id: g.chatId, user_id: me.id });
        if (member.status !== 'creator' && !(member.status === 'administrator' && member.can_delete_messages !== false)) throw new Error('no');
      } catch { throw bad('Bot cần là quản trị viên của nhóm và có quyền xoá tin nhắn'); }
      try { await raw(token, 'sendMessage', { chat_id: approver, text: T.enabled(g.title) }); }
      catch { throw bad('Không nhắn được cho admin. Hãy mở bot trên Telegram, bấm Start rồi thử lại.'); }
      g.moderated = true;
      await store.save();
      sync();
      res.json({ ok: true });
    }));

    r.get('/queue', (req, res) => res.json(mine(req).slice(0, 100)));
    r.post('/queue/:id/decide', wrap(async (req, res) => {
      const item = mine(req).find((x) => x.id === req.params.id);
      if (!item) return res.status(404).json({ error: 'Không tìm thấy' });
      res.json(await decide(item, !!(req.body && req.body.approve)));
    }));
    return r;
  }

  return {
    sync, updates, router, decide, handle, pollers,
    start() { if (!timer) { sync(); timer = setInterval(sync, 60000); timer.unref(); } },
    stop() { clearInterval(timer); timer = null; for (const p of pollers.values()) p.stopped = true; pollers.clear(); },
  };
}

module.exports = { createModeration, kindOf };
