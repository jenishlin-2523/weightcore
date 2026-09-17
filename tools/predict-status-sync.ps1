$ErrorActionPreference = 'Stop'
$cfg = Get-Content 'C:\ProgramData\WeighCore\config.json' -Raw | ConvertFrom-Json
$v = $cfg.vpsSql
$port = 14330; if ($v.ssh -and $v.ssh.localPort) { $port = $v.ssh.localPort }
$server = if ($v.server) { $v.server } else { '127.0.0.1,' + $port }
$RCS = "Server=$server;Database=$(if($v.database){$v.database}else{'svt_weighbridge'});User ID=$($v.user);Password=$($v.password);Encrypt=True;TrustServerCertificate=True;Connection Timeout=20"
$LCS = "Data Source=.\SVTSQLEXPRESS;Initial Catalog=svt_weighbridge;Integrated Security=True;Connect Timeout=10"
function Rows($cs, $sql) {
  $cn = New-Object System.Data.SqlClient.SqlConnection($cs); $cn.Open()
  $c = $cn.CreateCommand(); $c.CommandTimeout = 120; $c.CommandText = $sql
  $da = New-Object System.Data.SqlClient.SqlDataAdapter($c); $dt = New-Object System.Data.DataTable
  [void]$da.Fill($dt); $cn.Close(); return ,$dt
}

# exactly the tables the new $STATUS_COL covers (Gate deliberately excluded)
$M = @(
  @{ t = 'Product';    k = 'ProductName';   s = 'IsActive' },
  @{ t = 'Vehicle';    k = 'VehicleNumber'; s = 'IsActive' },
  @{ t = 'Account';    k = 'CompanyName';   s = 'Active'   },
  @{ t = 'Driver';     k = 'FirstName';     s = 'Active'   },
  @{ t = 'UserMaster'; k = 'UserName';      s = 'Active'   },
  @{ t = 'Template';   k = 'TemplateName';  s = 'Active'   }
)

'WHAT THE FIRST SYNC AFTER DEPLOY WILL CHANGE ON WB2'
'(central is authoritative; anything listed below gets rewritten locally)'
''
$total = 0
foreach ($m in $M) {
  $loc = @{}
  foreach ($r in (Rows $LCS "SELECT [$($m.k)] AS k, [$($m.s)] AS s FROM [$($m.t)]")) {
    $key = ([string]$r['k']).Trim()
    if ($key -ne '') { $loc[$key] = $(if ($r['s'] -is [System.DBNull]) { -1 } else { [int]$r['s'] }) }
  }
  $diff = @()
  foreach ($r in (Rows $RCS "SELECT [$($m.k)] AS k, [$($m.s)] AS s FROM [$($m.t)]")) {
    $key = ([string]$r['k']).Trim()
    if ($key -eq '' -or -not $loc.ContainsKey($key)) { continue }
    if ($r['s'] -is [System.DBNull]) { continue }
    $want = [int]$r['s']
    if ($loc[$key] -ne $want) { $diff += ('{0}  {1} -> {2}' -f $key, $loc[$key], $want) }
  }
  $total += $diff.Count
  '{0,-12} local={1,-6} changes={2}' -f $m.t, $loc.Count, $diff.Count
  foreach ($d in ($diff | Select-Object -First 12)) { '     ' + $d }
  if ($diff.Count -gt 12) { '     ... and ' + ($diff.Count - 12) + ' more' }
}
''
'TOTAL local rows that would change status on the first sync: ' + $total
if ($total -eq 0) { '  -> the first sync is a NO-OP for status; WB2 and central already agree.' }
