'use strict';
/* KingTele dashboard - vanilla JS, không dùng innerHTML với dữ liệu người dùng. */

const SVG = 'http://www.w3.org/2000/svg';
const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const view = document.getElementById('view');
const state = { tz: 'Asia/Ho_Chi_Minh', user: null };

// ---------- helpers ----------
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'for') e.htmlFor = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'form') e[k] = v;
    else e.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return e;
}
function ico(name) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', 'icon'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG, 'use');
  u.setAttribute('href', `/assets/sprite.svg#i-${name}`);
  s.append(u);
  return s;
}
async function api(method, url, body) {
  const r = await fetch(`/api${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'postpilot' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { location.href = '/login'; throw new Error('Hết phiên đăng nhập'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra');
  return j;
}
function toast(msg, type = 'ok') {
  const t = h('div', { class: `toast ${type}` }, ico(type === 'ok' ? 'check' : 'alert'), h('span', null, msg));
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'ok' ? 3500 : 6000);
}
const fmtDT = (ts, tz) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: tz || state.tz }).format(ts);
function rel(ts) {
  const diff = ts - Date.now(), abs = Math.abs(diff);
  const f = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
  if (abs < 3600e3) return f.format(Math.round(diff / 60e3), 'minute');
  if (abs < 86400e3) return f.format(Math.round(diff / 3600e3), 'hour');
  return f.format(Math.round(diff / 86400e3), 'day');
}
function describe(s) {
  const t = s.time;
  if (s.type === 'once') return `Một lần · ${s.date.split('-').reverse().join('/')} ${t}`;
  if (s.type === 'daily') return `Hằng ngày · ${t}`;
  if (s.type === 'weekly') return `${s.days.map((d) => DAYS[d]).join(', ')} · ${t}`;
  const n = s.everyMinutes;
  return `Lặp mỗi ${n % 60 === 0 ? `${n / 60} giờ` : `${n} phút`}`;
}
function nowIn(tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function fmtSize(n) { return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; }
function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/upload');
    x.setRequestHeader('x-requested-with', 'postpilot');
    x.setRequestHeader('x-filename', encodeURIComponent(file.name));
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText); } catch { /* không phải JSON */ }
      if (x.status === 401) { location.href = '/login'; return; }
      if (x.status === 201) return resolve(j);
      reject(new Error(j.error || (x.status === 413 ? 'File vượt giới hạn dung lượng của máy chủ' : 'Tải lên thất bại')));
    };
    x.onerror = () => reject(new Error('Lỗi mạng khi tải lên'));
    x.send(file);
  });
}

// ---------- dialog ----------
function dialog({ title, body, footer, small }) {
  const d = h('dialog', { class: small ? 'sm' : '', 'aria-labelledby': 'dlgT' },
    h('div', { class: 'dlg-head' }, h('h2', { id: 'dlgT' }, title),
      h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': 'Đóng', onclick: () => d.close() }, ico('x'))),
    h('div', { class: 'dlg-body' }, body),
    footer ? h('div', { class: 'dlg-foot' }, footer) : null);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  d.showModal();
  return d;
}
function confirmBox(title, text, okLabel = 'Xác nhận') {
  return new Promise((resolve) => {
    let result = false;
    const d = dialog({
      title, small: true, body: h('p', { style: 'color:var(--text-2)' }, text),
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { result = true; d.close(); } }, okLabel),
      ],
    });
    d.addEventListener('close', () => resolve(result));
  });
}
async function act(btn, fn, okMsg) {
  btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

// ---------- shared UI ----------
const pageHead = (title, sub, ...actions) =>
  h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), h('div', { class: 'row' }, actions));
const empty = (icon, title, text, btn) =>
  h('div', { class: 'card empty' }, h('div', { class: 'em-ico' }, ico(icon)), h('h3', null, title), h('p', null, text), btn);
const statusTag = (s) => ({
  active: h('span', { class: 'tag ok' }, 'Đang chạy'),
  paused: h('span', { class: 'tag warn' }, 'Tạm dừng'),
  done: h('span', { class: 'tag' }, 'Hoàn tất'),
}[s]);

// ---------- views ----------
async function overviewView() {
  const o = await api('GET', '/overview');
  state.tz = o.timezone;
  const stat = (icon, label, val, sub) => h('div', { class: 'card stat' }, h('div', { class: 'lbl' }, ico(icon), label), h('div', { class: 'val' }, val), h('div', { class: 'sub' }, sub));
  const max = Math.max(1, ...o.chart.map((c) => c.ok + c.error));
  return h('div', null,
    pageHead('Tổng quan', 'Tình hình đăng bài trong 7 ngày gần nhất', h('a', { class: 'btn btn-primary', href: '#posts', onclick: () => sessionStorage.setItem('newPost', '1') }, ico('plus'), 'Bài mới')),
    o.dataSafe ? null : h('div', { class: 'banner', role: 'alert' }, ico('alert'), h('div', null, 'Dữ liệu đang lưu trong thư mục code nên sẽ mất khi deploy lại. Hãy đặt biến DATA_DIR trỏ ra ngoài thư mục app (xem README) và tải bản sao lưu ở ', h('a', { href: '#settings' }, 'Cài đặt'), '.')),
    o.botConfigured ? null : h('div', { class: 'banner', role: 'alert' }, ico('alert'), h('div', null, 'Chưa có token bot Telegram nên chưa thể gửi bài. ', h('a', { href: '#settings' }, 'Cấu hình ngay'))),
    h('div', { class: 'stats' },
      stat('users', 'Nhóm', o.groups, 'đã kết nối'),
      stat('repeat', 'Bài đang chạy', o.activePosts, `trên tổng ${o.totalPosts} bài`),
      stat('send', 'Đã gửi (7 ngày)', o.sent7, o.failed7 ? `${o.failed7} lượt lỗi` : 'không có lỗi'),
      stat('shield', 'Tỷ lệ thành công', o.rate == null ? '--' : `${o.rate}%`, '7 ngày gần nhất')),
    h('div', { class: 'grid2' },
      h('div', { class: 'card card-pad' }, h('h2', null, 'Lượt gửi theo ngày'),
        h('div', { class: 'chart', role: 'img', 'aria-label': `Biểu đồ lượt gửi 7 ngày: ${o.chart.map((c) => `${c.label} ${c.ok} thành công ${c.error} lỗi`).join('; ')}` },
          o.chart.map((c) => h('div', { class: 'bar-col', title: `${c.ok} thành công · ${c.error} lỗi` },
            h('div', { class: 'bar-stack', style: `height:${Math.max(2, ((c.ok + c.error) / max) * 100)}%` },
              h('div', { class: 'bar-ok', style: `flex:${c.ok}` }), h('div', { class: 'bar-err', style: `flex:${c.error}` })),
            h('small', null, c.label)))),
        h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:#2aabee' }), 'Thành công'), h('span', null, h('i', { style: 'background:#ef4444' }), 'Lỗi'))),
      h('div', { class: 'card card-pad' }, h('h2', null, 'Sắp đăng'),
        o.upcoming.length ? h('div', { class: 'list' }, o.upcoming.map((p) => h('div', { class: 'li' },
          h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, p.title), h('div', { class: 'li-s mono' }, fmtDT(p.nextRunAt, p.timezone))),
          h('span', { class: 'tag acc' }, rel(p.nextRunAt))))) : h('p', { class: 'hint' }, 'Chưa có bài nào đang chờ đăng.'))),
    h('div', { class: 'card card-pad' }, h('h2', null, 'Hoạt động gần đây', h('a', { href: '#logs', class: 'hint' }, 'Xem tất cả')),
      o.recent.length ? logList(o.recent) : h('p', { class: 'hint' }, 'Chưa có lượt gửi nào.')));
}

function logList(logs) {
  return h('div', { class: 'list' }, logs.map((l) => h('div', { class: 'li' },
    h('span', { class: `tag ${l.status === 'ok' ? 'ok' : 'err'}` }, l.status === 'ok' ? 'Đã gửi' : 'Lỗi'),
    h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, `${l.postTitle || '—'} → ${l.groupTitle || '—'}`),
      l.error ? h('div', { class: 'err-msg' }, l.error) : null),
    h('span', { class: 'li-s mono' }, fmtDT(l.at)))));
}

let postFilter = 'all';
async function postsView() {
  const [posts, groups] = await Promise.all([api('GET', '/posts'), api('GET', '/groups')]);
  const gName = (id) => (groups.find((g) => g.id === id) || {}).title;
  const box = h('div', { class: 'stack' });
  const draw = () => {
    box.replaceChildren();
    const list = posts.filter((p) => postFilter === 'all' || p.status === postFilter);
    if (!list.length) {
      box.append(empty('file', posts.length ? 'Không có bài nào trong mục này' : 'Chưa có bài đăng nào',
        posts.length ? 'Thử chọn bộ lọc khác.' : 'Tạo bài đầu tiên và đặt lịch để Telegram tự đăng.',
        posts.length ? null : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openComposer(null, groups) }, ico('plus'), 'Tạo bài đăng')));
      return;
    }
    list.forEach((p) => box.append(postCard(p, groups, gName)));
  };
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Lọc bài đăng' },
    [['all', 'Tất cả'], ['active', 'Đang chạy'], ['paused', 'Tạm dừng'], ['done', 'Hoàn tất']].map(([k, label]) =>
      h('button', { class: 'tab', type: 'button', 'aria-pressed': String(postFilter === k), onclick: (e) => {
        postFilter = k; tabs.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); draw();
      } }, label)));
  draw();
  const root = h('div', null,
    pageHead('Bài đăng', 'Soạn nội dung và đặt lịch gửi tới các nhóm',
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openComposer(null, groups) }, ico('plus'), 'Bài mới')),
    tabs, box);
  if (sessionStorage.getItem('newPost')) { sessionStorage.removeItem('newPost'); queueMicrotask(() => openComposer(null, groups)); }
  return root;
}

function postCard(p, groups, gName) {
  const names = p.groupIds.map(gName).filter(Boolean);
  const reload = () => route();
  return h('article', { class: 'card post' },
    h('div', { class: 'post-top' }, h('div', { style: 'min-width:0;flex:1' }, h('h3', null, p.title), h('p', { class: 'excerpt' }, p.text || '(Chỉ có ảnh)')), statusTag(p.status)),
    h('div', { class: 'meta' },
      h('span', null, ico('repeat'), describe(p.schedule)),
      p.nextRunAt ? h('span', null, ico('clock'), `Lần tới: ${fmtDT(p.nextRunAt, p.timezone)} (${rel(p.nextRunAt)})`) : null,
      h('span', null, ico('globe'), p.timezone),
      h('span', null, ico('send'), `${p.sentCount || 0} đã gửi`, p.failCount ? ` · ${p.failCount} lỗi` : '')),
    h('div', { class: 'checks' }, names.length ? names.map((n) => h('span', { class: 'tag' }, n)) : h('span', { class: 'tag err' }, 'Chưa có nhóm')),
    h('div', { class: 'post-actions' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => {
        const r = await api('POST', `/posts/${p.id}/send-now`);
        const bad = r.results.filter((x) => !x.ok);
        if (bad.length) throw new Error(`Gửi lỗi ${bad.length}/${r.results.length} nhóm: ${bad[0].error}`);
        reload();
      }, 'Đã gửi tới tất cả nhóm') }, ico('send'), 'Gửi ngay'),
      p.status === 'active'
        ? h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/posts/${p.id}/status`, { status: 'paused' }); reload(); }, 'Đã tạm dừng') }, ico('pause'), 'Tạm dừng')
        : h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/posts/${p.id}/status`, { status: 'active' }); reload(); }, 'Đã tiếp tục') }, ico('play'), 'Tiếp tục'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openComposer(p, groups) }, ico('edit'), 'Sửa'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
        if (await confirmBox('Xoá bài đăng?', `"${p.title}" sẽ bị xoá vĩnh viễn cùng lịch đăng.`, 'Xoá')) {
          try { await api('DELETE', `/posts/${p.id}`); toast('Đã xoá bài đăng'); reload(); } catch (e) { toast(e.message, 'err'); }
        }
      } }, ico('trash'), 'Xoá')));
}

// --- xem trước tin nhắn (chỉ giữ thẻ an toàn) ---
function safeHtml(src, parent) {
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const ok = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', DEL: 's', CODE: 'code', PRE: 'pre', A: 'a' };
  (function walk(node, out) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out.append(c.textContent);
      else if (c.nodeType === 1) {
        const tag = ok[c.tagName];
        if (!tag) { walk(c, out); continue; }
        const el = document.createElement(tag);
        if (tag === 'a' && /^https?:\/\//i.test(c.getAttribute('href') || '')) { el.href = c.getAttribute('href'); el.target = '_blank'; el.rel = 'noopener noreferrer'; }
        walk(c, el); out.append(el);
      }
    }
  })(doc.body, parent);
}

function openComposer(post, groups) {
  const editing = !!post;
  const tzList = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).slice();
  if (!tzList.includes(state.tz)) tzList.push(state.tz);
  const tz0 = post ? post.timezone : state.tz;
  if (!tzList.includes(tz0)) tzList.push(tz0);
  const now = nowIn(tz0);
  const s0 = post ? post.schedule : { type: 'once', date: now.date, time: now.time };
  const sel = new Set(post ? post.groupIds : []);
  const days = new Set(s0.days || [1, 2, 3, 4, 5]);
  const buttons = (post ? post.buttons : []).map((b) => ({ ...b }));
  let media = post && post.media ? { ...post.media } : null;
  let uploading = false;

  const f = {
    title: h('input', { class: 'input', id: 'c-title', maxLength: 120, value: post ? post.title : '', placeholder: 'VD: Bản tin sáng' }),
    text: h('textarea', { class: 'input', id: 'c-text', maxLength: 4096, placeholder: 'Nội dung tin nhắn...' }),
    mode: h('select', { class: 'input', id: 'c-mode' }, [['none', 'Văn bản thường'], ['HTML', 'HTML (<b>, <i>, <a>...)'], ['MarkdownV2', 'MarkdownV2']].map(([v, l]) => h('option', { value: v, selected: post && post.parseMode === v }, l))),
    image: h('input', { class: 'input', id: 'c-img', type: 'url', value: post ? post.imageUrl : '', placeholder: 'https://...' }),
    date: h('input', { class: 'input', id: 's-date', type: 'date', value: s0.date || now.date, min: now.date }),
    time: h('input', { class: 'input', id: 's-time', type: 'time', value: s0.time || now.time }),
    every: h('input', { class: 'input', id: 's-every', type: 'number', min: 5, step: 5, value: s0.everyMinutes || 60 }),
    tz: h('select', { class: 'input', id: 's-tz' }, tzList.map((z) => h('option', { value: z, selected: z === tz0 }, z))),
    silent: h('input', { type: 'checkbox', checked: post && post.silent }),
    noPrev: h('input', { type: 'checkbox', checked: post && post.noPreview }),
  };
  f.text.value = post ? post.text : '';
  const count = h('span', { class: 'hint mono' });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const preview = h('div', { class: 'tg-chat' });
  const btnBox = h('div', { class: 'form-grid', style: 'gap:8px' });
  const type0 = s0.type;

  const typeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Kiểu lịch' },
    [['once', 'Một lần'], ['daily', 'Hằng ngày'], ['weekly', 'Theo thứ'], ['interval', 'Chu kỳ']].map(([v, l]) => [
      h('input', { type: 'radio', name: 'stype', id: `st-${v}`, value: v, checked: v === type0, onchange: syncSchedule }),
      h('label', { for: `st-${v}` }, l)]));
  const dayChecks = h('div', { class: 'days', role: 'group', 'aria-label': 'Ngày trong tuần' },
    [1, 2, 3, 4, 5, 6, 0].map((d) => h('div', { class: 'check' },
      h('input', { type: 'checkbox', id: `d-${d}`, checked: days.has(d), onchange: (e) => { e.target.checked ? days.add(d) : days.delete(d); } }),
      h('label', { for: `d-${d}` }, DAYS[d]))));
  const rowDate = h('div', { class: 'field' }, h('label', { for: 's-date' }, 'Ngày'), f.date);
  const rowTime = h('div', { class: 'field' }, h('label', { for: 's-time' }, 'Giờ'), f.time);
  const rowDays = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Các ngày đăng'), dayChecks);
  const rowEvery = h('div', { class: 'field' }, h('label', { for: 's-every' }, 'Lặp mỗi (phút)'), f.every, h('span', { class: 'hint' }, 'Tối thiểu 5 phút. Có thể đặt giờ bắt đầu bên cạnh.'));
  const curType = () => (typeSeg.querySelector('input:checked') || {}).value;
  function syncSchedule() {
    const t = curType();
    rowDate.hidden = !(t === 'once' || t === 'interval');
    rowDays.hidden = t !== 'weekly';
    rowEvery.hidden = t !== 'interval';
    rowTime.hidden = false;
    f.date.required = t === 'once';
  }

  const mediaBox = h('div', { class: 'media-box' });
  const fileInput = h('input', { type: 'file', id: 'c-file', class: 'sr-only', accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime', tabindex: -1, onchange: () => { if (fileInput.files[0]) pick(fileInput.files[0]); fileInput.value = ''; } });
  async function pick(file) {
    const isImg = /^image\/(jpeg|png|webp)$/.test(file.type);
    const limit = isImg ? 10 : 50;
    if (file.size > limit * 1048576) { err.textContent = `${isImg ? 'Ảnh' : 'Video/GIF'} tối đa ${limit}MB (file này ${fmtSize(file.size)})`; return; }
    err.textContent = ''; uploading = true; save.disabled = true;
    drawMedia(0);
    try {
      media = await uploadFile(file, (p) => drawMedia(p));
      f.image.value = '';
    } catch (ex) { err.textContent = ex.message; }
    uploading = false; save.disabled = false;
    drawMedia(); drawPreview();
  }
  function drawMedia(progress) {
    if (uploading && progress != null) {
      mediaBox.replaceChildren(h('div', { class: 'media-up', role: 'status' }, h('span', null, `Đang tải lên... ${Math.round(progress * 100)}%`),
        h('div', { class: 'progress' }, h('i', { style: `width:${Math.round(progress * 100)}%` }))));
      return;
    }
    if (media) {
      const src = `/api/media/${media.file}`;
      mediaBox.replaceChildren(h('div', { class: 'media-item' },
        media.kind === 'video' ? h('video', { src, muted: true, preload: 'metadata' }) : h('img', { src, alt: '' }),
        h('div', { class: 'media-meta' }, h('strong', null, media.name), h('span', { class: 'hint' }, `${{ image: 'Ảnh', video: 'Video', animation: 'GIF' }[media.kind]} · ${fmtSize(media.size)}`)),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => { media = null; drawMedia(); drawPreview(); } }, ico('trash'), 'Gỡ')));
      return;
    }
    const drop = h('button', { class: 'media-drop', type: 'button', onclick: () => fileInput.click() },
      ico('image'), h('strong', null, 'Chọn ảnh hoặc video từ máy'), h('span', { class: 'hint' }, 'JPG, PNG, WEBP, GIF (≤10MB) · MP4 (≤50MB) · hoặc kéo thả vào đây'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
    mediaBox.replaceChildren(drop);
  }

  function drawButtons() {
    btnBox.replaceChildren(...buttons.map((b, i) => h('div', { class: 'btn-row' },
      h('input', { class: 'input', placeholder: 'Tên nút', maxLength: 64, value: b.text, 'aria-label': `Tên nút ${i + 1}`, oninput: (e) => { b.text = e.target.value; drawPreview(); } }),
      h('input', { class: 'input', placeholder: 'https://...', type: 'url', value: b.url, 'aria-label': `Link nút ${i + 1}`, oninput: (e) => { b.url = e.target.value; } }),
      h('button', { class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': `Xoá nút ${i + 1}`, onclick: () => { buttons.splice(i, 1); drawButtons(); drawPreview(); } }, ico('x')))));
  }
  function drawPreview() {
    count.textContent = `${f.text.value.length}/4096`;
    const body = h('div', { class: 'tg-text' });
    if (f.mode.value === 'HTML') safeHtml(f.text.value, body); else body.textContent = f.text.value;
    let img = null;
    if (media) {
      const src = `/api/media/${media.file}`;
      img = media.kind === 'video' ? h('video', { src, controls: true, muted: true, playsInline: true, preload: 'metadata' }) : h('img', { src, alt: '' });
    } else if (/^https:\/\//i.test(f.image.value)) img = h('img', { src: f.image.value, alt: '', onerror: (e) => e.target.remove() });
    preview.replaceChildren(h('div', { class: 'tg-msg' }, img, f.text.value || !img ? body : null,
      buttons.some((b) => b.text) ? h('div', { class: 'tg-btns' }, buttons.filter((b) => b.text).map((b) => h('div', { class: 'tg-btn' }, b.text))) : null));
    if (!f.text.value && !img) body.append(h('span', { style: 'opacity:.5' }, 'Nội dung xem trước sẽ hiện ở đây'));
  }
  [f.text, f.mode, f.image].forEach((el) => el.addEventListener('input', drawPreview));

  const groupBox = groups.length
    ? h('div', { class: 'checks', role: 'group', 'aria-label': 'Nhóm nhận bài' }, groups.map((g) => h('div', { class: 'check' },
      h('input', { type: 'checkbox', id: `g-${g.id}`, checked: sel.has(g.id), onchange: (e) => { e.target.checked ? sel.add(g.id) : sel.delete(g.id); } }),
      h('label', { for: `g-${g.id}` }, g.title))))
    : h('p', { class: 'hint' }, 'Chưa có nhóm nào. Hãy thêm nhóm ở mục "Nhóm Telegram" trước.');

  const form = h('form', { class: 'composer', novalidate: true, id: 'composer' },
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { for: 'c-title' }, 'Tiêu đề (để bạn quản lý)'), f.title),
      h('div', { class: 'field' }, h('label', { for: 'c-text' }, 'Nội dung'), f.text, count),
      h('div', { class: 'field' }, h('label', { for: 'c-mode' }, 'Định dạng'), f.mode),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Ảnh / video đính kèm'), mediaBox, fileInput,
        h('label', { for: 'c-img', class: 'hint' }, 'Hoặc dán link ảnh (https://...)'), f.image),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Nút bấm (link)'), btnBox,
        h('button', { class: 'btn btn-sm', type: 'button', style: 'justify-self:start', onclick: () => { if (buttons.length < 6) { buttons.push({ text: '', url: '' }); drawButtons(); } } }, ico('plus'), 'Thêm nút')),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Gửi tới nhóm'), groupBox),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Lịch đăng'), typeSeg),
      h('div', { class: 'two' }, rowDate, rowTime),
      rowDays, rowEvery,
      h('div', { class: 'field' }, h('label', { for: 's-tz' }, 'Múi giờ'), f.tz),
      h('label', { class: 'switch' }, f.silent, 'Gửi im lặng (không báo âm thanh)'),
      h('label', { class: 'switch' }, f.noPrev, 'Tắt xem trước link'),
      err),
    h('div', { class: 'preview-col' }, h('span', { class: 'label', style: 'display:block;margin-bottom:8px' }, 'Xem trước'), preview));

  const save = h('button', { class: 'btn btn-primary', type: 'submit', form: 'composer' }, editing ? 'Lưu thay đổi' : 'Tạo bài đăng');
  const d = dialog({ title: editing ? 'Sửa bài đăng' : 'Bài đăng mới', body: form, footer: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save] });
  drawButtons(); drawMedia(); drawPreview(); syncSchedule();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (uploading) { err.textContent = 'Đang tải file lên, vui lòng chờ xong'; return; }
    const t = curType();
    const schedule = { type: t, time: f.time.value };
    if (t === 'once' || (t === 'interval' && f.date.value)) schedule.date = f.date.value;
    if (t === 'weekly') schedule.days = [...days];
    if (t === 'interval') { schedule.everyMinutes = Number(f.every.value); if (!schedule.date) delete schedule.time; }
    const payload = {
      title: f.title.value, text: f.text.value, parseMode: f.mode.value, imageUrl: media ? '' : f.image.value, media,
      buttons, groupIds: [...sel], schedule, timezone: f.tz.value, silent: f.silent.checked, noPreview: f.noPrev.checked,
    };
    save.disabled = true;
    try {
      await api(editing ? 'PUT' : 'POST', editing ? `/posts/${post.id}` : '/posts', payload);
      d.close(); toast(editing ? 'Đã lưu thay đổi' : 'Đã tạo bài đăng'); route();
    } catch (ex) { err.textContent = ex.message; save.disabled = false; }
  });
}

async function groupsView() {
  const groups = await api('GET', '/groups');
  const chat = h('input', { class: 'input', id: 'g-chat', placeholder: '@tennhom hoặc -1001234567890', required: true });
  const title = h('input', { class: 'input', id: 'g-title', placeholder: 'Tên hiển thị (tự lấy nếu bỏ trống)' });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const addBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, ico('plus'), 'Thêm nhóm');
  const form = h('form', { class: 'card card-pad form-grid', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; addBtn.disabled = true;
    try { await api('POST', '/groups', { chatId: chat.value, title: title.value }); toast('Đã thêm nhóm'); route(); }
    catch (ex) { err.textContent = ex.message; addBtn.disabled = false; }
  } },
    h('h2', null, 'Thêm nhóm hoặc kênh'),
    h('div', { class: 'two' },
      h('div', { class: 'field' }, h('label', { for: 'g-chat' }, 'Chat ID hoặc @username'), chat),
      h('div', { class: 'field' }, h('label', { for: 'g-title' }, 'Tên hiển thị'), title)),
    h('p', { class: 'hint' }, 'Thêm bot vào nhóm trước (với kênh: đặt bot làm quản trị viên có quyền đăng). Nhóm riêng tư dùng Chat ID dạng -100xxxxxxxxxx.'),
    err, h('div', null, addBtn));
  return h('div', null,
    pageHead('Nhóm Telegram', 'Các nhóm và kênh có thể nhận bài đăng'), form,
    h('div', { style: 'height:20px' }),
    groups.length ? h('div', { class: 'card card-pad' }, h('div', { class: 'list' }, groups.map((g) => h('div', { class: 'li' },
      h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, g.title), h('div', { class: 'li-s mono' }, g.chatId)),
      g.verified ? h('span', { class: 'tag ok' }, 'Bot truy cập được') : h('span', { class: 'tag warn' }, 'Chưa kiểm tra'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/groups/${g.id}/verify`); route(); }, 'Kết nối ổn') }, ico('refresh'), 'Kiểm tra'),
      h('button', { class: 'btn btn-sm btn-danger btn-icon', type: 'button', 'aria-label': `Xoá ${g.title}`, onclick: async () => {
        if (await confirmBox('Xoá nhóm?', `"${g.title}" sẽ bị gỡ khỏi danh sách và khỏi các bài đăng liên quan.`, 'Xoá')) {
          try { await api('DELETE', `/groups/${g.id}`); toast('Đã xoá nhóm'); route(); } catch (ex) { toast(ex.message, 'err'); }
        }
      } }, ico('trash'))))))
      : empty('users', 'Chưa có nhóm nào', 'Thêm nhóm đầu tiên ở form phía trên.'));
}

