@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting cleanup (elevates via scheduled task, no UAC prompt)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Clean-DeviceNetworkHistory.ps1"
echo.
echo Launcher finished. Cleanup runs in the elevated PowerShell window;
echo see Clean-DeviceNetworkHistory.log for full details.
echo.
pause
