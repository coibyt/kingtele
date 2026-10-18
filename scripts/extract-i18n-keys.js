// Trích mọi chuỗi tiếng Việt trong giao diện + thông báo server -> i18n/keys.json. Chạy: npm run i18n:keys
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const VI = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹĂÂĐÊÔƠƯÀÁẠẢÃẰẮẶẲẴẦẤẬẨẪÈÉẸẺẼỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕỒỐỘỔỖỜỚỢỞỠÙÚỤỦŨỪỨỰỬỮỲÝỴỶỸ]/;
const set = new Map();
const add = (s, file) => {
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || !VI.test(s)) return;
  if (!set.has(s)) set.set(s, new Set());
  set.get(s).add(path.basename(file));
};

for (const f of ['public/index.html', 'views/app.html', 'views/login.html', 'views/register.html', 'views/404.html', 'public/offline.html']) {
  const src = fs.readFileSync(path.join(root, f), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of src.matchAll(/>([^<>]+)</g)) add(m[1], f);
  for (const m of src.matchAll(/\b(?:aria-label|placeholder|title|content|alt)="([^"]+)"/g)) add(m[1], f);
}

const SQ = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g;
const TPL = /`((?:[^`\\]|\\.)*)`/g;
const EXPR = /\$\{((?:[^{}]|\{[^{}]*\})*)\}/g;
for (const f of ['public/assets/app.js', 'public/assets/login.js', 'public/assets/register.js', 'public/assets/site.js', 'public/assets/pwa.js', 'src/routes.js', 'src/auth.js', 'src/scheduler.js', 'src/media.js', 'src/points.js', 'src/schedule.js', 'src/fb.js', 'src/zalo.js', 'src/moderation.js', 'src/inbox.js', 'src/telegram.js']) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const lit = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of src.matchAll(lit)) {
    let s = m[1] ?? m[2] ?? m[3];
    if (s === undefined) continue;
    if (m[3] !== undefined) {
      for (const ex of s.matchAll(EXPR)) {
        for (const q of ex[1].matchAll(SQ)) add((q[1] ?? q[2]).replace(/\\'/g, "'"), f);
        for (const q of ex[1].matchAll(TPL)) { let i = 0; add(q[1].replace(EXPR, () => `{${i++}}`), f); }
      }
    }
    if (!VI.test(s.replace(EXPR, ''))) continue;
    let i = 0;
    s = s.replace(EXPR, () => `{${i++}}`);
    s = s.replace(/\\'/g, "'").replace(/\\n/g, ' ');
    add(s, f);
  }
}
const out = [...set.entries()].map(([k, v]) => ({ k, f: [...v].join(',') }));
fs.mkdirSync(path.join(root, 'i18n'), { recursive: true });
fs.writeFileSync(path.join(root, 'i18n', 'keys.json'), JSON.stringify(out.map((x) => x.k), null, 1));
console.log(out.length, 'chuỗi');
