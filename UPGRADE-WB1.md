# Upgrading weighbridge 1 to v1.0.9 (from this branch)

This branch carries the WeighCore **v1.0.9** application code running in
production on weighbridge 2. WB1 is NOT a copy of WB2 — copy code only;
everything per-machine stays on WB1.

> **Nothing in this release is per-machine.** The v1.0.9 change is pure
> reporting logic. There is **no `config.json` change**, no database change,
> no new table and no new dependency.

Close WeighCore FIRST (only ever run ONE instance — two copies fight over the
serial port), and take the backup in (d) before copying anything.

## What's in v1.0.9

**Transaction Summary Report used the wrong timestamp for its date range.**

The report decided whether a ticket fell inside the requested From/To window
using the ticket's **creation** time — which is stamped when the *first* pass is
stored. A truck that tared at 8:55 AM and grossed at 9:10 AM was filed under
8:55, so it disappeared from a 9:00 AM–9:00 PM report even though the weighment
actually completed at 9:10, inside the window.

A ticket's reporting timestamp is now the moment it **became Complete** — the
**later** of `grossAt` and `tareAt`. This is direction-aware rather than
assuming Gross:

- tare first, gross second (outgoing) → the Gross time governs
- gross first, tare second (incoming) → the Tare time governs

A ticket with only one pass so far is Active, and the report's Status filter
defaults to `Complete`, so those are normally excluded anyway; if someone
selects "All statuses" they fall back to the single pass they do have, and
finally to creation time, so nothing is ever silently dropped.

Gross/Tare/Net **values** are untouched — this changes only which date/time
decides whether a completed ticket falls inside the requested range. The report
already prints Gross Time and Tare Time as separate columns, so the reader can
see exactly why a ticket qualified.

### Known, deliberately NOT changed in this release

The Dashboard's "today / yesterday / last 7 days / 14-day throughput" tiles use
the same creation-time basis, so a ticket created before midnight but completed
after it still counts on the earlier day there. That was reported and left
alone on purpose — this release is scoped to the Report. The Transactions list
screen has no date filter at all, so it is unaffected.

## a) Files to copy → under `C:\Program Files\WeighCore\resources\app\`

**If WB1 is already on v1.0.8, only these two files change:**

| From this branch                      | To (under `resources\app\`)           |
|---------------------------------------|---------------------------------------|
| `renderer/assets/js/views-admin.js`   | `renderer\assets\js\views-admin.js`   |
| `package.json`                        | `package.json`                        |

**If WB1 is on anything older than v1.0.8**, do not cherry-pick — run the
**`WeighCore Setup 1.0.9.exe`** installer instead. It carries everything
(including `node_modules`, which a file copy cannot bring across) and leaves
ProgramData/AppData config and weighment data intact. The v1.0.8 release added
`renderer/assets/js/clock.js` and `renderer/assets/css/clock.css` plus an
`index.html` change, and v1.0.6 added `src/slip-docx.js` with the `docx`
package — all of which the installer handles for you.

Copying needs elevation (Program Files). Do NOT copy anything else from the repo.

## b) Per-machine facts (nothing to do — just know them)

- Serial port, baud, camera URLs and credentials, SQL instance and sync
  settings all come from WB1's own `config.json` and stay untouched.
- The terminal's weighbridge number is derived at runtime from `site.scaleId`;
  `P5WB1`/`P5WB2` appear in this codebase only as examples inside comments.
- Master data reaches WB1 through the normal sync pull-down, never through git.

## c) NEVER copy to WB1

- `C:\ProgramData\WeighCore\config.json` (scaleId, SQL instance, COM port,
  paths and credentials all differ per machine)
- anything under `keys\`, any `*.bak`, `node_modules\`, `dist\`,
  `bin\ffmpeg.exe`, any `.pfx/.key/.pem`
- any database content or master data

## d) Rollback

Before copying, back up WB1's whole `C:\Program Files\WeighCore\resources\app`
folder (zip it to `resources\app-backup-<date>.zip`). To roll back: close
WeighCore, restore the backup over `resources\app`, start ONE instance, and
check the log as below. Nothing in this release touches `config.json` or the
database, so there is nothing else to undo.

## After upgrading — verify

Start ONE instance, then check the tail of
`%APPDATA%\WeighCore\data\weighcore.log`: live snapshot, edge connected,
vps tunnel up, mjpeg relay, camera cam1/cam2 stream up — **each once**.

Then verify the fix itself. Find (or create) a completed ticket whose two
passes straddle a round hour — for example tare at 8:55 AM, gross at 9:10 AM.
Run **Reports → Transaction** for that day from 9:00 AM to 9:00 PM:

1. The ticket **must appear**, because it completed at 9:10 inside the window.
   Before v1.0.9 it was missing.
2. Change the range to 9:00 AM–9:05 AM. The ticket must now be **absent**,
   because its completion at 9:10 falls outside — the fix must not simply make
   everything show up.
3. If you have a ticket where Gross was captured first and Tare second, check
   it is placed by its **Tare** time (the later pass), not its Gross time.
