param(
  [string]$LocalServer   = '.\SVTSQLEXPRESS',
  [string]$LocalDatabase = 'svt_weighbridge',
  [string]$RemoteServer  = '127.0.0.1,14330',
  [string]$RemoteDatabase= 'svt_weighbridge',
  [string]$RemoteUser    = 'weighcore',
  [string]$RemotePassword= '',
  [string]$ScaleID       = 'P5WB2',
  [int]$WindowDays       = 7
)
# SQL-to-SQL replication, multi-bridge safe: local (authoritative) -> central.
#  - masters are merged into ONE central list by NATURAL KEY (VehicleNumber,
#    ProductName, ...) so two bridges never duplicate or ID-collide.
#  - cross-DB foreign keys are REMAPPED to central IDs via those natural keys.
#  - transactions are stamped with $ScaleID and keyed by (ScaleID, ReceiptTicketID),
#    so WB1 #1 and WB2 #1 stay distinct centrally. Idempotent + self-healing.
# Emits 'SYNC_OK:{...}' or 'SYNC_ERR:<msg>' (exit 1).
$ErrorActionPreference = 'Stop'

function Read-Rows($conn, $sql) {
  $cmd = $conn.CreateCommand(); $cmd.CommandTimeout = 120; $cmd.CommandText = $sql
  $da = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
  $dt = New-Object System.Data.DataTable; [void]$da.Fill($dt); return ,$dt
}
function DbNull($v) { if ($v -eq $null -or $v -is [System.DBNull]) { return $true } return $false }

# ---------------------------------------------------------------------------
# Active/inactive on a master row is CENTRAL-AUTHORITATIVE.
#
# Masters merge by natural key, so both bridges hold a row for the same name.
# Previously each bridge pushed its whole master list every cycle and the pull
# skipped any name it already had, so a deactivation on one bridge (a) never
# reached the other and (b) was overwritten on central by whichever bridge
# synced last — the value oscillated and nothing ever converged.
#
# Now: a bridge NEVER overwrites the status column of an existing central row
# (it still supplies it when INSERTing a brand-new row), and the pull applies
# central's status to rows it already has. One value, one authority, no flap.
# Everything else about the row still flows bridge -> central as before.
#
# The app writes a status change straight to central (sqldb.saveMaster), so the
# Masters screen keeps working; this is what makes the change visible to the
# other bridge on its next cycle.
# ---------------------------------------------------------------------------
# GATE IS DELIBERATELY ABSENT — add it only once BOTH bridges run this version.
# Until then WB1 still runs the old sync, which pushes its whole master list every
# cycle: on 2026-09-17 it set Main Gate, test and package-5 WB 2 back to active on
# central minutes after WB2 deactivated them. Turning gate status on here while
# WB1 is unpatched would pull WB1's list down and restore all six gates on WB2.
# package-5 is also WB1's live gate (56,869 rows, used today) while being junk on
# WB2, so a shared gate status cannot be right for both until WB1 has moved its
# weighments onto Package 5 Wb1. WeightBridge is out for good — it is per-machine
# hardware and is never pulled.
$STATUS_COL = @{
  'Product'    = 'IsActive'; 'Vehicle'  = 'IsActive'
  'Account'    = 'Active';   'Driver'   = 'Active'
  'UserMaster' = 'Active';   'Template' = 'Active'
}
function StatusCol($table) { if ($STATUS_COL.ContainsKey($table)) { return $STATUS_COL[$table] } return $null }

# localId -> centralId, matched on a natural-key expression present in both DBs
function Build-Map($local, $remote, $table, $pk, $natExpr) {
  $map = @{}; $rem = @{}
  $dr = Read-Rows $remote "SELECT [$pk] AS id, ($natExpr) AS nk FROM [$table]"
  foreach ($r in $dr.Rows) { if (-not (DbNull $r['nk'])) { $rem[[string]$r['nk']] = $r['id'] } }
  $dl = Read-Rows $local  "SELECT [$pk] AS id, ($natExpr) AS nk FROM [$table]"
  foreach ($r in $dl.Rows) { $k = [string]$r['nk']; if ($rem.ContainsKey($k)) { $map[[int]$r['id']] = $rem[$k] } }
  return ,$map
}
function Remap($map, $v) { if (DbNull $v) { return [System.DBNull]::Value }; $iv = [int]$v; if ($map.ContainsKey($iv)) { return $map[$iv] } return [System.DBNull]::Value }

