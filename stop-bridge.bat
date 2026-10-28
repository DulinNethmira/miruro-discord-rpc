@echo off
title Stream Discord RPC Bridge - Stop / Uninstall

echo ========================================================
echo       Discord Rich Presence Bridge Stopper       
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
echo [OK] Stopping running Bridge processes on port 19890...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 19890 -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force }" >nul 2>&1

echo.
echo ========================================================
echo   Discord Bridge has been stopped and uninstalled.
echo ========================================================
echo.
pause
