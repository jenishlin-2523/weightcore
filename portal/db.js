'use strict';
// Central SQL access for the portal (read-only). Pure-JS mssql driver.
const sql = require('mssql');

const config = {
  server: process.env.SQL_SERVER || 'weighcore-sql',
  port: Number(process.env.SQL_PORT || 1433),
  database: process.env.SQL_DB || 'svt_weighbridge',
  user: process.env.SQL_USER || 'weighcore',
  password: process.env.SQL_PASSWORD || '',
  options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  pool: { max: 8, min: 0, idleTimeoutMillis: 30000 },
  connectionTimeout: 20000,
  requestTimeout: 60000
};

let poolPromise = null;
function pool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config).catch((e) => { poolPromise = null; throw e; });
  }
  return poolPromise;
}

// Parameterized query. params = { name: value }.
async function query(text, params) {
  const p = await pool();
  const req = p.request();
  if (params) for (const k of Object.keys(params)) req.input(k, params[k]);
  const r = await req.query(text);
  return r.recordset;
}

module.exports = { sql, query, pool };
