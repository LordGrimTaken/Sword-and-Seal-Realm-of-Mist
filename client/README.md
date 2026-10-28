# JIUZHOU — Desktop Client

TypeScript + Vite + three.js, packaged with Electron. Talks to the server defined by `../shared/protocol.ts`.

## Run
```
npm install
npm run dev          # Vite dev server on :5173
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (typescript-eslint, flat config in eslint.config.js)
npm run test:e2e     # node scripts/e2e.mjs: server + built client, 2 browser pages, class bots, 3-min resource soak (SOAK_S=60 for a quick run)
npm run test:ui      # node scripts/ui-test.mjs: HUD, dialog, bag, telegraph warning, layout at 1280x720 and 1920x1080, reconnect
npm run test:boss    # node scripts/boss-test.mjs: server in TEST_MODE, teleports next to the Stone Guardian, checks boss bar, telegraph warning/ring, real inv messages
npm run test:audio   # node scripts/audio-selftest.mjs: renders every procedural sound offline, fails on silence/clipping
npm run build        # tsc --noEmit + vite build -> dist/
npm run preview      # serve dist on :4173
npm run electron     # run the built app in Electron (after build); set JZ_DEV_URL=http://localhost:5173 to use the dev server
npm run check:english # node scripts/check-english.mjs [--dist DIR]: fails (file:line) if any CJK character is in client/src, index.html, scripts, electron, READMEs, launchers, root scripts or client/dist (inlined JS/CSS; binary fonts skipped)
npm run test:desktop # node scripts/desktop-server-test.mjs: spawns the server bundle through electron/server-process.cjs (free port, /health, ws login, stop)
npm run dist         # build + server bundle + electron-builder installers -> release/
```
Server default `ws://localhost:8787`; override with `?server=ws://host:port` or the login-screen field.
URL params: `?name=X&cls=sword|talisman|physician&auto=1` skip the login screen. `?debug=1` (or `localStorage jz_debug=1`) installs the `window.__jz` test surface; without it nothing is exposed.
Test scripts use `JZ_SERVER_PORT` / `JZ_CLIENT_PORT` (defaults 8981 / 8982).

## Controls
WASD move (camera-relative) · RMB drag orbit · wheel zoom · LMB click target · Tab cycle nearest hostile · Esc clear target ·
1-4 skills (or click hotbar) · F speak to nearest NPC (or click an NPC) · I bag (or the bag button) · B Notice Board (daily tasks; or the Board button) · L quest log · F1 or ? help/settings · M mute · Enter chat (Enter sends, Esc cancels) · F11 fullscreen / F12 devtools (Electron).

## Architecture (`src/`)
- `main.ts` boot, login flow, `window.__jz` debug surface, only with `?debug=1` (read-only getters: `state.{connected,ready,myId,entityCount,fps,ping,zone,pos,hp,level,target,tick,kills,lastError,predErr,inv,bagOpen,wallet,daily,xpBar,bossBar,dangers,ents}`, `screen`, and `inject(msg)` to feed a fabricated server message through the normal handler; plus non-enumerable `state.cam` (the FollowCamera, yaw/pitch/dist writable) and `state.scene` for screenshot/inspection scripts).
- `net/client.ts` WebSocket + ping/pong. `net/interp.ts` per-entity snapshot buffers, render 100 ms behind.
  `net/predict.ts` client prediction: inputs simulated in fixed 1/TICK_RATE steps at PLAYER_SPEED, sent with `seq`; on each snapshot rewind to server pos, drop inputs <= `ack`, replay the rest; small errors are smoothed, >4 units snap.
- `game/game.ts` main loop, events, targeting/casting, VFX hooks (local/nearby casts, `levelUp` pillar and `respawn` ripple for the local and nearby players; remote effects are dropped once ~14 pooled effects are live so crowds stay under the draw-call budget; avatars LOD: ink hull < 10 m, shadow blob < 18 m, hidden > 32 m from the camera). `game/entities.ts` entity <-> avatar sync. `game/camera.ts` (spring-arm follow camera: bakes a coarse collider grid from the structures/vegetation meshes and shortens the arm when terrain or props sit between hero and camera; snaps in, eases out; each 0.5 m grid cell stores up to 3 vertical intervals so the camera can sit under eaves / between a platform and its roofs; leaf cards dither away when the arm ends inside a canopy), `game/input.ts`.
  `EntityManager.remove` disposes per-avatar geometries/textures so GPU memory plateaus (check `__jz.state.perf`).
- `ui/` login screen, HUD (DOM overlay: unit frames, hotbar, boss bar, warning banner, loot toasts), `bag.ts` (inventory window), minimap (jade serpent diamond, boss seal, telegraph danger discs), `style.css` (palette tokens from docs/DESIGN.md). Fonts bundled via @fontsource: Ma Shan Zheng (Latin subset, brush display) and Noto Serif (Latin 400/600/700, body); CSS variables `--font-display` / `--font-body`. `icons.ts` holds the hand-drawn SVG pictograms for skills, items, classes and NPC seals (no letters).
- `art.ts` single import point; re-exports the real `world/`, `models/`, `vfx/`, `post/` modules.
- `audio/` procedural WebAudio (`index.ts`), crash-proof singleton `instance.ts` (gesture unlock, M mute, HUD volume slider), offline `selftest.ts`.

