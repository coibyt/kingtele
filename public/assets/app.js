'use strict';
/* KingTele dashboard - vanilla JS, không dùng innerHTML với dữ liệu người dùng. */

const SVG = 'http://www.w3.org/2000/svg';
const LOCALE = (window.I18N && window.I18N.locale) || 'vi-VN';
const LANG = (window.I18N && window.I18N.lang) || 'vi';
// Nhãn thứ trong tuần (0 = Chủ nhật) theo ngôn ngữ hiện tại
const dayLabel = (d) => new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + d)));
const view = document.getElementById('view');
const state = { tz: 'Asia/Ho_Chi_Minh', user: null, points: null };
const num = (n) => Number(n).toLocaleString(LOCALE);
function setPoints(n) {
  state.points = n;
  const el = document.getElementById('whoPts');
  if (el) el.textContent = n == null ? '' : `${num(n)} Điểm King`;
}
async function refreshPoints() {
  if (state.user && state.user.role === 'admin') return;
  try { const me = await api('GET', '/me'); setPoints(me.points); } catch { /* bỏ qua */ }
}

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
const fmtDT = (ts, tz) => new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'short', timeZone: tz || state.tz }).format(ts);
function rel(ts) {
  const diff = ts - Date.now(), abs = Math.abs(diff);
  const f = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
  if (abs < 3600e3) return f.format(Math.round(diff / 60e3), 'minute');
  if (abs < 86400e3) return f.format(Math.round(diff / 3600e3), 'hour');
  return f.format(Math.round(diff / 86400e3), 'day');
}
function describe(s) {
  const t = s.time;
  if (s.type === 'once') return `Một lần · ${s.date.split('-').reverse().join('/')} ${t}`;
  if (s.type === 'daily') return `Hằng ngày · ${t}`;
  if (s.type === 'weekly') return `${s.days.map(dayLabel).join(', ')} · ${t}`;
  const n = s.everyMinutes;
  return n % 60 === 0 ? `Lặp mỗi ${n / 60} giờ` : `Lặp mỗi ${n} phút`;
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
    (o.points != null && o.points < 20) ? h('div', { class: 'banner', role: 'alert' }, ico('alert'), h('div', null, `Bạn chỉ còn ${o.points} Điểm King. `, h('a', { href: '#points' }, 'Điểm danh hoặc giới thiệu bạn bè'), ' để nhận thêm.')) : null,
    o.dataSafe ? null : h('div', { class: 'banner', role: 'alert' }, ico('alert'), h('div', null, 'Dữ liệu đang lưu trong thư mục code nên sẽ mất khi deploy lại. Hãy đặt biến DATA_DIR trỏ ra ngoài thư mục app (xem README) và tải bản sao lưu ở ', h('a', { href: '#settings' }, 'Cài đặt'), '.')),
    o.botConfigured ? null : h('div', { class: 'banner', role: 'alert' }, ico('alert'), h('div', null, 'Chưa có token bot Telegram nên chưa thể gửi bài. ', h('a', { href: '#settings' }, 'Cấu hình ngay'))),
    h('div', { class: 'stats' },
      stat('users', 'Nhóm', o.groups, 'đã kết nối'),
      stat('repeat', 'Bài đang chạy', o.activePosts, `trên tổng ${o.totalPosts} bài`),
      stat('send', 'Đã gửi (7 ngày)', o.sent7, o.failed7 ? `${o.failed7} lượt lỗi` : 'không có lỗi'),
      stat('shield', 'Tỷ lệ thành công', o.rate == null ? '--' : `${o.rate}%`, '7 ngày gần nhất')),
    h('div', { class: 'grid2' },
      h('div', { class: 'card card-pad' }, h('h2', null, 'Lượt gửi theo ngày'),
        h('div', { class: 'chart', role: 'img', 'aria-label': 'Biểu đồ lượt gửi 7 ngày' },
          o.chart.map((c) => h('div', { class: 'bar-col', title: `${c.ok} thành công · ${c.error} lỗi` },
            h('div', { class: 'bar-stack', style: `height:${Math.max(2, ((c.ok + c.error) / max) * 100)}%` },
              h('div', { class: 'bar-ok', style: `flex:${c.ok}` }), h('div', { class: 'bar-err', style: `flex:${c.error}` })),
            h('small', null, new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: o.timezone }).format(c.t))))),
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
      h('label', { for: `d-${d}` }, dayLabel(d)))));
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
        h('div', { class: 'media-meta' }, h('strong', null, media.name), h('span', { class: 'hint' }, { image: 'Ảnh', video: 'Video', animation: 'GIF' }[media.kind], ` · ${fmtSize(media.size)}`)),
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

  const found = h('div', { class: 'list' });
  const findHint = h('p', { class: 'hint', role: 'status' });
  const findBtn = h('button', { class: 'btn', type: 'button', onclick: (e) => act(e.currentTarget, async () => {
    const list = await api('GET', '/groups/discover');
    found.replaceChildren(...list.map((c) => h('div', { class: 'li' },
      h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, c.title), h('div', { class: 'li-s mono' }, c.chatId)),
      h('span', { class: 'tag' }, c.type === 'channel' ? 'Kênh' : 'Nhóm'),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: (ev) => act(ev.currentTarget, async () => { await api('POST', '/groups', { chatId: c.chatId, title: c.title }); route(); }, 'Đã thêm nhóm') }, ico('plus'), 'Thêm'))));
    findHint.textContent = list.length ? '' : 'Chưa thấy nhóm nào. Hãy thêm bot vào nhóm, gửi một tin nhắn bất kỳ trong nhóm rồi bấm tìm lại.';
  }) }, ico('refresh'), 'Tìm nhóm bot đã thêm');
  const finder = h('div', { class: 'card card-pad form-grid', style: 'margin-top:16px' }, h('h2', null, 'Chưa biết Chat ID? KingTele tìm giúp bạn'),
    rich('Đã thêm bot vào nhóm nhưng chưa biết Chat ID? **Gửi một tin nhắn bất kỳ trong nhóm**, rồi bấm nút bên dưới. Nhóm riêng tư cũng tìm được.', 'hint'),
    h('div', null, findBtn), findHint, found);

  return h('div', null,
    pageHead('Nhóm Telegram', 'Các nhóm và kênh có thể nhận bài đăng'), form, finder,
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

/** Đoạn văn có chữ đậm, mã lệnh và link (cú pháp markdown): dịch cả câu rồi mới dựng (xem i18n.js). */
function rich(text, cls, tag = 'p') {
  const e = h(tag, { class: cls || null });
  e.setAttribute('data-rich', text);
  e.setAttribute('translate', 'no'); // nội dung con đã được dịch bởi rich()
  if (window.I18N && window.I18N.rich) window.I18N.rich(e); else e.textContent = text;
  return e;
}

// ---- Hình minh hoạ: mô phỏng giao diện Telegram (nhãn bằng tiếng Anh vì Telegram hiển thị theo ngôn ngữ máy) ----
const mockBox = (...kids) => { const e = h('div', { class: 'tgmock', dir: 'ltr' }, ...kids); e.setAttribute('translate', 'no'); return e; };
const bubble = (who, ...kids) => h('div', { class: `tb ${who}` }, ...kids);
const mockCaption = () => h('div', { class: 'mock-cap' }, 'Hình minh hoạ (ví dụ)');

function mockBotFather() {
  return h('div', null, mockCaption(), mockBox(
    h('div', { class: 'tgbar' }, h('span', { class: 'tgav' }, 'B'), h('strong', null, 'BotFather'), h('span', { class: 'verified' }, '✓')),
    bubble('me', '/newbot'),
    bubble('bot', 'Alright, a new bot. How are we going to call it? Please choose a name for your bot.'),
    bubble('me', 'My KingTele Bot'),
    bubble('bot', 'Good. Now let\'s choose a username for your bot. It must end in ', h('b', null, 'bot'), '. Like this, for example: TetrisBot or tetris_bot.'),
    bubble('me', 'kingtele_cuaban_bot'),
    bubble('bot', 'Done! Congratulations on your new bot. You will find it at t.me/kingtele_cuaban_bot.', h('br'), h('br'),
      'Use this token to access the HTTP API:', h('br'), h('mark', null, '123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), h('br'), h('br'),
      'Keep your token secure and store it safely, it can be used by anyone to control your bot.')));
}

function mockAddToGroup() {
  const chip = (t) => h('span', { class: 'pchip' }, t);
  const arr = () => h('span', { class: 'parr' }, '›');
  const row = (...c) => h('div', { class: 'pathrow' }, ...c.flatMap((x, i) => (i ? [arr(), x] : [x])));
  return h('div', null, mockCaption(), mockBox(
    h('div', { class: 'mlabel' }, 'Group'),
    row(chip('Group name'), chip('Add members'), chip('@kingtele_cuaban_bot'), chip('Add')),
    h('div', { class: 'mlabel' }, 'Channel'),
    row(chip('Channel name'), chip('Administrators'), chip('Add Administrator'), chip('@kingtele_cuaban_bot')),
    h('div', { class: 'toggle-row' }, h('span', null, 'Post messages'), h('span', { class: 'switch-on' }, h('i'))),
    h('div', { class: 'pathrow' }, chip('Save'))));
}

function mockChatId() {
  return h('div', null, mockCaption(), mockBox(
    h('div', { class: 'mlabel' }, '@RawDataBot'),
    h('pre', { class: 'jsonmock' }, '"chat": {\n  ', h('span', { class: 'hl' }, '"id": -1001234567890,'), '\n  "title": "My private group",\n  "type": "supergroup"\n}'),
    h('div', { class: 'mlabel' }, 'KingTele'),
    h('div', { class: 'found-mock' }, h('div', null, h('strong', null, 'My private group'), h('div', { class: 'mono' }, h('span', { class: 'hl' }, '-1001234567890'))), h('span', { class: 'mbtn' }, '+ Add'))));
}

function guideCard(hasBot) {
  const step = (n, title, ...body) => h('section', { class: 'gstep' },
    h('div', { class: 'gnum', 'aria-hidden': 'true' }, String(n)),
    h('div', { class: 'gbody' }, h('h3', null, title), ...body));
  const list = (...items) => h('ol', { class: 'gl' }, items.map((t) => h('li', null, rich(t))));
  const bullets = (...items) => h('ul', { class: 'gl gl-b' }, items.map((t) => h('li', null, rich(t))));
  const callout = (text, kind) => rich(text, `callout ${kind || ''}`.trim());
  return h('details', { class: 'card guide-card', open: !hasBot },
    h('summary', null, 'Hướng dẫn kết nối Telegram: làm theo 5 bước là chạy'),
    h('div', { class: 'guide-body' },
      rich('Bạn chỉ cần **một tài khoản Telegram** (cài ứng dụng tại [telegram.org/apps](https://telegram.org/apps)). Cả 5 bước mất khoảng **5 phút**. Các bước khó đều có hình minh hoạ.', 'lead'),

      step(1, 'Bước 1. Tạo bot Telegram của bạn',
        list(
          'Mở Telegram, bấm biểu tượng **kính lúp** và tìm **BotFather**. Chọn tài khoản có **dấu tích xanh** (chính chủ), hoặc bấm thẳng vào [t.me/BotFather](https://t.me/BotFather).',
          'Bấm **Start** (Bắt đầu), rồi gõ `/newbot` và gửi đi.',
          'BotFather hỏi **tên bot**: gõ một tên hiển thị bất kỳ, ví dụ `My KingTele Bot`.',
          'Tiếp theo gõ **username** cho bot. Username phải **kết thúc bằng** `bot`, chỉ gồm chữ không dấu, số và dấu gạch dưới, và chưa ai dùng. Ví dụ: `kingtele_cuaban_bot`. Nếu báo bị trùng, hãy thêm vài con số.',
          'Khi thành công, BotFather gửi tin nhắn có dòng **Use this token to access the HTTP API** kèm một chuỗi dạng `123456789:AAH...`. Đó là **token**. **Nhấn giữ** vào chuỗi đó để **sao chép**.'),
        mockBotFather(),
        callout('**Giữ kín token.** Ai có token là điều khiển được bot của bạn: đừng gửi cho người lạ hay đăng công khai. Nếu lỡ lộ, nhắn `/revoke` cho BotFather để đổi token mới.', 'warn')),

      step(2, 'Bước 2. Dán token vào KingTele',
        list(
          'Kéo xuống phần **Bot Telegram** ngay bên dưới, **dán token** vào ô **Token từ @BotFather**.',
          'Bấm nút **Lưu & kiểm tra**. Thành công khi thấy dòng **Kết nối thành công: @tên_bot**.',
          'Báo lỗi? Hãy chắc rằng bạn đã **sao chép đủ cả chuỗi token** (có dấu `:` ở giữa) và **không thừa khoảng trắng** ở đầu hoặc cuối.')),

      step(3, 'Bước 3. Thêm bot vào nhóm hoặc kênh',
        bullets(
          '**Nhóm:** mở nhóm, bấm vào **tên nhóm** ở thanh trên cùng, chọn **Thêm thành viên** (Add members), gõ **username bot** của bạn (ví dụ `@kingtele_cuaban_bot`), chọn bot rồi bấm **Thêm**.',
          '**Kênh:** mở kênh, bấm **tên kênh** → **Quản trị viên** (Administrators) → **Thêm quản trị viên**, chọn bot của bạn, bật quyền **Đăng tin nhắn** (Post messages) rồi bấm **Lưu**.',
          'Nếu nhóm đang **chỉ cho quản trị viên nhắn tin**, hãy đặt bot làm **quản trị viên** của nhóm.',
          'Bạn phải là **chủ hoặc quản trị viên** của nhóm hoặc kênh thì mới thêm được bot.'),
        mockAddToGroup()),

      step(4, 'Bước 4. Thêm nhóm vào KingTele (kể cả nhóm riêng tư)',
        rich('Vào mục **Nhóm Telegram** của KingTele (menu bên trái), điền ô **Chat ID hoặc @username**. Có 2 trường hợp:'),
        bullets(
          '**Nhóm hoặc kênh công khai** (có link dạng `t.me/tennhom`): chỉ cần gõ `@tennhom`, ví dụ `@kingtele_group`.',
          '**Nhóm riêng tư** (chỉ vào được bằng link mời, không có @username): cần **Chat ID**, là dãy số thường **bắt đầu bằng** `-100`, ví dụ `-1001234567890`. Có 3 cách lấy, **Cách 1 dễ nhất**:'),
        h('div', { class: 'methods' },
          rich('**Cách 1 (khuyên dùng, ngay trong KingTele):** sau Bước 3, hãy **gửi một tin nhắn bất kỳ trong nhóm** (ví dụ `hello`). Rồi vào mục **Nhóm Telegram** của KingTele, bấm **Tìm nhóm bot đã thêm**. Nhóm sẽ hiện ra kèm Chat ID, bấm **Thêm** là xong.', 'method'),
          rich('Lưu ý: Telegram chỉ giữ thông tin này khoảng **24 giờ**. Nếu không thấy nhóm, hãy nhắn thêm một tin trong nhóm rồi bấm tìm lại.', 'hint'),
          rich('**Cách 2 (dùng bot lấy ID):** thêm bot [@RawDataBot](https://t.me/RawDataBot) vào nhóm. Bot sẽ gửi một đoạn chữ, tìm dòng `"chat": {` rồi dòng `"id":` ngay bên dưới, **dãy số có dấu trừ** đó chính là Chat ID. Lấy xong hãy **xoá bot này khỏi nhóm**.', 'method'),
          rich('**Cách 3 (chuyển tiếp tin nhắn):** **chuyển tiếp** (Forward) một tin nhắn bất kỳ của nhóm hoặc kênh đó cho bot [@getidsbot](https://t.me/getidsbot), bot sẽ trả lời Chat ID. Cách này có thể không hiện nếu nhóm đã tắt chuyển tiếp.', 'method'),
          rich('Hai bot ở Cách 2 và Cách 3 là của bên thứ ba, KingTele không liên quan. Chỉ dùng để xem ID, **không chia sẻ token bot của bạn** cho họ.', 'hint')),
        mockChatId(),
        rich('Dán Chat ID vào ô, **giữ nguyên dấu trừ** ở đầu, rồi bấm **Thêm nhóm**. Thành công khi thấy nhãn xanh **Bot truy cập được**.'),
        callout('Báo lỗi **Bot không truy cập được nhóm này**? Kiểm tra: (1) bot đã được **thêm vào nhóm** chưa; (2) với kênh: bot đã là **quản trị viên** chưa; (3) Chat ID đã **đủ dấu trừ và đủ chữ số** chưa.', 'warn')),

      step(5, 'Bước 5. Đăng thử bài đầu tiên',
        list(
          'Vào mục **Bài đăng** → bấm **Bài mới**. Nhập tiêu đề và nội dung, **chọn nhóm** nhận bài, rồi đặt lịch: một lần, hằng ngày, theo thứ hoặc theo chu kỳ.',
          'Trước khi tin vào lịch, hãy bấm **Gửi ngay** ở bài vừa tạo một lần: tin nhắn sẽ xuất hiện trong nhóm sau vài giây. Xem kết quả ở mục **Nhật ký gửi**.',
          'Mỗi lượt gửi thành công tới một nhóm trừ **1 Điểm King**. Bạn được tặng sẵn **500 điểm** khi đăng ký, điểm danh mỗi ngày nhận thêm **50 điểm**.'))));
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
      guideCard(!!s.tokenMasked),
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
        h('p', { class: 'hint' }, s.user.name, ' · ', s.user.email || 'Quản trị viên'),
        s.user.role === 'admin' ? h('p', { class: 'hint' }, 'Mật khẩu quản trị được đặt bằng biến môi trường ADMIN_PASSWORD.') : passwordForm()),
      h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Sao lưu dữ liệu'),
        s.user.role === 'admin' ? h('p', { class: s.dataSafe ? 'hint' : 'error-text' }, s.dataSafe ? 'Dữ liệu đang lưu ngoài thư mục code, an toàn khi deploy lại.' : 'Cảnh báo: dữ liệu đang nằm trong thư mục code và sẽ mất khi deploy lại.') : null,
        h('p', { class: 'hint' }, 'Tải về nhóm, bài đăng và nhật ký dưới dạng JSON (không gồm token và mật khẩu).'),
        h('div', null, h('a', { class: 'btn', href: '/api/export', download: '' }, ico('download'), 'Tải bản sao lưu')))));
}

