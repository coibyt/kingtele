'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { isValidTz } = require('./schedule');

const env = process.env;
const production = env.NODE_ENV === 'production';
const appDir = path.resolve(__dirname, '..');

let adminPassword = env.ADMIN_PASSWORD || '';
if (!adminPassword) {
  if (production) {
    console.error('[config] Thiếu ADMIN_PASSWORD. Hãy đặt biến môi trường này rồi khởi động lại.');
    process.exit(1);
  }
  adminPassword = crypto.randomBytes(9).toString('base64url');
  console.warn(`[config] ADMIN_PASSWORD chưa đặt - mật khẩu tạm cho môi trường dev: ${adminPassword}`);
}

const tz = env.DEFAULT_TIMEZONE && isValidTz(env.DEFAULT_TIMEZONE) ? env.DEFAULT_TIMEZONE : 'Asia/Ho_Chi_Minh';

const inside = (dir) => dir === appDir || dir.startsWith(appDir + path.sep);
function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.w-${process.pid}`);
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

/**
 * Chọn nơi lưu dữ liệu. Thư mục nằm TRONG thư mục code sẽ bị xoá mỗi lần deploy lại
 * (Hostinger dựng lại thư mục app), nên ở production ta ưu tiên thư mục NGOÀI code.
 * Đặt ALLOW_DATA_IN_APP=1 để buộc dùng thư mục trong app.
 */
function resolveDataDir() {
  const explicit = env.DATA_DIR ? path.resolve(env.DATA_DIR) : null;
  const legacy = path.join(appDir, 'data');
  if (!production || env.ALLOW_DATA_IN_APP === '1') {
    return { dir: explicit || legacy, safe: !inside(explicit || legacy) };
  }
  const candidates = [
    explicit && !inside(explicit) ? explicit : null,
    path.join(os.homedir(), 'kingtele-data'),
    path.resolve(appDir, '..', 'kingtele-data'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (!writable(dir)) continue;
    // Chuyển dữ liệu cũ (nếu còn) từ thư mục trong app sang nơi an toàn
    const src = explicit && inside(explicit) ? explicit : legacy;
    if (!fs.existsSync(path.join(dir, 'db.json')) && fs.existsSync(path.join(src, 'db.json'))) {
      try { fs.cpSync(src, dir, { recursive: true }); console.log(`[config] Đã chuyển dữ liệu cũ từ ${src} sang ${dir}`); } catch (e) { console.error('[config] Không chuyển được dữ liệu cũ:', e.message); }
    }
    return { dir, safe: true };
  }
  const fallback = explicit || legacy;
  console.error('[config] CẢNH BÁO: không tìm được thư mục ngoài app để ghi. Dữ liệu sẽ mất khi deploy lại.');
  return { dir: fallback, safe: false };
}

const data = resolveDataDir();
console.log(`[config] Thư mục dữ liệu: ${data.dir}${data.safe ? '' : ' (KHÔNG an toàn khi deploy lại)'}`);

module.exports = {
  production,
  port: Number(env.PORT) || 3000,
  dataDir: data.dir,
  dataSafe: data.safe,
  uploadsDir: path.join(data.dir, 'uploads'),
  adminUser: env.ADMIN_USERNAME || 'admin',
  adminPassword,
  envBotToken: (env.TELEGRAM_BOT_TOKEN || '').trim(),
  defaultTz: tz,
};
