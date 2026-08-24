'use strict';
// Read-only queries over the central svt_weighbridge, shaped like Weighmast.
// Weights are stored in Kg; the portal shows Tons (Kg/1000), like Weighmast.
const { query } = require('./db');

// per-transaction gross/tare/net rolled up from its detail rows
const TXN_BASE =
  `SELECT td.ScaleID, td.TicketID, td.VehicleNumber, td.Status, td.TransactionType, td.TransactionMode,
          td.CreationTime, td.DriverName, td.TransporterName, td.ReceiptTicketID,
          d.gross, d.tare, d.net, d.product, d.gate, d.grossTime, d.tareTime
   FROM TransactionData td
   OUTER APPLY (
     SELECT MAX(x.GrossWeight) AS gross, MAX(x.TareWeight) AS tare, MAX(x.NetWeight) AS net,
            MAX(x.ProductName) AS product, MAX(x.GateName) AS gate,
            MAX(x.GrossTime) AS grossTime, MAX(x.TareTime) AS tareTime
     FROM TransactionDetail x
     WHERE x.ScaleID = td.ScaleID AND x.ReceiptTicketID = td.ReceiptTicketID
   ) d`;

function toTon(r) {
  return {
    site: r.ScaleID, ticket: r.TicketID, vehicle: r.VehicleNumber,
    status: r.Status, type: r.TransactionType, mode: r.TransactionMode, at: r.CreationTime,
    driver: r.DriverName, transporter: r.TransporterName, product: r.product, gate: r.gate,
    grossT: r.gross != null ? r.gross / 1000 : null,
    tareT: r.tare != null ? r.tare / 1000 : null,
    netT: r.net != null ? r.net / 1000 : null,
    grossTime: r.grossTime, tareTime: r.tareTime
  };
}

async function kpis() {
  const r = await query(
    `SELECT
       (SELECT COUNT(*) FROM TransactionData) AS total,
       (SELECT COUNT(*) FROM TransactionData WHERE Status='Active') AS active,
       (SELECT COUNT(*) FROM TransactionData WHERE Status='Complete') AS complete,
       (SELECT COUNT(*) FROM TransactionData WHERE CAST(CreationTime AS date)=CAST(GETDATE() AS date)) AS today,
       (SELECT COUNT(DISTINCT ScaleID) FROM TransactionData) AS sites,
       (SELECT COUNT(*) FROM Vehicle) AS vehicles`);
  const net = await query(
    `SELECT ISNULL(SUM(d.net),0) AS netKg FROM TransactionData td
     OUTER APPLY (SELECT MAX(x.NetWeight) AS net FROM TransactionDetail x
                  WHERE x.ScaleID=td.ScaleID AND x.ReceiptTicketID=td.ReceiptTicketID) d
     WHERE td.Status='Complete'`);
  const k = r[0] || {};
  k.netTons = ((net[0] && net[0].netKg) || 0) / 1000;
  return k;
}

async function bySite() {
  const rows = await query(
    `SELECT td.ScaleID AS site, COUNT(*) AS tickets,
            SUM(CASE WHEN td.Status='Complete' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN td.Status='Active' THEN 1 ELSE 0 END) AS active,
            ISNULL(SUM(d.net),0)/1000.0 AS netTons
     FROM TransactionData td
     OUTER APPLY (SELECT MAX(x.NetWeight) AS net FROM TransactionDetail x
                  WHERE x.ScaleID=td.ScaleID AND x.ReceiptTicketID=td.ReceiptTicketID) d
     GROUP BY td.ScaleID`);
  // Always show every configured weighbridge, even ones with no weighments yet
  // (e.g. WB1 before its PC goes live), plus any extra sites that do have data.
  const configured = (process.env.SITES || 'P5WB1,P5WB2').split(',').map((s) => s.trim()).filter(Boolean);
  const byId = {}; rows.forEach((r) => { byId[r.site] = r; });
  const order = configured.concat(rows.map((r) => r.site).filter((s) => configured.indexOf(s) < 0));
  return order.map((s) => byId[s] || { site: s, tickets: 0, complete: 0, active: 0, netTons: 0 });
}

