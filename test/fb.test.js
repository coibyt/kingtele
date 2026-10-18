const test = require('node:test');
const assert = require('node:assert');
const { createFb, cleanFbUrl } = require('../src/fb');

test('cleanFbUrl: chỉ nhận link facebook.com, chuẩn hoá về https, bỏ #hash', () => {
  assert.strictEqual(cleanFbUrl('https://www.facebook.com/groups/abc#x'), 'https://www.facebook.com/groups/abc');
  assert.strictEqual(cleanFbUrl('facebook.com/groups/123'), 'https://facebook.com/groups/123');
  assert.strictEqual(cleanFbUrl('http://m.facebook.com/groups/9'), 'https://m.facebook.com/groups/9');
  for (const bad of ['', 'https://evil.com/facebook.com', 'https://facebook.com.evil.com/x', 'javascript:alert(1)', 'ftp://facebook.com/x', null]) assert.strictEqual(cleanFbUrl(bad), '', String(bad));
});

test('tick: bài đến hạn vào hàng đợi với bản chụp nhóm; lịch một lần chuyển sang hoàn tất; bài tạm dừng bị bỏ qua', async () => {
  const now = Date.now();
  const data = {
    fbGroups: [{ id: 'g1', userId: 'u1', name: 'Nhóm A', url: 'https://www.facebook.com/groups/a' }],
    fbTasks: [
      { id: 't1', userId: 'u1', title: 'T', text: 'Nội dung', link: '', groupIds: ['g1', 'gone'], schedule: { type: 'once', date: '2000-01-01', time: '00:00' }, timezone: 'UTC', status: 'active', nextRunAt: now - 1000 },
      { id: 't2', userId: 'u1', title: 'P', text: 'x', link: '', groupIds: ['g1'], schedule: { type: 'daily', time: '09:00' }, timezone: 'UTC', status: 'paused', nextRunAt: now - 1000 },
    ],
    fbDue: [], users: [], settings: {},
  };
  const store = { data, save: async () => {} };
  const fb = createFb({ store, getToken: () => '' });
  await fb.tick();
  assert.strictEqual(data.fbDue.length, 1);
  assert.deepStrictEqual(data.fbDue[0].items.map((i) => [i.groupId, i.name, i.done]), [['g1', 'Nhóm A', false]]);
  assert.strictEqual(data.fbTasks[0].status, 'done');
  assert.strictEqual(data.fbTasks[1].nextRunAt, now - 1000);
});
