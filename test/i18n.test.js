const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const core = require('../public/assets/i18n-core.js');

const root = path.join(__dirname, '..');
const LANGS = ['en', 'zh', 'es', 'hi', 'ar', 'pt', 'ru', 'ja', 'ko', 'de', 'fr', 'id', 'th', 'tr', 'fi'];
const keys = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'keys.json'), 'utf8'));

function dict(lang) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public', 'assets', 'lang', `${lang}.js`), 'utf8'), sandbox);
  return sandbox.window.__I18N_DICT[lang];
}

test('mọi ngôn ngữ có đủ mọi chuỗi và giữ nguyên {n}', () => {
  for (const l of LANGS) {
    const d = dict(l);
    for (const k of keys) {
      assert.ok(d[k], `${l} thiếu: ${k}`);
      const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
      assert.strictEqual(ph(d[k]), ph(k), `${l} sai placeholder: ${k}`);
    }
  }
});

test('dịch khớp chính xác, giữ khoảng trắng đầu/cuối, chuẩn hoá khoảng trắng giữa chữ', () => {
  const d = core.compile(dict('en'));
  assert.strictEqual(core.translate(d, 'Cài đặt'), 'Settings');
  assert.strictEqual(core.translate(d, '  Cài đặt\n '), '  Settings\n ');
  assert.strictEqual(core.translate(d, 'Hằng  ngày\n· 07:30'), 'Daily · 07:30');
});

test('dịch mẫu có tham số và dịch cả tham số là chuỗi đã biết', () => {
  const d = core.compile(dict('en'));
  assert.strictEqual(core.translate(d, 'Bạn chỉ còn 12 Điểm King.'), 'You only have 12 King Points left.');
  assert.strictEqual(core.translate(d, 'Một lần · 20/10/2026 09:00'), 'Once · 20/10/2026 09:00');
  assert.strictEqual(core.translate(d, 'Ảnh tối đa 10MB'), 'Images can be at most 10MB');
  // tham số "Ảnh" và "quá thời gian" được dịch vì chúng cũng là khoá
  assert.strictEqual(core.translate(d, 'Ảnh tối đa 10MB (file này 12 MB)'), 'Image max 10MB (this file is 12 MB)');
  assert.strictEqual(core.translate(d, 'Không kết nối được Telegram (quá thời gian)'), "Couldn't connect to Telegram (timed out)");
  assert.strictEqual(core.translate(d, 'Chuỗi hoàn toàn lạ'), 'Chuỗi hoàn toàn lạ'); // không khớp -> nguyên văn
});

test('mẫu cụ thể (dài) được ưu tiên hơn mẫu chung', () => {
  const d = core.compile(dict('en'));
  assert.strictEqual(core.translate(d, '3 nhóm · 5 bài · 40 đã gửi'), '3 groups · 5 posts · 40 sent');
  assert.strictEqual(core.translate(d, '7 đã gửi'), '7 sent');
});

test('nội dung người dùng không bị đụng tới', () => {
  const d = core.compile(dict('ja'));
  for (const s of ['Bản tin của tôi', 'Nhóm Khách VIP 2026', 'hello world', '12:30']) assert.strictEqual(core.translate(d, s), s);
});

test('mỗi ngôn ngữ dịch được tiêu đề và mẫu', () => {
  for (const l of LANGS) {
    const d = core.compile(dict(l));
    assert.notStrictEqual(core.translate(d, 'Tổng quan'), 'Tổng quan', l);
    assert.notStrictEqual(core.translate(d, 'Bạn chỉ còn 5 Điểm King.'), 'Bạn chỉ còn 5 Điểm King.', l);
    assert.match(core.translate(d, 'Bạn chỉ còn 5 Điểm King.'), /5/, l);
  }
});

// ---- chọn ngôn ngữ ----
function detect({ tz, langs, saved, search = '' }) {
  const storage = saved ? { kt_lang: saved } : {};
  const sandbox = {
    window: {},
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: tz }) }) },
    navigator: { languages: langs, language: langs[0] },
    location: { search, reload() {} },
    URLSearchParams,
    localStorage: { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
    setTimeout: () => 0,
    document: {
      documentElement: { classList: { add() {}, remove() {} } },
      readyState: 'complete',
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild() {} },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public', 'assets', 'i18n.js'), 'utf8'), sandbox);
  return sandbox.window.I18N.lang;
}

test('chọn ngôn ngữ: quốc gia (múi giờ) khi trình duyệt chỉ để tiếng Anh', () => {
  assert.strictEqual(detect({ tz: 'Asia/Ho_Chi_Minh', langs: ['en-US', 'en'] }), 'vi');
  assert.strictEqual(detect({ tz: 'Europe/Helsinki', langs: ['en-US'] }), 'fi');
  assert.strictEqual(detect({ tz: 'Asia/Tokyo', langs: ['en'] }), 'ja');
  assert.strictEqual(detect({ tz: 'America/Argentina/Buenos_Aires', langs: ['en'] }), 'es');
  assert.strictEqual(detect({ tz: 'America/Sao_Paulo', langs: ['en'] }), 'pt');
});

test('chọn ngôn ngữ: tôn trọng ngôn ngữ trình duyệt khác tiếng Anh, rồi mới tới múi giờ', () => {
  assert.strictEqual(detect({ tz: 'Asia/Ho_Chi_Minh', langs: ['ja-JP'] }), 'ja');
  assert.strictEqual(detect({ tz: 'America/New_York', langs: ['fr-CA', 'en'] }), 'fr');
  assert.strictEqual(detect({ tz: 'America/New_York', langs: ['zh-TW'] }), 'zh');
  assert.strictEqual(detect({ tz: 'Europe/Helsinki', langs: ['sv'] }), 'fi'); // ngôn ngữ không hỗ trợ -> theo quốc gia
});

test('chọn ngôn ngữ: không rõ thì tiếng Anh; lựa chọn đã lưu và ?lang= được ưu tiên nhất', () => {
  assert.strictEqual(detect({ tz: 'Europe/Stockholm', langs: ['sv'] }), 'en');
  assert.strictEqual(detect({ tz: 'Asia/Ho_Chi_Minh', langs: ['vi'], saved: 'ko' }), 'ko');
  assert.strictEqual(detect({ tz: 'Asia/Ho_Chi_Minh', langs: ['vi'], saved: 'ko', search: '?lang=de' }), 'de');
  assert.strictEqual(detect({ tz: 'Asia/Ho_Chi_Minh', langs: ['vi'], search: '?lang=xx' }), 'vi');
});
