'use strict';
// Zalo: công cụ hỗ trợ thủ công. Zalo không có API cho tài khoản cá nhân và cấm tự động hoá tài khoản,
// nên KingTele chỉ quản lý danh sách + lời chào soạn sẵn; người dùng tự mở Zalo và tự bấm gửi.
// Không lưu mật khẩu/phiên Zalo, không gửi tin nào thay người dùng.
const express = require('express');
const crypto = require('crypto');

const MAX_CONTACTS = 500;
const STATUSES = ['todo', 'invited', 'friend', 'skip'];

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Chuẩn hoá số điện thoại: bỏ ký tự phân cách, +84/84 → 0. Trả '' nếu không hợp lệ. */
function normalizePhone(raw) {
  let s = String(raw || '').replace(/[\s.\-()]/g, '');
  if (/^\+?84\d{9}$/.test(s)) s = `0${s.replace(/^\+?84/, '')}`;
  return /^\d{9,15}$/.test(s) ? s : '';
}

/** Mỗi dòng: tên và số cách nhau bằng dấu phẩy, chấm phẩy hoặc tab; hoặc chỉ có số. Trả {rows, skipped}. */
function parseBulk(text) {
  const rows = []; let skipped = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[,;\t]/).map((x) => x.trim()).filter(Boolean);
    const phone = normalizePhone(parts.length > 1 ? parts[parts.length - 1] : parts[0]);
    if (!phone) { skipped++; continue; }
    rows.push({ name: parts.length > 1 ? parts.slice(0, -1).join(' ').slice(0, 100) : '', phone });
  }
  return { rows, skipped };
}

function createZalo({ store }) {
  const d = () => store.data;
  const prefsOf = (id) => (id === 'admin' ? d().settings : d().users.find((u) => u.id === id) || {});

  function router() {
    const r = express.Router();
    const uid = (req) => req.user.id;
    const mine = (req) => d().zaloContacts.filter((c) => c.userId === uid(req));

    r.get('/contacts', (req, res) => res.json(mine(req)));

    r.post('/contacts', wrap(async (req, res) => {
      const b = req.body || {};
      const list = mine(req);
      let rows;
      let skipped = 0;
      if (typeof b.bulk === 'string') ({ rows, skipped } = parseBulk(b.bulk));
      else {
        const phone = normalizePhone(b.phone);
        if (!phone) throw bad('Số điện thoại không hợp lệ');
        rows = [{ name: str(b.name, 100), phone }];
      }
      const have = new Set(list.map((c) => c.phone));
      const fresh = [];
      for (const x of rows) { if (have.has(x.phone)) { skipped++; continue; } have.add(x.phone); fresh.push(x); }
      if (!fresh.length) throw bad(skipped ? 'Không có số mới để thêm (trùng hoặc không hợp lệ)' : 'Nhập ít nhất một số điện thoại');
      if (list.length + fresh.length > MAX_CONTACTS) throw bad(`Tối đa ${MAX_CONTACTS} người trong danh sách`);
      const now = Date.now();
      for (const x of fresh) d().zaloContacts.push({ id: crypto.randomUUID(), userId: uid(req), name: x.name, phone: x.phone, note: '', status: 'todo', sentAt: null, createdAt: now });
      await store.save();
      res.status(201).json({ added: fresh.length, skipped });
    }));

    r.put('/contacts/:id', wrap(async (req, res) => {
      const c = mine(req).find((x) => x.id === req.params.id);
      if (!c) return res.status(404).json({ error: 'Không tìm thấy' });
      const b = req.body || {};
      if (b.status !== undefined) {
        if (!STATUSES.includes(b.status)) throw bad('Trạng thái không hợp lệ');
        if (b.status === 'invited' && c.status !== 'invited') c.sentAt = Date.now();
        c.status = b.status;
      }
      if (b.name !== undefined) c.name = str(b.name, 100);
      if (b.note !== undefined) c.note = str(b.note, 300);
      await store.save();
      res.json(c);
    }));

    r.delete('/contacts/:id', wrap(async (req, res) => {
      const c = mine(req).find((x) => x.id === req.params.id);
      if (!c) return res.status(404).json({ error: 'Không tìm thấy' });
      d().zaloContacts.splice(d().zaloContacts.indexOf(c), 1);
      await store.save();
      res.json({ ok: true });
    }));

    r.get('/template', (req, res) => res.json({ text: prefsOf(uid(req)).zaloTemplate || '' }));
    r.put('/template', wrap(async (req, res) => {
      const text = typeof (req.body && req.body.text) === 'string' ? req.body.text.trim() : '';
      if (text.length > 500) throw bad('Lời chào tối đa 500 ký tự');
      prefsOf(uid(req)).zaloTemplate = text;
      await store.save();
      res.json({ ok: true });
    }));
    return r;
  }

  return { router };
}

module.exports = { createZalo, normalizePhone, parseBulk };
