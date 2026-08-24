<#
  install-database.ps1 — WeighCore local database prerequisite (run as Administrator).

  Idempotent: installs SQL Server Express (named instance SVTSQLEXPRESS, Mixed Mode,
  TCP + Browser) if it isn't already present, then creates the svt_weighbridge
  database + schema. Safe to re-run (schema is IF-NOT-EXISTS throughout).

  Usage (elevated PowerShell):
    powershell -ExecutionPolicy Bypass -File install-database.ps1
#>
param(
  [string]$Instance   = 'SVTSQLEXPRESS',
  [string]$SaPassword = 'WeighCore!SVT2026',
  [string]$SchemaFile = (Join-Path $PSScriptRoot 'weighcore-schema.sql'),
  [string]$WorkDir    = (Join-Path $env:TEMP 'weighcore-sqlsetup')
)
$ErrorActionPreference = 'Stop'
function Say($m){ Write-Host "[WeighCore DB] $m" }

# 0) admin check
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Warning "Run this in an ELEVATED PowerShell (Run as administrator)."; exit 1
}

$svc = "MSSQL`$$Instance"
$have = Get-Service -Name $svc -ErrorAction SilentlyContinue
if ($have) {
  Say "SQL Server instance $Instance already present ($($have.Status)). Skipping engine install."
} else {
  Say "Installing SQL Server Express instance $Instance ..."
  New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
  $boot = Join-Path $WorkDir 'SQL2019-SSEI-Expr.exe'
  if (-not (Test-Path $boot)) { Say "Downloading installer..."; Invoke-WebRequest 'https://go.microsoft.com/fwlink/?linkid=866658' -OutFile $boot -UseBasicParsing }
  $expr = Join-Path $WorkDir 'SQLEXPR_x64_ENU.exe'
  if (-not (Test-Path $expr)) { Say "Fetching media (~270 MB)..."; Start-Process $boot -ArgumentList '/ACTION=Download',"/MEDIAPATH=$WorkDir",'/MEDIATYPE=Core','/QUIET' -Wait }
  $setupDir = Join-Path $WorkDir 'expr'
  if (-not (Test-Path (Join-Path $setupDir 'setup.exe'))) { Say "Extracting..."; Start-Process $expr -ArgumentList '/Q',"/X:$setupDir" -Wait }
  $ini = Join-Path $WorkDir 'ConfigurationFile.ini'
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
@"
[OPTIONS]
ACTION="Install"
FEATURES=SQLENGINE
INSTANCENAME="$Instance"
INSTANCEID="$Instance"
SQLSVCACCOUNT="NT AUTHORITY\SYSTEM"
SQLSVCSTARTUPTYPE="Automatic"
SECURITYMODE="SQL"
SQLSYSADMINACCOUNTS="$user"
BROWSERSVCSTARTUPTYPE="Automatic"
TCPENABLED="1"
NPENABLED="1"
ENU="True"
QUIETSIMPLE="True"
IACCEPTSQLSERVERLICENSETERMS="True"
SUPPRESSPRIVACYSTATEMENTNOTICE="True"
"@ | Set-Content -Path $ini -Encoding ASCII
  Say "Running SQL setup (this can take 10-15 min)..."
  Start-Process (Join-Path $setupDir 'setup.exe') -ArgumentList "/ConfigurationFile=$ini",'/IACCEPTSQLSERVERLICENSETERMS',"/SAPWD=$SaPassword" -Wait
  $have = Get-Service -Name $svc -ErrorAction SilentlyContinue
  if (-not $have) { throw "SQL install did not register service $svc — check the SQL setup logs." }
  Say "SQL Server installed: $($have.Status)"
}

# ensure the service is running
$have = Get-Service -Name $svc -ErrorAction SilentlyContinue
if ($have.Status -ne 'Running') { Start-Service $svc; Start-Sleep 3 }

# create database + schema
if (-not (Test-Path $SchemaFile)) { throw "Schema file not found: $SchemaFile" }
Say "Applying schema from $SchemaFile ..."
$sql = Get-Content -LiteralPath $SchemaFile -Raw -Encoding UTF8
$batches = [regex]::Split($sql, '(?im)^\s*GO\s*$')
$cn = New-Object System.Data.SqlClient.SqlConnection "Server=.\$Instance;Database=master;Integrated Security=True;Connection Timeout=30"
$cn.Open()
$i = 0
foreach ($b in $batches) { $t = $b.Trim(); if (-not $t) { continue }; $i++; $c = $cn.CreateCommand(); $c.CommandTimeout = 180; $c.CommandText = $t; [void]$c.ExecuteNonQuery() }
$cn.Close()
Say "Database ready: svt_weighbridge ($i batches). Instance .\$Instance is good to go."
