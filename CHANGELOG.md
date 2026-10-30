# Changelog

## 0.5.0 - The Hollow expansion (2026-10-30)

Content and systems added on top of 0.4.0; protocol stays v3 (every message is additive).

**Classes and combat**
- **Blade Dancer**, a 4th class: a fast melee duelist with its own Dao weapons, crest, glyph, skill icons, cast VFX and audio. Four skills with Qi costs and cooldowns, wired through the same authoritative cast pipeline as the other classes.
- **Burn** damage-over-time: the Talisman Master's Fire Talisman now ignites its target (3 ticks over 3 s, scaling with level). The burn ticks as ordinary `damage` events, so it grants threat/XP and can finish a kill. Visible client-side: flame sprites plus a warm emissive pulse on the burning mob, and a "Burning" indicator in the target frame, with a clean reset when it expires.
- **Qi Elixir** consumable: restores 50 Qi (the first way to recover Qi beyond regen). Sold by Peddler Hao and craftable from wisp essence and bamboo fibre.
- **Cultivation realms**: Qi Condensation, Foundation Establishment, Core Formation, Nascent Soul and Spirit Severing at levels 1/5/10/15/20. Each breakthrough announces in chat and grants a permanent max-HP bonus (the realm name shows in the HUD).

**Enemies and bosses**
- **Ink Wisp** (passive spirit, lv 4-6) and **Thorn Sprite** (passive ranged line-spitter, lv 3-5) mob families, each with its own spawn group, loot and client model.
- **Mist Warden**, a second boss in the south-east hollow: faster telegraphs, lighter frame than the Stone Guardian.
- **Hollow Hierophant**, a third boss with a new **summon** mechanic: every 10 s it summons two Thorn Sprites beside itself (capped, corpse-pruned, cleaned up on death/leash/reset).
- **The Hollow Bride**, a fourth boss (lv 12, eastern bride-steps) with an **invulnerable/vulnerable rhythm**: 8 s VEILED (all damage refused, telegraphed kerchief lashes, she drifts and re-targets) alternating with 5 s REVEALED (full damage taken, melee x1.5). Both transitions are announced, the target frame and her model carry the state, and her immunity is re-derived server-side from sim time on every hit.
- **Mist Surge** world event: every 8 minutes, for 90 s, all mobs deal +20 % damage. The world announces the start and end, the state is sent over the wire (including to players logging in mid-surge), and the HUD shows a countdown banner.

