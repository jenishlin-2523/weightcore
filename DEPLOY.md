# WeighCore — Deployment Guide (2 weighbridges → 1 central)

This is the field runbook for installing WeighCore at a two-lane site. Each
weighbridge runs on its **own PC** with its **own local SQL database** (works
offline); both **push to one central server** that the ERP reads.

```
  PC #1  P5WB1  ──┐  push tickets up          ┌── CENTRAL SQL (one server)
  local SQL DB    ├──────────────────────────▶│   aggregates both bridges  ──▶ ERP
  PC #2  P5WB2  ──┘  masters pulled down       └────────────────────────────
```

---

## A. Central server — do this ONCE (before the PCs)

The central is a SQL Server both bridges reach over an SSH tunnel. Ours runs in
Docker on the VPS (`200.141.9.11`); see `D:\sqlsetup\WEIGHCORE-CREDENTIALS.txt`
and `central-migration.sql`. It must have the `svt_weighbridge` database with the
multi-source migration applied (ScaleID columns + natural-key indexes).

If the ERP is on the client's own LAN instead, point the bridges at that SQL
server (host + a SQL login) — the tunnel step is skipped for a same-LAN server.

---

## B. Each weighbridge PC — repeat per lane (~20 min)

**Requirements:** Windows 10/11 x64, ~5 GB free, internet for first-time setup,
the indicator on a COM port, cameras on the LAN.

### 1. Install the app
Run **`WeighCore Setup <version>.exe`** → Next through the installer. It installs
to `C:\Program Files\WeighCore` and adds a desktop shortcut. (Fast — app only.)

### 2. Install the local database (once per PC, elevated)
In the install folder open `resources\installer\` and **double-click
`Setup-Database.bat`** (it self-elevates). It installs SQL Server Express
(instance `SVTSQLEXPRESS`) and creates the `svt_weighbridge` schema. First run
takes **10–15 min** (downloads SQL Express). Re-running is safe.

### 3. Launch WeighCore → the Setup wizard
On first launch the **Terminal Setup** wizard opens. Fill in:
- **Station identity** — site name, and **which weighbridge this PC is**
  (Weighbridge 1 → `P5WB1` on the first PC, Weighbridge 2 → `P5WB2` on the second).
- **Weight indicator** — pick the COM port, set baud, click **Test weight**
  (should show a live reading).
- **Cameras** — RTSP URL + login per lane, **Test** (shows a frame).
- **Central server** — host, SSH user, SQL login + **password** (from the
  handover sheet), click **Test connection** (should say “connected”).
- Click **Finish**. The terminal saves its config and opens the main app.

> The **only** field that differs between the two PCs is the Scale ID
> (WB1 vs WB2). Everything else is the same.

### 4. Verify
- Sign in: **`superadmin` / `Admin@123`**.
- Do a test double-weighment (F8 to capture passes, F7 to complete).
- Within ~30 s it appears on the central, tagged with this PC's Scale ID.
- Repeat on the other PC; confirm a vehicle added at one lane appears at the other.

---

## C. Credentials

| What | Value |
|---|---|
| App login | `superadmin` / `Admin@123` |
| Local SQL `sa` | `WeighCore!SVT2026` |
| Central SQL login | `weighcore` / (from handover sheet) |

Full list: `D:\sqlsetup\WEIGHCORE-CREDENTIALS.txt` (keep off the client PCs).

---

## D. Updates & housekeeping

- **App update:** run the newer `WeighCore Setup` EXE — SQL data is untouched,
  only the app updates. Config persists in `%ProgramData%\WeighCore\config.json`.
- **Re-run setup wizard:** set `%ProgramData%\WeighCore\config.json` →
  `"setup": { "complete": false }` and relaunch.
- **Backups:** schedule a nightly SQL backup of `svt_weighbridge` on each PC
  (the local DB is authoritative; this protects each lane).

## E. Troubleshooting

- **Login fails / no data** → local SQL not set up: run `Setup-Database.bat`.
  Diagnostics land in `%APPDATA%\WeighCore\data\weighcore.log`.
- **“Test connection” fails** → SSH key/host or SQL login wrong; check the
  central is reachable and the SQL password matches.
- **No live weight** → wrong COM port/baud, or another program owns the port.
- **No camera frame** → cameras need `bin\ffmpeg.exe` in the install folder
  (bundle a Windows x64 static ffmpeg build if lanes use cameras).
