'use strict';
// Nội dung email gửi cho khách (tiếng Việt cho khách dùng tiếng Việt, tiếng Anh cho các ngôn ngữ còn lại).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const wrap = (title, paragraphs, button, footer) => `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:14px;padding:28px">
<div style="font-size:20px;font-weight:700;margin-bottom:16px">KingTele</div>
<h1 style="font-size:20px;margin:0 0 14px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="line-height:1.6;margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#2aabee;color:#03121c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">${esc(button.label)}</a></p>
<p style="font-size:12px;color:#64748b;word-break:break-all">${esc(button.url)}</p>` : ''}
${footer ? `<p style="font-size:12px;color:#64748b;margin-top:22px">${footer}</p>` : ''}
</div></div></body></html>`;

const T = {
  vi: {
    verify: (name, url) => ({
      subject: 'Xác nhận email đăng ký KingTele',
      paragraphs: [`Xin chào ${name},`, 'Cảm ơn bạn đã đăng ký KingTele. Bấm nút bên dưới để xác nhận email và kích hoạt tài khoản. Liên kết có hiệu lực trong 24 giờ.', 'Nếu bạn không đăng ký, hãy bỏ qua email này.'],
      button: 'Xác nhận email',
    }),
    reset: (name, url) => ({
      subject: 'Đặt lại mật khẩu KingTele',
      paragraphs: [`Xin chào ${name},`, 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Bấm nút bên dưới để đặt mật khẩu mới. Liên kết có hiệu lực trong 1 giờ và chỉ dùng được một lần.', 'Nếu bạn không yêu cầu, hãy bỏ qua email này, mật khẩu của bạn vẫn an toàn.'],
      button: 'Đặt mật khẩu mới',
    }),
    unsub: 'Bạn nhận email này vì đã đăng ký tài khoản KingTele.',
    unsubLink: 'Hủy nhận email quảng bá',
    test: { subject: 'Email thử từ KingTele', paragraphs: ['Đây là email thử. Nếu bạn đọc được thư này, cấu hình gửi email của KingTele đang hoạt động.'] },
  },
  en: {
    verify: (name, url) => ({
      subject: 'Confirm your KingTele email',
      paragraphs: [`Hello ${name},`, 'Thanks for signing up for KingTele. Press the button below to confirm your email and activate your account. The link is valid for 24 hours.', "If you didn't sign up, you can ignore this email."],
      button: 'Confirm email',
    }),
    reset: (name, url) => ({
      subject: 'Reset your KingTele password',
      paragraphs: [`Hello ${name},`, 'We received a request to reset your account password. Press the button below to set a new one. The link is valid for 1 hour and can be used once.', "If you didn't ask for this, ignore this email; your password is still safe."],
      button: 'Set new password',
    }),
    unsub: 'You are receiving this email because you registered a KingTele account.',
    unsubLink: 'Unsubscribe from marketing emails',
    test: { subject: 'KingTele test email', paragraphs: ['This is a test email. If you can read it, KingTele email sending is working.'] },
  },
};

const lang = (l) => (l === 'vi' ? 'vi' : 'en');

function build(kind, l, name, url) {
  const t = T[lang(l)][kind](name, url);
  const text = `${t.paragraphs.join('\n\n')}\n\n${url}\n`;
  return { subject: t.subject, text, html: wrap(t.subject, t.paragraphs, { url, label: t.button }, '') };
}

module.exports = {
  unsubPage: (ok) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KingTele</title><body style="font-family:Arial,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center"><h2>${ok ? 'Đã hủy nhận email quảng bá / Unsubscribed' : 'Liên kết không hợp lệ / Invalid link'}</h2><p><a href="/">KingTele</a></p></body>`,
  verify: (l, name, url) => build('verify', l, name, url),
  reset: (l, name, url) => build('reset', l, name, url),
  test: (l = 'vi') => { const t = T[lang(l)].test; return { subject: t.subject, text: t.paragraphs.join('\n\n'), html: wrap(t.subject, t.paragraphs, null, '') }; },
  /** Email quảng bá: thân thư thuần văn bản do admin soạn + chân thư có link hủy nhận. */
  marketing: (l, subject, body, unsubUrl) => {
    const t = T[lang(l)];
    const paras = String(body).split(/\n{2,}/);
    return {
      subject,
      text: `${body}\n\n--\n${t.unsub}\n${t.unsubLink}: ${unsubUrl}\n`,
      html: wrap(subject, paras, null, `${esc(t.unsub)} <a href="${esc(unsubUrl)}">${esc(t.unsubLink)}</a>`),
    };
  },
};
