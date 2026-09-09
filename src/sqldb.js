'use strict';
/*
 * sqldb.js — live SQL Server access for the Electron main process.
 *
 * No native driver: queries run through PowerShell's .NET SqlClient with
 * integrated security (the same mechanism the old software used, and the same
 * one proven during data export). snapshot() returns the whole database shaped
 * exactly like the WeighCore UI's window.DB; saveTicket() writes a completed
 * weighment back to TransactionData/TransactionDetail like the legacy app.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cryptoLib = require('crypto');

/* Legacy password salt: HMAC-SHA256(key, lower(user)+lower(pass)) — matches CommonEncription.createSalt. */
function createSalt(username, password) {
  return cryptoLib.createHmac('sha256', 'jm3UIgFC7CCQwqtr')
    .update(String(username).toLowerCase() + String(password).toLowerCase(), 'utf8')
    .digest('base64');
}

function psExe() {
  return process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe';
}

function runPs(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    // NB: default stdio — PowerShell 5.1 hangs at startup if stdin is an
    // invalid handle ('ignore') when combined with -NonInteractive/-EncodedCommand.
    const child = spawn(psExe(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill(); reject(new Error('sql timeout')); }, timeoutMs);
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b) => { err += b.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.trim() || ('exit ' + code))); });
  });
}

/* Run dynamic SQL through the static wb-exec.ps1 runner. All dynamic content
 * travels as a JSON DATA file, so nothing touches command-line quoting and no
 * fresh .ps1 is ever written (antimalware on this machine deletes those, and
 * -Command / -EncodedCommand each have their own failure modes). */
