'use strict';
/*
 * camera.js — IP-camera still capture (Electron main process).
 *
 * Grabs a JPEG snapshot from an IP camera over HTTP with Digest auth. This is
 * the same technique the original WeighBridge Solution used (HTTP snapshot,
 * not browser getUserMedia): one request → one deterministic JPEG. No camera
 * permission prompts, no WebRTC flakiness.
 *
 * Hikvision ISAPI is the primary path; Dahua and a couple of generic paths are
 * tried as fallbacks so this works across common camera brands.
 */
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* ---------------- RTSP snapshot (the legacy method: grab a frame off the stream) ---------------- */
function ffmpegPath() {
  // dev: <app>/bin/ffmpeg.exe ; packaged: resources/bin/ffmpeg.exe
  const dev = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
  if (fs.existsSync(dev)) return dev;
  const packed = path.join(process.resourcesPath || '', 'bin', 'ffmpeg.exe');
  if (fs.existsSync(packed)) return packed;
  return 'ffmpeg';
}

/** Build the RTSP URL with URL-encoded credentials injected into the authority. */
function rtspUrlWithCreds(cam) {
  let url = cam.url || `rtsp://${cam.host}:${cam.port || 554}${cam.path || ''}`;
  if (cam.username && !/@/.test(url.replace(/^rtsp:\/\//i, '').split('/')[0])) {
    const auth = encodeURIComponent(cam.username) + ':' + encodeURIComponent(cam.password || '');
    url = url.replace(/^rtsp:\/\//i, 'rtsp://' + auth + '@');
  }
  return url;
}

function rtspSnapshot(cam, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const url = rtspUrlWithCreds(cam);
    const tmp = path.join(os.tmpdir(), 'wc_cam_' + cam.id + '_' + process.pid + '.jpg');
    try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch (_) {}
    const args = ['-rtsp_transport', 'tcp', '-i', url, '-frames:v', '1', '-q:v', '3', '-y', tmp];
    let done = false;
    const child = spawn(ffmpegPath(), args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    const t = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch (_) {} resolve({ ok: false, error: 'rtsp timeout' }); } }, timeoutMs);
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(t); resolve({ ok: false, error: e.message }); } });
    child.on('close', () => {
      if (done) return; done = true; clearTimeout(t);
      try {
        if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
          const jpeg = fs.readFileSync(tmp);
          try { fs.unlinkSync(tmp); } catch (_) {}
          return resolve({ ok: true, jpeg, dataUrl: 'data:image/jpeg;base64,' + jpeg.toString('base64'), via: 'rtsp' });
        }
      } catch (_) {}
      resolve({ ok: false, error: (err.split('\n').filter(Boolean).pop() || 'no frame').slice(0, 200) });
    });
  });
}

/* ---------------- persistent RTSP streams ----------------
 * One long-lived ffmpeg per camera decodes the sub-stream to MJPEG at 2 fps
 * and the newest JPEG is kept in memory. Live tiles and ticket captures read
 * that cache instantly — no per-capture RTSP handshake (which cost 1–4 s and
 * made the UI feel stuck). A dead stream restarts itself with backoff.
 */
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const streams = new Map();   // cam.id -> stream state

let logFn = null;
function setLogger(fn) { logFn = fn; }
function camLog(msg) { try { if (logFn) logFn(msg); } catch (_) {} }

function startStream(cam) {
  let st = streams.get(cam.id);
  if (st) return st;
  st = { cam, child: null, buf: Buffer.alloc(0), lastFrame: null, lastAt: 0, waiters: [], stopped: false, retryTimer: null, backoff: 1500, lastErr: '', fails: 0, spawnAt: 0, watch: null };
  streams.set(cam.id, st);
  // watchdog: an RTSP session can hang silently (e.g. the camera's session
  // slots are taken) — ffmpeg then connects but never delivers and never
  // exits. Recycle it so the retry/alternate-URL logic gets a turn.
  st.watch = setInterval(() => {
    if (st.stopped || !st.child) return;
    const now = Date.now();
    const neverDelivered = !st.lastAt && now - st.spawnAt > 15000;
    const wentStale = st.lastAt && now - st.lastAt > 10000;
    if (neverDelivered || wentStale) {
      camLog('camera ' + st.cam.id + ' stream stalled (' + (neverDelivered ? 'no first frame' : 'frames stopped') + ') — recycling');
      st.lastAt = 0;
      // give the camera time to free the session slot before reconnecting
      st.backoff = Math.max(st.backoff, 8000);
      stopChild(st);
    }
  }, 5000);
  spawnStream(st);
  return st;
}

