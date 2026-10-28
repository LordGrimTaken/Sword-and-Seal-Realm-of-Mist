#!/usr/bin/env bash
# Upload website/dist to R2 under site/ via the dl admin endpoint. Needs DL_ADMIN_TOKEN (or infra/.dl-admin-token).
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN="${DL_ADMIN_TOKEN:-$(cat infra/.dl-admin-token)}"
node website/build.mjs >/dev/null
declare -A T=([html]="text/html; charset=utf-8" [css]="text/css; charset=utf-8" [js]="text/javascript; charset=utf-8" [json]="application/json; charset=utf-8" [svg]="image/svg+xml" [png]="image/png" [jpg]="image/jpeg" [webp]="image/webp" [woff2]="font/woff2" [txt]="text/plain; charset=utf-8" [xml]="application/xml; charset=utf-8" [webmanifest]="application/manifest+json" [ico]="image/x-icon")
n=0
while IFS= read -r f; do
  rel="${f#website/dist/}"; ext="${rel##*.}"
  curl -fsS -m 120 -X PUT -H "Authorization: Bearer $TOKEN" -H "content-type: ${T[$ext]:?no type for $ext}" --data-binary @"$f" "https://dl.swordandseal.com/_admin/site/$rel" >/dev/null && n=$((n+1))
done < <(find website/dist -type f)
echo "uploaded $n files"