# UPSERT one row into $remote keyed by natural-key columns; $remap = @{ colName = idMap }
function Upsert-Nat($remote, $table, $natCols, $writeCols, $row, $remap) {
  # the status column is deliberately absent from the UPDATE set: central owns it
  $skip   = StatusCol $table
  $srcSel = ($writeCols | ForEach-Object { "@p_$_ AS [$_]" }) -join ','
  $on     = ($natCols   | ForEach-Object { "ISNULL(tgt.[$_],'')=ISNULL(src.[$_],'')" }) -join ' AND '
  $upd    = ($writeCols | Where-Object { $natCols -notcontains $_ -and $_ -ne $skip } | ForEach-Object { "tgt.[$_]=src.[$_]" }) -join ','
  $insC   = ($writeCols | ForEach-Object { "[$_]" }) -join ','
  $insV   = ($writeCols | ForEach-Object { "src.[$_]" }) -join ','
  $whenMatched = if ($upd) { "WHEN MATCHED THEN UPDATE SET $upd " } else { "" }
  $sql = "MERGE [$table] AS tgt USING (SELECT $srcSel) AS src ON $on " +
         "$whenMatched WHEN NOT MATCHED THEN INSERT ($insC) VALUES ($insV);"
  $cmd = $remote.CreateCommand(); $cmd.CommandTimeout = 60; $cmd.CommandText = $sql
  foreach ($c in $writeCols) {
    $v = $row[$c]
    if ($remap -and $remap.ContainsKey($c)) { $v = Remap $remap[$c] $v }
    # legacy serial settings store words ('One') where central wants integers
    if (@('StopBits','DataBits','BaudRate') -contains $c -and $v -is [string]) {
      $w = $v.Trim().ToLower()
      if ($w -eq 'one') { $v = 1 }
      elseif ($w -eq 'two') { $v = 2 }
      else { $d = 0.0; if ([double]::TryParse($w, [ref]$d)) { $v = $d } else { $v = [System.DBNull]::Value } }
    }
    if (DbNull $v) { [void]$cmd.Parameters.AddWithValue("@p_$c", [System.DBNull]::Value) }
    else { [void]$cmd.Parameters.AddWithValue("@p_$c", $v) }
  }
  [void]$cmd.ExecuteNonQuery()
}

# Pull central rows missing locally (by natural key) into local, FK-remapped central->local
function Pull-Table($local, $remote, $table, $natCols, $insCols, $remap) {
  $status = StatusCol $table
  $have = @{}
  $sel = $natCols
  if ($status -and $insCols -contains $status) { $sel = @($natCols) + @($status) }
  $dl = Read-Rows $local ("SELECT " + (($sel | ForEach-Object { "[$_]" }) -join ',') + " FROM [$table]")
  foreach ($r in $dl.Rows) {
    $k = (($natCols | ForEach-Object { [string]$r[$_] }) -join '|')
    $have[$k] = if ($status -and $insCols -contains $status) { $r[$status] } else { 1 }
  }
  $dr = Read-Rows $remote ("SELECT " + (($insCols | ForEach-Object { "[$_]" }) -join ',') + " FROM [$table]")
  $n = 0
  foreach ($r in $dr.Rows) {
    $k = (($natCols | ForEach-Object { [string]$r[$_] }) -join '|')
    if ($have.ContainsKey($k)) {
      # row exists locally: central owns active/inactive, so apply it if it differs
      if ($status -and $insCols -contains $status -and -not (DbNull $r[$status])) {
        $want = [int]$r[$status]
        $mine = if (DbNull $have[$k]) { -1 } else { [int]$have[$k] }
        if ($mine -ne $want) {
          $u = $local.CreateCommand()
          $where = ($natCols | ForEach-Object { "ISNULL([$_],'')=ISNULL(@k_$_,'')" }) -join ' AND '
          $u.CommandText = "UPDATE [$table] SET [$status]=@s WHERE $where"
          [void]$u.Parameters.AddWithValue('@s', $want)
          foreach ($c in $natCols) {
            $kv = $r[$c]
            if (DbNull $kv) { [void]$u.Parameters.AddWithValue("@k_$c", [System.DBNull]::Value) }
            else { [void]$u.Parameters.AddWithValue("@k_$c", $kv) }
          }
          [void]$u.ExecuteNonQuery(); $script:sFixed++
        }
      }
      continue
    }
    $ins = $local.CreateCommand()
    $ins.CommandText = "INSERT INTO [$table] (" + (($insCols | ForEach-Object { "[$_]" }) -join ',') + ") VALUES (" + (($insCols | ForEach-Object { "@p_$_" }) -join ',') + ")"
    foreach ($c in $insCols) {
      $v = $r[$c]; if ($remap -and $remap.ContainsKey($c)) { $v = Remap $remap[$c] $v }
      if (DbNull $v) { [void]$ins.Parameters.AddWithValue("@p_$c", [System.DBNull]::Value) } else { [void]$ins.Parameters.AddWithValue("@p_$c", $v) }
    }
    [void]$ins.ExecuteNonQuery(); $n++
  }
  return $n
}

