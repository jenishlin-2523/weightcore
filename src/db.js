'use strict';
/*
 * db.js — Offline-first local store (pure JS, JSON-file backed).
 *
 * No native module / compiler required (better-sqlite3 needs node-gyp + Visual
 * Studio, which is fragile on bleeding-edge Windows). This keeps the exact same
 * interface main.js/sync.js expect: upsert/get/list, an outbox that sync.js
 * drains, applyRemote for inbound changes, and meta for the pull cursor.
 *
 * Rows are keyed by UUID with an updated_at stamp, so two lanes never collide
 * and conflicts resolve last-writer-wins. Writes persist atomically (temp +
 * rename). For weighbridge volumes (thousands of tickets) this is plenty; swap
 * in sql.js/SQLite later if you want SQL queries without changing callers.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

class Store {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'weighcore.json');
    this.data = { transactions: {}, weighments: {}, images: {}, vehicles: {}, outbox: [], seq: 0, meta: {} };
    try { if (fs.existsSync(this.file)) Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (_) {}
  }

  _persist() {
    try { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); } catch (_) {}
  }
  _table(entity) { if (!this.data[entity]) this.data[entity] = {}; return this.data[entity]; }
  _queue(entity, id, op, payload) {
    this.data.outbox.push({ seq: ++this.data.seq, entity, entity_id: id, op, payload, created_at: now(), sent: 0 });
  }

  upsert(entity, row) {
    row.id = row.id || uuid();
    row.updated_at = now();
    const t = this._table(entity);
    t[row.id] = Object.assign(t[row.id] || {}, row);
    this._queue(entity, row.id, 'upsert', t[row.id]);
    this._persist();
    return row.id;
  }

  get(entity, id) { return this._table(entity)[id] || null; }
  list(entity, limit) {
    return Object.values(this._table(entity))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .slice(0, limit || 200);
  }
  pendingOutbox(limit) {
    return this.data.outbox.filter((o) => !o.sent).slice(0, limit || 200)
      .map((o) => ({ seq: o.seq, entity: o.entity, entity_id: o.entity_id, op: o.op, payload: JSON.stringify(o.payload) }));
  }
  markSent(seqs) { const s = new Set(seqs); this.data.outbox.forEach((o) => { if (s.has(o.seq)) o.sent = 1; }); this._persist(); }
  pendingImages() { return Object.values(this._table('images')).filter((i) => !i.uploaded).slice(0, 50); }
  markImageUploaded(id) { const i = this._table('images')[id]; if (i) { i.uploaded = 1; this._persist(); } }
  applyRemote(entity, row) {
    const cur = this.get(entity, row.id);
    if (cur && cur.updated_at && row.updated_at && cur.updated_at >= row.updated_at) return false;
    this._table(entity)[row.id] = row; this._persist(); return true;
  }
  getMeta(k) { return this.data.meta[k] != null ? this.data.meta[k] : null; }
  setMeta(k, v) { this.data.meta[k] = String(v); this._persist(); }
}

module.exports = { Store, uuid, now };
