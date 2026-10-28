# Changelog

## 0.3.0 — English localization

All player-facing text is now English; the Chinese identity is carried by aesthetics only (ink wash, vermilion seals, brush lettering, paper scrolls).

- Removed every hanzi from the client UI, game code, banners, damage numbers, quest tracker/log/dialog, bag, help, login, overlays, window title and Electron product name (kept as "Jiuzhou"). Server strings are English; the protocol `*Zh` fields are ignored.
- New fonts: Ma Shan Zheng (Latin brush script) for display and headings, Noto Serif (Latin 400/600/700) for body text; CSS variables `--font-display` / `--font-body`. Noto Serif SC and all Chinese font files were dropped, shrinking the package.
- Hand-drawn vector brush pictograms replace the hanzi seal icons: 12 skill icons, item icons (fibre, fox tail, rune core, scale, vial, lantern, gourd, jade disc, stamp, pouch), class crests and NPC seals.
- Crits are an ink-splash with "CRIT"; level-up is "Level Up" in brush lettering; quest completion stamps a vermilion "COMPLETE" seal; "Dodged!" feedback.
- `npm run check:english` (client) scans sources, docs, launchers and the built output for CJK characters. Test scripts now assert English strings.
- QA pass: loot and NPC-interest checks in `server/scripts/bots.ts` are deterministic (TEST_MODE `/testdrops` forces loot rolls; the NPC `gone` check teleports a parked bot out of range instead of depending on a fighting bot's route). New TEST_MODE hooks `/testdrops` and `/testkill [type] [n]` (real kill, XP, loot and quest path). `ui-test.mjs` telegraph check uses a 6 s wind-up and the walk helper tolerates software-GL frame stalls.
- Legibility: level-up lettering sits on an ink scrim with a thicker outline (readable over the gold pillar); the boss warning banner moved below the boss bar.
- Removed the last hanzi from `shared/protocol.ts` comments and the grader docs; v0.1/v0.2 packages removed from `dist-package/`.
- Docs: DESIGN.md documents the English-with-Chinese-aesthetic rule and the font decision. Version 0.3.0.

## v0.2.0 (round 3: merge, QA, desktop delivery)

### Content
- Lantern Keeper Mei now has a real errand, "Wicks for the Lanterns": bring 5 Bamboo Fiber, receive XP and a Paper Lantern. Server-driven (`/talk` / F), persisted in sqlite, with server tests.

### Desktop delivery
- Packaged Electron app now starts the bundled game server itself on a free loopback port (save file in the per-user app-data folder) and stops it on quit; `--server=ws://host:port` / `JZ_SERVER_URL` skips it. Logic lives in `client/electron/server-process.cjs` and is covered by `client/scripts/desktop-server-test.mjs` (spawns the real server bundle, health check, ws login, stop).
- `electron-builder` config: NSIS + portable (Windows), dmg (macOS), AppImage (Linux); the server bundle ships as an extra resource. Electron bumped to ^37 (embedded Node 22.x for `node:sqlite`; falls back to a system Node).
- `.github/workflows/release.yml`: matrix build on windows/macos/ubuntu that builds the client and server bundle, runs the desktop server test and uploads installers. Not run in this sandbox.

### Docs and fixes
- README rewritten: full controls, slice contents, LAN hosting, `?debug=1`, honest known limitations. LICENSE-NOTES refreshed.
- Version 0.2.0 across packages.

## v0.1.0 (build 3)

First playable release of JIUZHOU: a Chinese-aesthetic (xianxia, ink-wash) multiplayer fantasy MMO prototype set in Cloudmist Valley.

### Gameplay
- Three classes (Sword Cultivator, Talisman Master, Physician) with four skills each, cooldowns, ranges, AoE and heals.
- Mobs: Bamboo Spirit, Fox Spirit, Jade Serpent (pond and bridge), and the Stone Guardian boss with a telegraphed ground slam you can dodge.
- Elder Lin's quest chain, now four steps (bamboo, fox tails, the pond, the Stone Guardian), with item rewards.
- Server-side inventory that persists across relogs; materials and quest rewards land in the bag.
- Death and respawn, XP and levels, fixed 20 Hz authoritative server with client prediction and interpolation.

### Client UI
- Bag window (key I or the bag button): English item names, quantities, "new" highlight, seal icons.
- Loot toasts with item seals, boss health bar with a 50 percent phase marker, level-coloured nameplates, jade serpent and boss minimap markers.
- Boss telegraph: ground ring, on-screen warning, minimap danger disc, gong and impact audio, camera shake, "Dodged" feedback.
- Paper-scroll HUD: unit frames, hotbar with cooldown numbers, minimap, quest tracker and log, chat, NPC dialog, help and settings.
- Procedural WebAudio: ambient guzheng bed, UI, per-class skills, hits, boss roar, warning gong and slam thud.

### Engineering
- Shared protocol v2 (`shared/protocol.ts`): `inv` message, `telegraph` event, `jade_serpent` mob type.
- `window.__jz` debug surface is only installed with `?debug=1` (or `localStorage jz_debug=1`).
- Test scripts: `client/scripts/ui-test.mjs`, `e2e.mjs`, `audio-selftest.mjs`; ports come from `JZ_SERVER_PORT` / `JZ_CLIENT_PORT` (defaults 8981 / 8982).
- Removed committed scratch folders (`client/audio-test`, `client/art-preview`).
- Desktop: Electron wrapper plus browser launchers for Windows, macOS and Linux (Windows and macOS installers must be built on those systems).
