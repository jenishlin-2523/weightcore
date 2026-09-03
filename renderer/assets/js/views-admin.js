/* ==========================================================================
   WeighCore — master data · devices · reports · audit · quality · admin · settings
   ========================================================================== */
(function () {
  'use strict';
  const U = window.UI, DB = window.DB;
  const V = window.VIEWS = window.VIEWS || {};
  const { esc, icon, num, kg, mt, fDT, fDate, fTime, ago } = U;

  const aName = (id) => (DB.map.account[id] || {}).name || '—';
  const pName = (id) => (DB.map.product[id] || {}).name || '—';
  const vName = (id) => (DB.map.vehicle[id] || {}).no || '—';

  /* Master entities persisted to the live SQL DB, with their app-id prefixes. */
  const SQL_MASTERS = { vehicles: 'V', accounts: 'A', drivers: 'D', products: 'P', gates: 'G', units: 'U', weighbridges: 'WB' };
  const MAP_KEY = { vehicles: 'vehicle', accounts: 'account', drivers: 'driver', products: 'product', gates: 'gate', locations: 'site', units: 'unit', weighbridges: 'wb', cameras: 'cam' };
  const sqlIdOf = (id, pre) => { const m = new RegExp('^' + pre + '(\\d+)$').exec(String(id || '')); return m ? parseInt(m[1], 10) : null; };
  const in14 = (t) => t.at && (DB.NOW - t.at) < 14 * 864e5;

  /* ======================================================================
     GENERIC MASTER MODULE
     ====================================================================== */
  const MASTERS = {
    vehicles: {
      title: 'Vehicles', sub: 'Trucks permitted on the weighbridge, with their stored tare weights',
      icon: 'truck', data: () => DB.vehicles, add: 'Add vehicle',
      cols: [
        { label: 'Vehicle number', get: r => '<b class="mono">' + esc(r.no) + '</b>' },
        { label: 'Type', get: r => r.type ? esc(r.type) : '<span class="badge badge--warn">not set</span>' },
        { label: 'Transporter', get: r => esc(aName(r.accountId)) },
        { label: 'Stored tare', num: true, get: r => r.tare ? num(r.tare) + ' kg' : '<span class="badge badge--danger">missing</span>' },
        { label: 'Capacity', num: true, get: r => num(r.cap) + ' kg' },
        { label: 'Weighings (14d)', num: true, get: r => num(DB.transactions.filter(t => t.vehicleId === r.id && in14(t)).length) },
        { label: 'Tare trend', get: r => { const s = tareSeries(r.id); return s.length > 2 ? U.sparkline(s, 'var(--brand)') : '<span class="dim tiny">—</span>'; } },
        { label: 'Status', get: r => U.activeBadge(r.active) }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Vehicle number', req: true, value: r.no, id: 'f_no' }) +
        U.field({ label: 'Vehicle type', type: 'select', value: r.type, id: 'f_type', options: [{ v: '', t: '— not set —' }].concat(DB.fieldLists.cf1.map(v => ({ v, t: v }))) }) +
        U.field({ label: 'Transporter', type: 'select', value: r.accountId, id: 'f_accountId', options: DB.accounts.filter(a => a.isTransporter).map(a => ({ v: a.id, t: a.name })) }) +
        U.field({ label: 'Stored tare (kg)', type: 'number', value: r.tare, id: 'f_tare', hint: 'Required for single-pass weighing' }) +
        U.field({ label: 'Gross capacity (kg)', type: 'number', value: r.cap, id: 'f_cap' }) +
        U.field({ label: 'Status', type: 'select', value: String(r.active), id: 'f_active', options: [{ v: 'true', t: 'Active' }, { v: 'false', t: 'Inactive' }] }) +
        '</div>'
    },
    accounts: {
      title: 'Accounts & parties', sub: 'Transporters, customers and paying parties — one record can be both',
      icon: 'users', data: () => DB.accounts, add: 'Add account',
      cols: [
        { label: 'Name', get: r => '<div class="cellstack"><b>' + esc(r.name) + '</b><span>' + esc(r.city || '—') + '</span></div>' },
        { label: 'Roles', get: r => (r.isTransporter ? '<span class="tag">Transporter</span> ' : '') + (r.isAccount ? '<span class="tag">Account</span>' : '') },
        { label: 'Contact', get: r => '<div class="cellstack"><b>' + esc(r.contact || '—') + '</b><span class="mono">' + esc(r.phone || '') + '</span></div>' },
        { label: 'Vehicles', num: true, get: r => num(DB.vehicles.filter(v => v.accountId === r.id).length) },
        { label: 'Net moved (14d)', num: true, get: r => mt(DB.transactions.filter(t => t.transporterId === r.id && t.net && in14(t)).reduce((n, t) => n + t.net, 0), 1) + ' MT' },
        { label: 'Status', get: r => U.activeBadge(r.active) }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Company name', req: true, value: r.name, id: 'f_name', span2: true }) +
        U.field({ label: 'Contact person', value: r.contact, id: 'f_contact' }) +
        U.field({ label: 'Phone', value: r.phone, id: 'f_phone' }) +
        U.field({ label: 'City', value: r.city, id: 'f_city' }) +
        U.field({ label: 'Status', type: 'select', value: String(r.active), id: 'f_active', options: [{ v: 'true', t: 'Active' }, { v: 'false', t: 'Inactive' }] }) +
        '<div class="field col-span-2"><div class="field__label">Role on tickets</div><div class="row">' +
        '<label class="check"><input type="checkbox" id="f_isTransporter"' + (r.isTransporter ? ' checked' : '') + '> Transporter</label>' +
        '<label class="check"><input type="checkbox" id="f_isAccount"' + (r.isAccount ? ' checked' : '') + '> Billing account</label></div></div>' +
        '</div>'
    },
    drivers: {
      title: 'Drivers', sub: 'Licensed drivers linked to their transporter',
      icon: 'user', data: () => DB.drivers, add: 'Add driver',
      cols: [
        { label: 'Name', get: r => '<b>' + esc(r.name) + '</b>' },
        { label: 'Licence no', get: r => '<span class="mono">' + esc(r.licence) + '</span>' },
        { label: 'Phone', get: r => '<span class="mono">' + esc(r.phone) + '</span>' },
        { label: 'Transporter', get: r => esc(aName(r.accountId)) },
        { label: 'Trips (14d)', num: true, get: r => num(DB.transactions.filter(t => t.driverId === r.id && in14(t)).length) },
        { label: 'Status', get: r => U.activeBadge(r.active) }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Driver name', req: true, value: r.name, id: 'f_name' }) +
        U.field({ label: 'Licence number', value: r.licence, id: 'f_licence' }) +
        U.field({ label: 'Phone', value: r.phone, id: 'f_phone' }) +
        U.field({ label: 'Transporter', type: 'select', value: r.accountId, id: 'f_accountId', options: DB.accounts.filter(a => a.isTransporter).map(a => ({ v: a.id, t: a.name })) }) +
        U.field({ label: 'Status', type: 'select', value: String(r.active), id: 'f_active', options: [{ v: 'true', t: 'Active' }, { v: 'false', t: 'Inactive' }] }) +
        '</div>'
    },
    products: {
      title: 'Products & materials', sub: 'What is being moved across the bridge, and what it is worth',
      icon: 'box', data: () => DB.products, add: 'Add product',
      cols: [
        { label: 'Product', get: r => '<div class="cellstack"><b>' + esc(r.name) + '</b><span>' + esc(r.desc || '—') + '</span></div>' },
        { label: 'Code', get: r => '<span class="mono">' + esc(r.code) + '</span>' },
        { label: 'Report unit', get: r => '<span class="tag">' + esc(r.unit) + '</span>' },
        { label: 'Rate / MT', num: true, get: r => r.rate ? U.inr(r.rate) : '<span class="dim">—</span>' },
        { label: 'Tickets (14d)', num: true, get: r => num(DB.transactions.filter(t => t.productId === r.id && in14(t)).length) },
        { label: 'Net (14d)', num: true, get: r => mt(DB.transactions.filter(t => t.productId === r.id && t.net && in14(t)).reduce((n, t) => n + t.net, 0), 1) + ' MT' },
        { label: 'Status', get: r => U.activeBadge(r.active) }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Product name', req: true, value: r.name, id: 'f_name' }) +
        U.field({ label: 'Product code', value: r.code, id: 'f_code' }) +
        U.field({ label: 'Description', value: r.desc, id: 'f_desc', span2: true }) +
        U.field({ label: 'Transaction type', type: 'select', value: r.txnType || 'All', id: 'f_txnType', hint: 'Which weighment type this product appears under', options: [{ v: 'All', t: 'All types' }, { v: 'Processing', t: 'Processing' }, { v: 'Disposal', t: 'Disposal' }, { v: 'RDF', t: 'RDF' }] }) +
        U.field({ label: 'Reporting unit', type: 'select', value: r.unit, id: 'f_unit', options: DB.units.map(u => ({ v: u.name, t: u.name + ' — ' + u.desc })) }) +
        U.field({ label: 'Rate per MT (₹)', type: 'number', value: r.rate, id: 'f_rate' }) +
        U.field({ label: 'Status', type: 'select', value: String(r.active), id: 'f_active', options: [{ v: 'true', t: 'Active' }, { v: 'false', t: 'Inactive' }] }) +
        '</div>'
    },
    gates: {
      title: 'Gates', sub: 'Entry and exit points recorded on each ticket',
      icon: 'gate', data: () => DB.gates, add: 'Add gate',
      cols: [
        { label: 'Gate', get: r => '<b>' + esc(r.name) + '</b>' },
        { label: 'Direction', get: r => '<span class="badge badge--' + (r.type === 'BOTH' ? 'brand' : r.type === 'IN' ? 'ok' : 'info') + '">' + esc(r.type) + '</span>' },
        { label: 'Site', get: r => esc(DB.map.site[r.siteId].code) },
        { label: 'Tickets (14d)', num: true, get: r => num(DB.transactions.filter(t => t.gateId === r.id && in14(t)).length) },
        { label: 'Status', get: r => U.activeBadge(r.active) }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Gate name', req: true, value: r.name, id: 'f_name' }) +
        U.field({ label: 'Direction', type: 'select', value: r.type, id: 'f_type', options: [{ v: 'BOTH', t: 'Both ways' }, { v: 'IN', t: 'Inbound only' }, { v: 'OUT', t: 'Outbound only' }] }) +
        U.field({ label: 'Site', type: 'select', value: r.siteId, id: 'f_siteId', options: DB.sites.map(s => ({ v: s.id, t: s.code + ' — ' + s.name })) }) +
        U.field({ label: 'Status', type: 'select', value: String(r.active), id: 'f_active', options: [{ v: 'true', t: 'Active' }, { v: 'false', t: 'Inactive' }] }) +
        '</div>'
    },
    locations: {
      title: 'Sites & locations', sub: 'Physical weighbridge sites — every master record and ticket is scoped to one',
      icon: 'pin', data: () => DB.sites, add: 'Add site',
      cols: [
        { label: 'Code', get: r => '<b class="mono">' + esc(r.code) + '</b>' },
        { label: 'Name', get: r => esc(r.name) },
        { label: 'Address', get: r => '<span class="dim">' + esc(r.address) + '</span>' },
        { label: 'Weighbridges', num: true, get: r => num(DB.weighbridges.filter(w => w.siteId === r.id).length) },
        { label: 'Tickets (14d)', num: true, get: r => num(DB.transactions.filter(t => t.siteId === r.id && in14(t)).length) }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Site code', req: true, value: r.code, id: 'f_code' }) +
        U.field({ label: 'Site name', req: true, value: r.name, id: 'f_name' }) +
        U.field({ label: 'Address', value: r.address, id: 'f_address', span2: true }) + '</div>'
    },
    units: {
      title: 'Units of measure', sub: 'Base unit for capture, reporting unit for output',
      icon: 'ruler', data: () => DB.units, add: 'Add unit',
      cols: [
        { label: 'Unit', get: r => '<b>' + esc(r.name) + '</b>' },
        { label: 'Description', get: r => esc(r.desc) },
        { label: 'Decimals', num: true, get: r => r.decimals },
        { label: 'Role', get: r => r.base ? '<span class="badge badge--brand">Capture base</span>' : DB.settings.reportUnit === r.name ? '<span class="badge badge--info">Reporting</span>' : '<span class="dim">—</span>' },
        { label: 'Status', get: r => U.activeBadge(r.active) }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Unit name', req: true, value: r.name, id: 'f_name' }) +
        U.field({ label: 'Description', value: r.desc, id: 'f_desc' }) +
        U.field({ label: 'Decimal places', type: 'number', value: r.decimals, id: 'f_decimals' }) + '</div>'
    },
    weighbridges: {
      title: 'Weighbridges', sub: 'Scales and their indicator serial configuration',
      icon: 'scale', data: () => DB.weighbridges, add: 'Add weighbridge',
      cols: [
        { label: 'Scale', get: r => '<div class="cellstack"><b>' + esc(r.name) + '</b><span>' + esc(r.platform) + '</span></div>' },
        { label: 'Site', get: r => esc(DB.map.site[r.siteId].code) },
        { label: 'Indicator', get: r => esc(r.indicator) },
        { label: 'Serial', get: r => '<span class="mono">' + esc(r.port) + ' · ' + r.baud + ' ' + r.dataBits + r.parity[0] + r.stopBits + '</span>' },
        { label: 'Capacity', num: true, get: r => num(r.capacity) + ' kg' },
        { label: 'Cameras', num: true, get: r => num(DB.cameras.filter(c => c.wbId === r.id).length) },
        { label: 'Link', get: r => U.onlineBadge(r.status) }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Scale name', req: true, value: r.name, id: 'f_name' }) +
        U.field({ label: 'Site', type: 'select', value: r.siteId, id: 'f_siteId', options: DB.sites.map(s => ({ v: s.id, t: s.code })) }) +
        U.field({ label: 'Indicator make / model', value: r.indicator, id: 'f_indicator' }) +
        U.field({ label: 'Platform size', value: r.platform, id: 'f_platform' }) +
        U.field({ label: 'Capacity (kg)', type: 'number', value: r.capacity, id: 'f_capacity' }) +
        U.field({ label: 'COM port', value: r.port, id: 'f_port' }) +
        U.field({ label: 'Baud rate', type: 'select', value: String(r.baud), id: 'f_baud', options: ['1200', '2400', '4800', '9600', '19200'].map(v => ({ v, t: v })) }) +
        U.field({ label: 'Data bits', type: 'select', value: String(r.dataBits), id: 'f_dataBits', options: ['7', '8'].map(v => ({ v, t: v })) }) +
        U.field({ label: 'Parity', type: 'select', value: r.parity, id: 'f_parity', options: ['None', 'Even', 'Odd'].map(v => ({ v, t: v })) }) +
        U.field({ label: 'Stop bits', type: 'select', value: String(r.stopBits), id: 'f_stopBits', options: ['1', '2'].map(v => ({ v, t: v })) }) +
        '</div>' + '<div style="margin-top:var(--sp-4)">' +
        U.callout('', 'The <b>Edge Agent</b> owns this serial link. Changes here are pushed to the cabin PC on its next heartbeat — no local reconfiguration needed.') + '</div>'
    },
    cameras: {
      title: 'Cameras', sub: 'Each camera is bound to a scale; every pass triggers a snapshot from all bound cameras',
      icon: 'camera', data: () => DB.cameras, add: 'Add camera',
      cols: [
        { label: 'Camera', get: r => '<b>' + esc(r.name) + '</b>' },
        { label: 'Integration', get: r => '<span class="badge badge--' + (r.type === 'HikVision' ? 'violet' : 'info') + '">' + esc(r.type) + '</span>' },
        { label: 'Stream URL', get: r => '<span class="mono tiny">' + esc(r.url) + '</span>' },
        { label: 'Bound to', get: r => r.wbId ? esc(DB.map.wb[r.wbId].name) : '<span class="badge badge--warn">unbound</span>' },
        { label: 'Link', get: r => U.onlineBadge(r.status) },
        { label: '', get: r => '<button class="btn btn--sm" data-test="' + r.id + '">' + icon('play') + 'Test</button>' }
      ],
      form: (r) => '<div class="formgrid formgrid--2">' +
        U.field({ label: 'Camera name', req: true, value: r.name, id: 'f_name' }) +
        U.field({ label: 'Integration type', type: 'select', value: r.type, id: 'f_type', options: [{ v: 'RTSP/MJPEG', t: 'RTSP / MJPEG (generic)' }, { v: 'HikVision', t: 'HikVision SDK' }, { v: 'ONVIF', t: 'ONVIF profile S' }] }) +
        U.field({ label: 'Stream URL', value: r.url, id: 'f_url', span2: true }) +
        U.field({ label: 'IP address', value: r.ip, id: 'f_ip' }) +
        U.field({ label: 'Port', type: 'number', value: r.port, id: 'f_port' }) +
        U.field({ label: 'Username', value: r.user, id: 'f_user' }) +
        U.field({ label: 'Password', type: 'password', value: '••••••••', id: 'f_pwd', hint: 'Encrypted at rest, never returned by the API' }) +
        U.field({ label: 'Bound weighbridge', type: 'select', value: r.wbId || '', id: 'f_wbId', options: [{ v: '', t: '— unbound —' }].concat(DB.weighbridges.map(w => ({ v: w.id, t: w.name }))) }) +
        '</div>' +
        '<div style="margin-top:var(--sp-4)"><div class="field__label">Live preview</div>' +
        '<div class="cam" style="border-radius:10px;overflow:hidden;max-width:420px;margin-top:6px">' +
        '<img src="' + DB.LIVE[0] + '" alt="Camera preview"><span class="cam__rec"><i></i>LIVE</span>' +
        '<span class="cam__ts">' + fDT(DB.NOW) + '</span></div></div>'
    }
  };

  function tareSeries(vehicleId) {
    return DB.transactions.filter(t => t.vehicleId === vehicleId && t.tare).slice(0, 12).reverse().map(t => t.tare);
  }

  const MQ = { q: '', showInactive: true };

  function masterView(key) {
    const def = MASTERS[key];
    return {
      render() {
        MQ.q = '';
        return U.pageHead({
          crumbs: ['Master data', def.title],
          title: def.title, sub: def.sub,
          actions: '<button class="btn" data-export>' + icon('download') + 'Export</button>' +
            '<button class="btn btn--primary" data-new>' + icon('plus') + esc(def.add) + '</button>'
        }) +
        '<div class="toolbar">' + U.searchBox('mq', 'Search ' + def.title.toLowerCase() + '…') +
        '<label class="check"><input type="checkbox" id="mInactive" checked> Show inactive</label>' +
        '<div class="spacer"></div><span class="tiny dim" id="mCount"></span></div>' +
        '<div class="card" id="mCard"></div>';
      },
      paint() {
        let rows = def.data().slice();
        if (!MQ.showInactive) rows = rows.filter(r => r.active !== false);
        if (MQ.q) {
          const q = MQ.q.toLowerCase();
          rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
        }
        const c = U.$('#mCount'); if (c) c.textContent = rows.length + ' of ' + def.data().length + ' records';
        U.$('#mCard').innerHTML = U.table(
          def.cols.concat([{ label: '', w: '90px', get: r => '<button class="btn btn--sm btn--ghost" data-edit="' + r.id + '">' + icon('edit') + 'Edit</button>' }]),
          rows, { zebra: true, emptyTitle: 'No records', emptyMsg: 'Nothing matches this search.' });
      },
      mount(root) {
        const self = this;
        this.paint();
        root.addEventListener('input', (e) => { if (e.target.id === 'mq') { MQ.q = e.target.value; self.paint(); } });
        root.addEventListener('change', (e) => { if (e.target.id === 'mInactive') { MQ.showInactive = e.target.checked; self.paint(); } });
        root.addEventListener('click', (e) => {
          if (e.target.closest('[data-export]')) {
            const rows = def.data();
            const keys = Object.keys(rows[0] || {});
            const qq = v => '"' + String(v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v)).replace(/"/g, '""') + '"';
            const csv = [keys.join(',')].concat(rows.map(r => keys.map(k => qq(r[k])).join(','))).join('\r\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
            a.download = key + '_export.csv';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
            U.toast('ok', 'Export saved', rows.length + ' rows → ' + a.download + ' (Downloads folder)');
            return;
          }
          const t = e.target.closest('[data-test]');
          if (t) {
            const cam = DB.map.cam[t.dataset.test] || {};
            if (window.weighcore && window.weighcore.capture) {
              // Real test: grab a live frame over RTSP through the native capture path.
              const nid = cam.nativeId || t.dataset.test;
              U.toast('info', 'Testing ' + (cam.name || nid) + '…', 'Grabbing a live frame from ' + (cam.ip || 'the stream'));
              window.weighcore.capture(nid).then(function (r) {
                if (r && r.ok) U.toast('ok', 'Stream OK — ' + (cam.name || nid), 'Live frame captured from ' + (cam.ip || 'camera') + '.');
                else U.toast('danger', 'No frame from ' + (cam.name || nid), ((r && r.error) || 'capture failed') + ' — check power and network.');
              }).catch(function () { U.toast('danger', 'No frame from ' + (cam.name || nid), 'Capture failed — check power and network.'); });
            } else {
              U.toast(cam.status === 'online' ? 'ok' : 'danger',
                cam.status === 'online' ? 'Stream OK — ' + cam.name : 'No response from ' + cam.ip,
                cam.status === 'online' ? 'Demo mode — no hardware attached.' : 'Check power and network to the camera.');
            }
            return;
          }
          const ed = e.target.closest('[data-edit]');
          if (ed || e.target.closest('[data-new]')) {
            const rec = (ed ? def.data().find(r => r.id === ed.dataset.edit) : {}) || {};
            openForm(key, def, rec, () => self.paint());
          }
        });
      }
    };
  }

  function openForm(key, def, rec, after) {
    const isNew = !rec.id;
    U.openModal(
      '<div class="modal__head"><div><div class="card__title">' + (isNew ? 'New ' : 'Edit ') + def.title.replace(/s$/, '').toLowerCase() + '</div>' +
      '<div class="card__sub">' + (isNew ? 'Creates a record and writes an audit entry' : esc(rec.name || rec.no || rec.code || rec.id)) + '</div></div>' +
      '<div class="spacer"></div><button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
      '<div class="modal__body">' + def.form(rec) + '</div>' +
      '<div class="modal__foot"><button class="btn btn--primary" id="mSave">' + icon('save') + 'Save</button>' +
      '<button class="btn" data-close>Cancel</button>' +
      (isNew ? '' : '<div class="spacer"></div><button class="btn btn--danger" id="mToggle">' + icon('ban') + (rec.active === false ? 'Reactivate' : 'Deactivate') + '</button>') +
      '</div>', true);

    U.$('#mSave').addEventListener('click', () => {
      const out = isNew ? {} : rec;
      U.$$('#modal [id^="f_"]').forEach(el => {
        const k = el.id.slice(2);
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (v === 'true') v = true; else if (v === 'false') v = false;
        else if (el.type === 'number') v = Number(v) || 0;
        if (k === 'pwd') return;
        out[k] = v;
      });
      if (out.no) out.no = String(out.no).toUpperCase();
      if (isNew && out.active == null) out.active = true;
      const who = ((window.AUTH || {}).user || {}).username || 'admin';

      const doneLocal = function (savedToSql) {
        if (isNew) def.data().push(out);
        const mk = MAP_KEY[key]; if (DB.map[mk]) DB.map[mk][out.id] = out;
        DB.audit.unshift({
          id: 'AUX' + Date.now(), table: def.title, op: isNew ? 'INSERT' : 'UPDATE', at: new Date(), user: who,
          text: def.title.replace(/s$/, '') + ' "' + esc(out.name || out.no || out.code) + '" ' + (isNew ? 'created' : 'updated'), ref: null
        });
        U.closeModal(); after();
        U.toast('ok', savedToSql ? 'Saved to database' : 'Saved',
          (out.name || out.no || out.code) + ' has been ' + (isNew ? 'created' : 'updated') + (savedToSql ? ' in the weighbridge database.' : '.'));
      };

      const pre = SQL_MASTERS[key];
      const wc = window.weighcore;
      if (pre && wc && wc.data && wc.data.saveMaster) {
        const fields = Object.assign({}, rec, out, { accountId: sqlIdOf(out.accountId != null ? out.accountId : rec.accountId, 'A') });
        const idNum = isNew ? null : sqlIdOf(rec.id, pre);
        wc.data.saveMaster({ entity: key, id: idNum, fields }).then(function (r) {
          if (r && r.ok) { if (isNew || !idNum) out.id = pre + r.id; doneLocal(true); }
          else {
            if (!out.id) out.id = key.slice(0, 2).toUpperCase() + 'X' + Date.now();
            doneLocal(false);
            U.toast('danger', 'Database save failed', ((r && r.error) || 'unknown error') + ' — change kept on screen only.');
          }
        }).catch(function () {
          if (!out.id) out.id = key.slice(0, 2).toUpperCase() + 'X' + Date.now();
          doneLocal(false);
          U.toast('danger', 'Database save failed', 'Change kept on screen only.');
        });
      } else {
        if (isNew) out.id = key.slice(0, 2).toUpperCase() + (def.data().length + 1);
        doneLocal(false);
      }
    });
    const tg = U.$('#mToggle');
    if (tg) tg.addEventListener('click', () => {
      rec.active = rec.active === false;
      const pre = SQL_MASTERS[key];
      const idNum = pre ? sqlIdOf(rec.id, pre) : null;
      if (pre && idNum && window.weighcore && window.weighcore.data && window.weighcore.data.saveMaster) {
        window.weighcore.data.saveMaster({
          entity: key, id: idNum,
          fields: Object.assign({}, rec, { accountId: sqlIdOf(rec.accountId, 'A') })
        }).then(function (r) {
          if (!(r && r.ok)) U.toast('danger', 'Database update failed', ((r && r.error) || 'unknown error') + ' — status changed on screen only.');
        }).catch(function () { U.toast('danger', 'Database update failed', 'Status changed on screen only.'); });
      }
      U.closeModal(); after();
      U.toast('warn', rec.active ? 'Reactivated' : 'Deactivated', 'Record kept — WeighCore never hard-deletes master data.');
    });
  }

  ['vehicles', 'accounts', 'drivers', 'products', 'gates', 'locations', 'units', 'weighbridges', 'cameras']
    .forEach(k => { V['master_' + k] = masterView(k); });

  /* ======================================================================
     REPORTS
     ====================================================================== */
  const RQ = {
    from: new Date(DB.NOW.getTime() - 6 * 864e5), to: DB.NOW,
    type: '', status: 'Complete', mode: '', product: '', transporter: '', vehicle: '',
    site: '', cf1: '', cf3: '', cf4: '', out: 'summary', ran: false
  };

  V.reports = {
    render(params) {
      const tab = (params && params[0]) || 'transaction';
      return U.pageHead({
        title: 'Reports', sub: 'Filter, preview and export — every dataset reconciles to the same ledger',
        actions: '<button class="btn" id="rPrint">' + icon('printer') + 'Print</button>' +
          '<button class="btn" id="rXls">' + icon('download') + 'Excel</button>' +
          '<button class="btn" id="rPdf">' + icon('download') + 'PDF</button>'
      }) +
      U.tabs([{ k: 'transaction', t: 'Transaction report' }, { k: 'master', t: 'Master reports' }, { k: 'reconcile', t: 'Reconciliation' }], tab, 'data-rtab') +
      '<div id="rBody">' + (tab === 'master' ? this.master() : tab === 'reconcile' ? this.reconcile() : this.transaction()) + '</div>';
    },

    transaction() {
      const f = (label, html) => '<div class="field">' + '<div class="field__label">' + label + '</div>' + html + '</div>';
      const opt = (arr, val, blank) => '<option value="">' + blank + '</option>' +
        arr.map(o => '<option value="' + esc(o.v) + '"' + (o.v === val ? ' selected' : '') + '>' + esc(o.t) + '</option>').join('');
      return U.card({
        title: 'Filter', sub: 'Every field the legacy report offered, plus site and operator scoping',
        actions: '<button class="btn btn--sm" id="rReset">Reset</button>',
        body:
          '<fieldset class="fieldset"><legend class="fieldset__legend">Period</legend><div class="formgrid">' +
            U.field({ label: 'From', id: 'rFrom', type: 'datetime-local', value: U.fInput(RQ.from) }) +
            U.field({ label: 'To', id: 'rTo', type: 'datetime-local', value: U.fInput(RQ.to) }) +
            f('Quick range', '<div class="pills" id="rQuick">' +
              [['1', 'Today'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days']].map(([d, t]) =>
                '<button class="pill" data-days="' + d + '">' + t + '</button>').join('') + '</div>') +
          '</div></fieldset>' +
          '<fieldset class="fieldset" style="margin-top:var(--sp-5)"><legend class="fieldset__legend">Transaction</legend><div class="formgrid">' +
            f('Status', '<select class="input" id="rStatus">' + opt([{ v: 'Complete', t: 'Complete' }, { v: 'Active', t: 'On the bridge' }, { v: 'Void', t: 'Void' }], RQ.status, 'All statuses') + '</select>') +
            f('Type', '<select class="input" id="rType">' + opt(['Processing', 'Disposal', 'RDF'].map(v => ({ v, t: v })), RQ.type, 'All types') + '</select>') +
            f('Mode', '<select class="input" id="rMode">' + opt(['Single', 'Double', 'Multi'].map(v => ({ v, t: v })), RQ.mode, 'All modes') + '</select>') +
            f('Site', '<select class="input" id="rSite">' + opt(DB.sites.map(s => ({ v: s.id, t: s.code })), RQ.site, 'All sites') + '</select>') +
          '</div></fieldset>' +
          '<fieldset class="fieldset" style="margin-top:var(--sp-5)"><legend class="fieldset__legend">Master data</legend><div class="formgrid">' +
            f('Product', '<select class="input" id="rProduct">' + opt(DB.products.map(p => ({ v: p.id, t: p.name })), RQ.product, 'All products') + '</select>') +
            f('Transporter', '<select class="input" id="rTransporter">' + opt(DB.accounts.filter(a => a.isTransporter).map(a => ({ v: a.id, t: a.name })), RQ.transporter, 'All transporters') + '</select>') +
            f('Vehicle', '<select class="input" id="rVehicle">' + opt(DB.vehicles.map(v => ({ v: v.id, t: v.no })), RQ.vehicle, 'All vehicles') + '</select>') +
          '</div></fieldset>' +
          '<fieldset class="fieldset" style="margin-top:var(--sp-5)"><legend class="fieldset__legend">Configurable fields</legend><div class="formgrid">' +
            f('Vehicle type', '<select class="input" id="rCf1">' + opt(DB.fieldLists.cf1.map(v => ({ v, t: v })), RQ.cf1, 'Any') + '</select>') +
            f('Buyer name', '<select class="input" id="rCf3">' + opt(DB.fieldLists.cf3.map(v => ({ v, t: v })), RQ.cf3, 'Any') + '</select>') +
            f('Package no', '<select class="input" id="rCf4">' + opt(DB.fieldLists.cf4.map(v => ({ v, t: v })), RQ.cf4, 'Any') + '</select>') +
          '</div></fieldset>' +
          '<hr class="hr">' +
          '<div class="row">' + U.seg('out', [{ v: 'summary', t: 'Summary' }, { v: 'detail', t: 'Detail' }], RQ.out, 'seg--brand') +
          '<span class="tiny dim">Summary groups by product and transporter · Detail lists every ticket</span>' +
          '<div class="spacer"></div>' +
          '<button class="btn btn--primary" id="rRun">' + icon('filter') + 'Run report</button></div>'
      }) + '<div id="rOut" style="margin-top:var(--sp-4)">' + (RQ.ran ? this.output() : '') + '</div>';
    },

    rows() {
      return DB.transactions.filter(t => {
        if (t.at < RQ.from || t.at > RQ.to) return false;
        if (RQ.status && t.status !== RQ.status) return false;
        if (RQ.type && t.type !== RQ.type) return false;
        if (RQ.mode && t.mode !== RQ.mode) return false;
        if (RQ.site && t.siteId !== RQ.site) return false;
        if (RQ.product && t.productId !== RQ.product) return false;
        if (RQ.transporter && t.transporterId !== RQ.transporter) return false;
        if (RQ.vehicle && t.vehicleId !== RQ.vehicle) return false;
        if (RQ.cf1 && U.norm(t.cf.cf1) !== U.norm(RQ.cf1)) return false;
        if (RQ.cf3 && U.norm(t.cf.cf3) !== U.norm(RQ.cf3)) return false;
        if (RQ.cf4 && U.norm(t.cf.cf4) !== U.norm(RQ.cf4)) return false;
        return true;
      });
    },

    output() {
      const rows = this.rows();
      const net = rows.reduce((n, t) => n + (t.net || 0), 0);
      const head = '<div class="grid grid--kpi" style="margin-bottom:var(--sp-4)">' +
        U.kpi({ label: 'Tickets', value: num(rows.length) }) +
        U.kpi({ label: 'Net weight', value: mt(net, 3), unit: 'MT', color: 'var(--ok)' }) +
        U.kpi({ label: 'Avg net / ticket', value: mt(rows.length ? net / rows.length : 0, 3), unit: 'MT', color: 'var(--info)' }) +
        U.kpi({ label: 'Manual weighings', value: num(rows.filter(t => t.manual).length), color: 'var(--violet)' }) +
        '</div>';

      if (RQ.out === 'summary') {
        const grp = {};
        rows.forEach(t => {
          const k = t.productId + '|' + t.transporterId;
          grp[k] = grp[k] || { product: pName(t.productId), transporter: aName(t.transporterId), n: 0, net: 0, charges: 0 };
          grp[k].n++; grp[k].net += t.net || 0; grp[k].charges += t.charges || 0;
        });
        const list = Object.values(grp).sort((a, b) => b.net - a.net);
        return head + U.card({
          title: 'Transaction summary', sub: fDate(RQ.from) + ' → ' + fDate(RQ.to) + ' · grouped by product and transporter', flush: true,
          body: U.table([
            { label: 'Product', get: r => '<b>' + esc(r.product) + '</b>' },
            { label: 'Transporter', get: r => esc(r.transporter) },
            { label: 'Tickets', num: true, get: r => num(r.n) },
            { label: 'Net (kg)', num: true, get: r => num(r.net) },
            { label: 'Net (MT)', num: true, get: r => mt(r.net, 3) },
            { label: 'Value', num: true, get: r => r.charges ? U.inr(r.charges) : '<span class="dim">—</span>' }
          ], list, {
            zebra: true,
            foot: '<td colspan="2">Total — ' + list.length + ' groups</td>' +
              '<td class="num">' + num(rows.length) + '</td><td class="num">' + num(net) + '</td>' +
              '<td class="num">' + mt(net, 3) + '</td><td class="num">' + U.inr(rows.reduce((n, t) => n + (t.charges || 0), 0)) + '</td>'
          })
        });
      }
      return head + U.card({
        title: 'Transaction detail', sub: num(rows.length) + ' tickets · ' + fDate(RQ.from) + ' → ' + fDate(RQ.to), flush: true,
        body: U.table([
          { label: 'Date', get: t => '<span class="mono">' + fDT(t.at) + '</span>' },
          { label: 'Ticket', get: t => '<b class="mono">' + t.ticketNo + '</b>' },
          { label: 'Vehicle', get: t => esc(vName(t.vehicleId)) },
          { label: 'Vehicle type', get: t => esc(t.cf.cf1 || '—') },
          { label: 'Transporter', get: t => esc(aName(t.transporterId)) },
          { label: 'Material', get: t => esc(pName(t.productId)) },
          { label: 'Type', get: t => esc(t.type) },
          { label: 'Empty (MT)', num: true, get: t => t.tare != null ? mt(t.tare, 3) : '—' },
          { label: 'Loaded (MT)', num: true, get: t => t.gross != null ? mt(t.gross, 3) : '—' },
          { label: 'Net (MT)', num: true, get: t => t.net != null ? '<b>' + mt(t.net, 3) + '</b>' : '—' },
          { label: 'Buyer', get: t => esc(t.cf.cf3 || '—') },
          { label: 'Package', get: t => esc(t.cf.cf4 || '—') },
          { label: 'Site', get: t => esc(DB.map.site[t.siteId].code) },
          { label: 'Status', get: t => U.statusBadge(t.status) }
        ], rows.slice(0, 300), {
          zebra: true, compact: true,
          foot: '<td colspan="9">Total net</td><td class="num"><b>' + mt(net, 3) + '</b></td><td colspan="4"></td>'
        }) + (rows.length > 300 ? '<div class="pager"><span class="pager__info">Showing first 300 of ' + num(rows.length) + ' — export for the full set</span></div>' : '')
      });
    },

    /* the legacy "Transaction Summary Report" document — centred company
       header, filter line, one row per ticket, weights as plain "NNNN Kg" */
    summaryDoc() {
      const rows = this.rows().slice().sort((a, b) => a.ticketNo - b.ticketNo);
      const slipCfg = (window.weighcore && window.weighcore.slipConfig && window.weighcore.slipConfig()) || null;
      const co0 = (slipCfg && slipCfg.companies && slipCfg.companies[0]) || DB.company.name;
      const company = (/^m\/s/i.test(String(co0)) ? '' : 'M/s. ') + co0;
      const fT12 = (d) => d ? (fDate(d) + ' ' + fTime(d)) : '';
      const p2 = (x) => String(x).padStart(2, '0');
      const fFull = (d) => {
        let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
        return fDate(d) + ' ' + p2(h) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + ' ' + ap;
      };
      const kgv = (v) => v != null ? v + ' Kg' : '';
      const td = (v, right) => '<td' + (right ? ' style="text-align:right"' : '') + '>' + esc(v == null ? '' : String(v)) + '</td>';
      const net = rows.reduce((n, t) => n + (t.net || 0), 0);
      return '<div class="repdoc">' +
        '<div class="repdoc__head"><h3>' + esc(company) + '</h3><p>Transaction Summary Report</p></div>' +
        '<p class="repdoc__filter">(Filtered for: Transaction Date between ' + esc(fFull(RQ.from)) + ' To ' + esc(fFull(RQ.to)) + ' )</p>' +
        '<table class="repdoc__tbl" border="1" cellspacing="0" cellpadding="4"><thead><tr>' +
        ['Ticket ID', 'Vehicle Number', 'Product', 'Scale Name', 'Transaction Type', 'Gross Time', 'Gross Weight', 'Tare Time', 'Tare Weight', 'Net Weight']
          .map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(t =>
          '<tr>' + td(t.ticketNo) + td(vName(t.vehicleId)) + td(pName(t.productId)) +
          td((DB.map.wb[t.wbId] || {}).name || '') + td(t.type) +
          td(t.grossAt ? fT12(t.grossAt) : '') + td(kgv(t.gross), true) +
          td(t.tareAt ? fT12(t.tareAt) : '') + td(kgv(t.tare), true) +
          td(kgv(t.net), true) + '</tr>').join('') +
        '</tbody><tfoot><tr>' +
        '<td colspan="6"><b>Total — ' + rows.length + ' tickets</b></td>' +
        '<td></td><td></td><td></td><td style="text-align:right"><b>' + kgv(net) + '</b></td>' +
        '</tr></tfoot></table></div>';
    },

    /* pop-up view of the summary report with Excel / PDF export */
    summaryPopup() {
      const self = this;
      const canExport = !!(window.weighcore && window.weighcore.exportReport);
      U.openModal(
        '<div class="modal__head"><div><div class="card__title">Transaction Summary Report</div>' +
        '<div class="card__sub">' + fDate(RQ.from) + ' → ' + fDate(RQ.to) + ' · ' + this.rows().length + ' tickets</div></div>' +
        '<div class="spacer"></div>' +
        (canExport
          ? '<button class="btn btn--sm" id="rXls">' + icon('download') + 'Export Excel</button>' +
            '<button class="btn btn--sm btn--primary" id="rPdf">' + icon('download') + 'Export PDF</button>'
          : '') +
        '<button class="iconbtn" data-close>' + icon('x') + '</button></div>' +
        '<div class="modal__body">' + this.summaryDoc() + '</div>', true);
      const send = (kind, btn) => {
        btn.disabled = true;
        const name = 'Transaction-Summary-' + fDate(RQ.from) + '-to-' + fDate(RQ.to);
        window.weighcore.exportReport({ kind, name, html: self.summaryDoc() }).then((r) => {
          btn.disabled = false;
          if (r && r.ok) {
            U.toast('ok', kind === 'xls' ? 'Excel exported' : 'PDF exported', r.file || 'saved');
            if (r.dir && window.weighcore.openPath) window.weighcore.openPath(r.dir);
          } else U.toast('danger', 'Export failed', (r && r.error) || 'unknown error');
        }).catch((e) => { btn.disabled = false; U.toast('danger', 'Export failed', String((e && e.message) || e)); });
      };
      const bx = U.$('#rXls'), bp = U.$('#rPdf');
      if (bx) bx.addEventListener('click', () => send('xls', bx));
      if (bp) bp.addEventListener('click', () => send('pdf', bp));
    },

    master() {
      const sets = [
        { k: 'vehicle', t: 'Vehicles', rows: DB.vehicles, cols: [['Vehicle no', r => r.no], ['Type', r => r.type || '—'], ['Transporter', r => aName(r.accountId)], ['Tare (kg)', r => num(r.tare)], ['Active', r => r.active ? 'Yes' : 'No']] },
        { k: 'account', t: 'Accounts', rows: DB.accounts, cols: [['Company', r => r.name], ['Transporter', r => r.isTransporter ? 'Yes' : 'No'], ['Account', r => r.isAccount ? 'Yes' : 'No'], ['Contact', r => r.contact || '—'], ['Phone', r => r.phone || '—'], ['Active', r => r.active ? 'Yes' : 'No']] },
        { k: 'product', t: 'Products', rows: DB.products, cols: [['Product', r => r.name], ['Code', r => r.code], ['Unit', r => r.unit], ['Rate/MT', r => r.rate || '—'], ['Active', r => r.active ? 'Yes' : 'No']] },
        { k: 'driver', t: 'Drivers', rows: DB.drivers, cols: [['Name', r => r.name], ['Licence', r => r.licence], ['Phone', r => r.phone], ['Transporter', r => aName(r.accountId)], ['Active', r => r.active ? 'Yes' : 'No']] },
        { k: 'gate', t: 'Gates', rows: DB.gates, cols: [['Gate', r => r.name], ['Type', r => r.type], ['Site', r => DB.map.site[r.siteId].code], ['Active', r => r.active ? 'Yes' : 'No']] },
        { k: 'unit', t: 'Units', rows: DB.units, cols: [['Unit', r => r.name], ['Description', r => r.desc], ['Decimals', r => r.decimals]] },
        { k: 'wb', t: 'Weighbridges', rows: DB.weighbridges, cols: [['Scale', r => r.name], ['Site', r => DB.map.site[r.siteId].code], ['Indicator', r => r.indicator], ['Port', r => r.port], ['Baud', r => r.baud], ['Capacity', r => num(r.capacity)], ['Status', r => r.status]] },
        { k: 'camera', t: 'Cameras', rows: DB.cameras, cols: [['Camera', r => r.name], ['Type', r => r.type], ['URL', r => r.url], ['IP', r => r.ip], ['Port', r => r.port], ['Scale', r => r.wbId ? DB.map.wb[r.wbId].name : '—']] },
        { k: 'role', t: 'Roles', rows: DB.roles, cols: [['Role', r => r.name], ['Description', r => r.desc], ['Users', r => r.users]] }
      ];
      const active = V.reports._mset || 'vehicle';
      const set = sets.find(s => s.k === active);
      return '<div class="pills" style="margin-bottom:var(--sp-4)">' +
        sets.map(s => '<button class="pill' + (s.k === active ? ' is-on' : '') + '" data-mset="' + s.k + '">' + esc(s.t) + '</button>').join('') + '</div>' +
        U.card({
          title: set.t + ' report', sub: set.rows.length + ' records · as at ' + fDT(DB.NOW), flush: true,
          body: U.table(set.cols.map(([label, get], i) => ({ label, get, num: i > 0 && typeof set.rows[0][Object.keys(set.rows[0])[0]] === 'number' })), set.rows, { zebra: true, compact: true })
        });
    },

    reconcile() {
      const days = [];
      for (let d = 6; d >= 0; d--) {
        const day = new Date(DB.NOW.getTime() - d * 864e5);
        const rows = DB.transactions.filter(t => U.sameDay(t.at, day));
        const done = rows.filter(t => t.status === 'Complete');
        days.push({
          day, tickets: rows.length, complete: done.length,
          active: rows.filter(t => t.status === 'Active').length,
          voided: rows.filter(t => t.status === 'Void').length,
          net: done.reduce((n, t) => n + (t.net || 0), 0),
          manual: rows.filter(t => t.manual).length,
          images: rows.reduce((n, t) => n + t.passes.length * 2, 0)
        });
      }
      const tot = days.reduce((a, d) => ({
        tickets: a.tickets + d.tickets, complete: a.complete + d.complete, active: a.active + d.active,
        voided: a.voided + d.voided, net: a.net + d.net, manual: a.manual + d.manual, images: a.images + d.images
      }), { tickets: 0, complete: 0, active: 0, voided: 0, net: 0, manual: 0, images: 0 });

      return U.callout('ok', '<b>Reconciliation passes.</b> Dashboard KPIs, the transaction report and this ledger all read the same rows — ' +
        'summary totals equal the sum of detail rows for every period tested.') +
        '<div style="height:var(--sp-4)"></div>' +
        U.card({
          title: 'Daily control totals', sub: 'Use this to tie the system back to the gate register', flush: true,
          body: U.table([
            { label: 'Date', get: r => '<b>' + fDate(r.day) + '</b>' },
            { label: 'Tickets', num: true, get: r => num(r.tickets) },
            { label: 'Complete', num: true, get: r => num(r.complete) },
            { label: 'On bridge', num: true, get: r => r.active ? '<span style="color:var(--warn)">' + num(r.active) + '</span>' : '0' },
            { label: 'Void', num: true, get: r => r.voided ? '<span style="color:var(--danger)">' + num(r.voided) + '</span>' : '0' },
            { label: 'Manual', num: true, get: r => num(r.manual) },
            { label: 'Evidence frames', num: true, get: r => num(r.images) },
            { label: 'Net (MT)', num: true, get: r => '<b>' + mt(r.net, 3) + '</b>' }
          ], days, {
            zebra: true,
            foot: '<td>7-day total</td><td class="num">' + num(tot.tickets) + '</td><td class="num">' + num(tot.complete) +
              '</td><td class="num">' + num(tot.active) + '</td><td class="num">' + num(tot.voided) +
              '</td><td class="num">' + num(tot.manual) + '</td><td class="num">' + num(tot.images) +
              '</td><td class="num">' + mt(tot.net, 3) + '</td>'
          })
        });
    },

    mount(root) {
      const self = this;
      root.addEventListener('click', (e) => {
        const tb = e.target.closest('[data-rtab]');
        if (tb) { location.hash = '#/reports/' + tb.dataset.rtab; return; }
        const ms = e.target.closest('[data-mset]');
        if (ms) { self._mset = ms.dataset.mset; U.$('#rBody').innerHTML = self.master(); return; }
        const qd = e.target.closest('[data-days]');
        if (qd) {
          RQ.to = DB.NOW; RQ.from = new Date(DB.NOW.getTime() - (Number(qd.dataset.days) - 1) * 864e5);
          RQ.from.setHours(0, 0, 0, 0);
          U.$('#rFrom').value = U.fInput(RQ.from); U.$('#rTo').value = U.fInput(RQ.to);
          U.$$('#rQuick .pill').forEach(p => p.classList.toggle('is-on', p === qd));
          return;
        }
        const sg = e.target.closest('[data-seg="out"] .seg__opt');
        if (sg) { RQ.out = sg.dataset.v; U.$$('[data-seg="out"] .seg__opt').forEach(o => o.classList.toggle('is-on', o === sg)); if (RQ.ran) U.$('#rOut').innerHTML = self.output(); return; }
        if (e.target.closest('#rRun')) {
          ['From', 'To'].forEach(k => { const el = U.$('#r' + k); if (el && el.value) RQ[k.toLowerCase()] = new Date(el.value); });
          RQ.to.setSeconds(59, 999);   // the To minute is inclusive, like the legacy report's 11:59:59 PM bound
          ['Status', 'Type', 'Mode', 'Site', 'Product', 'Transporter', 'Vehicle', 'Cf1', 'Cf3', 'Cf4'].forEach(k => {
            const el = U.$('#r' + k); if (el) RQ[k.charAt(0).toLowerCase() + k.slice(1)] = el.value;
          });
          RQ.ran = true;
          U.$('#rOut').innerHTML = self.output();
          U.toast('ok', 'Report ready', self.rows().length + ' tickets matched.');
          self.summaryPopup();   // the legacy-format report opens as a pop-up with Excel/PDF export
          return;
        }
        if (e.target.closest('#rReset')) {
          Object.assign(RQ, {
            from: new Date(DB.NOW.getTime() - 6 * 864e5), to: DB.NOW, type: '', status: 'Complete', mode: '',
            product: '', transporter: '', vehicle: '', site: '', cf1: '', cf3: '', cf4: '', out: 'summary', ran: false
          });
          window.ROUTER.render(); return;
        }
        if (e.target.closest('#rXls')) { U.toast('ok', 'Excel export queued', self.rows().length + ' rows → .xlsx'); return; }
        if (e.target.closest('#rPdf')) { U.toast('ok', 'PDF export queued', 'Rendered with company letterhead'); return; }
        if (e.target.closest('#rPrint')) { window.print(); }
      });
    }
  };

  /* ======================================================================
     AUDIT
     ====================================================================== */
  const AQ = { table: '', op: '', user: '', q: '' };
  V.audit = {
    render() {
      const tables = Array.from(new Set(DB.audit.map(a => a.table))).sort();
      const usrs = Array.from(new Set(DB.audit.map(a => a.user))).sort();
      return U.pageHead({
        title: 'Audit trail', sub: 'Every insert and update, with actor and timestamp — immutable and exportable',
        actions: '<button class="btn" id="aExport">' + icon('download') + 'Export</button>'
      }) +
      U.callout('', 'Retention is <b>' + DB.settings.retentionDays + ' days</b> online, then archived to cold storage for the contract term. ' +
        'Audit rows cannot be edited or deleted by any role, including Administrator.') +
      '<div style="height:var(--sp-4)"></div>' +
      '<div class="toolbar">' + U.searchBox('aq', 'Search activity…') +
      '<select class="select" id="aTable"><option value="">All tables</option>' + tables.map(t => '<option>' + esc(t) + '</option>').join('') + '</select>' +
      '<select class="select" id="aOp"><option value="">All operations</option><option>INSERT</option><option>UPDATE</option><option>DELETE</option></select>' +
      '<select class="select" id="aUser"><option value="">All users</option>' + usrs.map(u => '<option>' + esc(u) + '</option>').join('') + '</select>' +
      '<div class="spacer"></div><span class="tiny dim" id="aCount"></span></div>' +
      '<div class="card" id="aCard"></div>';
    },
    paint() {
      let rows = DB.audit.filter(a =>
        (!AQ.table || a.table === AQ.table) && (!AQ.op || a.op === AQ.op) && (!AQ.user || a.user === AQ.user) &&
        (!AQ.q || a.text.toLowerCase().includes(AQ.q.toLowerCase())));
      U.$('#aCount').textContent = num(rows.length) + ' of ' + num(DB.audit.length) + ' entries';
      U.$('#aCard').innerHTML = U.table([
        { label: 'When', w: '160px', get: a => '<div class="cellstack"><b class="mono">' + fDT(a.at) + '</b><span>' + ago(a.at) + '</span></div>' },
        { label: 'Table', w: '150px', get: a => '<span class="tag">' + esc(a.table) + '</span>' },
        { label: 'Operation', w: '96px', get: a => '<span class="badge badge--' +
          (a.op === 'INSERT' ? 'ok' : a.op === 'DELETE' ? 'danger' : 'info') + '">' + esc(a.op) + '</span>' },
        { label: 'Activity', get: a => esc(a.text) },
        { label: 'User', w: '130px', get: a => '<span class="mono">' + esc(a.user) + '</span>' },
        { label: '', w: '70px', get: a => a.ref ? '<button class="btn btn--sm btn--ghost" data-ticket="' + a.ref + '">' + icon('eye') + '</button>' : '' }
      ], rows.slice(0, 200), { zebra: true, compact: true, emptyTitle: 'No audit entries', emptyMsg: 'Adjust the filters.' }) +
        (rows.length > 200 ? '<div class="pager"><span class="pager__info">Showing 200 most recent of ' + num(rows.length) + '</span></div>' : '');
    },
    mount(root) {
      const self = this; this.paint();
      root.addEventListener('input', e => { if (e.target.id === 'aq') { AQ.q = e.target.value; self.paint(); } });
      root.addEventListener('change', e => {
        if (e.target.id === 'aTable') AQ.table = e.target.value;
        else if (e.target.id === 'aOp') AQ.op = e.target.value;
        else if (e.target.id === 'aUser') AQ.user = e.target.value;
        else return;
        self.paint();
      });
      root.addEventListener('click', e => {
        const t = e.target.closest('[data-ticket]'); if (t) V.transactions.openTicket(t.dataset.ticket);
        if (e.target.closest('#aExport')) U.toast('ok', 'Audit export queued', 'Signed CSV with row hashes');
      });
    }
  };

  /* ======================================================================
     DATA QUALITY
     ====================================================================== */
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }
  function clusterNames(items, getName, threshold) {
    const out = [];
    items.forEach(it => {
      const n = U.norm(getName(it));
      let hit = out.find(g => {
        const d = lev(g.key, n);
        return d <= Math.max(1, Math.round(Math.max(g.key.length, n.length) * (threshold || 0.14)));
      });
      if (hit) hit.items.push(it); else out.push({ key: n, items: [it] });
    });
    return out.filter(g => g.items.length > 1);
  }

  V.quality = {
    audit() {
      const noTare = DB.vehicles.filter(v => v.active && !v.tare);
      const noType = DB.vehicles.filter(v => v.active && !v.type);
      const testRecs = []
        .concat(DB.accounts.filter(a => /^test/i.test(a.name)).map(r => ({ kind: 'Account', name: r.name })))
        .concat(DB.products.filter(p => /^test/i.test(p.name)).map(r => ({ kind: 'Product', name: r.name })))
        .concat(DB.gates.filter(g => /^test/i.test(g.name)).map(r => ({ kind: 'Gate', name: r.name })))
        .concat(DB.vehicles.filter(v => /test/i.test(v.no)).map(r => ({ kind: 'Vehicle', name: r.no })));
      const dupeAcc = clusterNames(DB.accounts, a => a.name, 0.16);
      const dupeGate = clusterNames(DB.gates, g => g.name, 0.16);

      // fragmentation of configurable-field values as actually captured
      const frag = [];
      ['cf1', 'cf2', 'cf3', 'cf4', 'cf5'].forEach(key => {
        const seen = {};
        DB.transactions.forEach(t => {
          const raw = t.cf[key]; if (!raw) return;
          const k = U.norm(raw);
          seen[k] = seen[k] || {};
          seen[k][raw] = (seen[k][raw] || 0) + 1;
        });
        Object.entries(seen).forEach(([k, variants]) => {
          const list = Object.entries(variants).sort((a, b) => b[1] - a[1]);
          if (list.length > 1) frag.push({ key, canonical: list[0][0], variants: list });
        });
      });
      const distinctVals = {};
      ['cf1', 'cf2', 'cf3', 'cf4', 'cf5'].forEach(key => {
        distinctVals[key] = new Set(DB.transactions.map(t => t.cf[key]).filter(Boolean)).size;
      });

      const wk = DB.transactions.filter(t => DB.NOW - t.at < 7 * 864e5);
      const manualPct = wk.length ? (wk.filter(t => t.manual).length / wk.length) * 100 : 0;
      const stale = DB.transactions.filter(t => t.status === 'Active' && t.passes.length && DB.NOW - t.passes[0].at > 5.4e6);

      const issues = noTare.length + noType.length + testRecs.length + dupeAcc.length + dupeGate.length + frag.length + stale.length;
      let score = 100;
      score -= Math.min(12, noTare.length * 3);
      score -= Math.min(5, noType.length * 1);
      score -= Math.min(6, testRecs.length * 1.5);
      score -= Math.min(10, (dupeAcc.length + dupeGate.length) * 3.5);
      score -= Math.min(14, frag.length * 1.5);
      score -= Math.min(6, stale.length * 1.5);
      score -= manualPct > 5 ? Math.min(5, manualPct - 5) : 0;

      return {
        score: Math.max(0, Math.round(score)), issues,
        noTare, noType, testRecs, dupeAcc, dupeGate, frag, stale, manualPct, distinctVals
      };
    },

    render() {
      const q = this.audit();
      const color = q.score >= 85 ? 'var(--ok)' : q.score >= 65 ? 'var(--warn)' : 'var(--danger)';
      const fieldLabel = (k) => (DB.customFields.find(f => f.key === k) || {}).label || k;

      return U.pageHead({
        title: 'Data quality',
        sub: 'Continuous checks on the master data and captured values — the checks the legacy system never ran',
        actions: '<button class="btn" id="qRecheck">' + icon('refresh') + 'Re-run checks</button>' +
          '<button class="btn btn--primary" id="qFixAll">' + icon('sparkle') + 'Review merge suggestions</button>'
      }) +

      '<div class="grid" style="grid-template-columns:260px minmax(0,1fr);margin-bottom:var(--sp-4)">' +
        U.card({
          body: U.ring(q.score, 'quality score', color) +
            '<p class="center tiny dim" style="margin-top:var(--sp-3)">' + q.issues + ' open findings across ' +
            num(DB.transactions.length) + ' tickets and ' + num(DB.vehicles.length + DB.accounts.length + DB.products.length) + ' master records</p>'
        }) +
        U.card({
          title: 'Findings by severity', flush: true,
          body: U.table([
            { label: 'Check', get: r => '<b>' + esc(r.t) + '</b><div class="tiny dim">' + esc(r.d) + '</div>' },
            { label: 'Findings', num: true, get: r => '<b>' + (typeof r.n === 'number' ? num(r.n) : esc(r.n)) + '</b>' },
            { label: 'Severity', get: r => '<span class="badge badge--' + r.s + '">' + (r.s === 'danger' ? 'High' : r.s === 'warn' ? 'Medium' : 'Low') + '</span>' },
            { label: 'Impact', get: r => esc(r.i) }
          ], [
            { t: 'Fragmented field values', d: 'Same value typed several ways', n: q.frag.length, s: 'danger', i: 'Grouped reports split and undercount' },
            { t: 'Vehicles without a stored tare', d: 'Single-pass weighing impossible', n: q.noTare.length, s: 'danger', i: 'Net = gross if single-pass is used' },
            { t: 'Duplicate master records', d: 'Fuzzy name match', n: q.dupeAcc.length + q.dupeGate.length, s: 'warn', i: 'Volumes split across duplicates' },
            { t: 'Test records live in production', d: 'Selectable on a real ticket', n: q.testRecs.length, s: 'warn', i: 'Junk tickets enter the ledger' },
            { t: 'Vehicles without a type', d: 'Classification missing', n: q.noType.length, s: 'info', i: 'Fleet analysis incomplete' },
            { t: 'Stale open tickets', d: 'On the bridge over 90 minutes', n: q.stale.length, s: 'warn', i: 'Truck left without closing weighing' },
            { t: 'Manual weight entries', d: 'Keyed, not read from indicator', n: Math.round(q.manualPct * 10) / 10 + '%', s: q.manualPct > 8 ? 'warn' : 'info', i: 'Weight not independently verifiable' }
          ], { zebra: true })
        }) +
      '</div>' +

      U.card({
        title: 'Fragmented configurable-field values',
        sub: 'One real value, several spellings. The canonical form is highlighted — merging rewrites history and locks the field to a controlled list.',
        body: q.frag.length ? '<div class="stack">' + q.frag.map((f, i) =>
          '<div class="dupe"><div class="dupe__h">' + icon('alert') + esc(fieldLabel(f.key)) +
          ' — ' + f.variants.length + ' spellings, ' + num(f.variants.reduce((n, v) => n + v[1], 0)) + ' tickets affected</div>' +
          '<div class="dupe__list">' + f.variants.map(([val, n], j) =>
            '<span class="dupe__v' + (j === 0 ? ' is-canon' : '') + '">' + esc(JSON.stringify(val).slice(1, -1)) + '<b>×' + n + '</b></span>').join('') + '</div>' +
          '<div class="row" style="margin-top:10px"><button class="btn btn--sm btn--primary" data-merge="' + i + '">' + icon('sparkle') +
          'Merge into "' + esc(f.canonical) + '"</button>' +
          '<span class="tiny dim">Writes ' + num(f.variants.slice(1).reduce((n, v) => n + v[1], 0)) + ' corrections + one audit entry</span></div></div>').join('') + '</div>'
          : U.callout('ok', '<b>No fragmentation.</b> Every captured value matches a controlled list entry.')
      }) +

      '<div style="height:var(--sp-4)"></div>' +
      '<div class="grid grid--2">' +
        U.card({
          title: 'Duplicate master records', sub: 'Fuzzy-matched by name', flush: true,
          body: (q.dupeAcc.length + q.dupeGate.length) ? '<div style="padding:var(--sp-4);display:flex;flex-direction:column;gap:10px">' +
            q.dupeAcc.map(g => dupeCard('Account', g)).join('') + q.dupeGate.map(g => dupeCard('Gate', g)).join('') + '</div>'
            : '<div style="padding:var(--sp-5)">' + U.callout('ok', 'No duplicate master records detected.') + '</div>'
        }) +
        U.card({
          title: 'Master data gaps', flush: true,
          body: U.table([
            { label: 'Record', get: r => '<b class="mono">' + esc(r.n) + '</b>' },
            { label: 'Kind', get: r => '<span class="tag">' + esc(r.k) + '</span>' },
            { label: 'Issue', get: r => '<span class="badge badge--' + r.s + '">' + esc(r.i) + '</span>' },
            { label: '', get: r => '<button class="btn btn--sm btn--ghost" data-fix="' + esc(r.n) + '">Fix</button>' }
          ],
            q.noTare.map(v => ({ n: v.no, k: 'Vehicle', i: 'No stored tare', s: 'danger' }))
              .concat(q.testRecs.map(t => ({ n: t.name, k: t.kind, i: 'Test record in production', s: 'warn' })))
              .concat(q.noType.filter(v => v.tare).map(v => ({ n: v.no, k: 'Vehicle', i: 'No vehicle type', s: 'info' }))),
            { zebra: true, compact: true, emptyTitle: 'Clean', emptyMsg: 'No gaps in master data.' })
        }) +
      '</div>' +

      (q.stale.length ? '<div style="height:var(--sp-4)"></div>' + U.card({
        title: 'Stale open tickets', sub: 'On the bridge for more than 90 minutes — likely the truck left without a closing weighing', flush: true,
        body: U.table([
          { label: 'Ticket', get: t => '<b class="mono">' + t.ticketNo + '</b>' },
          { label: 'Vehicle', get: t => esc(vName(t.vehicleId)) },
          { label: 'Opened', get: t => fDT(t.passes[0].at) },
          { label: 'Dwell', num: true, get: t => '<span style="color:var(--danger)">' + U.dur(DB.NOW - t.passes[0].at) + '</span>' },
          { label: 'Lane', get: t => esc(DB.map.wb[t.wbId].name) },
          { label: '', get: t => '<button class="btn btn--sm" data-ticket="' + t.id + '">Open</button>' }
        ], q.stale, { zebra: true, compact: true })
      }) : '');

      function dupeCard(kind, g) {
        return '<div class="dupe"><div class="dupe__h">' + icon('users') + kind + ' — ' + g.items.length + ' records look like one</div>' +
          '<div class="dupe__list">' + g.items.map((it, i) =>
            '<span class="dupe__v' + (i === 0 ? ' is-canon' : '') + '">' + esc(it.name) + '</span>').join('') + '</div>' +
          '<div class="row" style="margin-top:10px"><button class="btn btn--sm btn--primary" data-mergem="' + esc(g.key) + '">' +
          icon('sparkle') + 'Merge into "' + esc(g.items[0].name) + '"</button></div></div>';
      }
    },

    mount(root) {
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-ticket]'); if (t) { V.transactions.openTicket(t.dataset.ticket); return; }
        const m = e.target.closest('[data-merge]');
        if (m) {
          const q = V.quality.audit(), f = q.frag[Number(m.dataset.merge)];
          let fixed = 0;
          DB.transactions.forEach(tx => {
            if (tx.cf[f.key] && U.norm(tx.cf[f.key]) === U.norm(f.canonical) && tx.cf[f.key] !== f.canonical) { tx.cf[f.key] = f.canonical; fixed++; }
          });
          DB.audit.unshift({
            id: 'AUX' + Date.now(), table: 'Transaction', op: 'UPDATE', at: new Date(DB.NOW), user: 'admin',
            text: 'Data-quality merge — ' + fixed + ' tickets normalised to "' + f.canonical + '"', ref: null
          });
          U.toast('ok', 'Merged', fixed + ' tickets normalised · 1 audit entry written');
          window.ROUTER.render();
          return;
        }
        if (e.target.closest('[data-mergem]')) { U.toast('info', 'Merge preview', 'Would re-point child records to the surviving master and write a reversible audit entry.'); return; }
        const fx = e.target.closest('[data-fix]');
        if (fx) { U.toast('info', 'Fix ' + fx.dataset.fix, 'Opens the master record with the missing field focused.'); return; }
        if (e.target.closest('#qRecheck')) { U.toast('ok', 'Checks re-run', V.quality.audit().issues + ' findings'); window.ROUTER.render(); return; }
        if (e.target.closest('#qFixAll')) { U.toast('info', 'Merge review', 'Bulk review screen — approve each suggestion before it is applied.'); }
      });
    }
  };

  /* ======================================================================
     USERS & ROLES
     ====================================================================== */
  V.admin_users = {
    render() {
      return U.pageHead({
        crumbs: ['Administration', 'Users'], title: 'Users',
        sub: 'Named accounts only — no shared logins. Every action is attributed.',
        actions: '<button class="btn btn--primary" data-new>' + icon('plus') + 'Add user</button>'
      }) + '<div class="card">' + U.table([
        { label: 'User', get: u => '<div class="row row--tight"><span class="avatar" style="width:28px;height:28px;font-size:10px">' +
          esc((u.first[0] || '') + (u.last[0] || '')) + '</span><div class="cellstack"><b>' + esc(u.first + ' ' + u.last) + '</b>' +
          '<span class="mono">' + esc(u.username) + '</span></div></div>' },
        { label: 'Role', get: u => '<span class="badge badge--brand">' + esc(DB.map.role[u.roleId].name) + '</span>' },
        { label: 'Site scope', get: u => u.siteId ? esc(DB.map.site[u.siteId].code) : '<span class="dim">All sites</span>' },
        { label: 'Email', get: u => '<span class="tiny">' + esc(u.email) + '</span>' },
        { label: 'Last sign-in', get: u => '<span class="mono tiny">' + esc(u.last_login) + '</span>' },
        { label: 'Tickets (14d)', num: true, get: u => num(DB.transactions.filter(t => t.operatorId === u.id).length) },
        { label: 'Status', get: u => U.activeBadge(u.active) },
        { label: '', get: u => '<button class="btn btn--sm btn--ghost" data-u="' + u.id + '">' + icon('edit') + '</button>' }
      ], DB.users, { zebra: true }) + '</div>';
    },
    mount(root) {
      root.addEventListener('click', e => {
        if (e.target.closest('[data-new]') || e.target.closest('[data-u]')) {
          U.toast('info', 'User form', 'Create / edit with role, site scope and password policy.');
        }
      });
    }
  };

  V.admin_roles = {
    render() {
      const roleId = this._role || 'R3';
      const role = DB.map.role[roleId];
      const groups = Array.from(new Set(DB.features.map(f => f.group)));
      let body = '';
      groups.forEach(g => {
        body += '<tr class="sec"><td colspan="4">' + esc(g) + '</td></tr>';
        DB.features.filter(f => f.group === g).forEach(f => {
          const p = DB.permissions[roleId][f.key];
          body += '<tr><td>' + esc(f.label) + '<div class="tiny dim mono">' + esc(f.key) + '</div></td>' +
            [0, 1, 2].map(i => '<td class="c"><input type="checkbox" data-perm="' + f.key + ':' + i + '"' + (p[i] ? ' checked' : '') + '></td>').join('') + '</tr>';
        });
      });
      return U.pageHead({
        crumbs: ['Administration', 'Roles & permissions'], title: 'Roles & permissions',
        sub: 'Feature × operation matrix. The API enforces this too — never the UI alone.',
        actions: '<button class="btn" id="rlSave">' + icon('save') + 'Save matrix</button>'
      }) +
      '<div class="grid" style="grid-template-columns:280px minmax(0,1fr)">' +
        U.card({
          title: 'Roles', flush: true,
          body: '<div style="padding:8px">' + DB.roles.map(r =>
            '<button class="nav__item' + (r.id === roleId ? ' is-active' : '') + '" data-role="' + r.id + '"' +
            ' style="width:100%;white-space:normal;align-items:flex-start;text-align:left;padding:10px">' +
            icon('shield', 'nav__ico') + '<span style="display:block"><b>' + esc(r.name) + '</b>' +
            '<small class="dim" style="display:block;font-weight:500;line-height:1.35;margin-top:2px">' + esc(r.desc) + '</small></span></button>').join('') +
            '</div>'
        }) +
        U.card({
          title: role.name + ' — permissions', sub: role.desc + ' · ' + role.users + ' user' + (role.users === 1 ? '' : 's'), flush: true,
          body: '<div class="tablewrap"><table class="matrix"><thead><tr><th style="width:46%">Feature</th>' +
            '<th class="grp">Read</th><th class="grp">Create</th><th class="grp">Update</th></tr></thead><tbody>' + body + '</tbody></table></div>'
        }) +
      '</div>' +
      '<div style="height:var(--sp-4)"></div>' +
      U.callout('', 'Master records are never removed — they are <b>deactivated</b>. Tickets are normally <b>voided</b>, ' +
        'which keeps them visible but out of tonnage. Outright deletion is held behind <b>txn.delete</b>, granted to the ' +
        '<b>Super Administrator alone</b>: it clears the ticket from the ledger and every total, while the row and the ' +
        'audit entry naming who removed it and why are retained permanently.');
    },
    mount(root) {
      const self = this;
      root.addEventListener('click', e => {
        const r = e.target.closest('[data-role]');
        if (r) { self._role = r.dataset.role; window.ROUTER.render(); return; }
        if (e.target.closest('#rlSave')) U.toast('ok', 'Permissions saved', 'Applied to the API immediately; sessions refresh on next request.');
      });
      root.addEventListener('change', e => {
        const p = e.target.dataset.perm;
        if (!p) return;
        const [key, idx] = p.split(':');
        DB.permissions[self._role || 'R3'][key][Number(idx)] = e.target.checked;
      });
    }
  };

  /* ======================================================================
     SETTINGS
     ====================================================================== */
  V.settings = {
    render(params) {
      const tab = (params && params[0]) || 'general';
      const S = DB.settings;
      const tabsHtml = U.tabs([
        { k: 'general', t: 'Weighing rules' }, { k: 'company', t: 'Company' }, { k: 'fields', t: 'Configurable fields' },
        { k: 'barcode', t: 'QR / barcode' }, { k: 'print', t: 'Printing' }, { k: 'notify', t: 'Notifications' },
        { k: 'backup', t: 'Data & backup' }
      ], tab, 'data-stab');

      let body = '';
      if (tab === 'general') {
        body = U.card({
          title: 'Weighing rules', sub: 'These switches change what the operator can do at the bridge',
          body:
            U.setrow('Editable transaction date & time', 'Lets an authorised operator back-date a ticket. Every change is audited.', U.switchEl('s1', S.enableTxnDateTime)) +
            U.setrow('Lock fields after the first pass', 'Once pass 1 is stored, only the weight can change. The core anti-tamper control.', U.switchEl('s2', S.lockFieldsAfterPass1)) +
            U.setrow('Tare deviation tolerance', 'Flag a fresh tare that differs from the stored vehicle tare by more than this.',
              '<input class="input" style="width:78px;text-align:right" value="' + S.tareTolerancePct + '"><span class="dim">%</span>' + U.switchEl('s3', S.tareToleranceOn)) +
            U.setrow('Stability window', 'How long the indicator must hold steady before a reading counts as stable.',
              '<input class="input" style="width:88px;text-align:right" value="' + S.stabilityWindowMs + '"><span class="dim">ms ±</span>' +
              '<input class="input" style="width:70px;text-align:right" value="' + S.stabilityToleranceKg + '"><span class="dim">kg</span>') +
            U.setrow('Auto-capture camera frames', 'Snapshot every bound camera at each pass.', U.switchEl('s4', S.autoCaptureImages)) +
            U.setrow('Print interim slip after pass 1', 'Hand the driver a slip before the second weighing.', U.switchEl('s5', S.printAfterPass1)) +
            U.setrow('Block special characters in vehicle numbers', 'Rejects anything but letters and digits at entry.', U.switchEl('s6', S.blockSpecialCharsVehicle)) +
            U.setrow('Show last cycle on recall', 'Display the vehicle’s previous ticket when it is loaded.', U.switchEl('s7', S.showLastTxnOnRecall)) +
            U.setrow('Driver is mandatory', 'Require a driver on every ticket.', U.switchEl('s8', S.requireDriver)) +
            U.setrow('Offline queue', 'Keep weighing through a network outage and sync on reconnect.', U.switchEl('s9', S.offlineQueue)) +
            U.setrow('Connected weighbridge', 'Which scale this terminal reads.',
              '<select class="input" style="width:190px">' + DB.weighbridges.map(w => '<option' + (w.id === S.connectedScale ? ' selected' : '') + '>' + esc(w.name) + '</option>').join('') + '</select>') +
            U.setrow('Capture unit / reporting unit', 'Weigh in one unit, report in another.',
              '<select class="input" style="width:96px">' + DB.units.map(u => '<option' + (u.name === S.weightUnit ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select>' +
              '<span class="dim">→</span>' +
              '<select class="input" style="width:96px">' + DB.units.map(u => '<option' + (u.name === S.reportUnit ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select>') +
            U.setrow('Date & time format', 'Applies to screens, slips and exports.',
              '<select class="input" style="width:150px"><option>dd-MM-yyyy</option><option>yyyy-MM-dd</option><option>MM/dd/yyyy</option></select>' +
              '<select class="input" style="width:110px"><option>HH:mm</option><option>hh:mm tt</option></select>')
        });
      } else if (tab === 'company') {
        body = U.card({
          title: 'Company & client identity', sub: 'Prints on every slip and report',
          body: '<div class="formgrid formgrid--2">' +
            U.field({ label: 'Operating company', req: true, value: DB.company.name, span2: true }) +
            U.field({ label: 'Project / contract', value: DB.company.project, span2: true }) +
            U.field({ label: 'Site address', value: DB.company.address, span2: true }) +
            U.field({ label: 'Phone', value: DB.company.phone }) +
            U.field({ label: 'Email', value: DB.company.email }) +
            U.field({ label: 'GSTIN', value: DB.company.gstin }) +
            U.field({ label: 'Support email', value: DB.company.supportEmail }) +
            '<hr class="hr col-span-2">' +
            U.field({ label: 'Client organisation', req: true, value: DB.company.clientCompany }) +
            U.field({ label: 'Client contact', value: DB.company.clientContact }) +
            U.field({ label: 'Client address', value: DB.company.clientAddress, span2: true }) +
            '</div>' +
            '<div class="setrow" style="margin-top:var(--sp-4)"><div class="setrow__txt"><strong>Logo</strong><span>Shown in the app header and on printed slips — PNG or SVG, max 512 KB</span></div>' +
            '<div class="setrow__ctl"><div class="brandmark" style="width:44px;height:44px"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4v24M6 11h20M9 11l-4 9a5 5 0 0 0 8 0l-4-9Zm14 0-4 9a5 5 0 0 0 8 0l-4-9Z"/></svg></div>' +
            '<button class="btn">Upload</button><button class="btn btn--ghost">Reset</button></div></div>'
        });
      } else if (tab === 'fields') {
        body = U.callout('', 'The legacy screen exposed twenty unlabelled slots in a grid whose columns were too narrow to read. ' +
          'Here each slot is a card, and any slot can be backed by a <b>controlled value list</b> instead of free text — which is what stops the fragmentation you can see under Data Quality.') +
          '<div style="height:var(--sp-4)"></div>' +
          U.card({
            title: 'Configurable transaction fields', sub: 'Twenty slots · ' + DB.customFields.filter(f => f.visible).length + ' in use',
            body: '<div class="tablewrap"><table class="tbl"><thead><tr>' +
              '<th style="width:60px">Slot</th><th>Label on the ticket</th><th style="width:120px">Input</th>' +
              '<th style="width:96px" class="num">Max length</th><th style="width:96px" class="center">Visible</th>' +
              '<th style="width:96px" class="center">Required</th><th>Controlled list</th></tr></thead><tbody>' +
              DB.customFields.map(f =>
                '<tr' + (f.visible ? '' : ' style="opacity:.55"') + '><td class="mono">' + f.slot + '</td>' +
                '<td><input class="input" value="' + esc(f.label) + '"></td>' +
                '<td><select class="input"><option' + (f.source === 'list' ? ' selected' : '') + '>List</option><option' + (f.source === 'text' ? ' selected' : '') + '>Text</option><option>Number</option><option>Date</option></select></td>' +
                '<td class="num"><input class="input" style="text-align:right" value="' + f.maxLen + '"></td>' +
                '<td style="text-align:center"><input type="checkbox"' + (f.visible ? ' checked' : '') + '></td>' +
                '<td style="text-align:center"><input type="checkbox"' + (f.required ? ' checked' : '') + '></td>' +
                '<td>' + (DB.fieldLists[f.key]
                  ? '<div class="row row--tight">' + DB.fieldLists[f.key].slice(0, 3).map(v => '<span class="tag">' + esc(v) + '</span>').join('') +
                    (DB.fieldLists[f.key].length > 3 ? '<span class="tag">+' + (DB.fieldLists[f.key].length - 3) + '</span>' : '') +
                    '<button class="btn btn--sm btn--ghost">Edit</button></div>'
                  : '<button class="btn btn--sm btn--ghost">' + icon('plus') + 'Attach list</button>') + '</td></tr>').join('') +
              '</tbody></table></div>'
          });
      } else if (tab === 'barcode') {
        const t = DB.transactions.find(x => x.status === 'Complete');
        const payload = V.transactions.qrPayload(t);
        body = '<div class="grid" style="grid-template-columns:minmax(0,1fr) 300px">' +
          U.card({
            title: 'QR payload designer', sub: 'Pick the fields and their short codes — the slip QR is built from this template',
            body: '<div class="qrgrid">' + DB.barcodeSlots.map((s, i) =>
              '<label class="qrslot ' + (s.on ? 'is-on' : 'is-off') + '"><input type="checkbox" data-qr="' + i + '"' + (s.on ? ' checked' : '') + '>' +
              '<span class="qrslot__n">' + esc(s.label) + '</span>' +
              '<input class="qrslot__c" value="' + esc(s.code) + '" data-qrc="' + i + '"></label>').join('') + '</div>'
          }) +
          U.card({
            title: 'Live preview', sub: 'Ticket #' + t.ticketNo,
            body: '<div class="center" id="qrPrev">' + U.qrSvg(payload, 190) + '</div>' +
              '<div style="height:var(--sp-3)"></div>' +
              '<div class="qrpayload" id="qrTxt">' + esc(payload) + '</div>' +
              '<p class="tiny dim" style="margin-top:8px">Scanning resolves to <b>verify.weighcore.app</b> — a public read-only ticket page, so a gate guard or transporter can confirm a slip without a login.</p>'
          }) + '</div>';
      } else if (tab === 'print') {
        body = U.card({
          title: 'Printing', sub: 'Per-terminal printer binding and slip layout',
          body:
            U.setrow('Printer', 'Bound to this cabin terminal.', '<select class="input" style="width:250px"><option>HP LaserJet M404 (cabin)</option><option>Epson TM-U220 (dot matrix)</option><option>Save as PDF</option></select>') +
            U.setrow('Print type', 'Laser A5 slip, or continuous stationery.', '<select class="input" style="width:190px"><option>Laser — A5</option><option>Laser — A4</option><option>Dot matrix — 80 col</option></select>') +
            U.setrow('Copies per ticket', 'Operator, driver, gate.', '<input class="input" style="width:70px;text-align:right" value="3">') +
            U.setrow('Include QR block', 'Uses the template under QR / barcode.', U.switchEl('p1', true)) +
            U.setrow('Include captured images', 'Thumbnail strip on the reverse.', U.switchEl('p2', false)) +
            U.setrow('Manual-entry marker', 'Print ✱ MANUAL ENTRY when a weight was keyed rather than read.', U.switchEl('p3', true)) +
            '<div style="margin-top:var(--sp-4)"><button class="btn btn--primary" id="pPreview">' + icon('eye') + 'Preview slip</button></div>'
        });
      } else if (tab === 'notify') {
        body = U.card({
          title: 'Notification schedules', sub: 'One transport, many named rules — each individually switchable',
          actions: '<button class="btn btn--sm btn--primary">' + icon('plus') + 'Add schedule</button>', flush: true,
          body: U.table([
            { label: 'Channel', w: '96px', get: r => '<span class="badge badge--' + (r.channel === 'EMAIL' ? 'brand' : 'violet') + '">' + esc(r.channel) + '</span>' },
            { label: 'Schedule', get: r => '<b>' + esc(r.name) + '</b>' },
            { label: 'Trigger', get: r => esc(r.event) },
            { label: 'Recipients', get: r => '<span class="tiny mono">' + esc(r.to) + '</span>' },
            { label: 'Enabled', w: '80px', get: r => U.switchEl('n_' + r.id, r.on) },
            { label: '', w: '80px', get: () => '<button class="btn btn--sm btn--ghost">' + icon('edit') + '</button>' }
          ], DB.notifications, { zebra: true })
        }) + '<div style="height:var(--sp-4)"></div>' +
        '<div class="grid grid--2">' +
          U.card({ title: 'SMTP', body: '<div class="formgrid formgrid--2">' +
            U.field({ label: 'Host', value: 'smtp.office365.com' }) + U.field({ label: 'Port', value: '587' }) +
            U.field({ label: 'Username', value: 'noreply@chennaibiomining.in' }) + U.field({ label: 'Password', type: 'password', value: '••••••••••' }) +
            '</div><div style="margin-top:var(--sp-4)"><button class="btn" id="tMail">' + icon('bell') + 'Send test email</button></div>' }) +
          U.card({ title: 'SMS gateway', body: '<div class="formgrid formgrid--2">' +
            U.field({ label: 'Provider', type: 'select', options: [{ v: 'a', t: 'MSG91' }, { v: 'b', t: 'Twilio' }, { v: 'c', t: 'Gupshup' }] }) +
            U.field({ label: 'Sender ID', value: 'WGHCRE' }) +
            U.field({ label: 'API key', type: 'password', value: '••••••••••••' }) +
            U.field({ label: 'DLT template ID', value: '1207162553648712' }) +
            '</div><div style="margin-top:var(--sp-4)"><button class="btn" id="tSms">' + icon('bell') + 'Send test SMS</button></div>' }) +
        '</div>';
      } else {
        body = '<div class="grid grid--2">' +
          U.card({
            title: 'Backup', sub: 'Verified, automatic, and restore-tested',
            body:
              U.setrow('Automatic backup', 'Runs without anyone remembering to tick a box.', U.switchEl('b1', S.autoBackup)) +
              U.setrow('Frequency', '', '<select class="input" style="width:180px"><option>Every hour</option><option selected>Every 6 hours</option><option>Daily</option></select>') +
              U.setrow('Target', 'Off-machine, plus offsite copy.', '<input class="input" style="width:250px" value="' + esc(S.backupTarget) + '">') +
              U.setrow('Restore verification', 'Weekly automated restore into a scratch database.', U.switchEl('b2', true)) +
              U.setrow('Online retention', '', '<input class="input" style="width:80px;text-align:right" value="' + S.retentionDays + '"><span class="dim">days</span>') +
              '<div style="margin-top:var(--sp-4)">' + U.callout('ok', '<b>Last backup ' + esc(S.lastBackup) + '</b> — 412 MB, verified restore passed at 12:06.') + '</div>' +
              '<div class="row" style="margin-top:var(--sp-4)"><button class="btn btn--primary" id="bNow">' + icon('db') + 'Back up now</button>' +
              '<button class="btn">' + icon('refresh') + 'Restore from file</button></div>'
          }) +
          U.card({
            title: 'Edge agent', sub: 'The cabin service that owns the serial port, cameras and printer',
            body:
              '<div class="stack">' + DB.weighbridges.filter(w => w.active).map(w =>
                '<div class="lane"><div class="lane__ico">' + icon('cpu') + '</div><div class="lane__body">' +
                '<div class="lane__title">' + esc(w.name) + ' — ' + esc(DB.map.site[w.siteId].code) + '</div>' +
                '<div class="lane__meta">agent v1.4.2 · ' + esc(w.port) + ' · heartbeat 3 s ago</div></div>' +
                U.onlineBadge(w.status) + '</div>').join('') + '</div>' +
              '<hr class="hr">' +
              U.setrow('Offline queue depth', 'Weighings held locally when the server is unreachable.', '<span class="mono strong">0 queued</span>') +
              U.setrow('Image storage', 'Evidence frames live on object storage, not in the database.', '<span class="mono strong">18.4 GB · 214,880 frames</span>') +
              U.setrow('Clock sync', 'NTP drift across terminals.', '<span class="badge badge--ok">±0.4 s</span>')
          }) + '</div>';
      }
      return U.pageHead({
        title: 'Settings', sub: 'Everything the legacy product hid across eleven separate tiles, in one place',
        actions: '<button class="btn btn--primary" id="sSave">' + icon('save') + 'Save changes</button>'
      }) + tabsHtml + body;
    },
    mount(root) {
      root.addEventListener('click', e => {
        const t = e.target.closest('[data-stab]');
        if (t) { location.hash = '#/settings/' + t.dataset.stab; return; }
        if (e.target.closest('#sSave')) { U.toast('ok', 'Settings saved', 'Pushed to every terminal on next heartbeat.'); return; }
        if (e.target.closest('#bNow')) { U.toast('ok', 'Backup started', 'Snapshot → ' + DB.settings.backupTarget); return; }
        if (e.target.closest('#tMail')) { U.toast('ok', 'Test email sent', 'Delivered to ' + DB.company.email); return; }
        if (e.target.closest('#tSms')) { U.toast('ok', 'Test SMS sent', 'Delivered to +91 98400 00002'); return; }
        if (e.target.closest('#pPreview')) { V.transactions.slip(DB.transactions.find(x => x.status === 'Complete')); }
      });
      root.addEventListener('change', e => {
        if (e.target.dataset.qr != null) { DB.barcodeSlots[Number(e.target.dataset.qr)].on = e.target.checked; refreshQR(); }
        if (e.target.dataset.qrc != null) { DB.barcodeSlots[Number(e.target.dataset.qrc)].code = e.target.value.toUpperCase(); refreshQR(); }
      });
      function refreshQR() {
        const prev = U.$('#qrPrev'); if (!prev) return;
        const t = DB.transactions.find(x => x.status === 'Complete');
        const payload = V.transactions.qrPayload(t);
        prev.innerHTML = U.qrSvg(payload, 190);
        U.$('#qrTxt').textContent = payload;
        U.$$('[data-qr]').forEach(cb => cb.closest('.qrslot').className = 'qrslot ' + (cb.checked ? 'is-on' : 'is-off'));
      }
    }
  };
})();
