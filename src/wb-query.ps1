param(
  [string]$Server = ".\SVTSQLEXPRESS",
  [string]$Database = "svt_weighbridge"
)
# Emits the whole weighbridge dataset as one JSON object on stdout.
# Uses integrated security (runs as the logged-in Windows user) - no credentials, no native driver.
$ErrorActionPreference = 'Stop'
try {
  $cn = New-Object System.Data.SqlClient.SqlConnection "Server=$Server;Database=$Database;Integrated Security=True;Connection Timeout=15"
  $cn.Open()
  function Q($sql) {
    $cmd = $cn.CreateCommand(); $cmd.CommandTimeout = 120; $cmd.CommandText = $sql
    $da = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
    $dt = New-Object System.Data.DataTable
    [void]$da.Fill($dt)
    $rows = New-Object System.Collections.ArrayList
    foreach ($r in $dt.Rows) {
      $o = [ordered]@{}
      foreach ($c in $dt.Columns) {
        $v = $r[$c.ColumnName]
        if ($v -is [DBNull]) { $v = $null }
        elseif ($v -is [datetime]) { $v = $v.ToString('yyyy-MM-ddTHH:mm:ss') }
        elseif ($v -is [guid]) { $v = $v.ToString() }
        elseif ($v -is [bool]) { $v = [int]$v }
        $o[$c.ColumnName] = $v
      }
      [void]$rows.Add($o)
    }
    return ,$rows
  }
  $data = [ordered]@{}
  $data.units        = Q "SELECT UnitID,UnitName FROM Unit"
  $data.products     = Q "SELECT ProductID,ProductName,ProductCode,Notes,TransactionType,IsActive FROM Product"
  $data.accounts     = Q "SELECT AccountID,AccountCode,CompanyName,FirstName,LastName,ContactNo,IsAccount,IsTransporter,City,Active FROM Account"
  $data.vehicles     = Q "SELECT VehicleID,VehicleNumber,VehicleType,TareWeight,AccountID,IsActive FROM Vehicle"
  $data.drivers      = Q "SELECT DriverID,FirstName,LastName,IDProofNo,AccountID,Active FROM Driver"
  $data.gates        = Q "SELECT GateID,GateName,GateType,IsActive FROM Gate"
  $data.weighbridges = Q "SELECT WeightBridgeID,ScaleName,MaxCapacity,UnitID,IsActive,COMPort,BaudRate,DataBits,Parity,StopBits FROM WeightBridge"
  $data.users        = Q "SELECT UserID,FirstName,LastName,Email,ContactNo,UserName,TemplateID,Active FROM UserMaster"
  $data.roles        = Q "SELECT TemplateID,TemplateName,Active FROM Template"
  $data.txns         = Q "SELECT TicketID,DriverID,VehicleID,Status,TransactionMode,AccountID,TransporterID,CONVERT(varchar(40),ReceiptTicketID) AS ReceiptTicketID,Charges,TransactionType,CreationTime,CreatedBy,PlantDirectionType,VehicleNumber,DriverName,TransporterName,AccountName,CustomField1,CustomField2,CustomField3,CustomField4,CustomField5 FROM TransactionData"
  $data.details      = Q "SELECT CONVERT(varchar(40),ReceiptTicketID) AS ReceiptTicketID,WeightBridgeID,SequenceNo,ProductID,GrossWeight,TareWeight,GrossTime,TareTime,WeighmentType,GateID,UserID,CaptureWeight,CaptureTime,NetWeight,WeightUnit,IsCapturedManual,WeighbridgeName,ProductName,GateName FROM TransactionDetail"
  $cn.Close()
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $json = $data | ConvertTo-Json -Depth 6 -Compress
  [Console]::Out.Write($json)
} catch {
  [Console]::Error.WriteLine('WBQUERY_ERR:' + $_.Exception.Message)
  exit 1
}
