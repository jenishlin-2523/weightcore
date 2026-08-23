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

const { EdgeAgent } = require('./src/edge');
const camera = require('./src/camera');
const { Store, uuid, now } = require('./src/db');
const { SyncEngine } = require('./src/sync');
const sqldb = require('./src/sqldb');

// ---- config + storage paths ----
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const dataDir   = cfg.storage.dataDir   || path.join(app.getPath('userData'), 'data');
const imagesDir = cfg.storage.imagesDir || path.join(app.getPath('userData'), 'images');
fs.mkdirSync(imagesDir, { recursive: true });

let win, edge, store, sync, liveSnapshot = null, lastWeight = { value: 0, unit: 'kg', stable: false };

function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(path.join(dataDir, 'weighcore.log'), line); } catch (_) {}
}

// guarded send — never throws if the window is closing/destroyed
function send(channel, payload) {
  try { if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) win.webContents.send(channel, payload); } catch (_) {}
}

function createWindow() {
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // inject the bridge that connects real weight/camera to the WeighCore UI
  win.webContents.on('did-finish-load', () => {
    try {
      const bridge = fs.readFileSync(path.join(__dirname, 'renderer', 'weighcore-bridge.js'), 'utf8');
      win.webContents.executeJavaScript(bridge).catch(() => {});
    } catch (_) {}
  });
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
  ipcMain.handle('camera:list', () => cfg.cameras.map((c) => ({ id: c.id, label: c.label, host: camHost(c) })));
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
  ipcMain.handle('camera:captureForTxn', async (_e, { txnId, seq }) => {
    const results = [];
    for (const cam of cfg.cameras) {
      const r = await camera.capture(cam);
      if (r.ok) {
        const id = uuid();
        const rel = path.join(txnId || 'loose', `${id}.jpg`);
        const abs = path.join(imagesDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, r.jpeg);
        if (store) store.upsert('images', { id, txn_id: txnId || null, camera_id: cam.id, seq: seq || 0, file: abs, uploaded: 0, created_at: now() });
        results.push({ ok: true, cameraId: cam.id, id, dataUrl: r.dataUrl, file: abs });
      } else {
        results.push({ ok: false, cameraId: cam.id, error: r.error });
      }
    }
    return { ok: results.some((x) => x.ok), results };
  });

  // db
  ipcMain.handle('db:upsert', (_e, { entity, row }) => { try { return { ok: true, id: store.upsert(entity, row) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('db:list',   (_e, { entity, limit }) => { try { return { ok: true, rows: store.list(entity, limit) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('db:get',    (_e, { entity, id }) => { try { return { ok: true, row: store.get(entity, id) }; } catch (e) { return { ok: false, error: e.message }; } });

  // sync / diagnostics
  ipcMain.handle('sync:now', async () => { if (sync) await sync._tick(); return { ok: true, online: sync ? sync.online : false }; });
  ipcMain.handle('diag', () => ({
    edge: cfg.edge.connection, lastWeight, cameras: cfg.cameras.map((c) => ({ id: c.id, host: c.host })),
    online: sync ? sync.online : false, dataDir, imagesDir,
    dbLoaded: !!liveSnapshot, counts: liveSnapshot ? liveSnapshot._counts : null
  }));

  // live SQL data
  ipcMain.on('data:snapshot-sync', (e) => { e.returnValue = liveSnapshot; });   // instant: already loaded at startup
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

  // authentication (verify against the live UserMaster)
  ipcMain.handle('auth:login', async (_e, { username, password }) => {
    try { if (cfg.db && cfg.db.enabled) return await sqldb.authenticate(cfg.db, username, password); return { ok: false, error: 'auth unavailable' }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
}

// ---------------------------------------------------------------- boot
app.whenReady().then(async () => {
  try { store = new Store(dataDir); } catch (e) { logLine('DB init failed: ' + e.message); }
  try {
    if (cfg.db && cfg.db.enabled) { liveSnapshot = await sqldb.snapshot(cfg.db); logLine('live snapshot ' + JSON.stringify(liveSnapshot._counts)); }
  } catch (e) { logLine('live snapshot failed: ' + e.message); }
  // The UI's camera list mirrors the cameras this app actually captures from.
  if (liveSnapshot) {
    const wb0 = (liveSnapshot.weighbridges || [])[0] || {};
    liveSnapshot.cameras = cfg.cameras.map((c, i) => {
      const host = (String(c.url || '').match(/\/\/(?:[^@/]*@)?([^:/]+)/) || [])[1] || '';
      return { id: 'C' + (i + 1), name: c.label || c.id, type: 'RTSP/MJPEG', url: c.url || '',
        ip: host, port: 554, user: c.username || '', wbId: wb0.id || null, status: 'online', active: true, nativeId: c.id };
    });
  }
  registerIpc();
  createWindow();
  startEdge();
  camera.setLogger(logLine);
  try { camera.startStreams(cfg.cameras); } catch (e) { logLine('camera streams failed: ' + e.message); }
  if (store) {
    sync = new SyncEngine(store, cfg.sync, logLine);
    sync.onState = (s) => { send('sync:status', s); };
    sync.start();
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (edge) edge.stop(); if (sync) sync.stop(); try { camera.stopStreams(); } catch (_) {} if (process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', (e) => logLine('uncaught: ' + (e && e.stack || e)));
