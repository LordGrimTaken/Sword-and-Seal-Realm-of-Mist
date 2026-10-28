@echo off
cd /d "%~dp0\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required ^(version 22.5 or newer^).
  echo Download it from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. Need 22.5 or newer. Download: https://nodejs.org/
  pause
  exit /b 1
)
node scripts\play.mjs
pause
