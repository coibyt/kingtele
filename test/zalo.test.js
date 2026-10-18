const test = require('node:test');
const assert = require('node:assert');
const { normalizePhone, parseBulk } = require('../src/zalo');

test('normalizePhone: bỏ ký tự phân cách, +84/84 thành 0, từ chối số sai', () => {
  assert.strictEqual(normalizePhone('0912 345 678'), '0912345678');
  assert.strictEqual(normalizePhone('+84 912-345-678'), '0912345678');
  assert.strictEqual(normalizePhone('84912345678'), '0912345678');
  for (const bad of ['', 'abc', '123', '09123456789012345678', null]) assert.strictEqual(normalizePhone(bad), '', String(bad));
});

test('parseBulk: tên + số, chỉ số, và bỏ dòng sai', () => {
  const { rows, skipped } = parseBulk('Nguyen Van A, 0912345678\n0987654321\nkhông phải số\n\nLê B;+84 901 234 567');
  assert.deepStrictEqual(rows, [
    { name: 'Nguyen Van A', phone: '0912345678' },
    { name: '', phone: '0987654321' },
    { name: 'Lê B', phone: '0901234567' },
  ]);
  assert.strictEqual(skipped, 1);
});