$local = $null; $remote = $null
try {
  $local = New-Object System.Data.SqlClient.SqlConnection "Server=$LocalServer;Database=$LocalDatabase;Integrated Security=True;Connection Timeout=15"
  $local.Open()
  $remote = New-Object System.Data.SqlClient.SqlConnection "Server=$RemoteServer;Database=$RemoteDatabase;User ID=$RemoteUser;Password=$RemotePassword;Encrypt=True;TrustServerCertificate=True;Connection Timeout=20"
  $remote.Open()

  $mCount = 0
  function PushTable($t, $nat, $cols, $remap) {
    $script:mCount = $script:mCount
    $sel = "SELECT " + (($cols | ForEach-Object { "[$_]" }) -join ',') + " FROM [$t]"
    $dt = Read-Rows $local $sel
    foreach ($r in $dt.Rows) { Upsert-Nat $remote $t $nat $cols $r $remap; $script:mCount++ }
  }

  # tier 1: no cross-master FK
  PushTable 'Unit'     @('UnitName')     @('UnitName') $null
  PushTable 'Template' @('TemplateName') @('TemplateName','Active') $null
  PushTable 'Account'  @('CompanyName')  @('AccountCode','CompanyName','FirstName','LastName','ContactNo','IsAccount','IsTransporter','City','Active') $null
  PushTable 'Product'  @('ProductName')  @('ProductName','ProductCode','Notes','TransactionType','IsActive') $null
  PushTable 'Gate'     @('GateName')     @('GateName','GateType','IsActive') $null

  $accMap  = Build-Map $local $remote 'Account'  'AccountID'  'CompanyName'
  $unitMap = Build-Map $local $remote 'Unit'     'UnitID'     'UnitName'
  $tmplMap = Build-Map $local $remote 'Template' 'TemplateID' 'TemplateName'

  # tier 2: FK -> central via natural key
  PushTable 'Vehicle'      @('VehicleNumber') @('VehicleNumber','VehicleType','TareWeight','AccountID','IsActive') @{ AccountID = $accMap }
  PushTable 'Driver'       @('FirstName','LastName') @('FirstName','LastName','IDProofNo','AccountID','Active') @{ AccountID = $accMap }
  PushTable 'WeightBridge' @('ScaleName') @('ScaleName','MaxCapacity','UnitID','IsActive','COMPort','BaudRate','DataBits','Parity','StopBits') @{ UnitID = $unitMap }
  PushTable 'UserMaster'   @('UserName') @('UserName','FirstName','LastName','Email','ContactNo','TemplateID','Salt','Active') @{ TemplateID = $tmplMap }

  # ---- pull central masters down into local (shared pick-lists) ----
  # sFixed counts rows whose active/inactive was corrected FROM central — this is
  # how a deactivation made on the other bridge finally lands here.
  $script:sFixed = 0
  $pCount = 0
  $pCount += Pull-Table $local $remote 'Unit'     @('UnitName')     @('UnitName') $null
  $pCount += Pull-Table $local $remote 'Template' @('TemplateName') @('TemplateName','Active') $null
  $pCount += Pull-Table $local $remote 'Account'  @('CompanyName')  @('AccountCode','CompanyName','FirstName','LastName','ContactNo','IsAccount','IsTransporter','City','Active') $null
  $pCount += Pull-Table $local $remote 'Product'  @('ProductName')  @('ProductName','ProductCode','Notes','TransactionType','IsActive') $null
  $pCount += Pull-Table $local $remote 'Gate'     @('GateName')     @('GateName','GateType','IsActive') $null
  $accMapR  = Build-Map $remote $local 'Account'  'AccountID'  'CompanyName'
  $tmplMapR = Build-Map $remote $local 'Template' 'TemplateID' 'TemplateName'
  $pCount += Pull-Table $local $remote 'Vehicle'    @('VehicleNumber') @('VehicleNumber','VehicleType','TareWeight','AccountID','IsActive') @{ AccountID = $accMapR }
  $pCount += Pull-Table $local $remote 'Driver'     @('FirstName','LastName') @('FirstName','LastName','IDProofNo','AccountID','Active') @{ AccountID = $accMapR }
  $pCount += Pull-Table $local $remote 'UserMaster' @('UserName') @('UserName','FirstName','LastName','Email','ContactNo','TemplateID','Salt','Active') @{ TemplateID = $tmplMapR }

  # maps for transaction FK remap
  $vehMap    = Build-Map $local $remote 'Vehicle'      'VehicleID'      'VehicleNumber'
  $prodMap   = Build-Map $local $remote 'Product'      'ProductID'      'ProductName'
  $gateMap   = Build-Map $local $remote 'Gate'         'GateID'         'GateName'
  $bridgeMap = Build-Map $local $remote 'WeightBridge' 'WeightBridgeID' 'ScaleName'
  $userMap   = Build-Map $local $remote 'UserMaster'   'UserID'         'UserName'
  $drvMap    = Build-Map $local $remote 'Driver'       'DriverID'       "LTRIM(RTRIM(ISNULL(FirstName,'')))+'|'+LTRIM(RTRIM(ISNULL(LastName,'')))"

  # ---- transactions ----
  $TXN = @('TicketID','VehicleID','DriverID','AccountID','TransporterID','Status','TransactionMode','TransactionType','PlantDirectionType','ReceiptTicketID','Charges','CreationTime','CreatedBy','VehicleNumber','DriverName','TransporterName','AccountName','CustomField1','CustomField2','CustomField3','CustomField4','CustomField5')
  $DET = @('ReceiptTicketID','WeightBridgeID','SequenceNo','ProductID','GateID','WeighmentType','CaptureWeight','CaptureTime','GrossWeight','GrossTime','TareWeight','TareTime','NetWeight','WeightUnit','UserID','UserName','WeighbridgeName','ProductName','GateName','IsTareManual','IsGrossManual','IsCapturedManual')
  $txnRemap = @{ VehicleID=$vehMap; DriverID=$drvMap; AccountID=$accMap; TransporterID=$accMap; CreatedBy=$userMap }
  $detRemap = @{ WeightBridgeID=$bridgeMap; ProductID=$prodMap; GateID=$gateMap; UserID=$userMap }

  $txnSel = "SELECT " + (($TXN | ForEach-Object { "[$_]" }) -join ',') +
            " FROM TransactionData WHERE CreationTime IS NULL OR CreationTime >= DATEADD(day,-$WindowDays,GETDATE())"
  $txns = Read-Rows $local $txnSel
  $tCount = 0; $dCount = 0
  foreach ($t in $txns.Rows) {
    # upsert TransactionData by (ScaleID, ReceiptTicketID)
    $wcols = @('ScaleID') + $TXN
    $srcSel = ($wcols | ForEach-Object { "@p_$_ AS [$_]" }) -join ','
    $upd = ($TXN | Where-Object { $_ -ne 'ReceiptTicketID' } | ForEach-Object { "tgt.[$_]=src.[$_]" }) -join ','
    $insC = ($wcols | ForEach-Object { "[$_]" }) -join ','
    $insV = ($wcols | ForEach-Object { "src.[$_]" }) -join ','
    $sql = "MERGE TransactionData AS tgt USING (SELECT $srcSel) AS src ON tgt.ScaleID=src.ScaleID AND tgt.ReceiptTicketID=src.ReceiptTicketID " +
           "WHEN MATCHED THEN UPDATE SET $upd WHEN NOT MATCHED THEN INSERT ($insC) VALUES ($insV);"
    $cmd = $remote.CreateCommand(); $cmd.CommandTimeout = 60; $cmd.CommandText = $sql
    [void]$cmd.Parameters.AddWithValue("@p_ScaleID", $ScaleID)
    foreach ($c in $TXN) {
      $v = $t[$c]; if ($txnRemap.ContainsKey($c)) { $v = Remap $txnRemap[$c] $v }
      if (DbNull $v) { [void]$cmd.Parameters.AddWithValue("@p_$c", [System.DBNull]::Value) } else { [void]$cmd.Parameters.AddWithValue("@p_$c", $v) }
    }
    [void]$cmd.ExecuteNonQuery(); $tCount++

    $rid = $t['ReceiptTicketID']
    if (-not (DbNull $rid)) {
      $del = $remote.CreateCommand(); $del.CommandText = "DELETE FROM TransactionDetail WHERE ScaleID=@s AND ReceiptTicketID=@r"
      [void]$del.Parameters.AddWithValue("@s", $ScaleID); [void]$del.Parameters.AddWithValue("@r", $rid); [void]$del.ExecuteNonQuery()
      $dcmd = $local.CreateCommand(); $dcmd.CommandText = "SELECT " + (($DET | ForEach-Object { "[$_]" }) -join ',') + " FROM TransactionDetail WHERE ReceiptTicketID=@r ORDER BY SequenceNo"
      [void]$dcmd.Parameters.AddWithValue("@r", $rid)
      $dda = New-Object System.Data.SqlClient.SqlDataAdapter $dcmd; $ddt = New-Object System.Data.DataTable; [void]$dda.Fill($ddt)
      foreach ($d in $ddt.Rows) {
        $wc = @('ScaleID') + $DET
        $ins = $remote.CreateCommand()
        $ins.CommandText = "INSERT INTO TransactionDetail (" + (($wc | ForEach-Object { "[$_]" }) -join ',') + ") VALUES (" + (($wc | ForEach-Object { "@p_$_" }) -join ',') + ")"
        [void]$ins.Parameters.AddWithValue("@p_ScaleID", $ScaleID)
        foreach ($c in $DET) {
          $v = $d[$c]; if ($detRemap.ContainsKey($c)) { $v = Remap $detRemap[$c] $v }
          if (DbNull $v) { [void]$ins.Parameters.AddWithValue("@p_$c", [System.DBNull]::Value) } else { [void]$ins.Parameters.AddWithValue("@p_$c", $v) }
        }
        [void]$ins.ExecuteNonQuery(); $dCount++
      }
    }
  }

  # ---- push capture photos (only the ones not already on central) ----
  $iCount = 0
  $have = @{}
  $ci = Read-Rows $remote "SELECT CONVERT(varchar(40),ImageID) AS id FROM TransactionImage WHERE ScaleID=N'$ScaleID'"
  foreach ($r in $ci.Rows) { $have[([string]$r['id']).ToUpper()] = 1 }
  $li = Read-Rows $local "SELECT ImageID,ReceiptTicketID,TicketID,CameraID,Seq,Kind,ImageData,CreatedAt FROM TransactionImage WHERE CreatedAt IS NULL OR CreatedAt >= DATEADD(day,-$WindowDays,GETDATE())"
  foreach ($r in $li.Rows) {
    if ($have.ContainsKey(([string]$r['ImageID']).ToUpper())) { continue }
    $ins = $remote.CreateCommand()
    $ins.CommandText = "INSERT INTO TransactionImage (ImageID,ScaleID,ReceiptTicketID,TicketID,CameraID,Seq,Kind,ImageData,CreatedAt) VALUES (@id,@sc,@r,@t,@c,@q,@k,@d,@ct)"
    [void]$ins.Parameters.AddWithValue('@id', $r['ImageID'])
    [void]$ins.Parameters.AddWithValue('@sc', $ScaleID)
    foreach ($pair in @(@('@r','ReceiptTicketID'),@('@t','TicketID'),@('@c','CameraID'),@('@q','Seq'),@('@k','Kind'),@('@d','ImageData'),@('@ct','CreatedAt'))) {
      $v = $r[$pair[1]]
      if ($v -eq $null -or $v -is [System.DBNull]) { [void]$ins.Parameters.AddWithValue($pair[0], [System.DBNull]::Value) } else { [void]$ins.Parameters.AddWithValue($pair[0], $v) }
    }
    [void]$ins.ExecuteNonQuery(); $iCount++
  }

  $local.Close(); $remote.Close()
  [Console]::Out.Write("SYNC_OK:{""scale"":""$ScaleID"",""masters"":$mCount,""pulled"":$pCount,""status"":$script:sFixed,""tickets"":$tCount,""details"":$dCount,""images"":$iCount}")
} catch {
  try { if ($local) { $local.Close() } } catch {}
  try { if ($remote) { $remote.Close() } } catch {}
  [Console]::Error.WriteLine("SYNC_ERR:" + $_.Exception.Message + "  @ " + ($_.ScriptStackTrace -split "`n")[0])
  exit 1
}
