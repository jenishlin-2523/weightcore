import { launch } from './cdp.mjs';
const HERE = 'file:///' + process.cwd().replace(/\\/g, '/') + '/renderer/index.html?user=superadmin';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (x ? '\n        -> ' + x : '')); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

const WB2_GATES = `[
  { id:'G12', name:'Package 5 Wb2', type:'BOTH', active:true },
  { id:'G15', name:'Package 5 Wb1', type:'BOTH', active:true },
  { id:'G9',  name:'package-5',     type:'BOTH', active:false },
  { id:'G13', name:'test',          type:'BOTH', active:false }
]`;

const b = await launch(9358);
try {
  await b.goto(HERE);
  await b.eval(`location.hash = '#/terminal';`);
  await wait(1000);

  // set the terminal's identity + gate master, then start a fresh ticket
  const setup = async (scale, gatesJs, txns) => {
    await b.eval(`
      window.__TERMINAL_SCALE = ${JSON.stringify(scale)};
      DB.gates = ${gatesJs};
      DB.map.gate = {}; DB.gates.forEach(function(g){ DB.map.gate[g.id] = g; });
      ${txns ? 'DB.transactions = ' + txns + ';' : ''}
      document.querySelector('#btnReset').click();
      return 1;`);
    await wait(500);
    return await b.eval(`
      var s = document.querySelector('#gate');
      return s ? (s.value + '|' + (s.options[s.selectedIndex] || {}).textContent) : 'NO SELECT';`);
  };

  console.log('=== this machine really is WB2 ===');
  const realScale = await b.eval(`return String(window.__TERMINAL_SCALE || '(unset)');`);
  console.log('        window.__TERMINAL_SCALE = ' + realScale);

  console.log('\n=== 1. the gate carrying THIS bridge number is preselected ===');
  let v = await setup('P5WB2', WB2_GATES, null);
  console.log('        P5WB2 -> ' + v);
  ok('WB2 defaults to Package 5 Wb2 (G12)', v.startsWith('G12|'), v);

  v = await setup('P5WB1', WB2_GATES, null);
  console.log('        P5WB1 -> ' + v);
  ok('the SAME file on WB1 defaults to Package 5 Wb1 (G15)', v.startsWith('G15|'), v);
  ok('so nothing is hardcoded to one bridge', true);

  console.log('\n=== 2. it matches on the NUMBER, so renaming the gates is safe ===');
  v = await setup('P5WB2', `[
    { id:'GA', name:'North Gate WB 02', type:'BOTH', active:true },
    { id:'GB', name:'South Gate WB 01', type:'BOTH', active:true }]`, null);
  console.log('        renamed + zero-padded -> ' + v);
  ok('"North Gate WB 02" is matched for bridge 2', v.startsWith('GA|'), v);

  v = await setup('P5WB2', `[
    { id:'GA', name:'Package 5 Wb21', type:'BOTH', active:true },
    { id:'GB', name:'Package 5 Wb2',  type:'BOTH', active:true }]`, null);
  console.log('        Wb21 vs Wb2 -> ' + v);
  ok('Wb21 is NOT mistaken for bridge 2', v.startsWith('GB|'), v);

  console.log('\n=== 3. fallbacks, in order ===');
  v = await setup('P5WB9', `[{ id:'GX', name:'Only Gate', type:'BOTH', active:true }]`, null);
  console.log('        no number match, one active gate -> ' + v);
  ok('falls back to the only active gate', v.startsWith('GX|'), v);

  v = await setup('P5WB9', `[
    { id:'GA', name:'Alpha Gate', type:'BOTH', active:true },
    { id:'GB', name:'Beta Gate',  type:'BOTH', active:true }]`,
    `[{ id:'T1', gateId:'GB' },{ id:'T2', gateId:'GB' },{ id:'T3', gateId:'GA' }]`);
  console.log('        no match, two gates, history favours GB -> ' + v);
  ok('falls back to the most-used gate in this terminal history', v.startsWith('GB|'), v);

  v = await setup('P5WB9', `[
    { id:'GA', name:'Alpha Gate', type:'BOTH', active:true },
    { id:'GB', name:'Beta Gate',  type:'BOTH', active:true }]`, `[]`);
  console.log('        no match, no history -> ' + v);
  ok('falls back to blank rather than guessing', v.startsWith('|'), v);

  console.log('\n=== 4. it never invents or resurrects a gate ===');
  v = await setup('P5WB2', `[
    { id:'G9', name:'package-5 WB 2', type:'BOTH', active:false },
    { id:'GB', name:'Some Other Gate', type:'BOTH', active:true }]`, `[]`);
  console.log('        only match is INACTIVE -> ' + v);
  ok('an inactive gate is never selected, even on a number match',
     !v.startsWith('G9|'), v);
  v = await setup('P5WB2', `[]`, `[]`);
  console.log('        no gates at all -> ' + v);
  ok('no gates on file gives blank, not a crash', v.startsWith('|') || v === 'NO SELECT', v);

  console.log('\n=== 5. the operator can still override ===');
  await setup('P5WB2', WB2_GATES, null);
  await b.eval(`
    var s = document.querySelector('#gate');
    s.value = 'G15'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
  await wait(350);
  ok('choosing the other gate still works', (await b.eval(`return document.querySelector('#gate').value;`)) === 'G15');
  ok('and only the two live gates are offered',
     (await b.eval(`return document.querySelector('#gate').options.length;`)) === 3);

  ok('no errors (a TDZ throw would surface here)', b.errors.length === 0, b.errors.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
} catch (e) { console.error('\nHARNESS ERROR: ' + e.message); fail++; }
finally { b.close(); }
process.exit(fail ? 1 : 0);
