#!/usr/bin/env bash
# Deploy / operate the Sword and Seal server on Fly.io. Safe to re-run.
#   deploy/fly/deploy.sh                 build remotely and deploy the current checkout
#   deploy/fly/deploy.sh status          app + machine + volume + certificate status
#   deploy/fly/deploy.sh logs            live logs (Ctrl-C to stop)
#   deploy/fly/deploy.sh releases        list releases with their image refs
#   deploy/fly/deploy.sh rollback IMAGE  redeploy a previous image (IMAGE from `releases`), e.g. registry.fly.io/sword-and-seal-play:deployment-0123ABC
#   deploy/fly/deploy.sh smoke [URL]     /health + real websocket login (default https://play.swordandseal.com)
set -euo pipefail
APP="${FLY_APP:-sword-and-seal-play}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

command -v flyctl >/dev/null 2>&1 || { echo "flyctl not found. Install: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
cmd="${1:-deploy}"

guard() {
  local secrets
  if ! secrets="$(flyctl secrets list -a "$APP" 2>/dev/null)"; then echo "WARNING: could not list secrets (token without access?); skipping the secrets guard." >&2; return 0; fi
  if grep -qiw 'TEST_MODE' <<<"$secrets"; then echo "REFUSING: a TEST_MODE secret is set on $APP. Remove it: flyctl secrets unset TEST_MODE -a $APP" >&2; exit 1; fi
  grep -qw 'TOKEN_SECRET' <<<"$secrets" || { echo "REFUSING: TOKEN_SECRET secret is not set on $APP (run deploy/fly/first-time-setup.sh)" >&2; exit 1; }
}

if grep -qiE '^\s*TEST_MODE\b' "$HERE/fly.toml"; then echo "REFUSING: TEST_MODE appears in fly.toml" >&2; exit 1; fi
case "$cmd" in
  deploy)
    flyctl auth whoami >/dev/null 2>&1 || [ -n "${FLY_API_TOKEN:-}" ] || { echo "Not logged in: run 'flyctl auth login' (or set FLY_API_TOKEN)." >&2; exit 1; }
    guard
    echo "Deploying $(cat VERSION) to $APP. Players are saved on SIGTERM and see 'The server is shutting down.'; expect ~20-40 s of downtime."
    # --ha=false: never create a second machine (SQLite on one volume). --remote-only: build on Fly's builder, no local docker needed.
    flyctl deploy --config deploy/fly/fly.toml --dockerfile Dockerfile.server --app "$APP" --ha=false --remote-only
    echo
    flyctl status -a "$APP"
    echo "Next: deploy/fly/deploy.sh smoke"
    ;;
  status) flyctl status -a "$APP"; echo; flyctl volumes list -a "$APP"; echo; flyctl certs list -a "$APP"; echo; flyctl checks list -a "$APP" || true ;;
  logs) exec flyctl logs -a "$APP" ;;
  releases) flyctl releases -a "$APP" --image ;;
  rollback)
    img="${2:-}"; [ -n "$img" ] || { echo "usage: deploy.sh rollback IMAGE   (see: deploy.sh releases)" >&2; exit 2; }
    flyctl deploy --config deploy/fly/fly.toml --app "$APP" --image "$img" --ha=false
    ;;
  smoke) exec node "$HERE/smoke.mjs" "${2:-https://play.swordandseal.com}" ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
