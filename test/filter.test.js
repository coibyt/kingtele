const test = require('node:test');
const assert = require('node:assert');
const { createModeration, matchWord } = require('../src/moderation');

test('matchWord: không phân biệt hoa thường, chuỗi con, ký tự đơn, bỏ dấu tuỳ chọn, bỏ ký tự vô hình', () => {
  const f = { words: ['Ma tuý', 'cá độ', '@'], ignoreAccents: true };
  assert.strictEqual(matchWord(f, 'bán MA TÚY giá rẻ'), 'Ma tuý');
  assert.strictEqual(matchWord(f, 'ca do bong da'), 'cá độ');
  assert.strictEqual(matchWord(f, 'liên hệ @abc'), '@');
  assert.strictEqual(matchWord(f, 'ma tu​y'), 'Ma tuý');
  assert.strictEqual(matchWord(f, 'xin chào'), '');
  assert.strictEqual(matchWord({ words: ['ă'], ignoreAccents: false }, 'ban a'), '');
  assert.strictEqual(matchWord({ words: ['ă'], ignoreAccents: false }, 'bạn ăn'), 'ă');
  assert.strictEqual(matchWord({ words: [] }, 'x'), '');
});

function setup(filter, extra = {}) {
  const calls = [];
  const api = { callRaw: async (t, method, p) => {
    calls.push({ method, ...p });
    if (method === 'getChatAdministrators') return [{ user: { id: 1 } }];
    if (method === 'copyMessage') return { message_id: 900 };
    if (method === 'sendMessage') return { message_id: 777 };
    return true;
  } };
  const store = { data: { groups: [{ id: 'g1', userId: 'u1', chatId: '-100', title: 'A', type: 'supergroup', filter, ...extra }], users: [{ id: 'u1', reminderChatId: '555' }], settings: {}, modQueue: [], filterLog: [] }, save: async () => {} };
  return { calls, store, mod: createModeration({ store, getToken: () => 'tok', api }), p: { token: 'tok', adminCache: new Map(), warnedAt: 0, recent: [] } };
}
const msg = (text, from = { id: 2, first_name: 'An', is_bot: false }, key = 'message') => ({ [key]: { message_id: 10, chat: { id: -100, type: 'supergroup' }, from, text } });

test('lọc từ khoá: xoá tin chứa từ cấm và ghi nhật ký; tin sạch, admin nhóm và bot không bị đụng tới', async () => {
  const { calls, store, mod, p } = setup({ enabled: true, words: ['cá độ'], action: 'delete', ignoreAccents: true });
  await mod.handle('u1', p, msg('kèo CA DO uy tín'));
  assert.ok(calls.some((c) => c.method === 'deleteMessage' && c.chat_id === -100 && c.message_id === 10));
  assert.strictEqual(store.data.filterLog.length, 1);
  assert.strictEqual(store.data.filterLog[0].word, 'cá độ');
  assert.strictEqual(store.data.modQueue.length, 0);
  const n = calls.length;
  await mod.handle('u1', p, msg('xin chào mọi người'));
  await mod.handle('u1', p, msg('cá độ', { id: 1, first_name: 'Admin', is_bot: false }));
  await mod.handle('u1', p, msg('cá độ', { id: 3, is_bot: true }));
  assert.strictEqual(calls.slice(n).filter((c) => c.method === 'deleteMessage').length, 0);
  await mod.handle('u1', p, { edited_message: msg('giờ sửa thành cá độ').message });
  assert.strictEqual(store.data.filterLog.length, 2); // tin đã sửa cũng bị xoá
});

test('hành động giữ lại: tin chứa từ cấm vào hàng chờ duyệt kèm từ khớp; thiếu người duyệt thì xoá luôn', async () => {
  const a = setup({ enabled: true, words: ['spam'], action: 'hold', ignoreAccents: true });
  await a.mod.handle('u1', a.p, msg('mua SPAM đi'));
  assert.strictEqual(a.store.data.modQueue.length, 1);
  assert.strictEqual(a.store.data.modQueue[0].matched, 'spam');
  assert.strictEqual(a.store.data.filterLog.length, 0);

  const b = setup({ enabled: true, words: ['spam'], action: 'hold', ignoreAccents: true });
  b.store.data.users[0].reminderChatId = '';
  await b.mod.handle('u1', b.p, msg('mua spam đi'));
  assert.strictEqual(b.store.data.modQueue.length, 0);
  assert.strictEqual(b.store.data.filterLog.length, 1);
});