function copyText(text, input) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  input.select(); document.execCommand('copy');
  return Promise.resolve();
}
const REASON = { signup: 'Quà đăng ký', checkin: 'Điểm danh', referral_bonus: 'Giới thiệu bạn bè', referred_bonus: 'Thưởng nhờ được giới thiệu', admin: 'Quản trị viên điều chỉnh' };
const REF_STATUS = { pending: ['Chờ chạy bài đầu tiên', 'warn'], rewarded: ['Đã thưởng', 'ok'], rejected: ['Không hợp lệ', 'err'] };
const REJECT = { same_ip: 'Trùng IP với bạn', duplicate_ip: 'Trùng IP với người đã giới thiệu trước', referrer_unavailable: 'Tài khoản giới thiệu không khả dụng' };

async function pointsView() {
  const p = await api('GET', '/points');
  if (p.unlimited) {
    return h('div', null, pageHead('Điểm King', 'Tài khoản quản trị'), empty('shield', 'Không giới hạn', 'Tài khoản quản trị gửi bài không bị trừ Điểm King.'));
  }
  setPoints(p.balance);
  const r = p.rules;
  const link = h('input', { class: 'input mono', readOnly: true, value: p.refLink, 'aria-label': 'Link giới thiệu của bạn', onclick: (e) => e.target.select() });
  const rewarded = p.referrals.filter((x) => x.status === 'rewarded').length;
  return h('div', null,
    pageHead('Điểm King', `Điểm để đăng bài: mỗi lượt gửi thành công tới một nhóm trừ ${r.perSend} điểm`),
    h('div', { class: 'grid2' },
      h('div', { class: 'card card-pad points-hero' },
        h('div', { class: 'lbl' }, 'Số dư của bạn'),
        h('div', { class: 'big-num' }, num(p.balance)),
        h('div', { class: 'hint' }, `Đã dùng ${num(p.spent)} điểm`),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: p.checkedInToday, onclick: (e) => act(e.currentTarget, async () => { await api('POST', '/points/checkin'); route(); }, `Điểm danh thành công, +${r.checkin} Điểm King`) },
          ico('check'), p.checkedInToday ? 'Hôm nay đã điểm danh' : `Điểm danh nhận +${r.checkin}`),
        p.checkedInToday ? h('div', { class: 'hint' }, 'Quay lại vào ngày mai để nhận tiếp.') : null),
      h('div', { class: 'card card-pad form-grid' },
        h('h2', null, 'Giới thiệu bạn bè'),
        h('p', { class: 'hint' }, `Mỗi bạn đăng ký bằng link của bạn và chạy bài thành công, bạn nhận +${num(r.referrer)} điểm, bạn của bạn nhận thêm +${num(r.referee)} điểm (tổng ${num(r.signup + r.referee)} điểm).`),
        h('div', { class: 'copy-row' }, link,
          h('button', { class: 'btn', type: 'button', onclick: async (e) => { try { await copyText(p.refLink, link); toast('Đã sao chép link giới thiệu'); } catch { link.select(); toast('Hãy nhấn giữ để sao chép', 'err'); } } }, ico('copy'), 'Sao chép')),
        h('p', { class: 'hint' }, `${p.referrals.length} người đã đăng ký · ${rewarded} người đã được thưởng · bạn kiếm được ${num(p.referralEarned)} điểm`))),
    h('div', { class: 'card card-pad', style: 'margin-bottom:16px' }, h('h2', null, 'Cách kiếm và dùng điểm'),
      h('ul', { class: 'guide' },
        h('li', null, h('strong', null, `+${num(r.signup)}`), ' khi đăng ký tài khoản.'),
        h('li', null, h('strong', null, `+${num(r.checkin)}`), ' mỗi ngày khi bấm Điểm danh.'),
        h('li', null, h('strong', null, `+${num(r.referrer)}`), ' cho mỗi người bạn giới thiệu chạy bài thành công; người đó nhận thêm ', h('strong', null, `+${num(r.referee)}`), '.'),
        h('li', null, h('strong', null, `-${r.perSend}`), ' cho mỗi lượt gửi thành công tới một nhóm (bài gửi 5 nhóm là 5 điểm).'),
        h('li', null, 'Điểm thưởng giới thiệu chỉ được cộng khi người được giới thiệu dùng IP khác với IP của bạn.'))),
    p.referrals.length ? h('div', { class: 'card tbl-wrap', style: 'margin-bottom:16px' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Người được giới thiệu', 'Ngày đăng ký', 'Trạng thái'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, p.referrals.map((x) => h('tr', null,
        h('td', null, x.name), h('td', { class: 'mono' }, fmtDT(x.joinedAt)),
        h('td', null, h('span', { class: `tag ${REF_STATUS[x.status][1]}` }, REF_STATUS[x.status][0]), x.reason ? h('div', { class: 'err-msg' }, REJECT[x.reason] || x.reason) : null)))))) : null,
    h('div', { class: 'card card-pad' }, h('h2', null, 'Lịch sử cộng điểm'),
      p.history.length ? h('div', { class: 'list' }, p.history.map((l) => h('div', { class: 'li' },
        h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, REASON[l.reason] || l.reason), l.note ? h('div', { class: 'li-s' }, l.note) : null),
        h('span', { class: `tag ${l.delta > 0 ? 'ok' : 'err'}` }, `${l.delta > 0 ? '+' : ''}${num(l.delta)}`),
        h('span', { class: 'li-s mono' }, fmtDT(l.at))))) : h('p', { class: 'hint' }, 'Chưa có giao dịch nào.')));
}