async function logsView() {
  const status = sessionStorage.getItem('logFilter') || '';
  const logs = await api('GET', `/logs?limit=200${status ? `&status=${status}` : ''}`);
  const sel = h('select', { class: 'input', 'aria-label': 'Lọc theo trạng thái', style: 'width:auto', onchange: (e) => { sessionStorage.setItem('logFilter', e.target.value); route(); } },
    [['', 'Tất cả'], ['ok', 'Thành công'], ['error', 'Lỗi']].map(([v, l]) => h('option', { value: v, selected: v === status }, l)));
  return h('div', null,
    pageHead('Nhật ký gửi', 'Lịch sử 200 lượt gửi gần nhất', sel,
      h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
        if (await confirmBox('Xoá toàn bộ nhật ký?', 'Hành động này không thể hoàn tác.', 'Xoá hết')) { await api('DELETE', '/logs'); toast('Đã xoá nhật ký'); route(); }
      } }, ico('trash'), 'Xoá nhật ký')),
    logs.length ? h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Thời gian', 'Bài đăng', 'Nhóm', 'Kết quả', 'Nguồn'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, logs.map((l) => h('tr', null,
        h('td', { class: 'mono', style: 'white-space:nowrap' }, fmtDT(l.at)),
        h('td', null, l.postTitle || '—'), h('td', null, l.groupTitle || '—'),
        h('td', null, h('span', { class: `tag ${l.status === 'ok' ? 'ok' : 'err'}` }, l.status === 'ok' ? 'Đã gửi' : 'Lỗi'), l.error ? h('div', { class: 'err-msg' }, l.error) : null),
        h('td', null, l.trigger === 'manual' ? 'Thủ công' : 'Theo lịch'))))))
      : empty('list', 'Chưa có nhật ký', 'Các lượt gửi sẽ xuất hiện ở đây.'));
}