## Art modules
Game code imports only from `src/art.ts`, which re-exports `world/`, `models/`, `vfx/` and `post/`.

## Inventory, loot and boss telegraphs
- The server owns the inventory: it sends `{t:"inv", items}` after `welcome` and on every change, and `ui/bag.ts` simply replaces its list (so the bag survives relog). Entries that are new or grew since the last message get a "new" highlight until the bag is opened and closed; the HUD bag button shows a gold dot meanwhile. `loot` events additionally raise a toast with the item pictogram.
- `telegraph` events (`x, z, radius, delay`): `game.ts` calls `vfx.telegraph(at, radius, delay)` if the art module provides it, shows the "Stone Guardian winds up!" banner, adds a pulsing danger disc to the minimap, plays `audio.warn()` and, when the wind-up elapses, `audio.impact()` plus a camera shake. Escaping a ring you started inside shows "Dodged!".
- The boss bar (top centre, gold marker at 50 percent, "Enraged" text below it) shows while the Stone Guardian is targeted or within 40 units. Mob nameplates are coloured by level difference (grey, white, orange, red with a skull from +5).

## NPCs, quests, networking (UI layer)
- `ui/dialog.ts` paper-scroll NPC dialog. Elder Lin and Lantern Keeper Mei (quest givers) are driven by the server: the dialog sends `/talk` and shows the sys-chat reply (`Elder Lin: ...` / `Lantern Keeper Mei: ...`; Mei's `Task accepted:` / `Task:` / `Task complete:` lines appear as dialog notes and are not tracked by `quest.ts`). Other NPCs use client-side English flavour text. Out of range shows "Walk closer" with the live distance.
- Protocol v3: login sends `v:3` and `pw` (4-64 chars; `?auto=1` defaults it to `testpass1`, `&pw=` overrides). `wallet` drives `ui/wallet.ts` (lacquer pill left of the minimap: coin + jade, tick-up, pulse, floating +N); `daily` drives `ui/board.ts` (Notice Board, key B or talking to Notice Board Keeper Fen; sends `{t:"claim",id}`; vermilion dot on the Board button while a reward is claimable). At the level cap the `xp` event has `next:0`: the bar is full gold and reads MAX.
- `ui/quest.ts` quest tracker (under the minimap), quest log (L) and the vermilion COMPLETE seal stamp. Parses `[Quest n/N] Title: c/m` (optionally followed by a `(A x/y, B x/y)` breakdown for two-objective quests), `Quest accepted:`, `Quest complete:`, `No active quest`, with kill/loot events as a fallback; `/quest` is sent silently on login/respawn.
- `net/login.ts` shared login handshake and `reconnectWithBackoff` (1, 2, 3, 5, 8, 10 s). On a drop `main.ts` shows "Connection lost - reconnecting", re-logs in with the same name/class, calls `Game.rebind()` (clears entities, predictor, HUD session state) and falls back to the login screen if all 6 attempts fail. Every socket close is logged with `console.info("[net] socket closed: code=... reason=...")`.
- Chat is sanitised (control characters stripped, 120 code points) and rate-limited client-side (4 burst, 1 per 1.6 s); internal `/talk` `/quest` queue instead of dropping.
- Inputs are sent at a fixed 20 Hz from the render loop, with a 50 ms timer fallback when frames take longer than 60 ms.

## UI test
`node scripts/ui-test.mjs` (Playwright from /opt/npm-tools): boots the server (temp DB) and Vite (no HMR, `scripts/vite.uitest.config.mjs`) on the test ports, drives login, NPC dialog, quest tracker, bag, telegraph warning, tooltips, help, layout overlap checks at 1280x720 and 1920x1080, input rate, server-restart reconnect and console cleanliness. Screenshots go to `docs/shots/ui_*.png` (e2e: `e2e_*.png`).

## Desktop app (Electron)
`electron/main.cjs` loads `dist/index.html`. With no server address (env `JZ_SERVER_URL` or `--server=ws://host:port`) it starts the bundled server (`server/dist/server.mjs`, shipped as an electron-builder extra resource at `<resources>/server/server.mjs`) through `electron/server-process.cjs`: a free loopback port, `PORT`/`DB_PATH` env (save file `jiuzhou.db` in the app's userData folder), first with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`, needs `node:sqlite`, i.e. Electron >= 35 / Node >= 22.5), then with a system `node`; the client is opened with `?server=ws://127.0.0.1:<port>`; the server is stopped on quit. Installers: `.github/workflows/release.yml`. Verified here: `node --check`, `test:desktop` (plain Node). Not verified: an actual Electron window or any installer.
