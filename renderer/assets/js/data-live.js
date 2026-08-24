/* WeighCore — LIVE data loader + single-weighbridge scoping.
   Pulls the current svt_weighbridge database (via the Electron main process) and
   overrides the demo window.DB with real records. Then it SCOPES the whole DB to
   this terminal's own weighbridge (config.site.scaleId): one site, one weighbridge,
   no cross-site switcher. Each installed EXE is ONE weighbridge — seeing all
   weighbridges is the job of the ERP/admin portal, never the terminal.
   In a plain browser (no native bridge) the demo data + multi-site UI stay. */
(function () {
  'use strict';
  var wc = window.weighcore;
  if (!wc) { console.info('[WeighCore] no native bridge — demo data (browser mode).'); return; }

  // this terminal's identity, from config.json (set by the Setup wizard)
  var term = null;
  try { term = wc.siteInfo && wc.siteInfo(); } catch (e) { term = null; }
  var scaleId = term && term.scaleId;

  // ---- load live records if available (else keep demo data) ----
  var R = null;
  try { R = wc.getSnapshot && wc.getSnapshot(); } catch (e) { R = null; }
  if (R && R.transactions) {
    var D = function (s) { return s ? new Date(s) : null; };
    R.transactions.forEach(function (t) {
      t.at = D(t.at); t.tareAt = D(t.tareAt); t.grossAt = D(t.grossAt);
      (t.passes || []).forEach(function (p) { p.at = D(p.at); });
    });
    (R.audit || []).forEach(function (a) { a.at = D(a.at); });
    if (!window.DB) window.DB = {};

    var demoUser = (window.DB.users && (window.DB.users.filter(function (u) { return u.username === 'admin'; })[0] || window.DB.users[0])) || null;
    var demoUserId = demoUser ? demoUser.id : null;
    var demoUserIds = {};
    (window.DB.users || []).forEach(function (u) { demoUserIds[u.id] = 1; });

    // override operational data with live records (keep users/roles/permissions from demo)
    Object.assign(window.DB, {
      units: R.units, products: R.products, accounts: R.accounts, vehicles: R.vehicles,
      drivers: R.drivers, gates: R.gates, weighbridges: R.weighbridges, cameras: R.cameras,
      transactions: R.transactions, audit: R.audit
    });
    (window.DB.transactions || []).forEach(function (t) {
      if (!t.operatorId || !demoUserIds[t.operatorId]) t.operatorId = demoUserId;
    });
    window.DB.opening = Object.assign({}, window.DB.opening || {}, {
      label: 'Brought forward', source: 'live svt_weighbridge', from: '', to: '',
      tickets: 0, netKg: 0, byType: { Processing: { tickets: 0, netKg: 0 }, Disposal: { tickets: 0, netKg: 0 }, RDF: { tickets: 0, netKg: 0 } }, rdfYardStockKg: 0
    });
    window.DB.NOW = new Date();
    window.DB.refresh = function () { return wc.data.refresh().then(function (r) { if (r && r.ok) location.reload(); return r; }); };
    rebuildMaps();
    console.info('[WeighCore] LIVE data: ' + R.transactions.length + ' transactions, ' + R.vehicles.length + ' vehicles.');
  } else {
    console.warn('[WeighCore] live snapshot unavailable — keeping demo data.');
  }

  // ---- scope to this ONE weighbridge (runs whether data is live or demo) ----
  if (scaleId) scopeToTerminal(scaleId, term && term.name);

  function byId(a) { return (a || []).reduce(function (m, x) { m[x.id] = x; return m; }, {}); }
  function rebuildMaps() {
    var DB = window.DB; if (!DB) return;
    DB.map = {
      site: byId(DB.sites), wb: byId(DB.weighbridges), cam: byId(DB.cameras),
      gate: byId(DB.gates), product: byId(DB.products), account: byId(DB.accounts),
      vehicle: byId(DB.vehicles), driver: byId(DB.drivers), user: byId(DB.users),
      role: byId(DB.roles), unit: byId(DB.units)
    };
  }

  function scopeToTerminal(scale, siteName) {
    var DB = window.DB; if (!DB) return;
    var up = String(scale).toUpperCase();
    // the single site this terminal represents (match demo site by code, else synthesize)
    var site = (DB.sites || []).filter(function (s) { return String(s.code || '').toUpperCase() === up; })[0];
    if (!site) site = { id: 'S_' + up, code: scale, name: siteName || scale, address: '' };
    DB.sites = [site];
    // the single weighbridge (match by name, else the first live one, else synthesize), relabelled to scaleId
    var wb = (DB.weighbridges || []).filter(function (w) { return String(w.name || '').toUpperCase() === up; })[0]
          || (DB.weighbridges || [])[0];
    if (!wb) wb = { id: 'WB_' + up, capacity: 100000, port: '', baud: 2400, status: 'online' };
    wb.name = scale; wb.siteId = site.id; wb.active = true;
    DB.weighbridges = [wb];
    // this terminal's DB holds only its own tickets — bind them to this site + weighbridge
    (DB.transactions || []).forEach(function (t) { t.siteId = site.id; t.wbId = wb.id; });
    (DB.cameras || []).forEach(function (c) { c.wbId = wb.id; });
    DB.settings = DB.settings || {};
    DB.settings.connectedScale = wb.id;
    window.__TERMINAL_SCALE = scale;
    window.__TERMINAL_SITE = site.id;
    rebuildMaps();
    console.info('[WeighCore] terminal scoped to weighbridge ' + scale + ' (single-site).');
  }
})();