**Social, travel and world**
- **Parties** (O): session-only groups of up to five with invites (60 s TTL), accept/decline/leave, leader migration, disconnect cleanup and a paper-card party panel; `/invite`, `/accept`, `/decline` and `/leave` also work as chat commands. Grouping pays: a kill also grants every living party member within 45 u **50 % of their own level-scaled kill XP** (loot, coin, jade and quest credit are never duplicated).
- **Player-to-player trading**: `/trade Name` opens a two-column window (items + coin, Ready per side) between players within 6 u. Offers are **references only** until both sides confirm; the swap re-validates from live bags and wallets, applies atomically with rollback, and cancelling / disconnecting / dying / walking apart moves nothing. Equipped items can never be traded, so no dupe or loss path exists.
- **Spirit-sword mount** (R): ride a procedural ink-wash jian at **1.6x travel speed**, server-authoritative (the anti-cheat ceiling rises only while mounted); casting or dying dismounts.
- **Spirit companion** (P): a cosmetic paper-lantern fox-wisp that glides after the local player with soft damping, persisted in `localStorage`, calmed by reduced-motion; costs about 4 draw calls.
- **Weather layer**: a deterministic weather cycle (mostly clear, occasional mist banks, sometimes soft ink-rain) with smooth crossfades, camera-following ink billboards and one wind-leaning streak system; `?weather=clear|mist|rain` forces a state for testing and reduced-motion quiets the motion.
- **Treasure caches**: six fixed caches around the valley; F within 3.5 u opens one for 15-30 coin, one or two material stacks and a 20 % chance of fine gear; it refills after 120 s.
- **Lantern Tide** (world event #2): every 10 minutes, for 2 minutes, kills pay **+50 % coin and +25 % XP** (gold HUD banner).
- **Market Day** (world event #3): every 15 minutes, for 3 minutes, Peddler Hao sells **25 % cheaper** and pays **50 % more** for goods sold to him (paper-red HUD banner); the shift is applied at the till on the listed prices, so the stall is never a coin printer.

**Content and progression**
- **Gear set bonuses**: five sets (Wanderer, Bamboo Weave, Jade, Houndfang, Thornweave) with 2-piece and 3-piece bonuses applied through the gear summary; the gear panel labels the active set.
- **Thornweave** set: hood (drop), robe (craft), boots (vendor) with 2pc/3pc bonuses, plus its recipe at Artisan Tao.
- **Four quest chains** beyond the main chain: "Wisps of the Hollow" (Peddler Hao), "Thorns of the Reed" (Lantern Keeper Mei, three linked steps), "The Mist Ward" (Gate Warden Wu, a post-finale Mist Warden hunt with the "Mistbreaker" title) and "Forge-Sworn" (Artisan Tao's three linked steps, ending in the Hound-Fang Charm and the "Forge-Sworn" title). 16 side quests in total.
- **Merit seals** expanded from 20 to **30** (415 points, 25 titles), adding bestiary completion, all three bosses, 150 kills, Lantern-Tide kills, master smithing, rare-in-four-slots, set completion and the level-15 realm; completion requirements are computed from the real data sizes so they cannot drift.
- **Bestiary / Codex**: persisted per-mob kill counts, sent to the client and browsable in a new panel (Shift+B) that shows discovered mobs and "???" for the never-slain.
- **Daily board** expanded from 6 to 11 tasks (Thorn Sprites, Ink Wisps, wisp essence, Mist Warden, Hollow Hierophant), with boss dailies paying a premium.

**UI / UX**
- **Combat log** (C): recent damage dealt/taken, crits and heals with colour cues.
- **Quest tracker**: a persistent HUD strip of active side quests and objectives, hidden when empty.
- **Session statistics** (V): mobs slain, damage dealt/taken, healing, XP and session time; resets on reconnect.
- **Combat feedback**: a red screen-edge flash when the local player takes damage, plus a slow low-HP pulse (respects reduced-motion and safe-flash settings).
- **Bag/gear UX**: a smart Sort button, per-slot "Equip Best" (only offered when the candidate beats what is worn), and a "vs equipped" stat-delta block in gear tooltips.

**Quality**
- Test suite made deterministic: the bot integration test no longer races login state, quest replies, interest-management snapshots, the boss turn-in or the daily-message count (also date-independent), and the economy suite passes regardless of which board the UTC date seeds.
- README, CHANGELOG and message-format docs brought in line with the build.

## 0.4.0 — Dodge, Qi and gear (2026-10-29)

- **Dodge roll (Space).** Universal, server-authoritative: a 6-unit dash over 0.25 s with 0.25 s of invulnerability, 1.5 s cooldown, 15 Qi. The server owns the movement (exempt from walking-speed accounting, clamped to the world) and `hurtPlayer` negates any hit that lands during the i-frames (slams, melee, poison) and tells the client, which shows "Dodged!". New `dodge` client message and `dodge` / `dodged` events (additive, protocol stays v3). Client: predicted roll, forward somersault of the avatar, ink-brush streak on the ground plus paper-white speed lines (`client/src/vfx/roll.ts`), whoosh and bell sounds, a Dodge slot on the hotbar with cooldown sweep.
- **Qi resource.** Every player has a 100-point jade Qi pool (`QI` in `server/src/data.ts`), regenerating 10/s after a 0.4 s pause; refilled on respawn, not persisted. Every skill now has a Qi cost (sword 3/12/25/15, talisman 5/20/15/15, physician 3/22/18/30); casting every skill the moment it is ready costs about 10-11 Qi/s, so the bare rotation is almost sustainable and every dodge or mashed cooldown comes out of the pool. A cast short on Qi is refused with "Not enough Qi for X (need N, have M)." (rate limited) before any cooldown is spent. Snapshots carry the player's own `qi`, `mqi` and `dcd` (dodge cooldown left); `SkillDef.qi` is the cost. The HUD Qi bar (jade, "Qi n / 100") replaces the old decorative one, hotbar slots show a jade cost badge and grey out when unaffordable, tooltips list the cost, and a refused cast flashes the bar.
- Tests: `server/scripts/dodge.ts` (`npm run test:dodge`, also part of `npm test`) covers Qi spend/refuse/regen, dodge distance, i-frames, cooldown, Qi cost, movement accounting, edge clamping, death/respawn and the wire fields. The test bots in `bots.ts` read their Qi and keep a reserve for Qi Guard / Wind Step / Spring Rain. TEST_MODE hook `/testqi N`. `ui-test.mjs` checks the Qi bar, slot costs, refusal, the roll and "Dodged!". `client/scripts/batch2-shots.mjs` captures `docs/shots/batch2_*.png`.

### 0.4.0 - Telegraphs and Guardian phase 3

- **Shaped telegraphs.** The `telegraph` event gains optional fields (additive, old clients keep drawing a circle of `radius`): `shape` (`circle` | `cone` | `line`), `dir`, `arc`, `len`, `width`, `sweep`, `lead`, `beam`. `shared/protocol.ts` also exports `telegraphContains()` so server damage and client "Dodged!" use the same hit test.
- **Regular mobs telegraph.** Fox Spirit: 0.4 s red ground cone (about 83 degrees, 3.5 reach) before its bite. Bamboo Spirit: 0.5 s red line strip (3.6 long, 1.9 wide) before its smash. The mob freezes while winding up, the shape is locked to where it was aimed, and everyone still inside when it lands is hit; stepping out avoids the damage. Data lives in `MobDef.swing` (`server/src/data.ts`), logic in `swingStep` (`server/src/game/mobs.ts`).
- **Stone Guardian phase 3 (below 25% HP).** It cracks open ("... cracks open - white-hot runes blaze along its body!"), glows white-hot with glowing fissures, and adds a rotating rune beam: a 28-unit line, 2.8 wide, shown for 0.9 s, then sweeping 90 degrees over 3 s while the Guardian stays rooted; damage ticks every 0.3 s to anyone on the line, so players run around it. A faint ghost line marks where the sweep ends. Banner: "Rune beam! Run around the sweeping beam". The boss bar shows a 25% marker and "Cracked open".
- **Client rendering.** `vfx.telegraphShape()` draws cones, lines and beams in the existing red ink style (terrain-conforming, brush edges, ink flood, hot core for a live beam); the minimap draws the same shapes. Mob swings stay quiet (no gong or shake); boss attacks keep the full effect.
- Tests: `server/scripts/telegraph.ts` (`npm run test:telegraph`, part of `npm test`): hit-test geometry, fox cone and bamboo line timing and dodge, beam shape, damage ticks, rooted boss, running around the beam. `bots.ts` dodge bots understand shapes and the rotating beam, and check the phase 3 message. TEST_MODE hook `/testbosshp F`. `ui-test.mjs` and `boss-test.mjs` cover shaped danger zones, the beam banner and the boss bar. Screenshots: `client/scripts/shots-batch2.mjs` -> `docs/shots/batch2_fox_cone.png`, `batch2_bamboo_line.png`, `batch2_boss_phase3_beam.png`.

### 0.4.0 - Audio and UI/UX (batch 3)

- **Settings window (F1 or ?).** The old help overlay is now a tabbed window: Controls (key list, including the new N for the map), Sound, Display and Access. Settings are one versioned object (`jz.settings.v1`) with export to / import from text, Reset all, and bad input rejected without changes (`client/src/ui/settings.ts`).
- **Mixer.** Audio now has dedicated buses (`music`, `amb`, `sfx`, `ui`) feeding the master chain; Sound tab sliders for master, music, ambience, effects and interface, plus mute, mute-when-in-background and a hover-tick toggle. Ambience (wind, water, bamboo, birds) and music (melody, flute, gong, combat) are now separate streams.
- **Sound design.** Four pitched click variants, a quiet hover tick (rate limited per element), paper-rustle open/close sounds, a tab sound, a musical error (muted knock plus a low dyad instead of a buzz), a soft cooldown-ready ping, rarity-tiered pickup sounds (common click, uncommon chime, rare guzheng arpeggio, epic gong and bell cascade), and pitch-laddered hit combos (consecutive hits within 1.5 s climb the pentatonic scale).
- **Boss music layer.** While the boss bar is up, war drums, a low drone and a pipa tremolo join the combat stem; it enters and leaves on a bar line and closes with a cymbal swell (`audio.setBoss`).
- **Accessibility.** Text size 100/125/150% for windows, tooltips and chat; chat size and opacity; colour assist for protanopia, deuteranopia and tritanopia (SVG colour-matrix filters on the world and HUD); pattern cues (hatched Qi bar, striped HP bar, minus sign on damage taken, plus sign on heals, warning mark on deadly nameplates); high contrast; reduce motion (defaults from the OS setting); photosensitivity-safe mode (no hit flash); plain heading font; camera shake slider (0 turns shake off, read by `FollowCamera.shake`); focus rings on every control; hotbar slots are keyboard-focusable buttons with labels; chat, loot and warning regions are ARIA live regions.
- **Floating numbers.** Separate toggles for damage dealt, damage taken, healing and status text (Dodged!, XP), a size slider, and a simple-crit option without the ink splash.
- **Chat.** All / Chat / System tabs with unread dots, optional timestamps, font size and background opacity.
- **Bag.** Search box, sort (recent, name, amount, rarity), type filter chips, rarity labels with diamond pips, and item tooltips (type, rarity, description, use) on hover or keyboard focus.
- **World map (N or click the minimap).** Full-screen ink-wash parchment map of Cloudmist Valley with fog of war that lifts as you explore (persisted per browser), landmark labels with hover notes, wheel zoom, drag to pan, a legend whose icons differ by shape, and your facing arrow.
- **Action bar polish.** Slots depress while their key or button is held, a gold ring pulses and a soft chime plays when a skill with a real cooldown comes back, tooltips show a live "Ready / N s left" line and a small glossary (Qi, Slow, Guard, Allies).
- **Motion.** Bag, settings and map windows open with a small damped-spring overshoot (off with Reduce motion).
- Tests: `audio-selftest.mjs` now renders every new sound (UI variants, loot tiers, combo hits, boss bed), flags sounds that are too loud, and checks the bus wiring (a muted ui, sfx or master bus must be silent; the music bus must carry the melody stem). `ui-test.mjs` section 4b covers the settings window, mixer persistence, export/import, colour assist, chat tabs, floating-number toggles, bag search/sort/filter/tooltips, the map, hotbar press feedback and ARIA. `client/scripts/batch3-shots.mjs` captures `docs/shots/batch3_ui_*.png`.
### 0.4.0 - Content: gear, side quests, crafting, mobs and places

- **Equipment.** Six slots (weapon, head, body, boots, charm, pendant), four rarities (common, fine, rare, epic) and 23 pieces with Attack, Health, Crit and Damage-taken bonuses (damage reduction is capped at 40 %). Class-locked weapons, level gates, and a Gear panel (key G) with a slot doll, summed bonuses, Equip / Remove and Use buttons. The server sums the bonuses and applies them in `combat.ts` (five one-line edits); swapping gear is validated server-side. Saves keep working: gear lives in its own tables.
- **Potions.** Healing Tonic (40 % HP) and Lotus Antidote (cures poison, 15 % HP) share a 15 s cooldown.
- **New NPCs.** Artisan Tao (crafting) and Peddler Hao (shop: buys materials, potions and spare gear, sells tonics and starter kit) in the plaza, with their own procedural models. Gate Warden Wu now gives the side-quest chain.
- **Side quests.** Eight tasks in a chain (Walk the Path, Tao's start, toads, masks, fangs, fox, seal, finale) on a 3-objective quest engine (kill, collect, talk, visit, craft), with Accept / Hand in, objective bars and rewards. Journal (key J) lists them.
- **Crafting and gathering.** Ten recipes turn mob drops (Bamboo Fiber, Fox Tail, Jade Scale, Toad Jelly, Hound Fang, Guardian Core) into potions and gear, including class-specific Houndfang weapons and Guardian's Heart.
- **New mobs.** Lotus Toad (passive pond-shore mob with a long tongue-line attack, drops Toad Jelly), Stone Hound (packs of three in the northern foothills; one calling for help pulls the pack, cone bite), and a rare roaming mini-boss, Old Whisker (grey Fox Spirit, 700 HP, long respawn, drops Silver Tail Cloak and a Hollow Seal Fragment). Fox Spirits can drop Fox-Fur Boots.
- **Merit seals and titles.** Twenty merit seals across five categories with points; some award a title that is shown under the player nameplate (`EntityState.ttl`). The Journal has Side Quests, Merit Seals, Titles and Atlas tabs.
- **Places of interest.** Six discoverable places (Hermit's Rest, Old Waystone, Serpent's Rest, Fox Fire Hollow, Hound Ridge Cairn, Cloudmist Overlook) with stone markers in the valley, a discovery toast, XP and an atlas of found places.
- **Protocol (additive).** Client: `equip`, `unequip`, `use`, `npc`, `craft`, `buy`, `sell`, `title`. Server: `items`, `gear`, `npcdlg`, `sq`, `prog`, `toast`. New file `server/src/contentdb.ts` (tables equipment, sidequests, counters, merits, places, titles, profile; `CREATE TABLE IF NOT EXISTS`, own connection like economy). Hook registry `contentHooks` in `economy.ts`. Level cap stays 20 (balance did not need more).
- Tests: `server/scripts/content.ts` (`npm run test:content`, part of `npm test`). Screenshots: `client/scripts/shots-content.mjs` writes `docs/shots/batch3_content_*.png`.

### 0.4.0 - Visual art and VFX pass (client only)

- **Day and night.** Day/night cycle in five ink-wash keyframes (dawn rose-gold, jade-grey day, vermilion dusk, indigo night; one 16 minute loop, `?tod=0..1` freezes it, `?todspeed=` sets cycles per minute) driving sky, mountains, fog, hemisphere/key light, lanterns and the post grade (`client/src/world/daynight.ts`); sky now has a seal-red sun disc with a wash ring, a paper moon and twinkling stars.
- **Night life.** Fireflies blink over the pond, grove and path at dusk/night, lantern halos and sparks swell at night, and every lantern pools warm light on the stone through an additive ground decal (one instanced draw call) with the three real point lights boosted after dark.
- **Wind field** (`client/src/world/wind.ts`): one shared gust wave that sweeps across the valley and bends grass tufts, bamboo, reeds, pines and blossom/ginkgo canopies together; cloud shadows drift across the terrain.
- **Pond.** Broken brush-line shore foam driven by a baked shore map, translucent shallows, sky/night tinted water, expanding ripple rings around a wading player, and a school of nine paper-cut koi that shy away from waders (`client/src/world/koi.ts`, one draw call). Hook: one additive line in `game.ts` calls `world.focus()`.
- **Post pass.** Exponential height fog rebuilt from the depth buffer fills low ground with valley mist, vermilion spot-colour grade, tea-stained ragged scroll edge instead of a plain vignette, time-of-day tint.
- **Skill VFX.** Ink-splat burst billboard on every hit (vermilion and larger on crits), gold bagua casting ring under every talisman cast, Sword Qi Wave leaves a dry-brush scorch stroke and fading afterimage crescents (`client/src/vfx/extras.ts`).

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
