const test = require('node:test');
const assert = require('node:assert');
const { chatsFromUpdates } = require('../src/telegram');
const core = require('../public/assets/i18n-core.js');

test('chatsFromUpdates: lấy nhóm/kênh, bỏ chat riêng và nhóm đã rời, mới nhất trước', () => {
  const r = chatsFromUpdates([
    { message: { chat: { id: 5, type: 'private' } } },
    { message: { chat: { id: -1001, type: 'supergroup', title: 'A' } } },
    { channel_post: { chat: { id: -1002, type: 'channel', title: 'B', username: 'bchan' } } },
    { my_chat_member: { chat: { id: -1003, type: 'group', title: 'C' }, new_chat_member: { status: 'member' } } },
    { my_chat_member: { chat: { id: -1003, type: 'group', title: 'C' }, new_chat_member: { status: 'kicked' } } },
    { message: { chat: { id: -1001, type: 'supergroup', title: 'A' } } },
  ]);
  assert.deepStrictEqual(r.map((c) => c.chatId), ['-1002', '-1001']);
  assert.strictEqual(r[0].username, 'bchan');
  assert.deepStrictEqual(chatsFromUpdates(null), []);
});

test('parseRich: đậm, mã, liên kết', () => {
  const parts = core.parseRich('a **b** `c` [d](https://t.me/x) e');
  assert.deepStrictEqual(parts.filter((p) => p.t !== 'text').map((p) => p.t), ['b', 'code', 'a']);
  assert.ok(JSON.stringify(parts).includes('https://t.me/x'));
});
