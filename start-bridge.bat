@echo off
title Miruro Discord Rich Presence Bridge
cd /d "%~dp0"

echo =======================================================
echo   Miruro Discord RPC Bridge (Debug Console Mode)
echo =======================================================
echo.
echo TIP: If you do not want to keep this CMD window open,
echo run "setup-bridge.bat" once to make it run silently in
echo the background and start automatically on PC boot!
echo.
echo -------------------------------------------------------
node bridge.js
pause
