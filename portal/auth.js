'use strict';
// Portal login — verify against the central UserMaster using the legacy salt
// scheme (same as the desktop app: HMAC-SHA256('jm3UIgFC7CCQwqtr', lower(user)+lower(pass))).
const crypto = require('crypto');
const { query } = require('./db');

function createSalt(username, password) {
  return crypto.createHmac('sha256', 'jm3UIgFC7CCQwqtr')
    .update(String(username).toLowerCase() + String(password).toLowerCase(), 'utf8')
    .digest('base64');
}

async function authenticate(username, password) {
  const rows = await query(
    'SELECT TOP 1 UserID, UserName, FirstName, LastName, TemplateID, Salt, CAST(Active AS int) AS Active ' +
    'FROM UserMaster WHERE LOWER(UserName)=LOWER(@u)', { u: String(username || '').toLowerCase() });
  const u = rows && rows[0];
  if (!u) return { ok: false, error: 'Unknown user' };
  if (!u.Active) return { ok: false, error: 'Account is inactive' };
  if (!u.Salt || u.Salt !== createSalt(u.UserName, password)) return { ok: false, error: 'Invalid username or password' };
  const role = u.TemplateID === 1 ? 'admin' : (u.TemplateID === 2 ? 'operator' : 'staff');
  const name = ((u.FirstName || '') + ' ' + (u.LastName || '')).trim() || u.UserName;
  return { ok: true, user: { id: u.UserID, username: u.UserName, name, role } };
}

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

module.exports = { authenticate, requireLogin, createSalt };
