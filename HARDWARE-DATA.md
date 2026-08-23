# Hardware data feeds — WeighCore Desktop

What this station actually receives from the weight indicator (serial COM port)
and the IP cameras, as verified live on this PC (Chennai Biomining — Package 5,
scale `P5WB2`). Config source: [`config.json`](config.json); receiving code:
[`src/edge.js`](src/edge.js), [`src/serial-win.js`](src/serial-win.js),
[`src/camera.js`](src/camera.js).

---

## 1. Weight indicator — serial COM port

### Link

| Setting | Value |
|---|---|
| Port | **COM5** (Prolific USB-to-Serial adapter; fallback COM1) |
| Baud rate | **2400** |
| Data bits | 8 |
| Stop bits | 1 |
| Parity | None |
| Direction | Receive-only — the indicator broadcasts continuously, nothing is sent to it |
| Alternate mode | Raw TCP to `192.168.1.151:5876` (same frame format), selected by `edge.connection` |

Only **one program can own COM5 at a time**. If the legacy WeighingSolution has
the port open, WeighCore logs `Access to the port 'COM5' is denied` and retries
every 2 seconds until the port frees up (and vice versa).

### Raw frame — 10 bytes, streamed continuously

Each reading is one fixed frame:

```
STX  d1 d2 d3 d4 d5 d6  ETX  CR  LF
0x02 6 ASCII digits     0x03 0x0D 0x0A
```

Example — bridge holding 220 kg (hex dump):

```
02 30 30 30 32 32 30 03 0D 0A     →  "000220"  →  220 kg
```

Example — loaded truck at 21,820 kg:

```
02 30 32 31 38 32 30 03 0D 0A     →  "021820"  →  21820 kg
```

| Property | Value |
|---|---|
| Frame length | 10 bytes (`totalStringLength: 10`) |
| Frame anchor | STX byte `0x02` (`startHex: "02"`) — framing re-syncs on it, so partial/garbled chunks are discarded safely |
| Weight field | 6 ASCII digits at offset 1 (`weightStartFrom: 1`, `weightLength: 6`) |
| Value format | Integer kilograms, zero-padded, no decimal point (`decimalInString: false`) |
| Sign | A leading `-` inside the field is honoured (negative weights parse) |
| Rate | Continuous; the app samples the parse loop every 250 ms (`pollMs`) |

### What the app derives from it

`EdgeAgent` (main process) parses the stream and emits events the UI consumes
(forwarded over IPC as `edge:weight` / `edge:status` / `edge:raw`, and reaching
the page as `wc:weight` / `wc:edge` DOM events):

| Event | Payload | Meaning |
|---|---|---|
| `weight` | `{ value: 21820, unit: "kg", raw: "\x02021820\x03\r\n", stable: true }` | Every parsed reading |
| `stable` | `{ value: 21820, unit: "kg" }` | Fired once when the same value has repeated **4 consecutive frames** (`stableRepeats: 4`) — the "STABLE" light |
| `status` | `{ state: "connecting" \| "connected" \| "disconnected" \| "error", detail: "serial COM5 @ 2400" }` | Link state; drives the Streaming/Offline pill and blocks auto-capture when down |
| `raw` | the raw chunk string | Diagnostics screen only |

Capture rules built on this data: **Automatic capture requires** link connected,
value > 0 kg, and `stable: true`. Manual capture bypasses the link and marks the
pass `✱ Manual`.

---

## 2. IP cameras — RTSP over the LAN

### Link

| | Camera 1 | Camera 2 |
|---|---|---|
| IP address | `192.168.1.112` | `192.168.1.114` |
| Protocol | RTSP over **TCP**, port **554** | same |
| Stream used | `/profile2` (sub-stream) | same |
| Fallback stream | `/profile1` (main stream — tried automatically after 2 failed connects) | same |
| Auth | Digest, user `admin` | same |
| Session limit | Small (a few concurrent RTSP sessions per camera) — why only **one connection per camera** is ever opened | same |

### What the stream carries (measured live)

| Property | Value |
|---|---|
| Video codec | H.264 |
| Resolution | 1280 × 720 |
| Frame rate | 25 fps |
| Bitrate | ≈ 200 kb/s (sub-stream) |
| Audio | PCM 8 kHz mono, 128 kb/s — **discarded** by the app (`-an`) |
| On-screen overlay | Camera burns its own date/time stamp into the picture (e.g. `23-08-2026 14:18:30`) |

### How the app consumes it

One **persistent ffmpeg process per camera** (started at app boot) decodes the
stream to JPEG stills at **2 fps**; the newest frame is cached in memory in the
main process. A dead or silent stream is recycled by a watchdog (15 s no first
frame / 10 s frames stopped), exits gracefully with RTSP TEARDOWN so the camera
frees its session slot, and reconnects with backoff (1.5 s → 5 s; 8 s after a
stall).

Data produced from the stream:

| Consumer | Data | Size / rate |
|---|---|---|
| Live tiles (terminal) | newest cached JPEG as a base64 `data:image/jpeg` URL, refreshed every 1.5 s | ≈ 170–200 KB per frame (720p, `-q:v 4`) |
| Weighment capture (F8) | one JPEG **per camera per pass**, taken from the cache at the instant of capture | 2 files per pass on this station |
| Disk | `%APPDATA%\WeighCore\images\<ticketId>\<uuid>.jpg` | plus a row in the local `images` table (queued for VPS upload when sync is configured) |
| Slip / ticket view | the same JPEGs, captioned `camera N Weighment: #<pass>` | embedded as data URLs |

### HTTP snapshot fallback (non-RTSP cameras)

For cameras configured without an RTSP URL, `camera.js` falls back to one-shot
HTTP snapshots with Digest/Basic auth, trying in order:
`/ISAPI/Streaming/channels/<ch>/picture` (Hikvision),
`/cgi-bin/snapshot.cgi?channel=1` (Dahua), then generic paths
(`/onvif-http/snapshot`, `/snapshot.jpg`, `/image/jpeg.cgi`, `/tmpfs/auto.jpg`).
Response: one `image/jpeg` body per request. Not used by this station's two
RTSP cameras.