function passwordForm() {
  const cur = h('input', { class: 'input', id: 'pw-cur', type: 'password', autocomplete: 'current-password' });
  const nxt = h('input', { class: 'input', id: 'pw-new', type: 'password', autocomplete: 'new-password', minLength: 8 });
  const err = h('p', { class: 'error-text', role: 'alert' });
  return h('form', { class: 'form-grid', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api('POST', '/account/password', { current: cur.value, next: nxt.value }); cur.value = ''; nxt.value = ''; toast('Đã đổi mật khẩu'); }
    catch (ex) { err.textContent = ex.message; }
  } },
    h('div', { class: 'two' },
      h('div', { class: 'field' }, h('label', { for: 'pw-cur' }, 'Mật khẩu hiện tại'), cur),
      h('div', { class: 'field' }, h('label', { for: 'pw-new' }, 'Mật khẩu mới (từ 8 ký tự)'), nxt)),
    err, h('div', null, h('button', { class: 'btn', type: 'submit' }, 'Đổi mật khẩu')));
}

async function settingsView() {
  const s = await api('GET', '/settings');
  state.tz = s.timezone;
  const tzList = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone').slice() : [];
  if (!tzList.includes(s.timezone)) tzList.push(s.timezone);
  const token = h('input', { class: 'input mono', id: 's-token', type: 'password', autocomplete: 'off', placeholder: s.tokenMasked || '123456789:AA...' });
  const tz = h('select', { class: 'input', id: 's-tz2' }, tzList.map((z) => h('option', { value: z, selected: z === s.timezone }, z)));
  const result = h('p', { class: 'hint', role: 'status' });
  return h('div', null,
    pageHead('Cài đặt', 'Kết nối bot và tuỳ chọn chung'),
    h('div', { class: 'stack', style: 'max-width:720px' },
      s.tokenMasked ? null : h('div', { class: 'card card-pad' }, h('h2', null, 'Bắt đầu: kết nối bot Telegram của bạn'),
        h('ol', { class: 'guide' },
          h('li', null, 'Mở Telegram, chat với ', h('strong', null, '@BotFather'), ' và gửi lệnh ', h('code', null, '/newbot'), '.'),
          h('li', null, 'Đặt tên và username cho bot (username phải kết thúc bằng ', h('code', null, 'bot'), ').'),
          h('li', null, 'BotFather gửi cho bạn một ', h('strong', null, 'token'), ' (dạng 123456789:AA...). Dán vào ô bên dưới.'),
          h('li', null, 'Thêm bot vào nhóm cần đăng (kênh: đặt bot làm quản trị viên có quyền đăng tin).'))),
      h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Bot Telegram'),
        h('div', { class: 'field' }, h('label', { for: 's-token' }, 'Token từ @BotFather'), token,
          h('span', { class: 'hint' }, s.tokenSource === 'env' ? `Đang dùng token từ biến môi trường (${s.tokenMasked}). Nhập token mới để ghi đè.` : s.tokenMasked ? `Đã lưu: ${s.tokenMasked}` : 'Chưa cấu hình.')),
        result,
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => act(e.currentTarget, async () => {
            if (token.value.trim()) await api('PUT', '/settings', { botToken: token.value.trim() });
            const r = await api('POST', '/settings/test');
            result.textContent = `Kết nối thành công: @${r.username} (${r.name})`; token.value = '';
          }, 'Đã lưu và kết nối bot') }, ico('check'), 'Lưu & kiểm tra'),
          s.tokenSource === 'app' ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { await api('PUT', '/settings', { clearToken: true }); toast('Đã xoá token'); route(); } }, 'Xoá token') : null)),
      h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Múi giờ mặc định'),
        h('div', { class: 'field' }, h('label', { for: 's-tz2' }, 'Áp dụng cho bài đăng mới'), tz),
        h('div', null, h('button', { class: 'btn', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('PUT', '/settings', { timezone: tz.value }); state.tz = tz.value; }, 'Đã lưu múi giờ') }, 'Lưu múi giờ'))),
      h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Tài khoản'),
        h('p', { class: 'hint' }, `${s.user.name}${s.user.email ? ` · ${s.user.email}` : ' · Quản trị viên'}`),
        s.user.role === 'admin' ? h('p', { class: 'hint' }, 'Mật khẩu quản trị được đặt bằng biến môi trường ADMIN_PASSWORD.') : passwordForm()),
      h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Sao lưu dữ liệu'),
        s.user.role === 'admin' ? h('p', { class: s.dataSafe ? 'hint' : 'error-text' }, s.dataSafe ? 'Dữ liệu đang lưu ngoài thư mục code, an toàn khi deploy lại.' : 'Cảnh báo: dữ liệu đang nằm trong thư mục code và sẽ mất khi deploy lại.') : null,
        h('p', { class: 'hint' }, 'Tải về nhóm, bài đăng và nhật ký dưới dạng JSON (không gồm token và mật khẩu).'),
        h('div', null, h('a', { class: 'btn', href: '/api/export', download: '' }, ico('download'), 'Tải bản sao lưu')))));
}

