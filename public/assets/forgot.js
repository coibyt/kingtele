const form = document.getElementById('f');
const err = document.getElementById('err');
const ok = document.getElementById('ok');
const btn = document.getElementById('go');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true; ok.hidden = true;
  const email = form.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Email không hợp lệ'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Đang gửi...';
  try {
    const r = await fetch('/api/forgot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
      body: JSON.stringify({ email, lang: (window.I18N && window.I18N.lang) || 'vi' }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra, vui lòng thử lại.');
    ok.textContent = 'Nếu email này đã đăng ký, liên kết đặt lại mật khẩu đã được gửi. Hãy kiểm tra hộp thư (cả mục thư rác).';
    ok.hidden = false;
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  btn.disabled = false; btn.textContent = 'Gửi liên kết';
});
