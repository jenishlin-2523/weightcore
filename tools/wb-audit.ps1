<#
  WeighCore - READ-ONLY audit of one weighbridge.

  Writes nothing. No UPDATE, no INSERT, no DELETE, no file changes to the app.
  Safe to run at any time, including mid-shift, on a live terminal.

  It prints (and optionally saves) everything needed to plan a master-data
  cleanup on this machine, plus a ticket-safety BASELINE to compare against
  afterwards so it can be proved that not one ticket was lost.

    powershell -NoProfile -ExecutionPolicy Bypass -File wb-audit.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File wb-audit.ps1 -Out C:\Temp\wb1-audit.txt

  No password is ever printed.
#>
param(
  [string]$Server   = '.\SVTSQLEXPRESS',
  [string]$Database = 'svt_weighbridge',
  [string]$Out      = ''
)
$ErrorActionPreference = 'Stop'
$CS = "Data Source=$Server;Initial Catalog=$Database;Integrated Security=True;Connect Timeout=15"
$lines = New-Object System.Collections.Generic.List[string]
function W($t) { $lines.Add([string]$t); Write-Host $t }

function Q($sql) {
  $cn = New-Object System.Data.SqlClient.SqlConnection($CS); $cn.Open()
  $c = $cn.CreateCommand(); $c.CommandTimeout = 300; $c.CommandText = $sql
  $da = New-Object System.Data.SqlClient.SqlDataAdapter($c)
  $dt = New-Object System.Data.DataTable; [void]$da.Fill($dt); $cn.Close()
  return ,$dt
}
function S($sql) {
  $cn = New-Object System.Data.SqlClient.SqlConnection($CS); $cn.Open()
  $c = $cn.CreateCommand(); $c.CommandTimeout = 300; $c.CommandText = $sql
  $v = $c.ExecuteScalar(); $cn.Close()
  if ($null -eq $v -or $v -is [System.DBNull]) { return '' }
  return $v
}
function Show($dt, $cols, $widths) {
  $fmt = ''
  for ($i = 0; $i -lt $cols.Count; $i++) { $fmt += '{' + $i + ',' + $widths[$i] + '} ' }
  W ($fmt -f $cols)
  W ('-' * 96)
  foreach ($r in $dt) {
    $vals = @(); foreach ($c in $cols) { $v = $r[$c]; $vals += $(if ($v -is [System.DBNull]) { '-' } else { [string]$v }) }
    W ($fmt -f $vals)
  }
}

W ('=' * 96)
W ("WEIGHBRIDGE AUDIT   " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "   machine=" + $env:COMPUTERNAME)
W ('=' * 96)

# ---------------------------------------------------------------- identity
W ''
W '## 1. WHICH BRIDGE IS THIS'
$cfgPath = 'C:\ProgramData\WeighCore\config.json'
if (Test-Path $cfgPath) {
  $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
  W ('  site.scaleId      : ' + $(if ($cfg.site) { $cfg.site.scaleId } else { '(no site block!)' }))
  W ('  db                : ' + $cfg.db.server + ' / ' + $cfg.db.database)
  if ($cfg.vpsSql) { W ('  vpsSql enabled    : ' + $cfg.vpsSql.enabled + '   (password NOT shown)') }
  if ($cfg.edge) { W ('  serial port       : ' + $cfg.edge.port + ' @ ' + $cfg.edge.baud) }
} else { W '  !! C:\ProgramData\WeighCore\config.json NOT FOUND' }
$pkg = 'C:\Program Files\WeighCore\resources\app\package.json'
if (Test-Path $pkg) { W ('  app version       : ' + ((Get-Content $pkg -Raw | ConvertFrom-Json).version)) }
W ('  SQL server        : ' + (S "SELECT @@SERVERNAME"))

