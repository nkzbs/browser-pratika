// Archivio chiave/valore (equivalente di chrome.storage.<area>): su file JSON, oppure solo in memoria se file è null.
const fs = require('fs');
const path = require('path');

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

class Store {
  constructor(file, onChange) {
    this.file = file;
    this.onChange = onChange;
    this.data = {};
    this.timer = null;
    if (file) { try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* primo avvio */ } }
  }
  async get(keys) {
    if (keys == null) return clone(this.data);
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
    this.changed(ch);
  }
  async remove(keys) {
    const ch = {};
    for (const k of [].concat(keys)) { if (k in this.data) { ch[k] = { oldValue: clone(this.data[k]) }; delete this.data[k]; } }
    this.changed(ch);
  }
  async clear() { await this.remove(Object.keys(this.data)); }
  changed(ch) {
    if (!Object.keys(ch).length) return;
    this.flush();
    if (this.onChange) this.onChange(ch);
  }
  flush() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.writeNow(), 200);
  }
  writeNow() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}
module.exports = { Store };
