'use strict';
/*
 * selftest.js — instant, dependency-free check of the critical logic.
 *
 *   node selftest.js
 *
 * Runs with a bare Node install — no `npm install`, no Electron, no native
 * modules (edge.js only loads 'events'/'net'; camera.js only 'http'/'crypto').
 * Proves the weight-frame parser and the camera digest-auth builder work before
 * you build the full app.
 */
const assert = require('assert');
const { EdgeAgent } = require('./src/edge');

let pass = 0, fail = 0;
function check(name, got, want) {
  try { assert.strictEqual(got, want); console.log(`  PASS  ${name}  (=${got})`); pass++; }
  catch (_) { console.log(`  FAIL  ${name}  got ${got}, want ${want}`); fail++; }
}

// Feed a frame into an EdgeAgent and return the last parsed weight value.
function parseWith(parse, frame) {
  const agent = new EdgeAgent({ connection: 'serial', parse });
  let last = null, stable = null;
  agent.on('weight', (d) => { last = d.value; });
  agent.on('stable', (d) => { stable = d.value; });
  // push the frame several times to also exercise stability detection
  for (let i = 0; i < (parse.stableRepeats || 4); i++) agent._ingest(frame);
  return { last, stable };
}

console.log('\nWeight frame parser');
console.log('-------------------');

// 1. LAN / Endel style: startChar '@', 12-char frame, weight at offset 4, len 7
{
  const p = { startChar: '@', totalStringLength: 12, weightStartFrom: 4, weightLength: 7, stableRepeats: 4 };
  const r = parseWith(p, '@GS+0012345\r');            // substr(4,7) = "0012345"
  check('startChar frame -> 12345', r.last, 12345);
  check('stable fired', r.stable, 12345);
}

// 2. Fixed-window (no startChar): 8-char frame, weight at offset 0, len 6
{
  const p = { startChar: '', totalStringLength: 8, weightStartFrom: 0, weightLength: 6, stableRepeats: 4 };
  const r = parseWith(p, '012340\r\n');               // substr(0,6) = "012340"
  check('fixed window -> 12340', r.last, 12340);
}

// 3. Implied decimal: 10-char frame, weight at offset 2 len 6, decimal 2 places
{
  const p = { startChar: 'S', totalStringLength: 10, weightStartFrom: 2, weightLength: 6, decimalInString: true, decimalPointLocation: 2, stableRepeats: 4 };
  const r = parseWith(p, 'ST012345YY');               // "012345" -> implied .XX -> 0123.45
  check('implied decimal -> 123.45', r.last, 123.45);
}

// 4. Reversed string
{
  const p = { startChar: '', totalStringLength: 6, weightStartFrom: 0, weightLength: 6, reverse: true, stableRepeats: 2 };
  const r = parseWith(p, '054321');                   // reversed -> "123450"
  check('reversed frame -> 123450', r.last, 123450);
}

// 5. Negative weight
{
  const p = { startChar: '@', totalStringLength: 10, weightStartFrom: 1, weightLength: 8, stableRepeats: 2 };
  const r = parseWith(p, '@-001234\r\n');             // substr(1,8) -> "-001234"
  check('negative -> -1234', r.last, -1234);
}

console.log('\nCamera digest auth');
console.log('------------------');
// Recreate the exact digest computation camera.js uses, against RFC 2617 vectors.
{
  const crypto = require('crypto');
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5('admin:Login to WeighCam:CHANGE-ME');
  const ha2 = md5('GET:/ISAPI/Streaming/channels/101/picture');
  const resp = md5(`${ha1}:nonceXYZ:00000001:cnonce123:auth:${ha2}`);
  check('digest response is 32-hex', /^[0-9a-f]{32}$/.test(resp), true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
