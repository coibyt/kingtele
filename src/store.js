'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = () => ({
  version: 2,
  settings: { botToken: '', timezone: '', sessionSecret: crypto.randomBytes(32).toString('hex') },
  users: [],
  uploads: {},
  pointLog: [],
  pwa: { devices: {} },
  traffic: { days: {} },
  groups: [],
  fbGroups: [],
  fbTasks: [],
  fbDue: [],
  zaloContacts: [],
  modQueue: [],
  posts: [],
  logs: [],
});

/** Kho dữ liệu JSON, ghi nguyên tử (tmp + rename), tuần tự hoá các lần ghi. */
class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.data = DEFAULTS();
    this._chain = Promise.resolve();
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const d = DEFAULTS();
        this.data = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
      } catch (e) {
        const bak = `${this.file}.corrupt-${Date.now()}`;
        fs.copyFileSync(this.file, bak);
        console.error(`[store] db.json hỏng, đã sao lưu sang ${bak}`);
      }
    }
    this._migrate();
    this._write();
    return this;
  }

  /** Dữ liệu từ bản một-người-dùng thuộc về tài khoản admin. */
  _migrate() {
    const d = this.data;
    for (const list of [d.groups, d.posts, d.logs]) for (const x of list) if (!x.userId) x.userId = 'admin';
    for (const p of d.posts) {
      if (p.media && p.media.file && !d.uploads[p.media.file]) d.uploads[p.media.file] = { u: p.userId, size: p.media.size || 0 };
    }
    d.version = 2;
  }

  _write() {
    const json = JSON.stringify(this.data);
    this._chain = this._chain.then(async () => {
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, json);
      await fsp.rename(tmp, this.file);
    }).catch((e) => console.error('[store] lỗi ghi:', e.message));
    return this._chain;
  }

  save() { return this._write(); }
  flush() { return this._chain; }

  addLog(entry) {
    this.data.logs.unshift({ id: crypto.randomUUID(), at: Date.now(), ...entry });
    if (this.data.logs.length > 5000) this.data.logs.length = 5000;
  }
}

module.exports = { Store };
