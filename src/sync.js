'use strict';
/*
 * sync.js — Hybrid VPS sync (offline-first).
 *
 * The app runs fully offline against local SQLite. This engine, on a timer,
 * checks whether the VPS is reachable and, if so:
 *   1. PUSH  — drains the local outbox to POST {baseUrl}/sync/push
 *   2. PULL  — GETs {baseUrl}/sync/pull?since=<cursor> and applies remote rows
 *   3. IMAGES— uploads pending JPEGs to {baseUrl}/images
 * If the VPS is unreachable it simply does nothing and tries again next tick —
 * the operator never notices, and both lanes converge once the link returns.
 *
 * Transport is plain HTTPS + a device API key header. No third-party deps.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');

function jsonRequest(method, urlStr, apiKey, bodyObj, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Key': apiKey,
        ...(body ? { 'Content-Length': body.length } : {})
      },
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) {}
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function uploadImage(baseUrl, apiKey, meta, filePath, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl.replace(/\/$/, '') + '/images');
    const lib = u.protocol === 'https:' ? https : http;
    const boundary = '----wc' + Date.now().toString(16);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${meta.id}.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`, 'utf8');
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    let file; try { file = fs.readFileSync(filePath); } catch (e) { return reject(e); }
    const payload = Buffer.concat([head, file, tail]);
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Device-Key': apiKey, 'Content-Length': payload.length },
      timeout
    }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

class SyncEngine {
  constructor(store, cfg, log) {
    this.store = store;
    this.cfg = cfg;            // config.sync
    this.log = log || (() => {});
    this.timer = null;
    this.online = false;
    this.busy = false;
    this.onState = null;      // callback(state)
  }

  start() {
    if (!this.cfg.enabled) { this.log('sync disabled'); return; }
    const tick = () => this._tick().catch((e) => this.log('sync error: ' + e.message));
    this.timer = setInterval(tick, (this.cfg.intervalSec || 20) * 1000);
    tick();
  }
  stop() { clearInterval(this.timer); }

  _setOnline(v, detail) {
    if (v !== this.online) { this.online = v; if (this.onState) this.onState({ online: v, detail }); }
  }

  async _tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const base = (this.cfg.baseUrl || '').replace(/\/$/, '');
      if (!base || base.includes('YOUR-VPS-HOST')) { this._setOnline(false, 'not configured'); return; }

      // reachability
      let health;
      try { health = await jsonRequest('GET', base + '/health', this.cfg.apiKey, null, 6000); }
      catch (_) { this._setOnline(false, 'offline'); return; }
      if (!health || health.status !== 200) { this._setOnline(false, 'server ' + (health && health.status)); return; }
      this._setOnline(true, 'online');

      // 1) PUSH outbox
      const pending = this.store.pendingOutbox(200);
      if (pending.length) {
        const res = await jsonRequest('POST', base + '/sync/push', this.cfg.apiKey,
          { changes: pending.map((r) => ({ seq: r.seq, entity: r.entity, id: r.entity_id, op: r.op, payload: JSON.parse(r.payload) })) });
        if (res.status === 200) { this.store.markSent(pending.map((r) => r.seq)); this.log(`pushed ${pending.length}`); }
      }

      // 2) PULL remote changes
      const cursor = this.store.getMeta('pull_cursor') || '1970-01-01T00:00:00.000Z';
      const pull = await jsonRequest('GET', base + '/sync/pull?since=' + encodeURIComponent(cursor), this.cfg.apiKey);
      if (pull.status === 200 && pull.data && Array.isArray(pull.data.changes)) {
        let applied = 0;
        for (const ch of pull.data.changes) { if (this.store.applyRemote(ch.entity, ch.payload)) applied++; }
        if (pull.data.cursor) this.store.setMeta('pull_cursor', pull.data.cursor);
        if (applied) this.log(`pulled ${applied}`);
      }

      // 3) IMAGES
      if (this.cfg.uploadImages) {
        for (const img of this.store.pendingImages()) {
          try {
            const r = await uploadImage(base, this.cfg.apiKey, { id: img.id, txn_id: img.txn_id, camera_id: img.camera_id, seq: img.seq }, img.file);
            if (r.status === 200 || r.status === 201) this.store.markImageUploaded(img.id);
          } catch (e) { this.log('image upload failed: ' + e.message); break; }
        }
      }
    } finally { this.busy = false; }
  }
}

module.exports = { SyncEngine };
