'use strict';
// Client Telegram Bot API tối giản (dùng fetch/FormData có sẵn của Node 18+).
const fsp = require('fs/promises');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime' };
const METHOD = { image: ['sendPhoto', 'photo'], animation: ['sendAnimation', 'animation'], video: ['sendVideo', 'video'] };

/** payload: object (JSON) hoặc FormData (tải file lên). */
async function call(token, method, payload, attempt = 0) {
  if (!token) throw new Error('Chưa cấu hình token bot Telegram');
  const isForm = typeof FormData !== 'undefined' && payload instanceof FormData;
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      ...(isForm ? { body: payload } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) }),
      signal: AbortSignal.timeout(isForm ? 180000 : 25000),
    });
  } catch (e) {
    throw new Error(`Không kết nối được Telegram (${e.name === 'TimeoutError' ? 'quá thời gian' : 'lỗi mạng'})`);
  }
  const json = await res.json().catch(() => ({}));
  if (json.ok) return json.result;
  const retry = json.parameters && json.parameters.retry_after;
  if (res.status === 429 && retry && attempt < 2) {
    await sleep((retry + 1) * 1000);
    return call(token, method, payload, attempt + 1);
  }
  const err = new Error(json.description || `Telegram HTTP ${res.status}`);
  err.code = json.error_code || res.status;
  throw err;
}

const getMe = (token) => call(token, 'getMe');
const getChat = (token, chatId) => call(token, 'getChat', { chat_id: chatId });

function keyboard(buttons) {
  if (!buttons || !buttons.length) return undefined;
  return { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) };
}

function fileIdOf(result, kind) {
  if (kind === 'image') return result.photo && result.photo[result.photo.length - 1].file_id;
  if (kind === 'video') return result.video && result.video.file_id;
  return (result.animation || result.document || {}).file_id;
}

/**
 * Gửi một bài tới một chat. Trả về message_id.
 * ctx.uploadsDir: thư mục chứa file tải lên. File chỉ được upload một lần,
 * các nhóm sau dùng file_id Telegram trả về (lưu trong post.media.fileId).
 */
async function sendPost(token, chatId, post, ctx = {}) {
  const reply_markup = keyboard(post.buttons);
  const common = {
    chat_id: chatId,
    ...(post.parseMode && post.parseMode !== 'none' ? { parse_mode: post.parseMode } : {}),
    ...(post.silent ? { disable_notification: true } : {}),
  };
  const media = post.media;

  if (media || post.imageUrl) {
    const kind = media ? media.kind : 'image';
    const [method, field] = METHOD[kind];
    const fits = (post.text || '').length <= 1024;
    const extra = {
      ...common,
      ...(fits && post.text ? { caption: post.text } : {}),
      ...(reply_markup ? { reply_markup } : {}),
      ...(kind === 'video' ? { supports_streaming: true } : {}),
    };

    const send = async (useCachedId) => {
      if (!media || useCachedId) {
        return call(token, method, { ...extra, [field]: media ? media.fileId : post.imageUrl });
      }
      const ext = path.extname(media.file).slice(1);
      const buf = await fsp.readFile(path.join(ctx.uploadsDir, media.file));
      const form = new FormData();
      for (const [k, v] of Object.entries(extra)) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      form.append(field, new Blob([buf], { type: MIME[ext] || 'application/octet-stream' }), media.name || media.file);
      return call(token, method, form);
    };

    let result;
    if (media && media.fileId) {
      try { result = await send(true); } catch (e) { if (e.code === 400) { media.fileId = ''; result = await send(false); } else throw e; }
    } else {
      result = await send(false);
    }
    if (media) media.fileId = fileIdOf(result, kind) || media.fileId || '';

    if (!fits) {
      await call(token, 'sendMessage', {
        ...common, text: post.text, ...(reply_markup ? { reply_markup } : {}), link_preview_options: { is_disabled: true },
      });
    }
    return result.message_id;
  }

  const m = await call(token, 'sendMessage', {
    ...common,
    text: post.text,
    ...(reply_markup ? { reply_markup } : {}),
    link_preview_options: { is_disabled: !!post.noPreview },
  });
  return m.message_id;
}

/** Cập nhật gần đây bot nhận được (Telegram giữ tối đa 24 giờ). Không xác nhận nên không mất dữ liệu. */
const getUpdates = (token) => call(token, 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message', 'channel_post', 'my_chat_member'] });

/** Lấy danh sách nhóm/kênh từ các cập nhật; bỏ nhóm mà bot đã bị mời ra. Mới nhất trước. */
function chatsFromUpdates(updates) {
  const seen = new Map();
  for (const u of updates || []) {
    const ev = u.my_chat_member || null;
    const chat = (ev && ev.chat) || (u.message && u.message.chat) || (u.edited_message && u.edited_message.chat)
      || (u.channel_post && u.channel_post.chat) || (u.edited_channel_post && u.edited_channel_post.chat);
    if (!chat || !['group', 'supergroup', 'channel'].includes(chat.type)) continue;
    const gone = !!ev && ['left', 'kicked'].includes(ev.new_chat_member && ev.new_chat_member.status);
    seen.set(String(chat.id), { chatId: String(chat.id), title: chat.title || chat.username || String(chat.id), type: chat.type, username: chat.username || '', gone });
  }
  return [...seen.values()].filter((c) => !c.gone).reverse().map(({ gone, ...c }) => c);
}

module.exports = { getMe, getChat, getUpdates, chatsFromUpdates, sendPost, sleep };