/* Quit ffmpeg GRACEFULLY ('q' on stdin) so it sends RTSP TEARDOWN and the
 * camera frees the session slot immediately. A hard kill leaves the slot
 * occupied for up to a minute — which is exactly what starved reconnects.
 * Falls back to kill() if ffmpeg doesn't exit within 3 s. */
function stopChild(st) {
  const child = st.child;
  if (!child) return;
  let done = false;
  child.once('close', () => { done = true; });
  try { child.stdin.write('q'); } catch (_) { try { child.kill(); } catch (_) {} return; }
  setTimeout(() => { if (!done) { try { child.kill(); } catch (_) {} } }, 3000);
}

function spawnStream(st) {
  if (st.stopped) return;
  // after two straight failures alternate with the camera's other stream
  // profile (urlAlt, usually the main stream) — sub-stream slots are scarce
  const useAlt = st.cam.urlAlt && st.fails >= 2 && (st.fails % 2 === 0);
  const url = rtspUrlWithCreds(useAlt ? Object.assign({}, st.cam, { url: st.cam.urlAlt }) : st.cam);
  if (useAlt) camLog('camera ' + st.cam.id + ' trying alternate stream profile');
  st.spawnAt = Date.now();
  // -timeout: RTSP socket I/O timeout — a dead connect ERRORS instead of
  // hanging silently. stdin stays open for the graceful 'q' quit.
  // -use_wallclock_as_timestamps: these cameras emit garbage PTS/DTS, which
  // starves the fps filter forever (camera 1 stalled on every connect until
  // frames were restamped from arrival time).
  const args = ['-loglevel', 'error', '-timeout', '10000000', '-rtsp_transport', 'tcp',
    '-use_wallclock_as_timestamps', '1', '-i', url,
    '-an', '-vf', 'fps=10', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-'];
  const child = spawn(ffmpegPath(), args, { windowsHide: true });
  st.child = child;
  st.buf = Buffer.alloc(0);
  child.stdout.on('data', (chunk) => {
    st.buf = st.buf.length ? Buffer.concat([st.buf, chunk]) : chunk;
    for (;;) {                               // pull every complete SOI..EOI JPEG out of the pipe
      const s = st.buf.indexOf(SOI);
      if (s < 0) { if (st.buf.length > 2) st.buf = st.buf.slice(st.buf.length - 2); break; }
      const e = st.buf.indexOf(EOI, s + 2);
      if (e < 0) {
        if (s > 0) st.buf = st.buf.slice(s);
        if (st.buf.length > 8 * 1024 * 1024) st.buf = Buffer.alloc(0);   // runaway garbage guard
        break;
      }
      const frame = st.buf.slice(s, e + 2);
      st.buf = st.buf.slice(e + 2);
      if (!st.lastFrame) camLog('camera ' + st.cam.id + ' stream up');
      st.lastFrame = frame; st.lastAt = Date.now(); st.backoff = 1500; st.fails = 0;
      if (st.waiters.length) {
        const ws = st.waiters.splice(0);
        ws.forEach((w) => { clearTimeout(w.t); w.resolve(frame); });
      }
      broadcastFrame(st.cam.id, frame);
    }
  });
  child.stderr.on('data', (b) => {           // keep the pipe drained, remember the last line
    const line = b.toString('utf8').split('\n').filter(Boolean).pop();
    if (line) st.lastErr = line.trim().slice(0, 180);
  });
  child.on('error', (e) => { st.lastErr = e.message; scheduleRetry(st); });
  child.on('close', () => scheduleRetry(st));
}

function scheduleRetry(st) {
  if (st.stopped || st.retryTimer) return;
  st.child = null;
  st.fails++;
  // first failure and every 5th thereafter go to the log so field issues are visible
  if (st.fails === 1 || st.fails % 5 === 0) {
    camLog('camera ' + st.cam.id + ' stream down (attempt ' + st.fails + '): ' + (st.lastErr || 'ffmpeg exited'));
  }
  st.retryTimer = setTimeout(() => { st.retryTimer = null; spawnStream(st); }, st.backoff);
  // stay eager: a weighbridge camera must come back fast — cap the backoff at 5 s
  st.backoff = Math.min(Math.round(st.backoff * 1.5), 5000);
}

/** Newest JPEG from the camera's stream — instant when the stream is healthy. */
function streamFrame(cam, timeoutMs = 8000, maxAgeMs = 4000) {
  const st = startStream(cam);
  if (st.lastFrame && Date.now() - st.lastAt <= maxAgeMs) return Promise.resolve(st.lastFrame);
  return new Promise((resolve, reject) => {
    const w = { resolve, t: null };
    w.t = setTimeout(() => {
      const i = st.waiters.indexOf(w); if (i >= 0) st.waiters.splice(i, 1);
      if (st.lastFrame) resolve(st.lastFrame);      // stale beats nothing at a weighment
      else reject(new Error('no frame from camera stream'));
    }, timeoutMs);
    st.waiters.push(w);
  });
}

/* ---------------- local MJPEG relay ----------------
 * A tiny HTTP server on 127.0.0.1 re-serves each camera's frames as
 * multipart/x-mixed-replace. The UI's tiles point an <img> at it once and
 * Chromium plays the stream natively — real 10 fps motion, no polling, no
 * per-frame IPC. Slow clients drop frames instead of buffering. */
const MJPEG_PORT = 18093;
const mjpeg = { server: null, clients: new Map() };   // camId -> Set<client>

function liveUrl(camId) { return 'http://127.0.0.1:' + MJPEG_PORT + '/' + encodeURIComponent(camId); }

function writeFrame(client, jpeg) {
  if (!client.ready) return;                          // backpressure: drop, never buffer
  const head = Buffer.from('--wcframe\r\nContent-Type: image/jpeg\r\nContent-Length: ' + jpeg.length + '\r\n\r\n');
  try { client.ready = client.res.write(Buffer.concat([head, jpeg, Buffer.from('\r\n')])); } catch (_) {}
}

function broadcastFrame(camId, jpeg) {
  const set = mjpeg.clients.get(camId);
  if (set) for (const cl of set) writeFrame(cl, jpeg);
}

function startMjpegServer() {
  if (mjpeg.server) return;
  const srv = http.createServer((req, res) => {
    const id = decodeURIComponent(String(req.url || '/').slice(1).split('?')[0]);
    const st = streams.get(id);
    if (!st) { res.writeHead(404); res.end('no such camera'); return; }
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=wcframe',
      'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache'
    });
    let set = mjpeg.clients.get(id);
    if (!set) { set = new Set(); mjpeg.clients.set(id, set); }
    const client = { res, ready: true };
    set.add(client);
    res.on('close', () => set.delete(client));
    res.on('drain', () => { client.ready = true; });
    if (st.lastFrame) writeFrame(client, st.lastFrame);   // paint instantly
  });
  srv.on('error', (e) => camLog('mjpeg relay error: ' + e.message));
  srv.listen(MJPEG_PORT, '127.0.0.1', () => camLog('mjpeg relay on 127.0.0.1:' + MJPEG_PORT));
  mjpeg.server = srv;
}

