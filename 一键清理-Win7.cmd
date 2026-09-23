@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting Win7 cleanup (elevates via scheduled task, no UAC)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Clean-Win7.ps1"
echo.
echo Done. Reboot recommended to fully re-enumerate devices.
pause
