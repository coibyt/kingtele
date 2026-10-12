const test = require('node:test');
const assert = require('node:assert');
const { nextRun, normalizeSchedule, zonedToUtc } = require('../src/schedule');

test('zonedToUtc: Hà Nội UTC+7', () => {
  assert.strictEqual(zonedToUtc(2026, 1, 1, 9, 0, 'Asia/Ho_Chi_Minh'), Date.UTC(2026, 0, 1, 2, 0));
});
test('zonedToUtc: New York có DST', () => {
  assert.strictEqual(zonedToUtc(2026, 7, 1, 9, 0, 'America/New_York'), Date.UTC(2026, 6, 1, 13, 0));
  assert.strictEqual(zonedToUtc(2026, 1, 1, 9, 0, 'America/New_York'), Date.UTC(2026, 0, 1, 14, 0));
});
test('daily: trước giờ -> hôm nay, sau giờ -> mai', () => {
  const s = normalizeSchedule({ type: 'daily', time: '09:00' });
  const tz = 'Asia/Ho_Chi_Minh';
  assert.strictEqual(nextRun(s, tz, Date.UTC(2026, 0, 1, 1, 0)), Date.UTC(2026, 0, 1, 2, 0));
  assert.strictEqual(nextRun(s, tz, Date.UTC(2026, 0, 1, 3, 0)), Date.UTC(2026, 0, 2, 2, 0));
});
test('weekly: chỉ T2 và T4', () => {
  const s = normalizeSchedule({ type: 'weekly', time: '08:00', days: [1, 3] });
  // 2026-01-01 là thứ Năm -> kế tiếp là T2 05/01
  assert.strictEqual(nextRun(s, 'UTC', Date.UTC(2026, 0, 1, 12, 0)), Date.UTC(2026, 0, 5, 8, 0));
});
test('once: quá khứ -> null', () => {
  const s = normalizeSchedule({ type: 'once', date: '2020-01-01', time: '10:00' });
  assert.strictEqual(nextRun(s, 'UTC', Date.now()), null);
});
test('interval < 5 phút bị từ chối', () => {
  assert.throws(() => normalizeSchedule({ type: 'interval', everyMinutes: 1 }));
});
