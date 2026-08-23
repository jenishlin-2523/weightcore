/* ==========================================================================
   WeighCore — shell: navigation, routing, theme, command palette, shortcuts
   ========================================================================== */
(function () {
  'use strict';
  const U = window.UI, DB = window.DB, V = window.VIEWS;
  const { $, $$, esc, icon } = U;

  /* ---------- navigation model ---------- */
  const NAV = [
    {
      label: 'Operations', items: [
        { h: '#/dashboard', t: 'Dashboard', i: 'gauge', v: 'dashboard' },
        { h: '#/terminal', t: 'Weighment terminal', i: 'scale', v: 'terminal' },
        { h: '#/transactions/all', t: 'Transactions', i: 'list', v: 'transactions', badge: () => DB.transactions.filter(t => t.status === 'Active').length }
      ]
    },
    {
      label: 'Master data', items: [
        { h: '#/masters/vehicles', t: 'Vehicles', i: 'truck', v: 'master_vehicles' },
        { h: '#/masters/accounts', t: 'Accounts & parties', i: 'users', v: 'master_accounts' },
        { h: '#/masters/drivers', t: 'Drivers', i: 'user', v: 'master_drivers' },
        { h: '#/masters/products', t: 'Products', i: 'box', v: 'master_products' },
        { h: '#/masters/gates', t: 'Gates', i: 'gate', v: 'master_gates' },
        { h: '#/masters/locations', t: 'Sites & locations', i: 'pin', v: 'master_locations' },
        { h: '#/masters/units', t: 'Units', i: 'ruler', v: 'master_units' }
      ]
    },
    {
      label: 'Devices', items: [
        { h: '#/devices/weighbridges', t: 'Weighbridges', i: 'cpu', v: 'master_weighbridges' },
        { h: '#/devices/cameras', t: 'Cameras', i: 'camera', v: 'master_cameras' }
      ]
    },
    {
      label: 'Insight', items: [
        { h: '#/reports/transaction', t: 'Reports', i: 'chart', v: 'reports' },
        { h: '#/audit', t: 'Audit trail', i: 'shield', v: 'audit' },
        { h: '#/quality', t: 'Data quality', i: 'sparkle', v: 'quality', badge: () => V.quality.audit().issues }
      ]
    },
    {
      label: 'Administration', items: [
        { h: '#/admin/users', t: 'Users', i: 'user', v: 'admin_users' },
        { h: '#/admin/roles', t: 'Roles & permissions', i: 'key', v: 'admin_roles' },
        { h: '#/settings/general', t: 'Settings', i: 'cog', v: 'settings' }
      ]
    }
  ];

  const ROUTES = {
    '': 'dashboard', 'dashboard': 'dashboard', 'terminal': 'terminal', 'transactions': 'transactions',
    'reports': 'reports', 'audit': 'audit', 'quality': 'quality', 'settings': 'settings',
    'ticket': 'ticket',  // #/ticket/12034 — deep link, also what the slip QR resolves to
    'slip': 'slip'       // #/slip/12034  — straight to the printable slip (reprints)
  };

  function resolve(hash) {
    const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!parts.length) return { view: 'dashboard', params: [] };
    const head = parts[0];
    if (head === 'masters' || head === 'devices') return { view: 'master_' + parts[1], params: parts.slice(2) };
    if (head === 'admin') return { view: 'admin_' + parts[1], params: parts.slice(2) };
    return { view: ROUTES[head] || 'dashboard', params: parts.slice(1) };
  }

  function paintNav(activeView) {
    // Only render what this role may actually open. A group with nothing left
    // in it disappears rather than sitting there empty.
    $('#nav').innerHTML = NAV.map(g => {
      const items = g.items.filter(it => window.AUTH.allows(it.v));
      if (!items.length) return '';
      return '<div class="nav__group"><div class="nav__label">' + esc(g.label) + '</div>' +
      items.map(it => {
        const n = it.badge ? it.badge() : 0;
        return '<a class="nav__item' + (it.v === activeView ? ' is-active' : '') + '" href="' + it.h + '" title="' + esc(it.t) + '">' +
          icon(it.i, 'nav__ico') + '<span>' + esc(it.t) + '</span>' +
          (n ? '<span class="nav__badge">' + n + '</span>' : '') + '</a>';
      }).join('') + '</div>';
    }).join('');
  }

  /* ---------- router ---------- */
  let current = null;
  const ROUTER = window.ROUTER = {
    render() {
      let { view, params } = resolve(location.hash);

      // Route guard. Hiding a nav item is not access control — a restricted user
      // typing #/settings directly must be turned away here too.
      if (!window.AUTH.allows(view)) {
        U.toast('warn', 'Not available on this login',
          ((window.AUTH.role() || {}).name || 'This login') + ' does not have access to that screen.');
        view = 'dashboard'; params = [];
        if (location.hash !== '#/dashboard') { location.hash = '#/dashboard'; return; }
      }

      const def = V[view] || V.dashboard;
      if (current && current.unmount) { try { current.unmount(); } catch (e) { } }
      const root = $('#view');
      const deep = view === 'ticket' || view === 'slip';
      const target = deep ? V.transactions : def;
      root.innerHTML = target.render(deep ? ['all'] : params) || '';
      current = target;
      if (target.mount) target.mount(root);
      paintNav(deep ? 'transactions' : (V[view] ? view : 'dashboard'));
      if (deep) {
        const t = DB.transactions.find(x => String(x.ticketNo) === String(params[0]));
        if (!t) U.toast('warn', 'Ticket not found', 'No ticket numbered ' + esc(params[0] || '') + '.');
        else if (view === 'slip') V.transactions.slip(t);
        else V.transactions.openTicket(t.id);
      }
      root.scrollIntoView({ block: 'start' });
      window.scrollTo(0, 0);
      $('#app').classList.remove('is-navopen');
      document.title = 'WeighCore — ' + (({
        dashboard: 'Operations', terminal: 'Weighment terminal', transactions: 'Transactions',
        reports: 'Reports', audit: 'Audit trail', quality: 'Data quality', settings: 'Settings'
      })[view] || view.replace(/^master_|^admin_/, '').replace(/^\w/, c => c.toUpperCase()));
    }
  };

  /* ---------- theme ---------- */
  const THEME_KEY = 'weighcore.theme';
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { }
  }
  (function initTheme() {
    // Light is the default everywhere. The user can switch with the header toggle
    // (remembered per browser), and ?theme=light|dark forces it for kiosks/screenshots.
    const forced = (location.search.match(/[?&]theme=(light|dark)/) || [])[1];
    let t = forced;
    if (!t) { try { t = localStorage.getItem(THEME_KEY); } catch (e) { } }
    setTheme(t || 'light');
  })();

  /* ---------- command palette ---------- */
  const PAL = $('#palette');
  let palItems = [], palCursor = 0;

  function buildPalItems(q) {
    const out = [];
    const ql = (q || '').toLowerCase().trim();

    if (ql) {
      DB.transactions.filter(t => String(t.ticketNo).includes(ql)).slice(0, 5).forEach(t =>
        out.push({
          sec: 'Tickets', ic: 'list', t: 'Ticket #' + t.ticketNo,
          s: ((DB.map.vehicle[t.vehicleId] || {}).no || '') + ' · ' + t.status + ' · ' + U.fDate(t.at),
          act: () => { U.closePalette(); V.transactions.openTicket(t.id); }
        }));
      DB.vehicles.filter(v => v.no.toLowerCase().includes(ql)).slice(0, 5).forEach(v => {
        const open = DB.transactions.find(t => t.vehicleId === v.id && t.status === 'Active');
        out.push({
          sec: 'Vehicles', ic: 'truck', t: v.no,
          s: (v.type || 'type not set') + (open ? ' · open ticket #' + open.ticketNo : (v.tare ? ' · tare ' + U.num(v.tare) + ' kg' : ' · no stored tare')),
          act: () => { U.closePalette(); if (open) V.transactions.openTicket(open.id); else location.hash = '#/masters/vehicles'; }
        });
      });
    }
    NAV.forEach(g => g.items.forEach(it => {
      if (!window.AUTH.allows(it.v)) return;
      if (!ql || it.t.toLowerCase().includes(ql) || g.label.toLowerCase().includes(ql))
        out.push({ sec: 'Go to', ic: it.i, t: it.t, s: g.label, act: () => { U.closePalette(); location.hash = it.h; } });
    }));
    [
      window.AUTH.allows('terminal')
        ? { t: 'New weighment', s: 'Open the terminal on a blank ticket', ic: 'plus', act: () => { U.closePalette(); location.hash = '#/terminal'; } }
        : null,
      { t: 'Sign out', s: 'Return to the sign-in screen', ic: 'lock', act: () => { U.closePalette(); window.signOut(); } },
      { t: 'Toggle theme', s: 'Light / dark', ic: 'sparkle', act: () => { U.closePalette(); setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); } },
      { t: 'Keyboard shortcuts', s: 'Show the full list', ic: 'info', act: () => { U.closePalette(); showHelp(); } }
    ].filter(Boolean).forEach(a => { if (!ql || a.t.toLowerCase().includes(ql)) out.push(Object.assign({ sec: 'Actions' }, a)); });

    return out.slice(0, 14);
  }

  function paintPal(q) {
    palItems = buildPalItems(q); palCursor = 0;
    let html = '', sec = null;
    palItems.forEach((it, i) => {
      if (it.sec !== sec) { sec = it.sec; html += '<div class="palette__sec">' + esc(sec) + '</div>'; }
      html += '<div class="palette__i' + (i === 0 ? ' is-cursor' : '') + '" data-i="' + i + '">' + icon(it.ic) +
        '<div><b>' + esc(it.t) + '</b>' + (it.s ? '<br><small>' + esc(it.s) + '</small>' : '') + '</div></div>';
    });
    $('#palList').innerHTML = html || '<div class="combo__empty">Nothing matches “' + esc(q) + '”</div>';
  }

  function openPalette() {
    PAL.innerHTML = '<div class="palette__card">' +
      '<input class="palette__input" id="palInput" placeholder="Search tickets, vehicles, pages…" autocomplete="off">' +
      '<div class="palette__list" id="palList"></div>' +
      '<div class="palette__foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
    PAL.classList.add('is-on'); $('#scrim').classList.add('is-on');
    paintPal('');
    const inp = $('#palInput'); inp.focus();
    inp.addEventListener('input', () => paintPal(inp.value));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        palCursor = Math.max(0, Math.min(palItems.length - 1, palCursor + (e.key === 'ArrowDown' ? 1 : -1)));
        $$('.palette__i').forEach(el => el.classList.toggle('is-cursor', Number(el.dataset.i) === palCursor));
        const cur = $('.palette__i.is-cursor'); if (cur) cur.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault(); if (palItems[palCursor]) palItems[palCursor].act();
      }
    });
    $('#palList').addEventListener('click', (e) => {
      const el = e.target.closest('[data-i]'); if (el) palItems[Number(el.dataset.i)].act();
    });
  }
  function closePalette() {
    PAL.classList.remove('is-on');
    if (!$('#drawer').classList.contains('is-on') && !$('#modal').classList.contains('is-on')) $('#scrim').classList.remove('is-on');
  }
  U.closePalette = closePalette;

  /* ---------- help ---------- */
  function showHelp() {
    const rows = [
      ['Ctrl + K', 'Command palette — jump to any ticket, vehicle or page'],
      ['Ctrl + N', 'New weighment (opens the terminal)'],
      ['F8', 'Capture the weight currently on the indicator'],
      ['F7', 'Complete the ticket and print the slip'],
      ['F3', 'View the selected ticket'],
      ['Esc', 'Close the top-most panel · cancel the current entry'],
      ['Ctrl + B', 'Collapse or expand the sidebar'],
      ['?', 'This dialog']
    ];
    U.openModal('<div class="modal__head"><div><div class="card__title">Keyboard shortcuts</div>' +
      '<div class="card__sub">The terminal is designed to be driven without a mouse</div></div><div class="spacer"></div>' +
      '<button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
      '<div class="modal__body">' + U.table([
        { label: 'Key', w: '150px', get: r => r[0].split(' + ').map(k => '<kbd>' + esc(k) + '</kbd>').join(' ') },
        { label: 'Action', get: r => esc(r[1]) }
      ], rows, { zebra: true }) + '</div>' +
      '<div class="modal__foot"><button class="btn btn--primary" data-close>Got it</button></div>');
  }

  /* ---------- site selector ---------- */
  function initSite() {
    $('#siteSelect').innerHTML = '<option value="">All sites</option>' +
      DB.sites.map(s => '<option value="' + s.id + '">' + esc(s.code) + ' — ' + esc(s.name) + '</option>').join('');
    const wb = DB.map.wb[DB.settings.connectedScale] || { name: 'No scale', port: '—' };
    $('#scaleChipName').textContent = wb.name;
    $('#edgeSub').textContent = 'Connected · ' + wb.port;
  }

  /* ---------- global wiring ---------- */
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { location.hash = go.dataset.go; return; }
    if (e.target.closest('[data-close]')) {
      if ($('#modal').contains(e.target)) U.closeModal(); else U.closeDrawer();
      return;
    }
    if (e.target.closest('#btnTheme')) {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); return;
    }
    if (e.target.closest('#btnCollapse')) { $('#app').classList.toggle('is-collapsed'); return; }
    if (e.target.closest('#btnMobileNav')) { $('#app').classList.toggle('is-navopen'); return; }
    if (e.target.closest('#omnibox')) { openPalette(); return; }
    if (e.target.closest('#btnHelp')) { showHelp(); return; }
    if (e.target === $('#scrim')) {
      if (PAL.classList.contains('is-on')) closePalette();
      else U.closeTop();
      $('#app').classList.remove('is-navopen');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!window.AUTH.user) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && window.AUTH.allows('terminal')) { e.preventDefault(); location.hash = '#/terminal'; return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); $('#app').classList.toggle('is-collapsed'); return; }
    if (e.key === 'Escape') {
      if (PAL.classList.contains('is-on')) { closePalette(); return; }
      if (U.anyOpen()) { U.closeTop(); return; }
    }
    if (e.key === '?' && !typing) { e.preventDefault(); showHelp(); }
  });

  window.addEventListener('hashchange', () => { if (window.AUTH.user) ROUTER.render(); });

  /* ---------- session ---------- */
  function paintWho() {
    const u = window.AUTH.user; if (!u) return;
    $('#whoAv').textContent = (u.first[0] || '') + (u.last[0] || '');
    $('#whoName').textContent = u.first + ' ' + u.last;
    $('#whoRole').textContent = window.AUTH.role().name;
  }

  function startApp() {
    $('#login').innerHTML = '';
    $('#app').classList.remove('is-signedout');
    initSite();
    paintWho();
    if (!location.hash) location.hash = '#/dashboard';
    ROUTER.render();
    setTimeout(() => U.toast('info', 'Signed in as ' + window.AUTH.role().name,
      window.AUTH.isSuper()
        ? 'Full access. Ctrl+K to search — the terminal indicator is live.'
        : 'This login sees the dashboard and the ticket ledger only.'), 700);
  }

  function showLogin() {
    window.AUTH.renderLogin();
    window.AUTH.mountLogin(startApp);
  }

  window.signOut = function () {
    window.AUTH.logout();
    location.hash = '';
    showLogin();
  };

  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnSignOut')) window.signOut();
  });

  /* ---------- boot ---------- */
  if (window.AUTH.restore()) startApp(); else showLogin();
})();