# ------------------------------------------------------- safety baseline
W ''
W '## 2. TICKET-SAFETY BASELINE  (record these; they must be IDENTICAL after any cleanup)'
W ('  TransactionData  rows : ' + (S "SELECT COUNT(*) FROM TransactionData"))
W ('  TransactionDetail rows: ' + (S "SELECT COUNT(*) FROM TransactionDetail"))
W ('  MIN / MAX TicketID    : ' + (S "SELECT CAST(MIN(TicketID) AS varchar(20)) + ' / ' + CAST(MAX(TicketID) AS varchar(20)) FROM TransactionData"))
W ('  SUM(GrossWeight)      : ' + (S "SELECT ISNULL(SUM(CAST(GrossWeight AS bigint)),0) FROM TransactionDetail"))
W ('  SUM(TareWeight)       : ' + (S "SELECT ISNULL(SUM(CAST(TareWeight  AS bigint)),0) FROM TransactionDetail"))
W ('  SUM(NetWeight)        : ' + (S "SELECT ISNULL(SUM(CAST(NetWeight   AS bigint)),0) FROM TransactionDetail"))
W ''
W '  tickets by status:'
Show (Q "SELECT ISNULL(Status,'(null)') AS status, COUNT(*) AS tickets FROM TransactionData GROUP BY Status ORDER BY COUNT(*) DESC") @('status','tickets') @('-14','8')
W ''
W '  integrity (all three MUST be 0):'
W ('    detail rows with no parent ticket   : ' + (S "SELECT COUNT(*) FROM TransactionDetail d WHERE NOT EXISTS (SELECT 1 FROM TransactionData t WHERE t.ReceiptTicketID=d.ReceiptTicketID)"))
W ('    detail rows pointing at a gone Product: ' + (S "SELECT COUNT(*) FROM TransactionDetail d WHERE d.ProductID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Product p WHERE p.ProductID=d.ProductID)"))
W ('    detail rows pointing at a gone Gate  : ' + (S "SELECT COUNT(*) FROM TransactionDetail d WHERE d.GateID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Gate g WHERE g.GateID=d.GateID)"))
W ''
W ('  OPEN (Active) tickets right now - do NOT touch these mid-weighment: ' + (S "SELECT COUNT(*) FROM TransactionData WHERE Status='Active'"))
$open = Q "SELECT TOP 20 TicketID AS ticket, ISNULL(VehicleNumber,'-') AS vehicle, CONVERT(varchar(19),CreationTime,120) AS created FROM TransactionData WHERE Status='Active' ORDER BY CreationTime DESC"
if ($open.Rows.Count -gt 0) { Show $open @('ticket','vehicle','created') @('-10','-14','-20') }

