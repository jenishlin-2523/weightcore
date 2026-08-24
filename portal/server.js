'use strict';
const express = require('express');
const session = require('express-session');
const path = require('path');
const { authenticate, requireLogin } = require('./auth');
const data = require('./data');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'weighcore-portal-secret-change-me',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});
app.post('/login', async (req, res) => {
  try {
    const r = await authenticate(req.body.username, req.body.password);
    if (!r.ok) return res.status(401).render('login', { error: r.error });
    req.session.user = r.user;
    res.redirect('/');
  } catch (e) {
    res.status(500).render('login', { error: 'Server error: ' + e.message });
  }
});
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

app.get('/', requireLogin, async (req, res) => {
  try {
    const [kpis, bySite, recent] = await Promise.all([data.kpis(), data.bySite(), data.recent(30)]);
    res.render('dashboard', { user: req.session.user, kpis, bySite, recent, page: 'dashboard' });
  } catch (e) {
    res.status(500).render('error', { user: req.session.user, message: e.message, page: 'dashboard' });
  }
});

app.get('/transactions', requireLogin, async (req, res) => {
  try {
    const q = req.query;
    const result = await data.transactions({
      site: q.site, status: q.status, type: q.type, q: q.q, from: q.from, to: q.to, page: q.page
    });
    res.render('transactions', { user: req.session.user, page: 'transactions', f: q, ...result });
  } catch (e) {
    res.status(500).render('error', { user: req.session.user, message: e.message, page: 'transactions' });
  }
});

// live search — returns filtered rows as JSON (no page reload)
app.get('/api/transactions', requireLogin, async (req, res) => {
  try {
    const q = req.query;
    const result = await data.transactions({ site: q.site, status: q.status, type: q.type, q: q.q, from: q.from, to: q.to, page: q.page });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/slip/:site/:ticket', requireLogin, async (req, res) => {
  try {
    const s = await data.slip(req.params.site, req.params.ticket);
    if (!s) return res.status(404).render('error', { user: req.session.user, message: 'Weighment not found.', page: 'transactions' });
    const images = await data.slipImages(req.params.site, req.params.ticket);
    res.render('slip', { user: req.session.user, page: 'transactions', images, ...s });
  } catch (e) {
    res.status(500).render('error', { user: req.session.user, message: e.message, page: 'transactions' });
  }
});

// serve one capture photo as JPEG
app.get('/image/:id', requireLogin, async (req, res) => {
  try {
    const b = await data.imageBytes(req.params.id);
    if (!b) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=3600');
    res.end(b);
  } catch (e) { res.status(500).end(); }
});

app.get('/masters', requireLogin, async (req, res) => {
  try {
    const m = await data.master(req.query.tab);
    res.render('masters', { user: req.session.user, page: 'masters', ...m });
  } catch (e) {
    res.status(500).render('error', { user: req.session.user, message: e.message, page: 'masters' });
  }
});

app.get('/reports', requireLogin, async (req, res) => {
  try {
    const r = await data.dailyReport({ from: req.query.from, to: req.query.to, site: req.query.site });
    res.render('reports', { user: req.session.user, page: 'reports', ...r });
  } catch (e) {
    res.status(500).render('error', { user: req.session.user, message: e.message, page: 'reports' });
  }
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, '0.0.0.0', () => console.log('WeighCore Admin Portal on :' + PORT));
