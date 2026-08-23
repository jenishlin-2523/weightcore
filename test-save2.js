'use strict';
/* Tests for the upgraded saveTicket/saveVehicle against svt_weighbridge_test (safe copy). */
const { spawnSync } = require('child_process');
const path = require('path');
const sqldb = require('./src/sqldb');

const cfg = { server: '.\\SVTSQLEXPRESS', database: 'svt_weighbridge_test' };
const VERIFY = path.join(__dirname, 'test-save2-q.ps1');

function q(sql) {
  const ps = process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VERIFY, '-Query', sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('query failed: ' + r.stderr);
  const t = (r.stdout || '').trim().replace(/^ï»¿/, '');
  return t ? JSON.parse(t) : [];
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS  ' + name); }
    else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
  };

  const before = q('SELECT ISNULL(MAX(TicketID),0) AS m FROM TransactionData')[0].m;

  // real foreign-key ids from the test DB
  const ID = {
    veh:  q('SELECT TOP 1 VehicleID AS i FROM Vehicle ORDER BY VehicleID')[0].i,
    acc:  q('SELECT TOP 1 AccountID AS i FROM Account ORDER BY AccountID')[0].i,
    prod: q('SELECT TOP 1 ProductID AS i FROM Product ORDER BY ProductID')[0].i,
    gate: q('SELECT TOP 1 GateID AS i FROM Gate ORDER BY GateID')[0].i,
    wb:   q('SELECT TOP 1 WeightBridgeID AS i FROM WeightBridge ORDER BY WeightBridgeID')[0].i,
    user: q('SELECT TOP 1 UserID AS i FROM UserMaster ORDER BY UserID')[0].i
  };
  console.log('using ids', JSON.stringify(ID));

  // 1) fresh double weighment â€” TicketID allocated inside the transaction
  const r1 = await sqldb.saveTicket(cfg, {
    status: 'Complete', mode: 'Double', transactionType: 'Incoming', direction: null,
    vehicleId: ID.veh, vehicleNo: 'TN37TEST01', transporterId: ID.acc, transporterName: 'Test Transporter',
    driverId: null, driverName: 'Test Driver', productId: ID.prod, productName: 'MSW',
    gateId: ID.gate, gateName: 'Gate 1', weightBridgeId: ID.wb, weighbridgeName: 'Scale2',
    charges: 0, createdBy: ID.user, userName: 'superadmin', createdAt: '2026-08-22 15:00:00',
    passes: [
      { seq: 1, kind: 'Tare', weight: 10200, at: '2026-08-22 14:50:00', net: null, manual: false },
      { seq: 2, kind: 'Gross', weight: 21860, at: '2026-08-22 15:00:00', net: 11660, manual: false }
    ]
  });
  ok('fresh save ok', r1.ok, JSON.stringify(r1));
  ok('ticket allocated MAX+1', r1.ticketNo === before + 1, r1.ticketNo + ' vs ' + (before + 1));
  const td = q('SELECT * FROM TransactionData WHERE TicketID=' + r1.ticketNo);
  ok('TransactionData row present', td.length === 1);
  ok('denormalized names written', td.length === 1 && td[0].VehicleNumber === 'TN37TEST01' && td[0].TransporterName === 'Test Transporter' && td[0].DriverName === 'Test Driver');
  const dets = q("SELECT * FROM TransactionDetail WHERE ReceiptTicketID='" + r1.receiptTicketId + "' ORDER BY SequenceNo");
  ok('two detail rows', dets.length === 2, String(dets.length));
  ok('tare row shape', dets.length === 2 && Number(dets[0].TareWeight) === 10200 && dets[0].WeighmentType === 'Tare' && dets[0].TareTime === '2026-08-22 14:50:00' && dets[0].GrossTime === null && dets[0].WeighbridgeName === 'Scale2' && dets[0].WeightUnit === 'Kg', JSON.stringify(dets[0]));
  ok('gross row shape', dets.length === 2 && Number(dets[1].GrossWeight) === 21860 && Number(dets[1].NetWeight) === 11660 && dets[1].ProductName === 'MSW' && Number(dets[1].UserID) === ID.user, JSON.stringify(dets[1]));

  // 2) recall flow â€” open ticket first, then update to Complete appending only the new pass
  const r2a = await sqldb.saveTicket(cfg, {
    status: 'Active', mode: 'Double', transactionType: 'Incoming',
    vehicleId: ID.veh, vehicleNo: 'TN37TEST02', weightBridgeId: ID.wb, weighbridgeName: 'Scale2',
    createdBy: ID.user, userName: 'superadmin', createdAt: '2026-08-22 15:05:00',
    passes: [{ seq: 1, kind: 'Tare', weight: 9800, at: '2026-08-22 15:05:00', net: null, manual: false }]
  });
  ok('open ticket saved', r2a.ok && r2a.ticketNo === before + 2, JSON.stringify(r2a));
  const r2b = await sqldb.saveTicket(cfg, {
    update: true, receiptTicketId: r2a.receiptTicketId, ticketNo: r2a.ticketNo, status: 'Complete',
    weightBridgeId: ID.wb, weighbridgeName: 'Scale2', productId: ID.prod, productName: 'MSW', gateId: ID.gate, gateName: 'Gate 1',
    createdBy: ID.user, userName: 'superadmin',
    passes: [{ seq: 2, kind: 'Gross', weight: 20200, at: '2026-08-22 15:20:00', net: 10400, manual: true }]
  });
  ok('update save ok', r2b.ok && r2b.ticketNo === r2a.ticketNo, JSON.stringify(r2b));
  const td2 = q('SELECT Status FROM TransactionData WHERE TicketID=' + r2a.ticketNo);
  ok('status now Complete', td2.length === 1 && td2[0].Status === 'Complete', JSON.stringify(td2));
  const dets2 = q("SELECT SequenceNo,IsGrossManual,IsCapturedManual,NetWeight FROM TransactionDetail WHERE ReceiptTicketID='" + r2a.receiptTicketId + "' ORDER BY SequenceNo");
  ok('exactly one detail appended', dets2.length === 2, JSON.stringify(dets2));
  ok('manual flags on closing pass', dets2.length === 2 && Number(dets2[1].IsGrossManual) === 1 && Number(dets2[1].IsCapturedManual) === 1);
  ok('net on closing pass', dets2.length === 2 && Number(dets2[1].NetWeight) === 10400);

  // 3) void via the same update path
  const r3 = await sqldb.saveTicket(cfg, { update: true, receiptTicketId: r1.receiptTicketId, ticketNo: r1.ticketNo, status: 'Void', passes: [] });
  const td3 = q('SELECT Status FROM TransactionData WHERE TicketID=' + r1.ticketNo);
  ok('void persists', r3.ok && td3.length === 1 && td3[0].Status === 'Void', JSON.stringify(td3));

  // 4) hostile characters must round-trip exactly (quotes, $, backticks, unicode)
  const nastyVeh = 'T"N\'37 $x `tick`';
  const nastyTra = 'O\'Brien "Haulage" $co';
  const nastyDrv = 'è´ $driver `x`';
  const r4 = await sqldb.saveTicket(cfg, {
    status: 'Complete', mode: 'Double', transactionType: 'Incoming',
    vehicleNo: nastyVeh, transporterName: nastyTra, driverName: nastyDrv,
    weightBridgeId: ID.wb, weighbridgeName: 'Scale2', createdBy: ID.user, createdAt: '2026-08-22 15:30:00',
    passes: [{ seq: 1, kind: 'Gross', weight: 100, at: '2026-08-22 15:30:00', net: 100, manual: false }]
  });
  ok('hostile-chars save ok', r4.ok, JSON.stringify(r4));
  const td4 = q('SELECT VehicleNumber,TransporterName,DriverName FROM TransactionData WHERE TicketID=' + r4.ticketNo);
  ok('hostile-chars round-trip', td4.length === 1 && td4[0].VehicleNumber === nastyVeh && td4[0].TransporterName === nastyTra && td4[0].DriverName === nastyDrv, JSON.stringify(td4));

  // 5) vehicle master insert returns the IDENTITY id
  const plate = 'TN37QA' + String(Date.now()).slice(-5);
  const rv = await sqldb.saveVehicle(cfg, { no: plate, type: 'Tipper', tare: 8450, accountId: ID.acc });
  ok('vehicle insert ok', rv.ok && rv.vehicleId > 0, JSON.stringify(rv));
  if (rv.ok) {
    const vr = q('SELECT VehicleNumber,VehicleType,TareWeight,AccountID,IsActive FROM Vehicle WHERE VehicleID=' + rv.vehicleId);
    ok('vehicle row correct', vr.length === 1 && vr[0].VehicleNumber === plate && vr[0].VehicleType === 'Tipper' && Number(vr[0].TareWeight) === 8450 && Number(vr[0].AccountID) === ID.acc, JSON.stringify(vr));
  }

  // 6) snapshot: drivers come from the Driver table, transactions expose rid
  const snap = await sqldb.snapshot(cfg);
  ok('snapshot drivers well-formed', Array.isArray(snap.drivers) && snap.drivers.every(d => d.id && d.name));
  const withRid = snap.transactions.filter(t => t.rid).length;
  ok('rid exposed on transactions', withRid > 0 && withRid === snap.transactions.length, withRid + ' of ' + snap.transactions.length);
  const justSaved = snap.transactions.find(t => t.ticketNo === r2a.ticketNo);
  ok('saved ticket reads back complete', !!justSaved && justSaved.status === 'Complete' && justSaved.net === 10400 && justSaved.passes.length === 2 && justSaved.manual === true, JSON.stringify(justSaved && { status: justSaved.status, net: justSaved.net, passes: justSaved.passes.length, manual: justSaved.manual }));

  // 7) saveMaster — insert + update for every SQL-backed master entity
  const stamp = String(Date.now()).slice(-6);
  const mAcc = await sqldb.saveMaster(cfg, { entity: 'accounts', id: null, fields: { name: 'QA Transport ' + stamp, contact: 'Ravi Kumar', phone: '9999900000', city: 'Chennai', isTransporter: true, isAccount: false, active: true } });
  ok('master account insert', mAcc.ok && mAcc.id > 0, JSON.stringify(mAcc));
  if (mAcc.ok) {
    const ar = q('SELECT CompanyName,FirstName,LastName,ContactNo,IsTransporter,Active FROM Account WHERE AccountID=' + mAcc.id);
    ok('master account row', ar.length === 1 && ar[0].FirstName === 'Ravi' && ar[0].LastName === 'Kumar' && Number(ar[0].IsTransporter) === 1, JSON.stringify(ar));
    const mAccU = await sqldb.saveMaster(cfg, { entity: 'accounts', id: mAcc.id, fields: { name: 'QA Transport ' + stamp + ' (renamed)', contact: 'Ravi Kumar', phone: '9999900000', city: 'Chennai', isTransporter: true, isAccount: true, active: false } });
    const ar2 = q('SELECT CompanyName,IsAccount,Active FROM Account WHERE AccountID=' + mAcc.id);
    ok('master account update', mAccU.ok && ar2[0].CompanyName.indexOf('renamed') > 0 && Number(ar2[0].IsAccount) === 1 && Number(ar2[0].Active) === 0, JSON.stringify(ar2));
  }
  const mDrv = await sqldb.saveMaster(cfg, { entity: 'drivers', id: null, fields: { name: 'QA Driver ' + stamp, licence: 'DL' + stamp, accountId: mAcc.id, active: true } });
  ok('master driver insert', mDrv.ok && mDrv.id > 0, JSON.stringify(mDrv));
  if (mDrv.ok) {
    const dr = q('SELECT FirstName,LastName,IDProofNo,AccountID FROM Driver WHERE DriverID=' + mDrv.id);
    ok('master driver row', dr.length === 1 && dr[0].FirstName === 'QA' && dr[0].IDProofNo === 'DL' + stamp && Number(dr[0].AccountID) === mAcc.id, JSON.stringify(dr));
  }
  const mProd = await sqldb.saveMaster(cfg, { entity: 'products', id: null, fields: { name: 'QA Product ' + stamp, code: 'QAP' + stamp, desc: 'harness product', active: true } });
  ok('master product insert', mProd.ok && mProd.id > 0, JSON.stringify(mProd));
  const mGate = await sqldb.saveMaster(cfg, { entity: 'gates', id: null, fields: { name: 'QA Gate ' + stamp, type: 'IN', active: true } });
  ok('master gate insert', mGate.ok && mGate.id > 0, JSON.stringify(mGate));
  const mUnit = await sqldb.saveMaster(cfg, { entity: 'units', id: null, fields: { name: 'Q' + stamp.slice(-3) } });
  ok('master unit insert', mUnit.ok && mUnit.id > 0, JSON.stringify(mUnit));
  const mWb = await sqldb.saveMaster(cfg, { entity: 'weighbridges', id: null, fields: { name: 'QA Scale ' + stamp, capacity: 60000, port: 'COM9', baud: '2400', dataBits: 8, parity: 'None', stopBits: '1', active: true } });
  ok('master weighbridge insert', mWb.ok && mWb.id > 0, JSON.stringify(mWb));
  if (mWb.ok) {
    const wr = q('SELECT ScaleName,COMPort,BaudRate,DataBits FROM WeightBridge WHERE WeightBridgeID=' + mWb.id);
    ok('master weighbridge row', wr.length === 1 && wr[0].COMPort === 'COM9' && wr[0].BaudRate === '2400' && Number(wr[0].DataBits) === 8, JSON.stringify(wr));
  }
  const mVehU = await sqldb.saveMaster(cfg, { entity: 'vehicles', id: rv.vehicleId, fields: { no: plate, type: 'Tipper', tare: 9000, accountId: mAcc.id, active: true } });
  const vr2 = q('SELECT TareWeight,AccountID FROM Vehicle WHERE VehicleID=' + rv.vehicleId);
  ok('master vehicle update', mVehU.ok && Number(vr2[0].TareWeight) === 9000 && Number(vr2[0].AccountID) === mAcc.id, JSON.stringify(vr2));

  // 8) authentication through the payload runner
  const uName1 = q('SELECT TOP 1 UserName FROM UserMaster ORDER BY UserID')[0].UserName;
  const aBad = await sqldb.authenticate(cfg, uName1, 'definitely-wrong-password');
  ok('auth wrong password rejected', !aBad.ok && /invalid/i.test(aBad.error || ''), JSON.stringify(aBad));
  const aNone = await sqldb.authenticate(cfg, 'no_such_user_xyz', 'x');
  ok('auth unknown user rejected', !aNone.ok && /unknown/i.test(aNone.error || ''), JSON.stringify(aNone));
  const aLive = await sqldb.authenticate({ server: cfg.server, database: 'svt_weighbridge' }, 'superadmin', 'CHANGE-ME');
  ok('superadmin login works (live DB, read-only)', aLive.ok && aLive.user && aLive.user.roleId === 'R0' && aLive.user.first, JSON.stringify(aLive.user || aLive));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });

