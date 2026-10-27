@echo off
setlocal enabledelayedexpansion
title Miruro Discord RPC Bridge - 1-Click Setup

echo ========================================================
echo       Miruro Discord Rich Presence Bridge Setup         
echo ========================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo Please install Node.js from https://nodejs.org or via terminal:
    echo   winget install OpenJS.NodeJS
    echo.
    pause
    exit /b 1
)

:: 2. Resolve script directories
set "SCRIPT_DIR=%~dp0"
set "BRIDGE_JS=%SCRIPT_DIR%bridge.js"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_BAT=%STARTUP_FOLDER%\MiruroDiscordBridge.bat"

echo [1/3] Located bridge at:
echo       "%BRIDGE_JS%"
echo.

:: 3. Generate silent startup runner in Windows Startup folder
echo [2/3] Registering silent background auto-start with Windows...
(
    echo @echo off
    echo powershell.exe -WindowStyle Hidden -Command "Start-Process node -ArgumentList '"""%BRIDGE_JS%"""' -WindowStyle Hidden -WorkingDirectory '"""%SCRIPT_DIR:~0,-1%"""'"
) > "%STARTUP_BAT%"

if exist "%STARTUP_BAT%" (
    echo       Installed: "%STARTUP_BAT%"
) else (
    echo [ERROR] Could not write to Startup folder.
    pause
    exit /b 1
)

:: 4. Launch the bridge silently right now
echo.
echo [3/3] Launching Miruro Bridge silently in background...
powershell.exe -WindowStyle Hidden -Command "Start-Process node -ArgumentList '"""%BRIDGE_JS%"""' -WindowStyle Hidden -WorkingDirectory '"""%SCRIPT_DIR:~0,-1%"""'"

echo.
echo ========================================================
echo   SUCCESS! Miruro Discord Bridge is now ACTIVE!         
echo ========================================================
echo   - Running silently in background (no open CMD window).
echo   - Automatically starts when your computer boots up.   
echo   - Open Miruro in Chrome and your Discord status is live!
echo.
echo You can close this window now.
pause
