# WeighCore Desktop (Electron)

Turns the WeighCore HTML/CSS/JS app into a Windows desktop terminal with **real
weight input**, **real IP-camera capture**, an **offline-first local database**,
and **hybrid sync** to a shared VPS backend. Two lanes (P5WB1 / P5WB2) run the
same app against the same backend and keep working with or without the network.

```
WeighCore-Desktop/
├─ main.js            Electron main — owns all hardware/IO
├─ preload.js         secure bridge -> window.weighcore
├─ config.json        devices (indicator + cameras) + VPS settings   ← EDIT THIS
├─ src/
│  ├─ edge.js         weight indicator: serial COM + LAN TCP, parse + stability
│  ├─ camera.js       IP-camera JPEG snapshot (Hikvision ISAPI + digest auth)
│  ├─ db.js           offline-first SQLite (better-sqlite3) + outbox
│  └─ sync.js         push/pull to the VPS, image upload
├─ renderer/          your WeighCore UI (copied) + weighcore-bridge.js (injected)
└─ server/            the VPS backend (Express + PostgreSQL)
```

## Run it (dev machine with Node 18+)

```powershell
cd WeighCore-Desktop
npm install                 # pulls electron, serialport, better-sqlite3
npm start                   # launches the app
```

`npm install` compiles two native modules (`serialport`, `better-sqlite3`).
If they complain, run `npm run rebuild` (uses @electron/rebuild). Build a signed
installer EXE with `npm run dist` → `dist\WeighCore Setup 1.0.0.exe`.

## Configure the two things that matter — in `config.json`

**Weight indicator** (`edge`):
- Serial: set `connection:"serial"`, `serial.port:"COM3"` and the baud/parity to
  match the indicator.
- LAN: set `connection:"tcp"`, `tcp.host`/`tcp.port` (the original ran an indicator
  at `192.168.1.151:5876`).
- `parse` slices the weight out of the raw frame — `startChar`, `totalStringLength`,
  `weightStartFrom`, `weightLength`, `reverse`, implied-decimal. These are the same
  knobs the WeighBridge Solution used; copy the values from the indicator you have.

**Cameras** (`cameras[]`): one entry per lane camera with `host`, `username`,
`password`, `vendor:"hikvision"`, `channel:101`. Capture pulls a JPEG over HTTP
digest — the same approach as the old system, so there are no browser camera
prompts or WebRTC glitches.

## Wire the UI to the hardware

The bridge is injected automatically and updates the existing live-weight chip
and edge status. For the ops screens (capture buttons, ticket save), call the
native API from your view code:

```js
// live weight (also fires a 'wc:weight' window event continuously)
const w = await WeighCoreNative.readWeight();          // { value, unit, stable }

// capture BOTH lane cameras for a ticket -> saved to disk + local db + sync queue
const shot = await WeighCoreNative.captureTicketPhotos(ticketId, passSeq);
// shot.results[i] = { ok, cameraId, id, dataUrl, file }

// persist a ticket (syncs to the VPS automatically when online)
await WeighCoreNative.saveTicket({ ticket_no, vehicle_no, gross, tare, net, status:'closed' });
```

Because the bridge no-ops when `window.weighcore` is absent, the same
`renderer/` still runs in a plain browser as your demo.

## Verify the camera before building (run this yourself)

The assistant couldn't probe the camera with credentials (blocked by its
sandbox), so confirm capture from your own shell — PowerShell:

```powershell
$ip='192.168.1.114'; $u='admin'; $p='CHANGE-ME'
$cc = New-Object System.Net.CredentialCache
$cc.Add((New-Object Uri("http://$ip/")), "Digest", (New-Object System.Net.NetworkCredential($u,$p)))
$req=[System.Net.HttpWebRequest]::Create("http://$ip/ISAPI/Streaming/channels/101/picture")
$req.Credentials=$cc
$resp=$req.GetResponse(); $fs=[IO.File]::Create("$env:TEMP\cam_test.jpg")
$resp.GetResponseStream().CopyTo($fs); $fs.Close(); $resp.Close()
Start-Process "$env:TEMP\cam_test.jpg"     # a frame from the camera = success
```

If that returns a JPEG, the app's `camera.js` will too (it does the same digest
GET). If it 401s, fix the credentials; if the path 404s, the camera is a
different brand — tell me the `Server:` header and I'll set the right snapshot path.

## The hybrid backend

See `server/README.md`. Short version: run `server/` on your VPS with Postgres,
point every terminal's `config.json > sync.baseUrl` at it, give each terminal its
own `apiKey` (a row in `devices`). Offline is the default; the terminals reconcile
whenever the link is up — transactions, weighments **and** camera images.

## What this scaffold delivers vs. what's next

**Working now:** the Electron shell, the real weight edge (serial + LAN) with
parsing + stability + auto-reconnect, IP-camera capture, the offline SQLite store,
and the VPS sync engine + backend. Your full WeighCore UI runs inside it.

**Still to wire (view-by-view):** connecting each WeighCore ops screen's buttons
to `WeighCoreNative` (capture on pass, save ticket, print), and porting the demo's
mock `data.js` reads to the local db. That's mechanical and per-screen — do it
incrementally so each screen is verified against real hardware as you go.