function grantDialog(u) {
  const amount = h('input', { class: 'input', id: 'gr-amount', type: 'number', step: 1, placeholder: 'VD: 500 hoặc -100' });
  const note = h('input', { class: 'input', id: 'gr-note', maxLength: 120, placeholder: 'Ghi chú (không bắt buộc)' });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const save = h('button', { class: 'btn btn-primary', type: 'submit', form: 'grant' }, 'Áp dụng');
  const d = dialog({ title: `Điều chỉnh điểm: ${u.name}`, small: true, footer: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save],
    body: h('form', { id: 'grant', class: 'form-grid', novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; save.disabled = true;
      try { await api('POST', `/admin/users/${u.id}/points`, { amount: Number(amount.value), note: note.value }); d.close(); toast('Đã cập nhật điểm'); route(); }
      catch (ex) { err.textContent = ex.message; save.disabled = false; }
    } },
      h('p', { class: 'hint' }, `Số dư hiện tại: ${num(u.points)}. Nhập số âm để trừ điểm.`),
      h('div', { class: 'field' }, h('label', { for: 'gr-amount' }, 'Số điểm'), amount),
      h('div', { class: 'field' }, h('label', { for: 'gr-note' }, 'Ghi chú'), note), err) });
}

async function trafficView() {
  let s = await api('GET', '/admin/traffic');
  const PAGE = { home: 'Trang chủ', login: 'Đăng nhập', register: 'Đăng ký', app: 'Bảng điều khiển', other: 'Khác' };
  const SRC = { facebook: 'Facebook', google: 'Google', telegram: 'Telegram', zalo: 'Zalo', direct: 'Truy cập trực tiếp', other: 'Nguồn khác' };
  const PL = { ios: 'iPhone / iPad', android: 'Android', windows: 'Windows', mac: 'Mac', linux: 'Linux', other: 'Khác' };
  const day = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', timeZone: s.timezone });

  const liveNum = h('div', { class: 'live-num' });
  const liveBy = h('div', { class: 'row' });
  const els = {};
  const stat = (key, label) => {
    const val = h('div', { class: 'val' }), sub = h('div', { class: 'sub' });
    els[key] = { val, sub };
    return h('div', { class: 'card stat' }, h('div', { class: 'lbl' }, label), val, sub);
  };
  const cards = [stat('visitors', 'Khách hôm nay'), stat('views', 'Lượt xem hôm nay'), stat('signups', 'Đăng ký hôm nay'), stat('rate', 'Tỉ lệ đăng ký')];
  const chart = h('div', { class: 'chart30', role: 'img', 'aria-label': 'Khách truy cập 30 ngày gần nhất' });
  const srcBox = h('div', { class: 'list' });
  const platBox = h('div', { class: 'list' });

  const rows = (map, labels) => {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const total = Math.max(1, entries.reduce((n, e) => n + e[1], 0));
    if (!entries.length) return [h('p', { class: 'hint' }, 'Chưa có dữ liệu truy cập')];
    return entries.map(([k, n]) => h('div', { class: 'li' },
      h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, labels[k] || labels.other), h('div', { class: 'progress', style: 'margin-top:6px' }, h('i', { style: `width:${Math.round((n / total) * 100)}%` }))),
      h('span', { class: 'tag acc mono' }, num(n))));
  };

  function paint() {
    liveNum.textContent = num(s.online);
    liveBy.replaceChildren(...Object.entries(s.onlineByPage).sort((a, b) => b[1] - a[1]).map(([k, n]) => h('span', { class: 'tag acc' }, PAGE[k] || PAGE.other, ` · ${n}`)));
    const t = s.today, y = s.yesterday;
    els.visitors.val.textContent = num(t.visitors); els.visitors.sub.textContent = `hôm qua: ${num(y.visitors)}`;
    els.views.val.textContent = num(t.views); els.views.sub.textContent = `hôm qua: ${num(y.views)}`;
    els.signups.val.textContent = num(t.signups); els.signups.sub.textContent = `hôm qua: ${num(y.signups)}`;
    els.rate.val.textContent = `${t.visitors ? Math.round((t.signups / t.visitors) * 1000) / 10 : 0}%`; els.rate.sub.textContent = 'trên tổng số khách hôm nay';
    const max = Math.max(1, ...s.chart.map((c) => c.visitors));
    chart.replaceChildren(...s.chart.map((c) => h('div', { class: 'bar30', title: `${day.format(c.t)}: ${c.visitors} · ${c.views}` },
      h('i', { class: c.visitors ? '' : 'zero', style: `height:${Math.max(3, (c.visitors / max) * 100)}%` }))));
    srcBox.replaceChildren(...rows(s.sources, SRC));
    platBox.replaceChildren(...rows(s.platforms, PL));
  }
  paint();

  // Tự cập nhật mỗi 15 giây khi đang xem trang này
  const timer = setInterval(async () => {
    if (!document.body.contains(liveNum)) return clearInterval(timer);
    if (document.visibilityState !== 'visible') return;
    try { s = await api('GET', '/admin/traffic'); paint(); } catch { /* thử lại lần sau */ }
  }, 15000);

  return h('div', null,
    pageHead('Truy cập', 'Lượng khách truy cập website, tự cập nhật mỗi 15 giây'),
    h('div', { class: 'card live-card' },
      h('span', { class: 'live-dot', 'aria-hidden': 'true' }),
      h('div', null, h('div', { class: 'lbl' }, 'Đang xem ngay bây giờ'), liveNum, h('div', { class: 'hint' }, 'người mở website trong 90 giây qua')),
      liveBy),
    h('div', { class: 'stats' }, cards),
    h('div', { class: 'grid2' },
      h('div', { class: 'card card-pad' }, h('h2', null, 'Khách truy cập 30 ngày gần nhất'), chart),
      h('div', { class: 'card card-pad' }, h('h2', null, 'Nguồn truy cập (7 ngày)'), srcBox)),
    h('div', { class: 'card card-pad' }, h('h2', null, 'Thiết bị truy cập (7 ngày)'), platBox),
    h('p', { class: 'hint', style: 'margin-top:14px' }, `Khách được đếm theo trình duyệt (không lưu IP). Ngày tính theo múi giờ ${s.timezone}. Lượt truy cập của quản trị viên không được tính.`));
}

