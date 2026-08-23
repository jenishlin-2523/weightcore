'use strict';
/*
 * server.js — WeighCore VPS backend.
 * A tiny sync hub both lane terminals push to and pull from. Postgres for the
 * relational data, local disk (or swap for S3) for the JPEGs.
 *
 *   GET  /health                 -> { ok: true }
 *   POST /sync/push  {changes[]}  -> upserts rows, returns { ok, applied }
 *   GET  /sync/pull?since=<rev>   -> { changes[], cursor }
 *   POST /images  (multipart)     -> stores a JPEG, returns { ok }
 *
 * Every request must carry X-Device-Key matching a row in `devices`.
 */
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 4000;
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://weighcore:weighcore@localhost:5432/weighcore' });

const SYNC_TABLES = new Set(['transactions', 'weighments', 'vehicles']);
const COLUMNS = {
  transactions: ['id','ticket_no','site_code','scale_id','vehicle_no','party','material','gross','tare','net','status','mode','created_by','created_at','updated_at'],
  weighments:   ['id','txn_id','seq','weight','kind','manual','captured_at','updated_at'],
  vehicles:     ['id','vehicle_no','tare','active','updated_at']
};

const app = express();
app.use(express.json({ limit: '2mb' }));

// device auth
app.use(async (req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.get('X-Device-Key');
  if (!key) return res.status(401).json({ error: 'missing device key' });
  try {
    const r = await pool.query('SELECT scale_id FROM devices WHERE key=$1', [key]);
    if (!r.rowCount) return res.status(403).json({ error: 'unknown device' });
    req.device = r.rows[0];
    pool.query('UPDATE devices SET last_seen=now() WHERE key=$1', [key]).catch(() => {});
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// upsert a batch of client changes
app.post('/sync/push', async (req, res) => {
  const changes = (req.body && req.body.changes) || [];
  let applied = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const ch of changes) {
      if (!SYNC_TABLES.has(ch.entity)) continue;
      const cols = COLUMNS[ch.entity];
      const row = ch.payload || {};
      const vals = cols.map((c) => (row[c] === undefined ? null : row[c]));
      const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
      const setList = cols.filter((c) => c !== 'id').map((c) => `${c}=EXCLUDED.${c}`).join(',');
      // last-writer-wins on updated_at; bump rev on every accepted write
      await client.query(
        `INSERT INTO ${ch.entity}(${cols.join(',')}, rev) VALUES(${ph}, nextval('rev_seq'))
         ON CONFLICT (id) DO UPDATE SET ${setList}, rev=nextval('rev_seq')
         WHERE ${ch.entity}.updated_at IS NULL OR EXCLUDED.updated_at >= ${ch.entity}.updated_at`,
        vals
      );
      applied++;
    }
    await client.query('COMMIT');
    res.json({ ok: true, applied });
  } catch (e) { await client.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

// return everything changed since a rev cursor
app.get('/sync/pull', async (req, res) => {
  const sinceRaw = req.query.since;
  const since = /^\d+$/.test(String(sinceRaw)) ? BigInt(sinceRaw) : 0n;
  try {
    const changes = [];
    let maxRev = since;
    for (const entity of SYNC_TABLES) {
      const r = await pool.query(`SELECT * FROM ${entity} WHERE rev > $1 ORDER BY rev LIMIT 500`, [since.toString()]);
      for (const row of r.rows) {
        const rev = BigInt(row.rev);
        if (rev > maxRev) maxRev = rev;
        delete row.rev;
        changes.push({ entity, id: row.id, op: 'upsert', payload: row });
      }
    }
    res.json({ ok: true, changes, cursor: maxRev.toString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// image upload
const upload = multer({ storage: multer.diskStorage({
  destination: (_r, _f, cb) => cb(null, IMAGES_DIR),
  filename: (req, _f, cb) => {
    let meta = {}; try { meta = JSON.parse(req.body.meta || '{}'); } catch (_) {}
    cb(null, (meta.id || Date.now()) + '.jpg');
  }
}) });
app.post('/images', upload.single('file'), async (req, res) => {
  let meta = {}; try { meta = JSON.parse(req.body.meta || '{}'); } catch (_) {}
  try {
    await pool.query(
      `INSERT INTO images(id, txn_id, camera_id, seq, file) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET file=EXCLUDED.file`,
      [meta.id, meta.txn_id || null, meta.camera_id || null, meta.seq || 0, req.file ? req.file.path : null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`WeighCore sync server on :${PORT}`));
