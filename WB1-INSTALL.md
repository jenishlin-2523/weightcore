# WB1 — Second weighbridge PC install & joining both bridges to one ERP

State so far: **WB2 (this PC) is live** — local SQL, indicator on COM5, both
cameras streaming, and syncing to the central server over the SSH tunnel.
This guide brings up **WB1 on its own PC** and points **both** PCs at the
central ERP server so the office sees one combined system.

---

## A. Install WB1 (on the second PC, ~30 min)

1. **Copy the installer** — take `dist\WeighCore Setup 1.0.0.exe` from the WB2
   PC (USB stick or AnyDesk transfer). It already contains today's build:
   live camera tiles, the login changes, the tunnel key, ffmpeg, and the DB
   installer.

2. **Run the installer** → Next → Install. If SmartScreen warns (unsigned
   app): *More info → Run anyway*.

3. **Install the local database** — open
   `C:\Program Files\WeighCore\resources\installer\` and double-click
   **`Setup-Database.bat`**, approve the UAC prompt. First run downloads SQL
   Server Express and takes **10–15 minutes**. Wait for *"Database ready"*.
   Re-running is safe.

4. **First launch → the Setup wizard** (this PC has no config, so the wizard
   appears). Fill in:
   - **Station identity** → this PC is **Weighbridge 1 → `P5WB1`**  ← the ONLY
     value that differs from WB2
   - **Weight indicator** → its real COM port + baud (click *Test weight*,
     expect a live reading)
   - **Cameras** → WB1's own RTSP URLs + logins (click *Test*, expect a frame)
   - **Central server** → host / user / SQL password from the credentials
     sheet (click *Test connection*, expect **connected**)
   - **Finish** — the app opens.

5. **Two known gotchas** (both hit us on WB2):
   - If the central *Test connection* fails with the tunnel repeatedly
     dropping: the tunnel key's Windows permissions are too open (antivirus
     blocks the app's own fix). Run once in PowerShell:
     ```powershell
     icacls "$env:ProgramData\WeighCore\wctunnel_key" /inheritance:r /grant:r "$env:USERNAME:F"
     ```
   - The bundled tunnel key must be **authorized on the central server** for
     the `wctunnel` user (see section C). WB2's key authorization does not
     automatically cover a different key — but since the installer bakes the
     SAME key, one authorization covers both PCs.

6. **Verify WB1** — sign in, do a test double weighment (F8 capture, F7
   complete). Within ~30 s the ticket must appear on the ERP portal tagged
   **P5WB1**.

---

## B. What "one ERP" means (how the two PCs combine)

```
 WB1 PC — local SQL (authoritative, works offline) ─┐   SSH tunnel    ┌─ CENTRAL SQL ── ERP portal (browser)
                                                    ├────────────────▶│  one merged database:
 WB2 PC — local SQL (authoritative, works offline) ─┘   every 30 s    └─ tickets tagged P5WB1 / P5WB2
```

- Each PC keeps working **offline**; the sync engine pushes tickets, weighment
  details and capture photos up every 30 s and pulls shared master lists down.
- Masters (vehicles, products, accounts, gates…) are merged by natural key —
  a vehicle added at WB1 appears in WB2's pick-list on its next sync.
- Tickets are keyed **(ScaleID, ReceiptTicketID)**, so ticket numbers never
  collide between bridges.
- The office uses the **ERP portal** in a browser — dashboards, transactions
  from both lanes, reports, and printable slips.

---

## C. Central ERP server deployment (new VPS)

The central pieces live in this repo and deploy onto one Linux VPS with
Docker:

| Piece | Source | Purpose |
|---|---|---|
| Central SQL Server | Docker `mcr.microsoft.com/mssql/server:2022-latest` | the merged `svt_weighbridge` DB |
| Schema | `installer/weighcore-schema.sql` (+ ScaleID migration) | tables both bridges push into |
| Tunnel user | `keys/setup-tunnel-user.sh` | locked-down `wctunnel` SSH user (port-forward only) |
| ERP portal | `portal/` (Dockerfile + `deploy.sh`) | the web ERP the office uses |
| HTTPS | `portal/add-caddy.sh` | Caddy reverse-proxy with automatic TLS (sslip.io) |

Order on a fresh VPS (as root):
1. Install Docker (`curl -fsSL https://get.docker.com | sh`).
2. Run the SQL Server container with a strong SA password; create the
   `weighcore` SQL login and the `svt_weighbridge` DB; apply
   `weighcore-schema.sql` plus the ScaleID columns.
3. Run `keys/setup-tunnel-user.sh` (with the current public key from
   `keys/wctunnel_key.pub`) to create the tunnel user.
4. Build + run the portal container (`portal/deploy.sh`), then
   `portal/add-caddy.sh` for HTTPS.
5. On BOTH weighbridge PCs set `vpsSql.ssh.host` in
   `%ProgramData%\WeighCore\config.json` to the new VPS IP and restart the
   app. Verify `vps tunnel up` + `vps sync ok` in
   `%APPDATA%\WeighCore\data\weighcore.log`.

---

## D. Credentials involved (keep this file off shared drives once filled)

| What | Where used |
|---|---|
| App login | both PCs (set your own per-operator passwords in Users) |
| Local SQL | integrated security — no password needed by the app |
| Central SQL login `weighcore` | both PCs' `vpsSql.password` + the portal |
| Tunnel key `wctunnel_key` | baked into the installer; authorize its `.pub` on the VPS |
| VPS root | deployment only — never stored on the weighbridge PCs |