async function appStatsView() {
  const s = await api('GET', '/admin/pwa');
  const stat = (label, val, sub) => h('div', { class: 'card stat' }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, num(val)), h('div', { class: 'sub' }, sub));
  const max = Math.max(1, ...s.chart.map((c) => c.installs));
  const day = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', timeZone: s.timezone });
  const PL = { ios: 'iPhone / iPad', android: 'Android', windows: 'Windows', mac: 'Mac', linux: 'Linux', other: 'Khác' };
  const plats = Object.entries(s.byPlatform).sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, s.installs);
  return h('div', null,
    pageHead('Ứng dụng', 'Lượt cài và mức độ sử dụng ứng dụng KingTele'),
    h('div', { class: 'stats' },
      stat('Lượt cài', s.installs, `${num(s.installs7)} lượt trong 7 ngày`),
      stat('Đang dùng app', s.active7, 'mở app trong 7 ngày qua'),
      stat('Bấm nút cài', s.clicks, 'tổng số lần bấm'),
      stat('Thanh mời đã hiện', s.bannerShown, 'thiết bị đã thấy thanh mời')),
    h('div', { class: 'grid2' },
      h('div', { class: 'card card-pad' }, h('h2', null, 'Lượt cài 30 ngày gần nhất'),
        h('div', { class: 'chart30', role: 'img', 'aria-label': 'Lượt cài 30 ngày gần nhất' },
          s.chart.map((c) => h('div', { class: 'bar30', title: `${day.format(c.t)}: ${c.installs}` }, h('i', { class: c.installs ? '' : 'zero', style: `height:${Math.max(3, (c.installs / max) * 100)}%` }))))),
      h('div', { class: 'card card-pad' }, h('h2', null, 'Theo thiết bị'),
        plats.length ? h('div', { class: 'list' }, plats.map(([k, n]) => h('div', { class: 'li' },
          h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, PL[k] || PL.other), h('div', { class: 'progress', style: 'margin-top:6px' }, h('i', { style: `width:${Math.round((n / total) * 100)}%` })))
          , h('span', { class: 'tag acc mono' }, num(n))))) : h('p', { class: 'hint' }, 'Chưa có lượt cài nào'))),
    s.recent.length ? h('div', { class: 'card' },
      h('div', { class: 'card-pad', style: 'padding-bottom:0' }, h('h2', null, 'Lượt cài gần đây')),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Thời gian', 'Thiết bị', 'Thành viên', 'Ghi nhận'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', null, s.recent.map((r) => h('tr', null,
          h('td', { class: 'mono', style: 'white-space:nowrap' }, fmtDT(r.at)), h('td', null, PL[r.platform] || PL.other),
          h('td', null, r.member || 'Khách chưa đăng nhập'), h('td', null, r.source === 'event' ? 'Khi cài xong' : 'Khi mở app lần đầu')))))))
      : empty('download', 'Chưa có lượt cài nào', 'Lượt cài sẽ xuất hiện ở đây khi khách cài ứng dụng.'),
    h('p', { class: 'hint', style: 'margin-top:14px' }, 'Mỗi thiết bị chỉ tính một lần. Trên iPhone, lượt cài được ghi nhận khi khách mở ứng dụng lần đầu.'));
}

