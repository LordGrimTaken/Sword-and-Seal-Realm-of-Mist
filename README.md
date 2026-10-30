# Sword and Seal: Realm of Mist v0.5.0

A Chinese-aesthetic (xianxia, ink-wash) multiplayer fantasy MMO prototype. One authoritative server hosts the
200 x 200 Cloudmist Valley: pick one of four cultivation classes, fight spirits, serpents, toads, hounds and four
telegraphed bosses, run Elder Lin's quest chain and 16 side quests, craft gear from mob drops, climb the cultivation
realms to level 20, and play with friends on the same server.

This is a vertical slice, not a finished game: one zone, one server process, a level cap of 20, and no guilds or PvP
yet (see [Known limitations](#known-limitations-honest-list)). Parties and trades are session-only
(up to five players per party). Release version **0.5.0**.

## What is in the slice

### Zone: Cloudmist Valley (200 x 200 units)
- Plaza with paifang gate, pagoda, lanterns and six plaza NPCs; a lotus pond with an arched stone bridge and koi;
  a bamboo grove to the west; fox hills to the east; the ruined northern shrine of the Stone Guardian; the misty
  south-west hollow with Ink Wisps and the drowned shrine of the Hollow Hierophant; the south-east hollow of the
  Mist Warden.
- Six discoverable places of interest fill the Journal's Atlas and grant XP when you walk close: Hermit's Rest,
  Old Waystone, Serpent's Rest, Fox Fire Hollow, Hound Ridge Cairn and Cloudmist Overlook.
- A 16-minute day/night cycle (dawn, day, dusk, night), layered mist mountains, drifting petals, a shared wind that
  moves grass/bamboo/canopies, pond ripples and fireflies at night. `?tod=0..1` freezes the clock and
  `?todspeed=` sets cycles per minute.
- A deterministic **weather layer** drifts over the valley on its own cycle: clear skies, heavy mist banks and soft
  ink-rain, crossfading over a few seconds. It is purely atmospheric (no gameplay effect); `?weather=clear|mist|rain`
  freezes it for screenshots and UI tests.

### Four classes (4 skills each; every skill costs Qi)
| Class | Role | Base HP (+/level) | Attack (+/level) | Base crit | Skills (keys 1-4) |
|---|---|---|---|---|---|
| Sword Cultivator | Melee bruiser | 120 (+25) | 9 (+3) | 12% | Flowing Slash (fast melee), Sword Qi Wave (mid-range bolt), Heaven-Splitting Strike (heavy melee), Qi Guard (self-heal + 50% damage taken for 5 s) |
| Talisman Master | Ranged elemental caster | 90 (+18) | 8 (+3) | 15% | Fire Talisman (bolt that burns for 3 s), Thunder Talisman (point AoE), Frost Seal (60% slow for 4 s), Wind Step (40% damage reduction for 4 s) |
| Physician | Healer / support | 105 (+22) | 6 (+2.5) | 10% | Jade Needle (cheap ranged), Spring Rain (heals self and allies within 12 units), Purifying Light (point AoE), Meridian Surge (large self-heal) |
| Blade Dancer | Fast crit skirmisher | 100 (+20) | 8 (+2.8) | 20% | Gale Slash (very fast melee), Whirlwind Arc (bolt), Storm of Blades (point AoE), Dancer's Grace (heal + 45% damage reduction for 5 s) |

### Mobs: 11 mob types, 87 spawn points
| Mob | Spawn levels | Notes |
|---|---|---|
| Bamboo Spirit | 1-3, 5-8, 12-15, 17-20 | Melee spirit; telegraphed line smash; drops Bamboo Fiber |
| Fox Spirit | 3-4, 7-11, 13-17, 18-20 | Fast; telegraphed cone bite; drops Fox Tail, rarely Fox-Fur Boots |
| Jade Serpent | 2-4 | Coils, then lunges; the bite poisons for 4 s; drops Jade Scale, rarely Serpent Gall |
| Lotus Toad Warden | 3-5 | Passive until hit; long line spit; drops Toad Jelly |
| Stone Hound | 5-7 | Packs of three (pulling one pulls the pack); cone bite; drops Hound Fang, rarely Stone Hound Greaves |
| Ink Wisp | 4-6 | Fast and weak; line ink lash; drops Wisp Essence, rarely Serpent Gall |
| Thorn Sprite | 3-5 | Passive until hit; ranged thorn line; drops Bamboo Fiber, rarely the Thornweave Hood |
| Old Whisker, the Grey Fox | 5 | Named rare, about five normal foxes in health, wide cone bite, 20-minute respawn |
| Stone Guardian | 8 | Boss (northern shrine) |
| Mist Warden | 8 | Boss (south-east hollow) |
| Hollow Hierophant | 9 | Boss (south-west drowned shrine) |
| The Hollow Bride | 12 | Boss (eastern bride-steps) |

The high-level Bamboo Spirit and Fox Spirit bands exist so the level 1-20 curve has something to level on.

### Four bosses
- **Stone Guardian (lv 8, northern shrine).** Three phases of ground-telegraphed slams, stomps and scattered
  circles. Below 25% health it cracks open and adds a rotating rune beam (28 units long, sweeping 90 degrees, damage
  every 0.3 s); it enrages after 150 s of continuous combat. Drops the Guardian Core.
- **Mist Warden (lv 8, south-east hollow).** Faster telegraphs and less raw health than the Guardian, with the same
  ring and beam vocabulary. Drops Wisp Essence and Serpent Gall.
- **Hollow Hierophant (lv 9, south-west drowned shrine).** Summons 2 Thorn Sprites every 10 s while engaged (wave
  cap, adds cleared when the boss dies or resets) on top of rings and a beam. Drops Wisp Essence, Serpent Gall and
  a chance at the Thornweave Robe.
- **The Hollow Bride (lv 12, eastern bride-steps).** An invulnerable/vulnerable rhythm: for 8 seconds her veil is up
  and every strike passes through her — dodge her telegraphed kerchief lashes and keep moving; for the next 5 seconds
  the veil falls, she takes full damage and hits 1.5x harder. Both transitions are announced, and the target frame
  plus her model (pale veil, cool tint) show which phase she is in.

Every boss attack is telegraphed on the ground and can be walked out of or dodge-rolled through.

### Combat
- **Skills** on keys 1-4 (or click the hotbar): 16 skills total, with cooldowns, ranges, AoE and heals, and a
  0.3 s global cooldown between casts.
- **Qi** is a 100-point jade pool that regenerates 10/s after a 0.4 s pause. Skills cost 3-30 Qi; a refused cast
  tells you the shortfall ("Not enough Qi for ...").
- **Dodge roll (Space):** a 6-unit dash with 0.25 s of invulnerability, 1.5 s cooldown, 15 Qi. It is
  server-authoritative, and a hit that lands during the i-frames reports "Dodged!".
- **Telegraphed attacks:** rings, cones, lines and sweeping beams are drawn on the ground before they land; step
  out or roll through them.
- **Burn:** the Talisman Master's Fire Talisman ignites a mob for 3 damage-over-time ticks, and a burning mob shows
  a flame cue.
- **Potions:** Healing Tonic (40% HP), Lotus Antidote (cures poison, 15% HP) and Qi Elixir (50 Qi) share one 15 s
  cooldown.
- **Death:** respawn at the plaza after 5 s; no items are lost.

### Quests
- **Elder Lin (main chain, 4 quests):** Clear Bamboo Spirits (kill 5) -> Collect Fox Tails (3) -> Cleanse the Pond
  (4 Jade Serpents + 2 Jade Scales) -> Defeat the Stone Guardian. Type `/talk` near Elder Lin, `/quest` for
  progress; the finale rewards the rare Cloudmist Pendant.
- **Lantern Keeper Mei:** the errand "Wicks for the Lanterns" (bring 5 Bamboo Fiber) and the 3-step **Thorns of the
  Reed** side chain: Thorns in the Reeds -> The Sprite's Heart -> Reedwarden (grants the Reedwarden title).
- **16 side quests** across four NPCs: Gate Warden Wu (5), Artisan Tao (5), Peddler Hao (3), Lantern Keeper Mei (3).
  Accept and hand in through the NPC dialog; the Journal (J) lists side quests, merit seals, titles and the Atlas.
- **Daily board** at Notice Board Keeper Fen (or key B): 3 of 11 kill/loot/XP/talk tasks per UTC day, the same board
  for everyone on a given date and a fresh one at 00:00 UTC. Claim each reward once; boss dailies pay the most.
- **30 merit seals** across Combat, Exploration, Story and Craft, with points; some grant a title that shows under
  your nameplate. Six places of interest also grant XP and Atlas entries.

### Equipment, crafting and trading
- **Six gear slots** (weapon, head, body, boots, charm, pendant), four rarities (common, fine, rare, epic) and
  **31 pieces**. Class-locked weapons, level gates, and total damage reduction from gear capped at 40%.
- **Five equipment sets** with escalating bonuses: Wanderer (7 pieces, 2/4-piece), Bamboo Weave (2), Jade (2),
  Houndfang (6, 2/3), Thornweave (3, 2/3). Set bonuses apply automatically as your worn pieces reach each tier.
- **Crafting at Artisan Tao (13 recipes):** three potions, the Bamboo Weave and Fox-Fur pieces, the Jade Scale
  Vest, the Houndfang charm, greaves and class weapons, the Wisp Lantern, the Thornweave Robe and the epic
  Guardian's Heart (level 8, 3 jade). Recipes cost mob materials and coin, with a level gate.
- **Seven materials** drop from mobs: Bamboo Fiber, Fox Tail, Jade Scale, Serpent Gall, Toad Jelly, Hound Fang and
  Wisp Essence. Peddler Hao buys them, sells the three potions and the Wanderer starter kit, and stocks Thornweave
  Boots.
- **Bag** of 30 slots (99 per stack) with search, sort, item tooltips and gear comparison; the Gear panel (G) has a
  slot doll, Equip Best per slot and potion use.

### Progression
- **Levels 1-20** (26,063 XP to the cap): kill XP scales with the level difference (up to +50% for higher-level
  mobs and down to 10% for grey mobs), plus quest and daily XP.
- **Five cultivation realms:** you start as Qi Condensation at level 1 and break through at levels 5, 10, 15 and
  20: Foundation Establishment (+20 max HP) -> Core Formation (+40) -> Nascent Soul (+60) -> Spirit Severing
  (+80). Each breakthrough is announced, and the current realm is shown next to your level.
- **Two currencies:** coin (mob drops, quest rewards, dailies) and jade (boss kills, quest rewards and dailies).
- **Bestiary / Codex (Shift+B):** your persisted kill count for all 11 mob types; undiscovered entries read "???"
  until you slay one.
- **Mist Surge (world event):** every 8 minutes the mist surges for 90 seconds and all mobs deal +20% damage. It is
  announced in chat and a HUD banner counts it down.
- **Lantern Tide (world event #2):** every 10 minutes the lantern tide rises for 2 minutes and every kill pays
  **+50% coin and +25% XP**. It is announced in chat and shown on a gold HUD banner with a countdown; it only
  multiplies kill rewards, never quest/daily rewards or the XP curve.
- **Market Day (world event #3):** every 15 minutes Peddler Hao's stall opens for 3 minutes — he pays **+50%** for
  goods you sell him and charges **-25%** on what you buy. Announced in chat and shown on a paper-red HUD banner;
  the shift applies at the till on the listed prices only (kill, quest and daily rewards are untouched, and the
  stall is never a coin printer).
- **Client-only panels:** Combat Log (C, last 8 blows/heals), Session Statistics (V: mobs slain, damage dealt and
  taken, healing received, XP gained, session time) and a Quest Tracker strip under the minimap.

### Companions, travel and treasure
- **Spirit-sword mount (R):** toggles a flying jian under your feet and a **1.6x**, server-authoritative movement
  speed (no client speed hack: the server owns the step and the anti-cheat ceiling). Casting a skill or dying
  dismounts you; other players see the jian in their snapshots. It is travel only, with no combat bonus.
- **Spirit companion (P):** a cosmetic lantern-fox wisp that drifts after you. Your on/off choice is remembered per
  browser (`localStorage jz.pet`); under Reduce motion it glides at a fixed offset instead of bobbing and orbiting.
- **Treasure caches:** six fixed caches (bamboo grove, pond shore, fox hills, shrine, misty hollow, reed bank).
  Walk within 3.5 units and press **F** (a prompt appears over the cache) for 15-30 coin, a 1-2 stack material roll
  and a 20% chance of a fine gear piece. An opened cache refills after 120 seconds; the state is global and
  session-only (a server restart refills every cache).

### UI, settings and audio
- Paper-scroll HUD: player and target frames, hotbar with cooldowns and Qi costs, Qi/XP bars, minimap, boss bar,
  boss/telegraph warnings, damage numbers, loot toasts, nameplates with titles.
- World map (**N** or click the minimap) with fog of war that lifts as you explore and is remembered per browser.
- Party panel (**O**): members with class, level and live HP bars, the leader marker, and Accept / Decline / Leave.
  The same actions work as chat commands `/invite Name`, `/accept`, `/decline` and `/leave`.
- Trade window: two columns (what you give / what you get) with item stacks, coin offers and a Ready toggle.
  Start with `/trade Name` (both players must be alive and within 6 units). Nothing leaves a bag until both sides
  confirm; the swap is atomic and server-authoritative.
- Settings and help (**F1** or **?**): Sound (master/music/ambience/effects/interface volumes, mute, mute in
  background), Display (text size, chat size/opacity, floating-number toggles, performance mode), Access (colour
  assist for protanopia/deuteranopia/tritanopia, pattern cues, high contrast, reduce motion, photosensitivity-safe
  mode, plain heading font, camera shake), plus export/import/reset of settings.
- Chat with All / Chat / System tabs and unread dots.
- Procedural WebAudio (no audio files): wind/water/bamboo/bird ambience, a guzheng-style music bed, per-class skill
  sounds, hit/death/level-up cues, a boss music layer and UI sounds.

### Multiplayer and the server
- Authoritative 20 Hz simulation, snapshots 10 times/s to entities within 60 units, client prediction with
  reconciliation, interpolation, and server-side movement validation/clamping.
- **Name + password accounts:** the first login with a new name creates the character; later logins need the same
  password. Passwords are salted and scrypt-hashed server-side and never stored in plain text; failed attempts are
  throttled (5 per minute per IP and per name). The hosted launcher signs in with the account API and launches the
  game with a single-use 5-minute token.
- **Persistent characters** in SQLite: name, class, level, XP, position, inventory, Elder Lin's quest progress,
  gear, side quests, merit seals, titles, discovered places, bestiary counters, coin/jade and daily progress.
- Up to 100 players per server, one zone-wide chat, automatic reconnect with backoff, autosave every 30 s.
- **Session-only parties:** up to 5 players. Party members who are alive and within 45 units of a kill receive
  **50% of that kill's XP** (their own level-scaled value); loot, coin, jade and quest credit still go only to the
  credited killers, so nothing is duplicated. The server handles invites (60 s expiry), leader migration and
  disconnect cleanup, and nothing about a party is persisted.
- **Session-only trading:** two players within 6 units of each other can open a trade window and offer item stacks
  and coin. Offers are only references until both sides confirm, the swap is validated and applied atomically, and
  cancelling, disconnecting, dying or walking apart moves nothing. Equipped items can never be traded, so no dupe
  or item-loss path exists.
- One zone and one server process: no guilds, PvP, mail or auction house (NPC and player-to-player trading only).

## Controls
| Key / input | Action |
|---|---|
| W A S D or arrow keys | Move (relative to the camera) |
| Right-mouse drag | Orbit the camera |
| Mouse wheel | Zoom |
| Left click | Select a target; click an NPC to speak |
| Tab / Shift+Tab | Cycle hostile targets forward / back |
| Esc | Clear target, close the open window, or cancel chat |
| 1 - 4 | Use hotbar skills (or click the hotbar; hover for details) |
| Space | Dodge roll (costs Qi) |
| F | Speak to the nearest NPC; open a nearby treasure cache |
| G | Gear: equip weapons/armour/charms, drink potions |
| I | Bag: search, sort and filter your items |
| L | Quest log |
| J | Journal: side quests, merit seals, titles and atlas |
| B | Notice Board: daily tasks and rewards |
| Shift+B | Bestiary / Codex |
| C | Combat Log |
| V | Session Statistics |
| O | Party panel: members, invites, accept/decline/leave |
| P | Spirit companion on/off (remembered per browser) |
| R | Spirit-sword mount on/off (1.6x travel speed) |
| `/trade Name` | Open a trade window with a nearby player |
| N or click the minimap | World map |
| Enter | Chat (Enter sends, Esc cancels); `/talk`, `/quest`, `/daily`, `/invite`, `/accept`, `/decline` and `/leave` are commands |
| M | Mute / unmute |
| F1 or ? | Settings and help (Controls, Sound, Display, Access) |
| F11 / F12 | Fullscreen / devtools (desktop app only) |

Tip: your first quest is with Elder Lin in the plaza, a few steps from where you spawn. Take bamboo spirits one at
a time at level 1-2, dodge (Space) when an attack is telegraphed, and bring friends and healing to the bosses.

## How to run (players)
**Requirements:** Node.js 22.5 or newer (https://nodejs.org/ - nothing else to install for the release zip); a
modern browser with WebGL (Chrome or Edge recommended).

1. Unzip the release.
2. Start it:
   - Windows: double-click `launchers\start-windows.bat`
   - macOS / Linux: `sh launchers/start-mac-linux.sh`
   - any OS: `node scripts/play.mjs` from the unzipped folder
3. Your browser opens `http://localhost:8080/`. On the login screen pick a character name (2-16 letters, digits,
   spaces, `_` or `-`), choose a password (4-64 characters; the first login with a name creates the character) and
   a class, then click **Enter the World**.
4. Characters and accounts are saved in `data/jiuzhou.db`. Close the console window or press Ctrl+C to stop.

The same screen has a server field for joining a host (see below). Optional environment variables for `play.mjs`:
`PORT` (game server, default 8787), `WEB_PORT` (web page, default 8080), `NO_OPEN=1` (do not open a browser),
`DB_PATH` (save file), `NO_SERVER=1` (serve the client only).

## Playing with friends on the same network
1. The host runs the game as above and allows Node.js through the firewall if asked (TCP ports 8787 for the game
   server and 8080 for the web page).
2. The host's console prints a line like
   `Friends on your network: http://192.168.1.20:8080/?server=ws://192.168.1.20:8787`. Friends open that address;
   they install nothing and create their own character with their own password.
3. A friend on their own copy can instead type `ws://HOST:8787` in the login screen's server field, or use
   `?server=ws://HOST:8787` in the URL. The desktop app accepts `--server=ws://HOST:8787` or `JZ_SERVER_URL`.
4. Over the internet you would forward those ports on the router and put TLS in front (a `wss://` reverse proxy),
   because a plain `ws://` connection is unencrypted. Only do this with people you trust.

## Desktop app and launcher
- **Electron desktop app:** `client/electron/main.cjs` opens the game in a window. With no server address it starts
  its own bundled server on a free loopback port (save file in the per-user app-data folder) and stops it on quit;
  `--server=ws://host:port` or `JZ_SERVER_URL` joins an existing server. Build installers with
  `npm --prefix client run dist` (electron-builder; the release workflow `.github/workflows/release.yml` builds
  Windows NSIS/portable, macOS dmg and Linux AppImage). Installers are unsigned by default (signing is documented in
  `docs/SIGNING.md`), so expect Windows SmartScreen and macOS Gatekeeper warnings (macOS: right-click > Open).
- **Standalone launcher:** `launcher/` holds the "Sword and Seal Launcher" (v1.2.2) used by the hosted release:
  account sign-in, download/verify/update the game files from a static host, news and server status, then launch
  with a one-time login token. It is not needed to play from the zip. Protocol, release layout and hosting are in
  `docs/LAUNCHER.md` and `docs/RELEASING.md`.

## Debug flag and test URLs
Add `?debug=1` to the client URL (or set `localStorage jz_debug=1`) to expose the read-only `window.__jz`
inspection object used by the test scripts; without it nothing is exposed. URL parameters: `?server=` (game
server), `?name=` and `?cls=sword|talisman|physician|blade`, `?auto=1` (dev skip-login; uses a test password unless
`&pw=` is given), `?tod=0..1` and `?todspeed=` for the day/night clock, and `?weather=clear|mist|rain` to freeze the
weather layer.

## Known limitations (honest list)
- **Not a finished game.** One 200 x 200 zone, one server process, level cap 20, 100 players max. No guilds, PvP,
  mail or auction house, and no dungeons. Parties (five max) and trades are session-only and lost on restart; the
  spirit-sword mount is a travel toggle (1.6x speed) with no combat effect.
- **Cosmetic and session-only extras:** the weather layer and spirit companion are client-side atmosphere with no
  gameplay effect; party and treasure-cache state live only in server memory and reset when the server restarts.
- **The server has no structure collision.** Players and mobs collide with the world edge only, so a modified client
  could walk through buildings and the pond (the client camera and visuals treat props as solid; the server does not).
- **Self-hosted connections are unencrypted.** A plain `ws://` link carries chat and the password in clear text on
  the network; use it on a LAN or trusted network, or put TLS (`wss://`) in front for the internet. The hosted
  release uses `wss://`.
- **No password recovery.** Accounts are name + password only (no email or reset flow); a forgotten password cannot
  be recovered from inside the game.
- **Automated testing is headless.** The server suites use bot clients and the UI tests use headless Chromium with
  software rendering, so real-GPU frame rate and game feel have not been measured in this build.
- **Audio has never been heard by a human.** All sounds are synthesised in the browser and are checked only by an
  offline renderer for silence and clipping.
- **No desktop installer has been launched.** The Electron window and the Windows/macOS/Linux installers are built
  by the release workflow, are unsigned unless release signing secrets are configured, and have not been verified
  in this environment.
- **Balance is tuned against bots and scripted checks, not human play sessions.** The late levels (10-20) have the
  least coverage.
- The game text is English-only, paired with a Chinese visual identity (ink wash, vermilion seals, brush lettering);
  there is no localisation system.

## Troubleshooting
- **"Node.js is required" / "too old":** install Node 22.5+ from https://nodejs.org/ and run the launcher again.
- **Port in use:** run with other ports, e.g. `PORT=9000 WEB_PORT=9001 node scripts/play.mjs` (Windows PowerShell:
  `$env:PORT=9000; $env:WEB_PORT=9001; node scripts/play.mjs`), then open `http://localhost:9001/` and set the
  server field to `ws://localhost:9000`.
- **Browser did not open:** open `http://localhost:8080/` yourself; `NO_OPEN=1` disables auto-open.
- **Black screen / low FPS:** enable hardware acceleration, update GPU drivers, try Chrome; F1 > Display >
  Performance mode lowers render resolution.
- **"Cannot connect":** the server must be running and the login screen's server field must match it.
- **"This name is protected" / "Wrong password":** the name already has an account; enter its password (it cannot
  be recovered). Pick a different name to start a new character.
- **Node prints an ExperimentalWarning about SQLite:** harmless (the launcher hides it).
- **Reset characters and accounts:** stop the game and delete `data/jiuzhou.db`.
- **No client build in a source checkout:** run `npm --prefix client run build` once before `node scripts/play.mjs`.

## Developers
```
npm --prefix client install
npm --prefix server install
npm --prefix launcher install          # only for launcher work
node scripts/play.mjs                  # run from the repo (needs client/dist; builds server/dist/server.mjs on demand)
node scripts/package.mjs               # player release: dist-package/jiuzhou-v<VERSION>/ and .zip

npm --prefix server run typecheck
npm --prefix server test               # full server suite: bots, telegraphs, economy, API, dodge, content
npm --prefix server run soak           # 3-minute bot soak
npm --prefix client run typecheck
npm --prefix client run lint
npm --prefix client run check:english  # fails on any CJK character in sources/docs/launchers
npm --prefix client run test:ui        # headless UI/browser tests (Playwright)
npm --prefix client run test:e2e       # two browsers, 3-minute session soak (SOAK_S=60 for a quick run)
npm --prefix client run test:boss      # boss bar, telegraphs, phase 3
npm --prefix client run test:audio     # renders every procedural sound offline
npm --prefix client run test:desktop   # packaged-server startup through electron/server-process.cjs
npm --prefix client run dist           # Electron installers for the current OS -> client/release/
npm run launcher:test                  # launcher unit tests
node --test test/publish-release.test.mjs   # release-tool tests against the fake download host
```
The game release version lives in `VERSION` (0.5.0) and drives `scripts/package.mjs` / `scripts/make-release.mjs`;
`server/package.json` and `launcher/package.json` are versioned independently. CI runs `typecheck` + the server
suite + the client checks (`.github/workflows/ci.yml`); tagging `v<version>` runs the multi-OS release build
(`.github/workflows/release.yml`, see `docs/RELEASING.md`).

Repository map:
- `shared/protocol.ts` - the wire contract (protocol v3): messages, entity/skill types, the realm table.
- `server/` - authoritative Node + TypeScript server (`src/data.ts` holds every tunable number; `src/game/` the
  simulation, combat, mobs, world and content systems; `src/db.ts` and `src/contentdb.ts` the SQLite saves).
- `client/` - Vite + three.js client (login, `src/game/`, `src/world/`, `src/models/`, `src/vfx/`, `src/post/`,
  `src/audio/` and the `src/ui/` panels), plus the Electron wrapper in `client/electron/`.
- `launcher/` - standalone Electron launcher (sign-in, download/update, news, server status).
- `launchers/` - the one-click start scripts shipped in the release zip.
- `scripts/` - play/package/build-server/release tooling; `test/` - release-tool tests.
- `docs/` - design bible, rubric, message formats, release, launcher, signing, deployment and the roadmap.
- `infra/` and `website/` - static-download worker and the public site.

More detail: `server/README.md`, `client/README.md`, `docs/DESIGN.md`, `docs/MESSAGE_FORMATS.md`,
`docs/RELEASING.md`, `docs/LAUNCHER.md`, `CHANGELOG.md`, and `LICENSE-NOTES.md` (dependency and font licenses -
three.js, ws and the OFL fonts Ma Shan Zheng / Noto Serif are bundled locally).
