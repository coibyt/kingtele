'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MAX_IMAGE = 10 * 1024 * 1024;   // giới hạn sendPhoto của Telegram
const MAX_VIDEO = 50 * 1024 * 1024;   // giới hạn upload của Bot API
const NAME_RE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov)$/;

/** Nhận dạng loại file theo nội dung (không tin tên file / content-type từ client). */
function detect(head) {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ext: 'jpg', kind: 'image' };
  if (head.length >= 4 && head.readUInt32BE(0) === 0x89504e47) return { ext: 'png', kind: 'image' };
  if (head.length >= 4 && head.toString('latin1', 0, 4) === 'GIF8') return { ext: 'gif', kind: 'animation' };
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', kind: 'image' };
  if (head.length >= 12 && head.toString('latin1', 4, 8) === 'ftyp') {
    return head.toString('latin1', 8, 12) === 'qt  ' ? { ext: 'mov', kind: 'video' } : { ext: 'mp4', kind: 'video' };
  }
  return null;
}

function createMedia({ store, uploadsDir }) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const uploads = () => store.data.uploads;

  const isUsed = (file) => store.data.posts.some((p) => p.media && p.media.file === file);
  const owner = (file) => (uploads()[file] || {}).u;
  const userBytes = (userId) => Object.values(uploads()).reduce((n, x) => n + (x.u === userId ? x.size || 0 : 0), 0);

  async function drop(file) {
    delete uploads()[file];
    await fsp.unlink(path.join(uploadsDir, file)).catch(() => {});
  }

  /** Xoá file nếu không còn bài nào dùng. */
  async function remove(file) {
    if (!file || !NAME_RE.test(file) || isUsed(file)) return;
    await drop(file);
  }

  /** Xoá file mồ côi (tải lên nhưng không gắn vào bài nào) cũ hơn 1 giờ. */
  async function sweep() {
    try {
      let changed = false;
      for (const f of await fsp.readdir(uploadsDir)) {
        const st = await fsp.stat(path.join(uploadsDir, f));
        if ((!NAME_RE.test(f) || !isUsed(f)) && Date.now() - st.mtimeMs > 3600e3) { await drop(f); changed = true; }
      }
      if (changed) await store.save();
    } catch { /* bỏ qua */ }
  }

  /**
   * Nhận file thô (binary body), ghi ra đĩa theo luồng, kiểm tra loại + dung lượng.
   * quota (byte): tổng dung lượng tối đa của người dùng; Infinity = không giới hạn.
   */
  function upload(req, userId, quota = Infinity) {
    return new Promise((resolve, reject) => {
      const fail = (status, msg) => reject(Object.assign(new Error(msg), { status }));
      const declared = Number(req.get('content-length'));
      if (declared > MAX_VIDEO) return fail(413, 'File quá lớn (tối đa 50MB cho video, 10MB cho ảnh)');
      if (!declared) return fail(400, 'Thiếu dữ liệu file');
      if (userBytes(userId) + declared > quota) return fail(413, 'Đã hết dung lượng lưu trữ của tài khoản. Hãy xoá bớt bài có ảnh/video cũ.');
      const tmp = path.join(uploadsDir, `tmp-${crypto.randomUUID()}`);
      const ws = fs.createWriteStream(tmp);
      let size = 0, aborted = false;
      const abort = (status, msg) => { if (aborted) return; aborted = true; ws.destroy(); fsp.unlink(tmp).catch(() => {}); req.unpipe(ws); req.resume(); fail(status, msg); };
      req.on('data', (c) => { size += c.length; if (size > MAX_VIDEO) abort(413, 'File quá lớn (tối đa 50MB)'); });
      req.on('error', () => abort(400, 'Tải lên bị gián đoạn'));
      ws.on('error', () => abort(500, 'Không ghi được file lên máy chủ'));
      ws.on('finish', async () => {
        if (aborted) return;
        try {
          const fd = await fsp.open(tmp, 'r');
          const head = Buffer.alloc(16);
          await fd.read(head, 0, 16, 0);
          await fd.close();
          const type = detect(head);
          if (!type) { await fsp.unlink(tmp); return fail(400, 'Định dạng không hỗ trợ. Dùng JPG, PNG, WEBP, GIF hoặc MP4.'); }
          if (type.kind === 'image' && size > MAX_IMAGE) { await fsp.unlink(tmp); return fail(413, 'Ảnh tối đa 10MB'); }
          const file = `${crypto.randomUUID()}.${type.ext}`;
          await fsp.rename(tmp, path.join(uploadsDir, file));
          uploads()[file] = { u: userId, size };
          const rawName = req.get('x-filename') || '';
          let name = file;
          try { name = decodeURIComponent(rawName).replace(/[^\w.\- ()À-ỹ]/g, '_').slice(0, 100) || file; } catch { /* giữ tên mặc định */ }
          resolve({ file, kind: type.kind, name, size });
        } catch (e) { fail(500, 'Lỗi xử lý file'); }
      });
      req.pipe(ws);
    });
  }

  return { upload, remove, sweep, isUsed, owner, userBytes, NAME_RE, dir: uploadsDir };
}

module.exports = { createMedia, NAME_RE };
