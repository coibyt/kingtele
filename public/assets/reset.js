const form = document.getElementById('f');
const err = document.getElementById('err');
const ok = document.getElementById('ok');
const btn = document.getElementById('go');
const token = new URLSearchParams(location.search).get('token') || '';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true; ok.hidden = true;
  const password = form.password.value;
  if (password.length < 8) { err.textContent = 'Mật khẩu cần từ 8 ký tự trở lên'; err.hidden = false; return; }
  if (!token) { err.textContent = 'Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Đang lưu...';
  try {
    const r = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
      body: JSON.stringify({ token, password }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra, vui lòng thử lại.');
    ok.textContent = 'Đã đặt lại mật khẩu. Đang chuyển tới trang đăng nhập...';
    ok.hidden = false;
    setTimeout(() => { location.href = '/login'; }, 1500);
  } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  btn.textContent = 'Đặt mật khẩu mới';
});
