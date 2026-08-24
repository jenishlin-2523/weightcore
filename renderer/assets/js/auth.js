/* ==========================================================================
   WeighCore — authentication, roles and route gating

   Two demo logins:
     superadmin  · Super Administrator      · everything, and the only role
                                              that can delete a ticket
     viewer      · Dashboard & Transactions · those two screens only

   Access is enforced in the router, not just by hiding nav items — typing a
   forbidden hash directly bounces you back to the dashboard.
   ========================================================================== */
(function () {
  'use strict';
  const DB = window.DB;
  const KEY = 'weighcore.session';

  /* Views each role may open. '*' means everything. */
  const ACCESS = {
    R0: '*',
    R1: '*',
    R2: '*',
    R3: ['dashboard', 'terminal', 'transactions', 'ticket', 'slip'],
    R4: '*',
    RV: ['dashboard', 'transactions', 'ticket', 'slip']
  };

  const A = window.AUTH = {
    user: null,

    role() { return this.user ? DB.map.role[this.user.roleId] : null; },
    isSuper() { return !!this.user && this.user.roleId === 'R0'; },

    /* Feature permission: op 0=read 1=create 2=update */
    can(featureKey, op) {
      if (!this.user) return false;
      const p = DB.permissions[this.user.roleId];
      return !!(p && p[featureKey] && p[featureKey][op == null ? 0 : op]);
    },

    canDelete() { return this.can('txn.delete', 2); },

    /* Route permission */
    allows(view) {
      if (!this.user) return false;
      const a = ACCESS[this.user.roleId];
      if (a === '*') return true;
      return Array.isArray(a) && a.indexOf(view) >= 0;
    },

    // Demo-mode sign-in (no password) — used in a browser and for restore().
    _demoLogin(username) {
      const u = DB.users.find(x => x.username.toLowerCase() === String(username).toLowerCase() && x.active);
      if (!u) return null;
      this.user = u;
      try { localStorage.setItem(KEY, u.username); } catch (e) { }
      return u;
    },

    // Real sign-in. The desktop app verifies against the live UserMaster; a browser falls back to demo.
    async login(username, password) {
      if (window.weighcore && window.weighcore.auth) {
        try {
          const r = await window.weighcore.auth.login(username, password);
          if (r && r.ok && r.user) {
            this.user = r.user;
            // Register the live account in DB.users so operator lookups
            // (avatars, "created by" columns) resolve everywhere.
            try {
              if (DB.users && DB.map && DB.map.user && !DB.map.user[r.user.id]) {
                const u = Object.assign({ email: '', phone: '', last_login: '' }, r.user);
                DB.users.push(u); DB.map.user[u.id] = u;
              }
            } catch (e) { }
            return r.user;
          }
        } catch (e) { }
        return null;
      }
      return this._demoLogin(username);
    },

    logout() {
      this.user = null;
      try { localStorage.removeItem(KEY); } catch (e) { }
    },

    restore() {
      // Desktop app: always require a fresh sign-in (no stored password).
      if (window.weighcore && window.weighcore.auth) return null;
      // Demo/browser: forced kiosk login or last session.
      const forced = (location.search.match(/[?&]user=([a-zA-Z0-9._-]+)/) || [])[1];
      if (forced) { const u = this._demoLogin(forced); if (u) return u; }
      let n = null;
      try { n = localStorage.getItem(KEY); } catch (e) { }
      return n ? this._demoLogin(n) : null;
    }
  };

  /* ---------- sign-in screen ---------- */
  A.renderLogin = function () {
    const U = window.UI, esc = U.esc, icon = U.icon;
    const o = DB.opening;

    document.getElementById('app').classList.add('is-signedout');
    document.getElementById('login').innerHTML =
      '<div class="login">' +
        '<div class="login__panel">' +
          '<div class="login__brand">' +
            '<div class="brandmark"><svg viewBox="0 0 32 32" fill="none"><path d="M16 4v24M6 11h20M9 11l-4 9a5 5 0 0 0 8 0l-4-9Zm14 0-4 9a5 5 0 0 0 8 0l-4-9Z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="28" r="2.4" fill="currentColor"/></svg></div>' +
            '<div><strong>WeighCore</strong><span>Weighbridge Operations</span></div>' +
          '</div>' +
          '<h1 class="login__h">Sign in</h1>' +
          '<p class="login__sub">' + esc(DB.company.name) + ' · ' + esc(DB.company.project) + '</p>' +
          '<div class="login__form">' +
            '<input class="input" id="lgUser" placeholder="Username" autocomplete="username" autofocus>' +
            '<input class="input" type="password" id="lgPass" placeholder="Password" autocomplete="current-password">' +
            '<button class="btn btn--primary btn--lg" id="lgGo">Sign in</button>' +
          '</div>' +
          '<p class="login__note">Sign in with your weighbridge account.</p>' +
        '</div>' +
        '<div class="login__aside">' +
          '<h2>Every load, accounted for.</h2>' +
          '<p>Capture both weighings, close the ticket, print the slip — with camera evidence, an immutable audit trail and reporting that reconciles.</p>' +
          '<div class="login__facts">' +
            '<div><b>' + U.num(o.tickets) + '</b><span>Tickets brought forward</span></div>' +
            '<div><b>' + U.num(Math.round(o.netKg / 1000)) + '</b><span>Tonnes moved to date</span></div>' +
            '<div><b>' + DB.sites.length + '</b><span>Weighbridge sites</span></div>' +
            '<div><b>' + DB.weighbridges.filter(w => w.active).length + '</b><span>Active scales</span></div>' +
          '</div>' +
          '<p class="login__prov">Opening figures are the site’s real history, ' + esc(o.from) + ' – ' + esc(o.to) + '.</p>' +
        '</div>' +
      '</div>';
  };

  A.mountLogin = function (onDone) {
    const el = document.getElementById('login');
    const submit = function (username) {
      const pass = (document.getElementById('lgPass') || {}).value || '';
      Promise.resolve(A.login(username, pass)).then(function (u) {
        if (!u) { window.UI.toast('danger', 'Sign-in failed', 'Check your username and password.'); return; }
        onDone();
      });
    };
    el.onclick = function (e) {
      if (e.target.closest('#lgGo')) { submit((document.getElementById('lgUser').value || '').trim()); }
    };
    el.onkeydown = function (e) {
      if (e.key === 'Enter' && (e.target.id === 'lgUser' || e.target.id === 'lgPass')) {
        e.preventDefault();
        const btn = document.getElementById('lgGo'); if (btn) btn.click();
      }
    };
  };
})();
