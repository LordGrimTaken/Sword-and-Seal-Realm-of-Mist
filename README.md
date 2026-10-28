# Sword and Seal: Realm of Mist v0.3.0

A Chinese-aesthetic (xianxia, ink-wash) multiplayer fantasy MMO prototype. Explore Cloudmist Valley, pick a class (Sword Cultivator, Talisman Master, Physician), fight spirits, serpents and a telegraphed boss, run Elder Lin's quest chain, and play with friends on the same server.

This is a vertical slice: one zone, three classes, four mob types plus a boss, two quest givers. It is a prototype, not a finished game (see "Known limitations").

## What is in the slice
- **Zone**: plaza with paifang gate and pagoda, lotus pond with an arched stone bridge, bamboo grove (west), fox hills (east), northern shrine with the Stone Guardian. Layered ink mountains, fog, drifting petals, lanterns.
- **Classes** (4 skills each, cooldowns, ranges, AoE and heals): Sword Cultivator (melee burst), Talisman Master (ranged), Physician (healer).
- **Mobs**: Bamboo Spirit (lv 1-3), Jade Serpent (lv 2-4, coils, then lunges and poisons), Fox Spirit (lv 3-4), Stone Guardian (boss, lv 8, telegraphed ground slams you can walk out of, enrages).
- **Quests**: Elder Lin (four steps: bamboo, fox tails, the pond, the Stone Guardian) and Lantern Keeper Mei (a short fetch quest). Gate Warden Wu only talks.
- **Inventory**: server-side bag (I), loot toasts, quest rewards; saved with your character.
- **Online**: authoritative 20 Hz server, client prediction, interpolation, characters saved in SQLite (name, class, level, XP, position, quests, bag).
- **UI/audio**: paper-scroll HUD, minimap, boss bar, chat, procedural WebAudio (ambient guzheng-style bed, per-class skill sounds, boss gong).

