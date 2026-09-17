# Upgrading weighbridge 1 to v1.2.2 (from this branch)

This branch carries the WeighCore **v1.2.2** application code running in
production on weighbridge 2. WB1 is NOT a copy of WB2 — copy code only;
everything per-machine stays on WB1.

> **No per-machine configuration is needed for any of it.** No `config.json`
> change, no new table, no new npm dependency. Each item is called out below.

Close WeighCore FIRST (only ever run ONE instance — two copies fight over the
serial port), and back up `resources\app` before copying anything.

## What's new in v1.2.2

| Change | Per-machine config? |
|---|---|
| Duplicate master names are **refused** on Products and Gates | none |
| Master data **hides inactive rows** by default, with a toggle | none |
| Terminal: the Disposal **OTHER** box sits under Product, not beside Buyer Name | none |
| Transactions ledger **fits the screen** — no horizontal scrollbar | none |

### Why the duplicate guard matters most

`saveMaster` used to `INSERT` with no name check, so every press of **Add** on
the Products screen minted another row. WB2 accumulated **five `MSW` rows and
three `RDF` rows** that way. `wb-sync.ps1` merges masters by name, so those all
collapse onto one central row on push while cluttering every local picker.

The guard is case- and padding-insensitive (`msw  ` is refused against `MSW`),
ignores the row being edited so renaming still works, and covers Products and
Gates only. Vehicles and accounts are deliberately left alone — they may already
hold same-name rows, and refusing an edit on one of those would be worse.

### Inactive rows are hidden, not deleted

A product or gate any ticket references can **never** be deleted —
`FK_TransactionDetail_Product` and `FK_TransactionDetail_Gate` are both
`NO_ACTION` — so deactivating is the only way to retire one. Listing them by
default buried WB2's seven live products under twenty-six dead ones. The count
line now reads `7 of 33 records · 26 inactive hidden`, and the **Show inactive**
checkbox brings them back.

## a) Files to copy → under `C:\Program Files\WeighCore\resources\app\`

**If WB1 is already on v1.2.1**, these four files are all that change:

