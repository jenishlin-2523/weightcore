param(
  [string]$SshHost, [string]$SshUser = 'root',
  [int]$LocalPort = 14330, [int]$RemotePort = 1433,
  [string]$Database = 'svt_weighbridge', [string]$SqlUser, [string]$SqlPassword,
  [string]$KeyPath = ''
)
# Setup-wizard central check: open a short-lived SSH tunnel, try a SQL connect,
# print 'OK:<version>' or 'ERR:<reason>', then tear the tunnel down (the app's
# vpssync opens its own afterwards).
$ErrorActionPreference = 'Stop'
$idOpt = ''
if ($KeyPath) { $idOpt = "-o IdentitiesOnly=yes -i `"$KeyPath`" " }
$sshArgs = "-N -o BatchMode=yes -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new ${idOpt}-L ${LocalPort}:127.0.0.1:${RemotePort} ${SshUser}@${SshHost}"
$p = $null
try {
  $p = Start-Process ssh -ArgumentList $sshArgs -WindowStyle Hidden -PassThru
  $open = $false
  for ($i = 0; $i -lt 16; $i++) {
    $t = Test-NetConnection 127.0.0.1 -Port $LocalPort -WarningAction SilentlyContinue
    if ($t.TcpTestSucceeded) { $open = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $open) { [Console]::Out.Write('ERR:could not open SSH tunnel (host/SSH unreachable or key not set up)'); return }
  $cs = "Server=127.0.0.1,$LocalPort;Database=$Database;User ID=$SqlUser;Password=$SqlPassword;Encrypt=True;TrustServerCertificate=True;Connect Timeout=12"
  $c = New-Object System.Data.SqlClient.SqlConnection $cs
  $c.Open()
  $cmd = $c.CreateCommand(); $cmd.CommandText = 'SELECT @@VERSION'
  $v = ([string]$cmd.ExecuteScalar()).Split("`n")[0].Trim()
  $c.Close()
  [Console]::Out.Write('OK:' + $v)
} catch {
  [Console]::Out.Write('ERR:' + $_.Exception.Message.Split([Environment]::NewLine)[0])
} finally {
  if ($p) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {} }
}
