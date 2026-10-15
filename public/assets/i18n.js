/* Đa ngôn ngữ: tự chọn ngôn ngữ theo vị trí/trình duyệt, dịch DOM theo từ điển, có nút đổi ngôn ngữ. */
(function () {
  'use strict';
  const me = document.currentScript; // mang mã phiên bản (?v=) để từ điển ngôn ngữ cũng được làm mới
  const LANGS = [
    { code: 'vi', name: 'Tiếng Việt', locale: 'vi-VN' },
    { code: 'en', name: 'English', locale: 'en-US' },
    { code: 'zh', name: '简体中文', locale: 'zh-CN' },
    { code: 'es', name: 'Español', locale: 'es-ES' },
    { code: 'hi', name: 'हिन्दी', locale: 'hi-IN' },
    { code: 'ar', name: 'العربية', locale: 'ar', dir: 'rtl' },
    { code: 'pt', name: 'Português', locale: 'pt-BR' },
    { code: 'ru', name: 'Русский', locale: 'ru-RU' },
    { code: 'ja', name: '日本語', locale: 'ja-JP' },
    { code: 'ko', name: '한국어', locale: 'ko-KR' },
    { code: 'de', name: 'Deutsch', locale: 'de-DE' },
    { code: 'fr', name: 'Français', locale: 'fr-FR' },
    { code: 'id', name: 'Bahasa Indonesia', locale: 'id-ID' },
    { code: 'th', name: 'ไทย', locale: 'th-TH' },
    { code: 'tr', name: 'Türkçe', locale: 'tr-TR' },
    { code: 'fi', name: 'Suomi', locale: 'fi-FI' },
  ];
  const byCode = Object.fromEntries(LANGS.map((l) => [l.code, l]));
  const root = document.documentElement;
  const KEY = 'kt_lang';

  // Múi giờ -> ngôn ngữ của quốc gia đó (tín hiệu vị trí, không cần gửi IP đi đâu)
  const TZ = {};
  const add = (lang, zones) => zones.split(' ').forEach((z) => { TZ[z] = lang; });
  add('vi', 'Asia/Ho_Chi_Minh Asia/Saigon');
  add('th', 'Asia/Bangkok');
  add('zh', 'Asia/Shanghai Asia/Chongqing Asia/Harbin Asia/Urumqi Asia/Hong_Kong Asia/Macau Asia/Taipei');
  add('ja', 'Asia/Tokyo');
  add('ko', 'Asia/Seoul Asia/Pyongyang');
  add('id', 'Asia/Jakarta Asia/Pontianak Asia/Makassar Asia/Jayapura');
  add('hi', 'Asia/Kolkata Asia/Calcutta');
  add('tr', 'Europe/Istanbul Asia/Istanbul');
  add('fi', 'Europe/Helsinki Europe/Mariehamn');
  add('de', 'Europe/Berlin Europe/Vienna Europe/Zurich Europe/Busingen Europe/Vaduz');
  add('fr', 'Europe/Paris Europe/Brussels Europe/Luxembourg Europe/Monaco Africa/Dakar Africa/Abidjan Africa/Kinshasa Africa/Douala Indian/Reunion America/Martinique');
  add('es', 'Europe/Madrid Africa/Ceuta Atlantic/Canary America/Mexico_City America/Monterrey America/Merida America/Cancun America/Tijuana America/Hermosillo America/Bogota America/Lima America/Santiago America/Caracas America/Guayaquil America/La_Paz America/Asuncion America/Montevideo America/Costa_Rica America/Panama America/Guatemala America/El_Salvador America/Tegucigalpa America/Managua America/Havana America/Santo_Domingo America/Puerto_Rico');
  add('pt', 'Europe/Lisbon Atlantic/Madeira Atlantic/Azores America/Sao_Paulo America/Bahia America/Fortaleza America/Recife America/Belem America/Manaus America/Cuiaba America/Campo_Grande America/Porto_Velho America/Rio_Branco America/Maceio America/Noronha America/Araguaina America/Santarem America/Boa_Vista America/Eirunepe');
  add('ru', 'Europe/Moscow Europe/Kaliningrad Europe/Samara Europe/Volgograd Europe/Minsk Asia/Yekaterinburg Asia/Omsk Asia/Novosibirsk Asia/Krasnoyarsk Asia/Irkutsk Asia/Yakutsk Asia/Vladivostok Asia/Magadan Asia/Kamchatka');
  add('ar', 'Asia/Riyadh Asia/Dubai Asia/Baghdad Asia/Kuwait Asia/Qatar Asia/Bahrain Asia/Muscat Asia/Aden Asia/Amman Asia/Beirut Asia/Damascus Africa/Cairo Africa/Casablanca Africa/Algiers Africa/Tunis Africa/Tripoli Africa/Khartoum');
  const tzLang = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      return TZ[tz] || (tz.startsWith('America/Argentina/') ? 'es' : null);
    } catch { return null; }
  };

  const browserLang = () => {
    const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const l of list) {
      const c = String(l || '').toLowerCase().split('-')[0];
      if (byCode[c]) return c;
    }
    return null;
  };

  function detect() {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (q && byCode[q]) { localStorage.setItem(KEY, q); return q; }
      const saved = localStorage.getItem(KEY);
      if (saved && byCode[saved]) return saved;
    } catch { /* localStorage bị chặn */ }
    // Ưu tiên quốc gia (múi giờ) khi trình duyệt chỉ để tiếng Anh mặc định;
    // nếu trình duyệt đặt ngôn ngữ khác thì tôn trọng lựa chọn đó.
    const z = tzLang(), b = browserLang();
    if (z && (!b || b === 'en')) return z;
    return b || z || 'en';
  }

  const lang = detect();
  const meta = byCode[lang];
  root.lang = lang;
  root.dir = meta.dir || 'ltr';

  function setLang(code) {
    try { localStorage.setItem(KEY, code); } catch { /* bỏ qua */ }
    location.reload();
  }
  let compiled = null; // từ điển đã biên dịch (có sau khi tải xong ngôn ngữ)
  /** Dựng nội dung giàu định dạng cho phần tử có thuộc tính data-rich (đã dịch nếu có từ điển). */
  function rich(el) {
    const src = el.getAttribute('data-rich') || '';
    const text = compiled ? window.I18NCore.translate(compiled, src) : src;
    el.replaceChildren(...window.I18NCore.parseRich(text).map((k) => {
      if (k.t === 'text') return document.createTextNode(k.v);
      const e = document.createElement(k.t === 'b' ? 'strong' : k.t === 'code' ? 'code' : 'a');
      e.textContent = k.v;
      if (k.t === 'a') { e.href = k.href; e.target = '_blank'; e.rel = 'noopener noreferrer'; }
      return e;
    }));
  }
  window.I18N = { lang, locale: meta.locale, dir: root.dir, langs: LANGS, setLang, rich };

  function buildSwitchers() {
    document.querySelectorAll('[data-lang-switch]').forEach((box) => {
      const sel = document.createElement('select');
      sel.className = 'lang-select';
      sel.setAttribute('aria-label', 'Language');
      for (const l of LANGS) {
        const o = document.createElement('option');
        o.value = l.code; o.textContent = l.name; o.selected = l.code === lang;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => setLang(sel.value));
      box.replaceChildren(sel);
    });
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  whenReady(buildSwitchers);
  if (lang === 'vi') return; // văn bản gốc là tiếng Việt, không cần dịch

  root.classList.add('i18n-pending'); // ẩn trang đến khi dịch xong, tránh nháy tiếng Việt
  const reveal = () => root.classList.remove('i18n-pending');
  setTimeout(reveal, 2500);

  const ver = (/[?&]v=[\w]+/.exec(me && me.src) || [''])[0].replace('&', '?');
  const s = document.createElement('script');
  s.src = `/assets/lang/${lang}.js${ver}`;
  s.onerror = reveal; // không tải được từ điển: hiện nguyên văn
  s.onload = () => whenReady(start);
  document.head.appendChild(s);

  function start() {
    const data = (window.__I18N_DICT || {})[lang];
    if (!data) return reveal();
    const dict = window.I18NCore.compile(data);
    compiled = dict;
    document.querySelectorAll('[data-rich]').forEach(rich);
    const tr = (text) => window.I18NCore.translate(dict, text);
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
    const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

    const skipped = (el) => !el || SKIP.has(el.tagName) || !!(el.closest && el.closest('[translate="no"]'));

    function textNode(n) {
      const p = n.parentNode;
      if (skipped(p)) return;
      let out = tr(n.nodeValue);
      if (out === n.nodeValue && p.tagName === 'TITLE') out = n.nodeValue.split(' - ').map(tr).join(' - '); // "Trang - KingTele"
      if (out !== n.nodeValue) n.nodeValue = out;
    }
    function attr(el, name) {
      const v = el.getAttribute(name);
      if (v == null) return;
      const out = tr(v);
      if (out !== v) el.setAttribute(name, out);
    }
    function walk(node) {
      if (node.nodeType === 3) return textNode(node);
      if (node.nodeType === 1 && node.hasAttribute('data-rich')) return rich(node);
      if (node.nodeType !== 1 || skipped(node)) return;
      const tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) textNode(n);
      const els = [node, ...node.querySelectorAll('[placeholder],[aria-label],[title],[alt]')];
      for (const el of els) for (const a of ATTRS) if (el.hasAttribute && el.hasAttribute(a)) attr(el, a);
    }

    walk(document.documentElement);
    document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"]').forEach((m) => attr(m, 'content'));

    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') textNode(m.target);
        else if (m.type === 'attributes') attr(m.target, m.attributeName);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

    reveal();
  }
}());
