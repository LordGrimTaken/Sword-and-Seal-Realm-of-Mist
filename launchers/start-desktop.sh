#!/bin/sh
# Optional: run the game server + Electron desktop window (needs `electron` installed: npm i -g electron, or client/node_modules).
cd "$(dirname "$0")/.." || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 22.5+ required: https://nodejs.org/"; exit 1; }
EL=""
[ -x client/node_modules/.bin/electron ] && EL=client/node_modules/.bin/electron
[ -z "$EL" ] && command -v electron >/dev/null 2>&1 && EL=electron
if [ -z "$EL" ]; then echo "Electron is not installed. Use start-mac-linux.sh (browser) or: npm i -g electron"; exit 1; fi
NO_OPEN=1 node scripts/play.mjs &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT INT TERM
sleep 2
"$EL" client