# ------------------------------------------------------------- products
W ''
W '## 3. PRODUCT MASTER  (every row, with real usage)'
Show (Q @"
SELECT p.ProductID AS id, p.ProductName AS name, ISNULL(p.TransactionType,'-') AS tag,
       CAST(p.IsActive AS int) AS act,
       ISNULL(u.rows_,0) AS rows_, ISNULL(u.tix,0) AS tix,
       ISNULL(CONVERT(varchar(10),u.f,120),'-') AS first_, ISNULL(CONVERT(varchar(10),u.l,120),'-') AS last_
FROM Product p
LEFT JOIN (
  SELECT d.ProductID, COUNT(*) AS rows_, COUNT(DISTINCT d.ReceiptTicketID) AS tix,
         MIN(t.CreationTime) AS f, MAX(t.CreationTime) AS l
  FROM TransactionDetail d JOIN TransactionData t ON t.ReceiptTicketID = d.ReceiptTicketID
  GROUP BY d.ProductID
) u ON u.ProductID = p.ProductID
ORDER BY ISNULL(u.rows_,0) DESC, p.ProductName
"@) @('id','name','tag','act','rows_','tix','first_','last_') @('-6','-30','-11','-4','7','6','-11','-11')
W ''
W '  product names appearing more than once:'
$dup = Q "SELECT ProductName AS name, COUNT(*) AS n FROM Product GROUP BY ProductName HAVING COUNT(*) > 1"
if ($dup.Rows.Count -eq 0) { W '    (none)' } else { Show $dup @('name','n') @('-30','4') }

# ---------------------------------------------------------------- gates
W ''
W '## 4. GATE MASTER  (every row, with real usage)'
Show (Q @"
SELECT g.GateID AS id, g.GateName AS name, ISNULL(g.GateType,'-') AS type_,
       CAST(g.IsActive AS int) AS act,
       ISNULL(u.rows_,0) AS rows_, ISNULL(u.tix,0) AS tix,
       ISNULL(CONVERT(varchar(10),u.l,120),'-') AS last_
FROM Gate g
LEFT JOIN (
  SELECT d.GateID, COUNT(*) AS rows_, COUNT(DISTINCT d.ReceiptTicketID) AS tix, MAX(t.CreationTime) AS l
  FROM TransactionDetail d JOIN TransactionData t ON t.ReceiptTicketID = d.ReceiptTicketID
  GROUP BY d.GateID
) u ON u.GateID = g.GateID
ORDER BY ISNULL(u.rows_,0) DESC, g.GateName
"@) @('id','name','type_','act','rows_','tix','last_') @('-6','-30','-8','-4','8','7','-11')
W ''
W '  WHICH GATE IS THIS BRIDGE ACTUALLY USING (last 60 days):'
Show (Q @"
SELECT ISNULL(NULLIF(d.GateName,''), g.GateName) AS name, COUNT(*) AS rows_,
       CONVERT(varchar(10), MAX(t.CreationTime), 120) AS last_
FROM TransactionDetail d
LEFT JOIN Gate g ON g.GateID = d.GateID
JOIN TransactionData t ON t.ReceiptTicketID = d.ReceiptTicketID
WHERE t.CreationTime >= DATEADD(day,-60,GETDATE())
GROUP BY ISNULL(NULLIF(d.GateName,''), g.GateName) ORDER BY COUNT(*) DESC
"@) @('name','rows_','last_') @('-30','8','-11')

# --------------------------------------------------------- what it weighs
W ''
W '## 5. WHAT THIS BRIDGE ACTUALLY WEIGHS (last 60 days) - the real working set'
Show (Q @"
SELECT ISNULL(NULLIF(d.ProductName,''), p.ProductName) AS material, COUNT(*) AS rows_,
       COUNT(DISTINCT d.ReceiptTicketID) AS tix, CONVERT(varchar(10), MAX(t.CreationTime), 120) AS last_
FROM TransactionDetail d
LEFT JOIN Product p ON p.ProductID = d.ProductID
JOIN TransactionData t ON t.ReceiptTicketID = d.ReceiptTicketID
WHERE t.CreationTime >= DATEADD(day,-60,GETDATE())
GROUP BY ISNULL(NULLIF(d.ProductName,''), p.ProductName) ORDER BY COUNT(*) DESC
"@) @('material','rows_','tix','last_') @('-30','8','7','-11')

# ------------------------------------------------------- transaction type
W ''
W '## 6. TRANSACTION TYPE vs MATERIAL (Incoming=Processing, Outgoing=Disposal, Both=RDF)'
Show (Q @"
SELECT ISNULL(t.TransactionType,'-') AS txntype,
       UPPER(LTRIM(RTRIM(ISNULL(NULLIF(d.ProductName,''), p.ProductName)))) AS material,
       COUNT(DISTINCT t.ReceiptTicketID) AS tix
FROM TransactionData t
JOIN TransactionDetail d ON d.ReceiptTicketID = t.ReceiptTicketID
LEFT JOIN Product p ON p.ProductID = d.ProductID
WHERE ISNULL(t.Status,'') <> 'Void'
GROUP BY t.TransactionType, UPPER(LTRIM(RTRIM(ISNULL(NULLIF(d.ProductName,''), p.ProductName))))
ORDER BY t.TransactionType, COUNT(DISTINCT t.ReceiptTicketID) DESC
"@) @('txntype','material','tix') @('-12','-30','7')

# ------------------------------------------------------------ custom fields
W ''
W '## 7. CUSTOM FIELDS  (CustomField4 = Package No on WB2)'
foreach ($n in 1..5) {
  W ("  --- CustomField$n ---")
  Show (Q "SELECT ISNULL(NULLIF(LTRIM(RTRIM(CustomField$n)),''),'(blank)') AS value_, COUNT(*) AS tickets, CONVERT(varchar(10),MAX(CreationTime),120) AS last_ FROM TransactionData GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(CustomField$n)),''),'(blank)') ORDER BY COUNT(*) DESC") @('value_','tickets','last_') @('-30','8','-11')
}
$store = "$env:APPDATA\WeighCore\data"
W ''
W '  field configuration (labels / visible / required) from the app store:'
if (Test-Path $store) {
  $f = Get-ChildItem $store -Filter *.json -ErrorAction SilentlyContinue | Select-Object -First 5
  foreach ($x in $f) {
    $txt = Get-Content $x.FullName -Raw
    if ($txt -match 'customFields|cf4') { W ('    ' + $x.Name + '  (contains field config - SEND THIS FILE)') }
    else { W ('    ' + $x.Name) }
  }
} else { W '    (no app store folder found)' }

# ------------------------------------------------------- vehicles/accounts
W ''
W '## 8. OTHER MASTERS'
W ('  Vehicle : ' + (S "SELECT COUNT(*) FROM Vehicle") + ' rows, ' + (S "SELECT COUNT(*) FROM Vehicle WHERE IsActive=1") + ' active, ' + (S "SELECT COUNT(*) FROM (SELECT VehicleNumber FROM Vehicle GROUP BY VehicleNumber HAVING COUNT(*)>1) z") + ' duplicate numbers')
W ('  Account : ' + (S "SELECT COUNT(*) FROM Account") + ' rows, ' + (S "SELECT COUNT(*) FROM Account WHERE Active=1") + ' active, ' + (S "SELECT COUNT(*) FROM (SELECT CompanyName FROM Account GROUP BY CompanyName HAVING COUNT(*)>1) z") + ' duplicate names')
W ('  Gate    : ' + (S "SELECT COUNT(*) FROM Gate") + ' rows, ' + (S "SELECT COUNT(*) FROM Gate WHERE IsActive=1") + ' active')
W ('  Product : ' + (S "SELECT COUNT(*) FROM Product") + ' rows, ' + (S "SELECT COUNT(*) FROM Product WHERE IsActive=1") + ' active')

# --------------------------------------------------------------- sync log
W ''
W '## 9. SYNC HEALTH (last 8 syncs)'
$log = "$env:APPDATA\WeighCore\data\weighcore.log"
if (Test-Path $log) {
  Get-Content $log | Select-String 'vps sync ok|vps sync|SYNC_ERR' | Select-Object -Last 8 | ForEach-Object { W ('  ' + $_.Line) }
} else { W '  (no log found)' }

W ''
W ('=' * 96)
W 'END OF AUDIT - send this whole output back.'
W ('=' * 96)

if ($Out) {
  $lines -join "`r`n" | Out-File -FilePath $Out -Encoding utf8
  Write-Host ''
  Write-Host ("saved -> " + $Out)
}
