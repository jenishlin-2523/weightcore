# Upgrading weighbridge 1 to v1.0.8 (from this branch)

This branch carries the WeighCore **v1.0.8** application code running in production
on weighbridge 2. WB1 is NOT a copy of WB2 — copy code only; everything
per-machine stays on WB1.

> **Nothing in this release is per-machine.** All three features are pure
> application logic. There is **no `config.json` change**, no database change and
> no new table — unlike the v1.0.5 work, which needed the `TransactionAudit`
> table and the `slip` letterhead block. If WB1 is already on v1.0.5, the only
> thing to do is copy files and restart.

Close WeighCore FIRST (only ever run ONE instance — two copies fight over the
serial port), and take the backup in (d) before copying anything.

## What's in v1.0.8

**1. Vehicle already has an open ticket — warning + gate**
Starting a second ticket for a vehicle that still has an `Active` one used to be
silent, which split one truck visit across two records and mispaired tare with
gross. Now, the moment such a vehicle is chosen, a warning appears under the
Vehicle field naming the open ticket, which pass is already captured and which
is still owed; pressing Continue raises a modal whose primary action recalls that
exact ticket. "Start a new ticket anyway" remains available for a genuinely
stuck old ticket. Reads this terminal's own local database only — no network
call is added to the weighing path.

**2. Duplicate tickets from a double press — in-flight guards**
Continue/F7 starts an async SQL save; while it was in flight the button stayed
enabled and `TS` still looked complete, so a second click — or OS key
auto-repeat while F7 was held — replayed the whole save. Production carried
**16 duplicated pass rows**, one ticket with four copies of the same pass.
Continue and Capture now claim a flag synchronously the instant they are
triggered and release it only when that action settles, and the hotkey listener
drops `e.repeat`. Extra presses are ignored outright — never queued, never
replayed. Normal single-press operation is unchanged.

**3. Clock-face time picker**
The time half of every `datetime-local` field (Transaction Datetime on the
terminal, and the report From/To) is now an Android-style dial: click or drag,
hours first then 5-minute steps, digital readout, AM/PM, Cancel/OK. The date
half stays a native date input. The original input stays in the DOM and keeps
its id and its exact `YYYY-MM-DDTHH:MM` value, so nothing downstream changed.

## a) Files to copy → under `C:\Program Files\WeighCore\resources\app\`

| From this branch                     | To (under `resources\app\`)          |
|--------------------------------------|--------------------------------------|
| `renderer/assets/js/views-ops.js`    | `renderer\assets\js\views-ops.js`    |
| `renderer/assets/js/clock.js`        | `renderer\assets\js\clock.js`  **(new file)** |
| `renderer/assets/css/clock.css`      | `renderer\assets\css\clock.css` **(new file)** |
| `renderer/index.html`                | `renderer\index.html`                |
| `src/sqldb.js`                       | `src\sqldb.js`                       |
| `main.js`                            | `main.js`                            |
| `preload.js`                         | `preload.js`                         |
| `package.json`                       | `package.json`                       |

`index.html` must be copied — it is what loads `clock.js` and `clock.css`. Miss
it and the time fields silently stay as the old browser picker.

Copying needs elevation (Program Files). Do NOT copy anything else from the repo.

### If WB1 is coming from a version older than v1.0.6

v1.0.6 added Word (.docx) slips, which need `src/slip-docx.js` (included in this
branch) **and** the `docx` npm package in `resources\app\node_modules`. A plain
file copy does not bring node_modules across. Either run the
**`WeighCore Setup 1.0.8.exe`** installer instead — it carries everything,
including node_modules, and leaves ProgramData/AppData config and data intact —
or copy `node_modules\docx` across as well. The three v1.0.8 features above do
not depend on it; only the .docx slip does.

## b) Per-machine facts (nothing to do — just know them)

- Serial port, baud, camera URLs and credentials, SQL instance and sync settings
  all come from WB1's own `config.json` and stay untouched.
- The terminal's weighbridge number is derived at runtime from `site.scaleId`;
  `P5WB2`/`P5WB1` appear in this codebase only as examples inside comments.
- Master data reaches WB1 through the normal sync pull-down, never through git.

## c) NEVER copy to WB1

- `C:\ProgramData\WeighCore\config.json` (scaleId, SQL instance, COM port, paths
  and credentials all differ per machine)
- anything under `keys\`, any `*.bak`, `node_modules\` (except the `docx` case
  above), `dist\`, `bin\ffmpeg.exe`, any `.pfx/.key/.pem`
- any database content or master data

## d) Rollback

Before copying, back up WB1's whole `C:\Program Files\WeighCore\resources\app`
folder (zip it to `resources\app-backup-<date>.zip`). To roll back: close
WeighCore, restore the backup over `resources\app`, start ONE instance, and
check the log as below. Nothing in this release touches config.json or the
database, so there is nothing else to undo.

## After upgrading — verify

Start ONE instance, then check the tail of
`%APPDATA%\WeighCore\data\weighcore.log`: live snapshot, edge connected,
vps tunnel up, mjpeg relay, camera cam1/cam2 stream up — **each once**.

Then spot-check the three features:

1. Capture a Tare for a vehicle and press Continue to leave the ticket Active.
   Start a new ticket and choose that same vehicle — the warning must name the
   ticket, say TARE was captured and that GROSS is needed next. Press Continue:
   the modal's primary button must recall that exact ticket. Complete it, then
   start another ticket for that vehicle — no warning this time.
2. Double-click Continue quickly, and separately hold F7 down — exactly one
   ticket each time. Normal single presses must feel no different.
3. Open Transaction Datetime: the time half shows e.g. `03:20 PM` and opens a
   round dial. Click a number, confirm it jumps to minutes on its own, drag the
   hand, press OK — the time applies. Cancel discards.
