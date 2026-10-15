'use strict';
/**
 * Dựng từ điển dịch: i18n/src/*.txt  ->  public/assets/lang/<mã>.js
 *
 * Định dạng file nguồn (một khối cho mỗi chuỗi, khoá là văn bản tiếng Việt đúng như trong giao diện):
 *   = Chuỗi tiếng Việt gốc
 *   en| English translation
 *   zh| 中文
 *   ...
 * Chuỗi có {0}, {1} là mẫu: bản dịch phải giữ đủ các {n} đó.
 * Chạy: npm run i18n
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LANGS = ['en', 'zh', 'es', 'hi', 'ar', 'pt', 'ru', 'ja', 'ko', 'de', 'fr', 'id', 'th', 'tr', 'fi'];
const keys = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'keys.json'), 'utf8'));
const srcDir = path.join(root, 'i18n', 'src');

// --prune: xoá khỏi file nguồn các khối dịch không còn dùng trong giao diện (sau khi sửa giao diện)
if (process.argv.includes('--prune')) {
  const used = new Set(keys);
  let removed = 0;
  for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith('.txt'))) {
    const out = [];
    let skip = false;
    for (const line of fs.readFileSync(path.join(srcDir, f), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('= ')) { skip = !used.has(line.slice(2).trim()); if (skip) removed++; }
      if (!skip) out.push(line);
    }
    fs.writeFileSync(path.join(srcDir, f), out.join('\n').replace(/\n{3,}/g, '\n\n'));
  }
  console.log(`Đã xoá ${removed} khối dịch không còn dùng.`);
  process.exit(0);
}

const table = new Map(); // key -> { lang: text }
const errors = [];
for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith('.txt')).sort()) {
  let cur = null;
  fs.readFileSync(path.join(srcDir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    if (line.startsWith('= ')) {
      cur = line.slice(2).trim();
      if (table.has(cur)) errors.push(`${f}:${i + 1} khoá trùng: ${cur}`);
      table.set(cur, {});
      return;
    }
    const m = /^([a-z]{2})\|\s?(.*)$/.exec(line);
    if (!m || !cur) return errors.push(`${f}:${i + 1} dòng không hợp lệ: ${line.slice(0, 60)}`);
    if (!LANGS.includes(m[1])) return errors.push(`${f}:${i + 1} mã ngôn ngữ lạ: ${m[1]}`);
    table.get(cur)[m[1]] = m[2].trim();
  });
}

const ph = (s) => (s.match(/\{\d+\}/g) || []).sort().join(',');
// Chuỗi giàu định dạng: số cặp **, các đoạn `mã` và các link phải giữ nguyên ở mọi ngôn ngữ
const rich = (s) => [(s.match(/\*\*/g) || []).length, [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort().join('|'), [...s.matchAll(/\]\((https?:[^)\s]+)\)/g)].map((m) => m[1]).sort().join('|')].join('#');
for (const k of keys) {
  const row = table.get(k);
  if (!row) { errors.push(`thiếu khoá: ${k}`); continue; }
  for (const l of LANGS) {
    if (!row[l]) errors.push(`thiếu ${l}: ${k}`);
    else if (ph(row[l]) !== ph(k)) errors.push(`${l} sai placeholder (${ph(k)} vs ${ph(row[l])}): ${k}`);
    else if (rich(row[l]) !== rich(k)) errors.push(`${l} sai định dạng đậm/mã/link: ${k}`);
  }
}
const keySet = new Set(keys);
for (const k of table.keys()) if (!keySet.has(k)) errors.push(`khoá không có trong giao diện: ${k}`);

if (errors.length) {
  console.error(`${errors.length} lỗi:\n${errors.slice(0, 60).join('\n')}${errors.length > 60 ? '\n...' : ''}`);
  process.exit(1);
}

const out = path.join(root, 'public', 'assets', 'lang');
fs.mkdirSync(out, { recursive: true });
for (const l of LANGS) {
  const strings = {};
  for (const k of keys) strings[k] = table.get(k)[l];
  fs.writeFileSync(path.join(out, `${l}.js`),
    `window.__I18N_DICT=window.__I18N_DICT||{};window.__I18N_DICT[${JSON.stringify(l)}]=${JSON.stringify(strings)};\n`);
}
console.log(`Đã dựng ${LANGS.length} ngôn ngữ x ${keys.length} chuỗi.`);
