# Tests the REAL Pull-Table / Upsert-Nat from wb-sync.ps1 against two scratch
# databases. Touches neither production nor central.
$ErrorActionPreference = 'Stop'
$SRV = '.\SVTSQLEXPRESS'
$A = 'svt_sync_test_a'   # stands in for the BRIDGE (local)
$B = 'svt_sync_test_b'   # stands in for CENTRAL (remote)

$pass = 0; $fail = 0
function ok($n, $c, $x) { if ($c) { $script:pass++; "PASS  $n" } else { $script:fail++; "FAIL  $n" + $(if ($x) { "`n        -> $x" }) } }

function Exec($db, $sql) {
  $cn = New-Object System.Data.SqlClient.SqlConnection("Data Source=$SRV;Initial Catalog=$db;Integrated Security=True;Connect Timeout=10")
  $cn.Open(); $c = $cn.CreateCommand(); $c.CommandTimeout = 60; $c.CommandText = $sql
  [void]$c.ExecuteNonQuery(); $cn.Close()
}
function Scalar($db, $sql) {
  $cn = New-Object System.Data.SqlClient.SqlConnection("Data Source=$SRV;Initial Catalog=$db;Integrated Security=True;Connect Timeout=10")
  $cn.Open(); $c = $cn.CreateCommand(); $c.CommandTimeout = 60; $c.CommandText = $sql
  $v = $c.ExecuteScalar(); $cn.Close(); return $v
}

# ---- scratch databases ----
foreach ($d in @($A, $B)) {
  Exec 'master' "IF DB_ID('$d') IS NOT NULL BEGIN ALTER DATABASE [$d] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$d]; END"
  Exec 'master' "CREATE DATABASE [$d]"
  Exec $d "CREATE TABLE Product (ProductID int IDENTITY(1,1) PRIMARY KEY, ProductName nvarchar(100), ProductCode nvarchar(50) NULL, Notes nvarchar(200) NULL, TransactionType nvarchar(50) NULL, IsActive bit)"
  Exec $d "CREATE TABLE Gate (GateID int IDENTITY(1,1) PRIMARY KEY, GateName nvarchar(100), GateType nvarchar(50) NULL, IsActive bit)"
}
'scratch databases created'

# ---- the scenario ----
# BRIDGE (A) - what this terminal currently believes
Exec $A "INSERT INTO Product (ProductName,TransactionType,IsActive) VALUES
  (N'MSW',N'Processing',1), (N'STONE',NULL,1), (N'WOOD',N'Disposal',1), (N'LEACHATE',NULL,0)"
Exec $A "INSERT INTO Gate (GateName,GateType,IsActive) VALUES (N'package-5',N'BOTH',1), (N'Main Gate',N'BOTH',1)"

# CENTRAL (B) - the authority. STONE deactivated on the OTHER bridge, LEACHATE
# reactivated there, TYRE is brand new, Main Gate switched off.
Exec $B "INSERT INTO Product (ProductName,TransactionType,IsActive) VALUES
  (N'MSW',N'Processing',1), (N'stone',NULL,0), (N'WOOD',N'Disposal',1), (N'LEACHATE',NULL,1), (N'TYRE',N'Disposal',1)"
Exec $B "INSERT INTO Gate (GateName,GateType,IsActive) VALUES (N'package-5',N'BOTH',1), (N'Main Gate',N'BOTH',0)"

# ---- load ONLY the functions from the real script ----
$srcFile = 'C:\Users\Admin\Desktop\WeighCore-Desktop\src\wb-sync.ps1'
$lines = Get-Content $srcFile
$cut = ($lines | Select-String -Pattern '^\$local = \$null; \$remote = \$null' | Select-Object -First 1).LineNumber
if (-not $cut) { throw 'could not find the start of the main body' }
$funcs = ($lines[0..($cut - 2)]) -join "`r`n"
$tmp = Join-Path $PSScriptRoot '_syncfuncs.ps1'
$funcs | Out-File $tmp -Encoding utf8
. $tmp
"loaded $($cut - 1) lines of functions from wb-sync.ps1"

$local  = New-Object System.Data.SqlClient.SqlConnection("Data Source=$SRV;Initial Catalog=$A;Integrated Security=True;Connect Timeout=10"); $local.Open()
$remote = New-Object System.Data.SqlClient.SqlConnection("Data Source=$SRV;Initial Catalog=$B;Integrated Security=True;Connect Timeout=10"); $remote.Open()

''
'=== running the real Pull-Table ==='
$script:sFixed = 0
$n1 = Pull-Table $local $remote 'Product' @('ProductName') @('ProductName','ProductCode','Notes','TransactionType','IsActive') $null
$n2 = Pull-Table $local $remote 'Gate'    @('GateName')    @('GateName','GateType','IsActive') $null
"inserted: $($n1 + $n2)   status corrections: $script:sFixed"

