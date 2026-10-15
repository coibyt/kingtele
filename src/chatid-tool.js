'use strict';
// Công cụ miễn phí lấy ID nhóm Telegram (không cần đăng nhập).
//  - lookup(): người dùng dán link/@username → tra Chat ID bằng bot công cụ (TOOL_BOT_TOKEN).
//  - startToolBot(): bot trả lời Chat ID khi được thêm vào nhóm/kênh, khi nhận tin chuyển tiếp từ kênh, hoặc lệnh /id.
// Không lưu tin nhắn hay token của ai. Bot công cụ tách riêng với bot của từng thành viên.
const tg = require('./telegram');

const NAME = '[A-Za-z][A-Za-z0-9_]{3,31}';
const RESERVED = new Set(['joinchat', 'addstickers', 'addemoji', 'share', 'proxy', 'socks', 'login', 'iv', 'c', 's', 'setlanguage', 'boost']);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Nhận diện thứ người dùng dán vào. Trả {kind, ...}; kind: id | username | private-link | invite | invalid. */
function parseInput(raw) {
  const text = typeof raw === 'string' ? raw.trim().slice(0, 300) : '';
  if (!text) return { kind: 'invalid' };
  if (/^-?\d{5,20}$/.test(text)) return { kind: 'id', chatId: text };

  const at = text.match(new RegExp(`^@(${NAME})$`));
  if (at) return { kind: 'username', username: at[1] };
  if (new RegExp(`^${NAME}$`).test(text) && !/^\d+$/.test(text)) return { kind: 'username', username: text };

  const m = text.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/([^?#]+)/i);
  if (!m) return { kind: 'invalid' };
  const parts = m[1].split('/').filter(Boolean);
  const first = parts[0] || '';
  if (first.startsWith('+') || first.toLowerCase() === 'joinchat') return { kind: 'invite' };
  if (first === 'c' && /^\d{4,15}$/.test(parts[1] || '')) return { kind: 'private-link', chatId: `-100${parts[1]}` };
  if (first === 's' && new RegExp(`^${NAME}$`).test(parts[1] || '')) return { kind: 'username', username: parts[1] };
  if (new RegExp(`^${NAME}$`).test(first) && !RESERVED.has(first.toLowerCase())) return { kind: 'username', username: first };
  return { kind: 'invalid' };
}

const TYPE_VI = { group: 'Nhóm', supergroup: 'Siêu nhóm', channel: 'Kênh', private: 'Người dùng' };
const describe = (chat) => ({
  chatId: String(chat.id),
  title: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '',
  type: chat.type,
  typeLabel: TYPE_VI[chat.type] || chat.type,
  username: chat.username || '',
});

/** Tra cứu cho trang web. Ném lỗi {status,message} dễ hiểu bằng tiếng Việt. */
async function lookup(input, token) {
  const p = parseInput(input);
  const fail = (status, message) => Object.assign(new Error(message), { status });
  if (p.kind === 'invalid') throw fail(400, 'Chưa nhận ra đường dẫn. Hãy dán link dạng t.me/tennhom, t.me/c/… hoặc @tennhom.');
  if (p.kind === 'invite') {
    throw fail(422, 'Link mời riêng tư (t.me/+…) không chứa Chat ID và Telegram không cho tra từ link này. Hãy thêm bot công cụ vào nhóm (nó sẽ tự báo ID) hoặc dán link của một tin nhắn trong nhóm (dạng t.me/c/…).');
  }
  if (p.kind === 'id') return { chatId: p.chatId, source: 'Bạn đã nhập sẵn ID này', note: 'Đây chính là số bạn nhập; công cụ không kiểm tra nhóm có tồn tại hay không.' };
  if (p.kind === 'private-link') {
    return { chatId: p.chatId, source: 'Lấy từ link tin nhắn riêng tư', note: 'Tách trực tiếp từ link nên không cần bot. Hãy chắc link thuộc đúng nhóm bạn muốn.' };
  }
  if (!token) throw fail(503, 'Chức năng tra @username đang bảo trì. Bạn vẫn có thể dùng cách thêm bot vào nhóm bên dưới.');
  try {
    const chat = await tg.getChat(token, `@${p.username}`);
    if (chat.type === 'private') throw fail(422, 'Đây là tài khoản người dùng hoặc bot, không phải nhóm/kênh.');
    return { ...describe(chat), source: `Tra từ @${p.username}` };
  } catch (e) {
    if (e.status) throw e;
    if (e.code === 400 || /chat not found/i.test(e.message)) throw fail(404, `Không tìm thấy nhóm hoặc kênh công khai @${p.username}. Kiểm tra lại tên, hoặc nếu đây là nhóm riêng tư hãy dùng cách thêm bot.`);
    throw fail(502, 'Không kết nối được Telegram lúc này. Vui lòng thử lại sau ít phút.');
  }
}

function idMessage(chat, extra = '') {
  const c = describe(chat);
  return `<b>${esc(c.typeLabel)}: ${esc(c.title)}</b>\nChat ID: <code>${esc(c.chatId)}</code>\n\nChạm vào dãy số để sao chép, rồi dán vào mục Nhóm Telegram của KingTele (https://kingtele.com).${extra}`;
}

const WELCOME = 'Chào bạn! Mình giúp lấy Chat ID của nhóm Telegram.\n\n'
  + '• <b>Nhóm/kênh riêng tư:</b> thêm mình vào nhóm, mình báo ID ngay rồi tự rời nhóm.\n'
  + '• <b>Kênh:</b> chuyển tiếp (forward) một bài của kênh cho mình.\n'
  + '• <b>Nhóm công khai:</b> gửi link <code>t.me/tennhom</code> hoặc <code>@tennhom</code>.\n\n'
  + 'Công cụ miễn phí của KingTele: https://kingtele.com/cong-cu/lay-id-nhom-telegram';

/** Bot công cụ chạy bằng long polling. Trả {stop}. Không làm gì nếu thiếu token. */
function startToolBot({ token, log = console, fetchFn }) {
  const api = fetchFn || tg;
  let stopped = false;
  let me = null;

  const send = (chatId, text) => api.callRaw(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => {});

  async function handle(u) {
    const ev = u.my_chat_member;
    if (ev && ['group', 'supergroup', 'channel'].includes(ev.chat.type)
      && ['member', 'administrator'].includes(ev.new_chat_member && ev.new_chat_member.status)
      && ev.new_chat_member.user && me && ev.new_chat_member.user.id === me.id) {
      await send(ev.chat.id, idMessage(ev.chat, '\n\nMình sẽ tự rời nhóm sau giây lát. Bạn không cần gỡ bot.'));
      setTimeout(() => api.callRaw(token, 'leaveChat', { chat_id: ev.chat.id }).catch(() => {}), 3000);
      return;
    }
    const m = u.message;
    if (!m || !m.chat) return;
    const text = (m.text || '').trim();
    if (m.chat.type !== 'private') {
      if (/^\/(id|chatid)(@\w+)?$/i.test(text)) {
        await send(m.chat.id, idMessage(m.chat, '\n\nMình sẽ tự rời nhóm sau giây lát.'));
        setTimeout(() => api.callRaw(token, 'leaveChat', { chat_id: m.chat.id }).catch(() => {}), 3000);
      }
      return;
    }
    const origin = m.forward_origin || {};
    const fwd = origin.type === 'channel' ? origin.chat : origin.type === 'chat' ? origin.sender_chat : m.forward_from_chat;
    if (fwd) return send(m.chat.id, idMessage(fwd));
    if (m.forward_origin || m.forward_from || m.forward_sender_name) {
      return send(m.chat.id, 'Tin chuyển tiếp từ người dùng hoặc từ nhóm thường không chứa Chat ID của nhóm (Telegram không cung cấp). Hãy thêm mình vào nhóm, mình sẽ báo ID ngay.');
    }
    if (!text || /^\/(start|help)/i.test(text)) return send(m.chat.id, WELCOME);
    try {
      const r = await lookup(text, token);
      return send(m.chat.id, `${r.title ? `<b>${esc(r.typeLabel)}: ${esc(r.title)}</b>\n` : ''}Chat ID: <code>${esc(r.chatId)}</code>`);
    } catch (e) {
      return send(m.chat.id, esc(e.message));
    }
  }

  (async () => {
    try {
      me = await api.getMe(token);
      log.log(`[chatid-tool] bot @${me.username} đang chạy`);
    } catch (e) { log.warn(`[chatid-tool] token không dùng được: ${e.message}`); return; }
    let offset = 0;
    while (!stopped) {
      try {
        const updates = await api.callRaw(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'my_chat_member'] }, { timeoutMs: 40000 });
        for (const u of updates) { offset = u.update_id + 1; await handle(u).catch(() => {}); }
      } catch (e) {
        if (e.code === 409) { log.warn('[chatid-tool] bot đang có webhook/phiên khác, dừng. Dùng token riêng cho công cụ.'); return; }
        await tg.sleep(5000);
      }
    }
  })();

  return { stop() { stopped = true; }, username: () => (me && me.username) || '' };
}

// Thông báo của công cụ web (trang công cụ chỉ có tiếng Việt, không đi qua hệ thống dịch)
const MESSAGES = { rate: 'Bạn tra hơi nhanh. Vui lòng thử lại sau ít phút.', generic: 'Có lỗi xảy ra, vui lòng thử lại.' };

module.exports = { MESSAGES, parseInput, lookup, startToolBot, idMessage };
