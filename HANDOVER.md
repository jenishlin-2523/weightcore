# WeighCore — Client Handover & Installation Procedure

You are installing WeighCore on **two weighbridge PCs** at the client site. Each
PC runs its own database (works offline) and both feed the central admin portal.

> The **only** difference between the two PCs is the Scale ID: pick **WB1** on
> the first PC and **WB2** on the second. Everything else is identical.

---

## 0. What to carry to site

| Item | Notes |
|---|---|
| `WeighCore Setup 1.0.0.exe` | the single installer (79 MB) — on a USB stick |
| This handover sheet | credentials + per-PC settings below |
| Internet on each PC | needed only during first-time setup |

**Credentials:**

| Where | Value |
|---|---|
| App login (both PCs) | `superadmin` / `Admin@123` |
| Central connection | **pre-configured in the installer** — nothing to type; just click *Test connection* |
| Admin portal (for the office) | https://weighcore.200-141-9-11.sslip.io — `superadmin` / `Admin@123` |

> Central access (host, restricted SSH tunnel key, SQL login) is baked into the
> installer, so both PCs reach the central server automatically — no keys or
> passwords to enter on site.

**Per-PC settings (fill in before you go):**

| | PC #1 — **WB1** | PC #2 — **WB2** |
|---|---|---|
| Scale ID | `P5WB1` | `P5WB2` |
| Indicator COM port | e.g. COM3 | e.g. COM5 |
| Camera IP(s) + login | ______ | ______ |

---

## 1. Install the application

1. Double-click **`WeighCore Setup 1.0.0.exe`**.
2. If Windows SmartScreen warns (unsigned app), click **More info → Run anyway**.
3. Accept the defaults → **Install** (installs to `C:\Program Files\WeighCore`,
   adds a desktop shortcut). This part is quick.

## 2. Install the local database (once per PC — needs Administrator)

1. Open `C:\Program Files\WeighCore\resources\installer\`.
2. Double-click **`Setup-Database.bat`** → click **Yes** on the UAC prompt.
3. It installs SQL Server Express (instance `SVTSQLEXPRESS`) and creates the
   database. **First run takes 10–15 minutes** (downloads SQL Express). When it
   says *"Database ready"*, close the window. Re-running is safe.

## 3. First launch → the Setup wizard

1. Open **WeighCore** from the desktop. The **Terminal Setup** wizard appears.
2. Fill it in from the handover sheet:
   - **Station identity** — site name, and **which weighbridge this PC is**
     (WB1 on PC #1, WB2 on PC #2).
   - **Weight indicator** — pick the COM port, set baud, click **Test weight**
     → it should show a live reading from the indicator.
   - **Cameras** — RTSP URL + login per lane, click **Test** → shows a frame.
   - **Central server** — already filled in (pre-configured). Just click
     **Test connection** → should say **connected**.
3. Click **Finish**. The terminal saves its settings and opens the main app.

## 4. Verify the PC

1. Sign in: `superadmin` / `Admin@123`.
2. Do one test double-weighment (F8 to capture, F7 to complete).
3. From any browser, open the **admin portal**
   (https://weighcore.200-141-9-11.sslip.io) → the ticket appears within ~30 s,
   tagged with this PC's Scale ID.

**Then repeat steps 1–4 on the second PC**, choosing **WB2** in step 3.

---

## 5. Final checks (both PCs done)

- On the portal Dashboard, both **P5WB1** and **P5WB2** cards show activity.
- A vehicle added at one lane appears in the other lane's vehicle list.
- Show the operator: login, F8 capture, F7 complete, print slip.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login fails / no data | Local DB not set up — run `Setup-Database.bat` as admin. Log: `%APPDATA%\WeighCore\data\weighcore.log` |
| "Test connection" fails | The PC has no internet, or the VPS is unreachable — check the network; central access is pre-configured so no credentials are needed |
| No live weight | Wrong COM port/baud, or another program is holding the port |
| No camera frame | Camera IP/login wrong, or `bin\ffmpeg.exe` missing from the install folder |
| Re-run the wizard | Set `%ProgramData%\WeighCore\config.json` → `"setup": { "complete": false }` and relaunch |

## Updating later

Run a newer `WeighCore Setup` EXE — the SQL data is untouched, only the app
updates. Config persists in `%ProgramData%\WeighCore\config.json`.
