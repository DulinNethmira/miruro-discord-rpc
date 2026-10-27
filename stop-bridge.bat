@echo off
title Miruro Discord RPC Bridge - Stop / Uninstall

echo ========================================================
echo       Miruro Discord Rich Presence Bridge Stopper       
echo ========================================================
echo.

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_BAT=%STARTUP_FOLDER%\MiruroDiscordBridge.bat"
set "STARTUP_VBS=%STARTUP_FOLDER%\MiruroDiscordBridge.vbs"

:: 1. Remove from Windows Startup folder
if exist "%STARTUP_BAT%" (
    del "%STARTUP_BAT%"
    echo [OK] Removed auto-start batch file from Windows Startup.
)
if exist "%STARTUP_VBS%" (
    del "%STARTUP_VBS%"
    echo [OK] Removed legacy VBS from Windows Startup.
)

:: 2. Terminate running bridge background processes
echo [OK] Stopping running Miruro Bridge background processes...
powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bridge.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul

echo.
echo ========================================================
echo   Miruro Discord Bridge has been stopped and uninstalled.
echo ========================================================
echo.
pause
