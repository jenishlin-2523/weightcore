/* ==========================================================================
   WeighCore — demo dataset
   Deterministic: a seeded PRNG generates the transaction history so every
   reload shows identical numbers. NOW is pinned to the recording date.
   ========================================================================== */
(function () {
  'use strict';

  // Pinned "now" so the demo is reproducible (date of the source recordings).
  const NOW = new Date(2026, 7, 4, 15, 20, 0);

  /* ---------- seeded PRNG ---------- */
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const rnd = makeRng(20260804);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pickW = (pairs) => {                       // [[value, weight], …]
    const total = pairs.reduce((n, p) => n + p[1], 0);
    let r = rnd() * total;
    for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
    return pairs[pairs.length - 1][0];
  };
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  /* ---------- company / org ---------- */
  const company = {
    name: 'M/s. Chennai Bio Mining Limited',
    project: 'Reclamation of Kodungaiyur Dumpsite — Package 5',
    address: 'Kodungaiyur Dumpsite, Chennai 600 118, Tamil Nadu',
    phone: '+91 44 2345 6789',
    email: 'ops@chennaibiomining.in',
    clientCompany: 'Greater Chennai Corporation',
    clientContact: 'Superintending Engineer (SWM)',
    clientAddress: 'Ripon Building, Chennai 600 003',
    supportEmail: 'support@weighcore.app',
    supportPhone: '1800 202 4455',
    gstin: '33AABCC1234D1ZP'
  };

  const sites = [
    { id: 'S1', code: 'P5WB1', name: 'Package 5 — Weighbridge 1', address: 'North gate, Kodungaiyur' },
    { id: 'S2', code: 'P5WB2', name: 'Package 5 — Weighbridge 2', address: 'RDF yard, Kodungaiyur' }
  ];

  const units = [
    { id: 'U1', name: 'KG', desc: 'Kilogram', decimals: 0, base: true, active: true },
    { id: 'U2', name: 'MT', desc: 'Metric tonne', decimals: 3, base: false, active: true },
    { id: 'U3', name: 'LBS', desc: 'Pound', decimals: 1, base: false, active: true }
  ];

  const weighbridges = [
    { id: 'WB1', name: 'Scale 1', siteId: 'S1', capacity: 100000, platform: '18 m × 3 m', indicator: 'Essae DS-252', port: 'COM3', baud: 2400, dataBits: 8, parity: 'None', stopBits: 1, status: 'online', active: true },
    { id: 'WB2', name: 'Scale 2', siteId: 'S2', capacity: 100000, platform: '18 m × 3 m', indicator: 'Avery E1205', port: 'COM4', baud: 2400, dataBits: 8, parity: 'None', stopBits: 1, status: 'online', active: true },
    { id: 'WB3', name: 'Scale 3 (axle)', siteId: 'S2', capacity: 60000, platform: '6 m × 3 m', indicator: 'Essae DS-252', port: 'COM5', baud: 9600, dataBits: 8, parity: 'None', stopBits: 1, status: 'offline', active: false }
  ];

  const cameras = [
    { id: 'C1', name: 'Lane 1 — Front', type: 'RTSP/MJPEG', url: 'rtsp://192.168.1.112:554/profile2', ip: '192.168.1.112', port: 554, user: 'admin', wbId: 'WB1', status: 'online', active: true },
    { id: 'C2', name: 'Lane 1 — Rear', type: 'RTSP/MJPEG', url: 'rtsp://192.168.1.114:554/profile2', ip: '192.168.1.114', port: 554, user: 'admin', wbId: 'WB1', status: 'online', active: true }
  ];

  const gates = [
    { id: 'G1', name: 'Package-5 Main', type: 'BOTH', siteId: 'S1', active: true },
    { id: 'G2', name: 'Package-5 WB 2', type: 'BOTH', siteId: 'S2', active: true },
    { id: 'G3', name: 'North Tipping Face', type: 'IN', siteId: 'S1', active: true },
    { id: 'G4', name: 'RDF Dispatch', type: 'OUT', siteId: 'S2', active: true },
    { id: 'G5', name: 'Package 5 Wb2', type: 'BOTH', siteId: 'S2', active: true },   // duplicate of G2 (data-quality demo)
    { id: 'G6', name: 'test', type: 'BOTH', siteId: 'S1', active: true }             // stray test record
  ];

  const products = [
    { id: 'P1', name: 'MSW', code: 'MSW', desc: 'Municipal solid waste (raw)', unit: 'MT', rate: 0, txnType: 'Processing', active: true },
    { id: 'P2', name: 'RDF', code: 'RDF', desc: 'Refuse derived fuel', unit: 'MT', rate: 1450, txnType: 'RDF', active: true },
    { id: 'P3', name: 'Inert', code: 'INR', desc: 'Inert / soil fraction', unit: 'MT', rate: 0, txnType: 'Disposal', active: true },
    { id: 'P4', name: 'Bio Earth', code: 'BIOE', desc: 'Stabilised bio earth', unit: 'MT', rate: 380, txnType: 'Disposal', active: true },
    { id: 'P5', name: 'Trommel Fines', code: 'TRF', desc: 'Screened fines < 20 mm', unit: 'MT', rate: 0, txnType: 'Processing', active: true },
    { id: 'P6', name: 'C&D Waste', code: 'CND', desc: 'Construction & demolition', unit: 'MT', rate: 0, txnType: 'Disposal', active: true },
    { id: 'P7', name: 'Scrap Metal', code: 'SCRP', desc: 'Ferrous recovery', unit: 'MT', rate: 18500, txnType: 'Disposal', active: true },
    { id: 'P8', name: 'Wood', code: 'WOOD', desc: 'Woody fraction', unit: 'MT', rate: 900, txnType: 'Disposal', active: true },
    { id: 'P9', name: 'Stone', code: 'STN', desc: 'Stone / aggregate', unit: 'MT', rate: 0, txnType: 'Disposal', active: true },
    { id: 'P10', name: 'Leachate', code: 'LCH', desc: 'Leachate tanker', unit: 'MT', rate: 0, txnType: 'Disposal', active: true },
    { id: 'P11', name: 'test', code: 'TEST', desc: '', unit: 'MT', rate: 0, txnType: 'All', active: true }  // stray test record
  ];

  const accounts = [
    { id: 'A1',  name: 'Vinayaga Transport',      isTransporter: true,  isAccount: false, contact: 'R. Selvam',    phone: '9840012345', city: 'Chennai', active: true },
    { id: 'A2',  name: 'Velavan Transport',       isTransporter: true,  isAccount: false, contact: 'K. Velavan',   phone: '9840023456', city: 'Chennai', active: true },
    { id: 'A3',  name: 'M K Transport',           isTransporter: true,  isAccount: false, contact: 'M. Karthik',   phone: '9840034567', city: 'Tiruvallur', active: true },
    { id: 'A4',  name: 'Radha Transport',         isTransporter: true,  isAccount: false, contact: 'S. Radha',     phone: '9840045678', city: 'Chennai', active: true },
    { id: 'A5',  name: 'Ayyanar Transport',       isTransporter: true,  isAccount: false, contact: 'P. Ayyanar',   phone: '9840056789', city: 'Chengalpattu', active: true },
    { id: 'A6',  name: 'SSS Transport',           isTransporter: true,  isAccount: false, contact: 'S. Suresh',    phone: '9840067890', city: 'Chennai', active: true },
    { id: 'A7',  name: 'MRJ Transport',           isTransporter: true,  isAccount: false, contact: 'J. Mohan',     phone: '9840078901', city: 'Chennai', active: true },
    { id: 'A8',  name: 'Sree Balaji Carriers',    isTransporter: true,  isAccount: false, contact: 'B. Ganesh',    phone: '9840089012', city: 'Kanchipuram', active: true },
    { id: 'A9',  name: 'VINAYAGA TRANSPORT',      isTransporter: true,  isAccount: false, contact: 'R Selvam',     phone: '9840012345', city: 'Chennai', active: true },  // dupe of A1
    { id: 'A10', name: 'Vinayaka transport',      isTransporter: true,  isAccount: false, contact: '',             phone: '',           city: 'Chennai', active: true },  // dupe of A1
    { id: 'A11', name: 'Chennai Bio Mining Ltd',  isTransporter: false, isAccount: true,  contact: 'Project Office', phone: '4423456789', city: 'Chennai', active: true },
    { id: 'A12', name: 'Greater Chennai Corporation', isTransporter: false, isAccount: true, contact: 'SE (SWM)',  phone: '4425384520', city: 'Chennai', active: true },
    { id: 'A13', name: 'Aqua World Export Pvt Ltd', isTransporter: false, isAccount: true, contact: 'Accounts',    phone: '4428123456', city: 'Chennai', active: true },
    { id: 'A14', name: 'Zigma Global Enviro',     isTransporter: false, isAccount: true,  contact: 'Site Manager', phone: '9841122334', city: 'Erode', active: true },
    { id: 'A15', name: 'SELF',                    isTransporter: true,  isAccount: true,  contact: '',             phone: '',           city: '', active: true },
    { id: 'A16', name: 'test',                    isTransporter: true,  isAccount: true,  contact: '',             phone: '',           city: '', active: true }          // stray test record
  ];

  const VT = {
    t10: 'TIPPER 10 WHEEL', t12: 'TIPPER 12 WHEEL', t22: 'TIPPER 22 WHEEL',
    l22: 'LORRY 22 WHEEL', tr40: 'TRAILER 40 FT', h6: 'HYVA 6 WHEEL'
  };

  const vehicles = [
    { id: 'V1',  no: 'TN45CB6689', type: VT.t10, accountId: 'A1',  tare: 11660, cap: 26000, active: true },
    { id: 'V2',  no: 'TN39DE9995', type: VT.t22, accountId: 'A2',  tare: 14900, cap: 40000, active: true },
    { id: 'V3',  no: 'TN48CZ1181', type: VT.t22, accountId: 'A3',  tare: 17340, cap: 40000, active: true },
    { id: 'V4',  no: 'TN18Q1953',  type: VT.t10, accountId: 'A1',  tare: 10840, cap: 26000, active: true },
    { id: 'V5',  no: 'TN61H3456',  type: VT.t12, accountId: 'A4',  tare: 13060, cap: 31000, active: true },
    { id: 'V6',  no: 'TN52A7786',  type: VT.t12, accountId: 'A5',  tare: 11200, cap: 31000, active: true },
    { id: 'V7',  no: 'TN52A0786',  type: VT.t12, accountId: 'A5',  tare: 11390, cap: 31000, active: true },
    { id: 'V8',  no: 'TN45BQ1973', type: VT.t22, accountId: 'A6',  tare: 16060, cap: 40000, active: true },
    { id: 'V9',  no: 'TN47AH099',  type: VT.t22, accountId: 'A7',  tare: 13170, cap: 40000, active: true },
    { id: 'V10', no: 'TN05AK3605', type: VT.l22, accountId: 'A8',  tare: 16270, cap: 40000, active: true },
    { id: 'V11', no: 'TN81Q5319',  type: VT.t10, accountId: 'A2',  tare: 10980, cap: 26000, active: true },
    { id: 'V12', no: 'TN81L9526',  type: VT.t10, accountId: 'A3',  tare: 11040, cap: 26000, active: true },
    { id: 'V13', no: 'TN02BJ0534', type: VT.t10, accountId: 'A4',  tare: 10920, cap: 26000, active: true },
    { id: 'V14', no: 'TN22DA4417', type: VT.h6,  accountId: 'A6',  tare: 8420,  cap: 18000, active: true },
    { id: 'V15', no: 'TN11Z4560',  type: VT.t10, accountId: 'A1',  tare: 10600, cap: 26000, active: true },
    { id: 'V16', no: 'TN30BH7712', type: VT.tr40,accountId: 'A8',  tare: 19850, cap: 49000, active: true },
    { id: 'V17', no: 'TN19CK2204', type: VT.t12, accountId: 'A7',  tare: 12480, cap: 31000, active: true },
    { id: 'V18', no: 'TN63AA9081', type: VT.h6,  accountId: 'A5',  tare: 8190,  cap: 18000, active: true },
    { id: 'V19', no: 'TN47AF2917', type: 'LORRY 22', accountId: 'A7', tare: 0,  cap: 40000, active: true },  // tare missing
    { id: 'V20', no: 'TN69BB7494', type: '',      accountId: 'A15', tare: 0,    cap: 26000, active: true },  // tare + type missing
    { id: 'V21', no: 'TN88J3688',  type: '',      accountId: 'A15', tare: 0,    cap: 26000, active: true },  // tare + type missing
    { id: 'V22', no: 'TN28AL5447', type: '',      accountId: 'A15', tare: 0,    cap: 26000, active: true },  // tare + type missing
    { id: 'V23', no: 'TN61H1234',  type: VT.t12, accountId: 'A4',  tare: 13230, cap: 31000, active: true },
    { id: 'V24', no: 'TN09CV5533', type: VT.t10, accountId: 'A6',  tare: 11310, cap: 26000, active: true },
    { id: 'V25', no: 'TN33BX1190', type: VT.t22, accountId: 'A2',  tare: 15720, cap: 40000, active: true },
    { id: 'V26', no: 'TN12TEST01', type: '',      accountId: 'A16', tare: 0,    cap: 26000, active: true }   // stray test record
  ];

  const drivers = [
    { id: 'D1', name: 'R. Murugan',    licence: 'TN37 20110004521', phone: '9600011223', accountId: 'A1', active: true },
    { id: 'D2', name: 'S. Anbarasu',   licence: 'TN02 20090113344', phone: '9600022334', accountId: 'A2', active: true },
    { id: 'D3', name: 'K. Dhanasekar', licence: 'TN45 20140087213', phone: '9600033445', accountId: 'A3', active: true },
    { id: 'D4', name: 'M. Vetrivel',   licence: 'TN11 20120044120', phone: '9600044556', accountId: 'A4', active: true },
    { id: 'D5', name: 'P. Sathish',    licence: 'TN19 20160091882', phone: '9600055667', accountId: 'A5', active: true },
    { id: 'D6', name: 'A. Jeyakumar',  licence: 'TN22 20100031097', phone: '9600066778', accountId: 'A6', active: true },
    { id: 'D7', name: 'T. Ramesh',     licence: 'TN30 20150072345', phone: '9600077889', accountId: 'A7', active: true },
    { id: 'D8', name: 'V. Balaji',     licence: 'TN09 20130055018', phone: '9600088990', accountId: 'A8', active: true },
    { id: 'D9', name: 'N. Saravanan',  licence: 'TN63 20170064411', phone: '9600099001', accountId: 'A1', active: true },
    { id: 'D10',name: 'G. Prakash',    licence: 'TN52 20110029987', phone: '9600010112', accountId: 'A5', active: false }
  ];

  const roles = [
    { id: 'R0', name: 'Super Administrator', desc: 'Everything, plus the only role that can delete a ticket', users: 1 },
    { id: 'R1', name: 'Administrator', desc: 'Full access, including settings and licensing', users: 1 },
    { id: 'R2', name: 'Supervisor',    desc: 'Operations + reports + void authority',        users: 1 },
    { id: 'R3', name: 'Weighbridge Operator', desc: 'Weighing and printing only',            users: 2 },
    { id: 'R4', name: 'Auditor',       desc: 'Read-only across the whole system',            users: 1 },
    { id: 'RV', name: 'Dashboard & Transactions', desc: 'Sees the dashboard and the ticket ledger only — nothing else', users: 1 }
  ];

  const users = [
    { id: 'US0', username: 'superadmin', first: 'Super', last: 'Admin',   email: 'super@chennaibiomining.in',  phone: '9840000000', roleId: 'R0', siteId: null, active: true,  last_login: '04-08-2026 09:40' },
    { id: 'USV', username: 'viewer',    first: 'Site',   last: 'Viewer',  email: 'viewer@chennaibiomining.in', phone: '9840000009', roleId: 'RV', siteId: null, active: true,  last_login: '04-08-2026 08:55' },
    { id: 'US1', username: 'admin',     first: 'Admin',  last: 'User',    email: 'admin@chennaibiomining.in',  phone: '9840000001', roleId: 'R1', siteId: null, active: true,  last_login: '04-08-2026 08:12' },
    { id: 'US2', username: 'm.fathima', first: 'M.',     last: 'Fathima', email: 'fathima@chennaibiomining.in',phone: '9840000002', roleId: 'R2', siteId: null, active: true,  last_login: '04-08-2026 07:55' },
    { id: 'US3', username: 'r.kumar',   first: 'R.',     last: 'Kumar',   email: 'kumar@chennaibiomining.in',  phone: '9840000003', roleId: 'R3', siteId: 'S1', active: true,  last_login: '04-08-2026 06:02' },
    { id: 'US4', username: 's.prabhu',  first: 'S.',     last: 'Prabhu',  email: 'prabhu@chennaibiomining.in', phone: '9840000004', roleId: 'R3', siteId: 'S2', active: true,  last_login: '04-08-2026 06:05' },
    { id: 'US5', username: 'auditor',   first: 'GCC',    last: 'Auditor', email: 'audit@chennaicorporation.gov.in', phone: '', roleId: 'R4', siteId: null, active: true, last_login: '01-08-2026 11:30' },
    { id: 'US6', username: 'endelsupport', first: 'Vendor', last: 'Support', email: 'support@weighcore.app', phone: '', roleId: 'R4', siteId: null, active: false, last_login: '22-07-2026 16:40' }
  ];

  /* Permission features — mirrors the role matrix found in the legacy system */
  const features = [
    { group: 'Weighment',   key: 'txn.manage',     label: 'Transaction Management' },
    { group: 'Weighment',   key: 'txn.weigh',      label: 'Create / continue weighment' },
    { group: 'Weighment',   key: 'txn.print',      label: 'Print receipt' },
    { group: 'Weighment',   key: 'txn.void',       label: 'Void transaction' },
    { group: 'Weighment',   key: 'txn.delete',     label: 'Delete transaction (Super Admin only)' },
    { group: 'Weighment',   key: 'txn.manual',     label: 'Manual weight entry' },
    { group: 'Weighment',   key: 'txn.manualstar', label: 'Suppress manual-entry marker' },
    { group: 'Weighment',   key: 'txn.backdate',   label: 'Edit transaction date-time' },
    { group: 'Master data', key: 'md.vehicle',     label: 'Vehicles' },
    { group: 'Master data', key: 'md.account',     label: 'Accounts & parties' },
    { group: 'Master data', key: 'md.driver',      label: 'Drivers' },
    { group: 'Master data', key: 'md.product',     label: 'Products' },
    { group: 'Master data', key: 'md.gate',        label: 'Gates & locations' },
    { group: 'Master data', key: 'md.unit',        label: 'Units' },
    { group: 'Devices',     key: 'dev.weighbridge',label: 'Weighbridges' },
    { group: 'Devices',     key: 'dev.camera',     label: 'Cameras' },
    { group: 'Insight',     key: 'rep.transaction',label: 'Transaction reports' },
    { group: 'Insight',     key: 'rep.master',     label: 'Master reports' },
    { group: 'Insight',     key: 'rep.audit',      label: 'Audit trail' },
    { group: 'Insight',     key: 'rep.quality',    label: 'Data quality' },
    { group: 'Administration', key: 'adm.user',    label: 'Users' },
    { group: 'Administration', key: 'adm.role',    label: 'Roles & permissions' },
    { group: 'Administration', key: 'adm.settings',label: 'System settings' },
    { group: 'Administration', key: 'adm.backup',  label: 'Backup & restore' }
  ];

  // permissions[roleId][featureKey] = [read, create, update]
  const permissions = {};
  features.forEach(f => {
    // Super Admin holds everything, and is the only role with txn.delete.
    permissions.R0 = permissions.R0 || {}; permissions.R0[f.key] = [true, true, true];
    // The restricted login reads the ticket ledger and nothing else.
    permissions.RV = permissions.RV || {};
    permissions.RV[f.key] = ['txn.manage', 'rep.transaction'].includes(f.key) ? [true, false, false] : [false, false, false];
    // Everyone below Super Admin is denied delete outright.
    permissions.R1 = permissions.R1 || {}; permissions.R1[f.key] = f.key === 'txn.delete' ? [false, false, false] : [true, true, true];
    permissions.R4 = permissions.R4 || {}; permissions.R4[f.key] = f.key === 'txn.delete' ? [false, false, false] : [true, false, false];
    const sup = f.key.startsWith('adm.') ? [f.key === 'adm.user', false, false]
      : (f.key === 'txn.manualstar' || f.key === 'txn.delete') ? [f.key === 'txn.manualstar', false, false] : [true, true, true];
    permissions.R2 = permissions.R2 || {}; permissions.R2[f.key] = sup;
    let op = [false, false, false];
    if (['txn.manage', 'txn.weigh', 'txn.print'].includes(f.key)) op = [true, true, true];
    else if (f.key === 'txn.manual') op = [true, true, false];
    else if (f.key.startsWith('md.') || f.key.startsWith('dev.')) op = [true, false, false];
    else if (f.key === 'rep.transaction') op = [true, false, false];
    permissions.R3 = permissions.R3 || {}; permissions.R3[f.key] = op;
  });

  /* ---------- configurable fields (20 slots) ---------- */
  const customFields = [
    { slot: 1,  key: 'cf1', label: 'Vehicle Type',   visible: true,  required: true,  maxLen: 40, source: 'list' },
    { slot: 2,  key: 'cf2', label: 'Party Name',     visible: true,  required: true,  maxLen: 60, source: 'list' },
    { slot: 3,  key: 'cf3', label: 'Buyer Name',     visible: true,  required: true,  maxLen: 60, source: 'list' },
    { slot: 4,  key: 'cf4', label: 'Package No',     visible: true,  required: true,  maxLen: 20, source: 'list' },
    { slot: 5,  key: 'cf5', label: 'Weighbridge No', visible: true,  required: true,  maxLen: 10, source: 'list' },
    { slot: 6,  key: 'cf6', label: 'Challan No',     visible: false, required: false, maxLen: 20, source: 'text' },
    { slot: 7,  key: 'cf7', label: 'Remarks',        visible: false, required: false, maxLen: 120,source: 'text' }
  ];
  for (let i = 8; i <= 20; i++) customFields.push({ slot: i, key: 'cf' + i, label: 'Field ' + i, visible: false, required: false, maxLen: 50, source: 'text' });

  // Controlled value lists — our improvement over the legacy free-text fields
  const fieldLists = {
    cf1: [VT.t10, VT.t12, VT.t22, VT.l22, VT.tr40, VT.h6],
    cf2: ['CHENNAI BIOMINNING LTD', 'GREATER CHENNAI CORPORATION', 'ZIGMA GLOBAL ENVIRO'],
    cf3: ['GCC', 'AQUA WORLD EXPORT', 'RAMKY ENVIRO', 'INTERNAL'],
    cf4: ['PACKAGE 5', 'PACKAGE 2'],
    cf5: ['1', '2', '3']
  };

  // Values as they were actually typed in history — deliberately fragmented,
  // so the Data Quality module has something real to find.
  const dirty = {
    cf1: [VT.t10, 'Tipper 10 wheel', 'TIPPER 10 WHEEL ', 'Tipper10 wheel', 'tipper 10 Wheel',
      VT.t12, 'Tipper 12 Wheel', VT.t22, 'TIPPER 22 WHEEL', 'Tipper 22 wheel',
      VT.l22, 'LORRY 22 wheel', VT.tr40, 'Trailer 40ft', VT.h6, 'Hyva 6 wheel'],
    cf2: ['CHENNAI BIOMINNING LTD', 'Chennai Biominning Ltd', 'CHENNAI BIO MINING LTD', 'GREATER CHENNAI CORPORATION', 'ZIGMA GLOBAL ENVIRO'],
    cf3: ['GCC', 'G.C.C', 'Gcc', 'AQUA WORLD EXPORT', 'RAMKY ENVIRO'],
    cf4: ['PACKAGE 5', 'Package-5', 'PKG 5', 'PACKAGE 2'],
    cf5: ['1', '2', 'WB-2', '02']
  };

  /* ---------- barcode / QR template ---------- */
  const barcodeSlots = [
    { key: 'ticketNo',   label: 'Ticket No',      code: 'TN', on: true },
    { key: 'vehicleNo',  label: 'Vehicle No',     code: 'VN', on: true },
    { key: 'accountName',label: 'Account Name',   code: 'AN', on: true },
    { key: 'grossWt',    label: 'Gross Weight',   code: 'GW', on: true },
    { key: 'grossTime',  label: 'Gross Time',     code: 'GT', on: true },
    { key: 'tareWt',     label: 'Tare Weight',    code: 'TW', on: true },
    { key: 'tareTime',   label: 'Tare Time',      code: 'TT', on: true },
    { key: 'netWt',      label: 'Net Weight',     code: 'NW', on: true },
    { key: 'product',    label: 'Product',        code: 'PN', on: true },
    { key: 'charges',    label: 'Charges',        code: 'CG', on: false },
    { key: 'cf1',        label: 'Vehicle Type',   code: 'F1', on: true },
    { key: 'cf2',        label: 'Party Name',     code: 'F2', on: false },
    { key: 'cf3',        label: 'Buyer Name',     code: 'F3', on: true },
    { key: 'cf4',        label: 'Package No',     code: 'F4', on: true },
    { key: 'cf5',        label: 'Weighbridge No', code: 'F5', on: false },
    { key: 'cf6',        label: 'Challan No',     code: 'F6', on: false },
    { key: 'siteCode',   label: 'Site Code',      code: 'SC', on: true },
    { key: 'operator',   label: 'Operator',       code: 'OP', on: false },
    { key: 'signature',  label: 'Digital Signature', code: 'SG', on: true },
    { key: 'verifyUrl',  label: 'Verify URL',     code: 'VU', on: true }
  ];

  /* ---------- global settings ---------- */
  const settings = {
    enableTxnDateTime: true,
    lockFieldsAfterPass1: true,
    tareToleranceOn: true,
    tareTolerancePct: 2.5,
    dateFormat: 'dd-MM-yyyy',
    timeFormat: 'HH:mm',
    decimals: 3,
    printAfterPass1: true,
    connectedScale: 'WB2',
    blockSpecialCharsVehicle: true,
    showLastTxnOnRecall: true,
    autoCaptureImages: true,
    requireDriver: false,
    stabilityWindowMs: 1200,
    stabilityToleranceKg: 20,
    weightUnit: 'KG',
    reportUnit: 'MT',
    autoBackup: true,
    backupEvery: 'Every 6 hours',
    backupTarget: '\\\\nas01\\weighcore\\backups',
    lastBackup: '04-08-2026 12:00',
    retentionDays: 365,
    offlineQueue: true
  };

  const notifications = [
    { id: 'N1', channel: 'EMAIL', name: 'Daily tonnage summary',      event: 'Scheduled — 20:00 daily',      to: 'ops@chennaibiomining.in; se.swm@chennaicorporation.gov.in', on: true },
    { id: 'N2', channel: 'EMAIL', name: 'Ticket voided',              event: 'On void',                      to: 'fathima@chennaibiomining.in', on: true },
    { id: 'N3', channel: 'EMAIL', name: 'Scale offline > 5 min',      event: 'On device alarm',              to: 'it@chennaibiomining.in', on: true },
    { id: 'N4', channel: 'SMS',   name: 'Tare deviation alert',       event: 'On tolerance breach',          to: '+91 98400 00002', on: true },
    { id: 'N5', channel: 'SMS',   name: 'Transporter net weight',     event: 'On ticket complete',           to: 'Transporter contact on file', on: false },
    { id: 'N6', channel: 'EMAIL', name: 'Weekly data-quality digest', event: 'Scheduled — Monday 07:00',     to: 'admin@chennaibiomining.in', on: true }
  ];

  /* ---------- transaction history ---------- */
  const IMGS = ['assets/img/capture-1.jpg', 'assets/img/capture-2.jpg', 'assets/img/capture-3.jpg', 'assets/img/capture-4.jpg'];
  const LIVE = [1, 2, 3, 4, 5, 6].map(n => 'assets/img/cam-live-' + n + '.jpg');

  // Processing tickets never carry RDF — that material only moves on an RDF ticket.
  const productWeights = [['P1', 48], ['P3', 12], ['P5', 11], ['P4', 9], ['P6', 6], ['P9', 5], ['P8', 4], ['P7', 3], ['P10', 2]];
  const DAYS = 14;
  const transactions = [];
  let ticket = 11780;

  for (let d = DAYS - 1; d >= 0; d--) {
    const perDay = d === 0 ? 26 : int(14, 24);
    for (let k = 0; k < perDay; k++) {
      const veh = pickW(vehicles.filter(v => v.id !== 'V26').map(v => [v, v.tare ? 10 : 2]));
      const wb = pickW([[weighbridges[0], 45], [weighbridges[1], 55]]);
      const site = sites.find(s => s.id === wb.siteId);
      const type = pickW([['Processing', 62], ['Disposal', 26], ['RDF', 12]]);
      const mode = pickW([['Double', 84], ['Single', 11], ['Multi', 5]]);
      const prodId = type === 'RDF' ? 'P2' : type === 'Disposal' ? pickW([['P3', 5], ['P5', 3], ['P6', 2]]) : pickW(productWeights);
      const product = products.find(p => p.id === prodId);

      const hour = pickW([[6, 4], [7, 8], [8, 11], [9, 12], [10, 12], [11, 10], [12, 7], [13, 8], [14, 11], [15, 10], [16, 9], [17, 7], [18, 5], [19, 3]]);
      const start = new Date(NOW); start.setDate(start.getDate() - d);
      start.setHours(hour, int(0, 59), int(0, 59), 0);
      if (start > NOW) start.setTime(NOW.getTime() - int(4, 90) * 60000);

      const storedTare = veh.tare || int(9800, 15200);
      const tare = Math.round((storedTare + int(-140, 190)) / 10) * 10;
      const payload = Math.round((veh.cap - storedTare) * (0.62 + rnd() * 0.34) / 10) * 10;
      const gross = tare + payload;

      const nPass = mode === 'Multi' ? 3 : mode === 'Single' ? 1 : 2;
      const grossFirst = rnd() < 0.55;
      const manual = rnd() < 0.07;
      const operator = wb.id === 'WB1' ? users[2] : users[3];

      // status: newest few stay mid-cycle
      let status = 'Complete';
      if (d === 0 && k >= perDay - 7 && mode !== 'Single') status = 'Active';
      else if (rnd() < 0.018) status = 'Void';

      const passes = [];
      const mk = (kind, w, offsetMin) => {
        const at = new Date(start.getTime() + offsetMin * 60000);
        return {
          seq: passes.length + 1, kind, weight: w, at,
          scale: wb.name, mode: manual && passes.length === 0 ? 'Manual' : 'Auto',
          images: [IMGS[(passes.length * 2) % 4], IMGS[(passes.length * 2 + 1) % 4]]
        };
      };
      if (mode === 'Single') {
        passes.push(mk('Gross', gross, 0));
      } else if (nPass === 2) {
        if (grossFirst) { passes.push(mk('Gross', gross, 0)); if (status !== 'Active') passes.push(mk('Tare', tare, int(9, 46))); }
        else { passes.push(mk('Tare', tare, 0)); if (status !== 'Active') passes.push(mk('Gross', gross, int(9, 46))); }
      } else {
        passes.push(mk('Tare', tare, 0));
        passes.push(mk('Gross', Math.round((tare + payload * 0.55) / 10) * 10, int(8, 20)));
        if (status !== 'Active') passes.push(mk('Gross', gross, int(24, 58)));
      }

      const tp = passes.filter(p => p.kind === 'Tare').pop();
      const gp = passes.filter(p => p.kind === 'Gross').pop();
      const tareW = tp ? tp.weight : (mode === 'Single' ? storedTare : null);
      const grossW = gp ? gp.weight : null;
      const net = (tareW != null && grossW != null) ? grossW - tareW : null;

      const cf = {
        cf1: veh.type ? pick(dirty.cf1.filter(x => x.toUpperCase().replace(/\s+/g, '') === veh.type.toUpperCase().replace(/\s+/g, '')).concat([veh.type])) : pick(dirty.cf1),
        cf2: pick(dirty.cf2), cf3: pick(dirty.cf3), cf4: pick(dirty.cf4),
        cf5: wb.id === 'WB1' ? pick(['1', '1', '01']) : pick(['2', '2', 'WB-2', '02']),
        cf6: 'CH' + (48200 + transactions.length)
      };

      transactions.push({
        id: 'T' + (++ticket), ticketNo: ticket, status, mode, type,
        direction: type === 'Processing' ? null : pick(['Plant to Yard', 'Yard to Customer']),
        at: start, siteId: site.id, wbId: wb.id,
        vehicleId: veh.id, transporterId: veh.accountId,
        accountId: type === 'RDF' ? 'A13' : 'A11',
        driverId: pick(drivers.filter(dr => dr.active)).id,
        productId: product.id, gateId: wb.id === 'WB1' ? pick(['G1', 'G3']) : pick(['G2', 'G4']),
        charges: product.rate ? Math.round(product.rate * ((net || 0) / 1000) / 10) * 10 : 0,
        tare: tareW, tareAt: tp ? tp.at : null,
        gross: grossW, grossAt: gp ? gp.at : null,
        net, passes, cf, manual,
        operatorId: operator.id,
        voidReason: status === 'Void' ? pick(['Duplicate ticket raised in error', 'Vehicle left before second weighing', 'Wrong product selected at pass 1', 'Indicator fault — reading rejected']) : null
      });
    }
  }
  transactions.sort((a, b) => b.at - a.at);

  /* ---------- audit trail ---------- */
  const audit = [];
  let aid = 0;
  transactions.slice(0, 90).forEach(t => {
    const op = users.find(u => u.id === t.operatorId);
    audit.push({ id: 'AU' + (++aid), table: 'Transaction', op: 'INSERT', at: t.passes[0].at, user: op.username, text: 'Ticket ' + t.ticketNo + ' opened — ' + t.mode + ' / ' + t.type, ref: t.id });
    t.passes.forEach(p => audit.push({
      id: 'AU' + (++aid), table: 'Transaction Passes', op: 'INSERT', at: p.at, user: op.username,
      text: 'Pass ' + p.seq + ' — ' + p.kind + ' ' + p.weight.toLocaleString('en-IN') + ' kg (' + p.mode + ')', ref: t.id
    }));
    if (t.status === 'Complete') audit.push({ id: 'AU' + (++aid), table: 'Transaction', op: 'UPDATE', at: t.passes[t.passes.length - 1].at, user: op.username, text: 'Ticket ' + t.ticketNo + ' completed — net ' + (t.net || 0).toLocaleString('en-IN') + ' kg', ref: t.id });
    if (t.status === 'Void') audit.push({ id: 'AU' + (++aid), table: 'Transaction', op: 'UPDATE', at: new Date(t.at.getTime() + 3.6e6), user: 'm.fathima', text: 'Ticket ' + t.ticketNo + ' voided — ' + t.voidReason, ref: t.id });
  });
  [
    ['Vehicle', 'UPDATE', 'admin', 'Vehicle TN45CB6689 tare weight changed 11,540 → 11,660 kg', 5],
    ['Account', 'INSERT', 'admin', 'Account "Sree Balaji Carriers" created', 26],
    ['Camera', 'UPDATE', 'admin', 'Camera "Lane 2 — Rear" stream URL updated', 31],
    ['Global Settings', 'UPDATE', 'admin', 'Tare tolerance changed 1.0% → 2.5%', 49],
    ['User', 'UPDATE', 'admin', 'User "endelsupport" deactivated', 54],
    ['Product', 'INSERT', 'm.fathima', 'Product "Trommel Fines" created', 73],
    ['WeighBridge', 'UPDATE', 'admin', 'Scale 3 (axle) marked offline for calibration', 96],
    ['Role', 'UPDATE', 'admin', 'Role "Weighbridge Operator" — manual entry permission granted', 120],
    ['Vehicle', 'UPDATE', 'm.fathima', 'Vehicle TN47AF2917 flagged: tare weight missing', 140],
    ['Global Settings', 'UPDATE', 'admin', 'Auto-backup enabled — every 6 hours to \\\\nas01', 168]
  ].forEach(([tbl, op, user, text, hrs]) => {
    audit.push({ id: 'AU' + (++aid), table: tbl, op, at: new Date(NOW.getTime() - hrs * 3.6e6), user, text, ref: null });
  });
  audit.sort((a, b) => b.at - a.at);

  /* ==========================================================================
     CARRY-FORWARD OPENING BALANCE
     The site did not start work when this software was installed. These are the
     REAL figures already moved under Package 5, taken from the deduped WeighMAST
     export in ../weighmast-pkg5/05-transaction-data/all-transactions-deduped.csv.
     Every cumulative number on the dashboard continues from here rather than
     restarting at zero.
     ========================================================================== */
  const opening = {
    label: 'Brought forward — Package 5 to date',
    source: 'WeighMAST export, deduped · weighmast-pkg5/05-transaction-data',
    from: '25-03-2025', to: '04-08-2026',
    tickets: 76938,
    netKg: 914006370,                 // 914,006.37 MT
    byType: {
      Processing: { tickets: 50872, netKg: 598745760 },
      Disposal:   { tickets: 18627, netKg: 238809610 },
      RDF:        { tickets: 7439,  netKg: 76451000 }
    },
    // Client-declared opening stockpile sitting in the RDF yard on 04-08-2026.
    // The legacy export does not separate internal from external movements, so
    // this is an opening figure the client states — it is editable in Settings.
    rdfYardStockKg: 8450000           // 8,450 MT
  };

  /* Contract progress. targetKg is a placeholder until the client confirms the
     tendered quantity — editable under Settings → Company. */
  const contract = {
    name: 'Reclamation of Kodungaiyur Dumpsite — Package 5',
    targetKg: 1200000000,             // 12,00,000 MT
    startedOn: '25-03-2025'
  };

  /* Tickets deleted by a Super Admin are moved off DB.transactions into here, so
     every existing screen, total and report excludes them automatically. The row
     is retained, and the audit entry recording the deletion is permanent. */
  const deleted = [];

  /* ---------- lookups ---------- */
  const byId = (arr) => arr.reduce((m, x) => (m[x.id] = x, m), {});

  window.DB = {
    NOW, company, sites, units, weighbridges, cameras, gates, products, accounts,
    vehicles, drivers, users, roles, features, permissions,
    customFields, fieldLists, dirty, barcodeSlots, settings, notifications,
    transactions, audit, LIVE, IMGS, opening, contract, deleted,
    map: {
      site: byId(sites), wb: byId(weighbridges), cam: byId(cameras), gate: byId(gates),
      product: byId(products), account: byId(accounts), vehicle: byId(vehicles),
      driver: byId(drivers), user: byId(users), role: byId(roles), unit: byId(units)
    }
  };

  /* ==========================================================================
     MATERIAL BALANCE — internal transfer vs. what actually leaves the site

     A stream like RDF crosses the weighbridge TWICE: once moving from the plant
     into our own yard (Plant → Yard), and again when a buyer collects it
     (Yard → Customer). Adding up every RDF ticket therefore double-counts the
     same tonnes. Only Yard → Customer has actually left the site.

         closing yard stock = opening + moved in − dispatched out
     ========================================================================== */
  const INTERNAL = 'Plant to Yard';       // into our own stockpile — has NOT left site
  const EXTERNAL = 'Yard to Customer';    // dispatched to a buyer — HAS left site

  window.DB.INTERNAL = INTERNAL;
  window.DB.EXTERNAL = EXTERNAL;

  window.DB.balance = function (type, rows) {
    const src = (rows || window.DB.transactions)
      .filter(t => t.type === type && t.status === 'Complete' && t.net);
    const into = src.filter(t => t.direction === INTERNAL);
    const out = src.filter(t => t.direction === EXTERNAL);
    const sum = (a) => a.reduce((n, t) => n + (t.net || 0), 0);
    const openingKg = type === 'RDF' ? window.DB.opening.rdfYardStockKg : 0;
    const inKg = sum(into), outKg = sum(out);
    return {
      type, openingKg, inKg, outKg,
      closingKg: openingKg + inKg - outKg,
      inTickets: into.length, outTickets: out.length,
      grossKg: inKg + outKg          // the naive (double-counted) figure
    };
  };

  /* Net weight that genuinely left the site: everything except internal transfers. */
  window.DB.externalNet = function (rows) {
    return (rows || window.DB.transactions)
      .filter(t => t.status === 'Complete' && t.net && t.direction !== INTERNAL)
      .reduce((n, t) => n + t.net, 0);
  };
  window.DB.internalNet = function (rows) {
    return (rows || window.DB.transactions)
      .filter(t => t.status === 'Complete' && t.net && t.direction === INTERNAL)
      .reduce((n, t) => n + t.net, 0);
  };
})();