async function membersView() {
  const r = await api('GET', '/admin/users');
  const stat = (label, val) => h('div', { class: 'card stat' }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, val));
  const tempDialog = (u, pw) => dialog({ title: 'Mật khẩu tạm', small: true,
    body: h('div', { class: 'form-grid' }, h('p', null, `Gửi mật khẩu này cho ${u.name}. Nó chỉ hiện một lần.`), h('code', { class: 'mono', style: 'font-size:1.1rem;user-select:all' }, pw)) });

  const cap = h('input', { class: 'input', id: 'ip-cap', type: 'number', min: 1, step: 1, inputMode: 'numeric', placeholder: 'Để trống = không giới hạn', value: r.settings.maxAccountsPerIp || '' });
  const capErr = h('p', { class: 'error-text', role: 'alert' });
  const capCard = h('form', { class: 'card card-pad form-grid', novalidate: true, style: 'margin-bottom:16px', onsubmit: async (e) => {
    e.preventDefault(); capErr.textContent = '';
    const raw = cap.value.trim();
    try {
      await api('PUT', '/admin/settings', { maxAccountsPerIp: raw === '' ? null : Number(raw) });
      toast(raw === '' ? 'Đã bỏ giới hạn: không giới hạn tài khoản mỗi IP' : `Mỗi IP được tạo tối đa ${raw} tài khoản`);
    } catch (ex) { capErr.textContent = ex.message; }
  } },
    h('h2', null, 'Giới hạn tài khoản mỗi địa chỉ IP'),
    h('div', { class: 'field' }, h('label', { for: 'ip-cap' }, 'Số tài khoản tối đa được tạo từ một địa chỉ IP'), cap,
      h('span', { class: 'hint' }, 'Để trống nếu không muốn giới hạn. Chỉ áp dụng cho tài khoản đăng ký mới, tài khoản đã có không bị ảnh hưởng.')),
    capErr, h('div', null, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Lưu giới hạn')));

  const actions = (u) => {
    const locked = u.isAdmin && !r.owner; // quản trị viên phụ không thao tác được với quản trị viên khác
    return h('div', { class: 'row', style: 'min-width:190px' },
      u.isAdmin ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: () => grantDialog(u) }, 'Điểm'),
      r.owner ? h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/admin/users/${u.id}/role`, { admin: !u.isAdmin }); route(); }, u.isAdmin ? 'Đã gỡ quyền quản trị' : 'Đã cấp quyền quản trị') }, u.isAdmin ? 'Gỡ QT' : 'Cấp QT') : null,
      locked ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/admin/users/${u.id}/disable`, { disabled: !u.disabled }); route(); }, u.disabled ? 'Đã mở khoá' : 'Đã khoá tài khoản') }, u.disabled ? 'Mở khoá' : 'Khoá'),
      locked ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => { const x = await act(e.currentTarget, () => api('POST', `/admin/users/${u.id}/reset-password`)); if (x) tempDialog(u, x.password); } }, 'Đặt lại MK'),
      locked ? null : h('button', { class: 'btn btn-sm btn-danger btn-icon', type: 'button', 'aria-label': `Xoá ${u.name}`, onclick: async () => {
        if (await confirmBox('Xoá thành viên?', `Xoá "${u.name}" cùng toàn bộ nhóm, bài đăng, ảnh và nhật ký của họ. Không thể hoàn tác.`, 'Xoá')) {
          try { await api('DELETE', `/admin/users/${u.id}`); toast('Đã xoá thành viên'); route(); } catch (ex) { toast(ex.message, 'err'); }
        }
      } }, ico('trash')));
  };

  return h('div', null,
    pageHead('Thành viên', r.registrationOpen ? 'Đăng ký đang mở' : 'Đăng ký đang đóng (REGISTRATION_OPEN=0)'),
    h('div', { class: 'stats' }, stat('Thành viên', r.totals.users), stat('Nhóm', r.totals.groups), stat('Bài đăng', r.totals.posts), stat('Đã gửi 24 giờ', r.totals.sent24h)),
    capCard,
    r.users.length ? h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Thành viên', 'Điểm King', 'Hoạt động', 'IP đăng ký', 'Thao tác'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, r.users.map((u) => h('tr', null,
        h('td', null,
          h('div', null, u.name, u.isAdmin ? h('span', { class: 'tag acc', style: 'margin-left:8px' }, 'Quản trị') : null, u.disabled ? h('span', { class: 'tag err', style: 'margin-left:8px' }, 'Đã khoá') : null),
          h('div', { class: 'li-s' }, u.email),
          u.referredBy ? h('div', { class: 'li-s' }, 'Giới thiệu bởi ', u.referredBy, ' · ', { rewarded: 'đã thưởng', rejected: 'bị từ chối', pending: 'chờ' }[u.referral || 'pending']) : null),
        h('td', { class: 'mono' }, u.isAdmin ? 'Không giới hạn' : num(u.points)),
        h('td', null,
          h('div', null, `${u.groups} nhóm · ${u.posts} bài · ${u.sent} đã gửi`),
          h('div', { class: 'li-s' }, u.hasBot ? 'Đã kết nối bot' : 'Chưa kết nối bot', ` · ${u.storageMB} MB · ${fmtDT(u.createdAt)}`)),
        h('td', { class: 'mono', style: 'white-space:nowrap' }, u.regIp || '—', u.ipCount > 1 ? h('span', { class: 'tag warn', style: 'margin-left:8px' }, `${u.ipCount} TK`) : null),
        h('td', null, actions(u))))))) : empty('users', 'Chưa có thành viên nào', 'Thành viên mới sẽ xuất hiện ở đây sau khi đăng ký.'));
}

// ---------- router ----------
// ---------- Facebook: lịch nhắc + đăng nhanh vào nhóm ----------
async function refreshFbBadge() {
  try {
    const due = await api('GET', '/fb/due');
    const n = due.filter((x) => x.items.some((i) => !i.done)).length;
    const a = document.querySelector('.menu a[data-route="facebook"]');
    if (!a) return;
    let b = a.querySelector('.nav-badge');
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = h('span', { class: 'nav-badge' }); a.append(b); }
    b.textContent = String(n);
  } catch { /* huy hiệu chỉ là phần phụ */ }
}

function copyToClipboard(text) {
  const ok = () => toast('Đã sao chép nội dung');
  const fallback = () => {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch { toast('Không sao chép được, hãy bôi đen và chép tay', 'err'); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
}

function fbDueCard(it) {
  const done = it.items.filter((i) => i.done).length;
  const all = done === it.items.length;
  return h('article', { class: 'card post' },
    h('div', { class: 'post-top' },
      h('div', { style: 'min-width:0;flex:1' }, h('h3', null, it.title), h('p', { class: 'excerpt' }, it.text)),
      all ? h('span', { class: 'tag ok' }, 'Hoàn tất') : h('span', { class: 'tag warn' }, `${done}/${it.items.length} nhóm`)),
    h('div', { class: 'meta' }, h('span', null, ico('clock'), `Đến hạn: ${fmtDT(it.dueAt)} (${rel(it.dueAt)})`)),
    h('div', { class: 'list' }, it.items.map((g) => h('div', { class: 'li li-wrap' },
      h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, g.name)),
      h('a', { class: 'btn btn-sm', href: g.url, target: '_blank', rel: 'noopener noreferrer' }, ico('link'), 'Mở nhóm'),
      h('button', { class: `btn btn-sm ${g.done ? '' : 'btn-primary'}`, type: 'button', onclick: (e) => act(e.currentTarget, async () => {
        await api('POST', `/fb/due/${it.id}/items/${g.groupId}`, { done: !g.done }); route();
      }) }, ico('check'), g.done ? 'Đã đăng' : 'Đánh dấu đã đăng')))),
    h('div', { class: 'post-actions' },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => copyToClipboard(it.text + (it.link ? `\n${it.link}` : '')) }, ico('copy'), 'Sao chép nội dung'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('DELETE', `/fb/due/${it.id}`); route(); }) }, ico('trash'), 'Xoá')));
}

function fbTaskCard(t, groups) {
  const names = t.groupIds.map((id) => (groups.find((g) => g.id === id) || {}).name).filter(Boolean);
  return h('article', { class: 'card post' },
    h('div', { class: 'post-top' }, h('div', { style: 'min-width:0;flex:1' }, h('h3', null, t.title), h('p', { class: 'excerpt' }, t.text)), statusTag(t.status)),
    h('div', { class: 'meta' },
      h('span', null, ico('repeat'), describe(t.schedule)),
      t.nextRunAt ? h('span', null, ico('clock'), `Lần tới: ${fmtDT(t.nextRunAt, t.timezone)} (${rel(t.nextRunAt)})`) : null,
      h('span', null, ico('globe'), t.timezone)),
    h('div', { class: 'checks' }, names.length ? names.map((n) => h('span', { class: 'tag' }, n)) : h('span', { class: 'tag err' }, 'Chưa có nhóm')),
    h('div', { class: 'post-actions' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/fb/tasks/${t.id}/due-now`); route(); }, 'Đã đưa vào mục Đến hạn đăng') }, ico('zap'), 'Đến hạn ngay'),
      t.status === 'active'
        ? h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/fb/tasks/${t.id}/status`, { status: 'paused' }); route(); }, 'Đã tạm dừng') }, ico('pause'), 'Tạm dừng')
        : h('button', { class: 'btn btn-sm', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('POST', `/fb/tasks/${t.id}/status`, { status: 'active' }); route(); }, 'Đã tiếp tục') }, ico('play'), 'Tiếp tục'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openFbTask(t, groups) }, ico('edit'), 'Sửa'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
        if (await confirmBox('Xoá bài đăng?', `"${t.title}" sẽ bị xoá vĩnh viễn cùng lịch đăng.`, 'Xoá')) {
          try { await api('DELETE', `/fb/tasks/${t.id}`); toast('Đã xoá bài đăng'); route(); } catch (e) { toast(e.message, 'err'); }
        }
      } }, ico('trash'), 'Xoá')));
}

