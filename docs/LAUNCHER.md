# Sword & Seal Launcher: protocol, release format and hosting

Flow: website offers a small launcher download -> player installs/opens the LAUNCHER -> launcher signs the player in against the account API, downloads/updates the game files from a static host, shows news and server status, and starts the game with a one-time login token.

This document is the contract between three parties:

* the launcher (`launcher/`), 
* the release tooling (`scripts/make-release.mjs`),
* the server (`POST /api/auth/*`, `GET /health`, WebSocket `login` with `tok`).

All user-facing strings are English. No CJK anywhere.

## 1. Configuration of the launcher

`launcher/config.json` (defaults, shipped inside the launcher):

```json
{
  "releaseBaseUrl": "https://dl.swordandseal.com/game",
  "apiBaseUrl": "https://play.swordandseal.com",
  "gameServerUrl": "wss://play.swordandseal.com",
  "website": "https://swordandseal.com",
  "support": "https://swordandseal.com/support",
  "channel": "stable",
  "launcherUpdate": { "enabled": false, "url": "" }
}
```

Environment overrides (testing): `LAUNCHER_RELEASE_URL`, `LAUNCHER_API_URL`, `LAUNCHER_SERVER_URL`, `LAUNCHER_FILE_SOURCE` (a local release directory, used as `file://` source instead of HTTP), `LAUNCHER_HOME` (state/settings directory). The Settings panel can override the server URL and the install folder; those are stored in the per-user settings file.

## 2. Release layout (static hosting)

Upload the folder `release/<version>/` produced by `npm run release` to any static host and point `releaseBaseUrl` at the parent so that these URLs resolve:

```
{releaseBaseUrl}/latest/manifest.json          same manifest, with filesBase "../<version>/files/"
{releaseBaseUrl}/latest/news.json
{releaseBaseUrl}/<version>/manifest.json
{releaseBaseUrl}/<version>/news.json
{releaseBaseUrl}/<version>/files/<path>        or <path>.gz when gzip was enabled
```

Hosting: upload `release/<version>` to any static host (S3, Cloudflare R2, GitHub Pages, nginx). Requirements: plain HTTPS GET, `Accept-Ranges: bytes` (for resume; all of S3, R2, nginx do this by default), correct CORS is NOT needed (the launcher is not a browser). Do not let the CDN transparently gzip `.gz` files again or re-encode them: serve them as `application/octet-stream` (or `application/gzip`) without `Content-Encoding`. Cache policy: `latest/*` short TTL (<= 60 s), `<version>/**` immutable. Publishing a new version = upload `release/<version>/` first, then replace `latest/manifest.json` + `latest/news.json` last (so clients never see a manifest whose files are missing).

### 2.1 manifest.json

```json
{
  "version": "0.3.0",
  "channel": "stable",
  "releasedAt": "2026-10-28T12:00:00.000Z",
  "minLauncherVersion": "1.0.0",
  "notesUrl": "news.json",
  "filesBase": "files/",
  "launch": {
    "win32":  "game/electron/Sword and Seal.exe",
    "darwin": "game/electron/Sword and Seal.app/Contents/MacOS/Sword and Seal",
    "linux":  "game/electron/sword-and-seal"
  },
  "launchFallback": {
    "command": "node",
    "args": ["game/scripts/play.mjs"],
    "cwd": "game"
  },
  "files": [
    { "path": "game/client/dist/index.html", "size": 1234, "sha256": "<64 lowercase hex>" },
    { "path": "game/client/dist/assets/app.js", "size": 99999, "sha256": "<hex of the DEcompressed file>", "gz": true, "gzSize": 21000 },
    { "path": "game/electron/linux/jiuzhou-client", "size": 150000000, "sha256": "<hex>", "platforms": ["linux"], "mode": "755" }
  ]
}
```

Rules:

