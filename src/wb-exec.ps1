param([string]$Server,[string]$Database,[string]$PayloadFile)
# Static SQL runner. All dynamic content arrives as DATA in $PayloadFile (JSON):
#   { mode:'scalar', sql }                       -> OK:<scalar>
#   { mode:'row',    sql }                       -> OK:<json object or empty>
#   { mode:'tx', allocate, tid, statements:[] }  -> OK:<tid>   (atomic; {TID} token replaced)
$ErrorActionPreference='Stop'
$tx=$null
try {
  $raw = Get-Content -LiteralPath $PayloadFile -Raw -Encoding UTF8
  $p = ConvertFrom-Json $raw
  $cn = New-Object System.Data.SqlClient.SqlConnection "Server=$Server;Database=$Database;Integrated Security=True"
  $cn.Open()
  if ($p.mode -eq 'scalar') {
    $c=$cn.CreateCommand(); $c.CommandText=$p.sql
    [Console]::Out.Write('OK:'+$c.ExecuteScalar())
  } elseif ($p.mode -eq 'row') {
    $c=$cn.CreateCommand(); $c.CommandText=$p.sql
    $r=$c.ExecuteReader()
    if ($r.Read()) {
      $h=[ordered]@{}
      for ($i=0; $i -lt $r.FieldCount; $i++) { $v=$r[$i]; if ($v -is [DBNull]) { $v=$null }; $h[$r.GetName($i)]=$v }
      [Console]::Out.Write('OK:'+([pscustomobject]$h | ConvertTo-Json -Compress))
    } else { [Console]::Out.Write('OK:') }
    $r.Close()
  } else {
    $tx=$cn.BeginTransaction()
    $tid=0
    if ($p.allocate) { $c=$cn.CreateCommand(); $c.Transaction=$tx; $c.CommandText=$p.allocate; $tid=[int]$c.ExecuteScalar() }
    if ($p.tid) { $tid=[int]$p.tid }
    foreach ($s in $p.statements) {
      $c=$cn.CreateCommand(); $c.Transaction=$tx; $c.CommandText=$s.Replace('{TID}',[string]$tid)
      [void]$c.ExecuteNonQuery()
    }
    $tx.Commit()
    [Console]::Out.Write('OK:'+$tid)
  }
  $cn.Close()
} catch {
  try { if ($tx) { $tx.Rollback() } } catch {}
  [Console]::Error.WriteLine('SAVEERR:'+$_.Exception.Message)
  exit 1
}
