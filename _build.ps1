Set-Location 'D:\Z3\Biomining-Chennai\weightcore'
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
& '.\node_modules\.bin\electron-builder.cmd' --win --x64 *>&1 | Out-File -FilePath '.\dist-build.log' -Encoding utf8
"EXITCODE $LASTEXITCODE" | Out-File -FilePath '.\dist-build.log' -Append -Encoding utf8
