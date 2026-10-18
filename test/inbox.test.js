const test = require('node:test');
const assert = require('node:assert');
const { createInbox, personalize, pickReply } = require('../src/inbox');

function setup(inboxCfg = {}) {
  const sent = [];
  const api = { callRaw: async (t, method, p) => { if (method === 'sendMessage') { if (p.chat_id === '666') { const e = new Error('Forbidden: bot was blocked by the user'); e.code = 403; throw e; } sent.push(p); } return {}; }, getMe: async () => ({ username: 'kbot' }) };
  const store = { data: { botContacts: [], users: [{ id: 'u1', points: 3, inbox: { enabled: true, text: 'Chào {ten}!', cooldownHours: 24, rules: [{ keyword: 'giá', text: 'Giá {ho_ten}: 100k' }], ...inboxCfg } }], settings: {} }, save: async () => {} };
  let pts = 3;
  const points = { has: () => pts > 0, spend: () => { pts--; return true; }, afterSend: () => {} };
  const inbox = createInbox({ store, getToken: () => 'tok', points, api });
  return { sent, store, inbox, points: () => pts };
}
const dm = (id, text, extra = {}) => ({ chat: { id, type: 'private' }, from: { id, first_name: 'An', last_name: 'Lê', username: 'anle', is_bot: false, ...extra }, text });

test('personalize và pickReply', () => {
  const c = { firstName: 'An', name: 'An Lê', username: 'anle' };
  assert.strictEqual(personalize('Chào {ten} / {ho_ten} / {username}', c), 'Chào An / An Lê / @anle');
  assert.strictEqual(personalize('Hi {TEN}', { firstName: '', name: 'X' }), 'Hi X');
  assert.strictEqual(pickReply({ text: 'mặc định', rules: [{ keyword: 'Giá', text: 'R' }] }, 'cho hỏi giá nhé'), 'R');
  assert.strictEqual(pickReply({ text: 'mặc định', rules: [] }, 'xin chào'), 'mặc định');
});

test('tin nhắn riêng: ghi nhận người, trả lời cá nhân hoá, chỉ một lần trong thời gian chờ; quy tắc từ khoá; /stop hủy nhận', async () => {
  const { sent, store, inbox } = setup();
  await inbox.onPrivate('u1', 'tok', dm(1, 'hello'));
  assert.deepStrictEqual(sent.map((s) => s.text), ['Chào An!']);
  assert.strictEqual(store.data.botContacts.length, 1);
  await inbox.onPrivate('u1', 'tok', dm(1, 'hello nữa'));      // trong thời gian chờ
  assert.strictEqual(sent.length, 1);
  await inbox.onPrivate('u1', 'tok', dm(1, 'cho hỏi giá'));    // vẫn trong thời gian chờ
  assert.strictEqual(sent.length, 1);
  await inbox.onPrivate('u1', 'tok', dm(2, 'cho hỏi giá', { first_name: 'Bình', last_name: '' }));
  assert.strictEqual(sent[1].text, 'Giá Bình: 100k');
  await inbox.onPrivate('u1', 'tok', dm(1, '/stop'));
  assert.strictEqual(store.data.botContacts[0].optedOut, true);
  await inbox.onPrivate('u1', 'tok', dm(3, 'x', { is_bot: true })); // bot bị bỏ qua
  assert.strictEqual(store.data.botContacts.length, 2);
});

test('tắt hộp thư thì không ghi nhận; gửi tin: trừ điểm, bỏ qua người đã hủy/chặn bot, hết điểm báo 402', async () => {
  const off = setup({ enabled: false });
  await off.inbox.onPrivate('u1', 'tok', dm(1, 'hi'));
  assert.strictEqual(off.store.data.botContacts.length, 0);

  const { sent, store, inbox, points } = setup({ text: '' });
  await inbox.onPrivate('u1', 'tok', dm(1, 'a')); await inbox.onPrivate('u1', 'tok', dm(666, 'b'));
  const [a, b] = store.data.botContacts;
  await inbox.sendTo('u1', a, 'Chào {ten}, hôm nay có ưu đãi');
  assert.strictEqual(sent.at(-1).text, 'Chào An, hôm nay có ưu đãi');
  assert.strictEqual(points(), 2);
  await assert.rejects(inbox.sendTo('u1', b, 'x'), (e) => /chặn bot/.test(e.message));
  assert.strictEqual(b.blocked, true);
  a.optedOut = true;
  await assert.rejects(inbox.sendTo('u1', a, 'x'), /hủy nhận/);
});
