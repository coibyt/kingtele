/* Trang công cụ lấy ID nhóm Telegram: tra cứu, sao chép, nhúng video YouTube, thông tin bot. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const form = $('lookup');
  const out = $('out');
  const btn = $('go');

  function show(cls, build) {
    out.className = `tool-out ${cls}`.trim();
    out.textContent = '';
    build(out);
    out.hidden = false;
  }
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  function copy(text, button) {
    const done = () => { const old = button.textContent; button.textContent = 'Đã sao chép'; setTimeout(() => { button.textContent = old; }, 1600); };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, () => fallback()); } else fallback();
    function fallback() {
      const ta = el('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch { /* người dùng tự bôi đen */ }
      ta.remove();
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('inp').value.trim();
    if (!input) { show('err', (o) => o.appendChild(el('div', '', 'Hãy dán link nhóm, link tin nhắn hoặc @tên_nhóm vào ô phía trên.'))); return; }
    btn.disabled = true;
    try {
      const res = await fetch('/api/tool/chat-id', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
        body: JSON.stringify({ input }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { show('err', (o) => o.appendChild(el('div', '', data.error || 'Có lỗi xảy ra, vui lòng thử lại.'))); return; }
      show('', (o) => {
        o.appendChild(el('div', 't', data.title ? `${data.typeLabel}: ${data.title}` : 'Chat ID của bạn'));
        const row = el('div', 'idrow');
        row.appendChild(el('span', 'idv', data.chatId));
        const c = el('button', 'btn btn-sm', 'Sao chép');
        c.type = 'button';
        c.addEventListener('click', () => copy(data.chatId, c));
        row.appendChild(c);
        o.appendChild(row);
        const meta = [data.source, data.note].filter(Boolean).join('. ');
        if (meta) o.appendChild(el('div', 'meta', meta));
      });
    } catch {
      show('err', (o) => o.appendChild(el('div', '', 'Không kết nối được máy chủ. Hãy kiểm tra mạng và thử lại.')));
    } finally { btn.disabled = false; }
  });

  // Thông tin bot công cụ (chỉ hiện khung "thêm bot" khi bot đang chạy)
  fetch('/api/tool/info').then((r) => r.json()).then((d) => {
    if (!d || !d.bot || !/^[A-Za-z0-9_]{4,40}$/.test(d.bot)) return;
    const url = `https://t.me/${d.bot}`;
    $('botLink').href = url; $('botLink').textContent = `@${d.bot}`;
    $('botBtn').href = url;
    $('botPanel').hidden = false;
  }).catch(() => {});

  // Video YouTube: chỉ tải khi bấm (nhanh hơn, bảo vệ quyền riêng tư)
  const sec = $('video-sec');
  const id = (sec && sec.getAttribute('data-yt')) || '';
  if (/^[\w-]{11}$/.test(id)) {
    sec.hidden = false;
    const holder = $('yt');
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Phát video hướng dẫn lấy ID nhóm Telegram');
    b.style.backgroundImage = `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)`;
    b.appendChild(el('span', 'play'));
    b.addEventListener('click', () => {
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      f.title = 'Hướng dẫn lấy ID nhóm Telegram';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      holder.textContent = '';
      holder.appendChild(f);
    });
    holder.appendChild(b);
  }
})();
