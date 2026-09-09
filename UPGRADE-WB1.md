# Upgrading weighbridge 1 to v1.1.0 (from this branch)

This branch carries the WeighCore **v1.1.0** application code running in
production on weighbridge 2. WB1 is NOT a copy of WB2 — copy code only;
everything per-machine stays on WB1.

> **Nothing in this release needs per-machine configuration.** Each part is
> called out individually below, and every one of them is "nothing to
> configure". No `config.json` change, no database change, no new table, no new
> npm dependency.
>
> One item works *better* on WB1 after this release: the Devices → Cameras
> screen used to display WB2's camera addresses on every machine because they
> were hardcoded. It now reads WB1's own `config.json` → `cameras`. That block
> already exists on WB1; nothing to add.

Close WeighCore FIRST (only ever run ONE instance — two copies fight over the
serial port), and take the backup in (d) before copying anything.

## What's in v1.1.0, part by part

| Part | Change | Per-machine config? |
|---|---|---|
| 1 | Report date range uses the ticket's **completion** time (later of Gross/Tare), and the window is half-open by whole minutes so consecutive ranges never overlap or gap | none |
| 2 | **Hourly ledger** in the report — one row per clock hour, empty hours included, in screen/PDF/Excel/Word | none |
| 3 | Metadata (transporter, product, gate, Vehicle Type, Party, Buyer, Package No) is **editable while capturing Gross**; plate and datetime stay locked | none |
| 4 | Dual-letterhead slip offered **only** for RDF moving Yard → Customer | none — letterheads still come from WB1's own `slip.companies` |
| 5 | Dates are **DD/MM/YYYY** everywhere, via a custom date field + month calendar | none |
| 6 | Long dropdowns (>8 options) are **type-to-search** | none |
| 7 | **Accent colour** presets in Settings | none — stored per machine in that terminal's browser storage |
| 8 | The clock accepts **typed** hours and minutes, so any minute (e.g. :07) is reachable | none |
| 9 | Product list filtered by transaction type; **"Yard to Customer" no longer offered under Disposal** | none — driven by the Product master |
| 10 | Product master add/edit/deactivate with Transaction Type | none — **already existed**, no code change |
| 11 | Party Name defaults to `CHENNAI BIOMINNING LTD`, still fully editable | none |

## a) Files to copy → under `C:\Program Files\WeighCore\resources\app\`

**If WB1 is already on v1.0.9, these are the files that change:**

| From this branch | To (under `resources\app\`) |
|---|---|
| `main.js` | `main.js` |
| `package.json` | `package.json` |
| `renderer/index.html` | `renderer\index.html` |
| `renderer/assets/js/views-ops.js` | `renderer\assets\js\views-ops.js` |
| `renderer/assets/js/views-admin.js` | `renderer\assets\js\views-admin.js` |
| `renderer/assets/js/clock.js` | `renderer\assets\js\clock.js` |
| `renderer/assets/js/searchselect.js` | `renderer\assets\js\searchselect.js` **(new)** |
| `renderer/assets/js/accent.js` | `renderer\assets\js\accent.js` **(new)** |
| `renderer/assets/css/clock.css` | `renderer\assets\css\clock.css` |
| `renderer/assets/css/searchselect.css` | `renderer\assets\css\searchselect.css` **(new)** |
| `renderer/assets/css/accent.css` | `renderer\assets\css\accent.css` **(new)** |
| `src/sqldb.js` | `src\sqldb.js` |
| `src/report-xlsx.js` | `src\report-xlsx.js` |
| `src/report-docx.js` | `src\report-docx.js` |

`index.html` must be copied — it is what loads the three new JS files and three
CSS files. Miss it and the date/time pickers, the searchable dropdowns and the
accent presets all silently stay as they were.

**If WB1 is on anything older than v1.0.9**, do not cherry-pick — run the
**`WeighCore Setup 1.1.0.exe`** installer instead. It carries everything,
including `node_modules` (which a file copy cannot bring across, and which the
Word-slip and Excel-export features need), and leaves ProgramData/AppData
config and weighment data intact.

Copying needs elevation (Program Files). Do NOT copy anything else from the repo.

## b) Per-machine facts (nothing to do — just know them)

- Serial port, baud, camera URLs and credentials, SQL instance and sync
  settings all come from WB1's own `config.json` and stay untouched.
- The terminal's weighbridge number is derived at runtime from `site.scaleId`;
  `P5WB1`/`P5WB2` appear in this codebase only as examples inside comments.
- The accent colour is per-machine by design and starts at the default blue.
- Master data reaches WB1 through the normal sync pull-down, never through git.

## c) NEVER copy to WB1

- `C:\ProgramData\WeighCore\config.json` (scaleId, SQL instance, COM port,
  camera IPs, paths and credentials all differ per machine)
- anything under `keys\`, any `*.bak`, `node_modules\`, `dist\`,
  `bin\ffmpeg.exe`, any `.pfx/.key/.pem`
- any database content or master data

## d) Rollback

Back up WB1's whole `C:\Program Files\WeighCore\resources\app` folder first (zip
it to `resources\app-backup-<date>.zip`). To roll back: close WeighCore, restore
the backup over `resources\app`, start ONE instance and check the log below.
Nothing in this release touches `config.json` or the database, so there is
nothing else to undo.

## After upgrading — verify

Start ONE instance and check the tail of
`%APPDATA%\WeighCore\data\weighcore.log`: live snapshot, edge connected,
vps tunnel up, mjpeg relay, camera cam1/cam2 stream up — **each once**.

Then walk the acceptance checks:

1. **Report range** — a ticket tared 8:55 / grossed 9:10 must appear in a
   09:00–09:59 report and not in 08:00–08:59.
2. **Hourly ledger** — run 00:00–07:59 for a busy day; every hour is listed,
   including any with zero tickets, and the hourly Net total matches the report
   total. Check it also appears in the Excel and Word exports.
3. **Metadata on Gross** — recall an open ticket: transporter, product, gate and
   the detail fields are editable; the plate and datetime are not.
4. **Slip** — an RDF / Yard-to-Customer ticket offers both letterheads; any
   other ticket offers only Chennai Biomining.
5. **Time entry** — open the time picker, click the minute digits, type `07`.
   It must commit as exactly `:07`, with the hand between the 05 and 10 marks.
6. **Dates** — the date field reads DD/MM/YYYY and opens a month calendar.
7. **Search** — Reports → Vehicle: typing narrows the list.
8. **Product by type** — Processing offers MSW; Disposal does not offer
   "Yard to Customer" as a direction.
9. **New ticket** — Party Name is pre-filled with `CHENNAI BIOMINNING LTD` and
   can still be changed or cleared.

## Known, deliberately unchanged

- The **Dashboard**'s today / yesterday / 7-day / 14-day tiles still bucket on
  the ticket's creation time, so a ticket created before midnight and completed
  after it counts on the earlier day there. The report is correct; the dashboard
  tiles were out of scope for this batch.
- The **Product master contains duplicates and legacy junk** (MSW, RDF and
  TROMMEL each exist twice; `bio earth` / `Bioearth` / `BIO EARTH internle use`;
  `test`, `,sw`, `,,SW`, `store`). Three rows are tagged `All`, which lets them
  appear under every transaction type — including RDF under Disposal. Tidy this
  through **Masters → Products** (retag or deactivate); the code reads whatever
  the master says. Nothing was changed in the data by this release.