## Requirements
- **Node.js 22.5 or newer** (https://nodejs.org/). Nothing else to install for the release zip: dependencies are bundled.
- A modern browser with WebGL and a GPU (Chrome or Edge recommended).
- To build from source you also need npm. The optional desktop installers need Electron (installed by npm, see Developers).

## How to run (players)
1. Unzip the release.
2. Start it:
   - Windows: double-click `launchers\start-windows.bat`
   - macOS / Linux: `sh launchers/start-mac-linux.sh`
   - any OS: `node scripts/play.mjs`
3. Your browser opens http://localhost:8080/ . Pick a name and class, press "Enter the World". Close the console window or press Ctrl+C to stop. Characters are saved in `data/jiuzhou.db`.

Installer / desktop-window options: see "Desktop app" below.

## Controls
| Key | Action |
|---|---|
| W A S D | move (camera-relative) |
| Right mouse drag / wheel | orbit / zoom camera |
| Left click | select target (or click an NPC to talk) |
| Tab | cycle nearest hostile target |
| Esc | clear target / close window / cancel chat |
| 1 - 4 | skills (or click the hotbar) |
| F | interact: speak to the nearest NPC |
| I or B | bag (inventory) |
| L | quest log |
| F1 or ? | help and settings (volume, performance mode) |
| M | mute / unmute |
| Enter | chat (Enter sends, Esc cancels); `/talk`, `/quest` also work |
| F11 / F12 | fullscreen / devtools (desktop app only) |

Tip: your first quest is at Elder Lin, a few steps from where you spawn. Level 1-2 characters should take bamboo spirits one at a time; the Stone Guardian wants a group, healing and attention to the glowing ground rings.

## Playing with friends on a LAN
1. The host runs the game as above and allows Node.js through the firewall if asked (TCP ports 8787 for the game server and 8080 for the web page).
2. The host's console prints a line like `Friends on your network: http://192.168.1.20:8080/?server=ws://192.168.1.20:8787` . Friends open that address in their browser; they install nothing.
3. Alternatively a friend uses their own copy of the client and types `ws://HOST:8787` in the server field on the login screen, or adds `?server=ws://HOST:8787` to the URL. The desktop app accepts `--server=ws://HOST:8787` (or the `JZ_SERVER_URL` environment variable) to skip its built-in server.
4. Over the internet you would have to forward those ports on the router. There are **no accounts or passwords**: anybody who can reach the server can log in as any character name that is not currently online. Only do this with people you trust.

## Desktop app (Electron)
`client/electron/main.cjs` opens the game in a window. If no server address is given, the packaged app starts its own copy of the game server (bundled `server.mjs`) on a free local port, keeps its save file in the per-user app-data folder, and stops the server when you quit. Installers (Windows NSIS and portable, macOS dmg, Linux AppImage) are produced by `.github/workflows/release.yml` (push a `v*` tag or run the workflow manually); locally, `npm --prefix client run dist` builds one for the OS you are on into `client/release/`.
Installers are unsigned: Windows SmartScreen and macOS Gatekeeper will warn (macOS: right-click, Open). Windows and macOS installers have **not** been built or run by us (see limitations).
Without installers: `launchers/start-desktop.sh` / `.bat` open the Electron window against `scripts/play.mjs` (requires Electron installed).

## Debug flag
Add `?debug=1` to the client URL (or set `localStorage jz_debug=1`) to install the read-only `window.__jz` inspection object that the test scripts use. Without it nothing is exposed.

## Known limitations (honest list)
- **No accounts, passwords or encryption.** A character is just a name; ws:// is plain text. LAN or trusted friends only.
- **The server has no structure collision.** Players and mobs collide with the world edge only, so a hacked client could walk through buildings and the pond (the client camera and visuals treat props as solid, the server does not).
- **Tested headless only.** All automated play-testing ran in headless Chromium with software rendering (about 10 fps) on Linux. Real-GPU frame rate and feel were not measured. The server tests use bots, not people.
- **Audio has never been heard by a human.** Sounds are procedural WebAudio and are checked only by an offline renderer for silence and clipping.
- **Windows and macOS were never run**: the `.bat` launchers, NSIS/portable and dmg installers, and the packaged Electron app on any OS are untested here. The Linux AppImage was not run either (no display in the build sandbox).
- The packaged desktop app runs the server with Electron's embedded Node (needs `node:sqlite`) and falls back to a system `node` 22.5+; if neither works it shows an error and you can still use the browser launcher.
- Prototype scale: one zone, 27 mobs, 30 bag slots, no trading, parties, guilds or PvP. Balance beyond level ~5 is unplayed.

## Troubleshooting
- "Node.js is required / too old": install the current LTS from https://nodejs.org/ .
- Port in use: `PORT=9000 WEB_PORT=9001 node scripts/play.mjs` (Windows cmd: `set PORT=9000` first). If you changed PORT, open `?server=ws://localhost:9000`.
- Browser did not open: open http://localhost:8080/ yourself. `NO_OPEN=1` disables auto-open.
- Black screen / low FPS: enable hardware acceleration, update GPU drivers, try Chrome; F1 has a performance mode.
- "Cannot connect": the server must be running and the server field on the login screen must match its address.
- Node prints an ExperimentalWarning about SQLite: harmless (hidden by the launcher).
- Reset characters: stop the game and delete `data/jiuzhou.db`.

## Developers
```
npm --prefix client install && npm --prefix server install   # once
node scripts/package.mjs        # build client + server bundle, create dist-package/jiuzhou-v<VERSION>/ and .zip
node scripts/play.mjs           # run from the repo (needs client/dist; builds server/dist/server.mjs on demand)
npm --prefix server test        # bot suite (protocol, gameplay, quests, serpents, boss)
npm --prefix client run test:ui # also test:boss, test:audio, test:e2e, test:desktop
npm --prefix client run dist    # Electron installer for the current OS -> client/release/
```
Re-run `node scripts/package.mjs` after any client or server change. Details: `server/README.md`, `client/README.md`, `CHANGELOG.md`, `LICENSE-NOTES.md` (dependency and font licenses), design docs in `docs/`.
