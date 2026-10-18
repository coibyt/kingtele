const test = require('node:test');
const assert = require('node:assert');
const { createModeration, kindOf } = require('../src/moderation');

function setup({ deleteFails = false } = {}) {
  const calls = [];
  const api = {
    callRaw: async (token, method, payload) => {
      calls.push({ method, ...payload });
      if (method === 'getChatAdministrators') return [{ user: { id: 1 } }];
      if (method === 'copyMessage') return { message_id: 900 + calls.length };
      if (method === 'deleteMessage' && deleteFails && payload.chat_id === -100) throw new Error('no rights');
      if (method === 'sendMessage') return { message_id: 777 };
      return true;
    },
  };
  const store = {
    data: {
      groups: [{ id: 'g1', userId: 'u1', chatId: '-100', title: 'Nhóm A', type: 'supergroup', moderated: true }],
      users: [{ id: 'u1', reminderChatId: '555' }], settings: {}, modQueue: [],
    },
    save: async () => {},
  };
  const mod = createModeration({ store, getToken: () => 'tok', api });
  return { calls, store, mod, p: { token: 'tok', adminCache: new Map(), warnedAt: 0, recent: [] } };
}
const msg = (from, extra = {}) => ({ message: { message_id: 10, chat: { id: -100, type: 'supergroup' }, from, text: 'xin chào', ...extra } });

test('kindOf: nhận diện loại tin, bỏ qua tin dịch vụ', () => {
  assert.strictEqual(kindOf({ text: 'a' }), 'text');
  assert.strictEqual(kindOf({ photo: [{}], caption: 'x' }), 'photo');
  assert.strictEqual(kindOf({ new_chat_members: [{}] }), '');
});

test('tin thành viên: sao chép cho admin kèm nút, xoá tin gốc, vào hàng chờ; admin nhóm và bot không bị chặn', async () => {
  const { calls, store, mod, p } = setup();
  await mod.handle('u1', p, msg({ id: 2, first_name: 'An', is_bot: false }));
  assert.deepStrictEqual(calls.filter((c) => ['copyMessage', 'deleteMessage'].includes(c.method)).map((c) => [c.method, c.chat_id]), [['copyMessage', '555'], ['deleteMessage', -100]]);
  assert.strictEqual(store.data.modQueue.length, 1);
  assert.strictEqual(store.data.modQueue[0].status, 'pending');
  await mod.handle('u1', p, msg({ id: 1, first_name: 'Admin', is_bot: false })); // admin nhóm
  await mod.handle('u1', p, msg({ id: 3, is_bot: true }));                         // bot
  await mod.handle('u1', p, msg({ id: 555, first_name: 'Chủ', is_bot: false }));   // người duyệt
  assert.strictEqual(store.data.modQueue.length, 1);
});

test('không xoá được tin gốc: không đưa vào hàng chờ và huỷ bản giữ', async () => {
  const { calls, store, mod, p } = setup({ deleteFails: true });
  await mod.handle('u1', p, msg({ id: 2, first_name: 'An', is_bot: false }));
  assert.strictEqual(store.data.modQueue.length, 0);
  assert.ok(calls.some((c) => c.method === 'deleteMessage' && c.chat_id === '555'));
});

test('duyệt: đăng lại vào nhóm bằng copyMessage từ bản giữ; xử lý lần hai báo lỗi; từ chối không đăng', async () => {
  const { calls, store, mod, p } = setup();
  await mod.handle('u1', p, msg({ id: 2, first_name: 'An', is_bot: false }));
  await mod.handle('u1', p, msg({ id: 4, first_name: 'Bình', is_bot: false }));
  const [b, a] = store.data.modQueue; // mới nhất trước
  await mod.decide(a, true);
  const pub = calls.find((c) => c.method === 'copyMessage' && c.chat_id === '-100');
  assert.ok(pub && pub.from_chat_id === '555' && pub.message_id === a.holdMsgId);
  assert.strictEqual(a.status, 'approved');
  await assert.rejects(mod.decide(a, true), /xử lý/);
  const before = calls.filter((c) => c.method === 'copyMessage').length;
  await mod.decide(b, false);
  assert.strictEqual(b.status, 'rejected');
  assert.strictEqual(calls.filter((c) => c.method === 'copyMessage').length, before);
});
