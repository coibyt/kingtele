'use strict';
const crypto = require('crypto');

const LEDGER_MAX = 20000;
const mask = (name) => `${(String(name).trim()[0] || '?').toUpperCase()}***`;

/**
 * Điểm King: mỗi lượt gửi thành công tới một nhóm trừ `perSend` điểm.
 * Tài khoản admin (id 'admin') không bị trừ điểm.
 */
function createPoints({ store, config }) {
  const P = config.points;
  const users = () => store.data.users;
  // Quản trị viên (tài khoản chính hoặc thành viên được cấp quyền) không bị trừ điểm.
  const userOf = (id) => { const u = id === 'admin' ? null : users().find((x) => x.id === id); return u && !u.isAdmin ? u : null; };

  function genCode() {
    for (;;) {
      const c = crypto.randomBytes(5).toString('hex').slice(0, 8).toUpperCase();
      if (!users().some((u) => u.refCode === c)) return c;
    }
  }

  function ledger(user, delta, reason, note = '') {
    store.data.pointLog.unshift({ id: crypto.randomUUID(), userId: user.id, at: Date.now(), delta, reason, note, balance: user.points });
    if (store.data.pointLog.length > LEDGER_MAX) store.data.pointLog.length = LEDGER_MAX;
  }

  function credit(user, amount, reason, note) {
    user.points += amount;
    ledger(user, amount, reason, note);
  }

  function touchIp(user, ip) {
    if (!ip) return;
    user.ips = user.ips || [];
    if (!user.ips.includes(ip)) { user.ips.unshift(ip); user.ips.length = Math.min(user.ips.length, 10); }
  }

  /** Thiết lập điểm / mã giới thiệu cho thành viên mới. */
  function initUser(user, { ip, ref }) {
    user.points = 0; user.spent = 0; user.lastCheckin = '';
    user.refCode = genCode();
    user.regIp = ip || ''; user.ips = [];
    touchIp(user, ip);
    const code = String(ref || '').trim().toUpperCase();
    const referrer = code ? users().find((u) => u.refCode === code && !u.disabled && !u.isAdmin) : null;
    if (referrer) user.referredBy = referrer.id;
    credit(user, P.signup, 'signup', 'Quà tặng đăng ký');
  }

  /** Thành viên cũ (trước khi có điểm) nhận quà đăng ký + mã giới thiệu. */
  function migrate() {
    let changed = false;
    for (const u of users()) {
      if (typeof u.points === 'number') continue;
      u.points = 0; u.spent = 0; u.lastCheckin = ''; u.refCode = u.refCode || genCode(); u.regIp = u.regIp || ''; u.ips = u.ips || [];
      credit(u, P.signup, 'signup', 'Quà tặng thành viên');
      changed = true;
    }
    return changed;
  }

  const balanceOf = (id) => { const u = userOf(id); return u ? u.points : null; };
  const has = (id) => { const u = userOf(id); return !u || u.points >= P.perSend; };

  function spend(id) {
    const u = userOf(id);
    if (!u) return true;
    if (u.points < P.perSend) return false;
    u.points -= P.perSend; u.spent = (u.spent || 0) + P.perSend;
    return true;
  }

  /**
   * Gọi sau khi thành viên gửi thành công một bài: nếu họ được giới thiệu và đây là lần đầu
   * chạy thành công, thưởng cho cả hai bên - trừ khi hai bên có chung IP.
   */
  function afterSend(id) {
    const u = userOf(id);
    if (!u || !u.referredBy || u.referral) return;
    const ref = userOf(u.referredBy);
    const decide = (status, reason) => { u.referral = { status, reason, at: Date.now() }; };
    if (!ref || ref.disabled) return decide('rejected', 'referrer_unavailable');
    const mine = new Set([u.regIp, ...(u.ips || [])].filter(Boolean));
    const theirs = new Set([ref.regIp, ...(ref.ips || [])].filter(Boolean));
    if (!mine.size || !theirs.size || [...mine].some((ip) => theirs.has(ip))) return decide('rejected', 'same_ip');
    const used = new Set(users().filter((x) => x.referredBy === ref.id && x.referral && x.referral.status === 'rewarded').map((x) => x.regIp));
    if (used.has(u.regIp)) return decide('rejected', 'duplicate_ip');
    credit(ref, P.referrer, 'referral_bonus', `Bạn bè ${mask(u.name)} đã chạy bài thành công`);
    credit(u, P.referee, 'referred_bonus', 'Thưởng nhờ được giới thiệu');
    decide('rewarded', '');
  }

  function checkin(user, tz) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    if (user.lastCheckin === today) return { ok: false, today };
    user.lastCheckin = today;
    credit(user, P.checkin, 'checkin', `Điểm danh ${today}`);
    return { ok: true, today, amount: P.checkin };
  }

  function grant(user, amount, note) {
    user.points = Math.max(0, user.points + amount);
    ledger(user, amount, 'admin', note || 'Quản trị viên điều chỉnh');
  }

  /** Dữ liệu cho trang Điểm King của một thành viên. */
  function summary(user, tz) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const refs = users().filter((x) => x.referredBy === user.id);
    const log = store.data.pointLog.filter((l) => l.userId === user.id);
    return {
      balance: user.points, spent: user.spent || 0, refCode: user.refCode,
      checkedInToday: user.lastCheckin === today,
      rules: { signup: P.signup, checkin: P.checkin, referrer: P.referrer, referee: P.referee, perSend: P.perSend },
      referrals: refs.map((x) => ({ name: mask(x.name), joinedAt: x.createdAt, status: x.referral ? x.referral.status : 'pending', reason: x.referral ? x.referral.reason : '' }))
        .sort((a, b) => b.joinedAt - a.joinedAt),
      referralEarned: log.filter((l) => l.reason === 'referral_bonus').reduce((n, l) => n + l.delta, 0),
      history: log.slice(0, 30).map(({ at, delta, reason, note, balance }) => ({ at, delta, reason, note, balance })),
    };
  }

  return { initUser, migrate, touchIp, balanceOf, has, spend, afterSend, checkin, grant, summary, userOf };
}

module.exports = { createPoints };
