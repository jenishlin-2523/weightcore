/* WeighCore — LIVE data loader.
   Pulls the current svt_weighbridge database (via the Electron main process) and
   overrides the demo window.DB with real records. If the native bridge or the DB
   is unavailable (e.g. opened in a plain browser), it leaves the demo data in
   place so the UI still runs. */
(function () {
  'use strict';
  var wc = window.weighcore;
  if (!wc || typeof wc.getSnapshot !== 'function') {
    console.info('[WeighCore] no native bridge — using demo data (browser mode).');
    return;
  }

  var R;
  try { R = wc.getSnapshot(); } catch (e) { R = null; }
  if (!R || !R.transactions) {
    console.warn('[WeighCore] live DB snapshot unavailable — keeping demo data. Use the DB settings / refresh to retry.');
    return;
  }

  var D = function (s) { return s ? new Date(s) : null; };
  R.transactions.forEach(function (t) {
    t.at = D(t.at); t.tareAt = D(t.tareAt); t.grossAt = D(t.grossAt);
    (t.passes || []).forEach(function (p) { p.at = D(p.at); });
  });
  (R.audit || []).forEach(function (a) { a.at = D(a.at); });

  if (!window.DB) window.DB = {};

  // A valid demo user for operator display — login + RBAC stay on the demo
  // scaffolding (roles/permissions), which the app's auth is built around.
  var demoUser = (window.DB.users && (window.DB.users.filter(function (u) { return u.username === 'admin'; })[0] || window.DB.users[0])) || null;
  var demoUserId = demoUser ? demoUser.id : null;
  var demoUserIds = {};
  (window.DB.users || []).forEach(function (u) { demoUserIds[u.id] = 1; });

  // Override only the OPERATIONAL data with live records. Keep users, roles,
  // permissions, features, settings, sites and drivers from the demo so the
  // login shortcuts and role-based access continue to work.
  Object.assign(window.DB, {
    units: R.units, products: R.products, accounts: R.accounts, vehicles: R.vehicles,
    drivers: R.drivers, gates: R.gates, weighbridges: R.weighbridges, cameras: R.cameras,
    transactions: R.transactions, audit: R.audit
  });

  // point every live transaction's operator at a valid user so lookups resolve
  (window.DB.transactions || []).forEach(function (t) {
    if (!t.operatorId || !demoUserIds[t.operatorId]) t.operatorId = demoUserId;
  });

  // keep the connected scale pointed at a real (live) weighbridge
  if (!window.DB.settings) window.DB.settings = {};
  if (window.DB.weighbridges && window.DB.weighbridges.length) {
    var cur = window.DB.settings.connectedScale;
    if (!window.DB.weighbridges.some(function (w) { return w.id === cur; })) {
      window.DB.settings.connectedScale = window.DB.weighbridges[0].id;
    }
  }

  // brought-forward starts at zero — the full live table is present
  window.DB.opening = Object.assign({}, window.DB.opening || {}, {
    label: 'Brought forward', source: 'live svt_weighbridge', from: '', to: '',
    tickets: 0, netKg: 0, byType: { Processing: { tickets: 0, netKg: 0 }, Disposal: { tickets: 0, netKg: 0 }, RDF: { tickets: 0, netKg: 0 } }, rdfYardStockKg: 0
  });

  var byId = function (a) { return (a || []).reduce(function (m, x) { m[x.id] = x; return m; }, {}); };
  window.DB.map = {
    site: byId(window.DB.sites), wb: byId(window.DB.weighbridges), cam: byId(window.DB.cameras),
    gate: byId(window.DB.gates), product: byId(window.DB.products), account: byId(window.DB.accounts),
    vehicle: byId(window.DB.vehicles), driver: byId(window.DB.drivers), user: byId(window.DB.users),
    role: byId(window.DB.roles), unit: byId(window.DB.units)
  };
  window.DB.NOW = new Date();

  // expose a manual refresh for a "reload data" button
  window.DB.refresh = function () {
    return wc.data.refresh().then(function (r) { if (r && r.ok) location.reload(); return r; });
  };

  console.info('[WeighCore] LIVE data loaded from svt_weighbridge: ' + R.transactions.length + ' transactions, ' + R.vehicles.length + ' vehicles.');
})();
