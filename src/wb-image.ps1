param(
  [string]$Server, [string]$Database, [string]$ScaleID, [string]$Rid,
  [int]$TicketID = 0, [string]$CameraID, [int]$Seq = 0, [string]$Kind, [string]$File
)
# Insert one weighment capture photo into the local TransactionImage table as
# VARBINARY (parameterised, so large JPEG bytes travel cleanly). Integrated security.
$ErrorActionPreference = 'Stop'
try {
  $bytes = [System.IO.File]::ReadAllBytes($File)
  $cn = New-Object System.Data.SqlClient.SqlConnection "Server=$Server;Database=$Database;Integrated Security=True"
  $cn.Open()
  $c = $cn.CreateCommand()
  $c.CommandText = "INSERT INTO TransactionImage (ImageID,ScaleID,ReceiptTicketID,TicketID,CameraID,Seq,Kind,ImageData,CreatedAt) VALUES (NEWID(),@sc,@r,@t,@c,@q,@k,@d,GETDATE())"
  [void]$c.Parameters.AddWithValue('@sc', $ScaleID)
  if ([string]::IsNullOrWhiteSpace($Rid)) { [void]$c.Parameters.AddWithValue('@r', [System.DBNull]::Value) }
  else { [void]$c.Parameters.AddWithValue('@r', [System.Guid]::Parse($Rid)) }
  [void]$c.Parameters.AddWithValue('@t', $TicketID)
  [void]$c.Parameters.AddWithValue('@c', $CameraID)
  [void]$c.Parameters.AddWithValue('@q', $Seq)
  [void]$c.Parameters.AddWithValue('@k', $Kind)
  $p = $c.Parameters.Add('@d', [System.Data.SqlDbType]::VarBinary); $p.Value = $bytes
  [void]$c.ExecuteNonQuery()
  $cn.Close()
  [Console]::Out.Write('OK')
} catch {
  [Console]::Error.WriteLine('IMGERR:' + $_.Exception.Message); exit 1
}
