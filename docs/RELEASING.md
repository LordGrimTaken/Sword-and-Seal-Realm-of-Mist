# Releasing Sword and Seal

How a version gets from a git tag to players. Signing is covered in `docs/SIGNING.md`, the launcher protocol in `docs/LAUNCHER.md`.

## Hosts

| What | URL |
|---|---|
| Website | https://swordandseal.com |
| Downloads (Cloudflare Worker over R2, public GET with Range) | https://dl.swordandseal.com |
| Game server (HTTPS API and wss) | https://play.swordandseal.com |

Downloads are written only through the Worker's admin API (`infra/dl-worker/worker.mjs`): `PUT /_admin/<key>`, `DELETE /_admin/<key>`, `GET /_admin?prefix=<p>` (lists at most 1000 objects), all with `Authorization: Bearer <ADMIN_TOKEN>`. The token is the Worker secret `ADMIN_TOKEN`; CI and the publish script call it `DL_ADMIN_TOKEN`.

## Bucket layout (R2)

```
news.json                                     [{id,title,date,body}] newest first; read by the website and the launcher
releases.json                                 {game:[versions], launcher:[versions]} index kept by publish-release (for --keep / --rollback)
game/<version>/manifest.json                  immutable
game/<version>/news.json
game/<version>/files/**                       (.gz where make-release --gzip compressed them)
game/latest/manifest.json                     pointer: same manifest with "filesBase": "../<version>/files/"
game/latest/news.json
launcher/latest.json                          {version, releasedAt, files:{win,mac,linux:{url,size,sha256,signed}}}  (+ optional mac_arm64, mac_x64, extra, checksums)
launcher/<version>/<installers>               SwordAndSeal-Launcher-Setup-<v>.exe, -Portable-<v>.exe, SwordAndSeal-Launcher-<v>.dmg, -<v>-mac.zip,
                                              SwordAndSeal-Launcher-<v>.AppImage, latest*.yml, *.blockmap, SHA256SUMS[.asc], release.json
launcher/latest/SwordAndSeal-Launcher-Setup.exe     STABLE-NAMED copies; the website download buttons link to these
launcher/latest/SwordAndSeal-Launcher.dmg
launcher/latest/SwordAndSeal-Launcher.AppImage
launcher/feed/latest.yml, latest-mac.yml, latest-linux.yml    electron-updater generic feed (paths point to ../<version>/)
```

Caching: the Worker sends `max-age=60` for `latest.json`, `manifest.json`, `news.json` and one year `immutable` for everything else. The stable-named copies under `launcher/latest/` are therefore cached for a year by the CDN: `publish-release` overwrites them under the same key, so purge the Cloudflare cache for `launcher/latest/*` if a stale installer is a problem (or give them a short cache rule in the Worker).

`launcher/latest.json` example:

```json
{
  "version": "1.0.0",
  "releasedAt": "2026-10-28T12:00:00.000Z",
  "files": {
    "win":   { "url": "https://dl.swordandseal.com/launcher/1.0.0/SwordAndSeal-Launcher-Setup-1.0.0.exe", "size": 80000000, "sha256": "...", "signed": false, "name": "SwordAndSeal-Launcher-Setup-1.0.0.exe" },
    "mac":   { "url": ".../SwordAndSeal-Launcher-1.0.0.dmg", "size": 0, "sha256": "...", "signed": false },
    "linux": { "url": ".../SwordAndSeal-Launcher-1.0.0.AppImage", "size": 0, "sha256": "...", "signed": false }
  },
  "stable": { "win": "https://dl.swordandseal.com/launcher/latest/SwordAndSeal-Launcher-Setup.exe", "mac": ".../SwordAndSeal-Launcher.dmg", "linux": ".../SwordAndSeal-Launcher.AppImage" }
}
```

`signed` is `true` only when verification of the signature actually succeeded in CI (`scripts/verify-signatures.mjs`); without secrets it is `false`. For Linux it means a GPG-signed `SHA256SUMS.asc` exists.

## Normal release (CI)

1. Bump `VERSION`, `client/package.json` and `launcher/package.json` versions, add a `CHANGELOG.md` section.
2. Commit, then `git tag v0.3.1 && git push origin v0.3.1`.
3. `.github/workflows/release.yml` runs: tests, then per OS (Windows, macOS, Linux) builds the launcher installers and the packaged game client (signed when secrets exist), writes `SHA256SUMS`, and the final `publish` job runs `scripts/make-release.mjs` and `scripts/publish-release.mjs`, then creates a **draft** GitHub Release with the installers. Review and publish the draft yourself.
4. Required repository secret: `DL_ADMIN_TOKEN`. Optional signing secrets: `docs/SIGNING.md`.

## Manual release (your own machine)

