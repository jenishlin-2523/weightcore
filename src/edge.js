'use strict';
/*
 * edge.js — Weight indicator edge agent (Electron main process).
 *
 * Reads the live weight from a weighbridge indicator over EITHER a serial
 * COM port OR a raw TCP socket, slices weight frames out of the raw stream
 * using configurable parse rules (the proven indicators.json approach), does
 * stability detection, and auto-reconnects. It never throws into the app;
 * every failure becomes a 'status' event and a reconnect.
 *
 * Events (EventEmitter):
 *   'weight'  {value, unit, raw, stable}   — every parsed reading (~pollMs)
 *   'stable'  {value, unit}                — value held steady for stableRepeats
 *   'status'  {state, detail}              — 'connecting'|'connected'|'disconnected'|'error'
 *   'raw'     string                       — raw chunk (for diagnostics screen)
 */
const { EventEmitter } = require('events');
const net = require('net');

class EdgeAgent extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;                 // config.edge
    this.buffer = '';
    this.last = null;
    this.repeat = 0;
    this.port = null;               // SerialPort instance
    this.socket = null;             // net.Socket
    this.closing = false;
    this.reconnectTimer = null;
    this.unit = 'kg';
  }

  start() {
    this.closing = false;
    this._open();
  }

  stop() {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    try { if (this._reader) this._reader.stop(); } catch (_) {}
    try { if (this.socket) this.socket.destroy(); } catch (_) {}
    this._reader = null; this.socket = null;
    this.emit('status', { state: 'disconnected', detail: 'stopped' });
  }

  _reconnect(detail) {
    if (this.closing) return;
    this.emit('status', { state: 'disconnected', detail });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._open(), 2000);
  }

  _open() {
    if (this.closing) return;
    this.buffer = '';
    if (this.cfg.connection === 'tcp') this._openTcp();
    else this._openSerial();
  }

  // ---------------------------------------------------------------- serial
  _openSerial() {
    try { if (this._reader) this._reader.stop(); } catch (_) {}
    this._reader = null;
    const { openSerialReader } = require('./serial-win');
    const s = this.cfg.serial;
    this.emit('status', { state: 'connecting', detail: `serial ${s.port} @ ${s.baudRate}` });
    this._reader = openSerialReader(
      s,
      (chunk) => this._ingest(chunk),
      (st) => {
        this.emit('status', st);
        if (st.state === 'disconnected' || st.state === 'error') this._reconnect(st.detail);
      }
    );
  }

  // ---------------------------------------------------------------- tcp
  _openTcp() {
    const t = this.cfg.tcp;
    this.emit('status', { state: 'connecting', detail: `tcp ${t.host}:${t.port}` });
    const sock = new net.Socket();
    this.socket = sock;
    sock.setTimeout(8000);
    sock.connect(Number(t.port), t.host, () => {
      this.emit('status', { state: 'connected', detail: `tcp ${t.host}:${t.port}` });
    });
    sock.on('data', (buf) => this._ingest(buf.toString('latin1')));
    sock.on('timeout', () => { sock.destroy(); this._reconnect('tcp idle timeout'); });
    sock.on('error', (e) => this._reconnect('tcp error: ' + e.message));
    sock.on('close', () => { if (!this.closing) this._reconnect('tcp closed'); });
  }

  // ---------------------------------------------------------------- parse
  _ingest(chunk) {
    this.emit('raw', chunk);
    this.buffer += chunk;
    // keep the buffer bounded
    if (this.buffer.length > 4096) this.buffer = this.buffer.slice(-2048);

    const p = this.cfg.parse;
    // startChar may be a printable char, or a control byte given as hex (e.g. "02" = STX)
    const startChar = p.startChar || (p.startHex ? String.fromCharCode(parseInt(p.startHex, 16)) : '');
    const frameLen = Number(p.totalStringLength) || 0;

    // Extract as many complete frames as are available, keep the tail.
    // Framing strategy:
    //   - if a startChar is defined, a frame begins at startChar and is frameLen long
    //   - otherwise frames are fixed-length windows of frameLen
    while (true) {
      let frame = null;
      if (startChar) {
        const i = this.buffer.indexOf(startChar);
        if (i < 0) { if (this.buffer.length > frameLen * 3) this.buffer = ''; break; }
        if (this.buffer.length - i < frameLen) { this.buffer = this.buffer.slice(i); break; }
        frame = this.buffer.substr(i, frameLen);
        this.buffer = this.buffer.slice(i + frameLen);
      } else {
        if (this.buffer.length < frameLen) break;
        frame = this.buffer.substr(0, frameLen);
        this.buffer = this.buffer.slice(frameLen);
      }
      const val = this._parseFrame(frame, p);
      if (val !== null) this._emitWeight(val, frame);
    }
  }

  _parseFrame(frame, p) {
    try {
      let seg = frame.substr(Number(p.weightStartFrom) || 0, Number(p.weightLength) || frame.length);
      if (p.reverse) seg = seg.split('').reverse().join('');
      // keep digits, dot, and a single leading minus
      let neg = '';
      let out = '';
      for (const ch of seg) {
        if (!neg && ch === '-') neg = '-';
        if ((ch >= '0' && ch <= '9') || ch === '.') out += ch;
      }
      out = out.trim();
      if (out === '') return null;

      if (p.decimalInString && out.indexOf('.') < 0 && Number(p.decimalPointLocation) > 0) {
        const dp = Number(p.decimalPointLocation);
        if (out.length > dp) out = out.slice(0, out.length - dp) + '.' + out.slice(out.length - dp);
        else out = '0.' + out.padStart(dp, '0');
      }
      const num = parseFloat(neg + out);
      if (!isFinite(num)) return null;
      return num;
    } catch (_) { return null; }
  }

  _emitWeight(value, raw) {
    // stability
    if (this.last !== null && Math.abs(value - this.last) < 1e-9) this.repeat++;
    else this.repeat = 1;
    this.last = value;
    const stable = this.repeat >= (Number(this.cfg.parse.stableRepeats) || 4);

    this.emit('weight', { value, unit: this.unit, raw, stable });
    if (stable && this.repeat === (Number(this.cfg.parse.stableRepeats) || 4)) {
      this.emit('stable', { value, unit: this.unit });
    }
  }
}

module.exports = { EdgeAgent };
