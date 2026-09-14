<#
  WeighCore - Product master cleanup for ONE weighbridge (WB1 or WB2).
  Works by product NAME, never by id, because each bridge assigns its own ids.

  DRY RUN by default. Add -Apply to write.

    powershell -NoProfile -ExecutionPolicy Bypass -File cleanup-bridge.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File cleanup-bridge.ps1 -Apply

  What it does, in one transaction:
    1. backs up Product + every detail row it will touch, and writes an UNDO .sql
    2. picks ONE canonical row per material (the one with the most weighment rows)
    3. re-points detail rows from the duplicate rows onto the canonical row
    4. hard-deletes a duplicate ONLY when the same name survives on another local
       row - that is the one delete the sync cannot undo
    5. deactivates every other row, keeping its name so old tickets still read right

  It never deletes a ticket, never deletes a row that any ticket references, and
  never touches weights. Deactivated rows vanish from the operator's pickers but
  keep resolving names on historic tickets.
#>
param(
  [switch]$Apply,
  [string]$Server   = '.\SVTSQLEXPRESS',
  [string]$Database = 'svt_weighbridge'
)

$ErrorActionPreference = 'Stop'
$CS = "Data Source=$Server;Initial Catalog=$Database;Integrated Security=True;Connect Timeout=10"
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# the only materials that may stay active. OTHER is not a material - it drives the
# terminal's free-text entry and the Disposal->OTHER exclusion report. Keep it.
$CANON = @('MSW', 'RDF', 'BIO EARTH', 'INERT', 'WOOD', 'TYRE', 'OTHER')
$TAG   = @{ 'MSW' = 'Processing'; 'RDF' = 'RDF'; 'BIO EARTH' = 'Disposal'; 'INERT' = 'Disposal';
            'WOOD' = 'Disposal'; 'TYRE' = 'Disposal'; 'OTHER' = 'Disposal' }

function Norm($s) { return (([string]$s).Trim() -replace '\s+', ' ').ToUpper() }

$cn = New-Object System.Data.SqlClient.SqlConnection($CS); $cn.Open()
function Rows($sql, $tx) {
  $c = $cn.CreateCommand(); $c.CommandTimeout = 120; $c.CommandText = $sql
  if ($tx) { $c.Transaction = $tx }
  $da = New-Object System.Data.SqlClient.SqlDataAdapter($c); $dt = New-Object System.Data.DataTable
  [void]$da.Fill($dt); return ,$dt
}

'=== CURRENT MASTER ==='
$prod = Rows @"
SELECT p.ProductID AS id, p.ProductName AS nm, p.IsActive AS act,
       ISNULL(p.TransactionType,'') AS tag, ISNULL(u.rows_,0) AS rows_
FROM Product p
LEFT JOIN (SELECT ProductID, COUNT(*) AS rows_ FROM TransactionDetail GROUP BY ProductID) u
  ON u.ProductID = p.ProductID
ORDER BY p.ProductName
"@
'{0,-6} {1,-30} {2,-7} {3,-11} {4,7}' -f 'id', 'name', 'active', 'tag', 'rows'
'-' * 66
foreach ($r in $prod) { '{0,-6} {1,-30} {2,-7} {3,-11} {4,7}' -f $r['id'], $r['nm'], $r['act'], $r['tag'], $r['rows_'] }

# ---- choose the canonical row per canonical name: most weighment rows wins ----
$canonId = @{}
foreach ($c in $CANON) {
  $best = $null
  foreach ($r in $prod) {
    if ((Norm $r['nm']) -ne (Norm $c)) { continue }
    if ($null -eq $best -or [int]$r['rows_'] -gt [int]$best['rows_']) { $best = $r }
  }
  if ($best) { $canonId[$c] = [int]$best['id'] }
}

