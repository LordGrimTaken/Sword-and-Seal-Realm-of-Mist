# JIUZHOU — Desktop Client

TypeScript + Vite + three.js WebGL client for the Cloudmist Valley vertical slice, packaged with Electron. Talks to
the server over `../shared/protocol.ts` **protocol v3**. Release **0.5.0**. Beyond the combat/HUD core it renders the
party panel, the trade window, the cosmetic spirit companion, the spirit-sword mount, the deterministic weather layer
and the six treasure caches — all described below.

## Run

```
npm install
npm run dev          # Vite dev server on :5173 (point the login screen at ws://localhost:8787)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (typescript-eslint, flat config in eslint.config.js)
npm run build        # tsc --noEmit + vite build -> dist/
npm run preview      # serve dist/ on :4173
npm run electron     # run the built app in Electron; JZ_DEV_URL=http://localhost:5173 uses the dev server
npm run dist         # build + server bundle + electron-builder installers -> release/
npm run check:english # fails (file:line) on any CJK character in client/src, index.html, scripts, electron,
                      # READMEs, CHANGELOG / LICENSE-NOTES / VERSION / package.json files, docs/DESIGN.md,
                      # launchers, root scripts and client/dist (binary fonts skipped)
```

Tests (headless; see [Tests](#tests)): `npm run test:ui`, `test:e2e`, `test:boss`, `test:audio`, `test:desktop`.
Test scripts use `JZ_SERVER_PORT` / `JZ_CLIENT_PORT` (defaults 8981 / 8982).

Server address: default `ws://localhost:8787` for `http(s)` pages and `wss://play.swordandseal.com` for packaged
`file://` builds; it can be overridden with `?server=ws://host:port`, the login-screen field or the stored
`jz.server` value.

URL parameters:

| Parameter | Effect |
|---|---|
| `?server=ws://host:port` | server to join |
| `?name=`, `?cls=sword\|talisman\|physician\|blade` | prefill the login screen (and use them for auto-login) |
| `?auto=1` | skip the login screen (development: uses `testpass1` unless `&pw=` is given) |
| `?pw=` | password for auto-login / tests |
| `?tod=0..1`, `?todspeed=N` | freeze the day/night clock at a time of day, or set cycles per minute |
| `?weather=clear\|mist\|rain` | freeze the deterministic weather layer in one state |
| `?debug=1` (or `localStorage jz_debug=1`) | install the read-only `window.__jz` test surface |
| `?tok=` | testing-only one-time launcher token (scrubbed from the address bar immediately) |

## Controls

| Key / input | Action |
|---|---|
| W A S D / arrow keys | Move (camera-relative) |
| Right-mouse drag | Orbit the camera |
| Mouse wheel | Zoom |
| Left click | Select a target / click an NPC to speak |
| Tab / Shift+Tab | Cycle hostile targets forward / back |
| Esc | Close the open window, else clear the target, or cancel chat |
| 1 2 3 4 | Use hotbar skills (click the hotbar too; hover for cooldown/range/Qi details) |
| Space | Dodge roll (costs Qi, brief invulnerability) |
| F | Speak to the nearest NPC; open a nearby treasure cache |
| G | Gear: six slots, Equip Best per slot, potion use |
| I | Bag (search, sort, filter, item tooltips with gear comparison) |
| L | Quest log |
| J | Journal: side quests, merit seals, titles, Atlas |
| B | Notice Board: 3 daily tasks and rewards (also the Board button / Fen) |
| Shift+B | Bestiary / Codex (persisted kills per mob type) |
| C | Combat Log (last 8 blows/heals) |
| V | Session Statistics |
| O | Party panel: members, invites, accept/decline/leave |
| P | Spirit companion on/off (persisted per browser) |
| R | Spirit-sword mount on/off (server-authoritative 1.6x travel) |
| `/trade Name` | Open the trade window with a nearby player |
| N or click the minimap | World map (fog of war lifts as you explore, remembered per browser) |
| Enter | Chat (Enter sends, Esc cancels); `/talk`, `/quest`, `/daily`, `/invite`, `/accept`, `/decline` and `/leave` are server commands |
| M | Mute / unmute |
| F1 or ? | Settings and help (Controls, Sound, Display, Access tabs) |
| F11 / F12 | Fullscreen / devtools (desktop app only) |

This table matches the key handlers in `src/game/game.ts`, `src/game/input.ts`, `src/main.ts` and `src/ui/help.ts`
(F1 lists the same controls). Panel keys are attached where the panel lives: C/V/Shift+B/O/P/R in `main.ts` plus
`game.ts`, everything else in `game.ts`/`input.ts`.

## Architecture (`src/`)

- `main.ts` — boot, login flow, client-only panel wiring (combat log, quest tracker, stats, bestiary, party, pet,
  mount key), reconnect, `window.__jz` debug surface (only with `?debug=1`). Debug getters: `state` (connection, HUD,
  quest, wallet, daily, xp bar, boss bar, Qi, dodge, **chests**, perf counters, entities; plus `state.cam`/`state.scene`
  for screenshots), `screen`, `audio`, `launcher`, `combatLog`, `questTracker`, `combatFeedback`, `stats`, `bestiary`,
  `pet`, the `mount()` action, `inject(msg)` to feed a fabricated server message through the normal handler and
  `say(text)` to send chat. (`window.__jzWeather` is installed unconditionally by the weather layer, not by this flag;
  see below.)
- `net/` — `client.ts` WebSocket + ping/pong; `login.ts` v3 handshake and `reconnectWithBackoff` (1, 2, 3, 5, 8,
  10 s); `interp.ts` per-entity snapshot buffers (render 100 ms behind); `predict.ts` client prediction
  (inputs in fixed 1/20 s steps, ack replay, smoothing/snap).
- `game/` — `game.ts` main loop, message/event handling, targeting/casting, VFX hooks, danger-telegraph tracking,
  combat log/statistics feeds, the `party`/`chests` messages, mount flag → entity rendering, pet follow/update;
  `entities.ts` entity <-> avatar sync and disposal (including the lazily created spirit-jian under a mounted player);
  `camera.ts` spring-arm follow camera with prop occlusion; `input.ts`; `targeting.ts`; `juice.ts` hit-stop/nudge/flash.
- `world/` — procedural Cloudmist Valley: terrain, water/pond ripples, sky, day/night, structures, vegetation, ambient
  particles, wind, signage/calligraphy, POI markers, ambient life, and the `weather.ts` deterministic clear/mist/rain
  layer (`?tod`/`?todspeed` control the 16-minute day cycle, `?weather` freezes the weather).
- `models/` — all in-engine models: players per class, NPCs, mobs and bosses, weapons/props, the cosmetic
  **spirit companion** (`pet.ts`), the **spirit-sword mount** (`mount.ts`) and the **treasure-cache** model
  (`chest.ts`, plus the camera-facing "F Open cache" prompt); `vfx/` — ink-brush combat effects, telegraph shapes,
  dodge roll, level-up/respawn effects; `post/` — the ink-wash post-processing composer.
- `ui/` — DOM overlay. `hud.ts` builds the HUD and owns unit frames, hotbar, XP/Qi bars + realm chip, minimap, boss
  bar, warnings, the Mist Surge / Lantern Tide banner, loot toasts, nameplates, chat and the settings help window
  (`help.ts`, `settings.ts`, `skilltips.ts`, `itemtips.ts`). Panels: `bag.ts`, `gear.ts`, `journal.ts`, `quest.ts`
  (tracker + log), `npcpanel.ts`, `board.ts`, `wallet.ts`, `bestiary.ts`, `combatlog.ts`, `stats.ts`, `questtracker.ts`,
  `party.ts` (key O), `trade.ts` (the two-column trade window + request card, driven by the `trade` message),
  `feedback.ts`, `worldmap.ts`, `minimap.ts`, `dialog.ts`, `login.ts`, `contentui.ts` (routes the
  `items` / `gear` / `npcdlg` / `sq` / `prog` / `toast` messages), `glyphs.ts`, `icons.ts`, `gearicons.ts`. Styling:
  `style.css` (palette tokens, HUD/panels, accessibility) and `content.css` (content-window classes); the palette comes
  from `../docs/DESIGN.md`.
- `art.ts` — the single import point for `world/`, `models/`, `vfx/` and `post/`.
- `audio/` — procedural WebAudio: `index.ts` (ambience/music/sfx/mixer), crash-proof singleton `instance.ts`
  (gesture unlock, mute, HUD volume slider) and offline `selftest.ts`.

Fonts are bundled through @fontsource (Ma Shan Zheng Latin brush display, Noto Serif Latin body) and exposed as
`--font-display` / `--font-body`.

## HUD, combat feedback and world readability

- Paper-scroll HUD: player frame (name, class, level, HP + Qi bars), target frame (with a "Burning" flag when a
  mob is burning), hotbar with cooldown sweeps and Qi costs, dodge slot, thin gold XP bar with the cultivation realm
  chip beside it, boss bar (top centre; still wired to the **Stone Guardian**), loot toasts, damage numbers (crit
  splash, jade heals) and level-up/quest-complete banners.
- **Telegraphed attacks** arrive as `telegraph` events with an optional shape: circles, cones, lines and sweeping beams
  are painted on the ground (`vfx.telegraphShape`), listed as danger discs on the minimap, and warned with a banner
  ("… winds up!" / "Rune beam!"). Damage lands after the wind-up and only on players still inside; escaping shows
  "Dodged!". Regular mob swings stay visually quiet; boss attacks get the full frame-shake/audio treatment.
- **Qi and dodge:** the Qi bar under the HP bar shows the server value (corrected for casts in flight); Space spends
  15 Qi for a 6-unit, 0.25 s invulnerable roll with a 1.5 s cooldown. Refused casts flash the bar and say why.
- **Burn:** a burning mob gets a flame-tinted body cue, the target frame shows "Burning", and the fire DoT is visible in
  the floating numbers — all driven by the snapshot `burning` flag, so it clears on the next snapshot when the DoT ends.
- **Client-only overlays:** Combat Log (C, last 8 lines from the `ev` damage/heal stream), Session Statistics (V:
  mobs slain, damage dealt/taken, healing received, XP gained, session time; reset per connection) and the Combat
  Feedback overlay (vermilion edge flash on damage taken, slow low-HP pulse; respects reduce-motion and
  photosensitivity-safe mode and never blocks pointer input).
- **Mist Surge, Lantern Tide and Market Day banners:** a compact top-centre strip with the remaining time while any
  repeating world event runs; it follows the structured `surge` / `tide` / `market` messages (and the matching system
  chat lines) and hides itself when the window ends. Mist Surge is the red/ink warning style, Lantern Tide the gold
  reward style, and Market Day the paper-red merchant strip (it also lists the live sell/buy bonus).
- **Treasure-cache prompt:** a camera-facing "F Open cache" chip over the nearest ready cache within 3.5 units; the
  lid/glow animation follows the `chests` message and the server answers the F key with `openchest`.
- Minimap: round ink-wash disc with entities (Jade Serpents get a jade diamond, the Stone Guardian a vermilion boss
  seal) and the danger discs of active telegraphs; click it or press N for the full world map.

## Social and ambient systems

These are the client-side halves of the 0.5.0 systems; the authoritative rules live on the server
(`../server/README.md`).

- **Party panel (O).** A compact paper card that mirrors the server's session-only `party` message: member rows with
  class, level and live HP bars, a leader marker, and Accept / Decline / Leave buttons for the pending
  `inviteFrom` prompt. It hides itself while solo; pressing O with no party toasts a hint instead. The same actions
  are reachable as chat commands (`/invite Name`, `/accept`, `/decline`, `/leave`, `/party` to resync), and the
  client sends `{t:"party", a, name?}` for the buttons. Party state is never persisted.
- **Spirit companion (P).** A cosmetic lantern-fox wisp (`models/pet.ts`) that trails the local player, with a soft
  lantern halo, jade tail glow and drifting motes (about 4 draw calls). P toggles it and the preference is stored in
  `localStorage jz.pet` (absent = on); with Reduce motion the bobbing/orbiting/glow pulsing freezes and it glides at a
  fixed offset. Never affects gameplay and is never sent over the wire.
- **Spirit-sword mount (R).** R asks the server to flip the mount (`{t:"mount"}`); the server owns the state and the
  **1.6x** speed, and snapshots echo it as `EntityState.mounted`. The client draws the flying jian under the rider
  (`models/mount.ts`, lazily created per player and reused, with the avatar lifted 0.62 units), and clears it on the
  next snapshot when dismounted (casting a skill or dying dismounts server-side).
- **Weather layer.** `world/weather.ts` is a deterministic, purely cosmetic cycle of clear / mist banks / soft ink-rain
  driven by world time (~74 s epochs with a 10 s crossfade, smooth noise so moods persist); the mist and rain shaders
  drift with the shared wind, tint with the current sky, and scale their motion down with Reduce motion.
  `?weather=clear|mist|rain` freezes one state, and the always-installed `window.__jzWeather` debug hook exposes
  `{ force(kind|null), state(), clear() }`.
- **Treasure caches.** `models/chest.ts` builds the six procedural cache models and the F prompt; state arrives as the
  `chests` message (fixed spots, positions, `ready`) and is pushed again when one opens or refills. The client never
  opens a cache locally — it sends `{t:"openchest", id}` and renders the resulting `chests` state and loot events.
- **Debug hooks for the new systems.** `window.__jzWeather` is always installed by `world/weather.ts` and exposes
  `{ force(kind|null), state(), clear() }`. With `?debug=1` (or `localStorage jz_debug=1`), `window.__jz` adds
  `__jz.pet` (`{enabled, visible, x, y, z, bob, glow}`, where `bob`/`glow` freeze under Reduce motion),
  `__jz.mount()` (sends the mount toggle through the live socket exactly like R), and the chest state at
  `__jz.state.chests` (`[{id, x, z, ready, hovered}]`). Party state is server-driven: tests read the `#party` DOM
  panel or `__jz.inject({t:"party", ...})`; there is no separate party getter.

## Content UI (server-driven)

- **Gear (G)** — six slots, equipped bonuses, "Equip Best" per slot, potion use; **Bag (I)** — 30 stacks, search, sort,
  type filters, tooltips with rarity/stats and a "vs equipped" comparison.
- **Journal (J)** — side quests (also mirrored by the persistent Quest Tracker strip under the minimap), **30 merit
  seals** with points, owned/worn titles, and the Atlas of the 6 places of interest.
- **NPC panel** — pressing F next to Gate Warden Wu, Artisan Tao, Peddler Hao or Lantern Keeper Mei opens a paper-scroll
  panel: Tasks tab (Accept / Hand in for the **16** side quests), plus Craft (Tao) and Buy/Sell (Hao). Elder Lin and
  Mei's original errands stay on the chat/`/talk` path and appear as dialog notes.
- **Notice Board (B)** — the 3-of-11 daily tasks with progress, rewards and a claim seal; Fen opens it from a
  conversation. The wallet pill (coin + jade) sits left of the minimap.
- **Bestiary / Codex (Shift+B)** — every mob type with the persisted kill count; never-slain entries read "???" / 0,
  discovered entries show the name and "N slain" (fixed data order, live updates from the `best` message).
- **Realm/level display:** the XP bar shows `Lv N · xp / next`; the current cultivation realm (Qi Condensation …
  Spirit Severing) is displayed beside it and changes on a breakthrough.

## Progression, quests and networking (client side)

- **Login (protocol v3):** sends `v: 3` and either `pw` (4-64 chars; a new name registers, a known name must match) or
  a one-use launcher `tok`. The login screen remembers the last name and class but never the password.
- **Server messages consumed:** `welcome`, `snap`, `ev`, `pong`, `inv`, `wallet`, `daily`, `error`, `items`, `gear`,
  `npcdlg`, `sq`, `prog`, `toast`, `best`, `surge`, `tide`, `market`, `party` and `chests`; the client sends `input`,
  `cast`, `dodge`, `chat`, `claim`, `ping`, `equip`, `unequip`, `use`, `npc`, `craft`, `buy`, `sell`, `title`, `mount`,
  `party` (invite/accept/decline/leave) and `openchest`, and reads `EntityState.mounted` from snapshots.
- **Quests:** Elder Lin's 4-quest chain and Mei's "Wicks for the Lanterns" errand are chat-driven (`Elder Lin: …` /
  `Lantern Keeper Mei: …` system lines; `ui/dialog.ts` shows them as paper notes). Side quests use the structured
  `sq`/`npcdlg` panels. `/quest` is sent silently on login/respawn so the tracker starts correct.
- **Reconnect:** on a dropped socket the HUD shows "Connection Lost / Reconnecting", the client re-logs in with the
  same name/class (up to 6 attempts), calls `Game.rebind()` (fresh entities, predictor, HUD session state, panels) and
  falls back to the login screen if all attempts fail. In launcher mode a dropped connection cannot re-authenticate
  (the token is single use), so it asks the player to restart from the launcher.
- Chat is sanitised (control characters stripped, 120 code points) and rate-limited client-side (4 burst, one per
  ~1.6 s); internal `/talk` `/quest` commands queue instead of dropping. Inputs are sent at a fixed 20 Hz with a
  timer fallback when frames stall.

## Settings, accessibility and audio

- **F1 / ?** opens Controls, Sound, Display and Access tabs. Every value lives in one versioned object
  (`jz.settings.v1`) that can be exported/imported as text and reset; it drives the audio buses and `data-*` attributes
  on `<html>` (so CSS applies themes directly).
- **Sound:** master plus music/ambience/effects/interface buses, mute, mute-when-background, hover ticks, per-category
  volume. All audio is synthesised in the browser (no audio files): wind/water/bamboo/bird ambience, a guzheng-style
  music bed, per-class skill sounds, hit/death/level-up cues, a boss music layer and UI sounds.
- **Accessibility:** text size 100/125/150 %, chat size/opacity, floating-number toggles, colour assist for
  protanopia/deuteranopia/tritanopia, pattern cues (never colour alone), high contrast, reduce motion
  (defaults from the OS), photosensitivity-safe mode, plain heading font, camera-shake slider, keyboard-focusable
  hotbar/panels with visible focus rings, and ARIA live regions for chat, loot and warnings.
- **World map:** full-screen parchment map with a fog-of-war grid that lifts as you explore and is stored per browser
  (`jz.map.explored.v1`).

## Tests

| Script | Covers |
|---|---|
| `npm run test:ui` | server + Vite dev server; login (v3 password flow), wallet, Notice Board + Fen, level cap, NPC dialog, quest tracker, help overlay, tooltips, HUD overlap at 1280x720 and 1920x1080, 20 Hz input, reconnect after a server restart, console cleanliness. Screenshots: `docs/shots/ui_*.png` |
| `npm run test:e2e` | real server + built client in two headless Chromium pages plus WebSocket class bots: both clients see each other, WASD movement is server-confirmed, a camera tour runs, an unfinished daily claim is refused, plus draw-call/geometry/texture resource checks and console cleanliness (`SOAK_S=60` for a quick run). Screenshots: `docs/shots/e2e_*.png` |
| `npm run test:boss` | real server in TEST_MODE; teleports a high-level player to the Stone Guardian and checks the boss bar, telegraph warning/danger ring, real `inv` messages; screenshots both resolutions (`docs/shots/boss_*.png`) |
| `npm run test:audio` | renders every procedural sound offline and fails on silence or clipping |
| `npm run test:desktop` | spawns the packaged server bundle through `electron/server-process.cjs` (free port, `/health`, real ws login, save file, clean stop) without a display |
| `npm run check:english` | no CJK characters in player-facing sources or the built client |

All browser tests use headless Chromium with software rendering, so real-GPU frame rate and game feel are not
measured by them.

## Desktop app (Electron)

`client/electron/main.cjs` loads `dist/index.html`. With no server address (`JZ_SERVER_URL` or `--server=ws://host:port`)
it starts its own bundled server — `electron-builder.config.cjs` ships `server/dist/server.mjs` as the extra resource
`<resources>/server/server.mjs` — through `electron/server-process.cjs` on a free loopback port (save file
`jiuzhou.db` in the app's user-data folder) and stops it on quit. `preload.cjs` and `launcher-session.cjs` expose the
launcher handoff (one-use session token, never in the URL). Installers are built with electron-builder (`npm run dist`:
Windows NSIS + portable, macOS dmg + zip universal, Linux AppImage; `asar: false` for delta updates). Signing is wired
through `scripts/lib/builder-signing.cjs` and is inert without secrets, so unsigned builds are expected.

## Known limitations

- The server has no prop/terrain collision, so a modified client can walk through buildings and the pond; the client
  camera and visuals treat props as solid, but the server only clamps to world bounds.
- The boss health bar is still wired to the Stone Guardian only (the Mist Warden and Hollow Hierophant have no boss
  bar yet).
- **Session-only / cosmetic systems:** party state lives in server memory only (no persistence across a relog or
  restart, max 5 players, no guild equivalent), and treasure-cache state is global and session-only (a restart
  refills every cache). The weather layer and spirit companion are purely cosmetic; the mount is a travel toggle
  (1.6x speed) and casting or dying dismounts.
- The desktop window and installers are built by the release workflow and have not been launched in this environment;
  audio has only been verified by an offline renderer, never heard by a human.
- Client-only panels (Combat Log, Session Statistics, Quest Tracker, Bestiary, Combat Feedback) are display-only and
  reset on a new connection; they never change game state.
