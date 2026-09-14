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
  /* A ticket's product name. Normally the master row wins, but a ticket raised
     through the Disposal "OTHER" flow has NO ProductID at all — its material is
     free text stored on the weighment row itself — so fall back to that. Also
     covers a ticket whose master row was deleted. */
  const prodOf = (t) => {
    if (!t) return '—';
    const m = DB.map.product[t.productId];
    if (m && m.name) return m.name;
    return (t.productName && String(t.productName).trim()) || '—';
  };
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
            { label: 'Product', get: t => esc(prodOf(t)) },
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
  // This terminal's weighbridge number, taken from its Scale ID
  // (P5WB2 -> "2", P5WB1 -> "1"). Used to default the "Weighbridge No" field.
  function wbNumber() {
    var m = String(window.__TERMINAL_SCALE || '').match(/WB\s*0*(\d+)/i);
    if (m) return m[1];
    var c = String((DB.settings && DB.settings.connectedScale) || '').match(/(\d+)\s*$/);
    return c ? c[1] : '1';
  }

  // Stable transaction id (GUID) shared by the ticket AND its capture photos, so
  // the 4 images (2 tare + 2 gross) all link to the same weighment in the DB/ERP.
  function genRid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().toUpperCase(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }).toUpperCase();
  }

  const TS = {
    mode: 'Double', weighType: 'Gross', txnType: 'Processing', direction: 'Plant to Yard',
    vehicleId: '', transporterId: '', productId: '', gateId: '', driverId: '',
    // cf2 (Party Name) is pre-filled by resetTS(); see DEFAULT_PARTY
    cf: { cf1: '', cf2: '', cf3: '', cf4: '', cf5: wbNumber(), cf6: '' },
    passes: [], tab: 'receipt',
    recallOf: null, rid: '', live: 0, target: 0, stable: false, ticketNo: null
  };
  let timer = null, camTimer = null, camIdx = 0, settleAt = 0, weightSub = null, edgeSub = null;

  /* ----------------------------------------------------------------------
     In-flight guards — duplicate ticket protection.

     Continue/F7 starts an async SQL save that can take a second or more.
     Until it resolved, TS still looked complete and the button stayed
     enabled, so a second click — or OS key auto-repeat while F7 was held —
     ran the whole save again and wrote the ticket (or the pass) a second
     time. Observed live: one ticket carrying FOUR copies of the same pass.

     These are set SYNCHRONOUSLY the instant an action starts and cleared only
     when it settles (success or failure), so extra presses inside the window
     are ignored outright — never queued, never replayed. The flag is the
     authority; the disabled attribute is only its visible echo, because
     repaint() rebuilds the buttons from scratch.

     Module scope, alongside TS, because the terminal's render helpers
     (receiptHtml and friends) read them as well as mount()'s handlers.
     mount() resets all three, so a stale flag can never survive a remount and
     lock the terminal out of saving.
     ---------------------------------------------------------------------- */
  let savingTicket = false, capturingPass = false;
  // set to a ticket id when the operator explicitly chose "start a new ticket
  // anyway" past the open-ticket gate; cleared on every finish and whenever the
  // vehicle changes, so the gate re-arms for the next truck.
  let gateOverride = null;

  /* live link to the weight indicator — captures are blocked while it is down */
  const EDGE = { connected: false };
  function syncEdge() {
    if (window.WeighCoreNative && window.WeighCoreNative.edgeState) {
      EDGE.connected = ((window.WeighCoreNative.edgeState() || {}).state === 'connected');
    } else EDGE.connected = true;   // browser demo: simulated indicator is always "up"
  }

  /* ----------------------------------------------------------------------
     Direction choices depend on the transaction type. "Yard to Customer" is a
     sale leaving the yard, so it is not offered for Disposal — only RDF can go
     that way. Processing never shows a direction at all (it is always inbound),
     which the caller already handles.

     Stored values are matched loosely elsewhere because the legacy database
     holds both "YardToCustomer" and "Yard to Customer"; see sameDirection().
     ---------------------------------------------------------------------- */
  const DIR_PLANT = { v: 'Plant to Yard', t: 'Plant → Yard' };
  const DIR_CUSTOMER = { v: 'Yard to Customer', t: 'Yard → Customer' };
  /* Only RDF carries a direction: an RDF load either moves inside the site or is
     sold out of the yard. Processing is always inbound, and Disposal material
     simply leaves — asking for a direction there was noise, so no direction is
     shown OR stored for either of them. */
  const hasDirection = (txnType) => txnType === 'RDF';
  function directionOpts(txnType) {
    return hasDirection(txnType) ? [DIR_PLANT, DIR_CUSTOMER] : [];
  }
  /* the direction column is spelled inconsistently in the live data
     ("YardToCustomer" 302 rows, "Yard to Customer" 33) — strip spaces and
     compare case-insensitively rather than trusting either spelling */
  const sameDirection = (a, b) =>
    String(a || '').replace(/\s+/g, '').toLowerCase() ===
    String(b || '').replace(/\s+/g, '').toLowerCase();

  /* ----------------------------------------------------------------------
     Which letterheads a ticket may be printed on.

     The second letterhead (Aqua World Export) represents a sale of RDF leaving
     the yard, so it is offered ONLY for an RDF product moving Yard → Customer.
     Every other ticket — a different product, or RDF still going Plant → Yard —
     gets the operating company's letterhead alone, and the second one must not
     be reachable at all.

     Product is matched on the master's transaction type rather than its name,
     so renaming or adding an RDF product in the Product master keeps working;
     direction is matched with sameDirection() because the live column holds
     both "YardToCustomer" and "Yard to Customer".
     ---------------------------------------------------------------------- */
  function slipCompanies(t, slipCfg) {
    const all = (slipCfg && slipCfg.companies && slipCfg.companies.length)
      ? slipCfg.companies : [DB.company.name];
    if (all.length < 2) return all;
    const prod = DB.map.product[t.productId];
    const isRdf = !!prod && (prod.txnType === 'RDF' || t.type === 'RDF');
    const toCustomer = sameDirection(t.direction, 'Yard to Customer');
    return (isRdf && toCustomer) ? all : [all[0]];
  }

  /* ----------------------------------------------------------------------
     Product follows the transaction type.

     Processing is always MSW and RDF is always RDF — the operator should not
     have to pick. Disposal is a genuine choice across many materials, so it is
     never auto-filled.

     Which product to fill in is decided from THIS terminal's own history rather
     than a hardcoded name: whichever candidate has been used most. On this site
     that resolves to MSW (6,185 tickets) for Processing and RDF (1,524) for
     RDF, and it keeps working if the master is renamed or re-tagged, and on
     WB1 with its own data. Falling back to the first candidate means the field
     is never left blank when history is empty (a fresh install).
     ---------------------------------------------------------------------- */
  const FIXED_PRODUCT_TYPES = { Processing: 1, RDF: 1 };
  function productsForType(txnType) {
    return DB.products.filter(p => p.active && (!p.txnType || p.txnType === txnType));
  }
  function defaultProductFor(txnType) {
    const list = productsForType(txnType);
    if (!list.length) return '';
    if (list.length === 1) return list[0].id;          // only one option: always take it
    if (!FIXED_PRODUCT_TYPES[txnType]) return '';      // Disposal stays a real choice
    const used = {};
    DB.transactions.forEach(t => { if (t.productId) used[t.productId] = (used[t.productId] || 0) + 1; });
    let best = list[0];
    list.forEach(p => { if ((used[p.id] || 0) > (used[best.id] || 0)) best = p; });
    return best.id;
  }

  /* ----------------------------------------------------------------------
     Disposal "OTHER" — free text for a one-off material.

     Picking OTHER reveals a required "Enter Details" box. Whatever is typed
     becomes the product ON THAT TICKET ONLY: it is written to the weighment
     row's ProductName with NO ProductID, so it never becomes a Product Master
     row and never appears in the dropdown, however many tickets use it.

     The OTHER master row exists purely to be that dropdown entry. Reports find
     these tickets through the Disposal -> OTHER exclusion match, not by looking
     up the OTHER row.
     ---------------------------------------------------------------------- */
  const OTHER_PRODUCT = 'OTHER';
  const isOtherProduct = () => {
    const p = DB.map.product[TS.productId];
    return !!p && String(p.name || '').replace(/\s+/g, '').toUpperCase() === OTHER_PRODUCT;
  };
  /* what to store as this ticket's product name */
  const ticketProductName = () =>
    isOtherProduct() ? String(TS.otherProduct || '').trim()
                     : (TS.productId ? pName(TS.productId) : null);

  /* Party Name defaults to the site's own operating company as a convenience.
     It stays a normal editable field — RDF and Disposal tickets often carry a
     different party, and the operator must be able to change or clear it. */
  const DEFAULT_PARTY = 'CHENNAI BIOMINNING LTD';

  function resetTS() {
    Object.assign(TS, {
      mode: 'Double', weighType: 'Gross', txnType: 'Processing', direction: 'Plant to Yard',
      // a new ticket starts on Processing, so its product is filled in already
      vehicleId: '', transporterId: '', productId: defaultProductFor('Processing'),
      gateId: '', driverId: '', otherProduct: '',
      cf: { cf1: '', cf2: DEFAULT_PARTY, cf3: '', cf4: '', cf5: wbNumber(), cf6: '' },
      passes: [], recallOf: null, rid: genRid(), stable: false,
      ticketNo: Math.max.apply(null, DB.transactions.map(t => t.ticketNo)) + 1
    });
  }
  resetTS();

  /* shown in a camera tile until the first real RTSP frame arrives */
  const CAM_WAIT = 'data:image/svg+xml;charset=utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#0d1117"/>' +
    '<text x="50%" y="52%" fill="#41566b" font-family="Segoe UI,sans-serif" font-size="22" text-anchor="middle">Connecting to camera…</text></svg>');

  const locked = () => DB.settings.lockFieldsAfterPass1 && TS.passes.length > 0;

  /* ----------------------------------------------------------------------
     Two-pass normalisation. A loaded truck can never weigh less than an empty
     one, so on a normal Double ticket the HEAVIER of the two readings is
     always the gross and the lighter one always the tare — whichever button
     ("Tare" or "Gross") the operator happened to press for each pass.

     Real traffic reverses the order (an Incoming truck arrives loaded and
     leaves empty), and when the labelling came out backwards the stored pair
     was swapped, which is what produced negative net weights.

     Only these DERIVED figures are normalised. The pass log itself — sequence,
     weight, time, and the button the operator actually pressed — is kept
     exactly as captured, because that is the audit record.

     Scoped deliberately to Double mode with exactly two passes: Single mode
     falls back to the vehicle's stored tare, and Multi (3+) has no meaningful
     "the two readings" to order.
     ---------------------------------------------------------------------- */
  const seqOf = (p) => Number(p && p.seq) || (TS.passes.indexOf(p) + 1);
  function normPair() {
    if (TS.mode !== 'Double' || TS.passes.length !== 2) return null;
    const a = TS.passes[0], b = TS.passes[1];
    if (a == null || b == null || a.weight == null || b.weight == null) return null;
    const hi = (a.weight >= b.weight) ? a : b, lo = (hi === a) ? b : a;
    return { grossPass: hi, tarePass: lo, gross: hi.weight, tare: lo.weight };
  }
  function tareOf() {
    const np = normPair(); if (np) return np.tare;
    const p = TS.passes.filter(p => p.kind === 'Tare').pop(); return p ? p.weight : null;
  }
  function grossOf() {
    const np = normPair(); if (np) return np.gross;
    const p = TS.passes.filter(p => p.kind === 'Gross').pop(); return p ? p.weight : null;
  }
  function netOf() {
    let t = tareOf(), g = grossOf();
    if (TS.mode === 'Single' && t == null && TS.vehicleId) { const v = DB.map.vehicle[TS.vehicleId]; if (v && v.tare) t = v.tare; }
    return (t != null && g != null) ? g - t : null;
  }
  function requiredOk() {
    if (!TS.vehicleId || !TS.transporterId || !TS.productId || !TS.gateId) return false;
    // OTHER without the material typed in is not a complete ticket
    if (isOtherProduct() && !String(TS.otherProduct || '').trim()) return false;
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

  /* ----------------------------------------------------------------------
     Searchable master combos for the Transaction Details sheet.
     Every field is a type-ahead dropdown over its master list, and a value
     that doesn't exist yet can be added straight from the field: masters
     (transporter/product/gate) are written to the live SQL master via
     saveMaster, list fields (party, buyer, package…) extend their value
     list — persisted per-terminal in localStorage and pre-seeded with every
     distinct value already used on past tickets.
     ---------------------------------------------------------------------- */
  const LISTS_KEY = 'wc:fieldLists';
  (function mergeLocalLists() {
    try {
      const extra = JSON.parse(localStorage.getItem(LISTS_KEY) || '{}');
      Object.keys(extra).forEach(k => {
        DB.fieldLists[k] = DB.fieldLists[k] || [];
        (extra[k] || []).forEach(v => { if (DB.fieldLists[k].indexOf(v) < 0) DB.fieldLists[k].push(v); });
      });
    } catch (e) {}
  })();
  function rememberListValue(key, val) {
    DB.fieldLists[key] = DB.fieldLists[key] || [];
    if (DB.fieldLists[key].indexOf(val) < 0) DB.fieldLists[key].push(val);
    try {
      const extra = JSON.parse(localStorage.getItem(LISTS_KEY) || '{}');
      extra[key] = extra[key] || [];
      if (extra[key].indexOf(val) < 0) { extra[key].push(val); localStorage.setItem(LISTS_KEY, JSON.stringify(extra)); }
    } catch (e) {}
  }

  let cfHistory = null;   // distinct cf values used on past tickets, built once
  function cfOptions(key) {
    if (!cfHistory) {
      cfHistory = {};
      DB.transactions.forEach(t => {
        const c = t.cf || {};
        Object.keys(c).forEach(k => {
          const v = String(c[k] == null ? '' : c[k]).trim();
          if (v) (cfHistory[k] = cfHistory[k] || {})[v] = 1;
        });
      });
    }
    const seen = {}, out = [];
    const push = (v) => { const k = v.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(v); } };
    (DB.fieldLists[key] || []).forEach(push);
    Object.keys(cfHistory[key] || {}).sort().forEach(push);
    return out;
  }

  const gLabel = (id) => { const g = DB.map.gate[id]; return g ? g.name + ' (' + (g.type || 'BOTH') + ')' : ''; };

  function auditAdd(table, text) {
    DB.audit.unshift({
      id: 'AUX' + Date.now(), table, op: 'INSERT', at: new Date(),
      user: ((window.AUTH || {}).user || {}).username || 'operator', text, ref: null
    });
  }

  /* Optimistic master insert: usable immediately under a provisional id; the
     SQL IDENTITY replaces it when saveMaster returns. If SQL fails the record
     stays local-only (the ticket still carries the NAME, exactly like the
     legacy free-text flow), so the operator is never blocked. */
  function addMasterRow(entity, pre, fields, arr, mapKey, picked) {
    const rec = Object.assign({ id: pre + 'X' + Date.now() }, fields);
    arr.push(rec); DB.map[mapKey][rec.id] = rec;
    picked(rec);
    const wc = window.weighcore;
    if (wc && wc.data && wc.data.saveMaster) {
      wc.data.saveMaster({ entity, id: null, fields: rec }).then(function (r) {
        if (r && r.ok && r.id != null) {
          delete DB.map[mapKey][rec.id];
          const oldId = rec.id; rec.id = pre + r.id; DB.map[mapKey][rec.id] = rec;
          if (TS.transporterId === oldId) TS.transporterId = rec.id;
          if (TS.productId === oldId) TS.productId = rec.id;
          if (TS.gateId === oldId) TS.gateId = rec.id;
        } else {
          U.toast('warn', 'Database save failed', ((r && r.error) || 'unknown error') + ' — ' + (fields.name || 'entry') + ' kept on this terminal only.');
        }
      }).catch(function () {
        U.toast('warn', 'Database save failed', (fields.name || 'entry') + ' kept on this terminal only.');
      });
    }
  }

  const comboField = (o) =>
    '<div class="field"><label class="field__label" for="' + o.id + '">' + esc(o.label) +
      (o.req ? '<span class="req">*</span>' : '') + '</label>' +
      '<div class="combo combo--master" data-combo="' + o.key + '">' +
        '<input class="input" id="' + o.id + '" autocomplete="off" spellcheck="false"' +
        ' value="' + esc(o.value || '') + '" placeholder="' + esc(o.placeholder || 'Type to search…') + '"' +
        (o.maxLen ? ' maxlength="' + o.maxLen + '"' : '') + (o.lock ? ' readonly' : '') + '>' +
        '<div class="combo__menu"></div></div>' +
      (o.hint || '') +
    '</div>';

  /* the Receipt Details pane, extracted so field picks can refresh it in
     place without re-rendering (and re-focusing) the whole terminal */
  /* ----------------------------------------------------------------------
     Open-ticket guard.

     A Double weighment is two passes on ONE ticket. If the operator starts a
     fresh ticket for a vehicle that already has an Active one, the closing
     pass lands on the wrong record and the pair is broken — a tare from one
     visit ends up matched to a gross from another, which is one of the ways a
     negative net weight is produced.

     Status values are taken from the live schema, not assumed:
     TransactionData.Status is nvarchar(50) holding exactly 'Active',
     'Complete' or 'Void', and sqldb.js normStatus() maps those onto t.status
     unchanged. "Open" therefore means Active — never Complete, never Void.

     This reads DB.transactions only — the snapshot of THIS terminal's own
     local database — so no network call is added to the weighing path.
     ---------------------------------------------------------------------- */
  function openTicketFor(vehicleId, exceptTicketId) {
    if (!vehicleId) return null;
    // DB.transactions is newest-first, so find() returns the most recent one
    return DB.transactions.find(t => t.vehicleId === vehicleId &&
      t.status === 'Active' && (t.passes || []).length && !t.deleted &&
      t.id !== exceptTicketId) || null;
  }
  /* which pass that open ticket already holds, and which one it is still owed */
  function openTicketNeed(t) {
    const last = (t.passes || [])[t.passes.length - 1] || {};
    const done = last.kind === 'Tare' ? 'Tare' : 'Gross';
    return { done, need: done === 'Tare' ? 'Gross' : 'Tare', at: last.at || t.at, ticketNo: t.ticketNo };
  }
  /* inline hint rendered directly under the Vehicle field the moment a vehicle
     with an open ticket is chosen — the operator sees it before typing anything else */
  function openTicketHintHtml() {
    if (TS.recallOf) return '';                    // already working on that very ticket
    const t = openTicketFor(TS.vehicleId);
    if (!t) return '';
    const n = openTicketNeed(t);
    return '<div style="margin-top:var(--sp-2)">' + U.callout('warn',
      '<b>Open ticket #' + n.ticketNo + ' — ' + n.done.toUpperCase() + ' captured' +
      (n.at ? ' at ' + esc(fDT(n.at)) : '') + '.</b><br>' +
      'The next weighing for this vehicle must be <b>' + n.need.toUpperCase() +
      '</b>, on that same ticket. Recall #' + n.ticketNo + ' instead of starting a new ticket.') + '</div>';
  }

  function receiptHtml() {
    const veh = DB.map.vehicle[TS.vehicleId];
    const t = tareOf(), g = grossOf(), n = netOf();
    const rrow = (k, v) => '<div class="receipt__row"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
    return '<dl class="receipt">' +
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
  }

  V.terminal = {
    render() {
      syncEdge();
      const wb = DB.map.wb[DB.settings.connectedScale] || { name: 'No scale', siteId: 'S1', indicator: '—', port: '—', baud: 0 };
      // one fixed screen, like the legacy create-transaction page — no page scroll
      return '<div class="termwrap">' +
        '<div class="termbar">' +
          '<span class="termbar__label">Load by Ticket/Vehicle No:</span>' +
          // type-ahead over the OPEN tickets — search by ticket, vehicle or product
          '<div class="combo combo--master" style="flex:0 1 300px">' +
            '<input class="input" id="recall" autocomplete="off" spellcheck="false" placeholder="— open tickets: type to search —">' +
            '<div class="combo__menu"></div></div>' +
          '<button class="btn" id="btnReset">' + icon('refresh') + 'New<kbd>Ctrl</kbd><kbd>N</kbd></button>' +
          '<div class="spacer"></div>' +
          '<span class="termbar__scale">' + esc(wb.name) + ' · ' + esc(wb.port) + ' @ ' + wb.baud + '</span>' +
        '</div>' +
        '<div class="terminal" id="term">' + this.left() + this.right() + '</div>' +
      '</div>';
    },

    /* ---- left: the legacy "Transaction Details" sheet ---- */
    left() {
      /* "Lock fields after the first pass" now protects only the two fields
         that are not metadata: the vehicle number plate (changing it would
         re-point a half-finished weighment at a different truck) and the
         transaction datetime (changing it would move a ticket into a different
         reporting window after the fact).

         Everything else — transporter, product, gate and the configurable
         fields such as Vehicle Type, Party Name, Buyer Name and Package No —
         stays editable while the closing weighment is captured, because those
         are routinely corrected at the gross pass. Weights are never editable
         here: they come from the indicator, and there is no manual entry. */
      const lock = locked();
      const lockNote = lock ? U.callout('info',
        '<b>Weights and vehicle are fixed.</b> The first weighment is recorded, so the number plate and transaction datetime can no longer change ' +
        '(<i>Global settings → lock after first pass</i>). Transporter, product, gate and the detail fields can still be corrected.') : '';

      const veh = DB.map.vehicle[TS.vehicleId];
      const vehicleField =
        '<div class="field"><label class="field__label" for="vehicle">Vehicle<span class="req">*</span></label>' +
          '<div class="inputgroup">' +
            '<div class="combo combo--master" data-combo="vehicle">' +
              '<input class="input" id="vehicle" autocomplete="off" spellcheck="false" placeholder="Type or scan a number plate…" value="' + esc(veh ? veh.no : '') + '"' + (lock ? ' readonly' : '') + '>' +
              '<div class="combo__menu"></div></div>' +
            '<button class="btn" id="btnAddVeh" title="Quick-add vehicle"' + (lock ? ' disabled' : '') + '>' + icon('plus') + '</button></div>' +
          (veh ? '<div class="field__hint">' + (veh.tare ? 'Stored tare <b>' + num(veh.tare) + ' kg</b>' : '<span style="color:var(--danger)">No stored tare on file</span>') +
            (veh.type ? ' · ' + esc(veh.type) : '') + ' · ' + esc(aName(veh.accountId)) + '</div>' : '') +
          openTicketHintHtml() +
        '</div>';

      // Masters down the left column, configurable fields down the right —
      // every field is a searchable combo over its master list, and a value
      // not on file yet can be added from the field itself ("＋ Add …" row).
      const masters = [
        vehicleField,
        // metadata — editable even after the first pass (see lockNote above)
        comboField({ key: 'transporter', id: 'transporter', label: 'Transporter', req: true, placeholder: 'Search or add transporter…', value: TS.transporterId ? aName(TS.transporterId) : '' }),
        // Product, and directly beneath it the free-text material box shown only
        // for Disposal + OTHER. Both share ONE grid cell on purpose: as separate
        // cells the box landed in the next row of the left column, reading as if
        // it belonged to whichever custom field sat beside it (Buyer Name), and
        // it pushed Gate and Datetime down a row each time OTHER was picked.
        '<div>' +
          comboField({ key: 'product', id: 'product', label: 'Product', req: true, placeholder: 'Search or add product…', value: TS.productId ? pName(TS.productId) : '' }) +
          (isOtherProduct()
            ? '<div class="field" style="margin-top:var(--sp-3)"><label class="field__label" for="otherProd">Enter Details<span class="req">*</span></label>' +
              '<input class="input" id="otherProd" autocomplete="off" spellcheck="false" maxlength="60"' +
              ' placeholder="Type the material, e.g. Coconut Shell" value="' + esc(TS.otherProduct || '') + '">' +
              '<div class="field__hint">Saved on this ticket only — it is never added to the Product master.</div></div>'
            : '') +
        '</div>',
        comboField({ key: 'gate', id: 'gate', label: 'Gate', req: true, placeholder: 'Search or add gate…', value: gLabel(TS.gateId) }),
        U.field({ label: 'Transaction Datetime', id: 'txnAt', type: 'datetime-local', value: U.fInput(DB.NOW), disabled: !DB.settings.enableTxnDateTime || lock })
      ];
      // configurable fields (Vehicle Type, Party Name, Buyer Name, Package No …)
      // are metadata too — never locked
      const cfs = DB.customFields.filter(f => f.visible).map(f => comboField({
        key: f.key, id: f.key, label: f.label, req: f.required, maxLen: f.maxLen,
        placeholder: 'Search or add…', value: TS.cf[f.key] || ''
      }));
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
              // Direction applies to RDF alone. Disposal used to show it with
              // "Plant to Yard" as the only choice, which was noise on every
              // disposal ticket; Processing never showed it.
              (hasDirection(TS.txnType)
                ? '<div class="row"><div class="field__label termlbl">Direction</div>' +
                  U.seg('direction', directionOpts(TS.txnType), TS.direction) + '</div>'
                : '') +
              '<hr class="hr" style="margin:2px 0">' +
              '<div class="formgrid formgrid--2">' + sheet.join('') + '</div>' +
            '</div>'
        }) +
        '<div class="row">' +
          '<button class="btn btn--primary btn--lg" id="btnContinue"' + (requiredOk() && !savingTicket ? '' : ' disabled') + '>' +
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
        : '<div class="led is-stable" id="led"><div class="led__scan"></div>' +
            '<div class="led__value" id="ledVal">' + num(TS.live || 0) + '<sub>kg</sub></div>' +
            '<div class="led__meta">' +
              '<span class="ledpill">Capacity ' + num(wb.capacity) + ' kg</span>' +
            '</div></div>';

      const shots = [];
      TS.passes.forEach(p => (p.images || []).forEach((src, i) =>
        shots.push({ src, cap: 'camera ' + (i + 1) + ' Weighment: #' + p.seq })));

      // field picks refresh #rcpBox in place, so typing focus is never lost
      const receipt = '<div id="rcpBox">' + receiptHtml() + '</div>';
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
              // manual entry removed by client request: weight comes ONLY from
              // the indicator, so the Automatic/Manual toggle and the keyed-in
              // weight box are gone — one capture button, indicator-fed
              '<div class="capbar">' +
                '<button class="btn btn--capture" id="btnCapture"' + (offline ? ' disabled' : '') + '>' +
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

      // a remount must never inherit a stuck guard from the previous mount
      savingTicket = false; capturingPass = false; gateOverride = null;
      const syncBtns = () => {
        const c = U.$('#btnContinue', term); if (c) c.disabled = savingTicket || !requiredOk();
        const p = U.$('#btnCapture', term); if (p && capturingPass) p.disabled = true;
      };

      // Real indicator weight (desktop app) drives the LED, replacing the demo simulation.
      if (NATIVE) {
        weightSub = function (e) {
          const d = e.detail || {};
          TS.live = Math.max(0, Math.round(d.value || 0));
          TS.stable = !!d.stable;
          if (!EDGE.connected) { EDGE.connected = true; repaint(); return; }  // data proves the link
          const ledVal = U.$('#ledVal'), led = U.$('#led');
          if (ledVal) {
            ledVal.innerHTML = num(TS.live) + '<sub>kg</sub>';
            led.className = 'led is-stable';
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
        // Abort the old tiles' MJPEG connections BEFORE replacing the DOM —
        // detached streaming <img>s hold their sockets and exhaust Chromium's
        // 6-per-host limit, after which new tiles hang on the placeholder.
        U.$$('.cam img', term).forEach(im => { im.onerror = null; im.removeAttribute('src'); });
        term.innerHTML = self.left() + self.right();
        wireMasterCombos();
        refreshRecall();
        if (self._wireCams) self._wireCams();
      }

      // The recall combo builds its option list live at every open, so a Tare
      // weighment just saved is recallable immediately — nothing to refresh.
      function refreshRecall() {}

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
      // Demo (browser) only: seed a simulated live weight. The real desktop terminal
      // must read 0 until the indicator actually sends a value — never a fake number.
      TS.target = pickTarget(); if (!NATIVE) TS.live = TS.target;

      timer = setInterval(() => {
        const now = Date.now();
        if (now > settleAt + 5200) { settleAt = now; }              // re-enter a settle cycle
        const settling = now - settleAt < 2000;
        const noise = settling ? 45 : DB.settings.stabilityToleranceKg * 0.35;
        if (!NATIVE) {
          TS.live = Math.max(0, Math.round((TS.target + (Math.random() - 0.5) * 2 * noise) / 10) * 10);
          TS.stable = !settling;
        }

        const ledVal = U.$('#ledVal'), led = U.$('#led');
        if (ledVal) {
          ledVal.innerHTML = num(TS.live) + '<sub>kg</sub>';
          led.className = 'led is-stable';
        }
        const chip = U.$('#scaleChipWeight'); if (chip) chip.textContent = num(TS.live) + ' kg';
        U.$$('[data-clock]').forEach(el => {
          const d = new Date(DB.NOW.getTime() + (now % 60000));
          el.textContent = fDate(d) + ' ' + U.fSec(d);
        });
      }, 380);

      if (NATIVE) {
        // Live tiles play the local MJPEG relay directly — Chromium renders the
        // 10 fps stream natively. No polling, no per-frame IPC, real motion.
        let realCams = null;
        const wireCams = () => {
          const go = (cs) => U.$$('.cam img', term).forEach((im, i) => {
            if (!cs[i] || !cs[i].stream || im.dataset.live) return;
            im.dataset.live = '1';
            const src = cs[i].stream;
            im.onerror = () => { setTimeout(() => { if (im.isConnected) im.src = src + '?r=' + Date.now(); }, 2000); };
            im.src = src;
          });
          if (realCams) go(realCams);
          else window.weighcore.listCameras().then(cs => { realCams = cs; go(cs); }).catch(() => {});
        };
        wireCams();
        this._wireCams = wireCams;                    // repaint() re-runs this for fresh tiles
      } else {
        camTimer = setInterval(() => {
          camIdx = (camIdx + 1) % DB.LIVE.length;
          U.$$('.cam img', term).forEach((im, i) => { im.src = DB.LIVE[(camIdx + i * 3) % DB.LIVE.length]; });
        }, 2600);
      }

      /* searchable master combos — every Transaction Details field */
      function refreshReceipt() {
        const box = U.$('#rcpBox', term); if (box) box.innerHTML = receiptHtml();
        syncBtns();
      }
      function pickVehicle(vid) {
        gateOverride = null;                            // a new vehicle re-arms the open-ticket gate
        if (!vid) { TS.vehicleId = ''; TS.target = pickTarget(); repaint(); return; }
        const v = DB.map.vehicle[vid]; if (!v) return;
        TS.vehicleId = v.id;
        // fetch the remaining details from this vehicle's most recent ticket,
        // like the legacy "Load by Vehicle No" (transactions are newest-first)
        const lastT = DB.transactions.find(t => t.vehicleId === v.id) || null;
        if (lastT) {
          if (lastT.type) TS.txnType = lastT.type;
          if (lastT.direction) TS.direction = lastT.direction;
          if (lastT.transporterId) TS.transporterId = lastT.transporterId;
          if (lastT.productId) TS.productId = lastT.productId;
          if (lastT.gateId) TS.gateId = lastT.gateId;
          const c = lastT.cf || {};
          if (c.cf2) TS.cf.cf2 = c.cf2;
          if (c.cf3) TS.cf.cf3 = c.cf3;
          if (c.cf4) TS.cf.cf4 = c.cf4;
        }
        TS.transporterId = TS.transporterId || v.accountId;
        // the prefill above can move the product off OTHER without going through
        // the product picker, so drop any typed material that no longer applies
        if (!isOtherProduct()) TS.otherProduct = '';
        if (v.type) TS.cf.cf1 = v.type;
        TS.target = pickTarget();
        repaint();
        const vi = U.$('#vehicle', term); if (vi) vi.focus();
        // an open ticket outranks the routine "vehicle loaded" note
        const openNow = TS.recallOf ? null : openTicketFor(v.id);
        if (openNow) {
          const n = openTicketNeed(openNow);
          U.toast('warn', 'Ticket #' + n.ticketNo + ' is still open for ' + v.no,
            n.done.toUpperCase() + ' already captured — the next weighing must be ' + n.need.toUpperCase() + ' on that same ticket.');
        } else {
          U.toast('info', 'Vehicle loaded', v.no +
            (lastT ? ' · details fetched from ticket #' + lastT.ticketNo : (v.tare ? ' · stored tare ' + num(v.tare) + ' kg' : ' · no stored tare on file')));
        }
      }
      function comboDefs() {
        const defs = {
          vehicle: {
            list: () => DB.vehicles.filter(v => v.active).map(v => ({ v: v.id, t: v.no,
              sub: v.type || 'type not set', right: v.tare ? num(v.tare) + ' kg' : '⚠ no tare' })),
            display: () => { const v = DB.map.vehicle[TS.vehicleId]; return v ? v.no : ''; },
            pick: pickVehicle,
            addLabel: (q) => 'Add vehicle “' + q.toUpperCase() + '”…',
            add: (no) => quickAddVehicle(repaint, no.toUpperCase())
          },
          transporter: {
            list: () => transporters().map(a => ({ v: a.id, t: a.name })),
            display: () => TS.transporterId ? aName(TS.transporterId) : '',
            pick: (id) => { TS.transporterId = id; refreshReceipt(); },
            addLabel: (q) => 'Add transporter “' + q + '”',
            add: (name) => addMasterRow('accounts', 'A',
              { name, phone: '', city: '', isTransporter: true, isAccount: false, active: true },
              DB.accounts, 'account', (rec) => {
                TS.transporterId = rec.id; refreshReceipt();
                auditAdd('Account', 'Transporter ' + name + ' added from the terminal');
                U.toast('ok', 'Transporter added', name + ' is on file and selected.');
              })
          },
          product: {
            list: () => productsForType(TS.txnType).map(p => ({ v: p.id, t: p.name })),
            display: () => TS.productId ? pName(TS.productId) : '',
            pick: (id) => {
              const wasOther = isOtherProduct();
              TS.productId = id;
              // moving off OTHER discards the typed material rather than quietly
              // carrying it onto a different product
              if (!isOtherProduct()) TS.otherProduct = '';
              // the Enter Details field lives in the LEFT form, which
              // refreshReceipt() does not redraw — a full repaint is required
              // whenever that field has to appear or disappear
              if (wasOther !== isOtherProduct()) repaint(); else refreshReceipt();
            },
            addLabel: (q) => 'Add product “' + q + '”',
            add: (name) => addMasterRow('products', 'P',
              { name, code: '', desc: '', txnType: 'All', active: true },
              DB.products, 'product', (rec) => {
                TS.productId = rec.id; refreshReceipt();
                auditAdd('Product', 'Product ' + name + ' added from the terminal');
                U.toast('ok', 'Product added', name + ' is on file and selected.');
              })
          },
          gate: {
            list: () => DB.gates.filter(g => g.active).map(g => ({ v: g.id, t: g.name + ' (' + (g.type || 'BOTH') + ')' })),
            display: () => gLabel(TS.gateId),
            pick: (id) => { TS.gateId = id; refreshReceipt(); },
            addLabel: (q) => 'Add gate “' + q + '”',
            add: (name) => addMasterRow('gates', 'G',
              { name, type: 'BOTH', active: true },
              DB.gates, 'gate', (rec) => {
                TS.gateId = rec.id; refreshReceipt();
                auditAdd('Gate', 'Gate ' + name + ' added from the terminal');
                U.toast('ok', 'Gate added', name + ' is on file and selected.');
              })
          }
        };
        DB.customFields.filter(f => f.visible).forEach(f => {
          defs[f.key] = {
            list: () => cfOptions(f.key).map(v => ({ v, t: v })),
            display: () => TS.cf[f.key] || '',
            pick: (v) => { TS.cf[f.key] = v; refreshReceipt(); },
            addLabel: (q) => 'Add “' + q + '” to ' + f.label,
            add: (val) => {
              rememberListValue(f.key, val);
              TS.cf[f.key] = val; refreshReceipt();
              U.toast('ok', f.label + ' added', '“' + val + '” saved to the list and selected.');
            }
          };
        });
        return defs;
      }
      function wireMasterCombos() {
        const defs = comboDefs();
        U.$$('[data-combo]', term).forEach(wrap => {
          const def = defs[wrap.dataset.combo];
          const inp = wrap.querySelector('input'), menu = wrap.querySelector('.combo__menu');
          if (!def || !inp || !menu || inp.readOnly || inp.dataset.wired) return;
          inp.dataset.wired = '1';
          let items = [], canAdd = false, cursor = 0;
          const close = () => wrap.classList.remove('is-open');
          const build = () => {
            const q = inp.value.trim(), ql = q.toLowerCase();
            const all = def.list();
            items = (ql ? all.filter(o => String(o.t).toLowerCase().indexOf(ql) >= 0) : all).slice(0, 30);
            canAdd = !!(q && def.add && !all.some(o => String(o.t).toLowerCase() === ql));
            const last = items.length - (canAdd ? 0 : 1);
            if (cursor > last) cursor = last;
            if (cursor < 0) cursor = 0;
            menu.innerHTML =
              items.map((o, i) =>
                '<div class="combo__opt' + (i === cursor ? ' is-cursor' : '') + '" data-i="' + i + '"><b>' + esc(o.t) + '</b>' +
                (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') +
                (o.right ? '<span class="spacer"></span><small class="mono">' + esc(o.right) + '</small>' : '') + '</div>').join('') +
              (canAdd ? '<div class="combo__opt combo__add' + (cursor === items.length ? ' is-cursor' : '') + '" data-add="1"><b>＋ ' + esc(def.addLabel(q)) + '</b></div>' : '') +
              (!items.length && !canAdd ? '<div class="combo__empty">Nothing matches</div>' : '');
            wrap.classList.add('is-open');
          };
          const choose = (i) => {
            if (canAdd && i === items.length) { const q = inp.value.trim(); close(); def.add(q); }
            else if (items[i]) {
              def.pick(items[i].v);
              const el = U.$('#' + inp.id, term); if (el) el.value = def.display();
              close();
            }
          };
          inp.addEventListener('focus', () => { inp.select(); cursor = 0; build(); });
          inp.addEventListener('input', () => { cursor = 0; build(); });
          inp.addEventListener('keydown', (e) => {
            if (!wrap.classList.contains('is-open')) {
              if (e.key === 'ArrowDown') { e.preventDefault(); cursor = 0; build(); }
              return;
            }
            const max = items.length - (canAdd ? 0 : 1);
            if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, max); build(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); build(); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(cursor); }
            else if (e.key === 'Escape') { close(); }
          });
          inp.addEventListener('blur', () => setTimeout(() => {
            close();
            const el = U.$('#' + inp.id, term); if (!el) return;   // a repaint replaced the DOM
            if (!el.value.trim() && def.display()) def.pick('');   // emptied on purpose → clear
            el.value = def.display();                              // otherwise resync to the picked value
          }, 160));
          menu.addEventListener('mousedown', (e) => {
            e.preventDefault();                                    // keep typing focus in the input
            const add = e.target.closest('[data-add]'); if (add) { choose(items.length); return; }
            const o = e.target.closest('[data-i]'); if (o) choose(parseInt(o.dataset.i, 10));
          });
        });
      }
      wireMasterCombos();

      /* delegated events */
      term.addEventListener('click', (e) => {
        const s = e.target.closest('[data-seg] .seg__opt');
        if (s) {
          const key = s.closest('[data-seg]').dataset.seg, v = s.dataset.v;
          if (key === 'mode') TS.mode = v;
          else if (key === 'weighType') { TS.weighType = v; TS.target = pickTarget(); }
          else if (key === 'txnType') {
            TS.txnType = v;
            // a direction that this type does not offer must not survive the
            // switch; types without one carry no direction at all
            if (!hasDirection(v)) TS.direction = null;
            else if (!directionOpts(v).some(o => o.v === TS.direction)) TS.direction = DIR_PLANT.v;
            // Drop the current product if it does not belong to the new type —
            // including when it no longer resolves at all, which happens after a
            // master sync deactivates or removes it. Without the !pp case a dead
            // id survived every switch and the field just showed a dash.
            const pp = DB.map.product[TS.productId];
            if (TS.productId && (!pp || (pp.txnType && pp.txnType !== v))) TS.productId = '';
            // Processing and RDF fill their product in automatically
            if (!TS.productId) TS.productId = defaultProductFor(v);
          }
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
        if (e.target.closest('#btnAddVeh')) {
          const vi = U.$('#vehicle', term);
          quickAddVehicle(repaint, vi && !DB.map.vehicle[TS.vehicleId] ? vi.value.trim().toUpperCase() : '');
          return;
        }
      });

      // master/list fields update TS through their combo picks; typing only
      // needs to keep the Continue button's enabled state honest
      term.addEventListener('input', (e) => {
        // the OTHER free-text material is plain typing, not a combo pick
        if (e.target && e.target.id === 'otherProd') TS.otherProduct = e.target.value;
        syncBtns();
      });

      /* recall — type-ahead over the open tickets (ticket / vehicle / product) */
      function recallTicket(t) {
        Object.assign(TS, {
          recallOf: t.id, ticketNo: t.ticketNo, rid: t.rid || genRid(),   // keep ticket no + id so Gross photos file under the SAME transaction as the Tare photos
          mode: t.mode, txnType: t.type, direction: t.direction || 'Plant to Yard',
          vehicleId: t.vehicleId, transporterId: t.transporterId, productId: t.productId,
          gateId: t.gateId, driverId: t.driverId, cf: Object.assign({}, t.cf),
          passes: t.passes.map(p => Object.assign({}, p, { fromDb: !!t.rid })),
          weighType: t.passes[t.passes.length - 1].kind === 'Tare' ? 'Gross' : 'Tare'
        });
        TS.target = pickTarget();
        repaint();
        U.toast('info', 'Ticket #' + t.ticketNo + ' recalled', 'Fields locked — capture the closing weight.');
      }

      /* The hard gate. Shown when Continue would create a second ticket for a
         vehicle that already has an open one. The primary action recalls the
         real ticket so the operator lands on the right record with no searching;
         the escape hatch stays available for a genuinely stuck old ticket, but
         is deliberately secondary. */
      function openTicketGate(open) {
        const n = openTicketNeed(open);
        const vno = vName(open.vehicleId);
        U.openModal(
          '<div class="modal__head"><div><div class="card__title">' + esc(vno) + ' already has an open ticket</div>' +
          '<div class="card__sub">Ticket #' + open.ticketNo + ' · ' + esc(pName(open.productId)) + '</div></div>' +
          '<div class="spacer"></div><button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
          '<div class="modal__body">' +
          U.callout('warn',
            '<b>Vehicle ' + esc(vno) + ' already has an OPEN ticket #' + open.ticketNo + ' — ' +
            n.done.toUpperCase() + ' was captured' + (n.at ? ' at ' + esc(fDT(n.at)) : '') + '.</b><br>' +
            'The next weighing for this vehicle must be <b>' + n.need.toUpperCase() +
            '</b>, on that same ticket, not a new ' + n.done.toLowerCase() + '.') +
          '<div style="height:var(--sp-4)"></div>' +
          '<div class="tiny dim">Starting a second ticket splits one truck visit across two records: the ' +
          n.need.toLowerCase() + ' gets paired with the wrong ' + n.done.toLowerCase() +
          ', which is how broken pairings and negative net weights appear.</div>' +
          '</div>' +
          '<div class="modal__foot">' +
            '<button class="btn btn--primary btn--lg" id="otOpen">' + icon('check') + 'Open ticket #' + open.ticketNo + '</button>' +
            '<div class="spacer"></div>' +
            '<button class="btn btn--sm" id="otAnyway">Start a new ticket anyway</button>' +
            '<button class="btn btn--sm" data-close>Cancel</button>' +
          '</div>');
        U.$('#otOpen').addEventListener('click', () => { U.closeModal(); recallTicket(open); });
        U.$('#otAnyway').addEventListener('click', () => {
          U.closeModal();
          gateOverride = open.id;                 // this one vehicle, this one time
          U.toast('warn', 'Starting a second ticket', 'Ticket #' + open.ticketNo + ' is still open for ' + vno + '.');
          complete();
        });
      }
      const rec = U.$('#recall', root);
      if (rec) {
        const wrap = rec.closest('.combo'), menu = wrap.querySelector('.combo__menu');
        let items = [], cursor = 0;
        const close = () => wrap.classList.remove('is-open');
        const build = () => {
          const q = rec.value.trim().toLowerCase();
          items = DB.transactions.filter(t => t.status === 'Active' && t.passes.length).filter(t => !q ||
            String(t.ticketNo).indexOf(q) >= 0 ||
            vName(t.vehicleId).toLowerCase().indexOf(q) >= 0 ||
            prodOf(t).toLowerCase().indexOf(q) >= 0).slice(0, 20);
          if (cursor > items.length - 1) cursor = items.length - 1;
          if (cursor < 0) cursor = 0;
          menu.innerHTML = items.length ? items.map((t, i) =>
            '<div class="combo__opt' + (i === cursor ? ' is-cursor' : '') + '" data-i="' + i + '"><b>#' + t.ticketNo + '</b>' +
            '<small>' + esc(vName(t.vehicleId)) + ' · ' + esc(prodOf(t)) + '</small></div>').join('')
            : '<div class="combo__empty">No open ticket matches</div>';
          wrap.classList.add('is-open');
        };
        const choose = (i) => {
          const t = items[i]; if (!t) return;
          rec.value = '#' + t.ticketNo + ' · ' + vName(t.vehicleId);
          close();
          recallTicket(t);
        };
        rec.addEventListener('focus', () => { rec.select(); cursor = 0; build(); });
        rec.addEventListener('input', () => { cursor = 0; build(); });
        rec.addEventListener('keydown', (e) => {
          if (!wrap.classList.contains('is-open')) {
            if (e.key === 'ArrowDown') { e.preventDefault(); cursor = 0; build(); }
            return;
          }
          if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, items.length - 1); build(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); build(); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(cursor); }
          else if (e.key === 'Escape') close();
        });
        rec.addEventListener('blur', () => setTimeout(close, 160));
        menu.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const o = e.target.closest('[data-i]'); if (o) choose(parseInt(o.dataset.i, 10));
        });
      }
      const br = U.$('#btnReset', root);
      if (br) br.addEventListener('click', () => { resetTS(); if (rec) rec.value = ''; repaint(); });

      /* actions */
      function capture() {
        if (capturingPass) return;              // a capture is already running
        // manual entry removed by client request — the ONLY weight source is
        // the live indicator reading; nothing can be keyed in by hand
        const w = TS.live;
        if (NATIVE && !EDGE.connected) {
          U.toast('danger', 'Indicator disconnected', 'No live link to the weight indicator — weighing resumes when the serial link is restored.'); return;
        }
        if (!w || w <= 0) {
          U.toast('warn', 'No weight on the bridge', 'The indicator reads 0 kg — position the vehicle on the scale.'); return;
        }
        // no stability gate: Capture takes the reading and the images the
        // moment the button is pressed, exactly like the legacy terminal
        // a fresh Double ticket takes exactly ONE weighment here: store it with
        // Continue, then recall the ticket for the closing weighment — never
        // two captures back-to-back on the same standing truck
        if (TS.mode === 'Double' && !TS.recallOf && TS.passes.length >= 1) {
          U.toast('warn', 'First weighment already captured', 'Press Continue (F7) to store the ticket — recall it by ticket/vehicle no for the closing weighment.'); return;
        }
        if (TS.passes.some(p => p.kind === TS.weighType) && TS.mode !== 'Multi') {
          U.toast('warn', 'Already captured', 'A ' + TS.weighType.toLowerCase() + ' weight exists on this ticket.'); return;
        }
        const wb = DB.map.wb[DB.settings.connectedScale];
        const _pass = {
          seq: TS.passes.length + 1, kind: TS.weighType, weight: w, at: new Date(),
          scale: wb.name, mode: 'Auto',
          // real frames only — never the demo template shots on the desktop app
          images: NATIVE ? [] : [DB.IMGS[TS.passes.length * 2 % 4], DB.IMGS[(TS.passes.length * 2 + 1) % 4]]
        };
        capturingPass = true;                   // cleared once this pass settles
        const releaseCapture = () => { capturingPass = false; syncBtns(); };
        TS.passes.push(_pass);
        // Grab a real frame from every camera and persist it with the pass.
        if (NATIVE) {
          window.WeighCoreNative.captureTicketPhotos({ rid: TS.rid, ticketNo: TS.ticketNo, seq: _pass.seq, kind: _pass.kind }).then(res => {
            if (res && res.results) {
              const real = res.results.filter(x => x.ok && x.dataUrl).map(x => x.dataUrl);
              if (real.length) { _pass.images = real; try { repaint(); } catch (e) {} }
            }
          }).catch(() => {}).then(releaseCapture, releaseCapture);
        } else releaseCapture();
        U.$$('.cam__flash', term).forEach(f => { f.classList.remove('is-fire'); void f.offsetWidth; f.classList.add('is-fire'); });
        const nCam = DB.cameras.filter(c => c.wbId === wb.id).length;
        U.toast('ok', TS.weighType + ' captured — ' + num(w) + ' kg',
          nCam + ' camera image' + (nCam === 1 ? '' : 's') + ' attached to pass ' + TS.passes.length);
        // only Multi mode rolls to the next weighment type on the same form —
        // a Double ticket's second entry happens via recall, never here
        if (TS.mode === 'Multi') TS.weighType = TS.weighType === 'Tare' ? 'Gross' : 'Tare';
        TS.target = pickTarget();
        repaint();
      }

      function complete() {
        if (savingTicket) return;                       // a ticket save is already in flight — ignore the extra press
        if (!requiredOk()) { U.toast('warn', 'Incomplete', 'Fill every required field and capture a weight.'); return; }
        // Hard gate: never let Continue create a SECOND ticket for a vehicle that
        // already has an open one. This catches an operator moving too fast to
        // read the inline hint under the Vehicle field.
        if (!TS.recallOf) {
          const openT = openTicketFor(TS.vehicleId);
          if (openT && gateOverride !== openT.id) { openTicketGate(openT); return; }
        }
        savingTicket = true; syncBtns();                // claimed synchronously, before any await point
        const finishing = willComplete();               // false = first weighment only -> ticket saved as Active (legacy flow)
        const n = netOf();
        const np = normPair();                          // non-null on a two-pass Double ticket: heavier reading = gross
        const wb = DB.map.wb[DB.settings.connectedScale];
        const rec = TS.recallOf ? DB.transactions.find(t => t.id === TS.recallOf) : null;
        const me = (window.AUTH && window.AUTH.user) || {};
        const t = rec || {
          id: 'T' + TS.ticketNo, ticketNo: TS.ticketNo, at: new Date(),
          siteId: wb.siteId, wbId: wb.id, operatorId: me.id || 'US1', charges: 0, voidReason: null
        };
        Object.assign(t, {
          status: finishing ? 'Complete' : 'Active', mode: TS.mode, type: TS.txnType,
          direction: hasDirection(TS.txnType) ? TS.direction : null,
          vehicleId: TS.vehicleId, transporterId: TS.transporterId,
          accountId: rec ? rec.accountId : null,
          driverId: TS.driverId, gateId: TS.gateId,
          // OTHER: no master row, so the on-screen ticket carries the typed name
          // exactly as the saved weighment row will (see prodOf)
          productId: isOtherProduct() ? null : TS.productId,
          productName: ticketProductName(),
          tare: tareOf(), gross: grossOf(), net: n,
          tareAt: ((np ? np.tarePass : TS.passes.filter(p => p.kind === 'Tare').pop()) || {}).at || null,
          grossAt: ((np ? np.grossPass : TS.passes.filter(p => p.kind === 'Gross').pop()) || {}).at || null,
          passes: TS.passes.slice(), cf: Object.assign({}, TS.cf),
          manual: TS.passes.some(p => p.mode === 'Manual')
        });
        if (!rec) DB.transactions.unshift(t);

        const finish = function () {
          savingTicket = false;                         // the one and only release point
          gateOverride = null;                          // next truck gets the gate again
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
            receiptTicketId: TS.rid || (isUpdate ? rec.rid : null),
            ticketNo: isUpdate ? rec.ticketNo : null,   // fresh tickets get MAX+1 inside the DB transaction
            status: finishing ? 'Complete' : 'Active', mode: TS.mode,
            transactionType: ({ Processing: 'Incoming', Disposal: 'Outgoing', RDF: 'Both' })[TS.txnType] || 'Incoming',
            direction: hasDirection(TS.txnType) ? TS.direction : null,
            vehicleId: sqlIdOf(TS.vehicleId, 'V'), vehicleNo: veh2.no || '',
            transporterId: sqlIdOf(TS.transporterId, 'A'),
            transporterName: TS.transporterId ? aName(TS.transporterId) : null,
            accountId: null, accountName: null,
            driverId: sqlIdOf(TS.driverId, 'D'),
            driverName: TS.driverId ? dName(TS.driverId) : null,
            // OTHER stores the typed material as the name with NO ProductID, so it
            // lives on this ticket alone and never enters the Product master
            productId: isOtherProduct() ? null : sqlIdOf(TS.productId, 'P'),
            productName: ticketProductName(),
            gateId: sqlIdOf(TS.gateId, 'G'), gateName: TS.gateId ? gName(TS.gateId) : null,
            weightBridgeId: sqlIdOf(wb.id, 'WB'), weighbridgeName: wb.name,
            charges: 0, createdBy: sqlIdOf(me.id, 'US'), userName: me.username || null,
            createdAt: fSqlDT(t.at),
            cf1: TS.cf.cf1 || null, cf2: TS.cf.cf2 || null, cf3: TS.cf.cf3 || null,
            cf4: TS.cf.cf4 || null, cf5: TS.cf.cf5 || null,
            passes: newPasses.map((p, i, arr) => ({
              seq: p.seq || (i + 1), kind: p.kind, weight: p.weight, at: fSqlDT(p.at),
              net: (i === arr.length - 1) ? n : null, manual: p.mode === 'Manual'
            })),
            // Final Gross/Tare/Net for a completing two-pass ticket, ordered
            // heavier-is-gross. Sent as its own block rather than folded into
            // the pass rows because on a RECALLED ticket only the new pass is
            // inserted here — the first pass's row is already in the database
            // and has to be corrected too, or the swapped pair survives.
            normalize: (finishing && np) ? {
              grossSeq: seqOf(np.grossPass), tareSeq: seqOf(np.tarePass),
              netSeq: Math.max(seqOf(np.grossPass), seqOf(np.tarePass)),
              gross: np.gross, tare: np.tare, net: n
            } : null
          };
          // try/catch as well as .catch: a synchronous throw here would otherwise
          // strand savingTicket and lock the terminal out of every later save.
          try {
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
          } catch (e) {
            U.toast('danger', 'Database save failed', String((e && e.message) || e) + ' — ticket kept on screen.');
            finish();
          }
        } else {
          finish();
        }
      }

      /* keyboard */
      this._keys = (e) => {
        if (U.anyOpen()) return;
        // OS key auto-repeat fires keydown ~30x/sec while a key is held. Without
        // this, holding F7 replayed the whole save that many times — the cause of
        // the tickets carrying several identical passes. One press = one action.
        if (e.repeat) return;
        if (e.key === 'F8') { e.preventDefault(); capture(); }
        if (e.key === 'F7') { e.preventDefault(); complete(); }
      };
      window.addEventListener('keydown', this._keys);
    },

    unmount() {
      clearInterval(timer); clearInterval(camTimer);
      document.querySelectorAll('.cam img').forEach(im => { im.onerror = null; im.removeAttribute('src'); });
      this._wireCams = null;
      if (weightSub) { window.removeEventListener('wc:weight', weightSub); weightSub = null; }
      if (edgeSub) { window.removeEventListener('wc:edge', edgeSub); edgeSub = null; }
      window.removeEventListener('keydown', this._keys);
      const chip = U.$('#scaleChipWeight'); if (chip) chip.textContent = '0 kg';
    }
  };

  function quickAddVehicle(after, prefillNo) {
    U.openModal(
      '<div class="modal__head"><div><div class="card__title">Quick-add vehicle</div>' +
      '<div class="card__sub">Stays on the terminal — no navigation, no lost keystrokes</div></div>' +
      '<div class="spacer"></div><button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
      '<div class="modal__body"><div class="formgrid formgrid--2">' +
      U.field({ label: 'Vehicle number', id: 'qvNo', req: true, placeholder: 'TN00XX0000', value: prefillNo || '' }) +
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
     DORMANT — the client asked for weight editing to be removed, so the button
     that used to call this was taken out of the ticket drawer. Nothing in the
     UI reaches it now. Kept (rather than deleted) so the working flow is still
     on hand if the client ever reverses that decision; re-enabling it means
     restoring the drawer button and its click handler in the ticket drawer.

     Edit weights on a saved ticket — Super Admin only (same gate as delete:
     a weighment ticket is a commercial record). The backend writes the old
     value, new value, reason and username to dbo.TransactionAudit in the
     SAME transaction as the weight change — no audit row, no edit.
     ---------------------------------------------------------------------- */
  function editWeightsFlow(t) {
    if (!window.AUTH.canDelete()) { U.toast('danger', 'Not permitted', 'Only a Super Administrator can edit saved weights.'); return; }
    const curT = t.tare, curG = t.gross, curN = (curG != null && curT != null) ? curG - curT : null;
    const hasLive = !!(window.weighcore && window.weighcore.getWeight && window.weighcore.listCameras);
    const wcurr = (label, v) =>
      '<div class="card" style="padding:11px 13px"><div class="field__label">' + label + '</div>' +
      '<div class="mono" style="font-size:18px;font-weight:700">' + (v != null ? num(v) : '—') + '</div>' +
      '<div class="tiny dim">kg</div></div>';
    U.openModal(
      '<div class="modal__head"><div><div class="card__title">Edit weights — ticket #' + t.ticketNo + '</div>' +
      '<div class="card__sub">' + esc(vName(t.vehicleId)) + ' · ' + esc(prodOf(t)) + '</div></div>' +
      '<div class="spacer"></div><button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
      '<div class="modal__body">' +
      U.callout('warn', '<b>This corrects a commercial record.</b> The old value, new value, your username and the reason are written permanently to the audit table. The original weighment times stay unchanged.') +
      '<div style="height:var(--sp-4)"></div>' +
      '<div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px">' +
        wcurr('Current Tare', curT) + wcurr('Current Gross', curG) + wcurr('Current Net', curN) +
      '</div>' +
      '<div style="height:var(--sp-4)"></div>' +
      // live bridge view — the truck stands on the scale while you correct:
      // both cameras stream here and the indicator weight can be captured
      // straight into either field below
      (hasLive
        ? '<div class="cockpit" style="margin-bottom:var(--sp-4)">' +
            '<div class="cams" style="border-top:0">' +
              '<figure class="cam"><img id="ewCam1" alt="Camera 1 live"><figcaption class="cam__label">Camera 1</figcaption></figure>' +
              '<figure class="cam"><img id="ewCam2" alt="Camera 2 live"><figcaption class="cam__label">Camera 2</figcaption></figure>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px">' +
              '<b class="mono" id="ewLive" style="font-size:26px;color:#5eead4">— kg</b>' +
              '<div class="spacer"></div>' +
              '<button class="btn btn--sm" id="ewUseT">' + icon('download') + 'Use as tare</button>' +
              '<button class="btn btn--sm btn--primary" id="ewUseG">' + icon('download') + 'Use as gross</button>' +
            '</div>' +
          '</div>'
        : '') +
      '<div class="formgrid formgrid--2">' +
        U.field({ label: 'New tare (kg)', id: 'ewTare', type: 'number', value: curT != null ? curT : '' }) +
        U.field({ label: 'New gross (kg)', id: 'ewGross', type: 'number', value: curG != null ? curG : '' }) +
      '</div>' +
      '<div style="height:var(--sp-3)"></div>' +
      '<div class="row"><div class="field__label">New net</div>' +
        '<b class="mono" id="ewNet" style="font-size:16px">' + (curN != null ? num(curN) + ' kg' : '—') + '</b></div>' +
      '<div style="height:var(--sp-3)"></div>' +
      U.field({ label: 'Reason for change', id: 'ewWhy', req: true, span2: true,
        placeholder: 'e.g. operator captured gross before loading — corrected from printed slip',
        hint: 'Required, at least 5 characters. Recorded against your username in TransactionAudit.' }) +
      ((window.weighcore && window.weighcore.captureForTxn)
        ? '<div style="height:var(--sp-3)"></div>' +
          '<label class="check"><input type="checkbox" id="ewCap" checked> Capture camera evidence now — both cameras fire when you save</label>'
        : '') +
      '</div>' +
      '<div class="modal__foot"><button class="btn btn--primary" id="ewSave" disabled>' + icon('save') + 'Save correction</button>' +
      '<button class="btn" data-close>Cancel</button></div>');

    const $t = U.$('#ewTare'), $g = U.$('#ewGross'), $w = U.$('#ewWhy'), $s = U.$('#ewSave'), $n = U.$('#ewNet');
    const val = (el) => { const x = parseInt(el.value, 10); return isFinite(x) ? x : null; };
    const sync = () => {
      const nt = val($t), ng = val($g);
      const nn = (nt != null && ng != null) ? ng - nt : null;
      $n.textContent = nn != null ? num(nn) + ' kg' : '—';
      $n.style.color = (nn != null && nn < 0) ? 'var(--danger)' : '';
      const changed = (nt != null && nt !== curT) || (ng != null && ng !== curG);
      const valid = nt != null && ng != null && nt >= 0 && ng >= 0 && nn != null && nn >= 0;
      $s.disabled = !(changed && valid && $w.value.trim().length >= 5);
    };
    [$t, $g, $w].forEach((el) => el.addEventListener('input', sync));

    // live indicator + cameras inside the modal: capture the REAL weight off
    // the truck standing on the bridge instead of keying it from memory
    if (hasLive) {
      let liveW = 0;
      const camImgs = [];
      const onW = (e2) => {
        const d = e2.detail || {};
        liveW = Math.max(0, Math.round(d.value || 0));
        const lv = document.getElementById('ewLive');
        if (lv) lv.textContent = num(liveW) + ' kg';
      };
      window.addEventListener('wc:weight', onW);
      try { window.weighcore.getWeight().then((d) => onW({ detail: d })).catch(() => {}); } catch (e2) {}
      window.weighcore.listCameras().then((cs) => {
        (cs || []).slice(0, 2).forEach((c, i) => {
          const im = document.getElementById('ewCam' + (i + 1));
          if (im && c.stream) { camImgs.push(im); im.src = c.stream; }
        });
      }).catch(() => {});
      // release the MJPEG sockets + weight listener however the modal closes
      // (detached streaming <img>s hold their sockets — clear by reference)
      const watch = setInterval(() => {
        const m = document.getElementById('modal');
        if (!m || !m.classList.contains('is-on') || !document.getElementById('ewLive')) {
          clearInterval(watch);
          window.removeEventListener('wc:weight', onW);
          camImgs.forEach((im) => { im.onerror = null; im.removeAttribute('src'); });
        }
      }, 400);
      const useLive = (el) => {
        if (!liveW) { U.toast('warn', 'No weight on the bridge', 'The indicator reads 0 kg — position the vehicle on the scale.'); return; }
        el.value = String(liveW);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const bt = document.getElementById('ewUseT'), bg = document.getElementById('ewUseG');
      if (bt) bt.addEventListener('click', () => useLive($t));
      if (bg) bg.addEventListener('click', () => useLive($g));
    }

    $s.addEventListener('click', () => {
      const nt = val($t), ng = val($g), reason = $w.value.trim();
      const wantCap = !!(U.$('#ewCap') && U.$('#ewCap').checked);
      const changes = [];
      if (ng != null && ng !== curG) changes.push({ field: 'GrossWeight', value: ng });
      if (nt != null && nt !== curT) changes.push({ field: 'TareWeight', value: nt });
      if (!changes.length || reason.length < 5) return;
      if (!(window.weighcore && window.weighcore.data && window.weighcore.data.editTicket)) {
        U.toast('danger', 'Not available', 'Weight editing needs the desktop build with the edit backend.'); return;
      }
      $s.disabled = true; $s.textContent = 'Saving…';
      const scale = window.__TERMINAL_SCALE ||
        (((window.weighcore.siteInfo && window.weighcore.siteInfo()) || {}).scaleId) || '';
      const who = ((window.AUTH || {}).user || {}).username || 'operator';
      window.weighcore.data.editTicket({
        rid: t.rid, ticketNo: t.ticketNo, scaleId: scale, reason, userName: who, changes
      }).then((r) => {
        if (!(r && r.ok)) {
          U.toast('danger', 'Edit failed', ((r && r.error) || 'unknown error') + ' — nothing was changed.');
          $s.disabled = false; $s.innerHTML = icon('save') + 'Save correction'; return;
        }
        // reflect the committed correction in the on-screen model
        const parts = [];
        changes.forEach((c) => {
          if (c.field === 'GrossWeight') {
            parts.push('gross ' + num(curG) + ' → ' + num(c.value));
            t.gross = c.value;
            const p = t.passes.filter((p2) => p2.kind === 'Gross').pop(); if (p) p.weight = c.value;
          } else {
            parts.push('tare ' + num(curT) + ' → ' + num(c.value));
            t.tare = c.value;
            const p = t.passes.filter((p2) => p2.kind === 'Tare').pop(); if (p) p.weight = c.value;
          }
        });
        t.net = (t.gross != null && t.tare != null) ? t.gross - t.tare : t.net;
        DB.audit.unshift({
          id: 'AUX' + Date.now(), table: 'Transaction', op: 'UPDATE', at: new Date(), user: who,
          text: 'Ticket ' + t.ticketNo + ' weights corrected — ' + parts.join(', ') + ' · ' + reason, ref: t.id
        });
        U.closeModal();
        U.toast('ok', 'Weights corrected', 'Ticket #' + t.ticketNo + ' — ' + parts.join(', ') + ' · audit row written.');
        const reopen = () => {
          V.transactions.openTicket(t.id);
          if (location.hash.startsWith('#/transactions')) V.transactions.paint();
        };
        // photographic evidence of the correction: both cameras fire and the
        // frames file under this ticket's rid (disk + local store + SQL), so
        // they show in the gallery, on the slip and in the ERP like pass shots
        if (wantCap && window.weighcore.captureForTxn) {
          const seqNext = (t.passes || []).reduce((m, p) => Math.max(m, num(p.seq) || 0), 0) + 1;
          U.toast('info', 'Capturing evidence…', 'Both cameras are firing for ticket #' + t.ticketNo + '.');
          window.weighcore.captureForTxn({ rid: t.rid, ticketNo: t.ticketNo, seq: seqNext, kind: 'Edit' })
            .then((cr) => {
              const n = ((cr && cr.results) || []).filter((x) => x.ok).length;
              if (n) U.toast('ok', 'Evidence captured', n + ' camera frame' + (n === 1 ? '' : 's') + ' attached to ticket #' + t.ticketNo + '.');
              else U.toast('warn', 'No camera frames', 'The cameras returned nothing — the weight correction itself is saved.');
              reopen();
            })
            .catch(() => { U.toast('warn', 'Photo capture failed', 'The weight correction itself is saved.'); reopen(); });
        } else reopen();
      }).catch((e) => {
        U.toast('danger', 'Edit failed', String((e && e.message) || e) + ' — nothing was changed.');
        $s.disabled = false; $s.innerHTML = icon('save') + 'Save correction';
      });
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
      '<div class="card__sub">' + esc(vName(t.vehicleId)) + ' · ' + esc(prodOf(t)) + ' · net ' +
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
          prodOf(t).toLowerCase().includes(q));
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
          // Widths are percentages, not pixels: with table-layout:fixed they make
          // the ledger fit any screen instead of forcing a horizontal scrollbar.
          // Type and Status need the most room because they hold badges, which
          // cannot wrap; the numeric columns need the least.
          { label: 'Ticket', w: '9%', get: t => '<b class="mono">' + t.ticketNo + '</b>' + (t.manual ? ' <span class="tag" title="Contains a manually entered weight">✱</span>' : '') },
          { label: 'Date / time', w: '14%', get: t => '<div class="cellstack"><b>' + fDate(t.at) + '</b><span>' + fTime(t.at) + ' · ' + esc((DB.map.wb[t.wbId] || {}).name || '—') + '</span></div>' },
          { label: 'Vehicle', w: '14.5%', get: t => '<div class="cellstack"><b>' + esc(vName(t.vehicleId)) + '</b><span>' + esc(aName(t.transporterId)) + '</span></div>' },
          { label: 'Product', w: '14%', get: t => '<div class="cellstack"><b>' + esc(prodOf(t)) + '</b><span>' + esc(t.mode) + (t.direction ? ' · ' + esc(t.direction) : '') + '</span></div>' },
          { label: 'Type', w: '11%', get: t => U.typeBadge(t.type) },
          { label: 'Tare', w: '8%', num: true, get: t => t.tare != null ? num(t.tare) : '<span class="dim">—</span>' },
          { label: 'Gross', w: '8%', num: true, get: t => t.gross != null ? num(t.gross) : '<span class="dim">—</span>' },
          { label: 'Net (kg)', w: '9%', num: true, get: t => t.net != null ? '<b>' + num(t.net) + '</b>' : '<span class="dim">pending</span>' },
          { label: 'Status', w: '12.5%', get: t => t.deleted
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
              prodOf(t), gName(t.gateId), t.type, t.mode, t.direction || '',
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
        ['Product', prodOf(t)], ['Gate', gName(t.gateId)],
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
            // Filled in below from disk for saved tickets — the SQL snapshot
            // carries no image bytes, so `shots` is empty on anything recalled.
            body: '<div id="txnShots">' + (shots.length
              ? '<div class="gallery">' + shots.map(s =>
                  '<figure class="shot" data-zoom="' + s.src + '"><img src="' + s.src + '" alt="' + esc(s.cap) + '" loading="lazy">' +
                  '<figcaption class="shot__cap"><span>' + esc(s.cap) + '</span><span>' + esc(s.ts) + '</span></figcaption></figure>').join('') + '</div>'
              : '<div class="tiny dim" style="padding:var(--sp-4)">No camera frames stored on this ticket.</div>') + '</div>'
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
          // "Edit weights" was removed from the UI at the client's request. The
          // dialog, the IPC handler and the dbo.TransactionAudit backend are all
          // left in place but are no longer reachable from any screen or role.
          (t.deleted ? '' :
            (t.status !== 'Void' ? '<button class="btn btn--danger" id="dVoid">' + icon('ban') + 'Void ticket</button>' : '') +
            (window.AUTH.canDelete() ? '<button class="btn btn--danger" id="dDel">' + icon('trash') + 'Delete ticket</button>' : '')) +
          (t.deleted && window.AUTH.canDelete() ? '<button class="btn" id="dRestore">' + icon('refresh') + 'Restore ticket</button>' : '') +
        '</footer>');

      const dr = U.$('#drawer');
      // Pull this ticket's stored frames off disk and drop them into the
      // gallery. Purely additive: if it fails or finds nothing, the drawer
      // keeps whatever it already rendered.
      if (window.WeighCoreNative && t.rid && window.weighcore && window.weighcore.imagesForTxn) {
        window.weighcore.imagesForTxn(t.rid).then(res => {
          const box = document.getElementById('txnShots');
          if (!box || !res || !res.images || !res.images.length) return;
          const byPass = {};
          t.passes.forEach(p => { byPass[p.seq] = p.kind; });
          box.innerHTML = '<div class="gallery">' + res.images.map(im => {
            const cap = (byPass[im.seq] || 'Pass') + ' · pass ' + im.seq;
            return '<figure class="shot" data-zoom="' + im.dataUrl + '">' +
              '<img src="' + im.dataUrl + '" alt="' + esc(cap) + '" loading="lazy">' +
              '<figcaption class="shot__cap"><span>' + esc(cap) + '</span>' +
              '<span>' + esc(im.cameraId || '') + '</span></figcaption></figure>';
          }).join('') + '</div>';
          const sub = box.closest('.card') && box.closest('.card').querySelector('.card__sub');
          if (sub) sub.textContent = res.images.length + ' frames captured automatically at each pass';
        }).catch(() => {});
      }
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
    /* The values on one company's slip — the SINGLE derivation feeding both
       the HTML/PDF renderer and the Word (.docx) builder, so the two formats
       can never disagree (letterhead, party override, WB number included). */
    slipData(t, companyName, opts) {
      opts = opts || {};
      const v = DB.map.vehicle[t.vehicleId] || {};
      const opUser = (DB.map.user[t.operatorId] || {}).username || (((window.AUTH || {}).user) || {}).username || 'admin';
      const fT12 = (d) => d ? (fDate(d) + ' ' + fTime(d)) : '—';
      const kgv = (val) => val != null ? val + ' Kg' : '—';
      const slipCfg = (window.weighcore && window.weighcore.slipConfig && window.weighcore.slipConfig()) || null;
      const coLine = (/^m\/s/i.test(String(companyName)) ? '' : 'M/s. ') + companyName;
      // per-letterhead Party Name (config slip.partyOverrides) — e.g. the AQUA
      // WORLD copy prints "Aqua world export" instead of the ticket's cf2
      const partyOverride = (slipCfg && slipCfg.partyOverrides && slipCfg.partyOverrides[companyName]) || null;
      const project = (slipCfg && slipCfg.project) || DB.company.project;
      // header line 3 follows THIS terminal's weighbridge (P5WB2 -> 'WB - 02');
      // the old custom-field text remains only when no scale id is known
      const scale = window.__TERMINAL_SCALE ||
        (((window.weighcore && window.weighcore.siteInfo && window.weighcore.siteInfo()) || {}).scaleId) || '';
      const wbNum = (String(scale).match(/(\d+)$/) || [])[1];
      const line3 = wbNum ? ('PACKAGE - 5 ; WB - 0' + wbNum)
        : (((t.cf && t.cf.cf4) || siteCode(t.siteId)) + ' ; WB - ' + ((t.cf && t.cf.cf5) || wbName(t.wbId)));
      return {
        company: coLine, project: project, line3: line3, printTime: fT12(new Date()),
        fields: {
          ticketId: String(t.ticketNo), vehicleNo: vName(t.vehicleId), transporter: aName(t.transporterId),
          product: prodOf(t), gate: gName(t.gateId),
          vehicleType: t.cf.cf1 || v.type || '—', partyName: partyOverride || t.cf.cf2 || '—',
          buyerName: t.cf.cf3 || '—', packageNo: t.cf.cf4 || '—', wbNo: t.cf.cf5 || '—'
        },
        weights: {
          gross: kgv(t.gross), tare: kgv(t.tare), net: kgv(t.net),
          grossTime: t.grossAt ? fT12(t.grossAt) : '—', tareTime: t.tareAt ? fT12(t.tareAt) : '—'
        },
        manual: !!t.manual, operator: opUser
      };
    },

    /* the photo set for one slip — the same objects (base64 data URLs from
       images:forTxn) feed the HTML gallery, the PDF and the Word copy */
    slipShots(t, opts) {
      opts = opts || {};
      const shots = [];
      if (opts.images && opts.images.length) {
        opts.images.forEach((im) => {
          const n = (String(im.cameraId || '').match(/\d+$/) || [im.cameraId || '?'])[0];
          shots.push({ src: im.dataUrl, cap: 'camera ' + n + ' Weighment: #' + im.seq });
        });
      } else {
        (t.passes || []).forEach(p => (p.images || []).forEach((src, i) =>
          shots.push({ src, cap: 'camera ' + (i + 1) + ' Weighment: #' + p.seq })));
      }
      return shots;
    },

    /* One slip body per letterhead: identical in every way except the company
       name on line 1. opts.images (rows from imagesForTxn) embeds the stored
       frames as data URLs so an exported PDF is fully self-contained. */
    slipHtml(t, companyName, opts) {
      const d = this.slipData(t, companyName, opts);
      const shots = this.slipShots(t, opts);
      const row = (k, val, strong) => '<div class="lslip__r"><dt>' + esc(k) + '</dt><dd>:&nbsp;' +
        (strong ? '<b>' : '') + esc(val) + (strong ? '</b>' : '') + '</dd></div>';
      return '<div class="lslip">' +
          '<div class="lslip__head">' +
            '<h3>' + esc(d.company) + '.</h3>' +
            '<p>' + esc(d.project) + '.</p>' +
            '<p>' + esc(d.line3) + '.</p>' +
          '</div>' +
          '<div class="lslip__pt">Print Time :&nbsp;&nbsp;' + esc(d.printTime) + '</div>' +
          '<div class="lslip__cols">' +
            '<div>' +
              row('TicketID', d.fields.ticketId) +
              row('Vehicle No.', d.fields.vehicleNo) +
              row('Transporter', d.fields.transporter) +
              row('Product', d.fields.product) +
              row('Gate', d.fields.gate) +
            '</div><div>' +
              row('Vehicle Type', d.fields.vehicleType) +
              row('Party Name', d.fields.partyName) +
              row('Buyer Name', d.fields.buyerName) +
              row('Package No', d.fields.packageNo) +
              row('WeighBridge No', d.fields.wbNo) +
            '</div>' +
          '</div>' +
          '<hr class="lslip__rule">' +
          '<div class="lslip__cols">' +
            '<div>' +
              row('Gross Weight', d.weights.gross) +
              row('Tare Weight', d.weights.tare) +
              row('Net Weight', d.weights.net, true) +
            '</div><div>' +
              row('Gross Time', d.weights.grossTime) +
              row('Tare Time', d.weights.tareTime) +
            '</div>' +
          '</div>' +
          // Filled in below from disk for saved tickets — a recalled ticket
          // carries no in-memory pass images, so `shots` is empty there.
          '<div id="slipShots">' + (shots.length
            ? '<div class="lslip__shots">' + shots.map(s =>
                '<figure class="lslip__shot"><img src="' + s.src + '" alt="' + esc(s.cap) + '">' +
                '<figcaption>' + esc(s.cap) + '</figcaption></figure>').join('') + '</div>'
            : '') + '</div>' +
          (d.manual ? '<p style="margin:8px 0"><b>&#10033; MANUAL ENTRY</b> — one or more weights were keyed by the operator, not read from the indicator.</p>' : '') +
          '<div class="lslip__foot">' +
            '<div>User Name :&nbsp;&nbsp;' + esc(d.operator) + '</div>' +
            '<div class="lslip__sig"><div class="line"></div>Operator Sign.</div>' +
          '</div>' +
        '</div>';
    },

    slip(t) {
      const slipCfg = (window.weighcore && window.weighcore.slipConfig && window.weighcore.slipConfig()) || null;
      const companies = slipCompanies(t, slipCfg);
      U.openModal(
        '<div class="modal__head"><div><div class="card__title">Weighment slip</div>' +
        '<div class="card__sub">Ticket #' + t.ticketNo + ' · ' + fDT(t.at) + '</div></div><div class="spacer"></div>' +
        '<button class="btn btn--sm" onclick="window.print()">' + icon('printer') + 'Print</button>' +
        '<button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
        '<div class="modal__body">' + this.slipHtml(t, companies[0]) + '</div>' +
        '<div class="modal__foot"><button class="btn btn--primary" onclick="window.print()">' + icon('printer') + 'Print slip</button>' +
        ((window.weighcore && window.weighcore.exportSlipPdf)
          ? '<button class="btn" id="dPdfBoth">' + icon('download') + 'Download slips (PDF + Word)</button>' : '') +
        '<button class="btn" data-close>Close</button></div>', true);

      // Same disk read-back as the ticket drawer: the frames live on disk keyed
      // by rid even when the passes carry no images. Purely additive — if it
      // fails or finds nothing, the slip keeps whatever it already rendered.
      if (window.WeighCoreNative && t.rid && window.weighcore && window.weighcore.imagesForTxn) {
        window.weighcore.imagesForTxn(t.rid).then(res => {
          const box = document.getElementById('slipShots');
          if (!box || !res || !res.images || !res.images.length) return;
          box.innerHTML = '<div class="lslip__shots">' + res.images.map(im => {
            const n = (String(im.cameraId || '').match(/\d+$/) || [im.cameraId || '?'])[0];
            const cap = 'camera ' + n + ' Weighment: #' + im.seq;
            return '<figure class="lslip__shot"><img src="' + im.dataUrl + '" alt="' + esc(cap) + '">' +
              '<figcaption>' + esc(cap) + '</figcaption></figure>';
          }).join('') + '</div>';
        }).catch(() => {});
      }

      // "Download both PDFs" — one identical slip per configured letterhead,
      // photos embedded as data URLs so the files are fully self-contained
      const pdfBtn = U.$('#dPdfBoth');
      if (pdfBtn) pdfBtn.addEventListener('click', () => {
        pdfBtn.disabled = true; pdfBtn.textContent = 'Generating…';
        const finish = () => { pdfBtn.disabled = false; pdfBtn.innerHTML = icon('download') + 'Download slips (PDF + Word)'; };
        const buildAndSend = (images) => {
          // html renders the PDF; data drives the native Word copy — both come
          // from the same slipData derivation, so the two formats always agree
          const files = companies.map((c) => ({
            company: c,
            html: this.slipHtml(t, c, { images }),
            data: this.slipData(t, c, { images })
          }));
          window.weighcore.exportSlipPdf({ ticketNo: t.ticketNo, shots: this.slipShots(t, { images }), files }).then((r) => {
            if (r && r.ok) {
              U.toast('ok', 'Slips saved', (r.files || []).length + ' file' + ((r.files || []).length === 1 ? '' : 's') + ' (PDF + Word) in ' + (r.dir || 'the slips folder'));
              if (r.docxError) U.toast('warn', 'Word copies failed', r.docxError + ' — the PDFs were still saved.');
              if (r.dir && window.weighcore.openPath) window.weighcore.openPath(r.dir);
            } else U.toast('danger', 'Slip export failed', (r && r.error) || 'unknown error');
            finish();
          }).catch((e) => { U.toast('danger', 'Slip export failed', String((e && e.message) || e)); finish(); });
        };
        if (t.rid && window.weighcore.imagesForTxn) {
          window.weighcore.imagesForTxn(t.rid)
            .then((res) => buildAndSend(res && res.images && res.images.length ? res.images : null))
            .catch(() => buildAndSend(null));
        } else buildAndSend(null);
      });
    }
  };

  function qrPayload(t) {
    const map = {
      ticketNo: t.ticketNo, vehicleNo: vName(t.vehicleId), accountName: aName(t.accountId),
      grossWt: t.gross, grossTime: t.grossAt ? fDT(t.grossAt) : '', tareWt: t.tare,
      tareTime: t.tareAt ? fDT(t.tareAt) : '', netWt: t.net, product: prodOf(t),
      charges: t.charges, cf1: t.cf.cf1, cf2: t.cf.cf2, cf3: t.cf.cf3, cf4: t.cf.cf4, cf5: t.cf.cf5, cf6: t.cf.cf6,
      siteCode: siteCode(t.siteId), operator: uName(t.operatorId),
      signature: 'a7f' + (t.ticketNo * 7919).toString(16).slice(0, 8),
      verifyUrl: 'https://verify.weighcore.app/t/' + t.ticketNo
    };
    return DB.barcodeSlots.filter(s => s.on).map(s => s.code + ':' + (map[s.key] == null ? '' : map[s.key])).join('|');
  }
  V.transactions.qrPayload = qrPayload;
})();
