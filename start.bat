@echo off
setlocal
title jam - tabs, beats, time
cd /d "%~dp0"

rem jam on this machine: tabs, beats and time under one address, port 3000 for nginx proxy manager.
rem the only file to start - deploy\jam.mjs installs, builds and runs all three (and starts any of
rem them again if it stops). Beats and Time sit next to this folder. tabs' settings: .env

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is missing - install Node.js 20 LTS from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo   created .env - fill in the lines from havoc ^(see README^), then start again.
  echo.
  notepad ".env"
)

:run
node deploy\jam.mjs
rem 3: jam runs already (another window or the autostart) - nothing to start again
if %errorlevel%==3 (
  echo.
  pause
  exit /b 0
)
echo.
echo   jam stopped - starting again in 5 s, ctrl+c to quit.
timeout /t 5 /nobreak >nul
goto :run
