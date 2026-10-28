@echo off
setlocal enabledelayedexpansion
title Stream Discord RPC Bridge - 1-Click Setup

echo ========================================================
echo   Miruro & VidBox Discord RPC Bridge Setup         
echo ========================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found on your system!
    echo Please install Node.js from: https://nodejs.org
    echo Or install via PowerShell / Windows Terminal:
    echo   winget install OpenJS.NodeJS
    echo.
    pause
    exit /b 1
)

:: 2. Resolve paths (strip trailing slash)
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "STARTUP_VBS=%STARTUP_FOLDER%\MiruroBridge.vbs"

echo [1/3] Located bridge directory:
echo       "%SCRIPT_DIR%"
echo.

:: 3. Stop any existing bridge instance on port 19890
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 19890 -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force }" >nul 2>&1

:: 4. Write clean silent auto-start runner to Windows Startup folder
echo [2/3] Registering silent background auto-start with Windows...
(
    echo Set WshShell = CreateObject("WScript.Shell"^)
    echo WshShell.CurrentDirectory = "%SCRIPT_DIR%"
    echo WshShell.Run "node start-detached.js", 0, False
) > "%STARTUP_VBS%"

copy /y "%STARTUP_VBS%" "%SCRIPT_DIR%\start-bridge-hidden.vbs" >nul 2>&1

if exist "%STARTUP_VBS%" (
    echo       Registered: "%STARTUP_VBS%"
) else (
    echo [ERROR] Could not write to Startup folder.
    pause
    exit /b 1
)

:: 5. Launch the bridge silently right now
echo.
echo [3/3] Launching Bridge silently in background...
cd /d "%SCRIPT_DIR%"
node start-detached.js

echo.
echo ========================================================
echo   SUCCESS! Discord Bridge is now ACTIVE!         
echo ========================================================
echo   - Running silently in background (0 open CMD windows).
echo   - Automatically starts when your computer boots up.   
echo   - Open Miruro or VidBox in Chrome and your Discord status is live!
echo.
echo You can close this window now.
pause
