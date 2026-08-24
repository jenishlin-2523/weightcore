/* ==========================================================================
   WeighCore — UI kit: formatting, icons, overlays, charts, table helpers
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- text ---------- */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const num = (n, dec) => n == null || isNaN(n) ? '—'
    : Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 0 : dec });
  const kg = (n) => n == null ? '—' : num(Math.round(n)) + ' kg';
  const mt = (n, dec) => n == null ? '—' : num(n / 1000, dec == null ? 3 : dec);
  const inr = (n) => n == null || !n ? '—' : '₹' + num(Math.round(n));
  const pct = (n, dec) => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(dec == null ? 1 : dec) + '%';

  const P2 = (n) => String(n).padStart(2, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fDate = (d) => !d ? '—' : P2(d.getDate()) + '-' + P2(d.getMonth() + 1) + '-' + d.getFullYear();
  const fDay = (d) => !d ? '—' : P2(d.getDate()) + ' ' + MON[d.getMonth()];
  const H12 = (d) => { const h = d.getHours() % 12; return h === 0 ? 12 : h; };
  const AMPM = (d) => d.getHours() < 12 ? 'AM' : 'PM';
  const fTime = (d) => !d ? '—' : P2(H12(d)) + ':' + P2(d.getMinutes()) + ' ' + AMPM(d);
  const fSec = (d) => !d ? '—' : P2(H12(d)) + ':' + P2(d.getMinutes()) + ':' + P2(d.getSeconds()) + ' ' + AMPM(d);
  const fDT = (d) => !d ? '—' : fDate(d) + ' ' + fTime(d);
  const fInput = (d) => !d ? '' : d.getFullYear() + '-' + P2(d.getMonth() + 1) + '-' + P2(d.getDate()) + 'T' + P2(d.getHours()) + ':' + P2(d.getMinutes());

  function dur(ms) {
    if (ms == null) return '—';
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    return h + 'h ' + P2(m % 60) + 'm';
  }
  function ago(d, now) {
    const ms = (now || window.DB.NOW) - d;
    if (ms < 60000) return 'just now';
    if (ms < 3.6e6) return Math.round(ms / 60000) + ' min ago';
    if (ms < 8.64e7) return Math.round(ms / 3.6e6) + ' h ago';
    const days = Math.round(ms / 8.64e7);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  /* ---------- icons ---------- */
  const P = {
    gauge: '<path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm1.4-3.4L17 7M3.6 18a9 9 0 1 1 16.8 0"/>',
    scale: '<path d="M12 3v18M6 7h12M4 21h16M9 7l-3.5 8a3.5 3.5 0 0 0 7 0L9 7Zm9 0-3.5 8a3.5 3.5 0 0 0 7 0L18 7Z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
    users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20"/><circle cx="9" cy="7" r="3.4"/><path d="M17 4.2a3.4 3.4 0 0 1 0 6.6M22 20v-1.5a4 4 0 0 0-3-3.8"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    box: '<path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2L12 3Zm0 0v18M4 7.2l8 4.3 8-4.3"/>',
    gate: '<path d="M3 21V6l4-2v17M21 21V6l-4-2v17M7 9h10M7 13h10M7 17h10M2 21h20"/>',
    pin: '<path d="M12 21s7-5.8 7-11a7 7 0 1 0-14 0c0 5.2 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
    ruler: '<path d="M15.5 3.5 20.5 8.5 8.5 20.5 3.5 15.5zM7 12l2 2M10 9l2 2M13 6l2 2"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3"/>',
    camera: '<path d="M3 8.5h3.2L8 6h8l1.8 2.5H21v10H3z"/><circle cx="12" cy="13" r="3.4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    shield: '<path d="M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    sparkle: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    check: '<path d="m4 12 5.5 5.5L20 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5M12 17.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    printer: '<path d="M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/>',
    download: '<path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m14.5 5.5 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
    up: '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
    down: '<path d="M12 5v14m0 0 6-6m-6 6-6-6"/>',
    flat: '<path d="M5 12h14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/>',
    wifi: '<path d="M2.5 8.5a15 15 0 0 1 19 0M6 12.5a9.6 9.6 0 0 1 12 0M9.5 16.4a4.4 4.4 0 0 1 5 0M12 20h.01"/>',
    db: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10.5 19a1.8 1.8 0 0 0 3 0"/>',
    key: '<circle cx="8" cy="14" r="4"/><path d="m11 11 9-9 2 2-2 2 2 2-2.5 2.5L17 8"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM16 16h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m3 17 5-4.5 4 3.5 3-2.5 6 5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    play: '<path d="M7 4.5v15l13-7.5z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.6"/>',
    arrowr: '<path d="M5 12h14m0 0-6-6m6 6-6 6"/>',
    tag: '<path d="M3 11V4h7l11 11-7 7L3 11Z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'
  };
  function icon(name, cls) {
    const d = P[name] || P.info;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"' +
      (cls ? ' class="' + cls + '"' : '') + '>' + d + '</svg>';
  }

  /* ---------- badges ---------- */
  function statusBadge(s) {
    const m = { Active: ['warn', 'On bridge'], Complete: ['ok', 'Complete'], Void: ['mute', 'Void'] };
    const [tone, label] = m[s] || ['mute', s];
    return '<span class="badge badge--' + tone + '"><i class="badge__dot"></i>' + esc(label) + '</span>';
  }
  const typeBadge = (t) => '<span class="badge badge--' + ({ Processing: 'brand', Disposal: 'violet', RDF: 'info' }[t] || 'mute') + '">' + esc(t) + '</span>';
  const onlineBadge = (s) => s === 'online'
    ? '<span class="badge badge--ok"><i class="badge__dot"></i>Online</span>'
    : '<span class="badge badge--mute"><i class="badge__dot"></i>Offline</span>';
  const activeBadge = (a) => a
    ? '<span class="badge badge--ok">Active</span>'
    : '<span class="badge badge--mute">Inactive</span>';
  function trend(v, invert) {
    const good = invert ? v < 0 : v > 0;
    const cls = v === 0 ? 'flat' : good ? 'up' : 'down';
    const ic = v === 0 ? 'flat' : v > 0 ? 'up' : 'down';
    return '<span class="trend trend--' + cls + '">' + icon(ic) + Math.abs(v).toFixed(1) + '%</span>';
  }

  /* ---------- charts ---------- */
  function stackedBars(buckets, series, opts) {
    opts = opts || {};
    const max = Math.max(1, ...buckets.map(b => series.reduce((n, s) => n + (b[s.key] || 0), 0)));
    const bars = buckets.map(b => {
      const total = series.reduce((n, s) => n + (b[s.key] || 0), 0);
      // rendered top-to-bottom, so reverse to keep the first series at the base of the column
      const segs = series.slice().reverse().map(s => {
        const v = b[s.key] || 0; if (!v) return '';
        return '<i class="chart__seg" style="height:' + (v / max * 100 * 0.94) + '%;background:' + s.color + '"></i>';
      }).join('');
      return '<div class="chart__bar" title="' + esc(b.label) + ' · ' + total + ' ' + (opts.unit || '') + '">' + segs + '</div>';
    }).join('');
    const labels = buckets.map((b, i) =>
      '<div class="chart__xl">' + ((opts.every && i % opts.every) ? '' : esc(b.short || b.label)) + '</div>').join('');
    return '<div class="chart"><div class="chart__bars">' + bars + '</div><div class="chart__x">' + labels + '</div></div>';
  }
  function legend(series) {
    return '<div class="legend">' + series.map(s =>
      '<span class="legend__i"><i class="legend__sw" style="background:' + s.color + '"></i>' + esc(s.label) + '</span>').join('') + '</div>';
  }
  function barList(rows, opts) {
    opts = opts || {};
    const max = Math.max(1, ...rows.map(r => r.value));
    return '<div class="bars">' + rows.map(r =>
      '<div class="bars__row"><div class="nowrap" style="overflow:hidden;text-overflow:ellipsis">' + esc(r.label) + '</div>' +
      '<div class="bars__track"><i class="bars__fill" style="width:' + (r.value / max * 100) + '%;background:' + (r.color || 'var(--brand)') + '"></i></div>' +
      '<div class="bars__val">' + (opts.fmt ? opts.fmt(r.value) : num(r.value)) + '</div></div>').join('') + '</div>';
  }
  function sparkline(values, color) {
    if (!values.length) return '';
    const w = 78, h = 26, max = Math.max(...values), min = Math.min(...values), rng = (max - min) || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / rng) * (h - 5)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<path d="' + d + '" fill="none" stroke="' + (color || 'var(--brand)') + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function ring(valuePct, label, color) {
    const r = 54, c = 2 * Math.PI * r, off = c * (1 - valuePct / 100);
    return '<div class="scorering">' +
      '<svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="11"/>' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="11" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>' +
      '<div class="scorering__v">' + Math.round(valuePct) + '</div></div>' +
      '<div class="scorering__l">' + esc(label) + '</div>';
  }

  /* ---------- pseudo-QR (visual placeholder with correct anatomy) ---------- */
  function qrSvg(text, size) {
    const N = 29, px = (size || 116) / N;
    let hsh = 2166136261;
    for (let i = 0; i < text.length; i++) { hsh ^= text.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
    let s = hsh >>> 0;
    const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const finder = (x, y) => (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
    let cells = '';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (finder(x, y)) continue;
      if (next() > 0.53) cells += '<rect x="' + (x * px).toFixed(2) + '" y="' + (y * px).toFixed(2) + '" width="' + px.toFixed(2) + '" height="' + px.toFixed(2) + '"/>';
    }
    const eye = (cx, cy) =>
      '<rect x="' + (cx * px) + '" y="' + (cy * px) + '" width="' + (7 * px) + '" height="' + (7 * px) + '"/>' +
      '<rect x="' + ((cx + 1) * px) + '" y="' + ((cy + 1) * px) + '" width="' + (5 * px) + '" height="' + (5 * px) + '" fill="#fff"/>' +
      '<rect x="' + ((cx + 2) * px) + '" y="' + ((cy + 2) * px) + '" width="' + (3 * px) + '" height="' + (3 * px) + '"/>';
    return '<svg width="' + (size || 116) + '" height="' + (size || 116) + '" viewBox="0 0 ' + (size || 116) + ' ' + (size || 116) + '" fill="#111" role="img" aria-label="Ticket QR code">' +
      '<rect width="100%" height="100%" fill="#fff"/>' + cells + eye(0, 0) + eye(N - 7, 0) + eye(0, N - 7) + '</svg>';
  }

  /* ---------- overlays ---------- */
  const scrim = () => $('#scrim');
  let escStack = [];

  function pushEsc(fn) { escStack.push(fn); }
  function popEsc() { escStack.pop(); }

  function openDrawer(html) {
    const d = $('#drawer');
    d.innerHTML = html;
    d.classList.add('is-on'); scrim().classList.add('is-on');
    document.body.style.overflow = 'hidden';
    pushEsc(closeDrawer);
    const f = d.querySelector('[autofocus]'); if (f) f.focus();
  }
  function closeDrawer() {
    $('#drawer').classList.remove('is-on');
    if (!$('#modal').classList.contains('is-on')) { scrim().classList.remove('is-on'); document.body.style.overflow = ''; }
    popEsc();
  }
  function openModal(html, wide) {
    const m = $('#modal');
    m.innerHTML = '<div class="modal__card' + (wide ? ' modal__card--wide' : '') + '">' + html + '</div>';
    m.classList.add('is-on'); scrim().classList.add('is-on');
    document.body.style.overflow = 'hidden';
    pushEsc(closeModal);
    const f = m.querySelector('[autofocus]'); if (f) f.focus();
  }
  function closeModal() {
    $('#modal').classList.remove('is-on');
    if (!$('#drawer').classList.contains('is-on')) { scrim().classList.remove('is-on'); document.body.style.overflow = ''; }
    popEsc();
  }
  function closeTop() { if (escStack.length) escStack[escStack.length - 1](); }
  function anyOpen() { return escStack.length > 0; }

  function toast(tone, title, msg) {
    const t = document.createElement('div');
    const ic = { ok: 'check', warn: 'alert', info: 'info', danger: 'x' }[tone] || 'info';
    t.className = 'toast toast--' + tone;
    t.innerHTML = '<span class="toast__ico">' + icon(ic) + '</span><div class="toast__b"><b>' + esc(title) + '</b>' +
      (msg ? '<span>' + esc(msg) + '</span>' : '') + '</div>';
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 240); }, 3800);
  }

  /* ---------- building blocks ---------- */
  function pageHead(o) {
    return '<div class="page-head"><div class="page-head__txt">' +
      (o.crumbs ? '<div class="crumbs">' + o.crumbs.map((c, i) => (i ? icon('arrowr') : '') + '<span>' + esc(c) + '</span>').join('') + '</div>' : '') +
      '<h1 class="page-title">' + esc(o.title) + '</h1>' +
      (o.sub ? '<p class="page-sub">' + o.sub + '</p>' : '') +
      '</div>' + (o.actions ? '<div class="page-head__actions">' + o.actions + '</div>' : '') + '</div>';
  }
  function kpi(o) {
    return '<div class="kpi" style="--kpi-c:' + (o.color || 'var(--brand)') + '">' +
      '<div class="kpi__label">' + esc(o.label) + '</div>' +
      '<div class="kpi__value">' + o.value + (o.unit ? '<small>' + esc(o.unit) + '</small>' : '') + '</div>' +
      (o.foot ? '<div class="kpi__foot">' + o.foot + '</div>' : '') + '</div>';
  }
  function card(o) {
    return '<section class="card' + (o.cls ? ' ' + o.cls : '') + '">' +
      (o.title ? '<header class="card__head"><div><div class="card__title">' + esc(o.title) + '</div>' +
        (o.sub ? '<div class="card__sub">' + esc(o.sub) + '</div>' : '') + '</div>' +
        (o.actions ? '<div class="card__actions">' + o.actions + '</div>' : '') + '</header>' : '') +
      '<div class="card__body' + (o.flush ? ' card__body--flush' : '') + '">' + o.body + '</div>' +
      (o.foot ? '<footer class="card__foot">' + o.foot + '</footer>' : '') + '</section>';
  }
  function table(cols, rows, opts) {
    opts = opts || {};
    if (!rows.length) return empty(opts.emptyTitle || 'Nothing here yet', opts.emptyMsg || 'No records match the current filter.');
    const head = cols.map(c => '<th' + (c.num ? ' class="num"' : '') + (c.w ? ' style="width:' + c.w + '"' : '') + '>' + esc(c.label) + '</th>').join('');
    const body = rows.map((r, i) => '<tr' + (opts.rowAttr ? ' ' + opts.rowAttr(r, i) : '') + (opts.click ? ' class="is-click"' : '') + '>' +
      cols.map(c => '<td' + (c.num ? ' class="num"' : c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.get(r, i) + '</td>').join('') + '</tr>').join('');
    return '<div class="tablewrap"><table class="tbl' + (opts.zebra ? ' tbl--zebra' : '') + (opts.compact ? ' tbl--compact' : '') + '">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' +
      (opts.foot ? '<tfoot><tr>' + opts.foot + '</tr></tfoot>' : '') + '</table></div>';
  }
  function empty(title, msg, ic) {
    return '<div class="empty"><div class="empty__ico">' + icon(ic || 'search') + '</div>' +
      '<h3>' + esc(title) + '</h3><p>' + esc(msg) + '</p></div>';
  }
  function field(o) {
    const ctl = o.html || (o.type === 'select'
      ? '<select class="input"' + (o.id ? ' id="' + o.id + '"' : '') + (o.disabled ? ' disabled' : '') + '>' +
        (o.options || []).map(op => '<option value="' + esc(op.v) + '"' + (op.v === o.value ? ' selected' : '') + '>' + esc(op.t) + '</option>').join('') + '</select>'
      : o.type === 'textarea'
        ? '<textarea class="textarea"' + (o.id ? ' id="' + o.id + '"' : '') + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>' + esc(o.value || '') + '</textarea>'
        : '<input class="input" type="' + (o.type || 'text') + '"' + (o.id ? ' id="' + o.id + '"' : '') +
          ' value="' + esc(o.value == null ? '' : o.value) + '"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') +
          (o.readonly ? ' readonly' : '') + (o.disabled ? ' disabled' : '') + '>');
    return '<div class="field' + (o.span2 ? ' col-span-2' : '') + '">' +
      '<label class="field__label"' + (o.id ? ' for="' + o.id + '"' : '') + '>' + esc(o.label) +
      (o.req ? '<span class="req">*</span>' : '') + '</label>' + ctl +
      (o.hint ? '<div class="field__hint">' + esc(o.hint) + '</div>' : '') + '</div>';
  }
  const seg = (id, opts, value, cls) =>
    '<div class="seg ' + (cls || '') + '" data-seg="' + id + '">' + opts.map(o =>
      '<button type="button" class="seg__opt' + (o.v === value ? ' is-on' : '') + '" data-v="' + esc(o.v) + '">' + esc(o.t) + '</button>').join('') + '</div>';
  const switchEl = (id, on, title, sub) =>
    '<label class="switch"><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '><span class="switch__track"></span>' +
    (title ? '<span class="switch__txt">' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' : '') + '</label>';
  const setrow = (title, desc, ctl) =>
    '<div class="setrow"><div class="setrow__txt"><strong>' + esc(title) + '</strong><span>' + esc(desc) + '</span></div>' +
    '<div class="setrow__ctl">' + ctl + '</div></div>';
  const searchBox = (id, ph) =>
    '<div class="search">' + icon('search') + '<input class="input" id="' + id + '" type="search" placeholder="' + esc(ph || 'Search…') + '"></div>';
  const tabs = (items, active, attr) =>
    '<nav class="tabs">' + items.map(t =>
      '<button class="tab' + (t.k === active ? ' is-on' : '') + '" ' + (attr || 'data-tab') + '="' + esc(t.k) + '">' + esc(t.t) +
      (t.n != null ? '<span class="tab__count">' + t.n + '</span>' : '') + '</button>').join('') + '</nav>';
  const callout = (tone, html) =>
    '<div class="callout' + (tone ? ' callout--' + tone : '') + '">' + icon(tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : 'info') + '<div>' + html + '</div></div>';

  window.UI = {
    $, $$, esc, num, kg, mt, inr, pct, fDate, fDay, fTime, fSec, fDT, fInput, dur, ago, sameDay, norm, P2,
    icon, statusBadge, typeBadge, onlineBadge, activeBadge, trend,
    stackedBars, legend, barList, sparkline, ring, qrSvg,
    openDrawer, closeDrawer, openModal, closeModal, closeTop, anyOpen, toast,
    pageHead, kpi, card, table, empty, field, seg, switchEl, setrow, searchBox, tabs, callout
  };
})();