```
npm run package                                   # client + server bundle -> dist-package/jiuzhou-v<VERSION>/
(cd client && npx electron-builder --linux dir --publish never --config electron-builder.config.cjs)   # unpacked packaged game
node scripts/make-release.mjs --gzip --electron-linux client/release/linux-unpacked \
     --launcher-dir launcher/dist --launcher-version 1.0.0 --out release
DL_ADMIN_TOKEN=... node scripts/publish-release.mjs --dir release --dry-run     # look at the plan
DL_ADMIN_TOKEN=... node scripts/publish-release.mjs --dir release               # upload
```

`make-release.mjs` options: `--out`, `--version`, `--gzip`, `--min-launcher`, `--date`, `--electron-linux|win32|darwin DIR` (unpacked electron-builder output; fills `launch.<platform>` in the manifest and ships the folder as `game/electron/<platform>/**` with `platforms:[...]`; macOS `.app` bundles contain symlinks and are refused: the macOS game is shipped as dmg/zip instead), `--electron-<platform>-exe` (override the executable path), `--launcher-dir`, `--launcher-version`, `--base-url`, `--signing-report DIR`, `--signed win,mac`, `--launcher-checksums DIR`.

### What publish-release does

* Token only from the environment variable `DL_ADMIN_TOKEN` (never an argument, never printed). Host from `--host` or `DL_HOST` (default `https://dl.swordandseal.com`).
* Order: (1) versioned files (`game/<v>/**`, `launcher/<v>/**`, `launcher/feed/**`) in parallel (`--concurrency`, default 6) with retry and exponential backoff, each verified afterwards with a HEAD (size must match); (2) stable-named launcher installers; (3) the pointers LAST: `game/latest/*`, `launcher/latest.json`, `news.json`, then `releases.json`. Players therefore never see a pointer whose files are missing. If anything in step 1 or 2 fails, nothing in step 3 is written.
* `--dry-run`: prints the plan (keys, sizes, content types), no network writes.
* `--keep N`: after a successful publish, deletes game and launcher versions older than the newest N (default: keep all). The pointed-to version is never deleted.
* `--rollback <gameVersion>`: repoints `game/latest/manifest.json`, `game/latest/news.json` and root `news.json` to an older, still-present game version (refuses if any of its files is missing). `--rollback-launcher <launcherVersion>` does the same for `launcher/latest.json`, the electron-updater feed and the stable-named installer copies (needs `launcher/<v>/release.json`). Only pointers and the stable copies are written. Pruned versions cannot be rolled back to.

### Content types

`json` application/json; `exe` application/vnd.microsoft.portable-executable; `dmg` application/x-apple-diskimage; `AppImage` application/octet-stream; `gz` application/gzip; `zip` application/zip; `yml` text/yaml; `txt`/`SHA256SUMS` text/plain; everything else application/octet-stream. Never let a CDN add `Content-Encoding` to `.gz` objects (the launcher decompresses itself).

## News

`news.json` at the bucket root is built by `make-release` from `news.extra.json` at the repo root: short, player-facing posts (`id`, `title`, `date`, `tag`, `banner`, `summary`, `body`; see `docs/LAUNCHER.md` 2.2). The developer `CHANGELOG.md` is not published as news (`--news-from-changelog` is for experiments only). Plain text only.

## Rolling back

```
DL_ADMIN_TOKEN=... node scripts/publish-release.mjs --rollback 0.3.0                      # game
DL_ADMIN_TOKEN=... node scripts/publish-release.mjs --rollback-launcher 1.0.0             # launcher (can be combined)
```

## Local test without touching production

`node test/fake-dl.mjs 8822` starts an in-memory copy of the Worker (same admin API, Range-capable public GET). Point the script at it with `DL_HOST=http://127.0.0.1:8822 DL_ADMIN_TOKEN=test-token`, then run the launcher against it with `LAUNCHER_RELEASE_URL=http://127.0.0.1:8822/game node launcher/scripts/cli.mjs install --dir /tmp/ss-install`. `node test/publish-release.test.mjs` runs this end to end.

## Pre-launch checklist

* Worker deployed with secret `ADMIN_TOKEN`; `curl -i https://dl.swordandseal.com/_admin` answers 401 without a token.
* `launcher/config.json` hosts are the real ones (they are: dl, play, swordandseal.com).
* GitHub secret `DL_ADMIN_TOKEN` set; GitHub Environment `release` created (optionally with required reviewers).
* Decide about signing (`docs/SIGNING.md`); unsigned launchers work but show OS warnings.
* Website download buttons point to `https://dl.swordandseal.com/launcher/latest/SwordAndSeal-Launcher-Setup.exe`, `.../SwordAndSeal-Launcher.dmg`, `.../SwordAndSeal-Launcher.AppImage`.
