'use strict';
/*
 * weighcore-bridge.js — injected into the WeighCore UI by the Electron main
 * process after load. It connects the REAL weight edge + cameras + sync status
 * to the existing DOM, WITHOUT editing your demo's own JS files.
 *
 * If window.weighcore is absent (i.e. the page is opened in a plain browser),
 * every hook no-ops and your demo behaves exactly as before.
 */
(function () {
  var wc = window.weighcore;
  if (!wc) { console.info('[WeighCore] running without native bridge (browser/demo mode)'); return; }

  // ---------- live weight -> UI ----------
  var elWeight = document.getElementById('scaleChipWeight');
  var elEdge   = document.getElementById('edgeSub');
  var elEdgeSt = document.getElementById('edgeStatus');
  var current  = { value: 0, unit: 'kg', stable: false };
  var lastEdge = { state: 'connecting', detail: '' };

  function fmt(v, u) { return (Math.round(v)).toLocaleString('en-IN') + ' ' + (u || 'kg'); }

  wc.onWeight(function (d) {
    current = d;
    if (lastEdge.state !== 'connected') lastEdge = { state: 'connected', detail: 'weight stream' };
    if (elWeight) elWeight.textContent = fmt(d.value, d.unit);
    // broadcast for any view that wants live weight (ops capture screens)
    window.dispatchEvent(new CustomEvent('wc:weight', { detail: d }));
  });

  wc.onEdgeStatus(function (s) {
    lastEdge = s;
    if (elEdge) elEdge.textContent = (s.state === 'connected' ? 'Connected · ' : (s.state[0].toUpperCase() + s.state.slice(1) + ' · ')) + (s.detail || '');
    if (elEdgeSt) elEdgeSt.setAttribute('data-state', s.state);
    window.dispatchEvent(new CustomEvent('wc:edge', { detail: s }));
  });

  wc.onSyncStatus(function (s) {
    window.dispatchEvent(new CustomEvent('wc:sync', { detail: s }));
    // optional visual: colour the edge dot when offline
    if (elEdgeSt) elEdgeSt.setAttribute('data-online', s.online ? '1' : '0');
  });

  // ---------- native API for the ops views ----------
  // Any WeighCore view can call these; they resolve to the real hardware.
  window.WeighCoreNative = {
    // current stable/live reading + indicator link state
    getWeight: function () { return current; },
    readWeight: function () { return wc.getWeight(); },
    edgeState: function () { return lastEdge; },

    // capture a single camera -> {ok, dataUrl}
    capturePhoto: function (cameraId) { return wc.capture(cameraId); },

    // capture ALL lane cameras for a ticket, persisted to disk + local db + sync queue
    // returns {ok, results:[{ok, cameraId, id, dataUrl, file}]}
    captureTicketPhotos: function (txnId, seq) { return wc.captureForTxn(txnId, seq || 0); },

    listCameras:  function () { return wc.listCameras(); },
    probeCameras: function () { return wc.probeCameras(); },

    // persist a weighbridge ticket + passes locally (syncs automatically)
    saveTicket:     function (row) { return wc.db.saveTransaction(row); },
    saveWeighment:  function (row) { return wc.db.saveWeighment(row); },
    listTickets:    function (n) { return wc.db.list('transactions', n || 200); },

    syncNow:     function () { return wc.syncNow(); },
    diagnostics: function () { return wc.diagnostics(); }
  };

  console.info('[WeighCore] native bridge attached — real weight + camera live.');
})();
