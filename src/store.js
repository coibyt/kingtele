'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = () => ({
  version: 1,
  settings: { botToken: '', timezone: '', sessionSecret: crypto.randomBytes(32).toString('hex') },
  groups: [],
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
    this._write();
    return this;
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
    if (this.data.logs.length > 2000) this.data.logs.length = 2000;
  }
}

module.exports = { Store };