function openFbTask(task, groups) {
  const tzList = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).slice();
  const tz0 = task ? task.timezone : state.tz;
  for (const z of [state.tz, tz0]) if (!tzList.includes(z)) tzList.push(z);
  const now = nowIn(tz0);
  const s0 = task ? task.schedule : { type: 'once', date: now.date, time: now.time };
  const sel = new Set(task ? task.groupIds : []);
  const days = new Set(s0.days || [1, 2, 3, 4, 5]);
  const f = {
    title: h('input', { class: 'input', id: 'fb-title', maxLength: 120, value: task ? task.title : '', placeholder: 'VD: Bản tin sáng' }),
    text: h('textarea', { class: 'input', id: 'fb-text', maxLength: 8000, rows: 6, placeholder: 'Nội dung bài đăng Facebook...' }),
    link: h('input', { class: 'input', id: 'fb-link', type: 'url', value: task ? task.link : '', placeholder: 'https://...' }),
    date: h('input', { class: 'input', id: 'fbs-date', type: 'date', value: s0.date || now.date, min: now.date }),
    time: h('input', { class: 'input', id: 'fbs-time', type: 'time', value: s0.time || now.time }),
    tz: h('select', { class: 'input', id: 'fbs-tz' }, tzList.map((z) => h('option', { value: z, selected: z === tz0 }, z))),
  };
  f.text.value = task ? task.text : '';
  const err = h('p', { class: 'error-text', role: 'alert' });
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Kiểu lịch' },
    [['once', 'Một lần'], ['daily', 'Hằng ngày'], ['weekly', 'Theo thứ']].map(([v, l]) => [
      h('input', { type: 'radio', name: 'fbtype', id: `fbt-${v}`, value: v, checked: v === s0.type, onchange: sync }),
      h('label', { for: `fbt-${v}` }, l)]));
  const rowDate = h('div', { class: 'field' }, h('label', { for: 'fbs-date' }, 'Ngày'), f.date);
  const rowDays = h('div', { class: 'field' }, h('span', { class: 'label' }, 'Các ngày đăng'),
    h('div', { class: 'days', role: 'group', 'aria-label': 'Ngày trong tuần' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('div', { class: 'check' },
      h('input', { type: 'checkbox', id: `fbd-${d}`, checked: days.has(d), onchange: (e) => { e.target.checked ? days.add(d) : days.delete(d); } }),
      h('label', { for: `fbd-${d}` }, dayLabel(d))))));
  const cur = () => (seg.querySelector('input:checked') || {}).value;
  function sync() { rowDate.hidden = cur() !== 'once'; rowDays.hidden = cur() !== 'weekly'; }
  const picks = groups.length
    ? h('div', { class: 'checks' }, groups.map((g) => h('div', { class: 'check' },
      h('input', { type: 'checkbox', id: `fbg-${g.id}`, checked: sel.has(g.id), onchange: (e) => { e.target.checked ? sel.add(g.id) : sel.delete(g.id); } }),
      h('label', { for: `fbg-${g.id}` }, g.name))))
    : h('p', { class: 'hint' }, 'Chưa có nhóm Facebook. Hãy thêm nhóm ở mục bên dưới trước.');
  const save = h('button', { class: 'btn btn-primary', type: 'submit' }, ico('check'), task ? 'Lưu thay đổi' : 'Tạo bài đăng');
  const form = h('form', { class: 'form-grid', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; save.disabled = true;
    const t = cur();
    const schedule = { type: t, time: f.time.value, ...(t === 'once' ? { date: f.date.value } : {}), ...(t === 'weekly' ? { days: [...days] } : {}) };
    try {
      const body = { title: f.title.value, text: f.text.value, link: f.link.value, groupIds: [...sel], schedule, timezone: f.tz.value };
      if (task) await api('PUT', `/fb/tasks/${task.id}`, body); else await api('POST', '/fb/tasks', body);
      dlg.close(); toast(task ? 'Đã lưu thay đổi' : 'Đã tạo bài đăng'); route();
    } catch (ex) { err.textContent = ex.message; save.disabled = false; }
  } },
    h('div', { class: 'field' }, h('label', { for: 'fb-title' }, 'Tiêu đề'), f.title),
    h('div', { class: 'field' }, h('label', { for: 'fb-text' }, 'Nội dung'), f.text),
    h('div', { class: 'field' }, h('label', { for: 'fb-link' }, 'Link đính kèm (tuỳ chọn)'), f.link),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Nhóm Facebook'), picks),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Lịch nhắc'), seg),
    h('div', { class: 'two' }, rowDate, h('div', { class: 'field' }, h('label', { for: 'fbs-time' }, 'Giờ'), f.time)),
    rowDays,
    h('div', { class: 'field' }, h('label', { for: 'fbs-tz' }, 'Múi giờ'), f.tz),
    err, h('div', null, save));
  sync();
  const dlg = dialog({ title: task ? 'Sửa bài đăng' : 'Bài mới', body: form });
}

async function facebookView() {
  const [groups, tasks, due, rem] = await Promise.all([api('GET', '/fb/groups'), api('GET', '/fb/tasks'), api('GET', '/fb/due'), api('GET', '/fb/reminder')]);
  refreshFbBadge();
  const pending = due.filter((x) => x.items.some((i) => !i.done));
  const finished = due.filter((x) => !x.items.some((i) => !i.done));

  const gName = h('input', { class: 'input', id: 'fbg-name', maxLength: 100, placeholder: 'VD: Hội mua bán nhà đất' });
  const gUrl = h('input', { class: 'input', id: 'fbg-url', type: 'url', placeholder: 'https://www.facebook.com/groups/...' });
  const gErr = h('p', { class: 'error-text', role: 'alert' });
  const gBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, ico('plus'), 'Thêm nhóm');
  const addForm = h('form', { class: 'card card-pad form-grid', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); gErr.textContent = ''; gBtn.disabled = true;
    try { await api('POST', '/fb/groups', { name: gName.value, url: gUrl.value }); toast('Đã thêm nhóm'); route(); }
    catch (ex) { gErr.textContent = ex.message; gBtn.disabled = false; }
  } },
    h('h2', null, 'Nhóm Facebook của bạn'),
    h('div', { class: 'two' },
      h('div', { class: 'field' }, h('label', { for: 'fbg-name' }, 'Tên nhóm'), gName),
      h('div', { class: 'field' }, h('label', { for: 'fbg-url' }, 'Link nhóm'), gUrl)),
    h('p', { class: 'hint' }, 'Mở nhóm trên Facebook, sao chép link trên thanh địa chỉ rồi dán vào đây.'),
    gErr, h('div', null, gBtn),
    groups.length ? h('div', { class: 'list' }, groups.map((g) => h('div', { class: 'li' },
      h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, g.name), h('div', { class: 'li-s mono' }, g.url)),
      h('a', { class: 'btn btn-sm', href: g.url, target: '_blank', rel: 'noopener noreferrer' }, ico('link'), 'Mở nhóm'),
      h('button', { class: 'btn btn-sm btn-danger btn-icon', type: 'button', 'aria-label': `Xoá ${g.name}`, onclick: async () => {
        if (await confirmBox('Xoá nhóm?', `"${g.name}" sẽ bị gỡ khỏi danh sách và khỏi các bài đăng liên quan.`, 'Xoá')) {
          try { await api('DELETE', `/fb/groups/${g.id}`); toast('Đã xoá nhóm'); route(); } catch (ex) { toast(ex.message, 'err'); }
        }
      } }, ico('trash')))) ) : null);

  const chat = h('input', { class: 'input mono', id: 'fb-rem', value: rem.chatId, placeholder: '123456789' });
  const remMsg = h('p', { class: 'hint', role: 'status' });
  const remCard = h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Nhắc qua Telegram'),
    rich('Đến giờ, KingTele nhắn cho bạn qua **bot Telegram đã kết nối** (không tốn Điểm King). Nhắn **/start** cho bot của bạn rồi bấm **Tự nhận diện**, hoặc dán Chat ID cá nhân vào ô bên dưới.', 'hint'),
    h('div', { class: 'field' }, h('label', { for: 'fb-rem' }, 'Chat ID Telegram của bạn'), chat), remMsg,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: (e) => act(e.currentTarget, async () => {
        const r = await api('GET', '/fb/reminder/discover');
        if (!r.chatId) { remMsg.textContent = 'Chưa thấy tin nhắn nào. Hãy nhắn /start cho bot rồi bấm lại.'; return; }
        chat.value = r.chatId; remMsg.textContent = r.name ? `Đã nhận diện: ${r.name}. Bấm Lưu để lưu lại.` : 'Đã nhận diện. Bấm Lưu để lưu lại.';
      }) }, ico('refresh'), 'Tự nhận diện'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('PUT', '/fb/reminder', { chatId: chat.value }); }, 'Đã lưu') }, ico('check'), 'Lưu'),
      h('button', { class: 'btn', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('PUT', '/fb/reminder', { chatId: chat.value }); await api('POST', '/fb/reminder/test'); }, 'Đã gửi tin nhắn thử') }, ico('send'), 'Gửi thử')));

  return h('div', null,
    pageHead('Facebook', 'Hẹn giờ nhắc và đăng nhanh vào nhóm Facebook',
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openFbTask(null, groups) }, ico('plus'), 'Bài mới')),
    h('div', { class: 'banner' }, ico('alert'), rich('**Facebook không cho phần mềm tự đăng vào Nhóm.** Vì vậy KingTele nhắc bạn đúng giờ và chuẩn bị sẵn nội dung: bấm **Sao chép nội dung**, **Mở nhóm**, dán và đăng. KingTele không bao giờ hỏi mật khẩu Facebook của bạn.', 'hint', 'div')),
    h('div', { class: 'stack' },
      h('h2', null, 'Đến hạn đăng'),
      pending.length ? pending.map(fbDueCard) : empty('check', 'Không có bài nào đến hạn', 'Khi đến giờ, bài sẽ hiện ở đây và KingTele nhắc bạn qua Telegram.'),
      finished.length ? h('details', { class: 'card card-pad' }, h('summary', null, `Đã hoàn tất (${finished.length})`), h('div', { class: 'stack', style: 'margin-top:12px' }, finished.map(fbDueCard))) : null,
      h('h2', null, 'Bài hẹn giờ'),
      tasks.length ? tasks.map((t) => fbTaskCard(t, groups))
        : empty('file', 'Chưa có bài hẹn giờ nào', 'Tạo bài đầu tiên và đặt lịch để KingTele nhắc bạn đúng giờ.',
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openFbTask(null, groups) }, ico('plus'), 'Tạo bài đăng')),
      addForm, remCard));
}