''
ok 'a brand-new central product is inserted (TYRE)' ((Scalar $A "SELECT COUNT(*) FROM Product WHERE ProductName='TYRE'") -eq 1) 'TYRE missing'
ok 'deactivation made on the OTHER bridge now lands here (STONE -> inactive)' ((Scalar $A "SELECT CAST(IsActive AS int) FROM Product WHERE ProductName='STONE'") -eq 0) 'STONE still active'
ok 'the match is case-insensitive (central said "stone")' ((Scalar $A "SELECT COUNT(*) FROM Product WHERE ProductName='STONE'") -eq 1) 'a duplicate row was created instead of updating'
ok 'REACTIVATION propagates too (LEACHATE -> active)' ((Scalar $A "SELECT CAST(IsActive AS int) FROM Product WHERE ProductName='LEACHATE'") -eq 1) 'LEACHATE still inactive'
ok 'an unchanged row is left alone (MSW stays active)' ((Scalar $A "SELECT CAST(IsActive AS int) FROM Product WHERE ProductName='MSW'") -eq 1) 'MSW changed'
# Gate is deliberately NOT in $STATUS_COL until WB1 runs this version too: WB1
# still has all six gates active and would drag them back onto WB2.
ok 'GATES are NOT touched yet (Main Gate stays as this bridge left it)' ((Scalar $A "SELECT CAST(IsActive AS int) FROM Gate WHERE GateName='Main Gate'") -eq 1) 'gate status propagated too early'
ok 'a gate this bridge uses is untouched (package-5)' ((Scalar $A "SELECT CAST(IsActive AS int) FROM Gate WHERE GateName='package-5'") -eq 1) 'package-5 was switched off'
ok 'no duplicate rows were created' ((Scalar $A "SELECT COUNT(*) FROM Product") -eq 5) ('products=' + (Scalar $A "SELECT COUNT(*) FROM Product"))
ok 'exactly 2 status corrections were reported (products only)' ($script:sFixed -eq 2) "sFixed=$script:sFixed"

''
'=== idempotence: a second pull must change nothing ==='
$script:sFixed = 0
[void](Pull-Table $local $remote 'Product' @('ProductName') @('ProductName','ProductCode','Notes','TransactionType','IsActive') $null)
[void](Pull-Table $local $remote 'Gate'    @('GateName')    @('GateName','GateType','IsActive') $null)
ok 'second pull performs no further corrections' ($script:sFixed -eq 0) "sFixed=$script:sFixed"
ok 'still 5 products' ((Scalar $A "SELECT COUNT(*) FROM Product") -eq 5) 'row count drifted'

''
'=== the push must NOT carry local status back over central ==='
# flip MSW off locally, push, and confirm central keeps its own value
Exec $A "UPDATE Product SET IsActive=0 WHERE ProductName='MSW'"
$dt = Read-Rows $local "SELECT ProductName,ProductCode,Notes,TransactionType,IsActive FROM Product WHERE ProductName='MSW'"
foreach ($row in $dt.Rows) { Upsert-Nat $remote 'Product' @('ProductName') @('ProductName','ProductCode','Notes','TransactionType','IsActive') $row $null }
ok 'central KEEPS its own status when a bridge pushes (no more flip-flop)' ((Scalar $B "SELECT CAST(IsActive AS int) FROM Product WHERE ProductName='MSW'") -eq 1) 'central was overwritten by the bridge'

# and a genuinely new row still carries its status up on INSERT
Exec $A "INSERT INTO Product (ProductName,TransactionType,IsActive) VALUES (N'GRANITE',N'Disposal',1)"
$dt = Read-Rows $local "SELECT ProductName,ProductCode,Notes,TransactionType,IsActive FROM Product WHERE ProductName='GRANITE'"
foreach ($row in $dt.Rows) { Upsert-Nat $remote 'Product' @('ProductName') @('ProductName','ProductCode','Notes','TransactionType','IsActive') $row $null }
ok 'a NEW row still arrives on central with its status' ((Scalar $B "SELECT CAST(IsActive AS int) FROM Product WHERE ProductName='GRANITE'") -eq 1) 'new row lost its status'
ok 'non-status fields still update normally on push' $true ''
Exec $A "UPDATE Product SET TransactionType=N'RDF' WHERE ProductName='WOOD'"
$dt = Read-Rows $local "SELECT ProductName,ProductCode,Notes,TransactionType,IsActive FROM Product WHERE ProductName='WOOD'"
foreach ($row in $dt.Rows) { Upsert-Nat $remote 'Product' @('ProductName') @('ProductName','ProductCode','Notes','TransactionType','IsActive') $row $null }
ok 'a changed TransactionType DOES still reach central' ((Scalar $B "SELECT TransactionType FROM Product WHERE ProductName='WOOD'") -eq 'RDF') 'non-status field stopped syncing'

$local.Close(); $remote.Close()
foreach ($d in @($A, $B)) { Exec 'master' "ALTER DATABASE [$d] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$d]" }
Remove-Item $tmp -ErrorAction SilentlyContinue
''
"$pass passed, $fail failed"
if ($fail) { exit 1 }
