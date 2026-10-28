#!/bin/sh
# Sword and Seal one-command start for macOS / Linux.
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (version 22.5 or newer). Download: https://nodejs.org/"; exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; then
  echo "Your Node.js is too old ($(node -v)). Need 22.5 or newer. Download: https://nodejs.org/"; exit 1
fi
exec node scripts/play.mjs "$@"
