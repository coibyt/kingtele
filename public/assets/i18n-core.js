/* Lõi dịch: khớp văn bản tiếng Việt gốc (kể cả mẫu có {0}, {1}) với bản dịch. Chạy được cả ở trình duyệt và Node (để test). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18NCore = factory();
}(this, function () {
  'use strict';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** strings: { 'chuỗi tiếng Việt': 'bản dịch' }. Khoá chứa {n} được xem là mẫu. */
  function compile(strings) {
    const exact = new Map();
    const patterns = [];
    for (const [k, v] of Object.entries(strings)) {
      if (/\{\d+\}/.test(k)) {
        const parts = k.split(/\{\d+\}/);
        patterns.push({ re: new RegExp(`^${parts.map(esc).join('(.+?)')}$`, 's'), to: v, len: k.length });
      } else {
        exact.set(k, v);
      }
    }
    patterns.sort((a, b) => b.len - a.len); // mẫu cụ thể (dài) được thử trước
    return { exact, patterns };
  }

  /** Dịch một đoạn văn bản, giữ nguyên khoảng trắng đầu/cuối. Không khớp thì trả lại nguyên văn. */
  function translate(dict, raw) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    const core = m[2].replace(/\s+/g, ' ');
    if (!core) return raw;
    let out = dict.exact.get(core);
    if (out === undefined) {
      for (const p of dict.patterns) {
        const r = p.re.exec(core);
        if (r) { out = p.to.replace(/\{(\d+)\}/g, (_, i) => {
            const v = r[+i + 1];
            if (v === undefined) return '';
            const t = dict.exact.get(v);
            return t === undefined ? v : t;
          }); break; }
      }
    }
    return out === undefined ? raw : m[1] + out + m[3];
  }

  return { compile, translate };
}));