''
'=== CANONICAL ROWS CHOSEN ==='
foreach ($c in $CANON) {
  if ($canonId.ContainsKey($c)) { '  {0,-12} -> id {1}' -f $c, $canonId[$c] }
  else { '  {0,-12} -> MISSING on this bridge (will be created)' -f $c }
}

# ---- classify every row ----
$transfer = @()   # @{ from; to; name }
$deleteIds = @()
$deactIds = @()
foreach ($r in $prod) {
  $id = [int]$r['id']; $n = Norm $r['nm']
  $isCanonName = $CANON | Where-Object { (Norm $_) -eq $n }
  if ($isCanonName) {
    $target = $canonId[[string]($isCanonName | Select-Object -First 1)]
    if ($id -eq $target) { continue }                       # the keeper
    if ([int]$r['rows_'] -gt 0) { $transfer += @{ from = $id; to = $target; name = [string]($isCanonName | Select-Object -First 1) } }
    $deleteIds += $id                                        # same name survives -> delete is sync-durable
  } else {
    if ([int]$r['act'] -eq 1) { $deactIds += $id }
  }
}

''
'=== PLAN ==='
'  transfer  : ' + $transfer.Count + ' duplicate row(s) of a canonical material'
foreach ($t in $transfer) { '              ' + $t.from + ' -> ' + $t.to + '  (' + $t.name + ')' }
'  delete    : ' + $deleteIds.Count + ' duplicate row(s) -> ' + (($deleteIds | Sort-Object) -join ', ')
'  deactivate: ' + $deactIds.Count + ' non-canonical row(s) -> ' + (($deactIds | Sort-Object) -join ', ')

# ---- backup + undo ----
$prodFile = Join-Path $outDir "backup-product-$stamp.json"
($prod | ForEach-Object { [pscustomobject]@{ ProductID = $_['id']; ProductName = [string]$_['nm']; IsActive = $_['act']; TransactionType = [string]$_['tag'] } }) |
  ConvertTo-Json -Depth 4 | Out-File $prodFile -Encoding utf8

