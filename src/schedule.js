'use strict';
// Tính toán lịch đăng có nhận biết múi giờ (không cần thư viện ngoài).

function localParts(ts, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const x of f.formatToParts(ts)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function tzOffset(ts, tz) {
  const p = localParts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
}

function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}

function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Chuẩn hoá + kiểm tra lịch. Ném Error(message) nếu sai. */
function normalizeSchedule(s) {
  if (!s || typeof s !== 'object') throw new Error('Thiếu cấu hình lịch đăng');
  const type = s.type;
  const out = { type };
  if (type === 'once') {
    if (!DATE_RE.test(s.date || '') || !TIME_RE.test(s.time || '')) throw new Error('Ngày/giờ đăng không hợp lệ');
    out.date = s.date; out.time = s.time;
  } else if (type === 'daily') {
    if (!TIME_RE.test(s.time || '')) throw new Error('Giờ đăng không hợp lệ');
    out.time = s.time;
  } else if (type === 'weekly') {
    if (!TIME_RE.test(s.time || '')) throw new Error('Giờ đăng không hợp lệ');
    const days = [...new Set((s.days || []).map(Number))].filter((d) => d >= 0 && d <= 6).sort();
    if (!days.length) throw new Error('Chọn ít nhất một ngày trong tuần');
    out.time = s.time; out.days = days;
  } else if (type === 'interval') {
    const n = Math.floor(Number(s.everyMinutes));
    if (!(n >= 5 && n <= 60 * 24 * 30)) throw new Error('Chu kỳ lặp tối thiểu 5 phút');
    out.everyMinutes = n;
    if (s.date && s.time) {
      if (!DATE_RE.test(s.date) || !TIME_RE.test(s.time)) throw new Error('Thời điểm bắt đầu không hợp lệ');
      out.date = s.date; out.time = s.time;
    }
  } else {
    throw new Error('Kiểu lịch không hợp lệ');
  }
  return out;
}

function atLocal(dateStr, timeStr, tz) {
  const [, y, m, d] = DATE_RE.exec(dateStr);
  const [, h, mi] = TIME_RE.exec(timeStr);
  return zonedToUtc(+y, +m, +d, +h, +mi, tz);
}

/**
 * Thời điểm chạy kế tiếp (ms UTC) sau `from`, hoặc null nếu không còn.
 * `initial` = true khi vừa tạo/sửa (interval sẽ bắt đầu từ mốc start nếu có).
 */
function nextRun(schedule, tz, from = Date.now(), initial = false) {
  const sch = schedule;
  if (sch.type === 'once') {
    const t = atLocal(sch.date, sch.time, tz);
    return t > from ? t : null;
  }
  if (sch.type === 'interval') {
    if (initial && sch.date && sch.time) {
      const t = atLocal(sch.date, sch.time, tz);
      if (t > from) return t;
    }
    return from + sch.everyMinutes * 60000;
  }
  const [, hh, mm] = TIME_RE.exec(sch.time);
  const base = localParts(from, tz);
  for (let i = 0; i <= 8; i++) {
    const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + i));
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    if (sch.type === 'weekly' && !sch.days.includes(dt.getUTCDay())) continue;
    const t = zonedToUtc(y, m, d, +hh, +mm, tz);
    if (t > from) return t;
  }
  return null;
}

module.exports = { normalizeSchedule, nextRun, isValidTz, zonedToUtc, localParts };
