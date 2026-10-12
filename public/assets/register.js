const form = document.getElementById('f');
const err = document.getElementById('err');
const btn = document.getElementById('go');

const show = (msg) => { err.textContent = msg; err.hidden = false; };

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;
  if (name.length < 2) return show('Nhập họ tên (ít nhất 2 ký tự)');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return show('Email không hợp lệ');
  if (password.length < 8) return show('Mật khẩu cần từ 8 ký tự trở lên');
  btn.disabled = true; btn.textContent = 'Đang tạo tài khoản...';
  try {
    const r = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
      body: JSON.stringify({ name, email, password, website: form.website.value }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Không tạo được tài khoản');
    location.href = '/app#settings';
  } catch (ex) {
    show(ex.message);
    btn.disabled = false; btn.textContent = 'Tạo tài khoản';
  }
});