| From this branch | To (under `resources\app\`) |
|---|---|
| `src/sqldb.js` | `src\sqldb.js` |
| `renderer/assets/js/views-ops.js` | `renderer\assets\js\views-ops.js` |
| `renderer/assets/js/views-admin.js` | `renderer\assets\js\views-admin.js` |
| `renderer/assets/css/weighmast-theme.css` | `renderer\assets\css\weighmast-theme.css` |

**If WB1 is on anything older than v1.1.2**, do not cherry-pick — run the
installer instead. Earlier releases added `clock.js`, `searchselect.js`,
`accent.js`, their CSS, an `index.html` change, `src/slip-docx.js` and the
`docx` package; a file copy cannot bring those across.

## b) Per-machine facts (nothing to do)

- Serial port, baud, camera URLs, SQL instance and sync settings all come from
  WB1's own `config.json`.
- The weighbridge number is derived at runtime from `site.scaleId`.
- Master data reaches WB1 through the normal sync, never through git.

## c) NEVER copy to WB1

`C:\ProgramData\WeighCore\config.json`, anything under `keys\`, any `*.bak`,
`node_modules\`, `dist\`, `bin\ffmpeg.exe`, any `.pfx/.key/.pem`, or any
database content.

---

# The master-data cleanup — WB1's half

**This is the part that still needs doing on WB1.** WB2 was cleaned on
2026-09-14; WB1 has not been touched.

## Why it cannot be done from WB2 or from central

`wb-sync.ps1` (do not modify it) behaves asymmetrically:

| | Behaviour | Consequence |
|---|---|---|
| masters **push** | `MERGE` by name | local `IsActive` overwrites central |
| masters **pull** | `INSERT`-only by name | an existing local row is never updated |
| transactions | **push only**, 7-day window | never pulled back |
| deletes | none, either direction | — |

So **deactivating on a bridge sticks** — the name stays present locally, so the
pull skips it — but **deleting only sticks if the name also disappears from
central and from every other bridge**. WB1 is live and re-pushes all of its
local products every cycle, which would resurrect anything deleted centrally.
Each bridge must therefore be cleaned on itself.

## What WB2 now looks like

Seven active products — `MSW` (Processing), `RDF` (RDF), `BIO EARTH`, `INERT`,
`WOOD`, `TYRE`, `OTHER` (Disposal) — and two active gates.

`OTHER` is **not a material**: it drives the terminal's free-text entry and the
Disposal→OTHER exclusion report. Keep it.

## Running it on WB1

`tools/cleanup-product-master.ps1` works by product **NAME**, never by id,
because every bridge assigns its own ids. It is **dry-run by default**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cleanup-product-master.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\cleanup-product-master.ps1 -Apply
```

In one transaction it picks the most-used row per material as canonical,
re-points duplicate rows' weighment rows onto it, hard-deletes a duplicate only
when the same name survives on another local row (the one delete the sync cannot
undo), and deactivates everything else while keeping its name. It refuses to
delete any row a ticket references, and prints ticket/detail counts before and
after — **they must be identical**. Read the dry run before using `-Apply`.

### Gates need the same treatment, by hand

WB2 had six gates and now has two. Audit WB1 first:

```sql
SELECT g.GateID, g.GateName, g.IsActive, COUNT(d.TransactionDetailID) AS rows_
FROM Gate g LEFT JOIN TransactionDetail d ON d.GateID = g.GateID
GROUP BY g.GateID, g.GateName, g.IsActive ORDER BY 4 DESC;
```

Keep the two real gates, re-point the spelling variants' rows onto them
(`UPDATE TransactionDetail SET GateID=<keep>, GateName=N'<keep name>' WHERE
GateID IN (...)`), then deactivate the rest. **Do not rename a gate** — the sync
merges by `GateName`, so a rename inserts a new central row and the pull brings
the old name straight back, leaving more gates than you started with.

---

# v1.2.3 — deactivation finally crosses between bridges

**This part MUST be installed on BOTH bridges in the same maintenance window.**
It is committed but deliberately **not deployed** on WB2 for that reason.

## The bug

Deactivating a product on one bridge never reached the other, for two reasons at
once: `Pull-Table` skipped any name it already had, and every bridge pushed its
whole master list each cycle, so central was simply whoever synced last. Captured
live on 2026-09-17:

```
23:27:19  central: Main Gate, package-5, package-5 WB 2, test = ACTIVE   (WB1 pushed 22:56)
17:57:32Z WB2 syncs -> pushes IsActive=0
23:28:34  central: all four = INACTIVE
```

## The fix

Active/inactive becomes **central-authoritative**: a bridge no longer overwrites
that column on an existing central row (it still supplies it when inserting a new
one), and the pull applies central's value to rows it already has. The app writes
a status change straight to central via `sqldb.setMasterStatus`, so the Masters
screen keeps working, and warns you if central was unreachable instead of letting
the next sync quietly revert the change.

Covered: Product, Vehicle, Account, Driver, UserMaster, Template.
**Gate is deliberately excluded** — see below. WeightBridge is excluded for good
(per-machine hardware, never pulled).

## Why both bridges, together

Until a bridge runs this version it still pushes its entire master list every
cycle. Install it on one side only and that side stops defending its own values
while the other keeps overwriting central — the patched bridge becomes a
**follower of the unpatched one** and its curated list is undone. Measured on
WB2: 19 vehicles and 6 products would have been rewritten to WB1's values.

## Why gates are left out for now

On 2026-09-17 WB1 still had all six gates active and pushed them to central, and
`package-5` is WB1's live gate — 56,869 weighments, used that same day — while
being junk on WB2 with 92. A shared gate status cannot be right for both until
WB1 moves its weighments onto `Package 5 Wb1`. **Order: upgrade both bridges →
consolidate WB1's gates → only then add `'Gate' = 'IsActive'` to `$STATUS_COL`
in `wb-sync.ps1` on both machines.**

## Files (all four, both bridges)

`src/wb-sync.ps1`, `src/wb-exec.ps1` (gains optional `-User`/`-Password` so the
app can reach central over the tunnel; with no `-User` it is the local instance
exactly as before), `main.js`, `renderer/assets/js/views-admin.js`.

## Before switching it on

Run `tools/predict-status-sync.ps1` on each bridge. It lists every row whose
status central would rewrite. **Read that list first** — reconcile anything wrong
on central before the first sync, because after it the local value is replaced.

## Three traps worth knowing

1. **`TRACKUSERAUDIT_*` triggers inflate row counts.** An `n`-row update reports
   `n + n²` affected. Verify with a real `COUNT(*)`, never the reported number.
2. **`TransactionDetail.ReceiptTicketID` (uniqueidentifier) joins
   `TransactionData.ReceiptTicketID`** — *not* `TicketID` (int). Joining on
   `TicketID` is an operand-type clash.
3. **Master data is read once at startup.** `liveSnapshot` has no periodic
   refresh, so SQL edits stay invisible until WeighCore restarts. Close it,
   confirm the process count is genuinely **0**, then start ONE instance — a
   second copy fights over the serial port and neither can read the indicator.

## Known, deliberately unchanged

- WB2 still holds 17 unused product rows and 9 that carry weighment history.
  The 17 can only be deleted from WB2 and central **together**; the 9 cannot be
  deleted at all while tickets reference them.
- The **Dashboard** day tiles still bucket on creation time, so they can
  disagree with a report for the same period. The report is correct (Gross
  time); the tiles were out of scope.
- `main.js` has a dormant `|| 'P5WB2'` fallback for `site.scaleId`. Harmless
  while WB1's config defines `site.scaleId` — **check that it does**, because if
  it ever does not, WB1 would push its tickets under WB2's scale id.

## After upgrading — verify

Start ONE instance and check the tail of
`%APPDATA%\WeighCore\data\weighcore.log`: live snapshot, edge connected, vps
tunnel up, mjpeg relay, camera cam1/cam2 stream up — **each once**. Then:

1. **Masters → Products** — only active rows listed; the count line names how
   many are hidden; **Show inactive** reveals them.
2. **Masters → Products → Add** an existing name — it must be refused, naming
   the row that already has it.
3. **Terminal → Disposal → Product = OTHER** — the "Enter Details" box appears
   **directly under Product**, and Gate/Datetime do not shift down.
4. **Transactions** — no horizontal scrollbar at 1152×864; all nine columns
   visible; long values wrap rather than being cut off.
