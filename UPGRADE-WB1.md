# Upgrading weighbridge 1 to v1.0.5 (from this branch)

This branch carries the WeighCore v1.0.5 APPLICATION CODE proven in production on
weighbridge 2. WB1 is NOT a copy of WB2 — copy code only; everything per-machine
stays on WB1 and is listed below.

Close WeighCore FIRST (only ever run ONE instance — two copies fight over the
serial port), and take the backup in (f) before copying anything.

## a) Files to copy → destinations under `C:\Program Files\WeighCore\resources\app\`

| From this branch                          | To (under resources\app\)                  |
|-------------------------------------------|--------------------------------------------|
| `main.js`                                  | `main.js`                                  |
| `preload.js`                               | `preload.js`                               |
| `package.json`                             | `package.json`                             |
| `renderer/assets/js/views-ops.js`          | `renderer\assets\js\views-ops.js`          |
| `renderer/assets/js/views-admin.js`        | `renderer\assets\js\views-admin.js`        |
| `renderer/assets/css/weighmast-theme.css`  | `renderer\assets\css\weighmast-theme.css`  |
| `src/sqldb.js`                             | `src\sqldb.js`                             |
| `src/wb-edit.ps1`  (new file)              | `src\wb-edit.ps1`                          |
| `installer/weighcore-schema.sql`           | `installer\weighcore-schema.sql` (reference only; also `resources\installer\` if present) |

Copying needs elevation (Program Files). Do NOT copy anything else from the repo.

## b) Audit table — create in WB1'S OWN database

Read `db.server` and `db.database` from **WB1's** `C:\ProgramData\WeighCore\config.json`
(the SQL instance name differs per machine — do NOT assume WB2's instance name),
then run this idempotent SQL there (SSMS/sqlcmd, integrated security):

```sql
IF OBJECT_ID('dbo.TransactionAudit','U') IS NULL
CREATE TABLE dbo.TransactionAudit (
  AuditID         UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  ScaleID         NVARCHAR(20)  NULL,
  ReceiptTicketID UNIQUEIDENTIFIER NULL,
  TicketID        INT NULL,
  Action          NVARCHAR(30)  NULL,   -- 'EditWeight'
  FieldName       NVARCHAR(50)  NULL,   -- 'GrossWeight' / 'TareWeight'
  OldValue        NVARCHAR(100) NULL,
  NewValue        NVARCHAR(100) NULL,
  Reason          NVARCHAR(400) NULL,
  UserName        NVARCHAR(100) NULL,
  CreatedAt       DATETIME NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_TxnAudit_Scale_Rid'
               AND object_id=OBJECT_ID('dbo.TransactionAudit'))
  CREATE INDEX IX_TxnAudit_Scale_Rid ON dbo.TransactionAudit (ScaleID, ReceiptTicketID);
```

Safe to re-run. Without this table, "Edit weights" fails safely (nothing is
changed and an error toast shows) — everything else works.

## c) Slip letterhead block — merge into WB1's config.json

Add this to **WB1's** `C:\ProgramData\WeighCore\config.json` (back it up first).
`outDir` must be WB1'S OWN Desktop path — check the Windows username on WB1;
forward slashes are fine:

```json
"slip": {
  "project": "RECLAMATION OF KODUNGAIYUR DUMP SITE",
  "companies": ["CHENNAI BIOMINING LIMITED", "AQUA WORLD EXPORT PVT LTD"],
  "outDir": "C:/Users/<WB1-USERNAME>/Desktop/WeighCore Slips",
  "partyOverrides": { "AQUA WORLD EXPORT PVT LTD": "Aqua world export" }
}
```

If the block is missing entirely the app falls back to the built-in company name
(single-letterhead slips, AppData save path) — degraded, not broken.

## d) Other per-machine facts (NOT in code — nothing to do, just know them)

- Slip header line 3 is derived at runtime from `site.scaleId` — WB1 prints
  `PACKAGE - 5 ; WB - 01.` automatically.
- Serial port, baud, camera URLs/credentials, SQL instance, sync settings all
  come from WB1's own config.json and stay untouched.
- Report exports always write to the signed-in user's `Desktop\WeighCore Reports`.
- Audit rows stay in each terminal's LOCAL database (sync deliberately unchanged).
- Master data reaches WB1 through the normal sync pull-down, never through git.

## e) NEVER copy to WB1

- `C:\ProgramData\WeighCore\config.json` (scaleId, SQL instance, COM port,
  paths, credentials are all different)
- anything under `keys\`, any `*.bak`, `node_modules\`, `dist\`, `bin\ffmpeg.exe`,
  any `.pfx/.key/.pem`
- any database content or master data

## f) Rollback

Before copying, back up WB1's whole
`C:\Program Files\WeighCore\resources\app` folder (e.g. zip it to
`resources\app-backup-<date>.zip`). To roll back: close WeighCore, restore the
backup over `resources\app`, start ONE instance, check the log shows
live snapshot / edge connected / vps tunnel up / both cameras — each once.
The audit table can stay (it is additive); config.json was never touched.

## After upgrading — verify

Start ONE instance of WeighCore, then check
`%APPDATA%\WeighCore\data\weighcore.log` tail: live snapshot, edge connected,
vps tunnel up, camera cam1/cam2 stream up — each once. Then spot-check:
terminal form readable · type-ahead search on fields and open-ticket recall ·
slip prints two letterhead PDFs (AQUA copy shows Party Name "Aqua world export",
header `WB - 01.`) · Reports → Run report opens the summary popup with
Excel/PDF export · Edit weights writes a row to dbo.TransactionAudit.
