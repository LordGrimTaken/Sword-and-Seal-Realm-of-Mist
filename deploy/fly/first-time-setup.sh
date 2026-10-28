#!/usr/bin/env bash
# One-time (idempotent) Fly.io setup for the Sword and Seal server. Safe to re-run: every step checks first.
#   flyctl auth login          (once, interactive)
#   deploy/fly/first-time-setup.sh
# Optional, to enable nightly backups right away (values are passed to Fly as secrets, never printed):
#   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... deploy/fly/first-time-setup.sh
set -euo pipefail
APP="${FLY_APP:-sword-and-seal-play}"
REGION="${FLY_REGION:-iad}"
DOMAIN="${GAME_DOMAIN:-play.swordandseal.com}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v flyctl >/dev/null 2>&1 || { echo "flyctl not found. Install: https://fly.io/docs/flyctl/install/" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl not found (used to generate TOKEN_SECRET)" >&2; exit 1; }
flyctl auth whoami >/dev/null 2>&1 || [ -n "${FLY_API_TOKEN:-}" ] || { echo "Not logged in: run 'flyctl auth login' first." >&2; exit 1; }

step() { printf '\n== %s\n' "$*"; }

step "1/6 app $APP"
if flyctl apps list 2>/dev/null | awk '{print $1}' | grep -qx "$APP"; then echo "exists"; else flyctl apps create "$APP"; fi

step "2/6 volume game_data (1 GB, $REGION)"
# Exactly ONE volume. A second volume would NOT be used by the single machine and invites split data.
if flyctl volumes list -a "$APP" 2>/dev/null | awk '{print $2}' | grep -qx "game_data"; then echo "exists"
else flyctl volumes create game_data --app "$APP" --region "$REGION" --size 1 --yes; fi

step "3/6 secrets"
existing="$(flyctl secrets list -a "$APP" 2>/dev/null || true)"
if grep -qw TOKEN_SECRET <<<"$existing"; then echo "TOKEN_SECRET already set (not touching it: rotating it invalidates launcher session tokens)"
else
  # value goes through a pipe into flyctl; it is never echoed, logged or put on a command line
  printf 'TOKEN_SECRET=%s\n' "$(openssl rand -hex 32)" | flyctl secrets import -a "$APP" --stage
  echo "TOKEN_SECRET generated and staged (value not shown)"
fi
if [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  printf 'R2_ACCOUNT_ID=%s\nR2_ACCESS_KEY_ID=%s\nR2_SECRET_ACCESS_KEY=%s\n' "$R2_ACCOUNT_ID" "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" | flyctl secrets import -a "$APP" --stage
  echo "R2 backup credentials staged (values not shown)"
elif grep -qw R2_ACCESS_KEY_ID <<<"$existing"; then echo "R2 credentials already set"
else echo "NOTE: R2_* not provided: backups stay DISABLED until you set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (see docs/DEPLOY_FLY.md step 7)."; fi

step "4/6 first deploy"
if flyctl status -a "$APP" 2>/dev/null | grep -qE 'started|running'; then echo "a machine is already running; skipping (use deploy/fly/deploy.sh for updates)"
else "$HERE/deploy.sh"; fi

step "5/6 TLS certificate for $DOMAIN"
if flyctl certs list -a "$APP" 2>/dev/null | grep -qF "$DOMAIN"; then echo "certificate already requested"; else flyctl certs add "$DOMAIN" -a "$APP"; fi

step "6/6 DNS records to create in Cloudflare (zone swordandseal.com)"
cat <<DNS

  Type   Name                    Target                              Proxy status
  CNAME  play                    $APP.fly.dev       DNS only (grey cloud)
  CNAME  _acme-challenge.play    <value from 'flyctl certs setup' below>   DNS only   (OPTIONAL: lets Fly issue/renew the cert while the record is proxied)

Why DNS only: Fly terminates TLS itself, passes WebSockets natively and tells the game the real player IP (Fly-Client-IP).
If you turn the orange cloud on, Cloudflare terminates TLS first (set SSL/TLS mode to Full (strict)), WebSockets still work
(they stay open as long as the game's 5 s pings flow), but the player IP the server sees becomes a Cloudflare edge IP unless
you also trust CF-Connecting-IP. Start grey; consider orange later only if you need Cloudflare DDoS protection.

Certificate DNS instructions for your exact app (the _acme-challenge target is printed here):
DNS
flyctl certs setup "$DOMAIN" -a "$APP" || true
echo
echo "Check issuance after DNS propagates:  flyctl certs check $DOMAIN -a $APP"
echo "Then verify:                           deploy/fly/deploy.sh smoke https://$DOMAIN"
