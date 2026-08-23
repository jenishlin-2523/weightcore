/* ==========================================================================
   WeighCore — operational views: Dashboard · Terminal · Transactions
   ========================================================================== */
(function () {
  'use strict';
  const U = window.UI, DB = window.DB;
  const V = window.VIEWS = window.VIEWS || {};
  const { esc, icon, num, kg, mt, fDT, fTime, fDay, fDate, dur, ago } = U;

  const TYPE_COLORS = { Processing: 'var(--brand)', Disposal: 'var(--violet)', RDF: 'var(--info)' };
  const vName = (id) => (DB.map.vehicle[id] || {}).no || '—';
  const aName = (id) => (DB.map.account[id] || {}).name || '—';
  const pName = (id) => (DB.map.product[id] || {}).name || '—';
  const gName = (id) => (DB.map.gate[id] || {}).name || '—';
  const uName = (id) => { const u = DB.map.user[id]; return u ? u.first + ' ' + u.last : '—'; };
  const dName = (id) => (DB.map.driver[id] || {}).name || '—';
  const wbName = (id) => (DB.map.wb[id] || {}).name || '—';
  const wbInd = (id) => (DB.map.wb[id] || {}).indicator || '—';
  const siteCode = (id) => (DB.map.site[id] || {}).code || '—';

  /* 'V387' -> 387 when the id carries a real SQL id under prefix `pre`; null otherwise. */
  const sqlIdOf = (id, pre) => { const m = new RegExp('^' + pre + '(\\d+)$').exec(String(id || '')); return m ? parseInt(m[1], 10) : null; };
  /* Date -> 'YYYY-MM-DD HH:mm:ss' for the SQL write. */
  const fSqlDT = (d) => {
    d = (d instanceof Date) ? d : (d ? new Date(d) : new Date());
    const p = (x) => (x < 10 ? '0' : '') + x;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };
  const canSql = () => !!(window.weighcore && window.weighcore.data && window.weighcore.data.saveTicket);
  /* Transporter choices — falls back to all active accounts if none are flagged. */
  const transporters = () => { const t = DB.accounts.filter(a => a.isTransporter && a.active); return t.length ? t : DB.accounts.filter(a => a.active); };

  /* ======================================================================
     DASHBOARD
     ====================================================================== */
  V.dashboard = {
    render() {
      const T = DB.transactions, now = DB.NOW;
      const today = T.filter(t => U.sameDay(t.at, now));
      const yest = T.filter(t => U.sameDay(t.at, new Date(now.getTime() - 864e5)));
      const active = T.filter(t => t.status === 'Active');
      const done = (arr) => arr.filter(t => t.status === 'Complete');

      const netOf = (arr) => done(arr).reduce((n, t) => n + (t.net || 0), 0);
      const netToday = netOf(today), netYest = netOf(yest);
      const deltaNet = netYest ? ((netToday - netYest) / netYest) * 100 : 0;
      const deltaCnt = yest.length ? ((today.length - yest.length) / yest.length) * 100 : 0;

      const cycles = done(T).filter(t => t.passes.length > 1)
        .map(t => t.passes[t.passes.length - 1].at - t.passes[0].at);
      const avgCycle = cycles.reduce((a, b) => a + b, 0) / (cycles.length || 1);

      const wk = T.filter(t => now - t.at < 7 * 864e5);
      const manualPct = wk.length ? (wk.filter(t => t.manual).length / wk.length) * 100 : 0;

      // data-quality score
      const q = V.quality.audit();

      /* ---- carry-forward ----
         The site has been running since Mar 2025. Cumulative figures continue
         from the real opening balance instead of restarting at zero. */
      const op = DB.opening;
      const liveNet = done(T).reduce((n, t) => n + (t.net || 0), 0);
      const cumNet = op.netKg + liveNet;
      const cumTickets = op.tickets + T.length;
      const target = DB.contract.targetKg;
      const pctDone = Math.min(100, (cumNet / target) * 100);

      /* ---- internal vs external ----
         Plant → Yard never leaves the site, so it must not count as moved out. */
      const extToday = DB.externalNet(today);
      const intToday = DB.internalNet(today);
      const rdf = DB.balance('RDF');

      // 14-day stacked throughput
      const buckets = [];
      for (let d = 13; d >= 0; d--) {
        const day = new Date(now.getTime() - d * 864e5);
        const rows = T.filter(t => U.sameDay(t.at, day));
        buckets.push({
          label: fDate(day), short: fDay(day).split(' ')[0],
          Processing: rows.filter(r => r.type === 'Processing').length,
          Disposal: rows.filter(r => r.type === 'Disposal').length,
          RDF: rows.filter(r => r.type === 'RDF').length
        });
      }
      const series = Object.keys(TYPE_COLORS).map(k => ({ key: k, label: k, color: TYPE_COLORS[k] }));

      // product mix (7d, tonnes)
      const mix = {};
      done(wk).forEach(t => { mix[t.productId] = (mix[t.productId] || 0) + (t.net || 0); });
      const mixRows = Object.entries(mix).sort((a, b) => b[1] - a[1]).slice(0, 7)
        .map(([id, v], i) => ({ label: pName(id), value: v, color: ['var(--brand)', 'var(--info)', 'var(--violet)', 'var(--ok)', 'var(--warn)', 'var(--brand-2)', 'var(--text-3)'][i] }));

      // transporters (7d)
      const tr = {};
      done(wk).forEach(t => { tr[t.transporterId] = (tr[t.transporterId] || 0) + (t.net || 0); });
      const trRows = Object.entries(tr).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([id, v]) => ({ label: aName(id), value: v, color: 'var(--brand)' }));

      // lanes
      const lanes = DB.weighbridges.map(w => {
        const onBridge = active.find(t => t.wbId === w.id);
        const t7 = done(T.filter(t => t.wbId === w.id && now - t.at < 7 * 864e5));
        return { w, onBridge, count7: t7.length, net7: t7.reduce((n, t) => n + (t.net || 0), 0) };
      });

      return U.pageHead({
        title: 'Operations overview',
        sub: 'Live position across <b>' + DB.sites.length + ' sites</b> and <b>' + DB.weighbridges.filter(w => w.active).length +
          ' active weighbridges</b> · data as at ' + fDT(now),
        actions:
          '<button class="btn" data-go="#/reports">' + icon('chart') + 'Reports</button>' +
          '<button class="btn btn--primary" data-go="#/terminal">' + icon('scale') + 'Open terminal<kbd>Ctrl</kbd><kbd>N</kbd></button>'
      }) +

      /* ---------- carry-forward band ---------- */
      '<section class="carry">' +
        '<div class="carry__main">' +
          '<div class="carry__lab">Project to date · cumulative net weight moved</div>' +
          '<div class="carry__val">' + mt(cumNet, 0) + '<small>MT</small></div>' +
          '<div class="carry__sub">' + U.num(cumTickets) + ' tickets since ' + esc(DB.contract.startedOn) +
            ' · <b>' + mt(op.netKg, 0) + ' MT</b> brought forward + <b>' + mt(liveNet, 1) + ' MT</b> on WeighCore</div>' +
        '</div>' +
        '<div class="carry__prog">' +
          '<div class="carry__prow"><span>Contract progress</span><b>' + U.pct(pctDone) + '</b></div>' +
          '<div class="carry__track"><i style="width:' + pctDone.toFixed(1) + '%"></i></div>' +
          '<div class="carry__prow carry__prow--dim"><span>' + mt(cumNet, 0) + ' MT done</span>' +
            '<span>' + mt(Math.max(0, target - cumNet), 0) + ' MT remaining of ' + mt(target, 0) + '</span></div>' +
        '</div>' +
      '</section>' +

      '<div class="grid grid--kpi" style="margin-bottom:var(--sp-4)">' +
        U.kpi({
          label: 'On the bridge now', value: active.length, color: 'var(--warn)',
          foot: '<span class="dim">Tickets awaiting a second weighing</span>'
        }) +
        U.kpi({
          label: 'Tickets today', value: num(today.length), color: 'var(--brand)',
          foot: U.trend(deltaCnt) + '<span class="dim">vs yesterday</span>'
        }) +
        U.kpi({
          label: 'Left site today', value: mt(extToday, 1), unit: 'MT', color: 'var(--ok)',
          foot: U.trend(deltaNet) + '<span class="dim">' +
            (intToday ? mt(intToday, 1) + ' MT moved internally, excluded' : 'no internal transfers') + '</span>'
        }) +
        U.kpi({
          label: 'Avg turnaround', value: dur(avgCycle), color: 'var(--info)',
          foot: '<span class="dim">First to last weighing</span>'
        }) +
        U.kpi({
          label: 'Manual weighings', value: U.pct(manualPct), color: manualPct > 8 ? 'var(--danger)' : 'var(--violet)',
          foot: '<span class="dim">Last 7 days · target &lt; 5%</span>'
        }) +
        U.kpi({
          label: 'Data quality', value: q.score, unit: '/100', color: q.score >= 80 ? 'var(--ok)' : 'var(--warn)',
          foot: '<a href="#/quality">' + q.issues + ' open issues</a>'
        }) +
      '</div>' +

      '<div class="grid" style="grid-template-columns:minmax(0,1.55fr) minmax(300px,1fr);margin-bottom:var(--sp-4)">' +
        U.card({
          title: 'Throughput — last 14 days', sub: 'Tickets per day by transaction type',
          actions: U.legend(series),
          body: U.stackedBars(buckets, series, { unit: 'tickets', every: 2 })
        }) +
        U.card({
          title: 'Weighbridge status', flush: true,
          body: '<div style="padding:var(--sp-4);display:flex;flex-direction:column;gap:10px">' +
            lanes.map(l =>
              '<div class="lane ' + (l.onBridge ? 'lane--busy' : l.w.status === 'offline' ? 'lane--off' : '') + '">' +
              '<div class="lane__ico">' + icon(l.w.status === 'offline' ? 'ban' : l.onBridge ? 'truck' : 'scale') + '</div>' +
              '<div class="lane__body"><div class="lane__title">' + esc(l.w.name) + ' · ' + esc(DB.map.site[l.w.siteId].code) + '</div>' +
              '<div class="lane__meta">' + (l.w.status === 'offline' ? 'Offline — calibration'
                : l.onBridge ? 'Ticket ' + l.onBridge.ticketNo + ' · ' + vName(l.onBridge.vehicleId)
                : l.w.port + ' @ ' + l.w.baud + ' · idle') + '</div></div>' +
              '<div class="lane__w"><b>' + num(l.count7) + '</b><span>tickets / 7d</span></div></div>'
            ).join('') + '</div>'
        }) +
      '</div>' +

      '<div class="grid grid--2" style="margin-bottom:var(--sp-4)">' +
        U.card({ title: 'Material mix', sub: 'Net tonnage moved, last 7 days', body: U.barList(mixRows, { fmt: v => mt(v, 1) + ' MT' }) }) +
        U.card({ title: 'Transporter volume', sub: 'Net tonnage, last 7 days', body: U.barList(trRows, { fmt: v => mt(v, 1) + ' MT' }) }) +
      '</div>' +

      /* ---------- RDF material balance ---------- */
      U.card({
        title: 'RDF — yard stock and dispatch',
        sub: 'RDF crosses the bridge twice. Only Yard → Customer has actually left the site.',
        actions: '<span class="badge badge--info">' + mt(rdf.closingKg, 1) + ' MT in yard</span>',
        body:
          '<div class="bal">' +
            '<div class="bal__r"><span class="bal__k">Opening stock <em>brought forward</em></span>' +
              '<b class="bal__v">' + mt(rdf.openingKg, 1) + '</b><span class="bal__u">MT</span></div>' +
            '<div class="bal__r bal__r--in"><span class="bal__k">Moved in <em>Plant → Yard · internal, stays on site</em></span>' +
              '<b class="bal__v">+ ' + mt(rdf.inKg, 1) + '</b><span class="bal__u">MT</span>' +
              '<span class="bal__n">' + rdf.inTickets + ' tickets</span></div>' +
            '<div class="bal__r bal__r--out"><span class="bal__k">Dispatched <em>Yard → Customer · leaves site</em></span>' +
              '<b class="bal__v">− ' + mt(rdf.outKg, 1) + '</b><span class="bal__u">MT</span>' +
              '<span class="bal__n">' + rdf.outTickets + ' tickets</span></div>' +
            '<div class="bal__r bal__r--tot"><span class="bal__k">Closing yard stock</span>' +
              '<b class="bal__v">' + mt(rdf.closingKg, 1) + '</b><span class="bal__u">MT</span></div>' +
          '</div>' +
          U.callout('warn', '<b>Why the subtraction matters.</b> Adding every RDF ticket together gives ' +
            mt(rdf.grossKg, 1) + ' MT — but ' + mt(rdf.inKg, 1) + ' MT of that is the same material weighed on its way ' +
            'into our own yard. Counting it as dispatched would overstate what left site by <b>' +
            U.pct(rdf.outKg ? (rdf.inKg / rdf.outKg) * 100 : 0) + '</b>.')
      }) +
      '<div style="height:var(--sp-4)"></div>' +

      '<div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(320px,1fr)">' +
        U.card({
          title: 'On the bridge', sub: 'Open tickets awaiting their closing weighing', flush: true,
          actions: '<a class="btn btn--sm btn--ghost" href="#/transactions/active">View all' + icon('arrowr') + '</a>',
          body: U.table([
            { label: 'Ticket', get: t => '<b class="mono">' + t.ticketNo + '</b>' },
            { label: 'Vehicle', get: t => '<div class="cellstack"><b>' + esc(vName(t.vehicleId)) + '</b><span>' + esc(aName(t.transporterId)) + '</span></div>' },
            { label: 'Product', get: t => esc(pName(t.productId)) },
            { label: 'First pass', get: t => t.passes.length ? '<span class="mono">' + esc(t.passes[0].kind) + ' ' + num(t.passes[0].weight) + '</span>' : '<span class="dim">—</span>' },
            { label: 'Dwell', num: true, get: t => { if (!t.passes.length) return '<span class="dim">—</span>'; const d = DB.NOW - t.passes[0].at; return '<span class="' + (d > 5.4e6 ? 'strong' : '') + '" style="' + (d > 5.4e6 ? 'color:var(--danger)' : '') + '">' + dur(d) + '</span>'; } },
            { label: 'Lane', get: t => esc((DB.map.wb[t.wbId] || {}).name || '—') }
          ], DB.transactions.filter(t => t.status === 'Active').slice(0, 8), {
            click: true, rowAttr: t => 'data-ticket="' + t.id + '"',
            emptyTitle: 'Bridge is clear', emptyMsg: 'No trucks are mid-cycle right now.'
          })
        }) +
        U.card({
          title: 'Recent activity', flush: true,
          actions: '<a class="btn btn--sm btn--ghost" href="#/audit">Audit trail' + icon('arrowr') + '</a>',
          body: '<div class="feed">' + DB.audit.slice(0, 9).map(a => {
            const tone = a.op === 'INSERT' ? 'ok' : a.table === 'Transaction' && /voided/.test(a.text) ? 'danger' : 'brand';
            const ic = a.op === 'INSERT' ? 'plus' : /voided/.test(a.text) ? 'ban' : 'edit';
            return '<div class="feed__i"><span class="feed__dot" style="background:var(--' + tone + '-soft);color:var(--' + tone + ')">' + icon(ic) + '</span>' +
              '<div class="feed__body"><div class="feed__t">' + esc(a.text) + '</div>' +
              '<div class="feed__m">' + esc(a.user) + ' · ' + esc(a.table) + ' · ' + ago(a.at) + '</div></div></div>';
          }).join('') + '</div>'
        }) +
      '</div>';
    },
    mount(root) {
      root.addEventListener('click', (e) => {
        const r = e.target.closest('[data-ticket]');
        if (r) V.transactions.openTicket(r.dataset.ticket);
      });
    }
  };

  /* ======================================================================
     TERMINAL
     ====================================================================== */
  const TS = {
    mode: 'Double', weighType: 'Gross', txnType: 'Processing', direction: 'Plant to Yard',
    vehicleId: '', transporterId: '', productId: '', gateId: '', driverId: '',
    cf: { cf1: '', cf2: '', cf3: '', cf4: '', cf5: '', cf6: '' },
    passes: [], capture: 'auto', manualWeight: '', tab: 'receipt',
    recallOf: null, live: 0, target: 0, stable: false, ticketNo: null
  };
  let timer = null, camTimer = null, camIdx = 0, settleAt = 0, weightSub = null, edgeSub = null;

  /* live link to the weight indicator — captures are blocked while it is down */
  const EDGE = { connected: false };
  function syncEdge() {
    if (window.WeighCoreNative && window.WeighCoreNative.edgeState) {
      EDGE.connected = ((window.WeighCoreNative.edgeState() || {}).state === 'connected');
    } else EDGE.connected = true;   // browser demo: simulated indicator is always "up"
  }

  function resetTS() {
    Object.assign(TS, {
      mode: 'Double', weighType: 'Gross', txnType: 'Processing', direction: 'Plant to Yard',
      vehicleId: '', transporterId: '', productId: '', gateId: '', driverId: '',
      cf: { cf1: '', cf2: '', cf3: '', cf4: '', cf5: (String(DB.settings.connectedScale || '').match(/\d+/) || ['1'])[0], cf6: '' },
      passes: [], capture: 'auto', manualWeight: '', recallOf: null, stable: false,
      ticketNo: Math.max.apply(null, DB.transactions.map(t => t.ticketNo)) + 1
    });
  }
  resetTS();

  /* shown in a camera tile until the first real RTSP frame arrives */
  const CAM_WAIT = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#0d1117"/>' +
    '<text x="50%" y="52%" fill="#41566b" font-family="Segoe UI,sans-serif" font-size="22" text-anchor="middle">Connecting to camera…</text></svg>');

  const locked = () => DB.settings.lockFieldsAfterPass1 && TS.passes.length > 0;

  function tareOf() { const p = TS.passes.filter(p => p.kind === 'Tare').pop(); return p ? p.weight : null; }
  function grossOf() { const p = TS.passes.filter(p => p.kind === 'Gross').pop(); return p ? p.weight : null; }
  function netOf() {
    let t = tareOf(), g = grossOf();
    if (TS.mode === 'Single' && t == null && TS.vehicleId) { const v = DB.map.vehicle[TS.vehicleId]; if (v && v.tare) t = v.tare; }
    return (t != null && g != null) ? g - t : null;
  }
  function requiredOk() {
    if (!TS.vehicleId || !TS.transporterId || !TS.productId || !TS.gateId) return false;
    for (const f of DB.customFields) if (f.visible && f.required && !TS.cf[f.key]) return false;
    if (TS.mode === 'Single') return TS.passes.length >= 1 && netOf() != null;
    // Double/Multi: the FIRST weighment already creates the ticket (Active),
    // exactly like the legacy flow — the closing weighment completes it.
    return TS.passes.length >= 1;
  }
  /* true when saving now would CLOSE the ticket (both weights on board). */
  function willComplete() {
    if (TS.mode === 'Single') return netOf() != null;
    return TS.passes.length >= 2 && netOf() != null;
  }
  function prevOf(vehicleId) {
    return DB.transactions.find(t => t.vehicleId === vehicleId && t.status === 'Complete') || null;
  }

  V.terminal = {
    render() {
      syncEdge();
      const wb = DB.map.wb[DB.settings.connectedScale] || { name: 'No scale', siteId: 'S1', indicator: '—', port: '—', baud: 0 };
      const openTickets = DB.transactions.filter(t => t.status === 'Active' && t.passes.length);
      // one fixed screen, like the legacy create-transaction page — no page scroll
      return '<div class="termwrap">' +
        '<div class="termbar">' +
          '<span class="termbar__label">Load by Ticket/Vehicle No:</span>' +
          '<select class="input" id="recall" style="max-width:300px">' +
            '<option value="">— open tickets —</option>' +
            openTickets.map(t => '<option value="' + t.id + '">#' + t.ticketNo + ' · ' + esc(vName(t.vehicleId)) + ' · ' + esc(pName(t.productId)) + '</option>').join('') +
          '</select>' +
          '<button class="btn" id="btnReset">' + icon('refresh') + 'New<kbd>Ctrl</kbd><kbd>N</kbd></button>' +
          '<div class="spacer"></div>' +
          '<span class="termbar__scale">' + esc(wb.name) + ' · ' + esc(wb.port) + ' @ ' + wb.baud + '</span>' +
        '</div>' +
        '<div class="terminal" id="term">' + this.left() + this.right() + '</div>' +
      '</div>';
    },

    /* ---- left: the legacy "Transaction Details" sheet ---- */
    left() {
      const lock = locked();
      const lockNote = lock ? U.callout('warn',
        '<b>Fields locked.</b> The first weighment is recorded — under <i>Global settings → lock after first pass</i> only the weight can change now.') : '';

      const cfInput = (f) => {
        const opts = DB.fieldLists[f.key];
        const label = '<label class="field__label" for="' + f.key + '">' + esc(f.label) +
          (f.required ? '<span class="req">*</span>' : '') + '</label>';
        if (opts && opts.length) {
          // controlled lists render as real dropdowns, like the master fields
          const cur = TS.cf[f.key] || '';
          const list = (!cur || opts.indexOf(cur) >= 0) ? opts : [cur].concat(opts);
          return '<div class="field">' + label +
            '<select class="input" id="' + f.key + '" data-cf="' + f.key + '"' + (lock ? ' disabled' : '') + '>' +
            '<option value="">— select —</option>' +
            list.map(v => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('') +
            '</select></div>';
        }
        return '<div class="field">' + label +
          '<input class="input" id="' + f.key + '" data-cf="' + f.key + '" value="' + esc(TS.cf[f.key] || '') + '"' +
          (lock ? ' readonly' : '') + ' placeholder="—" maxlength="' + f.maxLen + '">' +
          '</div>';
      };

      const veh = DB.map.vehicle[TS.vehicleId];
      const vehicleField =
        '<div class="field"><label class="field__label" for="vehicle">Vehicle<span class="req">*</span></label>' +
          '<div class="inputgroup"><input class="input" id="vehicle" autocomplete="off" placeholder="Type or scan a number plate…" value="' + esc(veh ? veh.no : '') + '"' + (lock ? ' readonly' : '') + '>' +
          '<button class="btn" id="btnAddVeh" title="Quick-add vehicle"' + (lock ? ' disabled' : '') + '>' + icon('plus') + '</button></div>' +
          '<div class="combo" style="position:relative"><div class="combo__menu" id="vehMenu"></div></div>' +
          (veh ? '<div class="field__hint">' + (veh.tare ? 'Stored tare <b>' + num(veh.tare) + ' kg</b>' : '<span style="color:var(--danger)">No stored tare on file</span>') +
            (veh.type ? ' · ' + esc(veh.type) : '') + ' · ' + esc(aName(veh.accountId)) + '</div>' : '') +
        '</div>';

      // Masters down the left column, configurable fields down the right —
      // the same two-column sheet as the legacy Transaction Details page.
      const masters = [
        vehicleField,
        U.field({ label: 'Transporter', id: 'transporter', req: true, type: 'select', value: TS.transporterId, disabled: lock, options: [{ v: '', t: '— select —' }].concat(transporters().map(a => ({ v: a.id, t: a.name }))) }),
        U.field({ label: 'Product', id: 'product', req: true, type: 'select', value: TS.productId, disabled: lock, options: [{ v: '', t: '— select —' }].concat(DB.products.filter(p => p.active).map(p => ({ v: p.id, t: p.name }))) }),
        U.field({ label: 'Gate', id: 'gate', req: true, type: 'select', value: TS.gateId, disabled: lock, options: [{ v: '', t: '— select —' }].concat(DB.gates.filter(g => g.active).map(g => ({ v: g.id, t: g.name + ' (' + g.type + ')' }))) }),
        U.field({ label: 'Transaction Datetime', id: 'txnAt', type: 'datetime-local', value: U.fInput(DB.NOW), disabled: !DB.settings.enableTxnDateTime || lock })
      ];
      const cfs = DB.customFields.filter(f => f.visible).map(cfInput);
      const sheet = [];
      for (let i = 0; i < Math.max(masters.length, cfs.length); i++) {
        sheet.push(masters[i] || '<div></div>', cfs[i] || '<div></div>');
      }

      return '<div class="stack">' +
        U.card({
          title: 'Transaction Details',
          sub: TS.recallOf ? 'Continuing ticket #' + DB.transactions.find(t => t.id === TS.recallOf).ticketNo : 'New ticket #' + TS.ticketNo,
          actions: '<span class="badge badge--' + (TS.passes.length ? 'warn' : 'mute') + '">' +
            (TS.passes.length ? 'Weighment ' + (TS.passes.length + 1) : 'Awaiting first weighment') + '</span>',
          body:
            (lockNote ? lockNote + '<div style="height:var(--sp-4)"></div>' : '') +
            '<div class="stack">' +
              '<div class="row"><div class="field__label termlbl">Transaction Mode</div>' +
                U.seg('mode', [{ v: 'Single', t: 'Single' }, { v: 'Double', t: 'Double' }, { v: 'Multi', t: 'Multi' }], TS.mode, 'seg--brand') + '</div>' +
              '<div class="row"><div class="field__label termlbl">Weighment Type</div>' +
                U.seg('weighType', [{ v: 'Tare', t: 'Tare' }, { v: 'Gross', t: 'Gross' }], TS.weighType) + '</div>' +
              '<div class="row"><div class="field__label termlbl">Transaction Type</div>' +
                U.seg('txnType', [{ v: 'Processing', t: 'Processing' }, { v: 'Disposal', t: 'Disposal' }, { v: 'RDF', t: 'RDF' }], TS.txnType) + '</div>' +
              (TS.txnType !== 'Processing'
                ? '<div class="row"><div class="field__label termlbl">Direction</div>' +
                  U.seg('direction', [{ v: 'Plant to Yard', t: 'Plant → Yard' }, { v: 'Yard to Customer', t: 'Yard → Customer' }], TS.direction) + '</div>'
                : '') +
              '<hr class="hr" style="margin:2px 0">' +
              '<div class="formgrid formgrid--2">' + sheet.join('') + '</div>' +
            '</div>'
        }) +
        '<div class="row">' +
          '<button class="btn btn--primary btn--lg" id="btnContinue"' + (requiredOk() ? '' : ' disabled') + '>' +
            icon('check') + 'Continue<kbd>F7</kbd></button>' +
          '<button class="btn btn--lg" id="btnCancel">Cancel<kbd>Esc</kbd></button>' +
        '</div>' +
      '</div>';
    },

    /* ---- right: indicator · cameras · receipt (legacy layout) ---- */
    right() {
      const wb = DB.map.wb[DB.settings.connectedScale];
      let cams = DB.cameras.filter(c => c.wbId === wb.id);
      if (!cams.length) cams = DB.cameras.filter(c => c.active !== false);
      const veh = DB.map.vehicle[TS.vehicleId];
      const t = tareOf(), g = grossOf(), n = netOf();
      const offline = !!window.WeighCoreNative && !EDGE.connected;
      const tab = TS.tab || 'receipt';

      // the legacy "plug" state when the indicator link is down
      const weightZone = offline
        ? '<div class="led is-offline" id="led" style="padding:30px 20px">' +
            '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" style="opacity:.75"><path d="M9 7V2.5M15 7V2.5M7 7h10v3.5a5 5 0 0 1-10 0V7ZM12 15.5V21.5"/></svg>' +
            '<div class="led__meta" style="margin-top:8px"><span class="ledpill">Indicator disconnected — captures blocked until the link returns</span></div>' +
          '</div>'
        : '<div class="led is-settling" id="led"><div class="led__scan"></div>' +
            '<div class="led__value" id="ledVal">' + num(TS.live || 0) + '<sub>kg</sub></div>' +
            '<div class="led__meta">' +
              '<span class="ledpill" id="stablePill">Settling</span>' +
              '<span class="ledpill">Capacity ' + num(wb.capacity) + ' kg</span>' +
            '</div></div>';

      const shots = [];
      TS.passes.forEach(p => (p.images || []).forEach((src, i) =>
        shots.push({ src, cap: 'camera ' + (i + 1) + ' Weighment: #' + p.seq })));

      const rrow = (k, v) => '<div class="receipt__row"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
      const receipt = '<dl class="receipt">' +
        rrow('Ticket No', TS.recallOf ? DB.transactions.find(x => x.id === TS.recallOf).ticketNo : TS.ticketNo) +
        rrow('Vehicle No', veh ? veh.no : '—') +
        rrow('Transporter', TS.transporterId ? aName(TS.transporterId) : '—') +
        rrow('Product', TS.productId ? pName(TS.productId) : '—') +
        rrow('Gate', TS.gateId ? gName(TS.gateId) : '—') +
        DB.customFields.filter(f => f.visible).map(f => rrow(f.label, TS.cf[f.key] || '—')).join('') +
        '<div class="receipt__rule"></div>' +
        rrow('Tare Weight', t != null ? num(t) + ' kg' : '—') +
        rrow('Gross Weight', g != null ? num(g) + ' kg' : '—') +
        rrow('Net Weight', n != null ? num(n) + ' kg (' + mt(n, 3) + ' MT)' : '—') +
        '</dl>';
      const gallery = shots.length
        ? '<div class="gallery">' + shots.map(s =>
            '<figure class="shot"><img src="' + s.src + '" alt="' + esc(s.cap) + '">' +
            '<figcaption class="shot__cap"><span>' + esc(s.cap) + '</span></figcaption></figure>').join('') + '</div>'
        : '<div class="tiny dim" style="padding:var(--sp-2) 0 var(--sp-3)">No frames yet — both cameras fire automatically at each weighment.</div>';

      return '<div class="stack">' +
        '<div class="cockpit">' +
          '<div class="cockpit__bar">' + icon('scale', 'nav__ico') + '<strong>' + esc(wb.name) + '</strong>' +
            '<span class="badge">' + esc(wb.port) + ' · ' + wb.baud + '</span>' +
            '<div class="spacer"></div>' +
            '<span class="ledpill' + (offline ? '' : ' is-live') + '" id="linkPill"><i class="ledpill__dot"></i>' + (offline ? 'Offline' : 'Streaming') + '</span></div>' +

          // cameras on the left, indicator + capture on the right — the legacy split
          '<div class="termhw">' +
            '<div class="cams cams--stack">' + (cams.length ? cams.map((c, i) =>
              '<figure class="cam" data-cam="' + c.id + '">' +
                '<img src="' + (window.WeighCoreNative ? CAM_WAIT : DB.LIVE[i % DB.LIVE.length]) + '" alt="' + esc(c.name) + ' live view">' +
                '<figcaption class="cam__label">' + esc(c.name) + '</figcaption>' +
                '<span class="cam__rec"><i></i>LIVE</span>' +
                '<span class="cam__ts" data-clock>' + fDate(DB.NOW) + ' ' + U.fSec(DB.NOW) + '</span>' +
                '<span class="cam__flash"></span>' +
              '</figure>').join('')
              : '<div class="cam cam--off">' + icon('camera') + 'No camera bound to this scale</div>') +
            '</div>' +
            '<div class="termhw__ind">' +
              weightZone +
              '<div class="capbar">' +
                U.seg('capture', [{ v: 'auto', t: 'Automatic' }, { v: 'manual', t: 'Manual' }], TS.capture) +
                (TS.capture === 'manual'
                  ? '<input class="input" id="manualW" style="width:104px" placeholder="0" value="' + esc(TS.manualWeight) + '" inputmode="numeric">'
                  : '') +
                '<button class="btn btn--capture" id="btnCapture"' + (offline && TS.capture !== 'manual' ? ' disabled' : '') + '>' +
                  icon('download') + 'Capture Weight <kbd>F8</kbd></button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="recall">' +
            '<div class="recall__cell"><div class="recall__k">Prev. Tare</div><div class="recall__v">' + (t != null ? num(t) + ' <small>kg</small>' : '—') + '</div></div>' +
            '<div class="recall__cell"><div class="recall__k">Prev. Gross</div><div class="recall__v">' + (g != null ? num(g) + ' <small>kg</small>' : '—') + '</div></div>' +
            '<div class="recall__cell recall__cell--net"><div class="recall__k">Net Weight</div><div class="recall__v">' + (n != null ? num(n) + ' <small>kg</small>' : '0') + '</div></div>' +
          '</div>' +
        '</div>' +

        U.card({
          body:
            '<div class="tabs">' +
              '<button class="tab' + (tab === 'receipt' ? ' is-on' : '') + '" data-tab="receipt">Receipt Details</button>' +
              '<button class="tab' + (tab === 'images' ? ' is-on' : '') + '" data-tab="images">Captured Images' +
                (shots.length ? '<span class="tab__count">' + shots.length + '</span>' : '') + '</button>' +
            '</div>' +
            (tab === 'images' ? gallery : receipt)
        }) +
      '</div>';
    },

    /* ---- interactivity ---- */
    mount(root) {
      const self = this;
      const term = U.$('#term', root);
      const NATIVE = !!(window.WeighCoreNative && window.weighcore && window.weighcore.capture);

      // Real indicator weight (desktop app) drives the LED, replacing the demo simulation.
      if (NATIVE) {
        weightSub = function (e) {
          const d = e.detail || {};
          TS.live = Math.max(0, Math.round(d.value || 0));
          TS.stable = !!d.stable;
          if (!EDGE.connected) { EDGE.connected = true; repaint(); return; }  // data proves the link
          const ledVal = U.$('#ledVal'), led = U.$('#led'), pill = U.$('#stablePill');
          if (ledVal) {
            ledVal.innerHTML = num(TS.live) + '<sub>kg</sub>';
            led.className = 'led ' + (TS.stable ? 'is-stable' : 'is-settling');
            pill.textContent = TS.stable ? 'Stable' : 'Settling';
            pill.className = 'ledpill ' + (TS.stable ? 'is-live' : 'is-hold');
          }
        };
        window.addEventListener('wc:weight', weightSub);
        edgeSub = function (e) {
          const on = ((e.detail || {}).state === 'connected');
          if (on !== EDGE.connected) { EDGE.connected = on; if (!on) { TS.stable = false; } repaint(); }
        };
        window.addEventListener('wc:edge', edgeSub);
      }

      function repaint() {
        term.innerHTML = self.left() + self.right();
        wireCombo();
      }

      /* live indicator simulation */
      function pickTarget() {
        const v = DB.map.vehicle[TS.vehicleId];
        const base = v && v.tare ? v.tare : 10240;
        if (TS.weighType === 'Gross') {
          const cap = v ? v.cap : 26000;
          return base + Math.round((cap - base) * 0.74 / 10) * 10;
        }
        return base;
      }
      TS.target = pickTarget(); TS.live = TS.target;

      timer = setInterval(() => {
        const now = Date.now();
        if (now > settleAt + 5200) { settleAt = now; }              // re-enter a settle cycle
        const settling = now - settleAt < 2000;
        const noise = settling ? 45 : DB.settings.stabilityToleranceKg * 0.35;
        if (!NATIVE) {
          TS.live = Math.max(0, Math.round((TS.target + (Math.random() - 0.5) * 2 * noise) / 10) * 10);
          TS.stable = !settling;
        }

        const ledVal = U.$('#ledVal'), led = U.$('#led'), pill = U.$('#stablePill');
        if (ledVal) {
          ledVal.innerHTML = num(TS.live) + '<sub>kg</sub>';
          led.className = 'led ' + (TS.stable ? 'is-stable' : 'is-settling');
          pill.textContent = TS.stable ? 'Stable' : 'Settling';
          pill.className = 'ledpill ' + (TS.stable ? 'is-live' : 'is-hold');
        }
        const chip = U.$('#scaleChipWeight'); if (chip) chip.textContent = num(TS.live) + ' kg';
        U.$$('[data-clock]').forEach(el => {
          const d = new Date(DB.NOW.getTime() + (now % 60000));
          el.textContent = fDate(d) + ' ' + U.fSec(d);
        });
      }, 380);

      if (NATIVE) {
        // Live camera tiles: refresh each with a fresh RTSP frame from the real camera.
        let realCams = null;
        const refreshCams = () => {
          const go = (cs) => U.$$('.cam img', term).forEach((im, i) => {
            if (!cs[i]) return;
            window.weighcore.capture(cs[i].id).then(r => { if (r && r.ok && r.dataUrl) im.src = r.dataUrl; }).catch(() => {});
          });
          if (realCams) go(realCams);
          else window.weighcore.listCameras().then(cs => { realCams = cs; go(cs); }).catch(() => {});
        };
        refreshCams();
        camTimer = setInterval(refreshCams, 1500);   // frames come from the main-process cache — instant
      } else {
        camTimer = setInterval(() => {
          camIdx = (camIdx + 1) % DB.LIVE.length;
          U.$$('.cam img', term).forEach((im, i) => { im.src = DB.LIVE[(camIdx + i * 3) % DB.LIVE.length]; });
        }, 2600);
      }

      /* vehicle type-ahead */
      function wireCombo() {
        const inp = U.$('#vehicle', term), menu = U.$('#vehMenu', term);
        if (!inp || !menu) return;
        const wrap = menu.parentElement;
        const show = (q) => {
          const list = DB.vehicles.filter(v => v.active && (!q || v.no.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
          menu.innerHTML = list.length ? list.map(v =>
            '<div class="combo__opt" data-v="' + v.id + '"><b>' + esc(v.no) + '</b>' +
            '<small>' + esc(v.type || 'type not set') + '</small><span class="spacer"></span>' +
            '<small class="mono">' + (v.tare ? num(v.tare) + ' kg' : '⚠ no tare') + '</small></div>').join('')
            : '<div class="combo__empty">No vehicle matches — use <b>+</b> to add one</div>';
          wrap.classList.add('is-open');
        };
        inp.addEventListener('focus', () => show(inp.value));
        inp.addEventListener('input', () => show(inp.value));
        inp.addEventListener('blur', () => setTimeout(() => wrap.classList.remove('is-open'), 160));
        menu.addEventListener('mousedown', (e) => {
          const o = e.target.closest('[data-v]'); if (!o) return;
          const v = DB.map.vehicle[o.dataset.v];
          TS.vehicleId = v.id;
          TS.transporterId = TS.transporterId || v.accountId;
          if (v.type) TS.cf.cf1 = v.type;
          TS.target = pickTarget();
          repaint();
          U.toast('info', 'Vehicle loaded', v.no + (v.tare ? ' · stored tare ' + num(v.tare) + ' kg' : ' · no stored tare on file'));
        });
      }
      wireCombo();

      /* delegated events */
      term.addEventListener('click', (e) => {
        const s = e.target.closest('[data-seg] .seg__opt');
        if (s) {
          const key = s.closest('[data-seg]').dataset.seg, v = s.dataset.v;
          if (key === 'capture') TS.capture = v;
          else if (key === 'mode') TS.mode = v;
          else if (key === 'weighType') { TS.weighType = v; TS.target = pickTarget(); }
          else if (key === 'txnType') TS.txnType = v;
          else if (key === 'direction') TS.direction = v;
          repaint(); return;
        }
        const tb = e.target.closest('[data-tab]');
        if (tb) { TS.tab = tb.dataset.tab; repaint(); return; }
        const tk = e.target.closest('[data-ticket]');
        if (tk) { V.transactions.openTicket(tk.dataset.ticket); return; }
        if (e.target.closest('#btnCapture')) { capture(); return; }
        if (e.target.closest('#btnContinue')) { complete(); return; }
        if (e.target.closest('#btnCancel')) { resetTS(); repaint(); U.toast('info', 'Cleared', 'Terminal reset for the next truck.'); return; }
        if (e.target.closest('#btnAddVeh')) { quickAddVehicle(repaint); return; }
      });

      term.addEventListener('change', (e) => {
        const id = e.target.id;
        if (id === 'transporter') TS.transporterId = e.target.value;
        else if (id === 'product') TS.productId = e.target.value;
        else if (id === 'gate') TS.gateId = e.target.value;
        else if (e.target.dataset.cf) TS.cf[e.target.dataset.cf] = e.target.value;
        else if (id === 'manualW') TS.manualWeight = e.target.value;
        const btn = U.$('#btnContinue', term); if (btn) btn.disabled = !requiredOk();
      });
      term.addEventListener('input', (e) => {
        if (e.target.dataset.cf) TS.cf[e.target.dataset.cf] = e.target.value;
        if (e.target.id === 'manualW') TS.manualWeight = e.target.value;
        const btn = U.$('#btnContinue', term); if (btn) btn.disabled = !requiredOk();
      });

      /* recall */
      const rec = U.$('#recall', root);
      if (rec) rec.addEventListener('change', () => {
        if (!rec.value) { resetTS(); repaint(); return; }
        const t = DB.transactions.find(x => x.id === rec.value);
        Object.assign(TS, {
          recallOf: t.id, mode: t.mode, txnType: t.type, direction: t.direction || 'Plant to Yard',
          vehicleId: t.vehicleId, transporterId: t.transporterId, productId: t.productId,
          gateId: t.gateId, driverId: t.driverId, cf: Object.assign({}, t.cf),
          passes: t.passes.map(p => Object.assign({}, p, { fromDb: !!t.rid })),
          weighType: t.passes[t.passes.length - 1].kind === 'Tare' ? 'Gross' : 'Tare'
        });
        TS.target = pickTarget();
        repaint();
        U.toast('info', 'Ticket #' + t.ticketNo + ' recalled', 'Fields locked — capture the closing weight.');
      });
      const br = U.$('#btnReset', root);
      if (br) br.addEventListener('click', () => { resetTS(); if (rec) rec.value = ''; repaint(); });

      /* actions */
      function capture() {
        let w = TS.live;
        if (TS.capture === 'manual') {
          w = parseInt(String(TS.manualWeight).replace(/[^\d]/g, ''), 10);
          if (!w) { U.toast('danger', 'Enter a weight', 'Manual mode needs a numeric value.'); return; }
        } else {
          if (NATIVE && !EDGE.connected) {
            U.toast('danger', 'Indicator disconnected', 'No live link to the weight indicator — restore the serial link or switch to Manual.'); return;
          }
          if (!w || w <= 0) {
            U.toast('warn', 'No weight on the bridge', 'The indicator reads 0 kg — position the vehicle on the scale, or use Manual.'); return;
          }
          if (!TS.stable) {
            U.toast('warn', 'Reading not stable', 'Wait for the indicator to settle, or switch to manual.'); return;
          }
        }
        if (TS.passes.some(p => p.kind === TS.weighType) && TS.mode !== 'Multi') {
          U.toast('warn', 'Already captured', 'A ' + TS.weighType.toLowerCase() + ' weight exists on this ticket.'); return;
        }
        const wb = DB.map.wb[DB.settings.connectedScale];
        const _pass = {
          seq: TS.passes.length + 1, kind: TS.weighType, weight: w, at: new Date(),
          scale: wb.name, mode: TS.capture === 'manual' ? 'Manual' : 'Auto',
          // real frames only — never the demo template shots on the desktop app
          images: NATIVE ? [] : [DB.IMGS[TS.passes.length * 2 % 4], DB.IMGS[(TS.passes.length * 2 + 1) % 4]]
        };
        TS.passes.push(_pass);
        // Grab a real frame from every camera and persist it with the pass.
        if (NATIVE) {
          window.WeighCoreNative.captureTicketPhotos('T' + (TS.ticketNo || 'live'), _pass.seq).then(res => {
            if (res && res.results) {
              const real = res.results.filter(x => x.ok && x.dataUrl).map(x => x.dataUrl);
              if (real.length) { _pass.images = real; try { repaint(); } catch (e) {} }
            }
          }).catch(() => {});
        }
        U.$$('.cam__flash', term).forEach(f => { f.classList.remove('is-fire'); void f.offsetWidth; f.classList.add('is-fire'); });
        const nCam = DB.cameras.filter(c => c.wbId === wb.id).length;
        U.toast('ok', TS.weighType + ' captured — ' + num(w) + ' kg',
          nCam + ' camera image' + (nCam === 1 ? '' : 's') + ' attached to pass ' + TS.passes.length +
          (TS.capture === 'manual' ? ' · marked manual ✱' : ''));
        TS.weighType = TS.weighType === 'Tare' ? 'Gross' : 'Tare';
        TS.target = pickTarget();
        repaint();
      }

      function complete() {
        if (!requiredOk()) { U.toast('warn', 'Incomplete', 'Fill every required field and capture a weight.'); return; }
        const finishing = willComplete();               // false = first weighment only -> ticket saved as Active (legacy flow)
        const n = netOf();
        const wb = DB.map.wb[DB.settings.connectedScale];
        const rec = TS.recallOf ? DB.transactions.find(t => t.id === TS.recallOf) : null;
        const me = (window.AUTH && window.AUTH.user) || {};
        const t = rec || {
          id: 'T' + TS.ticketNo, ticketNo: TS.ticketNo, at: new Date(),
          siteId: wb.siteId, wbId: wb.id, operatorId: me.id || 'US1', charges: 0, voidReason: null
        };
        Object.assign(t, {
          status: finishing ? 'Complete' : 'Active', mode: TS.mode, type: TS.txnType,
          direction: TS.txnType === 'Processing' ? null : TS.direction,
          vehicleId: TS.vehicleId, transporterId: TS.transporterId,
          accountId: rec ? rec.accountId : null,
          driverId: TS.driverId, productId: TS.productId, gateId: TS.gateId,
          tare: tareOf(), gross: grossOf(), net: n,
          tareAt: (TS.passes.filter(p => p.kind === 'Tare').pop() || {}).at || null,
          grossAt: (TS.passes.filter(p => p.kind === 'Gross').pop() || {}).at || null,
          passes: TS.passes.slice(), cf: Object.assign({}, TS.cf),
          manual: TS.passes.some(p => p.mode === 'Manual')
        });
        if (!rec) DB.transactions.unshift(t);

        const finish = function () {
          DB.audit.unshift({
            id: 'AUX' + Date.now(), table: 'Transaction', op: rec ? 'UPDATE' : 'INSERT', at: new Date(),
            user: me.username || 'operator',
            text: finishing ? 'Ticket ' + t.ticketNo + ' completed — net ' + num(n) + ' kg'
                            : 'Ticket ' + t.ticketNo + ' created — first weighment ' + num((TS.passes[0] || {}).weight || 0) + ' kg',
            ref: t.id
          });
          if (finishing) {
            U.toast('ok', 'Ticket #' + t.ticketNo + ' complete', 'Net ' + num(n) + ' kg (' + mt(n, 3) + ' MT) · slip queued to printer');
            V.transactions.slip(t);
          } else {
            U.toast('ok', 'Ticket #' + t.ticketNo + ' created', 'First weighment saved — recall the ticket for the closing weighment.');
            if (DB.settings.printAfterPass1) V.transactions.slip(t);
          }
          resetTS(); if (rec) { const r0 = U.$('#recall', root); if (r0) r0.value = ''; }
          repaint();
        };

        // Persist to the live weighbridge database, exactly like the legacy app.
        if (canSql()) {
          const isUpdate = !!(rec && rec.rid);          // recalled ticket that already exists in SQL
          const veh2 = DB.map.vehicle[TS.vehicleId] || {};
          const newPasses = t.passes.filter(p => !isUpdate || !p.fromDb);
          const payload = {
            update: isUpdate,
            receiptTicketId: isUpdate ? rec.rid : null,
            ticketNo: isUpdate ? rec.ticketNo : null,   // fresh tickets get MAX+1 inside the DB transaction
            status: finishing ? 'Complete' : 'Active', mode: TS.mode,
            transactionType: ({ Processing: 'Incoming', Disposal: 'Outgoing', RDF: 'Both' })[TS.txnType] || 'Incoming',
            direction: TS.txnType === 'Processing' ? null : TS.direction,
            vehicleId: sqlIdOf(TS.vehicleId, 'V'), vehicleNo: veh2.no || '',
            transporterId: sqlIdOf(TS.transporterId, 'A'),
            transporterName: TS.transporterId ? aName(TS.transporterId) : null,
            accountId: null, accountName: null,
            driverId: sqlIdOf(TS.driverId, 'D'),
            driverName: TS.driverId ? dName(TS.driverId) : null,
            productId: sqlIdOf(TS.productId, 'P'), productName: TS.productId ? pName(TS.productId) : null,
            gateId: sqlIdOf(TS.gateId, 'G'), gateName: TS.gateId ? gName(TS.gateId) : null,
            weightBridgeId: sqlIdOf(wb.id, 'WB'), weighbridgeName: wb.name,
            charges: 0, createdBy: sqlIdOf(me.id, 'US'), userName: me.username || null,
            createdAt: fSqlDT(t.at),
            passes: newPasses.map((p, i, arr) => ({
              seq: p.seq || (i + 1), kind: p.kind, weight: p.weight, at: fSqlDT(p.at),
              net: (i === arr.length - 1) ? n : null, manual: p.mode === 'Manual'
            }))
          };
          window.weighcore.data.saveTicket(payload).then(function (r) {
            if (r && r.ok) {
              if (!isUpdate && r.ticketNo) { t.ticketNo = r.ticketNo; t.id = 'T' + r.ticketNo; }
              if (r.receiptTicketId) t.rid = r.receiptTicketId;
              U.toast('ok', 'Saved to database', 'Ticket #' + t.ticketNo + ' written to the weighbridge database.');
            } else {
              U.toast('danger', 'Database save failed', ((r && r.error) || 'unknown error') + ' — ticket kept on screen; see weighcore.log.');
            }
            finish();
          }).catch(function (e) {
            U.toast('danger', 'Database save failed', String((e && e.message) || e) + ' — ticket kept on screen.');
            finish();
          });
        } else {
          finish();
        }
      }

      /* keyboard */
      this._keys = (e) => {
        if (U.anyOpen()) return;
        if (e.key === 'F8') { e.preventDefault(); capture(); }
        if (e.key === 'F7') { e.preventDefault(); complete(); }
      };
      window.addEventListener('keydown', this._keys);
    },

    unmount() {
      clearInterval(timer); clearInterval(camTimer);
      if (weightSub) { window.removeEventListener('wc:weight', weightSub); weightSub = null; }
      if (edgeSub) { window.removeEventListener('wc:edge', edgeSub); edgeSub = null; }
      window.removeEventListener('keydown', this._keys);
      const chip = U.$('#scaleChipWeight'); if (chip) chip.textContent = '0 kg';
    }
  };

  function quickAddVehicle(after) {
    U.openModal(
      '<div class="modal__head"><div><div class="card__title">Quick-add vehicle</div>' +
      '<div class="card__sub">Stays on the terminal — no navigation, no lost keystrokes</div></div>' +
      '<div class="spacer"></div><button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
      '<div class="modal__body"><div class="formgrid formgrid--2">' +
      U.field({ label: 'Vehicle number', id: 'qvNo', req: true, placeholder: 'TN00XX0000' }) +
      U.field({ label: 'Vehicle type', id: 'qvType', type: 'select', options: DB.fieldLists.cf1.map(v => ({ v, t: v })) }) +
      U.field({ label: 'Transporter', id: 'qvAcc', type: 'select', options: [{ v: '', t: '— optional —' }].concat(transporters().map(a => ({ v: a.id, t: a.name }))) }) +
      U.field({ label: 'Stored tare (kg)', id: 'qvTare', type: 'number', placeholder: 'optional', hint: 'Leave blank to capture it on the bridge' }) +
      '</div></div>' +
      '<div class="modal__foot"><button class="btn btn--primary" id="qvSave">' + icon('save') + 'Save vehicle</button>' +
      '<button class="btn" data-close>Cancel</button></div>');
    U.$('#qvSave').addEventListener('click', () => {
      const no = U.$('#qvNo').value.trim().toUpperCase();
      if (!no) { U.toast('danger', 'Vehicle number required'); return; }
      if (DB.settings.blockSpecialCharsVehicle && /[^A-Z0-9]/.test(no)) {
        U.toast('danger', 'Invalid characters', 'Global settings block anything but letters and digits.'); return;
      }
      const base = {
        no, type: U.$('#qvType').value, accountId: U.$('#qvAcc').value,
        tare: parseInt(U.$('#qvTare').value, 10) || 0, cap: 26000, active: true
      };
      const addLocal = function (id) {
        const v = Object.assign({ id }, base);
        DB.vehicles.push(v); DB.map.vehicle[v.id] = v;
        DB.audit.unshift({ id: 'AUX' + Date.now(), table: 'Vehicle', op: 'INSERT', at: new Date(),
          user: ((window.AUTH || {}).user || {}).username || 'operator',
          text: 'Vehicle ' + no + ' created from terminal quick-add', ref: null });
        TS.vehicleId = v.id; TS.transporterId = v.accountId || TS.transporterId; if (v.type) TS.cf.cf1 = v.type;
        U.closeModal(); after(); U.toast('ok', 'Vehicle added', no + ' is now selectable.');
      };
      // Persist to the live Vehicle master; the IDENTITY VehicleID becomes the app id.
      if (window.weighcore && window.weighcore.data && window.weighcore.data.saveVehicle) {
        window.weighcore.data.saveVehicle({
          no, type: base.type || null, tare: base.tare, accountId: sqlIdOf(base.accountId, 'A')
        }).then(function (r) {
          if (r && r.ok && r.vehicleId) { addLocal('V' + r.vehicleId); }
          else { addLocal('VX' + Date.now()); U.toast('warn', 'Database save failed', 'Vehicle kept on screen only — ' + ((r && r.error) || 'unknown error')); }
        }).catch(function () { addLocal('VX' + Date.now()); U.toast('warn', 'Database save failed', 'Vehicle kept on screen only.'); });
      } else addLocal('V' + (DB.vehicles.length + 1));
    });
  }

  /* ----------------------------------------------------------------------
     Delete a ticket — Super Admin only.

     The ticket is moved off DB.transactions into DB.deleted, so it vanishes
     from the ledger, every total, every report and the dashboard at once.
     The row itself and the audit entry are retained: the client invoices a
     government body by weight, and a ticket that disappears leaving no trace
     is exactly what an auditor treats as suspicious. A Super Admin can still
     see and restore it from the Deleted tab.
     ---------------------------------------------------------------------- */
  function deleteFlow(t) {
    if (!window.AUTH.canDelete()) { U.toast('danger', 'Not permitted', 'Only a Super Administrator can delete a ticket.'); return; }
    U.openModal(
      '<div class="modal__head"><div><div class="card__title">Delete ticket #' + t.ticketNo + '</div>' +
      '<div class="card__sub">' + esc(vName(t.vehicleId)) + ' · ' + esc(pName(t.productId)) + ' · net ' +
        (t.net != null ? num(t.net) + ' kg' : '—') + '</div></div>' +
      '<div class="spacer"></div><button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
      '<div class="modal__body">' +
      U.callout('warn', '<b>This removes the ticket from the ledger, all totals and every report.</b> ' +
        'The record and this action are kept in the audit trail, and a Super Administrator can restore it from the Deleted tab.') +
      '<div style="height:var(--sp-4)"></div>' +
      U.field({ label: 'Reason for deletion', id: 'delWhy', req: true, span2: true,
        placeholder: 'e.g. duplicate ticket raised in error', hint: 'Recorded against your username in the audit trail.' }) +
      '</div>' +
      '<div class="modal__foot"><button class="btn btn--danger" id="delGo">' + icon('trash') + 'Delete ticket</button>' +
      '<button class="btn" data-close>Cancel</button></div>');

    U.$('#delGo').addEventListener('click', () => {
      const why = (U.$('#delWhy').value || '').trim();
      if (!why) { U.toast('danger', 'Reason required', 'Say why this ticket is being deleted.'); return; }
      const i = DB.transactions.indexOf(t);
      if (i >= 0) DB.transactions.splice(i, 1);
      t.deleted = { by: window.AUTH.user.username, at: new Date(DB.NOW), reason: why };
      DB.deleted.unshift(t);
      DB.audit.unshift({
        id: 'AUX' + Date.now(), table: 'Transaction', op: 'DELETE', at: new Date(DB.NOW),
        user: window.AUTH.user.username,
        text: 'Ticket ' + t.ticketNo + ' deleted — ' + why + ' (net ' + (t.net != null ? num(t.net) + ' kg' : 'n/a') + ')',
        ref: t.id
      });
      U.closeModal(); U.closeDrawer();
      U.toast('warn', 'Ticket #' + t.ticketNo + ' deleted', 'Removed from the ledger and all totals. Audit entry written.');
      window.ROUTER.render();
    });
  }

  /* ======================================================================
     TRANSACTIONS
     ====================================================================== */
  const TQ = { tab: 'all', q: '', type: '', product: '', site: '', page: 1, per: 25 };

  V.transactions = {
    render(params) {
      TQ.tab = (params && params[0]) || 'all';
      if (TQ.tab === 'deleted' && !window.AUTH.canDelete()) TQ.tab = 'all';
      const counts = {
        all: DB.transactions.length,
        active: DB.transactions.filter(t => t.status === 'Active').length,
        complete: DB.transactions.filter(t => t.status === 'Complete').length,
        void: DB.transactions.filter(t => t.status === 'Void').length
      };
      const tabs = [
        { k: 'all', t: 'All', n: counts.all },
        { k: 'active', t: 'On the bridge', n: counts.active },
        { k: 'complete', t: 'Completed', n: counts.complete },
        { k: 'void', t: 'Void', n: counts.void }
      ];
      // The Deleted tab exists only for a Super Admin — everyone else must not
      // even learn that deleted tickets are recoverable.
      if (window.AUTH.canDelete()) tabs.push({ k: 'deleted', t: 'Deleted', n: DB.deleted.length });

      return U.pageHead({
        title: 'Transactions',
        sub: 'Every weighment ticket, with its passes, evidence and audit trail',
        actions:
          '<button class="btn" id="btnExport">' + icon('download') + 'Export CSV</button>' +
          (window.AUTH.allows('terminal')
            ? '<button class="btn btn--primary" data-go="#/terminal">' + icon('plus') + 'New weighment</button>' : '')
      }) +
      U.tabs(tabs, TQ.tab, 'data-ttab') +
      '<div class="toolbar">' +
        U.searchBox('txnQ', 'Ticket no, vehicle, transporter…') +
        '<select class="select" id="fType"><option value="">All types</option>' +
          ['Processing', 'Disposal', 'RDF'].map(t => '<option' + (TQ.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
        '<select class="select" id="fProduct"><option value="">All products</option>' +
          DB.products.filter(p => p.active).map(p => '<option value="' + p.id + '"' + (TQ.product === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select>' +
        '<select class="select" id="fSite"><option value="">All sites</option>' +
          DB.sites.map(s => '<option value="' + s.id + '"' + (TQ.site === s.id ? ' selected' : '') + '>' + esc(s.code) + '</option>').join('') + '</select>' +
        '<div class="spacer"></div>' +
        '<span class="tiny dim" id="txnCount"></span>' +
      '</div>' +
      '<div class="card" id="txnCard"></div>';
    },

    list() {
      if (TQ.tab === 'deleted') return window.AUTH.canDelete() ? DB.deleted.slice() : [];
      let rows = DB.transactions.slice();
      if (TQ.tab !== 'all') rows = rows.filter(t => t.status.toLowerCase() === (TQ.tab === 'active' ? 'active' : TQ.tab));
      if (TQ.type) rows = rows.filter(t => t.type === TQ.type);
      if (TQ.product) rows = rows.filter(t => t.productId === TQ.product);
      if (TQ.site) rows = rows.filter(t => t.siteId === TQ.site);
      if (TQ.q) {
        const q = TQ.q.toLowerCase();
        rows = rows.filter(t => String(t.ticketNo).includes(q) ||
          vName(t.vehicleId).toLowerCase().includes(q) ||
          aName(t.transporterId).toLowerCase().includes(q) ||
          pName(t.productId).toLowerCase().includes(q));
      }
      return rows;
    },

    paint() {
      const all = this.list();
      const pages = Math.max(1, Math.ceil(all.length / TQ.per));
      TQ.page = Math.min(TQ.page, pages);
      const rows = all.slice((TQ.page - 1) * TQ.per, TQ.page * TQ.per);
      const totalNet = all.reduce((n, t) => n + (t.net || 0), 0);

      U.$('#txnCount').innerHTML = num(all.length) + ' tickets · ' + mt(totalNet, 2) + ' MT net';
      U.$('#txnCard').innerHTML =
        U.table([
          { label: 'Ticket', w: '96px', get: t => '<b class="mono">' + t.ticketNo + '</b>' + (t.manual ? ' <span class="tag" title="Contains a manually entered weight">✱</span>' : '') },
          { label: 'Date / time', w: '150px', get: t => '<div class="cellstack"><b>' + fDate(t.at) + '</b><span>' + fTime(t.at) + ' · ' + esc((DB.map.wb[t.wbId] || {}).name || '—') + '</span></div>' },
          { label: 'Vehicle', get: t => '<div class="cellstack"><b>' + esc(vName(t.vehicleId)) + '</b><span>' + esc(aName(t.transporterId)) + '</span></div>' },
          { label: 'Product', get: t => '<div class="cellstack"><b>' + esc(pName(t.productId)) + '</b><span>' + esc(t.mode) + (t.direction ? ' · ' + esc(t.direction) : '') + '</span></div>' },
          { label: 'Type', get: t => U.typeBadge(t.type) },
          { label: 'Tare', num: true, get: t => t.tare != null ? num(t.tare) : '<span class="dim">—</span>' },
          { label: 'Gross', num: true, get: t => t.gross != null ? num(t.gross) : '<span class="dim">—</span>' },
          { label: 'Net (kg)', num: true, get: t => t.net != null ? '<b>' + num(t.net) + '</b>' : '<span class="dim">pending</span>' },
          { label: 'Status', get: t => t.deleted
            ? '<div class="cellstack"><span class="badge badge--danger">Deleted</span>' +
              '<span title="' + U.esc(t.deleted.reason) + '">' + U.esc(t.deleted.by) + ' · ' + fDate(t.deleted.at) + '</span></div>'
            : U.statusBadge(t.status) }
        ], rows, {
          click: true, zebra: true, rowAttr: t => 'data-ticket="' + t.id + '"',
          emptyTitle: TQ.tab === 'deleted' ? 'Nothing deleted' : 'No tickets found',
          emptyMsg: TQ.tab === 'deleted'
            ? 'No ticket has been deleted. When one is, it appears here with who removed it and why.'
            : 'Adjust the filters above or clear the search.'
        }) +
        (all.length > TQ.per ? '<div class="pager"><button class="btn btn--sm" data-pg="prev"' + (TQ.page === 1 ? ' disabled' : '') + '>Previous</button>' +
          '<span class="pager__info">Page ' + TQ.page + ' of ' + pages + '</span>' +
          '<button class="btn btn--sm" data-pg="next"' + (TQ.page === pages ? ' disabled' : '') + '>Next</button>' +
          '<div class="spacer"></div><span class="pager__info">' + num(all.length) + ' records</span></div>' : '');
    },

    mount(root) {
      const self = this;
      this.paint();
      root.addEventListener('click', (e) => {
        const tb = e.target.closest('[data-ttab]');
        if (tb) { location.hash = '#/transactions/' + tb.dataset.ttab; return; }
        const pg = e.target.closest('[data-pg]');
        if (pg) { TQ.page += pg.dataset.pg === 'next' ? 1 : -1; self.paint(); return; }
        const r = e.target.closest('[data-ticket]');
        if (r) { self.openTicket(r.dataset.ticket); return; }
        if (e.target.closest('#btnExport')) {
          const rows = self.list();
          const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
          const csv = ['Ticket,Date,Time,Vehicle,Transporter,Driver,Product,Gate,Type,Mode,Direction,Tare kg,Gross kg,Net kg,Status,Lane,Operator,Manual']
            .concat(rows.map(t => [
              t.ticketNo, fDate(t.at), fTime(t.at), vName(t.vehicleId), aName(t.transporterId), dName(t.driverId),
              pName(t.productId), gName(t.gateId), t.type, t.mode, t.direction || '',
              t.tare != null ? t.tare : '', t.gross != null ? t.gross : '', t.net != null ? t.net : '',
              t.status, (DB.map.wb[t.wbId] || {}).name || '', uName(t.operatorId), t.manual ? 'Yes' : ''
            ].map(q).join(','))).join('\r\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
          a.download = 'weighments_' + fDate(new Date()).replace(/[^0-9A-Za-z]/g, '') + '.csv';
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
          U.toast('ok', 'Export saved', rows.length + ' rows → ' + a.download + ' (Downloads folder)');
        }
      });
      root.addEventListener('input', (e) => {
        if (e.target.id === 'txnQ') { TQ.q = e.target.value; TQ.page = 1; self.paint(); }
      });
      root.addEventListener('change', (e) => {
        if (e.target.id === 'fType') TQ.type = e.target.value;
        else if (e.target.id === 'fProduct') TQ.product = e.target.value;
        else if (e.target.id === 'fSite') TQ.site = e.target.value;
        else return;
        TQ.page = 1; self.paint();
      });
    },

    /* ---- ticket drawer ---- */
    openTicket(id) {
      const t = DB.transactions.find(x => x.id === id) || DB.deleted.find(x => x.id === id);
      if (!t) return;
      const v = DB.map.vehicle[t.vehicleId] || {};
      const kvs = [
        ['Vehicle', vName(t.vehicleId)], ['Transporter', aName(t.transporterId)],
        ['Account', aName(t.accountId)],
        ['Product', pName(t.productId)], ['Gate', gName(t.gateId)],
        ['Site', siteCode(t.siteId)], ['Lane', wbName(t.wbId)],
        ['Operator', uName(t.operatorId)], ['Charges', U.inr(t.charges)]
      ];
      const cfs = DB.customFields.filter(f => f.visible && t.cf[f.key]).map(f => [f.label, t.cf[f.key]]);
      const shots = [];
      t.passes.forEach(p => (p.images || []).forEach((src, i) =>
        shots.push({ src, cap: p.kind + ' · pass ' + p.seq, ts: fTime(p.at), cam: 'Cam ' + (i + 1) })));

      U.openDrawer(
        '<header class="drawer__head">' +
          '<div><div class="crumbs">' + icon('list') + '<span>Ticket</span></div>' +
          '<h2 class="page-title">#' + t.ticketNo + '</h2>' +
          '<div class="page-sub">' + fDT(t.at) + ' · ' + esc(wbName(t.wbId)) + ' · ' + esc(siteCode(t.siteId)) + '</div></div>' +
          '<div class="spacer"></div>' +
          '<div class="row row--tight">' +
          (t.deleted ? '<span class="badge badge--danger">Deleted</span>' : '') +
          U.statusBadge(t.status) + U.typeBadge(t.type) +
          (t.manual ? '<span class="badge badge--warn" title="Contains a manually keyed weight">✱ Manual</span>' : '') +
          '<button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
        '</header>' +
        '<div class="drawer__body"><div class="stack">' +

          '<div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px">' +
            wcell('Tare', t.tare, t.tareAt) + wcell('Gross', t.gross, t.grossAt) + wcell('Net', t.net, null, true) +
          '</div>' +

          (t.deleted ? U.callout('warn', '<b>Deleted by ' + esc(t.deleted.by) + ' on ' + fDT(t.deleted.at) + '.</b> ' +
            esc(t.deleted.reason) + ' — excluded from the ledger and every total, retained for audit.') : '') +
          (t.status === 'Void' ? U.callout('warn', '<b>Voided.</b> ' + esc(t.voidReason || '')) : '') +
          (v.tare && t.tare ? tareDrift(v.tare, t.tare) : '') +

          U.card({
            title: 'Ticket details', flush: true,
            body: '<div style="padding:var(--sp-4)"><div class="tkhead">' +
              kvs.concat(cfs).map(([k, val]) => '<dl class="tkhead__k"><dt>' + esc(k) + '</dt><dd>' + esc(val) + '</dd></dl>').join('') +
              '</div></div>'
          }) +

          U.card({
            title: 'Weighing passes', sub: t.passes.length + ' pass' + (t.passes.length === 1 ? '' : 'es') + ' · ' + t.mode + ' mode', flush: true,
            body: U.table([
              { label: '#', w: '44px', get: p => p.seq },
              { label: 'Type', get: p => '<b>' + esc(p.kind) + '</b>' },
              { label: 'Scale', get: p => esc(p.scale) },
              { label: 'Weight (kg)', num: true, get: p => num(p.weight) },
              { label: 'Captured', get: p => '<span class="mono">' + fDT(p.at) + '</span>' },
              { label: 'Source', get: p => p.mode === 'Manual' ? '<span class="badge badge--warn">Manual ✱</span>' : '<span class="badge badge--ok">Indicator</span>' }
            ], t.passes, { compact: true })
          }) +

          U.card({
            title: 'Photographic evidence', sub: shots.length + ' frames captured automatically at each pass',
            body: shots.length
              ? '<div class="gallery">' + shots.map(s =>
                  '<figure class="shot" data-zoom="' + s.src + '"><img src="' + s.src + '" alt="' + esc(s.cap) + '" loading="lazy">' +
                  '<figcaption class="shot__cap"><span>' + esc(s.cap) + '</span><span>' + esc(s.ts) + '</span></figcaption></figure>').join('') + '</div>'
              : '<div class="tiny dim" style="padding:var(--sp-4)">No camera frames stored on this ticket.</div>'
          }) +

          U.card({
            title: 'Audit trail', flush: true,
            body: '<div style="padding:var(--sp-5)"><div class="timeline">' +
              DB.audit.filter(a => a.ref === t.id).slice().reverse().map(a =>
                '<div class="tl ' + (a.op === 'INSERT' ? 'tl--ok' : '') + '"><div class="tl__t">' + esc(a.text) + '</div>' +
                '<div class="tl__m">' + esc(a.user) + ' · ' + esc(a.op) + ' · ' + fDT(a.at) + '</div></div>').join('') +
              '</div></div>'
          }) +

        '</div></div>' +
        '<footer class="drawer__foot">' +
          '<button class="btn btn--primary" id="dSlip">' + icon('printer') + 'Weighment slip</button>' +
          '<button class="btn" id="dCopy">' + icon('qr') + 'Verify QR</button>' +
          '<div class="spacer"></div>' +
          (t.deleted ? '' :
            (t.status !== 'Void' ? '<button class="btn btn--danger" id="dVoid">' + icon('ban') + 'Void ticket</button>' : '') +
            (window.AUTH.canDelete() ? '<button class="btn btn--danger" id="dDel">' + icon('trash') + 'Delete ticket</button>' : '')) +
          (t.deleted && window.AUTH.canDelete() ? '<button class="btn" id="dRestore">' + icon('refresh') + 'Restore ticket</button>' : '') +
        '</footer>');

      const dr = U.$('#drawer');
      // Assign, don't addEventListener: the drawer element is reused for every
      // ticket, so listeners would stack up and each action would fire once per
      // drawer ever opened.
      dr.onclick = (e) => {
        const z = e.target.closest('[data-zoom]');
        if (z) {
          U.openModal('<div class="modal__head"><div class="card__title">Captured frame</div><div class="spacer"></div>' +
            '<button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
            '<div class="modal__body" style="padding:0"><img src="' + z.dataset.zoom + '" style="width:100%;display:block" alt="Captured frame"></div>', true);
          return;
        }
        if (e.target.closest('#dSlip')) { V.transactions.slip(t); return; }
        if (e.target.closest('#dCopy')) { U.toast('ok', 'QR payload copied', qrPayload(t).slice(0, 52) + '…'); return; }
        if (e.target.closest('#dDel')) { deleteFlow(t); return; }
        if (e.target.closest('#dRestore')) {
          const i = DB.deleted.indexOf(t);
          if (i < 0) return;                     // already restored — never double-insert
          DB.deleted.splice(i, 1);
          delete t.deleted; DB.transactions.unshift(t);
          DB.transactions.sort((a, b) => b.at - a.at);
          DB.audit.unshift({
            id: 'AUX' + Date.now(), table: 'Transaction', op: 'UPDATE', at: new Date(DB.NOW),
            user: window.AUTH.user.username, text: 'Ticket ' + t.ticketNo + ' restored from deleted', ref: t.id
          });
          U.closeDrawer();
          U.toast('ok', 'Ticket #' + t.ticketNo + ' restored', 'It is back in the ledger and counts toward tonnage again.');
          window.ROUTER.render();
          return;
        }
        if (e.target.closest('#dVoid')) {
          const who = ((window.AUTH || {}).user || {}).username || 'operator';
          t.status = 'Void'; t.voidReason = 'Voided from ticket drawer';
          DB.audit.unshift({ id: 'AUX' + Date.now(), table: 'Transaction', op: 'UPDATE', at: new Date(), user: who, text: 'Ticket ' + t.ticketNo + ' voided — ' + t.voidReason, ref: t.id });
          // Persist the status change to the live DB (same update path as completing a recalled ticket).
          if (canSql() && t.rid) {
            window.weighcore.data.saveTicket({ update: true, receiptTicketId: t.rid, ticketNo: t.ticketNo, status: 'Void', passes: [] })
              .then(function (r) {
                if (r && r.ok) U.toast('ok', 'Void saved', 'Ticket #' + t.ticketNo + ' marked Void in the weighbridge database.');
                else U.toast('danger', 'Database update failed', ((r && r.error) || 'unknown error') + ' — void recorded on screen only.');
              }).catch(function () { U.toast('danger', 'Database update failed', 'Void recorded on screen only.'); });
          }
          U.closeDrawer(); U.toast('warn', 'Ticket #' + t.ticketNo + ' voided', 'Excluded from tonnage; record retained for audit.');
          if (location.hash.startsWith('#/transactions')) V.transactions.paint();
        }
      };

      function wcell(label, val, at, hi) {
        return '<div class="card" style="padding:13px 15px' + (hi ? ';background:var(--ok-soft);border-color:var(--ok-line)' : '') + '">' +
          '<div class="field__label">' + label + '</div>' +
          '<div class="mono" style="font-size:21px;font-weight:700' + (hi ? ';color:var(--ok)' : '') + '">' + (val != null ? num(val) : '—') + '</div>' +
          '<div class="tiny dim">' + (val != null ? mt(val, 3) + ' MT' : 'not captured') + (at ? ' · ' + fTime(at) : '') + '</div></div>';
      }
      function tareDrift(stored, actual) {
        const d = ((actual - stored) / stored) * 100;
        if (Math.abs(d) <= DB.settings.tareTolerancePct) return '';
        return U.callout('warn', '<b>Tare deviation ' + (d > 0 ? '+' : '') + d.toFixed(1) + '%.</b> Weighed ' + num(actual) +
          ' kg against a stored tare of ' + num(stored) + ' kg — beyond the ' + DB.settings.tareTolerancePct + '% tolerance.');
      }
    },

    /* ---- printable slip — matches the legacy WEIGHMAST printout ---- */
    slip(t) {
      const v = DB.map.vehicle[t.vehicleId] || {};
      const opUser = (DB.map.user[t.operatorId] || {}).username || (((window.AUTH || {}).user) || {}).username || 'admin';
      const fT12 = (d) => d ? (fDate(d) + ' ' + fTime(d)) : '—';
      const kgv = (val) => val != null ? val + ' Kg' : '—';
      const row = (k, val, strong) => '<div class="lslip__r"><dt>' + esc(k) + '</dt><dd>:&nbsp;' +
        (strong ? '<b>' : '') + esc(val) + (strong ? '</b>' : '') + '</dd></div>';

      const shots = [];
      (t.passes || []).forEach(p => (p.images || []).forEach((src, i) =>
        shots.push({ src, cap: 'camera ' + (i + 1) + ' Weighment: #' + p.seq })));

      U.openModal(
        '<div class="modal__head"><div><div class="card__title">Weighment slip</div>' +
        '<div class="card__sub">Ticket #' + t.ticketNo + ' · ' + fDT(t.at) + '</div></div><div class="spacer"></div>' +
        '<button class="btn btn--sm" onclick="window.print()">' + icon('printer') + 'Print</button>' +
        '<button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
        '<div class="modal__body">' +
        '<div class="lslip">' +
          '<div class="lslip__head">' +
            '<h3>' + esc(DB.company.name) + '.</h3>' +
            '<p>' + esc(DB.company.project) + '.</p>' +
            '<p>' + esc(((t.cf && t.cf.cf4) || siteCode(t.siteId)) + ' ; WB - ' + ((t.cf && t.cf.cf5) || wbName(t.wbId))) + '.</p>' +
          '</div>' +
          '<div class="lslip__pt">Print Time :&nbsp;&nbsp;' + esc(fT12(new Date())) + '</div>' +
          '<div class="lslip__cols">' +
            '<div>' +
              row('TicketID', t.ticketNo) +
              row('Vehicle No.', vName(t.vehicleId)) +
              row('Transporter', aName(t.transporterId)) +
              row('Product', pName(t.productId)) +
              row('Gate', gName(t.gateId)) +
            '</div><div>' +
              row('Vehicle Type', t.cf.cf1 || v.type || '—') +
              row('Party Name', t.cf.cf2 || '—') +
              row('Buyer Name', t.cf.cf3 || '—') +
              row('Package No', t.cf.cf4 || '—') +
              row('WeighBridge No', t.cf.cf5 || '—') +
            '</div>' +
          '</div>' +
          '<hr class="lslip__rule">' +
          '<div class="lslip__cols">' +
            '<div>' +
              row('Gross Weight', kgv(t.gross)) +
              row('Tare Weight', kgv(t.tare)) +
              row('Net Weight', kgv(t.net), true) +
            '</div><div>' +
              row('Gross Time', t.grossAt ? fT12(t.grossAt) : '—') +
              row('Tare Time', t.tareAt ? fT12(t.tareAt) : '—') +
            '</div>' +
          '</div>' +
          (shots.length
            ? '<div class="lslip__shots">' + shots.map(s =>
                '<figure class="lslip__shot"><img src="' + s.src + '" alt="' + esc(s.cap) + '">' +
                '<figcaption>' + esc(s.cap) + '</figcaption></figure>').join('') + '</div>'
            : '') +
          (t.manual ? '<p style="margin:8px 0"><b>&#10033; MANUAL ENTRY</b> — one or more weights were keyed by the operator, not read from the indicator.</p>' : '') +
          '<div class="lslip__foot">' +
            '<div>User Name :&nbsp;&nbsp;' + esc(opUser) + '</div>' +
            '<div class="lslip__sig"><div class="line"></div>Operator Sign.</div>' +
          '</div>' +
        '</div></div>' +
        '<div class="modal__foot"><button class="btn btn--primary" onclick="window.print()">' + icon('printer') + 'Print slip</button>' +
        '<button class="btn" data-close>Close</button></div>', true);
    }
  };

  function qrPayload(t) {
    const map = {
      ticketNo: t.ticketNo, vehicleNo: vName(t.vehicleId), accountName: aName(t.accountId),
      grossWt: t.gross, grossTime: t.grossAt ? fDT(t.grossAt) : '', tareWt: t.tare,
      tareTime: t.tareAt ? fDT(t.tareAt) : '', netWt: t.net, product: pName(t.productId),
      charges: t.charges, cf1: t.cf.cf1, cf2: t.cf.cf2, cf3: t.cf.cf3, cf4: t.cf.cf4, cf5: t.cf.cf5, cf6: t.cf.cf6,
      siteCode: siteCode(t.siteId), operator: uName(t.operatorId),
      signature: 'a7f' + (t.ticketNo * 7919).toString(16).slice(0, 8),
      verifyUrl: 'https://verify.weighcore.app/t/' + t.ticketNo
    };
    return DB.barcodeSlots.filter(s => s.on).map(s => s.code + ':' + (map[s.key] == null ? '' : map[s.key])).join('|');
  }
  V.transactions.qrPayload = qrPayload;
})();
