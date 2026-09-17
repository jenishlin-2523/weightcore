<#
  WeighCore - READ-ONLY ticket reconciliation, bridge vs central.

  Writes nothing anywhere. Answers one question: is any ticket missing, orphaned,
  unsynced or internally inconsistent?

    powershell -NoProfile -ExecutionPolicy Bypass -File ticket-reconcile.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File ticket-reconcile.ps1 -Out C:\Temp\recon.txt

  Reads the central credentials from C:\ProgramData\WeighCore\config.json and
  never prints them. Every FAIL line is something to investigate.
#>
param([string]$Out = '')
$ErrorActionPreference = 'Stop'
$lines = New-Object System.Collections.Generic.List[string]
function W($t) { $lines.Add([string]$t); Write-Host $t }
$script:bad = 0
function Chk($name, $n, $expect) {
  $okk = ([int]$n -eq [int]$expect)
  if (-not $okk) { $script:bad++ }
  W ('  {0,-52} {1,10}   {2}' -f $name, $n, $(if ($okk) { 'OK' } else { '<<< INVESTIGATE' }))
}

$cfg = Get-Content 'C:\ProgramData\WeighCore\config.json' -Raw | ConvertFrom-Json
$scale = $cfg.site.scaleId
$v = $cfg.vpsSql
$port = 14330; if ($v.ssh -and $v.ssh.localPort) { $port = $v.ssh.localPort }
$server = if ($v.server) { $v.server } else { '127.0.0.1,' + $port }
$RCS = "Server=$server;Database=$(if($v.database){$v.database}else{'svt_weighbridge'});User ID=$($v.user);Password=$($v.password);Encrypt=True;TrustServerCertificate=True;Connection Timeout=20"
$LCS = "Data Source=$($cfg.db.server);Initial Catalog=$($cfg.db.database);Integrated Security=True;Connect Timeout=15"

function S($cs, $sql) {
  $cn = New-Object System.Data.SqlClient.SqlConnection($cs); $cn.Open()
  $c = $cn.CreateCommand(); $c.CommandTimeout = 600; $c.CommandText = $sql
  $x = $c.ExecuteScalar(); $cn.Close()
  if ($null -eq $x -or $x -is [System.DBNull]) { return 0 }
  return $x
}
function Q($cs, $sql) {
  $cn = New-Object System.Data.SqlClient.SqlConnection($cs); $cn.Open()
  $c = $cn.CreateCommand(); $c.CommandTimeout = 600; $c.CommandText = $sql
  $da = New-Object System.Data.SqlClient.SqlDataAdapter($c); $dt = New-Object System.Data.DataTable
  [void]$da.Fill($dt); $cn.Close(); return ,$dt
}
function Ids($cs, $sql) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($r in (Q $cs $sql)) { [void]$set.Add(([string]$r[0]).Trim()) }
  return $set
}

W ('=' * 78)
W ("TICKET RECONCILIATION   " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "   scale=" + $scale)
W ('=' * 78)

W ''
W '## A. HEADLINE COUNTS'
$locTx  = [int](S $LCS "SELECT COUNT(*) FROM TransactionData")
$locDet = [int](S $LCS "SELECT COUNT(*) FROM TransactionDetail")
$cenTx  = [int](S $RCS "SELECT COUNT(*) FROM TransactionData   WHERE ScaleID=N'$scale'")
$cenDet = [int](S $RCS "SELECT COUNT(*) FROM TransactionDetail WHERE ScaleID=N'$scale'")
W ('  local  tickets / detail rows : ' + $locTx + ' / ' + $locDet)
W ('  central tickets / detail rows: ' + $cenTx + ' / ' + $cenDet + '   (for this scale)')

W ''
W '## B. IS EVERY LOCAL TICKET ON CENTRAL?   (the one that matters)'
$locIds = Ids $LCS "SELECT CONVERT(varchar(40), ReceiptTicketID) FROM TransactionData"
$cenIds = Ids $RCS "SELECT CONVERT(varchar(40), ReceiptTicketID) FROM TransactionData WHERE ScaleID=N'$scale'"
$missing = @($locIds | Where-Object { -not $cenIds.Contains($_) })
$extra   = @($cenIds | Where-Object { -not $locIds.Contains($_) })
Chk 'local tickets NOT on central (unsynced)' $missing.Count 0
Chk 'central tickets NOT on this bridge (stale/foreign)' $extra.Count 0
if ($missing.Count -gt 0) {
  W '    the unsynced ones (these are the tickets at risk):'
  foreach ($m in ($missing | Select-Object -First 15)) {
    $d = Q $LCS "SELECT TicketID AS t, ISNULL(Status,'-') AS s, CONVERT(varchar(19),CreationTime,120) AS c FROM TransactionData WHERE CONVERT(varchar(40),ReceiptTicketID)='$m'"
    foreach ($r in $d) { W ('      #' + $r['t'] + '  ' + $r['s'] + '  ' + $r['c']) }
  }
  if ($missing.Count -gt 15) { W ('      ... and ' + ($missing.Count - 15) + ' more') }
}

