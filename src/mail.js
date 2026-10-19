'use strict';
// Gửi email qua SMTP (Hostinger: smtp.hostinger.com, cổng 465 SSL). Thông tin đăng nhập chỉ lấy từ biến môi trường
// (SMTP_USER, SMTP_PASS...), không bao giờ ghi vào code, log hay API.
const nodemailer = require('nodemailer');

function createMailer(config) {
  const c = config.smtp;
  const configured = !!(c.user && c.pass);
  let transport = null;
  const get = () => transport || (transport = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  }));
  return {
    configured,
    /** Ném lỗi nếu chưa cấu hình hoặc SMTP từ chối. Chưa bao giờ đưa mật khẩu vào thông báo lỗi. */
    async send({ to, subject, text, html, headers }) {
      if (!configured) throw new Error('SMTP chưa được cấu hình');
      return get().sendMail({ from: c.from, to, subject, text, html, headers });
    },
    status: () => ({ configured, host: c.host, port: c.port, from: c.from }),
  };
}

module.exports = { createMailer };
