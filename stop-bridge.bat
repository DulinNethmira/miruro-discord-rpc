@echo off
title Miruro Discord RPC Bridge - Stop / Uninstall

echo ========================================================
echo       Miruro Discord Rich Presence Bridge Stopper       
echo ========================================================
echo.

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

:: 1. Remove from Windows Startup folder
if exist "%STARTUP_FOLDER%\MiruroBridge.vbs" (
    del "%STARTUP_FOLDER%\MiruroBridge.vbs"
    echo [OK] Removed MiruroBridge.vbs from Windows Startup.
)
if exist "%STARTUP_FOLDER%\MiruroDiscordBridge.bat" (
    del "%STARTUP_FOLDER%\MiruroDiscordBridge.bat"
    echo [OK] Removed MiruroDiscordBridge.bat from Windows Startup.
)
if exist "%STARTUP_FOLDER%\MiruroDiscordBridge.vbs" (
    del "%STARTUP_FOLDER%\MiruroDiscordBridge.vbs"
    echo [OK] Removed MiruroDiscordBridge.vbs from Windows Startup.
)

:: 2. Terminate running bridge background processes
echo [OK] Stopping running Miruro Bridge processes...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bridge.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

echo.
echo ========================================================
echo   Miruro Discord Bridge has been stopped and uninstalled.
echo ========================================================
echo.
pause
