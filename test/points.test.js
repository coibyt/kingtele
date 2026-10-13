const test = require('node:test');
const assert = require('node:assert');
const { createPoints } = require('../src/points');
const { createScheduler } = require('../src/scheduler');

const config = { points: { signup: 500, checkin: 50, referrer: 1000, referee: 1000, perSend: 1 } };
const mkStore = () => ({ data: { users: [], pointLog: [], posts: [], groups: [], logs: [] }, addLog(l) { this.data.logs.unshift(l); }, save: async () => {} });
const mkUser = (store, points, id, name, ip, ref) => {
  const u = { id, name, email: `${id}@x.com` };
  points.initUser(u, { ip, ref });
  store.data.users.push(u);
  return u;
};

test('đăng ký nhận 500 điểm, có mã giới thiệu, ghi sổ điểm', () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const a = mkUser(store, p, 'a', 'An', '1.1.1.1');
  assert.strictEqual(a.points, 500);
  assert.match(a.refCode, /^[0-9A-F]{8}$/);
  assert.strictEqual(store.data.pointLog[0].reason, 'signup');
});

test('mã giới thiệu sai hoặc của người bị khoá thì bỏ qua', () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const a = mkUser(store, p, 'a', 'An', '1.1.1.1');
  assert.strictEqual(mkUser(store, p, 'b', 'Binh', '2.2.2.2', 'ZZZZZZZZ').referredBy, undefined);
  a.disabled = true;
  assert.strictEqual(mkUser(store, p, 'c', 'Chi', '3.3.3.3', a.refCode).referredBy, undefined);
});

test('giới thiệu: IP khác nhau -> thưởng 1000 cho người giới thiệu và 1000 cho người được giới thiệu (tổng 1500)', () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const a = mkUser(store, p, 'a', 'An', '1.1.1.1');
  const b = mkUser(store, p, 'b', 'Binh', '2.2.2.2', a.refCode.toLowerCase());
  assert.strictEqual(b.referredBy, 'a');
  assert.strictEqual(a.points, 500); // chưa thưởng khi mới đăng ký
  p.afterSend('b');
  assert.strictEqual(a.points, 1500);
  assert.strictEqual(b.points, 1500);
  assert.strictEqual(b.referral.status, 'rewarded');
  p.afterSend('b'); // chỉ thưởng một lần
  assert.strictEqual(a.points, 1500);
});

test('giới thiệu: cùng IP -> không cộng điểm', () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const a = mkUser(store, p, 'a', 'An', '1.1.1.1');
  const b = mkUser(store, p, 'b', 'Binh', '1.1.1.1', a.refCode);
  p.afterSend('b');
  assert.strictEqual(a.points, 500);
  assert.strictEqual(b.points, 500);
  assert.deepStrictEqual([b.referral.status, b.referral.reason], ['rejected', 'same_ip']);
});

test('giới thiệu: IP đăng nhập sau này trùng với người giới thiệu cũng bị từ chối', () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const a = mkUser(store, p, 'a', 'An', '1.1.1.1');
  const b = mkUser(store, p, 'b', 'Binh', '2.2.2.2', a.refCode);
  p.touchIp(b, '1.1.1.1');
  p.afterSend('b');
  assert.strictEqual(b.referral.reason, 'same_ip');
});

test('giới thiệu: nhiều tài khoản cùng một IP chỉ được thưởng một lần cho mỗi người giới thiệu', () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const a = mkUser(store, p, 'a', 'An', '1.1.1.1');
  const b = mkUser(store, p, 'b', 'Binh', '9.9.9.9', a.refCode);
  const c = mkUser(store, p, 'c', 'Chi', '9.9.9.9', a.refCode);
  p.afterSend('b'); p.afterSend('c');
  assert.strictEqual(b.referral.status, 'rewarded');
  assert.deepStrictEqual([c.referral.status, c.referral.reason], ['rejected', 'duplicate_ip']);
  assert.strictEqual(a.points, 1500);
});

test('điểm danh: +50 mỗi ngày, lần thứ hai trong ngày bị từ chối', () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const a = mkUser(store, p, 'a', 'An', '1.1.1.1');
  assert.strictEqual(p.checkin(a, 'Asia/Ho_Chi_Minh').ok, true);
  assert.strictEqual(a.points, 550);
  assert.strictEqual(p.checkin(a, 'Asia/Ho_Chi_Minh').ok, false);
  assert.strictEqual(a.points, 550);
  a.lastCheckin = '2000-01-01'; // sang ngày khác
  assert.strictEqual(p.checkin(a, 'Asia/Ho_Chi_Minh').ok, true);
});

test('thành viên cũ được cấp điểm khi migrate; admin không bị trừ điểm', () => {
  const store = mkStore(); const p = createPoints({ store, config });
  store.data.users.push({ id: 'old', name: 'Cu', email: 'c@x.com' });
  assert.strictEqual(p.migrate(), true);
  assert.strictEqual(store.data.users[0].points, 500);
  assert.strictEqual(p.migrate(), false);
  assert.strictEqual(p.has('admin'), true);
  assert.strictEqual(p.spend('admin'), true);
  assert.strictEqual(p.balanceOf('admin'), null);
});

test('scheduler: trừ 1 điểm mỗi lượt gửi thành công, dừng khi hết điểm', async () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const u = mkUser(store, p, 'u1', 'Un', '1.1.1.1');
  u.points = 2;
  store.data.groups.push(...['g1', 'g2', 'g3'].map((id) => ({ id, userId: 'u1', chatId: id, title: id })));
  const post = { id: 'p', userId: 'u1', title: 'T', text: 'x', groupIds: ['g1', 'g2', 'g3'], buttons: [], status: 'active', timezone: 'UTC', schedule: { type: 'daily', time: '09:00' }, nextRunAt: Date.now() - 1000 };
  store.data.posts.push(post);
  const real = global.fetch; let sends = 0;
  global.fetch = async () => { sends++; return { status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
  try {
    await createScheduler({ store, getToken: () => 'tok', points: p }).tick();
  } finally { global.fetch = real; }
  assert.strictEqual(sends, 2);
  assert.strictEqual(u.points, 0);
  assert.strictEqual(u.spent, 2);
  assert.strictEqual(post.sentCount, 2);
  assert.strictEqual(store.data.logs.filter((l) => /Hết Điểm King/.test(l.error || '')).length, 1);
});

test('scheduler: lượt gửi đầu tiên của người được giới thiệu kích hoạt thưởng', async () => {
  const store = mkStore(); const p = createPoints({ store, config });
  const a = mkUser(store, p, 'a', 'An', '1.1.1.1');
  const b = mkUser(store, p, 'b', 'Binh', '2.2.2.2', a.refCode);
  store.data.groups.push({ id: 'g', userId: 'b', chatId: 'g', title: 'g' });
  const post = { id: 'p', userId: 'b', title: 'T', text: 'x', groupIds: ['g'], buttons: [], status: 'active', timezone: 'UTC', schedule: { type: 'daily', time: '09:00' }, nextRunAt: Date.now() - 1000 };
  store.data.posts.push(post);
  const real = global.fetch;
  global.fetch = async () => ({ status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) });
  try { await createScheduler({ store, getToken: () => 'tok', points: p }).tick(); } finally { global.fetch = real; }
  assert.strictEqual(a.points, 1500);
  assert.strictEqual(b.points, 1500 - 1); // +1000 thưởng, -1 điểm gửi
});
