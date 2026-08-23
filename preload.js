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
  data: {
    refresh:    () => ipcRenderer.invoke('data:refresh'),
    nextTicket: () => ipcRenderer.invoke('data:nextTicket'),
    saveTicket:  (t) => ipcRenderer.invoke('data:saveTicket', t),
    saveVehicle: (v) => ipcRenderer.invoke('data:saveVehicle', v),
    saveMaster:  (m) => ipcRenderer.invoke('data:saveMaster', m)
  },
  auth: {
    login: (username, password) => ipcRenderer.invoke('auth:login', { username, password })
  },

  // ---- live weight edge ----
  onWeight:     (cb) => { listeners.weight.push(cb); return () => {}; },
  onEdgeStatus: (cb) => { listeners.edge.push(cb); return () => {}; },
  onEdgeRaw:    (cb) => { listeners.raw.push(cb); return () => {}; },
  getWeight:    () => ipcRenderer.invoke('edge:get'),
  edgeControl:  (action) => ipcRenderer.invoke('edge:control', action), // 'start'|'stop'|'reconnect'

  // ---- cameras ----
  capture:        (cameraId) => ipcRenderer.invoke('camera:capture', cameraId),
  captureForTxn:  (txnId, seq) => ipcRenderer.invoke('camera:captureForTxn', { txnId, seq }),
  probeCameras:   () => ipcRenderer.invoke('camera:probe'),
  listCameras:    () => ipcRenderer.invoke('camera:list'),

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