let payloadSeq = 0;
async function runPayload(cfg, payload, timeoutMs = 30000) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const f = path.join(os.tmpdir(), 'wc-sql-' + process.pid + '-' + (++payloadSeq) + '.json');
    try {
      fs.writeFileSync(f, '﻿' + JSON.stringify(payload), 'utf8');
      const out = await runPs(['-File', path.join(__dirname, 'wb-exec.ps1'), '-Server', cfg.server, '-Database', cfg.database, '-PayloadFile', f], timeoutMs);
      try { fs.unlinkSync(f); } catch (_) {}
      return out;
    } catch (e) {
      try { fs.unlinkSync(f); } catch (_) {}
      lastErr = e;
      if (!/is not recognized|cannot find path|does not exist/i.test(String(e && e.message))) throw e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/* ---------- helpers ---------- */
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const s = (v) => (v == null ? '' : String(v)).trim();
const bool = (v) => !!(v === 1 || v === true || v === '1');

/* ---------- transform raw SQL rows -> window.DB shape ---------- */
function transform(raw, camCfg) {
  const units = raw.units.map((u) => ({
    id: 'U' + u.UnitID, name: s(u.UnitName), desc: s(u.UnitName),
    decimals: s(u.UnitName).toUpperCase() === 'KG' ? 0 : (s(u.UnitName).toUpperCase() === 'MT' ? 3 : 1),
    base: s(u.UnitName).toUpperCase() === 'KG', active: true
  }));
  // A real Product.TransactionType value wins; the legacy DB has no such
  // column, so classify by name: incoming MSW is Processing, RDF is RDF,
  // every other recovered material (bio earth, inert, glass, …) is Disposal.
  const inferTxnType = (name) => {
    const n = String(name || '').trim().toLowerCase();
    if (/^[,.\s]*m?sw$/.test(n)) return 'Processing';
    if (n === 'rdf') return 'RDF';
    return 'Disposal';
  };
  const products = raw.products.map((p) => {
    /* An explicit transaction type wins. 'All' and blank BOTH mean "not
     * decided", so both fall back to the name.
     *
     * 'All' used to be treated as a wildcard that showed the product under
     * every transaction type — which is how RDF ended up offered as a Disposal
     * product and as a Processing product, against the site's rules. Three rows
     * in the live master carry that tag (RDF, MSW, TROMMEL), almost certainly
     * from a migration rather than a deliberate choice. Resolving it by name
     * puts each of them under exactly one type. */
    const tag = s(p.TransactionType);
    return {
      id: 'P' + p.ProductID, name: s(p.ProductName), code: s(p.ProductCode), desc: s(p.Notes),
      unit: 'MT', rate: 0,
      txnType: (tag && tag !== 'All') ? tag : inferTxnType(p.ProductName),
      active: bool(p.IsActive)
    };
  });
  const accounts = raw.accounts.map((a) => {
    const nm = s(a.CompanyName) || (s(a.FirstName) + ' ' + s(a.LastName)).trim();
    return {
      id: 'A' + a.AccountID, name: nm || ('Account ' + a.AccountID),
      isTransporter: bool(a.IsTransporter), isAccount: bool(a.IsAccount),
      contact: (s(a.FirstName) + ' ' + s(a.LastName)).trim(), phone: s(a.ContactNo),
      city: s(a.City), active: bool(a.Active)
    };
  });
  const vehicles = raw.vehicles.map((v) => ({
    id: 'V' + v.VehicleID, no: s(v.VehicleNumber), type: s(v.VehicleType),
    accountId: v.AccountID ? ('A' + v.AccountID) : null, tare: num(v.TareWeight), cap: 40000, active: bool(v.IsActive)
  }));
  const gates = raw.gates.map((g) => ({
    id: 'G' + g.GateID, name: s(g.GateName), type: s(g.GateType) || 'BOTH', siteId: 'S1', active: bool(g.IsActive)
  }));
  const weighbridges = raw.weighbridges.map((w) => ({
    id: 'WB' + w.WeightBridgeID, name: s(w.ScaleName) || ('Scale ' + w.WeightBridgeID), siteId: 'S1',
    capacity: num(w.MaxCapacity) || 100000, platform: '', indicator: '',
    port: s(w.COMPort), baud: num(w.BaudRate) || 2400, dataBits: num(w.DataBits) || 8,
    parity: s(w.Parity) || 'None', stopBits: num(w.StopBits) || 1, status: 'online', active: bool(w.IsActive)
  }));
  const users = raw.users.map((u) => ({
    id: 'US' + u.UserID, username: s(u.UserName), first: s(u.FirstName), last: s(u.LastName),
    email: s(u.Email), phone: s(u.ContactNo), roleId: 'R' + u.TemplateID, siteId: null, active: bool(u.Active), last_login: ''
  }));
  const roleCount = {};
  users.forEach((u) => { roleCount[u.roleId] = (roleCount[u.roleId] || 0) + 1; });
  const roles = raw.roles.map((r) => ({ id: 'R' + r.TemplateID, name: s(r.TemplateName), desc: '', users: roleCount['R' + r.TemplateID] || 0 }));

  // Real drivers from the Driver table (id carries the SQL DriverID); ticket
  // driver names that never made it into the master get a name-only 'DN' entry.
  const drivers = (raw.drivers || []).map((d) => ({
    id: 'D' + d.DriverID, name: (s(d.FirstName) + ' ' + s(d.LastName)).trim() || ('Driver ' + d.DriverID),
    licence: s(d.IDProofNo), phone: '', accountId: d.AccountID ? ('A' + d.AccountID) : null, active: bool(d.Active)
  }));
  const driverMap = {};
  drivers.forEach((d) => { driverMap[d.name.toLowerCase()] = d.id; });
  raw.txns.forEach((t) => {
    const dn = s(t.DriverName);
    if (dn && !driverMap[dn.toLowerCase()]) {
      const id = 'DN' + (drivers.length + 1); driverMap[dn.toLowerCase()] = id;
      drivers.push({ id, name: dn, licence: '', phone: '', accountId: null, active: true });
    }
  });

  const detailsByTicket = {};
  raw.details.forEach((d) => { (detailsByTicket[d.ReceiptTicketID] = detailsByTicket[d.ReceiptTicketID] || []).push(d); });
  const mapType = (t) => { const x = s(t).toLowerCase(); if (x.startsWith('in')) return 'Processing'; if (x.startsWith('out')) return 'Disposal'; if (x.startsWith('both')) return 'RDF'; return 'Processing'; };
  const normStatus = (st) => { const x = s(st).toLowerCase(); if (x.startsWith('comp')) return 'Complete'; if (x.startsWith('act')) return 'Active'; if (x.startsWith('void')) return 'Void'; return 'Complete'; };

  const transactions = raw.txns.map((t) => {
    const ds = (detailsByTicket[t.ReceiptTicketID] || []).slice().sort((a, b) => num(a.SequenceNo) - num(b.SequenceNo));
    const passes = ds.map((d) => ({
      seq: num(d.SequenceNo) || 1, kind: /tare/i.test(s(d.WeighmentType)) ? 'Tare' : 'Gross',
      weight: num(d.CaptureWeight) || num(d.GrossWeight) || num(d.TareWeight),
      at: d.CaptureTime || d.GrossTime || d.TareTime || t.CreationTime,
      scale: s(d.WeighbridgeName), mode: bool(d.IsCapturedManual) ? 'Manual' : 'Auto', images: []
    }));
    const first = ds[0] || {}, last = ds[ds.length - 1] || {};
    const gross = ds.reduce((m, d) => Math.max(m, num(d.GrossWeight)), 0) || null;
    const tare = ds.reduce((m, d) => Math.max(m, num(d.TareWeight)), 0) || null;
    const net = num(last.NetWeight) || ((gross != null && tare != null) ? gross - tare : null);
    const gp = ds.filter((d) => num(d.GrossWeight)).pop(), tp = ds.filter((d) => num(d.TareWeight)).pop();
    const prodId = (ds.find((d) => d.ProductID) || {}).ProductID, gateId = (ds.find((d) => d.GateID) || {}).GateID;
    return {
      id: 'T' + t.TicketID, ticketNo: num(t.TicketID), status: normStatus(t.Status), mode: s(t.TransactionMode) || 'Double',
      type: mapType(t.TransactionType), direction: s(t.PlantDirectionType) || null, at: t.CreationTime, siteId: 'S1',
      wbId: first.WeightBridgeID ? ('WB' + first.WeightBridgeID) : (weighbridges[0] && weighbridges[0].id) || null,
      vehicleId: t.VehicleID ? ('V' + t.VehicleID) : null, transporterId: t.TransporterID ? ('A' + t.TransporterID) : null,
      accountId: t.AccountID ? ('A' + t.AccountID) : null,
      driverId: t.DriverID ? ('D' + t.DriverID) : (driverMap[s(t.DriverName).toLowerCase()] || null),
      rid: s(t.ReceiptTicketID) || null,
      productId: prodId ? ('P' + prodId) : null, gateId: gateId ? ('G' + gateId) : null, charges: num(t.Charges),
      tare, tareAt: tp ? (tp.TareTime || tp.CaptureTime) : null, gross, grossAt: gp ? (gp.GrossTime || gp.CaptureTime) : null,
      net, passes,
      cf: { cf1: s(t.CustomField1), cf2: s(t.CustomField2), cf3: s(t.CustomField3), cf4: s(t.CustomField4), cf5: s(t.CustomField5) },
      manual: ds.some((d) => bool(d.IsCapturedManual)), operatorId: t.CreatedBy ? ('US' + t.CreatedBy) : null, voidReason: null
    };
  }).sort((a, b) => new Date(b.at) - new Date(a.at));

  const audit = [];
  let aid = 0;
  transactions.slice(0, 120).forEach((t) => {
    const u = users.find((x) => x.id === t.operatorId);
    audit.push({ id: 'AU' + (++aid), table: 'Transaction', op: 'INSERT', at: t.at, user: u ? u.username : 'system',
      text: 'Ticket ' + t.ticketNo + ' — ' + t.mode + ' / ' + t.type + (t.net != null ? (' · net ' + t.net + ' kg') : ''), ref: t.id });
  });

  /* Cameras come from THIS terminal's own config.json, never from a baked-in
   * list — the addresses differ per weighbridge, and hardcoding them made the
   * Devices → Cameras screen show WB2's IPs on any other machine. Falls back to
   * an empty list rather than inventing addresses when none are configured. */
  const wbId = (weighbridges[0] || {}).id || null;
  const cameras = (camCfg || []).map((c, i) => {
    const host = (/^\w+:\/\/([^/:]+)/.exec(String(c.url || '')) || [])[1] || '';
    return {
      id: 'C' + (i + 1), name: s(c.label) || ('Camera ' + (i + 1)),
      type: String(c.type || '').toUpperCase() === 'RTSP' ? 'RTSP' : (s(c.type) || 'IP'),
      url: s(c.url), ip: host, port: Number(c.port) || (String(c.url || '').indexOf('rtsp:') === 0 ? 554 : 80),
      user: s(c.username), wbId, status: 'online', active: true
    };
  });

  return { units, products, accounts, vehicles, drivers, gates, weighbridges, users, roles, cameras, transactions, audit,
    _counts: { transactions: transactions.length, vehicles: vehicles.length, accounts: accounts.length, products: products.length } };
}

/* ---------- public API ---------- */
/* cameras: this terminal's config.json `cameras` array, so the Devices screen
   shows the machine it is actually running on. Optional — omitting it just
   leaves the camera list empty. */
async function snapshot(cfg, cameras) {
  const scriptPath = path.join(__dirname, 'wb-query.ps1');
  const out = await runPs(['-File', scriptPath, '-Server', cfg.server, '-Database', cfg.database], 90000);
  const raw = JSON.parse(out.replace(/^﻿/, ''));
  // ConvertTo-Json collapses a 1-row table to an object; normalize every set to an array.
  for (const k of Object.keys(raw)) if (raw[k] && !Array.isArray(raw[k])) raw[k] = [raw[k]];
  return transform(raw, cameras);
}

function sqlEsc(v) { return String(v == null ? '' : v).replace(/'/g, "''"); }

/** Next ticket number from the live DB (MAX+1), matching the legacy allocation. */
async function nextTicketNo(cfg) {
  const out = await runPayload(cfg, { mode: 'scalar', sql: 'SELECT ISNULL(MAX(TicketID),0)+1 FROM TransactionData' }, 20000);
  const m = /OK:(\d+)/.exec(out || '');
  return m ? parseInt(m[1], 10) : 1;
}

const S  = (v) => `N'${sqlEsc(v)}'`;
const NS = (v) => (v == null || v === '' ? 'NULL' : S(v));
const NN = (v) => (num(v) ? num(v) : 'NULL');

/* Schema tolerance: a legacy station DB may lack the newer optional columns
 * (TransactionData.CustomField1-5, Product.TransactionType). Feature-detect
 * once per database and shape the SQL accordingly, so the same build runs
 * against both the legacy schema and the upgraded central one. */
const colCache = {};
async function hasCol(cfg, table, col) {
  const k = cfg.database + '.' + table + '.' + col;
  if (k in colCache) return colCache[k];
  try {
    const out = await runPayload(cfg, { mode: 'scalar', sql: `SELECT ISNULL(COL_LENGTH('dbo.${table}','${col}'),0)` }, 15000);
    const m = /OK:(-?\d+)/.exec(out || '');
    colCache[k] = !!(m && parseInt(m[1], 10) > 0);
  } catch (_) { colCache[k] = false; }
  return colCache[k];
}

/**
 * Write a weighment to the live DB, exactly like the legacy app:
 *  - fresh ticket  (t.update falsy): TicketID allocated MAX+1 inside the same
 *    transaction, TransactionData row + one TransactionDetail per pass.
 *  - recalled ticket (t.update true, t.receiptTicketId set): TransactionData
 *    is marked Complete and only the NEW passes are appended.
 * Returns { ok, ticketNo, receiptTicketId }.
 */
async function saveTicket(cfg, t) {
  const rid = t.receiptTicketId || cryptoLib.randomUUID().toUpperCase();
  const now = t.createdAt || new Date().toISOString().slice(0, 19).replace('T', ' ');

  const detailSql = (p, i) => {
    const isTare = /tare/i.test(p.kind || ''), isGross = /gross/i.test(p.kind || '');
    const tareManual = (isTare && p.manual) ? 1 : 0, grossManual = (isGross && p.manual) ? 1 : 0, capManual = p.manual ? 1 : 0;
    const at = p.at || now;
    return `INSERT INTO TransactionDetail (ReceiptTicketID,WeightBridgeID,SequenceNo,ProductID,GateID,WeighmentType,CaptureWeight,CaptureTime,GrossWeight,GrossTime,TareWeight,TareTime,NetWeight,WeightUnit,UserID,UserName,WeighbridgeName,ProductName,GateName,IsTareManual,IsGrossManual,IsCapturedManual) VALUES (${S(rid)},${num(t.weightBridgeId)},${num(p.seq) || (i + 1)},${NN(t.productId)},${NN(t.gateId)},${S(p.kind || 'Gross')},${num(p.weight)},${S(at)},${isGross ? num(p.weight) : NN(p.gross)},${isGross ? S(at) : 'NULL'},${isTare ? num(p.weight) : NN(p.tare)},${isTare ? S(at) : 'NULL'},${NN(p.net)},'Kg',${NN(t.createdBy)},${NS(t.userName)},${NS(t.weighbridgeName)},${NS(t.productName)},${NS(t.gateName)},${tareManual},${grossManual},${capManual})`;
  };

  const statements = [];
  let allocate = null, tid = null;
  if (t.update) {
    tid = num(t.ticketNo);
    /* Metadata corrected while capturing the closing weighment has to land on
     * the ticket that already exists — writing Status alone silently discarded
     * every other edit.
     *
     * Deliberately NOT touched: VehicleID/VehicleNumber and CreationTime (the
     * ticket's identity and its reporting position stay fixed, matching the
     * fields the UI keeps locked), and AccountID/AccountName, which the
     * renderer always sends as null and would otherwise be wiped. No weight
     * column is written here. */
    const sets = [
      `Status=${S(t.status || 'Complete')}`,
      `TransactionType=${S(t.transactionType || 'Incoming')}`,
      `PlantDirectionType=${NS(t.direction)}`,
      `TransporterID=${NN(t.transporterId)}`,
      `TransporterName=${NS(t.transporterName)}`,
      `DriverID=${NN(t.driverId)}`,
      `DriverName=${NS(t.driverName)}`
    ];
    if (await hasCol(cfg, 'TransactionData', 'CustomField1')) {
      sets.push(`CustomField1=${NS(t.cf1)}`, `CustomField2=${NS(t.cf2)}`, `CustomField3=${NS(t.cf3)}`,
                `CustomField4=${NS(t.cf4)}`, `CustomField5=${NS(t.cf5)}`);
    }
    statements.push(`UPDATE TransactionData SET ${sets.join(',')} WHERE ReceiptTicketID=${S(rid)}`);
    /* Product and Gate live on the DETAIL rows, and the reader takes the first
     * row that carries one — so an edit only sticks if every pass of the ticket
     * is brought into line, not just the pass being inserted now. */
    if (num(t.productId) || num(t.gateId)) {
      statements.push(`UPDATE TransactionDetail SET ProductID=${NN(t.productId)},ProductName=${NS(t.productName)},` +
        `GateID=${NN(t.gateId)},GateName=${NS(t.gateName)} WHERE ReceiptTicketID=${S(rid)}`);
    }
  } else {
    allocate = 'SELECT ISNULL(MAX(TicketID),0)+1 FROM TransactionData';
    if (t.ticketNo) tid = num(t.ticketNo);
    const hasCf = await hasCol(cfg, 'TransactionData', 'CustomField1');
    const cfCols = hasCf ? ',CustomField1,CustomField2,CustomField3,CustomField4,CustomField5' : '';
    const cfVals = hasCf ? `,${NS(t.cf1)},${NS(t.cf2)},${NS(t.cf3)},${NS(t.cf4)},${NS(t.cf5)}` : '';
    statements.push(`INSERT INTO TransactionData (TicketID,VehicleID,DriverID,AccountID,TransporterID,Status,TransactionMode,TransactionType,PlantDirectionType,ReceiptTicketID,Charges,CreationTime,CreatedBy,VehicleNumber,DriverName,TransporterName,AccountName${cfCols}) VALUES ({TID},${NN(t.vehicleId)},${NN(t.driverId)},${NN(t.accountId)},${NN(t.transporterId)},${S(t.status || 'Complete')},${S(t.mode || 'Double')},${S(t.transactionType || 'Incoming')},${NS(t.direction)},${S(rid)},${num(t.charges)},${S(now)},${NN(t.createdBy)},${S(t.vehicleNo)},${NS(t.driverName)},${NS(t.transporterName)},${NS(t.accountName)}${cfVals})`);
  }
  (t.passes || []).forEach((p, i) => statements.push(detailSql(p, i)));

  /* Two-pass normalisation (see views-ops normPair): on a completing Double
   * ticket the heavier reading is ALWAYS the gross and the lighter one the
   * tare, so NetWeight can never come out negative — whichever button the
   * operator pressed for each pass.
   *
   * Emitted as UPDATEs inside the SAME transaction as the INSERTs above so it
   * also rewrites the FIRST pass's row, which was written on an earlier save
   * (the recall flow only inserts the closing pass here). SequenceNo,
   * CaptureWeight, CaptureTime and WeighmentType — the pass log — are left
   * exactly as captured; only the derived Gross/Tare/Net columns move. */
  const nz = t.normalize;
  if (nz && num(nz.grossSeq) && num(nz.tareSeq) && num(nz.grossSeq) !== num(nz.tareSeq)) {
    const where = `WHERE ReceiptTicketID=${S(rid)}`;
    statements.push(`UPDATE TransactionDetail SET GrossWeight=${num(nz.gross)},GrossTime=CaptureTime,TareWeight=NULL,TareTime=NULL ${where} AND SequenceNo=${num(nz.grossSeq)}`);
    statements.push(`UPDATE TransactionDetail SET TareWeight=${num(nz.tare)},TareTime=CaptureTime,GrossWeight=NULL,GrossTime=NULL ${where} AND SequenceNo=${num(nz.tareSeq)}`);
    statements.push(`UPDATE TransactionDetail SET NetWeight=NULL ${where} AND SequenceNo<>${num(nz.netSeq)}`);
    statements.push(`UPDATE TransactionDetail SET NetWeight=${num(nz.net)} ${where} AND SequenceNo=${num(nz.netSeq)}`);
  }

  const out = await runPayload(cfg, { mode: 'tx', allocate, tid, statements }, 30000);
  const m = /OK:(\d+)/.exec(out || '');
  return { ok: !!m, ticketNo: m ? parseInt(m[1], 10) : (num(t.ticketNo) || null), receiptTicketId: rid };
}

/**
 * Insert a vehicle into the Vehicle master (IDENTITY VehicleID comes back),
 * mirroring the legacy quick-add.
 */
async function saveVehicle(cfg, v) {
  const sql = `INSERT INTO Vehicle (VehicleNumber,VehicleType,TareWeight,AccountID,IsActive) VALUES (${S(v.no)},${NS(v.type)},${num(v.tare)},${NN(v.accountId)},1); SELECT CAST(SCOPE_IDENTITY() AS int)`;
  const out = await runPayload(cfg, { mode: 'scalar', sql }, 20000);
  const m = /OK:(\d+)/.exec(out || '');
  return m ? { ok: true, vehicleId: parseInt(m[1], 10) } : { ok: false, error: 'insert failed' };
}

/* ---------- master-data writes ----------
 * Column maps mirror the legacy tables exactly (probed via INFORMATION_SCHEMA).
 * Values here are already SQL literals (S/NS produce N'…', numbers stay raw). */
const splitName = (v) => { const s2 = String(v || '').trim(), i = s2.indexOf(' '); return i > 0 ? [s2.slice(0, i), s2.slice(i + 1)] : [s2, '']; };
const MASTERS_SQL = {
  vehicles: { table: 'Vehicle', pk: 'VehicleID', map: (f) => ({
    VehicleNumber: S(f.no), VehicleType: NS(f.type), TareWeight: num(f.tare),
    AccountID: NN(f.accountId), IsActive: f.active === false ? 0 : 1 }) },
  accounts: { table: 'Account', pk: 'AccountID', map: (f) => {
    const [first, last] = splitName(f.contact || f.name);
    return { CompanyName: S(f.name), FirstName: S(first || String(f.name || '')), LastName: NS(last),
      ContactNo: NS(f.phone), City: NS(f.city),
      IsTransporter: f.isTransporter ? 1 : 0, IsAccount: f.isAccount ? 1 : 0, Active: f.active === false ? 0 : 1 }; } },
  drivers: { table: 'Driver', pk: 'DriverID', map: (f) => {
    const [first, last] = splitName(f.name);
    return { FirstName: S(first), LastName: NS(last), IDProofNo: NS(f.licence),
      AccountID: NN(f.accountId), Active: f.active === false ? 0 : 1 }; } },
  products: { table: 'Product', pk: 'ProductID', map: (f) => ({
    ProductName: S(f.name), ProductCode: NS(f.code), Notes: NS(f.desc), TransactionType: NS(f.txnType), IsActive: f.active === false ? 0 : 1 }) },
  gates: { table: 'Gate', pk: 'GateID', map: (f) => ({
    GateName: S(f.name), GateType: S(f.type || 'BOTH'), IsActive: f.active === false ? 0 : 1 }) },
  units: { table: 'Unit', pk: 'UnitID', map: (f) => ({ UnitName: S(f.name) }) },
  weighbridges: { table: 'WeightBridge', pk: 'WeightBridgeID', map: (f) => ({
    ScaleName: S(f.name), MaxCapacity: NS(String(f.capacity || '')), COMPort: NS(f.port),
    BaudRate: NS(String(f.baud || '')), DataBits: NN(f.dataBits), Parity: NS(f.parity),
    StopBits: NS(String(f.stopBits || '')), IsActive: f.active === false ? 0 : 1 }) }
};

/**
 * Insert or update one master record. { entity, id (numeric PK or null), fields }.
 * Returns { ok, id } — for inserts, id is the new IDENTITY value.
 */
async function saveMaster(cfg, { entity, id, fields }) {
  const def = MASTERS_SQL[entity];
  if (!def) return { ok: false, error: 'no SQL mapping for "' + entity + '"' };
  const cols = def.map(fields || {});
  if (entity === 'products' && !(await hasCol(cfg, 'Product', 'TransactionType'))) delete cols.TransactionType;
  const keys = Object.keys(cols);
  const sql = id
    ? `UPDATE ${def.table} SET ` + keys.map((k) => `${k}=${cols[k]}`).join(',') + ` WHERE ${def.pk}=${num(id)}; SELECT ${num(id)}`
    : `INSERT INTO ${def.table} (` + keys.join(',') + `) VALUES (` + keys.map((k) => cols[k]).join(',') + `); SELECT CAST(SCOPE_IDENTITY() AS int)`;
  const out = await runPayload(cfg, { mode: 'scalar', sql }, 20000);
  const m = /OK:(\d+)/.exec(out || '');
  return m ? { ok: true, id: parseInt(m[1], 10) } : { ok: false, error: 'save failed' };
}

/**
 * Verify a username/password against the live UserMaster (legacy salt scheme).
 * Returns { ok, user:{ id, username, name, roleId } } or { ok:false, error }.
 */
async function authenticate(cfg, username, password) {
  const sql = `SELECT TOP 1 UserID,UserName,FirstName,LastName,TemplateID,Salt,CAST(Active AS int) AS Active FROM UserMaster WHERE LOWER(UserName)=LOWER(${S(String(username || '').toLowerCase())})`;
  let out;
  try { out = await runPayload(cfg, { mode: 'row', sql }, 15000); } catch (e) { return { ok: false, error: 'db error' }; }
  const m = /OK:(.*)$/s.exec((out || '').replace(/^﻿/, '').trim());
  if (!m || !m[1]) return { ok: false, error: 'Unknown user' };
  let u; try { u = JSON.parse(m[1]); } catch (_) { return { ok: false, error: 'auth error' }; }
  if (!u.Active) return { ok: false, error: 'Account is inactive' };
  if (!u.Salt || u.Salt !== createSalt(u.UserName, password)) return { ok: false, error: 'Invalid username or password' };
  // TemplateID 1 (Admin) -> super admin (R0, full access incl. delete); 2 -> operator (R3); else administrator (R1)
  const roleId = u.TemplateID === 1 ? 'R0' : (u.TemplateID === 2 ? 'R3' : 'R1');
  const first = u.FirstName || u.UserName;
  const last = u.LastName || '';
  const name = ((u.FirstName || '') + ' ' + (u.LastName || '')).trim() || u.UserName;
  return { ok: true, user: { id: 'US' + u.UserID, username: u.UserName, first, last, name, roleId, siteId: null, active: true } };
}

/** Persist one capture photo (a JPEG file on disk) into the local TransactionImage table. */
async function saveImage(cfg, img) {
  const args = ['-File', path.join(__dirname, 'wb-image.ps1'), '-Server', cfg.server, '-Database', cfg.database,
    '-ScaleID', String(img.scaleId || ''), '-Rid', String(img.rid || ''), '-TicketID', String(img.ticketNo || 0),
    '-CameraID', String(img.cameraId || ''), '-Seq', String(img.seq || 0), '-Kind', String(img.kind || ''), '-File', String(img.file || '')];
  try { const out = await runPs(args, 20000); return { ok: /OK/.test(out || '') }; }
  catch (e) { return { ok: false, error: e.message }; }
}

/**
 * Correct saved weights on a ticket via wb-edit.ps1 — one invocation per
 * changed field, each atomic (update + net recompute + TransactionAudit row
 * in one SQL transaction). payload: { rid, ticketNo, scaleId, reason,
 * userName, changes: [{ field: 'GrossWeight'|'TareWeight', value }] }.
 */
async function editWeights(cfg, p) {
  const allowed = { GrossWeight: 1, TareWeight: 1 };
  const changes = ((p && p.changes) || []).filter((c) => c && allowed[c.field]);
  if (!changes.length) return { ok: false, error: 'nothing to change' };
  if (!p.rid) return { ok: false, error: 'ticket has no ReceiptTicketID' };
  for (const c of changes) {
    const args = ['-File', path.join(__dirname, 'wb-edit.ps1'), '-Server', cfg.server, '-Database', cfg.database,
      '-ScaleID', String(p.scaleId || ''), '-Rid', String(p.rid), '-TicketID', String(p.ticketNo || 0),
      '-Field', String(c.field), '-NewValue', String(c.value), '-Reason', String(p.reason || ''), '-UserName', String(p.userName || '')];
    try {
      const out = await runPs(args, 30000);
      if (!/OK/.test(out || '')) return { ok: false, error: (out || 'edit failed').trim() };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  return { ok: true, changed: changes.length };
}

module.exports = { snapshot, nextTicketNo, saveTicket, saveVehicle, saveMaster, authenticate, createSalt, saveImage, editWeights };
