const form = document.getElementById('f');
const err = document.getElementById('err');
const btn = document.getElementById('go');
const ok = document.getElementById('ok');
const resend = document.getElementById('resend');
const lang = () => (window.I18N && window.I18N.lang) || 'vi';

const v = new URLSearchParams(location.search).get('verified');
if (v === '1') { ok.textContent = 'Email đã được xác nhận. Bạn có thể đăng nhập.'; ok.hidden = false; }
if (v === '0') { err.textContent = 'Liên kết xác nhận không hợp lệ hoặc đã hết hạn.'; err.hidden = false; }

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true; ok.hidden = true; resend.hidden = true;
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) { err.textContent = 'Nhập email và mật khẩu'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
      body: JSON.stringify({ username, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (j.needVerify) resend.hidden = false; throw new Error(j.error || 'Đăng nhập thất bại'); }
    location.href = '/app';
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    btn.disabled = false; btn.textContent = 'Đăng nhập';
    form.password.select();
  }
});

resend.addEventListener('click', async () => {
  resend.disabled = true;
  try {
    await fetch('/api/verify/resend', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
      body: JSON.stringify({ email: form.username.value.trim(), lang: lang() }),
    });
    err.hidden = true;
    ok.textContent = 'Đã gửi lại email xác nhận. Hãy kiểm tra hộp thư.'; ok.hidden = false;
  } catch { /* bỏ qua */ }
  resend.disabled = false;
});
