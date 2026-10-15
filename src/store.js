// Archivio chiave/valore su file JSON (equivalente di chrome.storage.local).
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file, onChange) {
    this.file = file;
    this.onChange = onChange;
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { this.data = {}; }
    this.timer = null;
  }
  async get(keys) {
    if (keys == null) return JSON.parse(JSON.stringify(this.data));
    const out = {};
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) keys.forEach(k => { if (k in this.data) out[k] = clone(this.data[k]); });
    else Object.keys(keys).forEach(k => { out[k] = k in this.data ? clone(this.data[k]) : keys[k]; });
    return out;
  }
  async set(obj) {
    const ch = {};
    for (const [k, v] of Object.entries(obj)) {
      ch[k] = { oldValue: clone(this.data[k]), newValue: clone(v) };
      this.data[k] = clone(v);
    }
    this.flush();
    if (this.onChange) this.onChange(ch);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    }, 200);
  }
}
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
module.exports = { Store };