* `files[].path`: forward slashes, relative to the install directory, no `..`, no absolute path, no drive letter, no empty segments, no NUL, no leading `.install`. Paths are case-sensitive. Launcher rejects the whole manifest if any path is unsafe.
* `files[].sha256`: lowercase hex SHA-256 of the file AS INSTALLED (decompressed content). `size` is the installed size in bytes.
* Download URL of a file: `url` if present (absolute, or relative to the manifest URL); otherwise `<filesBase><path>` where `filesBase` (manifest field, default `files/`) is relative to the manifest URL or absolute, with `.gz` appended when `gz` is true. Only http(s) URLs are allowed (file:// only when the manifest itself came from file://). A URL ending in `.gz` always means gzip; `sha256`/`size` always describe the decompressed file. `gzSize` (optional) is the compressed size.
* Optional per-file fields: `platforms` (array of `win32`/`darwin`/`linux`; the file is skipped on other platforms) and `mode` (octal string such as `"755"`, applied after install on non-Windows).
* `release/latest/manifest.json` is the same manifest with `"filesBase": "../<version>/files/"` so the files are not duplicated.
* `launch`: per-platform executable path relative to the install directory (packaged Electron game; platforms without a packaged build are simply absent). `make-release.mjs` adds an entry for each `--electron-<platform> <dir>` it is given (an unpacked electron-builder output dir). `launchFallback`: used when the `launch` executable is not present in the install (dev layout). `cwd` is relative to the install directory. The launcher runs `command` (`node` means the launcher's own Node via ELECTRON_RUN_AS_NODE if no `node` on PATH).
* `minLauncherVersion`: if greater than the running launcher version (semver compare) the launcher blocks with "Launcher update required" and shows the website download link.
* `channel`: `stable` (only value used by the launcher for now).

### 2.2 news.json

```json
[
  { "id": "0.3.0", "title": "English localization", "date": "2026-10-28", "body": "Plain text. Blank line = paragraph. Lines starting with '- ' render as bullets." }
]
```

Array, any order (launcher sorts newest `date` first). `id` unique string. Plain text only (no HTML; the launcher escapes everything). The launcher caches the last good copy in its user data directory and shows it offline.

### 2.3 Install state `<installDir>/.install.json`

```json
{
  "schema": 1,
  "version": "0.3.0",
  "updating": false,
  "targetVersion": null,
  "installedAt": "2026-10-28T12:00:00.000Z",
  "launch": { "linux": "..." },
  "launchFallback": { "command": "node", "args": ["scripts/play.mjs"], "cwd": "game" },
  "files": { "game/client/dist/index.html": { "size": 1234, "sha256": "..." } }
}
```

Written atomically (temp + rename) ONLY after every file of an update is in place and verified. Before an update starts, the launcher writes `updating: true, targetVersion` (keeping the old `files`); if the launcher crashes mid-update the next start sees `updating: true` and runs a full verify/repair before offering PLAY. Download scratch files are `<path>.part` (partial, resumable with HTTP `Range`) and are removed on completion. Files in the previous state that are not in the new manifest are deleted after a successful update (never anything outside the install dir; empty directories are pruned).

## 3. Account API (server side)

Base: `apiBaseUrl` (HTTP/HTTPS). Content type `application/json`. Request bodies are small (< 1 KB).

### POST /api/auth/register and POST /api/auth/login

Request:

```json
{ "name": "Wanderer", "pw": "secret-password" }
```

* `name`: same rule as in-game character names (the server owns validation; typical 3-16 chars letters/digits/space/_/-).
* `pw`: 4 to 64 characters (same as the existing in-game `pw`).
* `register`: creates the account. Fails with `{ok:false, error:"That name is already taken."}` if it exists.
* `login`: verifies the password against the account's stored hash (same account store as the game `login` message `pw`).

Success (HTTP 200):

```json
{ "ok": true, "token": "<opaque string, <= 256 chars>", "name": "Wanderer", "expiresIn": 300 }
```

Failure (HTTP 200 or 4xx, the launcher reads the JSON body regardless of status):

```json
{ "ok": false, "error": "Wrong name or password." }
```

`error` is a short user-facing English sentence. Examples: `That name is already taken.`, `Wrong name or password.`, `Password must be 4 to 64 characters.`, `Too many attempts. Try again in a minute.`, `Name must be 3 to 16 letters or digits.` Non-JSON, 5xx or network failure: the launcher shows "Cannot reach the account server."

### Token semantics

* Signed by the server (e.g. HMAC-SHA256 over `name|exp|nonce`), `expiresIn` seconds (300 = 5 minutes).
* ONE USE: the game server accepts it exactly once on the WebSocket `login` message (field `tok`), then burns it (nonce stored until expiry). Replaying, expired or tampered tokens are rejected with the normal `error` message ("Session expired. Please sign in again from the launcher.").
* Because of the 5-minute life, the launcher requests a fresh token right before PLAY: it keeps the password in main-process memory only (never on disk, never in the renderer) and calls `/api/auth/login` again at PLAY time. The token from the first sign-in is used only to prove the sign-in worked and for display.
* `GET /api/auth/*` and other methods: 404/405. CORS not required.

### GET /health

```json
{ "ok": true, "players": 12, "version": "0.3.0" }
```

Extra fields (tick, mobs, ...) may be present and are ignored. The launcher polls every 15 s on `apiBaseUrl` (the same origin that serves `/api/auth`), measures round trip as latency, and shows Online/Offline, players and latency. If the API origin differs from the WebSocket host, `/health` must be reachable on `apiBaseUrl`.

## 4. Starting the game

On PLAY the launcher:

1. verifies the install is up to date (`.install.json` version equals latest manifest version and `updating` is false),
2. obtains a fresh token (section 3),
3. writes a launch session JSON to a private temp file (mode 0600), e.g. `<os tmp>/sword-and-seal-session-<random>.json`:

```json
{
  "name": "Wanderer",
  "token": "<token>",
  "serverUrl": "wss://play.swordandseal.com",
  "createdAt": "2026-10-28T12:00:00.000Z"
}
```

4. spawns the game: `<installDir>/<launch[platform]> --launcher-session=<absolute path of that file>` (or `launchFallback` with the same extra arg appended), cwd = install dir (or `launchFallback.cwd`), detached from the launcher's stdio, env `SWORD_AND_SEAL_LAUNCHER=1`.
5. watches the child; on exit shows "Game closed" and re-enables PLAY; deletes the session file after 60 s or at game exit, whichever is first.

### Game CLI arg `--launcher-session=<path>` (game / client side)

Implemented in `client/electron/main.cjs` + `launcher-session.cjs` + `preload.cjs`, `client/src/net/launcher.ts`, `client/src/main.ts`, and `scripts/play.mjs` (fallback). Test: `client/scripts/launcher-handoff.mjs`.

* The game reads the JSON file and DELETES it immediately (also when it turns out to be invalid). If it is missing, unreadable, malformed (`name`, `token`, `serverUrl` ws/wss, `createdAt` required) or `createdAt` is older than **2 minutes** (or more than 1 minute in the future), it is ignored and the normal login screen is shown with a short notice. (The launcher writes the file right before spawning, so 2 minutes is ample.)
* Electron: the main process keeps `{name, token, serverUrl}` in memory only. The renderer (sandboxed, contextIsolation, no node integration) sees `window.jzLauncher.info()` (name + serverUrl, no secret) and `window.jzLauncher.takeToken()` which returns the token once; the main process forgets it on the first call. The token is never put in argv, env, URLs, localStorage/sessionStorage, cookies, DOM or console output. The bundled local server is NOT started in launcher mode.
* `scripts/play.mjs --launcher-session=<file>`: reads and deletes the file, starts no local server, serves the built client and opens `http://localhost:<WEB_PORT>/?launcher=1`. The page fetches `/__launcher/session` once (GET, same origin, Host must be localhost/127.0.0.1; a second call is 404). The token is never in a URL and never printed.
* Testing only: `?server=ws://...&name=...&tok=...` (optional `&cls=`). `tok` is removed from the address bar immediately.
* Login: the client sends `login {name, cls, v:3, tok}` (no `pw`) to `serverUrl`. In launcher mode the name field is read-only and there is no password field and no Server field. The class picker is shown only when this machine has not logged that character in before (`jz.known` in localStorage holds lowercase names, no secrets) and no `&cls=` was given; the server ignores `cls` for an existing character (it keeps the saved class and prints a notice), so a wrong guess is harmless.
* A rejected or used token (`error` from the server) shows the server text plus "Close and sign in again from the launcher." There is never a password prompt and no retry button in launcher mode.
* Connection lost (launcher mode): the token is spent, so there is no silent re-login. The game shows "Connection lost. Please restart from the launcher." without a reconnect loop. (Non-launcher mode keeps the backoff reconnect with the saved password flow.)
* Packaged builds without a session connect to `wss://play.swordandseal.com` by default (override with `--server=` / `JZ_SERVER_URL`; the bundled local server starts only from source, or with `--local-server` / `JZ_LOCAL_SERVER=1`).

## 5. Launcher self-update (optional)

Disabled by default. If `launcherUpdate.enabled` is true and `launcherUpdate.url` points to an electron-updater "generic" provider folder (containing `latest.yml`, `latest-mac.yml`, `latest-linux.yml` and the installers produced by electron-builder), the packaged launcher calls `autoUpdater.checkForUpdates()` at start and offers "Restart to update". `electron-updater` is NOT a dependency of the repo: install it (`npm i electron-updater` in `launcher/`) before building a self-updating launcher; when it is absent or disabled the launcher silently skips this feature. Independently of that, `minLauncherVersion` in the game manifest tells old launchers to show a download link.

## 6. Building and publishing a release (operator checklist)

```
npm run package            # (optional) builds client/dist + server bundle
npm run release            # -> release/<version>/ (manifest.json, news.json, files/) and release/latest/
npm run release -- --gzip  # same with .gz assets
npm run launcher:dist      # launcher installers into launcher/dist/
```

1. Upload `release/<version>/` to `{releaseBaseUrl}/<version>/`.
2. Upload `release/latest/` to `{releaseBaseUrl}/latest/` last.
3. Put the launcher installer on the website download page.
4. Fill `launcher/config.json` (or the build-time defaults) with the real `releaseBaseUrl`, `apiBaseUrl`, `gameServerUrl`, `website`, `support`.

Local test: `node launcher/scripts/dev-host.mjs release 8815` serves the release folder; run the launcher with `LAUNCHER_RELEASE_URL=http://127.0.0.1:8815 npm run launcher:dev`, or run headless: `node launcher/scripts/cli.mjs install --dir /tmp/ss-install`.
