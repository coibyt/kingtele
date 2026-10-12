const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sendPost } = require('../src/telegram');
const { createMedia } = require('../src/media');

// PNG 1x1 hợp lệ
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('ảnh tải lên: nhóm đầu upload multipart, nhóm sau dùng file_id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-'));
  const file = `${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(dir, file), PNG);
  const post = { text: 'Chào', parseMode: 'none', buttons: [], media: { file, kind: 'image', name: 'a.png', fileId: '' } };
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, opts) => {
    const isForm = opts.body instanceof FormData;
    calls.push({ url, isForm, body: isForm ? opts.body : JSON.parse(opts.body) });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 1, photo: [{ file_id: 'small' }, { file_id: 'BIG' }] } }) };
  };
  try {
    await sendPost('tok', '-1', post, { uploadsDir: dir });
    await sendPost('tok', '-2', post, { uploadsDir: dir });
  } finally { global.fetch = real; fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(calls[0].url, /sendPhoto$/);
  assert.ok(calls[0].isForm);
  assert.strictEqual(calls[0].body.get('caption'), 'Chào');
  assert.ok(calls[0].body.get('photo') instanceof Blob);
  assert.strictEqual(post.media.fileId, 'BIG');
  assert.strictEqual(calls[1].isForm, false);
  assert.strictEqual(calls[1].body.photo, 'BIG');
});

test('video dùng sendVideo, GIF dùng sendAnimation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-'));
  const mk = (ext, kind) => { const file = `${crypto.randomUUID()}.${ext}`; fs.writeFileSync(path.join(dir, file), 'x'); return { text: '', buttons: [], media: { file, kind, name: file, fileId: '' } }; };
  const urls = [];
  const real = global.fetch;
  global.fetch = async (url) => { urls.push(url); return { status: 200, json: async () => ({ ok: true, result: { message_id: 1, video: { file_id: 'v' }, animation: { file_id: 'a' } } }) }; };
  try {
    await sendPost('tok', '1', mk('mp4', 'video'), { uploadsDir: dir });
    await sendPost('tok', '1', mk('gif', 'animation'), { uploadsDir: dir });
  } finally { global.fetch = real; fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(urls[0], /sendVideo$/);
  assert.match(urls[1], /sendAnimation$/);
});

test('upload nhận dạng theo nội dung và từ chối file lạ', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-'));
  const media = createMedia({ store: { data: { posts: [] } }, uploadsDir: dir });
  const fakeReq = (buf, name) => {
    const { Readable } = require('stream');
    const r = Readable.from([buf]);
    r.get = (h) => ({ 'content-length': String(buf.length), 'x-filename': encodeURIComponent(name) })[h.toLowerCase()];
    return r;
  };
  const ok = await media.upload(fakeReq(PNG, 'ảnh đẹp.jpg')); // tên giả .jpg nhưng nội dung là PNG
  assert.strictEqual(ok.kind, 'image');
  assert.match(ok.file, /\.png$/);
  await assert.rejects(media.upload(fakeReq(Buffer.from('<?php echo 1; ?> not media!!'), 'x.png')), /Định dạng không hỗ trợ/);
  assert.deepStrictEqual(fs.readdirSync(dir), [ok.file]); // không để lại file tạm
  fs.rmSync(dir, { recursive: true, force: true });
});
