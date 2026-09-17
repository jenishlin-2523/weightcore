import { launch } from './cdp.mjs';
const HERE = 'file:///' + process.cwd().replace(/\\/g, '/') + '/renderer/index.html?user=superadmin';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '\n        -> ' + x : '')); } };
const J = s => JSON.parse(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await launch(9355);
try {
  await b.goto(HERE);
  await b.eval(`location.hash = '#/terminal';`);
  await wait(900);

  // the real WB2 gate master: two active, four retired
  await b.eval(`
    DB.gates = [
      { id:'G12', name:'Package 5 Wb2', type:'BOTH', active:true },
      { id:'G15', name:'Package 5 Wb1', type:'BOTH', active:true },
      { id:'G9',  name:'package-5',     type:'BOTH', active:false },
      { id:'G11', name:'package-5 WB 2',type:'BOTH', active:false },
      { id:'G13', name:'test',          type:'BOTH', active:false },
      { id:'G14', name:'Main Gate',     type:'BOTH', active:false }
    ];
    DB.map.gate = {}; DB.gates.forEach(function(g){ DB.map.gate[g.id] = g; });
    document.querySelector('#btnReset').click();
    return 1;`);
  await wait(600);

  const read = async () => J(await b.eval(`
    var el = document.querySelector('#gate');
    if (!el) return JSON.stringify({ missing: true });
    return JSON.stringify({
      tag: el.tagName,
      opts: Array.prototype.map.call(el.options, function(o){ return o.textContent.trim(); }),
      values: Array.prototype.map.call(el.options, function(o){ return o.value; }),
      value: el.value,
      combo: !!document.querySelector('[data-combo="gate"]'),
      readonly: el.readOnly === true
    });`));

  console.log('=== the Gate field is a dropdown, not a type-ahead ===');
  const g = await read();
  ok('a #gate control exists', !g.missing);
  ok('it is a <select>, not an <input>', g.tag === 'SELECT', 'tag=' + g.tag);
  ok('there is NO type-ahead combo wrapper for gate', g.combo === false);
  console.log('        options: ' + g.opts.join(' | '));
  ok('it offers exactly the two live gates plus the placeholder', g.opts.length === 3,
     g.opts.length + ' options: ' + g.opts.join(' | '));
  ok('Package 5 Wb1 is offered', g.opts.some(t => /Package 5 Wb1/.test(t)));
  ok('Package 5 Wb2 is offered', g.opts.some(t => /Package 5 Wb2/.test(t)));
  ok('the retired gates are NOT offered',
     !g.opts.some(t => /package-5$|package-5 WB 2|test|Main Gate/.test(t)), g.opts.join(' | '));
  // WAS: "nothing is preselected, so the operator must choose".
  // Changed deliberately — the terminal now starts on its OWN gate (defaultGateId),
  // so a wrong gate takes a deliberate change instead of a missed one.
  // Full coverage of the rule and its fallbacks is in test-gate-default.mjs.
  ok('the terminal\'s own gate is preselected', g.value === 'G12', 'value=' + g.value);

  console.log('\n=== a gate cannot be created from the terminal ===');
  const add = J(await b.eval(`
    var txt = document.body.innerText;
    return JSON.stringify({ addRow: /Add gate/i.test(txt),
      anyAddMenu: !!document.querySelector('.combo__add') });`));
  ok('no "Add gate" affordance anywhere on the terminal', add.addRow === false);
  ok('no combo add-row is rendered', add.anyAddMenu === false);

  console.log('\n=== picking a gate updates the ticket ===');
  await b.eval(`
    var s = document.querySelector('#gate');
    s.value = 'G15'; s.dispatchEvent(new Event('change', { bubbles:true })); return 1;`);
  await wait(400);
  ok('selecting Package 5 Wb1 sets the gate', (await b.eval(`return document.querySelector('#gate').value;`)) === 'G15');
  const receipt = await b.eval(`
    var rows = Array.prototype.map.call(document.querySelectorAll('#term .rrow, #term .receipt__row, #term tr'), function(r){ return r.textContent.replace(/\\s+/g,' ').trim(); });
    return rows.filter(function(t){ return /Gate/i.test(t); }).join(' || ');`);
  console.log('        receipt shows: ' + receipt);
  ok('the receipt pane reflects the chosen gate', /Package 5 Wb1/.test(receipt), receipt);

  console.log('\n=== a gate that is retired AFTER being chosen is kept, not silently dropped ===');
  // drive it through the UI: make package-5 live, pick it, then retire it
  await b.eval(`
    DB.map.gate['G9'].active = true;
    (typeof ROUTER !== 'undefined' ? ROUTER : window.ROUTER).render(); return 1;`);
  await wait(700);
  await b.eval(`
    var s = document.querySelector('#gate');
    s.value = 'G9'; s.dispatchEvent(new Event('change', { bubbles:true })); return 1;`);
  await wait(400);
  ok('package-5 could be selected while it was still active',
     (await b.eval(`return document.querySelector('#gate').value;`)) === 'G9');
  await b.eval(`
    DB.map.gate['G9'].active = false;      // retired in Master data while the ticket is open
    (typeof ROUTER !== 'undefined' ? ROUTER : window.ROUTER).render(); return 1;`);
  await wait(800);
  const r2 = await read();
  console.log('        options now: ' + r2.opts.join(' | '));
  ok('the retired gate appears, marked', r2.opts.some(t => /package-5.*retired/i.test(t)), r2.opts.join(' | '));
  ok('and stays selected rather than being cleared', r2.value === 'G9', 'value=' + r2.value);
  ok('the two live gates are still offered', r2.opts.filter(t => /Package 5 Wb/.test(t)).length === 2, r2.opts.join(' | '));

  ok('no errors', b.errors.length === 0, b.errors.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
} catch (e) { console.error('\nHARNESS ERROR: ' + e.message); fail++; }
finally { b.close(); }
process.exit(fail ? 1 : 0);
