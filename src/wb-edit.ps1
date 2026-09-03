param(
  [string]$Server, [string]$Database, [string]$ScaleID, [string]$Rid,
  [int]$TicketID = 0, [string]$Field, [string]$NewValue, [string]$Reason, [string]$UserName
)
# Correct ONE saved weight (GrossWeight or TareWeight) on a ticket, fully
# audited. Inside a single SQL transaction: read the old value, update the
# detail row that carries it (and its CaptureWeight when that row IS the
# edited pass), recompute NetWeight on the ticket's last row the same way the
# app reads it (MAX(Gross) - MAX(Tare)), and write a TransactionAudit row.
# Parameterised, integrated security — same conventions as wb-image.ps1.
$ErrorActionPreference = 'Stop'
$cn = $null; $tx = $null
try {
  if ($Field -ne 'GrossWeight' -and $Field -ne 'TareWeight') { throw 'Field must be GrossWeight or TareWeight' }
  if ([string]::IsNullOrWhiteSpace($Rid)) { throw 'Rid required' }
  if ([string]::IsNullOrWhiteSpace($Reason)) { throw 'Reason required' }
  $rid = [System.Guid]::Parse($Rid)
  $v = [double]::Parse($NewValue, [System.Globalization.CultureInfo]::InvariantCulture)
  if ($v -lt 0) { throw 'weight must not be negative' }
  $kind = if ($Field -eq 'GrossWeight') { 'Gross' } else { 'Tare' }

  $cn = New-Object System.Data.SqlClient.SqlConnection "Server=$Server;Database=$Database;Integrated Security=True;Connect Timeout=10"
  $cn.Open()
  $tx = $cn.BeginTransaction()

  # the row that carries this weight: last pass with a value in the column,
  # else last pass of the matching weighment type ($Field is whitelisted above)
  $c = $cn.CreateCommand(); $c.Transaction = $tx
  $c.CommandText = "SELECT TOP 1 SequenceNo, $Field FROM TransactionDetail WHERE ReceiptTicketID=@r AND $Field IS NOT NULL AND $Field <> 0 ORDER BY SequenceNo DESC"
  [void]$c.Parameters.AddWithValue('@r', $rid)
  $rd = $c.ExecuteReader(); $seq = $null; $old = $null
  if ($rd.Read()) { $seq = [int]$rd[0]; if ($rd[1] -isnot [System.DBNull]) { $old = [double]$rd[1] } }
  $rd.Close()
  if ($null -eq $seq) {
    $c2 = $cn.CreateCommand(); $c2.Transaction = $tx
    $c2.CommandText = "SELECT TOP 1 SequenceNo, $Field FROM TransactionDetail WHERE ReceiptTicketID=@r AND WeighmentType LIKE @k + '%' ORDER BY SequenceNo DESC"
    [void]$c2.Parameters.AddWithValue('@r', $rid)
    [void]$c2.Parameters.AddWithValue('@k', $kind)
    $rd2 = $c2.ExecuteReader()
    if ($rd2.Read()) { $seq = [int]$rd2[0]; if ($rd2[1] -isnot [System.DBNull]) { $old = [double]$rd2[1] } }
    $rd2.Close()
  }
  if ($null -eq $seq) { throw "no $kind row on this ticket" }

  # write the new weight; CaptureWeight follows only when this row IS that pass
  $u = $cn.CreateCommand(); $u.Transaction = $tx
  $u.CommandText = "UPDATE TransactionDetail SET $Field=@v, CaptureWeight = CASE WHEN WeighmentType LIKE @k + '%' THEN @v ELSE CaptureWeight END WHERE ReceiptTicketID=@r AND SequenceNo=@s"
  [void]$u.Parameters.AddWithValue('@v', $v)
  [void]$u.Parameters.AddWithValue('@k', $kind)
  [void]$u.Parameters.AddWithValue('@r', $rid)
  [void]$u.Parameters.AddWithValue('@s', $seq)
  if ($u.ExecuteNonQuery() -lt 1) { throw 'weight row vanished during update' }

  # recompute NetWeight on the last row — where the app reads it from
  $n = $cn.CreateCommand(); $n.Transaction = $tx
  $n.CommandText = @"
UPDATE TransactionDetail SET NetWeight = (
  SELECT CASE WHEN MAX(GrossWeight) > 0 AND MAX(TareWeight) > 0
              THEN MAX(GrossWeight) - MAX(TareWeight) ELSE NULL END
  FROM TransactionDetail WHERE ReceiptTicketID=@r)
WHERE ReceiptTicketID=@r AND SequenceNo = (SELECT MAX(SequenceNo) FROM TransactionDetail WHERE ReceiptTicketID=@r)
"@
  [void]$n.Parameters.AddWithValue('@r', $rid)
  [void]$n.ExecuteNonQuery()

  # the audit row IS the point of this feature — no audit, no commit
  $a = $cn.CreateCommand(); $a.Transaction = $tx
  $a.CommandText = "INSERT INTO TransactionAudit (AuditID,ScaleID,ReceiptTicketID,TicketID,Action,FieldName,OldValue,NewValue,Reason,UserName,CreatedAt) VALUES (NEWID(),@sc,@r,@t,'EditWeight',@f,@old,@new,@rsn,@u,GETDATE())"
  [void]$a.Parameters.AddWithValue('@sc', $ScaleID)
  [void]$a.Parameters.AddWithValue('@r', $rid)
  [void]$a.Parameters.AddWithValue('@t', $TicketID)
  [void]$a.Parameters.AddWithValue('@f', $Field)
  if ($null -eq $old) { [void]$a.Parameters.AddWithValue('@old', [System.DBNull]::Value) }
  else { [void]$a.Parameters.AddWithValue('@old', [string]$old) }
  [void]$a.Parameters.AddWithValue('@new', [string]$v)
  [void]$a.Parameters.AddWithValue('@rsn', $Reason)
  [void]$a.Parameters.AddWithValue('@u', $UserName)
  if ($a.ExecuteNonQuery() -ne 1) { throw 'audit insert failed' }

  $tx.Commit()
  $cn.Close()
  [Console]::Out.Write('OK')
} catch {
  try { if ($tx) { $tx.Rollback() } } catch {}
  try { if ($cn) { $cn.Close() } } catch {}
  [Console]::Error.WriteLine('ERR:' + $_.Exception.Message)
  exit 1
}
