'use strict';
const path = require('path');
const crypto = require('crypto');
const { isValidTz } = require('./schedule');

const env = process.env;
const production = env.NODE_ENV === 'production';

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

module.exports = {
  production,
  port: Number(env.PORT) || 3000,
  dataDir: path.resolve(env.DATA_DIR || './data'),
  uploadsDir: path.join(path.resolve(env.DATA_DIR || './data'), 'uploads'),
  adminUser: env.ADMIN_USERNAME || 'admin',
  adminPassword,
  envBotToken: (env.TELEGRAM_BOT_TOKEN || '').trim(),
  defaultTz: tz,
};