/** Warm the streams at app boot so the first capture is already instant. */
function startStreams(cams) {
  (cams || []).forEach((c) => { if (c.type === 'rtsp' || /^rtsp:/i.test(c.url || '')) startStream(c); });
  if (streams.size) startMjpegServer();
}

function stopStreams() {
  if (mjpeg.server) {
    try {
      for (const set of mjpeg.clients.values()) for (const cl of set) { try { cl.res.end(); } catch (_) {} }
      mjpeg.clients.clear();
      mjpeg.server.close();
    } catch (_) {}
    mjpeg.server = null;
  }
  for (const st of streams.values()) {
    st.stopped = true;
    if (st.retryTimer) { clearTimeout(st.retryTimer); st.retryTimer = null; }
    if (st.watch) { clearInterval(st.watch); st.watch = null; }
    st.waiters.splice(0).forEach((w) => { clearTimeout(w.t); w.resolve(st.lastFrame); });
    stopChild(st);
  }
  streams.clear();
}

const SNAPSHOT_PATHS = {
  hikvision: (ch) => [`/ISAPI/Streaming/channels/${ch || 101}/picture`],
  dahua:     ()   => ['/cgi-bin/snapshot.cgi?channel=1'],
  generic:   (ch) => [
    `/ISAPI/Streaming/channels/${ch || 101}/picture`,
    '/cgi-bin/snapshot.cgi?channel=1',
    '/onvif-http/snapshot',
    '/snapshot.jpg', '/image/jpeg.cgi', '/tmpfs/auto.jpg'
  ]
};

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

