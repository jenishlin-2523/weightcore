'use strict';
/*
 * serial-win.js — compile-free serial reader for Windows.
 *
 * Instead of a native addon (serialport), this spawns PowerShell running the
 * built-in .NET System.IO.Ports.SerialPort, which streams the raw bytes back as
 * base64 lines on stdout. No node-gyp, no Visual Studio, no compiler — works on
 * any Windows box that has PowerShell (all of them). Same raw bytes the native
 * module would have delivered; edge.js parses them identically.
 */
const { spawn } = require('child_process');

const PARITY = { none: 'None', even: 'Even', odd: 'Odd', mark: 'Mark', space: 'Space' };
function stopBitsName(v) { return v === 2 ? 'Two' : (v === 1.5 ? 'OnePointFive' : 'One'); }

function psScript(s) {
  const port = String(s.port);
  const baud = Number(s.baudRate) || 9600;
  const parity = PARITY[(s.parity || 'none').toLowerCase()] || 'None';
  const dataBits = Number(s.dataBits) || 8;
  const stop = stopBitsName(Number(s.stopBits) || 1);
  return [
    "$ErrorActionPreference='Stop'",
    'try {',
    `  $p = New-Object System.IO.Ports.SerialPort '${port}',${baud},'${parity}',${dataBits},'${stop}'`,
    "  $p.Handshake='None'; $p.ReadTimeout=500",
    '  $p.Open()',
    "  [Console]::Error.WriteLine('OPEN')",
    '  while($true){',
    '    $n=$p.BytesToRead',
    '    if($n -gt 0){ $b=New-Object byte[] $n; $r=$p.Read($b,0,$n); [Console]::Out.WriteLine([Convert]::ToBase64String($b,0,$r)) }',
    '    else { Start-Sleep -Milliseconds 40 }',
    '  }',
    "} catch { [Console]::Error.WriteLine('ERR:'+$_.Exception.Message); exit 1 }"
  ].join('\n');
}

/**
 * Start reading a serial port.
 * @param {object} serialCfg  {port, baudRate, dataBits, stopBits, parity}
 * @param {(chunk:string)=>void} onData   raw bytes decoded latin1
 * @param {(evt:{state:string,detail:string})=>void} onStatus
 * @returns {{stop:()=>void}}
 */
function openSerialReader(serialCfg, onData, onStatus) {
  let child = null, stopped = false, tail = '';
  const ps = process.env.SystemRoot
    ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe';

  child = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript(serialCfg)], { windowsHide: true });

  child.stdout.on('data', (buf) => {
    tail += buf.toString('utf8');
    let i;
    while ((i = tail.indexOf('\n')) >= 0) {
      const line = tail.slice(0, i).trim();
      tail = tail.slice(i + 1);
      if (line) {
        try { onData(Buffer.from(line, 'base64').toString('latin1')); } catch (_) {}
      }
    }
  });
  child.stderr.on('data', (buf) => {
    const s = buf.toString('utf8').trim();
    if (s.startsWith('OPEN')) onStatus({ state: 'connected', detail: `serial ${serialCfg.port} @ ${serialCfg.baudRate}` });
    else if (s.startsWith('ERR:')) onStatus({ state: 'error', detail: s.slice(4) });
  });
  child.on('exit', (code) => { if (!stopped) onStatus({ state: 'disconnected', detail: 'reader exited (' + code + ')' }); });
  child.on('error', (e) => onStatus({ state: 'error', detail: e.message }));

  return { stop() { stopped = true; try { child.kill(); } catch (_) {} } };
}

/** List COM ports without any native module. */
function listPorts() {
  return new Promise((resolve) => {
    const ps = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
    const child = spawn(ps, ['-NoProfile', '-Command', '[System.IO.Ports.SerialPort]::GetPortNames() -join ","'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.on('exit', () => resolve(out.trim() ? out.trim().split(',').map((s) => s.trim()).filter(Boolean) : []));
    child.on('error', () => resolve([]));
  });
}

module.exports = { openSerialReader, listPorts };