// ---------- Zalo: danh sách + lời chào soạn sẵn (gửi thủ công) ----------
const ZALO_DAILY = 20;
let zaloFilter = 'todo';

function zaloGreeting(tpl, name) {
  return tpl.replace(/\s*\{ten\}/gi, name ? ` ${name}` : '').replace(/^\s+/, '');
}

async function zaloView() {
  const [contacts, tpl] = await Promise.all([api('GET', '/zalo/contacts'), api('GET', '/zalo/template')]);
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const today = contacts.filter((c) => c.sentAt && c.sentAt >= startOfDay.getTime()).length;

  const tplBox = h('textarea', { class: 'input', id: 'z-tpl', maxLength: 500, rows: 3, placeholder: 'Chào {ten}, mình muốn kết bạn Zalo để trao đổi thêm. Cảm ơn bạn!' });
  tplBox.value = tpl.text;
  const greeting = (name) => zaloGreeting(tplBox.value.trim() || tplBox.placeholder, name);

  const name = h('input', { class: 'input', id: 'z-name', maxLength: 100, placeholder: 'Nguyen Van A' });
  const phone = h('input', { class: 'input mono', id: 'z-phone', type: 'tel', inputMode: 'tel', placeholder: '0912345678' });
  const bulk = h('textarea', { class: 'input mono', id: 'z-bulk', rows: 4, placeholder: 'Nguyen Van A, 0912345678\n0987654321' });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const submit = async (body, btn) => {
    err.textContent = ''; btn.disabled = true;
    try {
      const r = await api('POST', '/zalo/contacts', body);
      toast(`Đã thêm ${r.added} số, bỏ qua ${r.skipped} dòng trùng hoặc sai`); route();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
  const addBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => submit({ name: name.value, phone: phone.value }, e.currentTarget) }, ico('plus'), 'Thêm');
  const bulkBtn = h('button', { class: 'btn', type: 'button', onclick: (e) => submit({ bulk: bulk.value }, e.currentTarget) }, ico('plus'), 'Thêm danh sách');

  const box = h('div', { class: 'stack' });
  const labels = { todo: 'Chưa gửi', invited: 'Đã gửi lời mời', friend: 'Đã kết bạn', skip: 'Bỏ qua' };
  const setStatus = (c, status) => (e) => act(e.currentTarget, async () => { await api('PUT', `/zalo/contacts/${c.id}`, { status }); route(); });
  const row = (c) => h('div', { class: 'li li-wrap' },
    h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, c.name || 'Chưa có tên'), h('div', { class: 'li-s mono' }, c.phone)),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyToClipboard(greeting(c.name)) }, ico('copy'), 'Sao chép lời chào'),
    h('a', { class: 'btn btn-sm', href: `https://zalo.me/${c.phone}`, target: '_blank', rel: 'noopener noreferrer' }, ico('link'), 'Mở Zalo'),
    c.status === 'todo' ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: setStatus(c, 'invited') }, ico('check'), 'Đã gửi lời mời') : null,
    c.status === 'invited' ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: setStatus(c, 'friend') }, ico('check'), 'Đã kết bạn') : null,
    c.status !== 'skip' && c.status !== 'friend' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: setStatus(c, 'skip') }, 'Bỏ qua') : null,
    c.status !== 'todo' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: setStatus(c, 'todo') }, ico('refresh'), 'Chưa gửi') : null,
    h('button', { class: 'btn btn-sm btn-danger btn-icon', type: 'button', 'aria-label': `Xoá ${c.name || c.phone}`, onclick: async () => {
      if (await confirmBox('Xoá người này?', `Số ${c.phone} sẽ bị xoá khỏi danh sách.`, 'Xoá')) {
        try { await api('DELETE', `/zalo/contacts/${c.id}`); route(); } catch (ex) { toast(ex.message, 'err'); }
      }
    } }, ico('trash')));
  const draw = () => {
    box.replaceChildren();
    const list = contacts.filter((c) => zaloFilter === 'all' || c.status === zaloFilter);
    if (!list.length) { box.append(empty('users', contacts.length ? 'Không có ai trong mục này' : 'Danh sách trống', contacts.length ? 'Thử chọn mục khác.' : 'Thêm số điện thoại ở form phía trên.')); return; }
    box.append(h('div', { class: 'card card-pad' }, h('div', { class: 'list' }, list.map(row))));
  };
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Lọc danh sách' },
    [['todo'], ['invited'], ['friend'], ['skip'], ['all']].map(([k]) =>
      h('button', { class: 'tab', type: 'button', 'aria-pressed': String(zaloFilter === k), onclick: (e) => {
        zaloFilter = k; tabs.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); draw();
      } }, k === 'all' ? 'Tất cả' : `${labels[k]} (${contacts.filter((c) => c.status === k).length})`)));
  draw();

  return h('div', null,
    pageHead('Zalo', 'Danh sách người cần kết bạn và lời chào soạn sẵn'),
    h('div', { class: 'banner' }, ico('alert'), rich('**Zalo không cho phần mềm tự gửi lời mời kết bạn.** KingTele giúp bạn làm nhanh và gọn: bấm **Sao chép lời chào**, **Mở Zalo**, dán và gửi. Chỉ nên gửi khoảng 20 người mỗi ngày để tránh bị Zalo hạn chế tài khoản.', 'hint', 'div')),
    h('div', { class: 'stack' },
      h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Lời chào kết bạn'),
        h('div', { class: 'field' }, h('label', { for: 'z-tpl' }, 'Nội dung'), tplBox,
          h('span', { class: 'hint' }, 'Gõ {ten} để chèn tên người nhận. Để trống sẽ dùng lời chào mẫu.')),
        h('div', null, h('button', { class: 'btn', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('PUT', '/zalo/template', { text: tplBox.value }); }, 'Đã lưu') }, 'Lưu lời chào'))),
      h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Thêm người'),
        h('div', { class: 'two' },
          h('div', { class: 'field' }, h('label', { for: 'z-name' }, 'Tên'), name),
          h('div', { class: 'field' }, h('label', { for: 'z-phone' }, 'Số điện thoại'), phone)),
        h('div', null, addBtn),
        h('div', { class: 'field' }, h('label', { for: 'z-bulk' }, 'Hoặc dán danh sách (mỗi dòng: Tên, Số điện thoại)'), bulk),
        err, h('div', null, bulkBtn)),
      h('p', { class: today >= ZALO_DAILY ? 'error-text' : 'hint', role: 'status' }, `Hôm nay đã gửi lời mời: ${today} (gợi ý tối đa ${ZALO_DAILY})`),
      tabs, box));
}

