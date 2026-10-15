const test = require('node:test');
const assert = require('node:assert');
const { parseInput, lookup } = require('../src/chatid-tool');

test('parseInput: nhận diện username, link công khai, link tin nhắn riêng tư, link mời, ID', () => {
  assert.deepStrictEqual(parseInput('@kingtele_group'), { kind: 'username', username: 'kingtele_group' });
  assert.deepStrictEqual(parseInput('https://t.me/kingtele_group'), { kind: 'username', username: 'kingtele_group' });
  assert.deepStrictEqual(parseInput('t.me/kingtele_group/123?single'), { kind: 'username', username: 'kingtele_group' });
  assert.deepStrictEqual(parseInput('https://t.me/s/kingtele_group'), { kind: 'username', username: 'kingtele_group' });
  assert.deepStrictEqual(parseInput('https://t.me/c/1234567890/55'), { kind: 'private-link', chatId: '-1001234567890' });
  assert.strictEqual(parseInput('https://t.me/+AbCdEfGh123').kind, 'invite');
  assert.strictEqual(parseInput('https://t.me/joinchat/AAAA').kind, 'invite');
  assert.deepStrictEqual(parseInput('-1001234567890'), { kind: 'id', chatId: '-1001234567890' });
  for (const bad of ['', 'xin chào', 'https://example.com/abc', 'https://t.me/addstickers/pack', '@ab', null]) assert.strictEqual(parseInput(bad).kind, 'invalid', String(bad));
});

test('lookup: link riêng tư tách ID không cần bot; link mời và đầu vào sai báo lỗi tiếng Việt; thiếu bot thì 503', async () => {
  assert.strictEqual((await lookup('t.me/c/1234567890/5', '')).chatId, '-1001234567890');
  await assert.rejects(lookup('t.me/+abc123', ''), (e) => e.status === 422 && /Chat ID/.test(e.message));
  await assert.rejects(lookup('linh tinh', ''), (e) => e.status === 400);
  await assert.rejects(lookup('@kingtele_group', ''), (e) => e.status === 503);
});
