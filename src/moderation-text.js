'use strict';
// Văn bản bot gửi trong Telegram cho tính năng Duyệt bài (tiếng Việt, không đi qua hệ thống dịch của giao diện web).
module.exports = {
  approveBtn: '✅ Duyệt',
  rejectBtn: '❌ Từ chối',
  held: (author, group) => `🕓 ${author} · ${group}`,
  notice: (author) => `⏳ Tin nhắn của ${author} đang chờ admin duyệt.`,
  published: (author) => `↑ Bài của ${author}, đã được admin duyệt`,
  enabled: (group) => `✅ KingTele: đã bật duyệt bài cho nhóm ${group}. Bài chờ duyệt sẽ gửi vào đây.`,
  cantDelete: (group) => `⚠️ KingTele: không xoá được tin trong nhóm ${group}, nên tin chưa bị chặn. Hãy đặt bot làm quản trị viên và cấp quyền xoá tin nhắn.`,
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  handled: 'Bài này đã được xử lý',
};
