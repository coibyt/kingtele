'use strict';
const { sendPost, sleep } = require('./telegram');
const { nextRun } = require('./schedule');

const TICK_MS = 15000;
const STALE_MS = 10 * 60000; // lịch lặp bị bỏ lỡ quá 10 phút (server tắt) sẽ bỏ qua lượt đó
const OUT_OF_POINTS = 'Hết Điểm King. Hãy điểm danh hoặc giới thiệu bạn bè để nhận thêm điểm.';

/**
 * getToken(userId): token bot của chủ bài đăng.
 * isActive(userId): false nếu thành viên đã bị khoá/xoá (bài của họ bị bỏ qua).
 * points: { has(userId), spend(userId), afterSend(userId) } - mỗi lượt gửi thành công trừ Điểm King.
 */
function createScheduler({ store, getToken, isActive = () => true, uploadsDir, points }) {
  const running = new Set();
  let timer = null;
  const pts = points || { has: () => true, spend: () => true, afterSend: () => {} };

  /** Gửi bài tới các nhóm của nó. Trả về kết quả từng nhóm. */
  async function runPost(post, trigger) {
    const token = getToken(post.userId);
    const results = [];
    const groups = post.groupIds
      .map((id) => store.data.groups.find((g) => g.id === id && g.userId === post.userId)).filter(Boolean);
    const base = { userId: post.userId, postId: post.id, postTitle: post.title, trigger };
    let outOfPoints = false;
    for (const g of groups) {
      if (outOfPoints || !pts.has(post.userId)) {
        if (!outOfPoints) {
          outOfPoints = true;
          store.addLog({ ...base, status: 'error', error: OUT_OF_POINTS });
        }
        results.push({ groupId: g.id, ok: false, error: OUT_OF_POINTS });
        post.failCount = (post.failCount || 0) + 1;
        continue;
      }
      try {
        const messageId = await sendPost(token, g.chatId, post, { uploadsDir });
        pts.spend(post.userId);
        pts.afterSend(post.userId);
        results.push({ groupId: g.id, ok: true });
        store.addLog({ ...base, groupId: g.id, groupTitle: g.title, status: 'ok', messageId });
        post.sentCount = (post.sentCount || 0) + 1;
      } catch (e) {
        results.push({ groupId: g.id, ok: false, error: e.message });
        store.addLog({ ...base, groupId: g.id, groupTitle: g.title, status: 'error', error: e.message });
        post.failCount = (post.failCount || 0) + 1;
      }
      await sleep(400); // tránh chạm giới hạn tốc độ của Telegram
    }
    if (!groups.length) {
      store.addLog({ ...base, status: 'error', error: 'Bài đăng không còn nhóm nào' });
      post.failCount = (post.failCount || 0) + 1;
    }
    post.lastRunAt = Date.now();
    return results;
  }

  async function tick() {
    const now = Date.now();
    const due = store.data.posts.filter((p) => p.status === 'active' && p.nextRunAt && p.nextRunAt <= now && !running.has(p.id) && isActive(p.userId));
    for (const post of due) {
      running.add(post.id);
      try {
        const stale = post.schedule.type !== 'once' && now - post.nextRunAt > STALE_MS;
        if (!stale) await runPost(post, 'schedule');
        const next = nextRun(post.schedule, post.timezone, Date.now());
        post.nextRunAt = next;
        if (!next) post.status = 'done';
      } catch (e) {
        console.error('[scheduler]', e);
      } finally {
        running.delete(post.id);
        await store.save();
      }
    }
  }

  return {
    runPost,
    isRunning: (id) => running.has(id),
    start() { if (!timer) { timer = setInterval(() => tick().catch(console.error), TICK_MS); tick().catch(console.error); } },
    stop() { clearInterval(timer); timer = null; },
    tick,
  };
}

module.exports = { createScheduler };
