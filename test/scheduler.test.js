const test = require('node:test');
const assert = require('node:assert');
const { createScheduler } = require('../src/scheduler');

function fakeStore(posts, groups) {
  const logs = [];
  return { data: { posts, groups, logs }, addLog: (l) => logs.push(l), save: async () => {} };
}

test('tick gửi bài đến hạn, ghi log và hoàn tất bài một lần', async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) };
  };
  try {
    const post = {
      id: 'p1', title: 'T', text: 'Xin chào', groupIds: ['g1', 'g2'], status: 'active', timezone: 'UTC',
      schedule: { type: 'once', date: '2020-01-01', time: '00:00' }, nextRunAt: Date.now() - 1000, buttons: [{ text: 'Mở', url: 'https://a.b' }],
    };
    const store = fakeStore([post], [{ id: 'g1', chatId: '-100', title: 'A' }, { id: 'g2', chatId: '@b', title: 'B' }]);
    await createScheduler({ store, getToken: () => '1:' + 'x'.repeat(35) }).tick();
    assert.strictEqual(calls.length, 2);
    assert.match(calls[0].url, /sendMessage$/);
    assert.deepStrictEqual(calls[0].body.reply_markup.inline_keyboard[0][0], { text: 'Mở', url: 'https://a.b' });
    assert.strictEqual(post.status, 'done');
    assert.strictEqual(post.sentCount, 2);
    assert.strictEqual(store.data.logs.filter((l) => l.status === 'ok').length, 2);
  } finally { global.fetch = realFetch; }
});

test('lỗi Telegram được ghi log, không làm dừng các nhóm còn lại', async () => {
  const realFetch = global.fetch; let n = 0;
  global.fetch = async () => (++n === 1
    ? { status: 400, json: async () => ({ ok: false, error_code: 400, description: 'chat not found' }) }
    : { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) });
  try {
    const post = { id: 'p', title: 'T', text: 'x', groupIds: ['g1', 'g2'], status: 'active', timezone: 'UTC', schedule: { type: 'daily', time: '09:00' }, nextRunAt: Date.now() - 1000, buttons: [] };
    const store = fakeStore([post], [{ id: 'g1', chatId: '1', title: 'A' }, { id: 'g2', chatId: '2', title: 'B' }]);
    await createScheduler({ store, getToken: () => 'tok' }).tick();
    assert.strictEqual(post.failCount, 1);
    assert.strictEqual(post.sentCount, 1);
    assert.strictEqual(post.status, 'active');
    assert.ok(post.nextRunAt > Date.now());
    assert.strictEqual(store.data.logs[0].error, 'chat not found');
  } finally { global.fetch = realFetch; }
});
