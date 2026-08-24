@echo off
REM WeighCore — one-click local database setup (installs SQL Express + schema).
REM Double-click this; it self-elevates to Administrator.
net session >nul 2>&1
if %errorlevel% NEQ 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Setting up the WeighCore database. This can take 10-15 minutes on first run...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-database.ps1"
echo.
pause