async function recent(limit) {
  const rows = await query(TXN_BASE + ` ORDER BY td.CreationTime DESC OFFSET 0 ROWS FETCH NEXT @lim ROWS ONLY`,
    { lim: Number(limit) || 30 });
  return rows.map(toTon);
}

// Accept a plain date ("2026-08-24") or a datetime-local value ("2026-08-24T09:30")
// and turn it into a SQL datetime; date-only uses the supplied default time.
function rangeStamp(v, defTime) {
  v = String(v || '').trim();
  if (!v) return v;
  if (v.indexOf('T') >= 0) { const s = v.replace('T', ' '); return s.length === 16 ? s + ':00' : s; }
  return v + ' ' + defTime;
}

// ---- transactions (filtered, paged) ----
async function transactions(opts) {
  opts = opts || {};
  const where = [], p = {};
  if (opts.site && opts.site !== 'all') { where.push('td.ScaleID=@site'); p.site = opts.site; }
  if (opts.status && opts.status !== 'all') { where.push('td.Status=@status'); p.status = opts.status; }
  if (opts.type && opts.type !== 'all') { where.push('td.TransactionType=@type'); p.type = opts.type; }
  if (opts.q) { where.push('(td.VehicleNumber LIKE @q OR CAST(td.TicketID AS varchar) LIKE @q OR td.DriverName LIKE @q)'); p.q = '%' + opts.q + '%'; }
  if (opts.from) { where.push('td.CreationTime >= @from'); p.from = rangeStamp(opts.from, '00:00:00'); }
  if (opts.to) { where.push('td.CreationTime <= @to'); p.to = rangeStamp(opts.to, '23:59:59'); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pageSize = Math.min(200, Math.max(10, Number(opts.pageSize) || 50));
  const page = Math.max(1, Number(opts.page) || 1);
  const cnt = await query('SELECT COUNT(*) AS n FROM TransactionData td ' + w, p);
  const total = (cnt[0] && cnt[0].n) || 0;
  p.off = (page - 1) * pageSize; p.lim = pageSize;
  const rows = await query(TXN_BASE + ' ' + w + ' ORDER BY td.CreationTime DESC OFFSET @off ROWS FETCH NEXT @lim ROWS ONLY', p);
  return { rows: rows.map(toTon), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ---- weighment slip ----
async function slip(site, ticket) {
  const h = await query(TXN_BASE + ' WHERE td.ScaleID=@site AND td.TicketID=@ticket', { site, ticket: Number(ticket) });
  if (!h.length) return null;
  const passes = await query(
    `SELECT SequenceNo, WeighmentType, CaptureWeight, GrossWeight, TareWeight, NetWeight,
            GrossTime, TareTime, CaptureTime, ProductName, GateName, WeighbridgeName, UserName,
            CAST(IsCapturedManual AS int) AS manual
     FROM TransactionDetail
     WHERE ScaleID=@site AND ReceiptTicketID=@rid ORDER BY SequenceNo`,
    { site, rid: h[0].ReceiptTicketID });
  return { header: toTon(h[0]), passes };
}

// ---- master data (read-only) ----
const MASTERS = {
  vehicles:     { label: 'Vehicles',     sql: 'SELECT VehicleNumber AS [Vehicle No], VehicleType AS [Type], TareWeight AS [Tare (Kg)], CASE WHEN IsActive=1 THEN \'Active\' ELSE \'Inactive\' END AS [Status] FROM Vehicle ORDER BY VehicleNumber' },
  products:     { label: 'Products',     sql: 'SELECT ProductName AS [Product], ProductCode AS [Code], CASE WHEN IsActive=1 THEN \'Active\' ELSE \'Inactive\' END AS [Status] FROM Product ORDER BY ProductName' },
  accounts:     { label: 'Accounts',     sql: 'SELECT CompanyName AS [Company], City AS [City], ContactNo AS [Contact], CASE WHEN IsTransporter=1 THEN \'Yes\' ELSE \'\' END AS [Transporter], CASE WHEN Active=1 THEN \'Active\' ELSE \'Inactive\' END AS [Status] FROM Account ORDER BY CompanyName' },
  drivers:      { label: 'Drivers',      sql: 'SELECT LTRIM(RTRIM(ISNULL(FirstName,\'\')+\' \'+ISNULL(LastName,\'\'))) AS [Driver], IDProofNo AS [ID Proof], CASE WHEN Active=1 THEN \'Active\' ELSE \'Inactive\' END AS [Status] FROM Driver ORDER BY FirstName' },
  gates:        { label: 'Gates',        sql: 'SELECT GateName AS [Gate], GateType AS [Type], CASE WHEN IsActive=1 THEN \'Active\' ELSE \'Inactive\' END AS [Status] FROM Gate ORDER BY GateName' },
  users:        { label: 'Users',        sql: 'SELECT UserName AS [Username], LTRIM(RTRIM(ISNULL(FirstName,\'\')+\' \'+ISNULL(LastName,\'\'))) AS [Name], TemplateID AS [Role], CASE WHEN Active=1 THEN \'Active\' ELSE \'Inactive\' END AS [Status] FROM UserMaster ORDER BY UserName' },
  units:        { label: 'Units',        sql: 'SELECT UnitName AS [Unit] FROM Unit ORDER BY UnitName' },
  weighbridges: { label: 'Weighbridges', sql: 'SELECT ScaleName AS [Scale], COMPort AS [COM], BaudRate AS [Baud], MaxCapacity AS [Max (Kg)], CASE WHEN IsActive=1 THEN \'Active\' ELSE \'Inactive\' END AS [Status] FROM WeightBridge ORDER BY ScaleName' }
};
async function master(tab) {
  const def = MASTERS[tab] || MASTERS.vehicles;
  const rows = await query(def.sql);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return { tab: MASTERS[tab] ? tab : 'vehicles', label: def.label, cols, rows, tabs: Object.keys(MASTERS).map((k) => ({ key: k, label: MASTERS[k].label })) };
}

// ---- daily report ----
async function dailyReport(opts) {
  opts = opts || {};
  const p = {};
  p.from = (opts.from || isoDaysAgo(30)) + ' 00:00:00';
  p.to = (opts.to || isoToday()) + ' 23:59:59';
  const where = ['td.CreationTime BETWEEN @from AND @to'];
  if (opts.site && opts.site !== 'all') { where.push('td.ScaleID=@site'); p.site = opts.site; }
  const rows = await query(
    `SELECT CONVERT(varchar(10), td.CreationTime, 23) AS day, td.ScaleID AS site,
            COUNT(*) AS tickets,
            SUM(CASE WHEN td.Status='Complete' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN td.Status='Active' THEN 1 ELSE 0 END) AS active,
            ISNULL(SUM(d.net),0)/1000.0 AS netTons
     FROM TransactionData td
     OUTER APPLY (SELECT MAX(x.NetWeight) AS net FROM TransactionDetail x
                  WHERE x.ScaleID=td.ScaleID AND x.ReceiptTicketID=td.ReceiptTicketID) d
     WHERE ${where.join(' AND ')}
     GROUP BY CONVERT(varchar(10), td.CreationTime, 23), td.ScaleID
     ORDER BY day DESC, site`, p);
  return { rows, from: (opts.from || isoDaysAgo(30)), to: (opts.to || isoToday()), site: opts.site || 'all' };
}

function isoToday() { const d = new Date(); return d.toISOString().slice(0, 10); }
function isoDaysAgo(n) { const d = new Date(Date.now() - n * 86400000); return d.toISOString().slice(0, 10); }

// capture photos for a ticket (metadata only; bytes fetched per-image)
async function slipImages(site, ticket) {
  const h = await query('SELECT TOP 1 ReceiptTicketID AS rid FROM TransactionData WHERE ScaleID=@s AND TicketID=@t', { s: site, t: Number(ticket) });
  if (!h.length || !h[0].rid) return [];
  return await query(
    `SELECT CONVERT(varchar(40),ImageID) AS id, CameraID, Seq, Kind
     FROM TransactionImage WHERE ScaleID=@s AND ReceiptTicketID=@r ORDER BY Seq, CameraID`,
    { s: site, r: h[0].rid });
}
async function imageBytes(id) {
  const r = await query('SELECT ImageData FROM TransactionImage WHERE ImageID=@id', { id });
  return (r.length && r[0].ImageData) ? r[0].ImageData : null;   // Buffer (JPEG)
}

module.exports = { kpis, bySite, recent, transactions, slip, slipImages, imageBytes, master, dailyReport, toTon };
