@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
set "result=%errorlevel%"
echo.
if not "%result%"=="0" echo Setup failed. Read the message above.
pause
exit /b %result%
