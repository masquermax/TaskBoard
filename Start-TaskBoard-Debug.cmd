@echo off
setlocal
cd /d "%~dp0"
echo [TaskBoard] Starting background service...
node scripts\windows-launcher.mjs
if errorlevel 1 (
  echo.
  echo [TaskBoard] Startup failed.
  echo Log: %CD%\data\runtime\taskboard.log
  echo.
  pause
  exit /b 1
)
echo [TaskBoard] Ready: http://127.0.0.1:4317
start "" "http://127.0.0.1:4317"