/** Parse a WWW-Authenticate: Digest header into a map. */
function parseDigest(header) {
  const out = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m;
  while ((m = re.exec(header)) !== null) out[m[1]] = (m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function buildDigestHeader(user, pass, method, uri, d, nc, cnonce) {
  const ha1 = md5(`${user}:${d.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = d.qop ? (d.qop.split(',')[0].trim()) : null;
  let response;
  if (qop) response = md5(`${ha1}:${d.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  else response = md5(`${ha1}:${d.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${d.realm}", nonce="${d.nonce}", uri="${uri}", response="${response}"`;
  if (d.opaque) h += `, opaque="${d.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return h;
}

function request(opts, authHeader) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: opts.host, port: opts.port || 80, path: opts.path, method: 'GET',
      headers: authHeader ? { Authorization: authHeader, 'User-Agent': 'WeighCore/1.0' } : { 'User-Agent': 'WeighCore/1.0' },
      timeout: opts.timeout || 8000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

/** Fetch one snapshot from one path, handling a 401 digest challenge. */
async function fetchPath(cam, path) {
  const base = { host: cam.host, port: cam.port || 80, path, timeout: cam.timeout || 8000 };
  let res = await request(base);
  if (res.status === 401 && res.headers['www-authenticate'] && /digest/i.test(res.headers['www-authenticate'])) {
    const d = parseDigest(res.headers['www-authenticate']);
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const auth = buildDigestHeader(cam.username, cam.password, 'GET', path, d, nc, cnonce);
    res = await request(base, auth);
  } else if (res.status === 401 && cam.username) {
    // Basic fallback
    const basic = 'Basic ' + Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
    res = await request(base, basic);
  }
  const ct = (res.headers['content-type'] || '').toLowerCase();
  if (res.status === 200 && res.body && res.body.length > 0 && (ct.includes('image') || res.body.slice(0, 3).toString('hex') === 'ffd8ff')) {
    return res.body; // JPEG buffer
  }
  throw new Error(`snapshot ${path} -> HTTP ${res.status} (${ct || 'no content-type'})`);
}

/**
 * Capture a still from a configured camera.
 * @returns {Promise<{ok:true, jpeg:Buffer, dataUrl:string, path:string} | {ok:false, error:string}>}
 */
async function capture(cam) {
  // RTSPMJPEG cameras (the ones on this station): newest frame from the
  // persistent stream — instant. Deliberately NO one-shot fallback: these
  // cameras allow only a couple of RTSP sessions, and a fallback grab would
  // steal the slot the reconnecting stream needs, keeping it down forever.
  if (cam.type === 'rtsp' || /^rtsp:/i.test(cam.url || '')) {
    try {
      const jpeg = await streamFrame(cam);
      return { ok: true, jpeg, dataUrl: 'data:image/jpeg;base64,' + jpeg.toString('base64'), via: 'stream' };
    } catch (e) {
      return { ok: false, error: 'camera stream down: ' + e.message };
    }
  }
  // otherwise an HTTP snapshot (Hikvision ISAPI / Dahua / generic)
  const paths = (SNAPSHOT_PATHS[cam.vendor] || SNAPSHOT_PATHS.generic)(cam.channel);
  const errors = [];
  for (const p of paths) {
    try {
      const jpeg = await fetchPath(cam, p);
      return { ok: true, jpeg, dataUrl: 'data:image/jpeg;base64,' + jpeg.toString('base64'), path: p };
    } catch (e) { errors.push(e.message); }
  }
  return { ok: false, error: errors.join(' | ') };
}

/** Quick reachability / identity probe for the diagnostics screen. */
async function probe(cam) {
  if (cam.type === 'rtsp' || /^rtsp:/i.test(cam.url || '')) {
    try { const f = await streamFrame(cam, 10000); return { ok: true, via: 'stream', bytes: f.length }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  try {
    const res = await request({ host: cam.host, port: cam.port || 80, path: '/', timeout: 5000 });
    return { ok: true, status: res.status, server: res.headers['server'] || '' };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { capture, probe, startStreams, stopStreams, setLogger, liveUrl };
