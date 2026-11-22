@echo off
title AlexFlix - deploiement
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
)
echo.
pause
