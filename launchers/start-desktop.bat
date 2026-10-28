@echo off
cd /d "%~dp0\.."
where node >nul 2>nul || (echo Node.js 22.5+ required: https://nodejs.org/ & pause & exit /b 1)
set EL=
if exist client\node_modules\.bin\electron.cmd set EL=client\node_modules\.bin\electron.cmd
if "%EL%"=="" where electron >nul 2>nul && set EL=electron
if "%EL%"=="" (
  echo Electron is not installed. Use start-windows.bat ^(browser^) or run: npm i -g electron
  pause
  exit /b 1
)
set NO_OPEN=1
start "JIUZHOU server" /min node scripts\play.mjs
timeout /t 2 >nul
call %EL% client
taskkill /fi "WINDOWTITLE eq JIUZHOU server*" >nul 2>nul
