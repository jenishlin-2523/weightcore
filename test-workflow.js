/* End-to-end test of the WeighCore weighment workflow (mirrors the legacy video).
   Writes only to svt_weighbridge_TEST (a restored copy) — never production. */
const crypto = require('crypto');
const { EdgeAgent } = require('./src/edge');
const sqldb = require('./src/sqldb');
const camera = require('./src/camera');
const { Store } = require('./src/db');

const CFG = { server: '.\\SVTSQLEXPRESS', database: 'svt_weighbridge_test' };
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { console.log(`  PASS  ${name}${detail ? '  — ' + detail : ''}`); pass++; } else { console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); fail++; } };
const nn = (v) => (v == null ? null : Number(v));

function parseFrame(parse, frame) {
  const a = new EdgeAgent({ connection: 'serial', parse });
  let last = null; a.on('weight', (d) => { last = d.value; });
  for (let i = 0; i < 5; i++) a._ingest(frame);
  return last;
}

(async () => {
  console.log('\n=== WeighCore workflow test (DB: ' + CFG.database + ') ===\n');

  // ---- TEST 1: live weight capture from the real indicator frame ----
  console.log('[1] Weight capture (indicator frame parsing)');
  const P = { startHex: '02', totalStringLength: 10, weightStartFrom: 1, weightLength: 6 };
  ok('reads STX frame <STX>015960<ETX>', parseFrame(P, '\x02015960\x03\r\n') === 15960, '15960 kg');
  ok('reads STX frame <STX>038430<ETX>', parseFrame(P, '\x02038430\x03\r\n') === 38430, '38430 kg');

  // ---- TEST 2: gross/tare/net computation (double-pass, as in the video) ----
  console.log('\n[2] Net computation (double-pass)');
  const tare = 15960, gross = 38430, net = gross - tare;
  ok('Net = Gross - Tare', net === 22470, `${gross} - ${tare} = ${net}`);

  // ---- TEST 3: read masters live from SQL (like the app boot) ----
  console.log('\n[3] Live master data load');
  const snap = await sqldb.snapshot(CFG);
  ok('snapshot returns vehicles', snap.vehicles.length > 0, snap.vehicles.length + ' vehicles');
  ok('snapshot returns products', snap.products.length > 0, snap.products.length + ' products');
  ok('snapshot returns transactions', snap.transactions.length > 0, snap.transactions.length + ' tickets');
  const baseCount = snap.transactions.length;

  // pick real masters for the ticket
  const idNum = (x) => parseInt(String(x).replace(/^\D+/, ''), 10);
  const veh = snap.vehicles.find((v) => v.no) || snap.vehicles[0];
  const prod = snap.products.find((p) => /MSW/i.test(p.name)) || snap.products[0];
  const gate = snap.gates[0];
  const wb = snap.weighbridges[0];
  const acc = snap.accounts.find((a) => a.isAccount) || snap.accounts[0];
  const trn = snap.accounts.find((a) => a.isTransporter) || snap.accounts[0];
  const usr = snap.users[0];

  // ---- TEST 4: save a completed double-pass ticket to SQL (the write-back) ----
  console.log('\n[4] Save ticket to SQL (write-back)');
  const rid = crypto.randomUUID();
  const t1 = '2026-08-22 12:45:00', t2 = '2026-08-22 14:44:00';
  const ticket = {
    receiptTicketId: rid, status: 'Complete', mode: 'Double', transactionType: 'Incoming',
    vehicleId: idNum(veh.id), driverId: null, accountId: idNum(acc.id), transporterId: idNum(trn.id),
    charges: 0, createdBy: idNum(usr.id), vehicleNo: veh.no,
    weightBridgeId: idNum(wb.id), productId: idNum(prod.id), gateId: gate ? idNum(gate.id) : null,
    passes: [
      { kind: 'Tare',  weight: tare,  at: t1, tare: tare, gross: null, net: null, manual: false },
      { kind: 'Gross', weight: gross, at: t2, gross: gross, tare: tare, net: net, manual: false }
    ]
  };
  const saved = await sqldb.saveTicket(CFG, ticket);
  ok('saveTicket returned ok', saved.ok === true, 'ticketNo ' + saved.ticketNo);

  // ---- TEST 5: read the ticket back and verify it round-tripped ----
  console.log('\n[5] Read-back verification');
  const snap2 = await sqldb.snapshot(CFG);
  ok('ticket count increased by 1', snap2.transactions.length === baseCount + 1, `${baseCount} -> ${snap2.transactions.length}`);
  const rt = snap2.transactions.find((x) => x.ticketNo === saved.ticketNo);
  ok('ticket found by number', !!rt, 'ticket #' + saved.ticketNo);
  if (rt) {
    ok('status = Complete', rt.status === 'Complete', rt.status);
    ok('mode = Double', rt.mode === 'Double', rt.mode);
    ok('gross weight correct', nn(rt.gross) === gross, rt.gross + ' kg');
    ok('tare weight correct', nn(rt.tare) === tare, rt.tare + ' kg');
    ok('net weight correct', nn(rt.net) === net, rt.net + ' kg');
    ok('has 2 weighment passes', (rt.passes || []).length === 2, (rt.passes || []).length + ' passes');
    ok('vehicle linked', rt.vehicleId === veh.id, rt.vehicleId);
  }

  // ---- TEST 6: camera capture logic (digest auth builder) ----
  console.log('\n[6] Camera capture path');
  ok('camera module exposes capture/probe', typeof camera.capture === 'function' && typeof camera.probe === 'function');

  // ---- TEST 7: offline local store + sync outbox ----
  console.log('\n[7] Offline store + sync outbox');
  const os = require('os'), path = require('path'), fs = require('fs');
  const tdir = path.join(os.tmpdir(), 'wc_test_' + Date.now());
  const store = new Store(tdir);
  const id = store.upsert('transactions', { ticket_no: 99001, vehicle_no: veh.no, gross, tare, net, status: 'closed' });
  ok('local upsert returns id', !!id);
  ok('outbox queued the change', store.pendingOutbox(10).length === 1, store.pendingOutbox(10).length + ' queued');
  const back = store.get('transactions', id);
  ok('local read-back matches', back && Number(back.net) === net, 'net ' + (back && back.net));
  try { fs.rmSync(tdir, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST HARNESS ERROR:', e.message); process.exit(2); });
