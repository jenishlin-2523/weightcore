# Upgrading weighbridge 1 to v1.2.1 (from this branch)

This branch carries the WeighCore **v1.2.1** application code running in
production on weighbridge 2. WB1 is NOT a copy of WB2 — copy code only;
everything per-machine stays on WB1.

> **No per-machine configuration is needed for any of it.** No `config.json`
> change, no new table, no new npm dependency. Each item is called out below.

Close WeighCore FIRST (only ever run ONE instance — two copies fight over the
serial port), and back up `resources\app` before copying anything.

## What's in v1.2.1 (covering v1.1.3, v1.2.0 and v1.2.1)

| Change | Per-machine config? |
|---|---|
| **Delete** option on the Product and Gate masters, refused for any row a ticket uses | none |
| Reports **Transaction Type** cascade: Processing→MSW, Disposal→five products, RDF→RDF + Direction | none |
| Disposal **OTHER** free-text material on the terminal | none |
| Excluded-mismatch note under forced-product reports | none |
| Reports filter no longer scrolls to the top when Transaction Type changes | none |
| Terminal **Direction removed for Disposal** (RDF only) | none |

### Two behaviour changes worth telling the operators about

1. **New Disposal tickets store no direction.** `PlantDirectionType` is now
   NULL for them instead of a meaningless "Plant to Yard". Existing tickets are
   untouched, and nothing downstream reads direction for Disposal.
2. **Delete is real, and permanent.** It is refused while any ticket references
   the row — the database enforces that with a `NO_ACTION` foreign key — but an
   unused row is genuinely removed. Deactivate remains the safe default.

## a) Files to copy → under `C:\Program Files\WeighCore\resources\app\`

**If WB1 is already on v1.1.2**, these are the files that change:

| From this branch | To (under `resources\app\`) |
|---|---|
| `main.js` | `main.js` |
| `preload.js` | `preload.js` |
| `package.json` | `package.json` |
| `src/sqldb.js` | `src\sqldb.js` |
| `renderer/assets/js/views-admin.js` | `renderer\assets\js\views-admin.js` |
| `renderer/assets/js/views-ops.js` | `renderer\assets\js\views-ops.js` |

**If WB1 is on anything older than v1.1.2**, do not cherry-pick — run the
**`WeighCore Setup 1.2.1.exe`** installer instead. It carries everything
including `node_modules`, and leaves ProgramData/AppData config and weighment
data intact. Earlier releases added `renderer/assets/js/clock.js`,
`searchselect.js`, `accent.js`, their CSS and an `index.html` change, plus
`src/slip-docx.js` and the `docx` package — a file copy cannot bring those
across.

## b) Per-machine facts (nothing to do)

- Serial port, baud, camera URLs, SQL instance and sync settings all come from
  WB1's own `config.json`.
- The weighbridge number is derived at runtime from `site.scaleId`;
  `P5WB1`/`P5WB2` appear in the code only as examples inside comments.
- Master data reaches WB1 through the normal sync, never through git.

## c) NEVER copy to WB1

`C:\ProgramData\WeighCore\config.json`, anything under `keys\`, any `*.bak`,
`node_modules\`, `dist\`, `bin\ffmpeg.exe`, any `.pfx/.key/.pem`, or any
database content.

## d) Rollback

Back up `C:\Program Files\WeighCore\resources\app` first (zip it). To roll back:
close WeighCore, restore the backup, start ONE instance and check the log.
Nothing here touches `config.json` or the database schema.

## After upgrading — verify

Start ONE instance and check the tail of
`%APPDATA%\WeighCore\data\weighcore.log`: live snapshot, edge connected, vps
tunnel up, mjpeg relay, camera cam1/cam2 stream up — **each once**. Then:

1. **Reports → Transaction Type = Processing** — Product locks to MSW. Scroll
   down first, then change the type: the page must **not** jump to the top.
2. **Disposal** — Product offers exactly INERT, BIO EARTH, WOOD, TYRE, OTHER.
   **RDF** — Product locks to RDF and a Direction filter appears.
3. **Disposal → OTHER** — the report returns materials outside the five, under
   their original names.
4. **Terminal → Transaction Type = Disposal** — there must be **no** Direction
   control at all. Select RDF — Direction reappears with both options.
5. **Terminal → Disposal → Product = OTHER** — an "Enter Details" box appears,
   Continue stays disabled until it is filled, and the typed material does not
   join the Product dropdown afterwards.
6. **Masters → Products** — open a product used by tickets and press Delete: it
   must be refused with a count and a pointer to Deactivate.

## Known, deliberately unchanged

- **The Disposal Product Master cleanup has NOT been applied.** The old variants
  (STONE, TROMMEL, LEACHATE, `test`, the internal-use duplicates) are still
  active. This is blocked on a sync question, not an oversight:
  `wb-sync.ps1` merges masters by `ProductName`, and `Pull-Table` is
  **insert-only** — it skips any name already present locally. So a central
  `IsActive=0` never reaches a bridge, and each bridge upserts its still-active
  rows back up, undoing it. **Deactivations must be run on each bridge to
  stick.** Do not attempt the cleanup centrally alone.
- The **Dashboard** day tiles still bucket on the ticket's creation time, so
  they can disagree with a report for the same period. The report is correct
  (it uses Gross time); the tiles were out of scope.
- `main.js` has a dormant `|| 'P5WB2'` fallback for `site.scaleId`. Harmless
  while WB1's config defines `site.scaleId` — **check that it does**, because if
  it ever does not, WB1 would push its tickets to central under WB2's scale id.
