'use strict';
// Client Telegram Bot API tối giản (dùng fetch có sẵn của Node 18+).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(token, method, body, attempt = 0) {
  if (!token) throw new Error('Chưa cấu hình token bot Telegram');
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    throw new Error(`Không kết nối được Telegram (${e.name === 'TimeoutError' ? 'quá thời gian' : 'lỗi mạng'})`);
  }
  const json = await res.json().catch(() => ({}));
  if (json.ok) return json.result;
  const retry = json.parameters && json.parameters.retry_after;
  if (res.status === 429 && retry && attempt < 2) {
    await sleep((retry + 1) * 1000);
    return call(token, method, body, attempt + 1);
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

/** Gửi một bài tới một chat. Trả về message_id. */
async function sendPost(token, chatId, post) {
  const common = {
    chat_id: chatId,
    ...(post.parseMode && post.parseMode !== 'none' ? { parse_mode: post.parseMode } : {}),
    ...(post.silent ? { disable_notification: true } : {}),
    ...(keyboard(post.buttons) ? { reply_markup: keyboard(post.buttons) } : {}),
  };
  if (post.imageUrl) {
    const fits = (post.text || '').length <= 1024;
    const m = await call(token, 'sendPhoto', {
      ...common,
      photo: post.imageUrl,
      ...(fits && post.text ? { caption: post.text } : {}),
    });
    if (!fits) {
      const { reply_markup, ...rest } = common;
      await call(token, 'sendMessage', { ...rest, text: post.text, ...(reply_markup ? { reply_markup } : {}), link_preview_options: { is_disabled: true } });
    }
    return m.message_id;
  }
  const m = await call(token, 'sendMessage', {
    ...common,
    text: post.text,
    link_preview_options: { is_disabled: !!post.noPreview },
  });
  return m.message_id;
}

module.exports = { getMe, getChat, sendPost, sleep };
