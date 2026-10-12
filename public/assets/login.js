const form = document.getElementById('f');
const err = document.getElementById('err');
const btn = document.getElementById('go');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
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
    if (!r.ok) throw new Error(j.error || 'Đăng nhập thất bại');
    location.href = '/app';
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
    btn.disabled = false; btn.textContent = 'Đăng nhập';
    form.password.select();
  }
});
