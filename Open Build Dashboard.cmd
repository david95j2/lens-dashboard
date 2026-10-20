@echo off
setlocal
title SIRIUS Build Dashboard
echo Opening SIRIUS Build Dashboard...
echo The server runs in the background. This window will close automatically.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-build-dashboard.ps1"
if errorlevel 1 (
    echo.
    echo The dashboard could not start. Check the message above.
    pause
)
endlocal
