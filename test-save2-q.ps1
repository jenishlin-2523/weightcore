param([string]$Query)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$cn=New-Object System.Data.SqlClient.SqlConnection 'Server=.\SVTSQLEXPRESS;Database=svt_weighbridge_test;Integrated Security=True'
$cn.Open();$c=$cn.CreateCommand();$c.CommandText=$Query
$da=New-Object System.Data.SqlClient.SqlDataAdapter $c
$dt=New-Object System.Data.DataTable
[void]$da.Fill($dt)
$rows=@()
foreach($row in $dt.Rows){ $h=[ordered]@{}; foreach($col in $dt.Columns){ $v=$row[$col]; if($v -is [DBNull]){$v=$null}; if($v -is [datetime]){$v=$v.ToString('yyyy-MM-dd HH:mm:ss')}; $h[$col.ColumnName]=$v }; $rows+=[pscustomobject]$h }
[Console]::Out.Write((ConvertTo-Json -InputObject $rows -Compress))
$cn.Close()