W ''
W '## C. TICKET NUMBER CONTINUITY  (a gap can mean a deleted ticket)'
$minT = [int](S $LCS "SELECT ISNULL(MIN(TicketID),0) FROM TransactionData")
$maxT = [int](S $LCS "SELECT ISNULL(MAX(TicketID),0) FROM TransactionData")
$distinct = [int](S $LCS "SELECT COUNT(DISTINCT TicketID) FROM TransactionData")
W ('  ticket numbers run ' + $minT + ' .. ' + $maxT + '  (' + (($maxT - $minT) + 1) + ' slots, ' + $distinct + ' used)')
W ('  unused numbers in that range : ' + ((($maxT - $minT) + 1) - $distinct) + '   (gaps are normal if the legacy app also numbered)')
Chk 'duplicate TicketID values' ([int](S $LCS "SELECT COUNT(*) FROM (SELECT TicketID FROM TransactionData GROUP BY TicketID HAVING COUNT(*)>1) z")) 0
Chk 'duplicate ReceiptTicketID values' ([int](S $LCS "SELECT COUNT(*) FROM (SELECT ReceiptTicketID FROM TransactionData GROUP BY ReceiptTicketID HAVING COUNT(*)>1) z")) 0

W ''
W '## D. IS EVERY TICKET INTACT?'
Chk 'tickets with NO weighment row at all' ([int](S $LCS "SELECT COUNT(*) FROM TransactionData t WHERE NOT EXISTS (SELECT 1 FROM TransactionDetail d WHERE d.ReceiptTicketID=t.ReceiptTicketID)")) 0
Chk 'weighment rows with NO parent ticket' ([int](S $LCS "SELECT COUNT(*) FROM TransactionDetail d WHERE NOT EXISTS (SELECT 1 FROM TransactionData t WHERE t.ReceiptTicketID=d.ReceiptTicketID)")) 0
Chk 'rows pointing at a Product that no longer exists' ([int](S $LCS "SELECT COUNT(*) FROM TransactionDetail d WHERE d.ProductID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Product p WHERE p.ProductID=d.ProductID)")) 0
Chk 'rows pointing at a Gate that no longer exists' ([int](S $LCS "SELECT COUNT(*) FROM TransactionDetail d WHERE d.GateID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Gate g WHERE g.GateID=d.GateID)")) 0
Chk 'COMPLETE tickets with no gross weight' ([int](S $LCS "SELECT COUNT(*) FROM TransactionData t WHERE t.Status='Complete' AND NOT EXISTS (SELECT 1 FROM TransactionDetail d WHERE d.ReceiptTicketID=t.ReceiptTicketID AND ISNULL(d.GrossWeight,0)>0)")) 0

W ''
W '## E. WEIGHT CHECKSUMS  (compare these before and after ANY cleanup)'
W ('  local  SUM(Gross) / SUM(Tare) / SUM(Net) :')
W ('     ' + (S $LCS "SELECT ISNULL(SUM(CAST(GrossWeight AS bigint)),0) FROM TransactionDetail") +
   ' / ' + (S $LCS "SELECT ISNULL(SUM(CAST(TareWeight AS bigint)),0) FROM TransactionDetail") +
   ' / ' + (S $LCS "SELECT ISNULL(SUM(CAST(NetWeight AS bigint)),0) FROM TransactionDetail"))
W ('  central SUM(Gross) / SUM(Tare) / SUM(Net) for this scale:')
W ('     ' + (S $RCS "SELECT ISNULL(SUM(CAST(GrossWeight AS bigint)),0) FROM TransactionDetail WHERE ScaleID=N'$scale'") +
   ' / ' + (S $RCS "SELECT ISNULL(SUM(CAST(TareWeight AS bigint)),0) FROM TransactionDetail WHERE ScaleID=N'$scale'") +
   ' / ' + (S $RCS "SELECT ISNULL(SUM(CAST(NetWeight AS bigint)),0) FROM TransactionDetail WHERE ScaleID=N'$scale'"))
W '  (small differences are the newest tickets not yet pushed - check the sync log)'

W ''
W '## F. THE OTHER BRIDGE (from central - a sanity check only)'
foreach ($r in (Q $RCS "SELECT ScaleID AS sc, COUNT(*) AS tix, CONVERT(varchar(19),MAX(CreationTime),120) AS last_ FROM TransactionData GROUP BY ScaleID ORDER BY ScaleID")) {
  W ('  {0,-8} {1,7} tickets   last {2}' -f $r['sc'], $r['tix'], $r['last_'])
}

W ''
W ('=' * 78)
if ($script:bad -eq 0) { W 'RESULT: every check passed - no ticket is missing, orphaned or unsynced.' }
else { W ("RESULT: " + $script:bad + " check(s) need investigating - see the <<< lines above.") }
W ('=' * 78)

if ($Out) { $lines -join "`r`n" | Out-File -FilePath $Out -Encoding utf8; Write-Host ''; Write-Host ("saved -> " + $Out) }