$undo = New-Object System.Collections.Generic.List[string]
$undo.Add("-- UNDO product cleanup $stamp  (run against $Database)")
$undo.Add('BEGIN TRAN;')
if ($transfer.Count -gt 0) {
  $srcIds = ($transfer | ForEach-Object { $_.from }) -join ','
  $det = Rows "SELECT TransactionDetailID AS did, ProductID AS pid, ISNULL(ProductName,'') AS pn FROM TransactionDetail WHERE ProductID IN ($srcIds)"
  $detFile = Join-Path $outDir "backup-detail-$stamp.json"
  ($det | ForEach-Object { [pscustomobject]@{ TransactionDetailID = $_['did']; ProductID = $_['pid']; ProductName = [string]$_['pn'] } }) |
    ConvertTo-Json -Depth 4 | Out-File $detFile -Encoding utf8
  foreach ($r in $det) { $undo.Add("UPDATE TransactionDetail SET ProductID=$($r['pid']), ProductName=N'$(([string]$r['pn']).Replace("'","''"))' WHERE TransactionDetailID=$($r['did']);") }
  '  detail rows to move: ' + $det.Rows.Count + '  (backed up)'
}
$undo.Add('SET IDENTITY_INSERT Product ON;')
foreach ($r in $prod) {
  if ($deleteIds -contains [int]$r['id']) {
    $tg = if ([string]$r['tag'] -eq '') { 'NULL' } else { "N'" + ([string]$r['tag']).Replace("'","''") + "'" }
    $undo.Add("INSERT INTO Product (ProductID,ProductName,IsActive,TransactionType) VALUES ($($r['id']),N'$(([string]$r['nm']).Replace("'","''"))',$([int]$r['act']),$tg);")
  }
}
$undo.Add('SET IDENTITY_INSERT Product OFF;')
foreach ($r in $prod) { $undo.Add("UPDATE Product SET IsActive=$([int]$r['act']) WHERE ProductID=$($r['id']);") }
$undo.Add('COMMIT;')
$undoFile = Join-Path $outDir "UNDO-$stamp.sql"
$undo -join "`r`n" | Out-File $undoFile -Encoding utf8
''
'  backup -> ' + $prodFile
'  undo   -> ' + $undoFile

if (-not $Apply) { ''; '*** DRY RUN - nothing written. Re-run with -Apply ***'; $cn.Close(); exit 0 }

# ---- apply ----
''
'=== APPLYING ==='
$before = @{}
foreach ($t in @('TransactionData', 'TransactionDetail')) {
  $c = $cn.CreateCommand(); $c.CommandText = "SELECT COUNT(*) FROM $t"; $before[$t] = [int]$c.ExecuteScalar()
}
$tx = $cn.BeginTransaction()
try {
  function Exec($sql) { $c = $cn.CreateCommand(); $c.Transaction = $tx; $c.CommandTimeout = 180; $c.CommandText = $sql; return $c.ExecuteNonQuery() }

  foreach ($t in $transfer) {
    [void](Exec "UPDATE TransactionDetail SET ProductID=$($t.to), ProductName=N'$($t.name.Replace("'","''"))' WHERE ProductID=$($t.from)")
    '  moved detail rows ' + $t.from + ' -> ' + $t.to
  }
  foreach ($d in ($deleteIds | Sort-Object)) {
    $c = $cn.CreateCommand(); $c.Transaction = $tx
    $c.CommandText = "SELECT COUNT(*) FROM TransactionDetail WHERE ProductID=$d"
    $used = [int]$c.ExecuteScalar()
    if ($used -gt 0) { throw "refusing to delete product $d - still referenced by $used detail rows" }
    [void](Exec "DELETE FROM Product WHERE ProductID=$d"); '  deleted product ' + $d
  }
  if ($deactIds.Count -gt 0) {
    [void](Exec ("UPDATE Product SET IsActive=0 WHERE ProductID IN (" + ($deactIds -join ',') + ")"))
    '  deactivated ' + $deactIds.Count + ' products'
  }
  foreach ($c in $CANON) {
    if ($canonId.ContainsKey($c)) { [void](Exec "UPDATE Product SET IsActive=1, TransactionType=N'$($TAG[$c])' WHERE ProductID=$($canonId[$c])") }
    else { [void](Exec "INSERT INTO Product (ProductName,TransactionType,IsActive) VALUES (N'$c',N'$($TAG[$c])',1)"); '  created missing canonical row ' + $c }
  }
  '  tagged the survivors'
  $tx.Commit(); '  COMMITTED'
} catch { $tx.Rollback(); 'ROLLED BACK: ' + $_.Exception.Message; $cn.Close(); exit 1 }

''
'=== VERIFY ==='
foreach ($t in @('TransactionData', 'TransactionDetail')) {
  $c = $cn.CreateCommand(); $c.CommandText = "SELECT COUNT(*) FROM $t"; $now = [int]$c.ExecuteScalar()
  $flag = if ($now -eq $before[$t]) { 'unchanged OK' } else { '*** CHANGED - INVESTIGATE ***' }
  '  {0,-18} {1}  ({2})' -f $t, $now, $flag
}
$dt = Rows "SELECT ProductID AS id, ProductName AS nm, ISNULL(TransactionType,'-') AS tag FROM Product WHERE IsActive=1 ORDER BY ProductName"
'  active products now:'
foreach ($r in $dt) { '    ' + $r['id'] + '  ' + $r['nm'] + '  (' + $r['tag'] + ')' }
$dt = Rows "SELECT COUNT(*) AS n FROM Product p WHERE EXISTS (SELECT 1 FROM Product q WHERE q.ProductName=p.ProductName AND q.ProductID<>p.ProductID)"
'  rows still sharing a name: ' + $dt[0]['n'] + '   (want 0)'
$cn.Close()