// ---------- Duyệt bài trong nhóm Telegram ----------
async function refreshModBadge() {
  try {
    const q = await api('GET', '/mod/queue');
    const n = q.filter((x) => x.status === 'pending').length;
    const a = document.querySelector('.menu a[data-route="moderation"]');
    if (!a) return;
    let b = a.querySelector('.nav-badge');
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = h('span', { class: 'nav-badge' }); a.append(b); }
    b.textContent = String(n);
  } catch { /* huy hiệu chỉ là phần phụ */ }
}

async function moderationView() {
  const [st, queue] = await Promise.all([api('GET', '/mod/status'), api('GET', '/mod/queue')]);
  const pending = queue.filter((x) => x.status === 'pending');
  const done = queue.filter((x) => x.status !== 'pending');
  refreshModBadge();

  const chat = h('input', { class: 'input mono', id: 'm-chat', value: st.approverChatId, placeholder: '123456789' });
  const msg = h('p', { class: 'hint', role: 'status' });
  const approverCard = h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Admin nhận bài chờ duyệt'),
    rich('**Nhắn /start cho bot** của bạn trước, rồi bấm **Tự nhận diện**. Bài chờ duyệt sẽ được gửi vào đây, kèm nút duyệt ngay trong Telegram.', 'hint'),
    h('div', { class: 'field' }, h('label', { for: 'm-chat' }, 'Chat ID Telegram của bạn'), chat), msg,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: (e) => act(e.currentTarget, async () => {
        const r = await api('GET', '/fb/reminder/discover');
        if (!r.chatId) { msg.textContent = 'Chưa thấy tin nhắn nào. Hãy nhắn /start cho bot rồi bấm lại.'; return; }
        chat.value = r.chatId; msg.textContent = 'Đã nhận diện. Bấm Lưu để lưu lại.';
      }) }, ico('refresh'), 'Tự nhận diện'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => act(e.currentTarget, async () => { await api('PUT', '/fb/reminder', { chatId: chat.value }); route(); }, 'Đã lưu') }, ico('check'), 'Lưu')));

  const groupsCard = h('div', { class: 'card card-pad form-grid' }, h('h2', null, 'Nhóm cần duyệt bài'),
    h('p', { class: 'hint' }, 'Bot phải là quản trị viên của nhóm và có quyền xoá tin nhắn. Admin của nhóm không bị chặn.'),
    st.error ? h('p', { class: 'error-text', role: 'alert' }, st.error === 'webhook' ? 'Bot đang gắn webhook của dịch vụ khác nên không nhận được tin nhắn. Hãy gỡ webhook rồi thử lại.' : 'Token bot không còn dùng được. Hãy kiểm tra lại ở Cài đặt.') : null,
    st.groups.length ? h('div', { class: 'list' }, st.groups.map((g) => h('div', { class: 'li li-wrap' },
      h('div', { class: 'li-main' }, h('div', { class: 'li-t' }, g.title)),
      g.moderated ? h('span', { class: 'tag ok' }, 'Đang duyệt') : h('span', { class: 'tag' }, 'Chưa bật'),
      h('button', { class: `btn btn-sm ${g.moderated ? '' : 'btn-primary'}`, type: 'button', onclick: (e) => act(e.currentTarget, async () => {
        await api('POST', `/mod/groups/${g.id}/toggle`, { enabled: !g.moderated }); route();
      }, g.moderated ? 'Đã tắt duyệt bài' : 'Đã bật duyệt bài') }, g.moderated ? 'Tắt duyệt' : 'Bật duyệt'))))
      : h('p', { class: 'hint' }, 'Chưa có nhóm Telegram phù hợp. Thêm nhóm ở mục Nhóm Telegram.'));

  const decide = (item, approve) => (e) => act(e.currentTarget, async () => { await api('POST', `/mod/queue/${item.id}/decide`, { approve }); route(); }, approve ? 'Đã duyệt và đăng vào nhóm' : 'Đã từ chối');
  const card = (it) => h('article', { class: 'card post' },
    h('div', { class: 'post-top' }, h('div', { style: 'min-width:0;flex:1' }, h('h3', null, it.authorName), h('p', { class: 'excerpt' }, it.preview || 'Tin không có chữ (ảnh, video, tệp...)')),
      it.status === 'pending' ? h('span', { class: 'tag warn' }, 'Chờ duyệt') : it.status === 'approved' ? h('span', { class: 'tag ok' }, 'Đã duyệt') : h('span', { class: 'tag err' }, 'Đã từ chối')),
    h('div', { class: 'meta' }, h('span', null, ico('users'), it.groupTitle), h('span', null, ico('clock'), `${fmtDT(it.createdAt)} (${rel(it.createdAt)})`)),
    it.status === 'pending' ? h('div', { class: 'post-actions' },
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: decide(it, true) }, ico('check'), 'Duyệt'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: decide(it, false) }, ico('x'), 'Từ chối')) : null);

  return h('div', null,
    pageHead('Duyệt bài', 'Giữ tin nhắn của thành viên cho tới khi admin duyệt', h('button', { class: 'btn', type: 'button', onclick: route }, ico('refresh'), 'Làm mới')),
    h('div', { class: 'banner' }, ico('alert'), rich('**Cách hoạt động:** thành viên gửi tin vào nhóm, bot **xoá ngay** và chuyển tin cho admin kèm nút Duyệt hoặc Từ chối. Duyệt xong, bot **đăng lại** vào nhóm. Telegram không cho giữ tin trước khi đăng, nên tin có thể hiện khoảng 1 giây rồi biến mất.', 'hint', 'div')),
    h('div', { class: 'stack' },
      h('h2', null, 'Chờ duyệt'),
      pending.length ? pending.map(card) : empty('check', 'Không có bài nào chờ duyệt', 'Khi thành viên gửi tin vào nhóm đã bật duyệt, tin sẽ hiện ở đây.'),
      done.length ? h('details', { class: 'card card-pad' }, h('summary', null, `Đã xử lý (${done.length})`), h('div', { class: 'stack', style: 'margin-top:12px' }, done.map(card))) : null,
      approverCard, groupsCard));
}

const routes = { overview: ['Tổng quan', overviewView], posts: ['Bài đăng', postsView], groups: ['Nhóm Telegram', groupsView], facebook: ['Facebook', facebookView], zalo: ['Zalo', zaloView], moderation: ['Duyệt bài', moderationView], logs: ['Nhật ký gửi', logsView], settings: ['Cài đặt', settingsView], points: ['Điểm King', pointsView], members: ['Thành viên', membersView], installs: ['Ứng dụng', appStatsView], traffic: ['Truy cập', trafficView] };
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
    if (mine === token) { view.replaceChildren(el); refreshPoints(); if (key !== 'facebook') refreshFbBadge(); if (key !== 'moderation') refreshModBadge(); }
  } catch (e) {
    if (mine === token) view.replaceChildren(empty('alert', 'Không tải được dữ liệu', e.message, h('button', { class: 'btn', type: 'button', onclick: route }, 'Thử lại')));
  }
}
window.addEventListener('hashchange', () => { view.replaceChildren(); route(); window.scrollTo(0, 0); });

document.getElementById('menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
document.getElementById('scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
document.getElementById('logout').addEventListener('click', async () => { await api('POST', '/logout').catch(() => {}); location.href = '/login'; });

const clock = document.getElementById('clock');
const tick = () => { clock.textContent = new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short', timeZone: state.tz }).format(new Date()); };
setInterval(tick, 20000); tick();

(async function boot() {
  try {
    const me = await api('GET', '/me');
    state.user = me.user;
    const who = document.getElementById('whoami');
    who.replaceChildren(h('strong', null, me.user.name), h('span', null, me.user.email || 'Quản trị viên'), h('span', { id: 'whoPts', class: 'pts' }));
    setPoints(me.points);
    who.hidden = false;
    if (me.user.role === 'admin') {
      document.querySelector('.menu').append(h('a', { href: '#members', 'data-route': 'members' }, ico('users'), 'Thành viên'),
        h('a', { href: '#installs', 'data-route': 'installs' }, ico('download'), 'Ứng dụng'),
        h('a', { href: '#traffic', 'data-route': 'traffic' }, ico('globe'), 'Truy cập'));
    }
  } catch { /* api() đã chuyển về trang đăng nhập nếu hết phiên */ }
  route();
})();