async function membersView() {
  const r = await api('GET', '/admin/users');
  const stat = (label, val) => h('div', { class: 'card stat' }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, val));
  const tempDialog = (u, pw) => dialog({ title: 'Mật khẩu tạm', small: true,
    body: h('div', { class: 'form-grid' }, h('p', null, `Gửi mật khẩu này cho ${u.name}. Nó chỉ hiện một lần.`), h('code', { class: 'mono', style: 'font-size:1.1rem;user-select:all' }, pw)) });
  return h('div', null,
    pageHead('Thành viên', r.registrationOpen ? 'Đăng ký đang mở' : 'Đăng ký đang đóng (REGISTRATION_OPEN=0)'),
    h('div', { class: 'stats' }, stat('Thành viên', r.totals.users), stat('Nhóm', r.totals.groups), stat('Bài đăng', r.totals.posts), stat('Đã gửi 24 giờ', r.totals.sent24h)),
    r.users.length ? h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Thành viên', 'Bot', 'Nhóm', 'Bài', 'Đã gửi', 'Lưu trữ', 'Tham gia', ''].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, r.users.map((u) => h('tr', null,
        h('td', null, h('div', null, u.name, u.disabled ? h('span', { class: 'tag err', style: 'margin-left:8px' }, 'Đã khoá') : null), h('div', { class: 'li-s' }, u.email)),
        h('td', null, u.hasBot ? h('span', { class: 'tag ok' }, 'Đã kết nối') : h('span', { class: 'tag' }, 'Chưa')),
        h('td', null, u.groups), h('td', null, u.posts), h('td', null, u.sent), h('td', null, `${u.storageMB} MB`),
        h('td', { class: 'mono', style: 'white-space:nowrap' }, fmtDT(u.createdAt)),
        h('td', null, h('div', { class: 'row', style: 'flex-wrap:nowrap' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/admin/users/${u.id}/disable`, { disabled: !u.disabled }); route(); }, u.disabled ? 'Đã mở khoá' : 'Đã khoá tài khoản') }, u.disabled ? 'Mở khoá' : 'Khoá'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => { const x = await act(e.currentTarget, () => api('POST', `/admin/users/${u.id}/reset-password`)); if (x) tempDialog(u, x.password); } }, 'Đặt lại MK'),
          h('button', { class: 'btn btn-sm btn-danger btn-icon', type: 'button', 'aria-label': `Xoá ${u.name}`, onclick: async () => {
            if (await confirmBox('Xoá thành viên?', `Xoá "${u.name}" cùng toàn bộ nhóm, bài đăng, ảnh và nhật ký của họ. Không thể hoàn tác.`, 'Xoá')) {
              try { await api('DELETE', `/admin/users/${u.id}`); toast('Đã xoá thành viên'); route(); } catch (ex) { toast(ex.message, 'err'); }
            }
          } }, ico('trash'))))))))) : empty('users', 'Chưa có thành viên nào', 'Thành viên mới sẽ xuất hiện ở đây sau khi đăng ký.'));
}

// ---------- router ----------
const routes = { overview: ['Tổng quan', overviewView], posts: ['Bài đăng', postsView], groups: ['Nhóm Telegram', groupsView], logs: ['Nhật ký gửi', logsView], settings: ['Cài đặt', settingsView], members: ['Thành viên', membersView] };
let token = 0;
async function route() {
  const key = routes[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  const [title, fn] = routes[key];
  document.title = `${title} - KingTele`;
  document.getElementById('pageTitle').textContent = title;
  document.querySelectorAll('.menu a').forEach((a) => (a.dataset.route === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.body.classList.remove('nav-open');
  const mine = ++token;
  if (!view.firstChild) view.append(h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
  try {
    const el = await fn();
    if (mine === token) view.replaceChildren(el);
  } catch (e) {
    if (mine === token) view.replaceChildren(empty('alert', 'Không tải được dữ liệu', e.message, h('button', { class: 'btn', type: 'button', onclick: route }, 'Thử lại')));
  }
}
window.addEventListener('hashchange', () => { view.replaceChildren(); route(); window.scrollTo(0, 0); });

document.getElementById('menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
document.getElementById('logout').addEventListener('click', async () => { await api('POST', '/logout').catch(() => {}); location.href = '/login'; });

const clock = document.getElementById('clock');
const tick = () => { clock.textContent = new Intl.DateTimeFormat('vi-VN', { timeStyle: 'short', timeZone: state.tz }).format(new Date()); };
setInterval(tick, 20000); tick();

(async function boot() {
  try {
    const me = await api('GET', '/me');
    state.user = me.user;
    const who = document.getElementById('whoami');
    who.replaceChildren(h('strong', null, me.user.name), h('span', null, me.user.email || 'Quản trị viên'));
    who.hidden = false;
    if (me.user.role === 'admin') {
      document.querySelector('.menu').append(h('a', { href: '#members', 'data-route': 'members' }, ico('users'), 'Thành viên'));
    }
  } catch { /* api() đã chuyển về trang đăng nhập nếu hết phiên */ }
  route();
})();
