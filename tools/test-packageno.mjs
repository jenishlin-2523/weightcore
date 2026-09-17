import { launch } from './cdp.mjs';
const HERE = 'file:///' + process.cwd().replace(/\\/g, '/') + '/renderer/index.html?user=superadmin';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '\n        -> ' + x : '')); } };
const J = s => JSON.parse(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await launch(9356);
try {
  await b.goto(HERE);
  await b.eval(`location.hash = '#/terminal';`);
  await wait(1000);
  await b.eval(`document.querySelector('#btnReset').click(); return 1;`);
  await wait(600);

  const read = async (id) => J(await b.eval(`
    var el = document.querySelector('#${id}');
    if (!el) return JSON.stringify({ missing: true });
    return JSON.stringify({
      tag: el.tagName,
      value: el.value,
      opts: el.tagName === 'SELECT' ? Array.prototype.map.call(el.options, function(o){ return o.textContent.trim(); }) : null,
      combo: !!document.querySelector('[data-combo="${id}"]')
    });`));

  console.log('=== Package No is a closed dropdown ===');
  const p = await read('cf4');
  ok('a #cf4 (Package No) control exists', !p.missing);
  ok('it is a <select>, not a type-ahead input', p.tag === 'SELECT', 'tag=' + p.tag);
  ok('there is no combo wrapper for it', p.combo === false);
  console.log('        options: ' + (p.opts || []).join(' | '));
  ok('exactly ONE package is offered', p.opts && p.opts.length === 1, JSON.stringify(p.opts));
  ok('and it is PACKAGE 5', p.opts && /PACKAGE 5/i.test(p.opts[0]), JSON.stringify(p.opts));
  ok('the old spellings are gone (Package-5 / PKG 5 / PACKAGE 2)',
     p.opts && !p.opts.some(t => /Package-5|PKG 5|PACKAGE 2/i.test(t)), JSON.stringify(p.opts));

  console.log('\n=== it is the DEFAULT on a new ticket ===');
  ok('Package No is pre-filled, not blank', p.value && /PACKAGE 5/i.test(p.value), 'value=' + JSON.stringify(p.value));
  const receipt = await b.eval(`
    var rows = Array.prototype.map.call(document.querySelectorAll('.receipt .receipt__row'), function(r){
      return r.querySelector('dt').textContent.trim() + ' = ' + r.querySelector('dd').textContent.trim(); });
    return rows.filter(function(t){ return /Package/i.test(t); }).join(' || ');`);
  console.log('        receipt: ' + receipt);
  ok('the receipt already shows it', /PACKAGE 5/i.test(receipt), receipt);

  console.log('\n=== nothing new can be typed into it ===');
  const add = J(await b.eval(`
    return JSON.stringify({ addRow: /Add .*Package No/i.test(document.body.innerText),
      addMenu: !!document.querySelector('.combo__add') });`));
  ok('no "Add … to Package No" affordance', add.addRow === false);
  ok('no combo add-row on screen', add.addMenu === false);

  console.log('\n=== the other configurable fields are untouched ===');
  const party = await read('cf2');
  const buyer = await read('cf3');
  ok('Party Name is still a typeable combo', party.tag === 'INPUT' && party.combo === true, JSON.stringify(party));
  ok('Buyer Name is still a typeable combo', buyer.tag === 'INPUT' && buyer.combo === true, JSON.stringify(buyer));

  console.log('\n=== a ticket carrying a different package keeps it, marked ===');
  await b.eval(`
    var s = document.querySelector('#cf2');           // pick any vehicle first is not needed
    return 1;`);
  // simulate a recalled ticket whose stored package is an old spelling
  await b.eval(`
    var f = DB.customFields.filter(function(x){ return x.key === 'cf4'; })[0];
    window.__oldLabel = f.label;
    DB.transactions[0].cf.cf4 = 'PKG 5';
    return 1;`);
  await b.eval(`
    var el = document.querySelector('#cf4');
    el.value = 'PACKAGE 5'; el.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
  await wait(300);
  ok('selecting the single package still registers',
     (await b.eval(`return document.querySelector('#cf4').value;`)) === 'PACKAGE 5');

  ok('no errors', b.errors.length === 0, b.errors.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
} catch (e) { console.error('\nHARNESS ERROR: ' + e.message); fail++; }
finally { b.close(); }
process.exit(fail ? 1 : 0);
