'use strict';
/*
 * preload.js — the ONLY bridge between the (sandboxed) WeighCore UI and Node.
 * Exposes a small, explicit window.weighcore API over contextBridge. The
 * renderer never touches Node/serial/camera directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

const listeners = { weight: [], edge: [], sync: [], raw: [] };
ipcRenderer.on('edge:weight', (_e, d) => listeners.weight.forEach((f) => f(d)));
ipcRenderer.on('edge:status', (_e, d) => listeners.edge.forEach((f) => f(d)));
ipcRenderer.on('edge:raw',    (_e, d) => listeners.raw.forEach((f) => f(d)));
ipcRenderer.on('sync:status', (_e, d) => listeners.sync.forEach((f) => f(d)));

contextBridge.exposeInMainWorld('weighcore', {
  version: '1.0.0',

  // ---- live SQL data ----
  getSnapshot: () => ipcRenderer.sendSync('data:snapshot-sync'),  // instant: preloaded at startup
  siteInfo: () => { try { return ipcRenderer.sendSync('site:get'); } catch (_) { return null; } },  // { name, code, scaleId }
  slipConfig: () => { try { return ipcRenderer.sendSync('slip:get'); } catch (_) { return null; } },  // { project, companies[], outDir } or null
  exportSlipPdf: (payload) => ipcRenderer.invoke('slip:exportPdf', payload),   // dual-letterhead slip PDFs
  exportReport: (payload) => ipcRenderer.invoke('report:export', payload),     // summary report -> Desktop (pdf/xls)
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),                    // reveal a folder in Explorer
  data: {
    refresh:    () => ipcRenderer.invoke('data:refresh'),
    nextTicket: () => ipcRenderer.invoke('data:nextTicket'),
    saveTicket:  (t) => ipcRenderer.invoke('data:saveTicket', t),
    saveVehicle: (v) => ipcRenderer.invoke('data:saveVehicle', v),
    saveMaster:  (m) => ipcRenderer.invoke('data:saveMaster', m),
    deleteMaster:(m) => ipcRenderer.invoke('data:deleteMaster', m),            // products/gates only, and only when unused
    editTicket:  (payload) => ipcRenderer.invoke('data:editTicket', payload)   // audited weight correction
  },
  auth: {
    login: (username, password) => ipcRenderer.invoke('auth:login', { username, password })
  },

  // ---- first-run setup wizard ----
  setup: {
    getConfig:   () => ipcRenderer.invoke('setup:getConfig'),
    serialPorts: () => ipcRenderer.invoke('setup:serialPorts'),
    testWeight:  (serial) => ipcRenderer.invoke('setup:testWeight', serial),
    testCamera:  (cam) => ipcRenderer.invoke('setup:testCamera', cam),
    testCentral: (vps) => ipcRenderer.invoke('setup:testCentral', vps),
    save:        (next) => ipcRenderer.invoke('setup:save', next)
  },

  // ---- live weight edge ----
  onWeight:     (cb) => { listeners.weight.push(cb); return () => {}; },
  onEdgeStatus: (cb) => { listeners.edge.push(cb); return () => {}; },
  onEdgeRaw:    (cb) => { listeners.raw.push(cb); return () => {}; },
  getWeight:    () => ipcRenderer.invoke('edge:get'),
  edgeControl:  (action) => ipcRenderer.invoke('edge:control', action), // 'start'|'stop'|'reconnect'

  // ---- cameras ----
  capture:        (cameraId) => ipcRenderer.invoke('camera:capture', cameraId),
  captureForTxn:  (opts) => ipcRenderer.invoke('camera:captureForTxn', opts || {}),
  probeCameras:   () => ipcRenderer.invoke('camera:probe'),
  listCameras:    () => ipcRenderer.invoke('camera:list'),
  imagesForTxn:   (rid) => ipcRenderer.invoke('images:forTxn', rid),   // photos of a saved ticket

  // ---- local database (offline-first) ----
  db: {
    saveTransaction: (row) => ipcRenderer.invoke('db:upsert', { entity: 'transactions', row }),
    saveWeighment:   (row) => ipcRenderer.invoke('db:upsert', { entity: 'weighments', row }),
    saveVehicle:     (row) => ipcRenderer.invoke('db:upsert', { entity: 'vehicles', row }),
    list:            (entity, limit) => ipcRenderer.invoke('db:list', { entity, limit }),
    get:             (entity, id) => ipcRenderer.invoke('db:get', { entity, id })
  },

  // ---- sync / diagnostics ----
  onSyncStatus: (cb) => { listeners.sync.push(cb); return () => {}; },
  syncNow:      () => ipcRenderer.invoke('sync:now'),
  diagnostics:  () => ipcRenderer.invoke('diag'),
  listSerialPorts: () => ipcRenderer.invoke('edge:ports')
});
