'use strict';
/*
 * vpssync.js — hybrid backend, SQL-to-SQL.
 * Keeps an SSH tunnel to the VPS alive (localhost:<localPort> -> VPS 127.0.0.1:1433,
 * so raw SQL is never exposed publicly) and periodically runs wb-sync.ps1 to
 * replicate the local (authoritative) SQL Server up to the VPS SQL Server.
 * Offline is the default: if the tunnel or VPS is down, the terminal keeps
 * working on local SQL and the next tick catches the VPS up (idempotent).
 */
const { spawn } = require('child_process');
const path = require('path');

function psExe() {
  return process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe';
}
function sshExe() {
  const p = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\OpenSSH\\ssh.exe` : 'ssh';
  return p;
}

class VpsSync {
  constructor(vpsCfg, dbCfg, scaleId, keyPath, log) {
    this.cfg = vpsCfg || {};
    this.dbCfg = dbCfg || {};
    this.scaleId = scaleId || 'P5WB2';
    this.keyPath = keyPath || '';
    this.log = log || (() => {});
    this.tunnel = null;
    this.timer = null;
    this._respawn = null;
    this.online = false;
    this.busy = false;
    this.onState = null;
    this.last = null;
  }

  start() {
    if (!this.cfg.enabled) { this.log('vpssync disabled'); return; }
    this._startTunnel();
    const every = Math.max(10, this.cfg.intervalSec || 30) * 1000;
    this.timer = setInterval(() => this.tick(), every);
    setTimeout(() => this.tick(), 6000); // let the tunnel settle before the first sync
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this._respawn) { clearTimeout(this._respawn); this._respawn = null; }
    this._stopTunnel();
  }

  localPort() { return (this.cfg.ssh && this.cfg.ssh.localPort) || 14330; }

  _startTunnel() {
    const s = this.cfg.ssh || {};
    const lp = this.localPort(), rp = s.remotePort || 1433;
    const args = ['-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3'];
    if (this.keyPath) args.push('-o', 'IdentitiesOnly=yes', '-i', this.keyPath);
    args.push('-L', `${lp}:127.0.0.1:${rp}`, `${s.user || 'root'}@${s.host}`);
    try {
      this.tunnel = spawn(sshExe(), args, { windowsHide: true });
    } catch (e) { this.log('vps tunnel spawn failed: ' + e.message); this.tunnel = null; return; }
    this.tunnel.on('exit', (code) => {
      this.tunnel = null;
      if (this.timer) { this.log('vps tunnel exited (' + code + ') — respawn in 3s'); this._respawn = setTimeout(() => this._startTunnel(), 3000); }
    });
    this.log('vps tunnel up: localhost:' + lp + ' -> ' + (s.host) + ':' + rp);
  }

  _stopTunnel() { if (this.tunnel) { try { this.tunnel.kill(); } catch (_) {} this.tunnel = null; } }

  tick() {
    if (this.busy || !this.cfg.enabled) return;
    this.busy = true;
    const c = this.cfg;
    const remoteServer = c.server || ('127.0.0.1,' + this.localPort());
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'wb-sync.ps1'),
      '-LocalServer', this.dbCfg.server, '-LocalDatabase', this.dbCfg.database,
      '-RemoteServer', remoteServer, '-RemoteDatabase', c.database || 'svt_weighbridge',
      '-RemoteUser', c.user, '-RemotePassword', c.password, '-ScaleID', this.scaleId,
      '-WindowDays', String(c.pushWindowDays || 7)];
    const child = spawn(psExe(), args, { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', (e) => { this.busy = false; this.online = false; this._emit(false, e.message); });
    child.on('close', (code) => {
      this.busy = false;
      const m = /SYNC_OK:(\{.*\})/.exec(out);
      if (code === 0 && m) {
        this.online = true;
        try { this.last = JSON.parse(m[1]); } catch (_) { this.last = null; }
        this.log('vps sync ok ' + m[1]);
        this._emit(true, null);
      } else {
        this.online = false;
        const e = String(err || out || ('exit ' + code)).replace(/^SYNC_ERR:/, '').split(/\r?\n/)[0];
        this.log('vps sync failed: ' + e);
        this._emit(false, e);
      }
    });
  }

  _emit(online, error) {
    if (this.onState) this.onState({ online, last: this.last, error: error || null, at: new Date().toISOString() });
  }
}

module.exports = { VpsSync };
