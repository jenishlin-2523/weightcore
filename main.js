'use strict';
/*
 * main.js — WeighCore desktop (Electron main process).
 * Owns all hardware/IO: the weight edge agent, IP-camera capture, the local
 * SQLite store and the VPS sync engine. The renderer (your WeighCore UI) talks
 * to these only through preload's window.weighcore API.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
function psExe() { return process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe'; }

const { EdgeAgent } = require('./src/edge');
const camera = require('./src/camera');
const { Store, uuid, now } = require('./src/db');
const { SyncEngine } = require('./src/sync');
const { VpsSync } = require('./src/vpssync');
const sqldb = require('./src/sqldb');

// ---- config + storage paths ----
// Dev: config.json sits beside the source. Packaged: it must live in a writable
// machine-wide location (Program Files is read-only for the operator), seeded
// from the bundled template so a fresh install boots into the Setup wizard.
const configDir = app.isPackaged ? path.join(process.env.ProgramData || app.getPath('userData'), 'WeighCore') : __dirname;
const configPath = path.join(configDir, 'config.json');
const templatePath = path.join(__dirname, 'config.example.json');
try { fs.mkdirSync(configDir, { recursive: true }); } catch (_) {}
try { if (!fs.existsSync(configPath) && fs.existsSync(templatePath)) fs.copyFileSync(templatePath, configPath); } catch (_) {}
function loadConfig() { try { return JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; } }
let cfg = loadConfig() || {};
// The first-run Setup wizard runs until config.setup.complete === true and a scaleId is chosen.
function needsSetup() { return !cfg.setup || cfg.setup.complete !== true || !(cfg.site && cfg.site.scaleId); }
function saveConfig(next) { cfg = next; fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8'); }
const dataDir   = (cfg.storage && cfg.storage.dataDir)   || path.join(app.getPath('userData'), 'data');
const imagesDir = (cfg.storage && cfg.storage.imagesDir) || path.join(app.getPath('userData'), 'images');
fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

// The bundled forwarding-only tunnel key, copied to a writable, permission-locked
// path the Windows SSH client will accept (it refuses world-readable key files).
function ensureTunnelKey() {
  try {
    const bundled = path.join(__dirname, 'keys', 'wctunnel_key');
    if (!fs.existsSync(bundled)) return '';
    const dst = path.join(configDir, 'wctunnel_key');
    try { if (!fs.existsSync(dst)) fs.copyFileSync(bundled, dst); } catch (_) {}
    // Harden the key's ACLs in the BACKGROUND with a timeout. icacls can be
    // held for minutes by antivirus (K7 on this site) when spawned by a
    // freshly installed unsigned exe — a synchronous wait here froze the
    // whole app boot before the window ever appeared.
    try {
      const u = process.env.USERNAME || '';
      const child = require('child_process').execFile('icacls', [dst, '/inheritance:r', '/grant:r', u + ':F'], { windowsHide: true, timeout: 8000 }, () => {});
      child.on('error', () => {});
      if (child.unref) child.unref();
    } catch (_) {}
    return dst;
  } catch (_) { return ''; }
}
const tunnelKeyPath = ensureTunnelKey();

let win, edge, store, sync, vpssync, liveSnapshot = null, lastWeight = { value: 0, unit: 'kg', stable: false };

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(path.join(dataDir, 'weighcore.log'), line); } catch (_) {}
}

// guarded send — never throws if the window is closing/destroyed
function send(channel, payload) {
  try { if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) win.webContents.send(channel, payload); } catch (_) {}
}

function createWindow(page) {
  page = page || 'index.html';
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1400, height: 900, minWidth: 1024, minHeight: 680,
      backgroundColor: '#0f1319',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false            // preload needs Node; renderer stays isolated
      }
    });
    win.removeMenu();
    win.webContents.on('render-process-gone', (_e, d) => logLine('renderer gone: ' + JSON.stringify(d)));
    // renderer JS errors land in weighcore.log so field crashes are diagnosable
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 3) logLine('renderer error: ' + message + ' (' + String(sourceId).split(/[\\/]/).pop() + ':' + line + ')');
    });
    // inject the bridge into the main UI (not the setup page)
    win.webContents.on('did-finish-load', () => {
      if (!/index\.html$/.test(win.webContents.getURL())) return;
      try {
        const bridge = fs.readFileSync(path.join(__dirname, 'renderer', 'weighcore-bridge.js'), 'utf8');
        win.webContents.executeJavaScript(bridge).catch(() => {});
      } catch (_) {}
    });
  }
  win.loadFile(path.join(__dirname, 'renderer', page));
}

// ---------------------------------------------------------------- edge
function startEdge() {
  edge = new EdgeAgent(cfg.edge);
  edge.on('weight', (d) => { lastWeight = d; send('edge:weight', d); });
  edge.on('status', (d) => { logLine('edge ' + d.state + ' ' + d.detail); send('edge:status', d); });
  edge.on('raw',    (d) => { send('edge:raw', d); });
  edge.start();
}

// ---------------------------------------------------------------- ipc
function registerIpc() {
  // weight
  ipcMain.handle('edge:get', () => lastWeight);
  ipcMain.handle('edge:control', (_e, action) => {
    if (action === 'stop') edge.stop();
    else if (action === 'reconnect') { edge.stop(); startEdge(); }
    else if (action === 'start') edge.start();
    return { ok: true };
  });
  ipcMain.handle('edge:ports', async () => {
    try { const { listPorts } = require('./src/serial-win'); return await listPorts(); }
    catch (e) { return []; }
  });

  // cameras
  const camHost = (c) => c.host || ((String(c.url || '').match(/\/\/(?:[^@/]*@)?([^:/]+)/) || [])[1] || '');
  ipcMain.handle('camera:list', () => cfg.cameras.map((c) => ({ id: c.id, label: c.label, host: camHost(c), stream: camera.liveUrl(c.id) })));
  ipcMain.handle('camera:probe', async () => {
    const out = [];
    for (const c of cfg.cameras) out.push({ id: c.id, ...(await camera.probe(c)) });
    return out;
  });
  ipcMain.handle('camera:capture', async (_e, cameraId) => {
    const cam = cfg.cameras.find((c) => c.id === cameraId) || cfg.cameras[0];
    if (!cam) return { ok: false, error: 'no camera configured' };
    const r = await camera.capture(cam);
    return r.ok ? { ok: true, dataUrl: r.dataUrl } : r;
  });
  // capture ALL cameras for a ticket, persist to disk + db (the weighbridge pattern)
  ipcMain.handle('camera:captureForTxn', async (_e, opts) => {
    opts = opts || {};
    const rid = opts.rid || opts.txnId || null;              // stable transaction id (GUID)
    const folder = rid || ('T' + (opts.ticketNo || 'loose'));
    const scaleId = (cfg.site && cfg.site.scaleId) || '';
    const results = [];
    for (const cam of cfg.cameras) {
      const r = await camera.capture(cam);
      if (r.ok) {
        const id = uuid();
        const abs = path.join(imagesDir, folder, `${id}.jpg`);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, r.jpeg);
        if (store) store.upsert('images', { id, txn_id: folder, camera_id: cam.id, seq: opts.seq || 0, file: abs, uploaded: 0, created_at: now() });
        // also persist into local SQL so the photo reaches the ERP portal via sync
        if (cfg.db && cfg.db.enabled && rid) {
          try { await sqldb.saveImage(cfg.db, { scaleId, rid, ticketNo: opts.ticketNo, cameraId: cam.id, seq: opts.seq || 0, kind: opts.kind || '', file: abs }); }
          catch (_) {}
        }
        results.push({ ok: true, cameraId: cam.id, id, dataUrl: r.dataUrl, file: abs });
      } else {
        results.push({ ok: false, cameraId: cam.id, error: r.error });
      }
    }
    return { ok: results.some((x) => x.ok), results };
  });

  // Capture photos for one saved ticket, read back from disk on demand.
  // The SQL snapshot deliberately carries no image bytes (it would balloon), so
  // a recalled ticket showed an empty gallery even though its JPEGs were on
  // disk and in the ERP. Keyed by the ticket's rid, which is also the folder
  // name used when the frames were written.
  ipcMain.handle('images:forTxn', (_e, rid) => {
    try {
      if (!rid || !store) return { ok: true, images: [] };
      const key = String(rid);
      const images = [];
      for (const r of store.list('images', 20000)) {
        if (String(r.txn_id) !== key) continue;
        try {
          if (!r.file || !fs.existsSync(r.file)) continue;
          const b = fs.readFileSync(r.file);
          if (!b || !b.length) continue;
          images.push({
            id: r.id, cameraId: r.camera_id || '', seq: Number(r.seq) || 0,
            at: r.created_at || null,
            dataUrl: 'data:image/jpeg;base64,' + b.toString('base64')
          });
        } catch (_) {}
      }
      images.sort((a, b) => (a.seq - b.seq) || String(a.cameraId).localeCompare(String(b.cameraId)));
      return { ok: true, images };
    } catch (e) { return { ok: false, error: e.message, images: [] }; }
  });

  // db
  ipcMain.handle('db:upsert', (_e, { entity, row }) => { try { return { ok: true, id: store.upsert(entity, row) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('db:list',   (_e, { entity, limit }) => { try { return { ok: true, rows: store.list(entity, limit) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('db:get',    (_e, { entity, id }) => { try { return { ok: true, row: store.get(entity, id) }; } catch (e) { return { ok: false, error: e.message }; } });

  // sync / diagnostics
  ipcMain.handle('sync:now', async () => { if (vpssync) vpssync.tick(); if (sync) await sync._tick(); return { ok: true, online: vpssync ? vpssync.online : (sync ? sync.online : false) }; });
  ipcMain.handle('diag', () => ({
    edge: cfg.edge.connection, lastWeight, cameras: cfg.cameras.map((c) => ({ id: c.id, host: c.host })),
    online: vpssync ? vpssync.online : (sync ? sync.online : false), dataDir, imagesDir,
    dbLoaded: !!liveSnapshot, counts: liveSnapshot ? liveSnapshot._counts : null
  }));

  // live SQL data
  ipcMain.on('data:snapshot-sync', (e) => { e.returnValue = liveSnapshot; });   // instant: already loaded at startup
  ipcMain.on('site:get', (e) => { e.returnValue = (cfg && cfg.site) || null; });  // this terminal's scaleId — scopes the UI to one weighbridge
  ipcMain.on('slip:get', (e) => { e.returnValue = (cfg && cfg.slip) || null; });  // slip letterheads: { project, companies[], outDir }
  ipcMain.handle('data:refresh', async () => {
    try { liveSnapshot = await sqldb.snapshot(cfg.db); return { ok: true, counts: liveSnapshot._counts }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('data:nextTicket', async () => { try { return { ok: true, ticketNo: await sqldb.nextTicketNo(cfg.db) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('data:saveTicket', async (_e, ticket) => {
    try { const r = await sqldb.saveTicket(cfg.db, ticket); logLine('saveTicket #' + r.ticketNo + ' ok=' + r.ok); return r; }
    catch (e) { logLine('saveTicket FAILED: ' + e.message); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('data:saveVehicle', async (_e, v) => {
    try { const r = await sqldb.saveVehicle(cfg.db, v); logLine('saveVehicle ' + (v && v.no) + ' ok=' + r.ok); return r; }
    catch (e) { logLine('saveVehicle FAILED: ' + e.message); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('data:saveMaster', async (_e, m) => {
    try { const r = await sqldb.saveMaster(cfg.db, m); logLine('saveMaster ' + (m && m.entity) + '#' + ((m && m.id) || 'new') + ' ok=' + r.ok + (r.error ? ' ' + r.error : '')); return r; }
    catch (e) { logLine('saveMaster FAILED: ' + e.message); return { ok: false, error: e.message }; }
  });
  // audited weight correction on a saved ticket (writes TransactionAudit)
  ipcMain.handle('data:editTicket', async (_e, payload) => {
    try {
      const r = await sqldb.editWeights(cfg.db, payload);
      logLine('editTicket #' + ((payload && payload.ticketNo) || '?') + ' ok=' + r.ok + (r.error ? ' ' + r.error : ''));
      return r;
    } catch (e) { logLine('editTicket FAILED: ' + e.message); return { ok: false, error: e.message }; }
  });

  // Dual-letterhead slip PDFs: each entry renders in a throwaway offscreen
  // window and prints to A4. Fully fenced — a PDF failure can never touch
  // weighing. The document goes through a temp FILE (not a data: URL) because
  // Chromium caps URL length ~2MB and the slips embed base64 photographs.
  ipcMain.handle('slip:exportPdf', async (_e, payload) => {
    try {
      const ticketNo = String((payload && payload.ticketNo) || 'ticket').replace(/[^\w-]/g, '') || 'ticket';
      const entries = ((payload && payload.files) || []).filter((f) => f && f.html);
      if (!entries.length) return { ok: false, error: 'nothing to export', files: [] };
      let css = '';
      try { css = fs.readFileSync(path.join(__dirname, 'renderer', 'assets', 'css', 'weighmast-theme.css'), 'utf8'); } catch (_) {}
      const baseDir = (cfg.slip && cfg.slip.outDir) ? cfg.slip.outDir : path.join(app.getPath('userData'), 'slips');
      const dir = path.join(baseDir, ticketNo);
      fs.mkdirSync(dir, { recursive: true });
      const outFiles = [];
      for (let i = 0; i < entries.length; i++) {
        const f = entries[i];
        const slug = String(f.company || 'company').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('COPY-' + (i + 1));
        const full = '<!doctype html><html><head><meta charset="utf-8"><style>' +
          css +
          // AFTER the theme so they win: plain white page, no card chrome
          'body{margin:0;background:#fff}.lslip{border:0;border-radius:0}' +
          '</style></head><body>' + f.html + '</body></html>';
        const tmp = path.join(app.getPath('temp'), 'wc-slip-' + process.pid + '-' + Date.now() + '-' + i + '.html');
        const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } });
        try {
          fs.writeFileSync(tmp, full, 'utf8');
          await win.loadFile(tmp);
          const buf = await win.webContents.printToPDF({
            pageSize: 'A4', printBackground: true,
            margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
          });
          const out = path.join(dir, 'Ticket-' + ticketNo + '-' + slug + '.pdf');
          fs.writeFileSync(out, buf);
          outFiles.push(out);
        } finally {
          try { win.destroy(); } catch (_) {}
          try { fs.unlinkSync(tmp); } catch (_) {}
        }
      }
      logLine('slip pdf x' + outFiles.length + ' ticket #' + ticketNo + ' -> ' + dir);
      return { ok: true, files: outFiles, dir };
    } catch (e) { logLine('slip pdf FAILED: ' + e.message); return { ok: false, error: e.message, files: [] }; }
  });
  // open a folder in Explorer (used after the PDF export)
  ipcMain.handle('shell:openPath', async (_e, p) => {
    try { return await require('electron').shell.openPath(String(p || '')); } catch (e) { return e.message; }
  });

  // Legacy-format report exports to Desktop\WeighCore Reports: PDF via the
  // same offscreen print pipeline as the slips (A4 landscape — the summary
  // is ten columns wide) and Excel as an HTML .xls that Excel opens natively.
  ipcMain.handle('report:export', async (_e, p) => {
    try {
      const kind = (p && p.kind) === 'xls' ? 'xls' : 'pdf';
      const name = String((p && p.name) || 'report').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'report';
      const html = String((p && p.html) || '');
      if (!html) return { ok: false, error: 'nothing to export' };
      let css = '';
      try { css = fs.readFileSync(path.join(__dirname, 'renderer', 'assets', 'css', 'weighmast-theme.css'), 'utf8'); } catch (_) {}
      const full = '<!doctype html><html><head><meta charset="utf-8"><style>' + css +
        'body{margin:0;background:#fff}</style></head><body>' + html + '</body></html>';
      const dir = path.join(app.getPath('desktop'), 'WeighCore Reports');
      fs.mkdirSync(dir, { recursive: true });
      if (kind === 'xls') {
        const file = path.join(dir, name + '.xls');
        fs.writeFileSync(file, '﻿' + full, 'utf8');
        logLine('report xls -> ' + file);
        return { ok: true, file, dir };
      }
      const tmp = path.join(app.getPath('temp'), 'wc-report-' + process.pid + '-' + Date.now() + '.html');
      const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } });
      try {
        fs.writeFileSync(tmp, full, 'utf8');
        await win.loadFile(tmp);
        const buf = await win.webContents.printToPDF({
          pageSize: 'A4', landscape: true, printBackground: true,
          margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
        });
        const file = path.join(dir, name + '.pdf');
        fs.writeFileSync(file, buf);
        logLine('report pdf -> ' + file);
        return { ok: true, file, dir };
      } finally {
        try { win.destroy(); } catch (_) {}
        try { fs.unlinkSync(tmp); } catch (_) {}
      }
    } catch (e) { logLine('report export FAILED: ' + e.message); return { ok: false, error: e.message }; }
  });

  // authentication (verify against the live UserMaster)
  ipcMain.handle('auth:login', async (_e, { username, password }) => {
    try { if (cfg.db && cfg.db.enabled) return await sqldb.authenticate(cfg.db, username, password); return { ok: false, error: 'auth unavailable' }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
}

// ---------------------------------------------------------------- setup wizard
// Quick central check: open a short-lived SSH tunnel and try a SQL connect.
function testCentral(vps) {
  return new Promise((resolve) => {
    const s = vps.ssh || {};
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'src', 'wb-testcentral.ps1'),
      '-SshHost', String(s.host || ''), '-SshUser', String(s.user || 'root'),
      '-LocalPort', String(s.localPort || 14330), '-RemotePort', String(s.remotePort || 1433),
      '-Database', String(vps.database || 'svt_weighbridge'), '-SqlUser', String(vps.user || ''), '-SqlPassword', String(vps.password || ''),
      '-KeyPath', String(tunnelKeyPath || '')];
    const child = spawn(psExe(), args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (b) => { out += b.toString(); });
    child.stderr.on('data', (b) => { out += b.toString(); });
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', () => {
      const ok = /OK:(.*)/.exec(out); if (ok) return resolve({ ok: true, version: ok[1].trim() });
      const er = /ERR:(.*)/.exec(out); resolve({ ok: false, error: er ? er[1].trim() : 'connection failed' });
    });
    setTimeout(() => { try { child.kill(); } catch (_) {} resolve({ ok: false, error: 'timeout' }); }, 22000);
  });
}

function registerSetupIpc() {
  ipcMain.handle('setup:getConfig', () => cfg);
  ipcMain.handle('setup:serialPorts', async () => {
    try { const { listPorts } = require('./src/serial-win'); return await listPorts(); } catch (e) { return []; }
  });
  ipcMain.handle('setup:testWeight', async (_e, serial) => {
    return await new Promise((resolve) => {
      let done = false, agent;
      const finish = (r) => { if (done) return; done = true; try { agent && agent.stop(); } catch (_) {} resolve(r); };
      const parse = (cfg.edge && cfg.edge.parse) || { startHex: '02', totalStringLength: 10, weightStartFrom: 1, weightLength: 6, stableRepeats: 4, pollMs: 250 };
      try {
        agent = new EdgeAgent({ connection: 'serial', serial, parse });
        agent.on('weight', (d) => finish({ ok: true, value: d.value, unit: d.unit }));
        agent.start();
      } catch (e) { return finish({ ok: false, error: e.message }); }
      setTimeout(() => finish({ ok: false, error: 'no reading in 6s — check port/baud and that the indicator is streaming' }), 6000);
    });
  });
  ipcMain.handle('setup:testCamera', async (_e, cam) => {
    try { const r = await camera.capture(cam); return r.ok ? { ok: true, dataUrl: r.dataUrl } : { ok: false, error: r.error }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('setup:testCentral', async (_e, vps) => { try { return await testCentral(vps); } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('setup:save', async (_e, next) => {
    try {
      next.setup = { complete: true, at: new Date().toISOString() };
      saveConfig(next);
      logLine('setup complete: scaleId=' + ((next.site && next.site.scaleId) || '?'));
      try { if (cfg.db && cfg.db.enabled) await sqldb.saveMaster(cfg.db, { entity: 'weighbridges', id: null, fields: { name: next.site.scaleId, active: true } }); } catch (_) {}
      await startBackend();
      showMain();
      return { ok: true };
    } catch (e) { logLine('setup save failed: ' + e.message); return { ok: false, error: e.message }; }
  });
}

// ---------------------------------------------------------------- boot
let backendStarted = false;
async function startBackend() {
  if (backendStarted) return; backendStarted = true;
  try { store = new Store(dataDir); } catch (e) { logLine('DB init failed: ' + e.message); }
  try {
    if (cfg.db && cfg.db.enabled) { liveSnapshot = await sqldb.snapshot(cfg.db); logLine('live snapshot ' + JSON.stringify(liveSnapshot._counts)); }
  } catch (e) { logLine('live snapshot failed: ' + e.message); }
  if (liveSnapshot) {
    const wb0 = (liveSnapshot.weighbridges || [])[0] || {};
    liveSnapshot.cameras = (cfg.cameras || []).map((c, i) => {
      const host = (String(c.url || '').match(/\/\/(?:[^@/]*@)?([^:/]+)/) || [])[1] || '';
      return { id: 'C' + (i + 1), name: c.label || c.id, type: 'RTSP/MJPEG', url: c.url || '',
        ip: host, port: 554, user: c.username || '', wbId: wb0.id || null, status: 'online', active: true, nativeId: c.id };
    });
  }
  registerIpc();
  startEdge();
  camera.setLogger(logLine);
  try { camera.startStreams(cfg.cameras || []); } catch (e) { logLine('camera streams failed: ' + e.message); }
  if (store && cfg.sync && cfg.sync.enabled) {
    sync = new SyncEngine(store, cfg.sync, logLine);
    sync.onState = (s) => { send('sync:status', s); };
    sync.start();
  }
  if (cfg.vpsSql && cfg.vpsSql.enabled) {
    vpssync = new VpsSync(cfg.vpsSql, cfg.db, (cfg.site && cfg.site.scaleId) || 'P5WB2', tunnelKeyPath, logLine);
    vpssync.onState = (s) => { send('sync:status', s); };
    vpssync.start();
  }
}
function showMain() { createWindow('index.html'); }

app.whenReady().then(async () => {
  if (needsSetup()) { logLine('first run — showing setup wizard'); registerSetupIpc(); createWindow('setup.html'); }
  else { await startBackend(); showMain(); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(needsSetup() ? 'setup.html' : 'index.html'); });
});

app.on('window-all-closed', () => { if (edge) edge.stop(); if (sync) sync.stop(); if (vpssync) vpssync.stop(); try { camera.stopStreams(); } catch (_) {} if (process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', (e) => logLine('uncaught: ' + (e && e.stack || e)));
