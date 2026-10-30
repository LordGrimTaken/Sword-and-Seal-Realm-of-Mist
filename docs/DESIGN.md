# JIUZHOU — Design Bible (v0.5.0)

Desktop MMO RPG prototype. Xianxia / wuxia world of the Nine Provinces. **All player-facing text is English** (no
Chinese characters anywhere the player sees). The Chinese identity is carried by aesthetics only: ink-wash visuals,
vermilion seals, brush lettering, paper scrolls and pictograms. Server-authoritative; the client is replaceable.

Release **0.5.0**. This file is the design intent and rules; the player-facing feature list and controls live in
`../README.md`, the server internals in `../server/README.md`, the client internals in `../client/README.md`.

## Design pillars

1. **Telegraph-first combat.** Every heavy attack is drawn on the ground before it lands. Losing a fight should feel
   like a read you missed, not a number you lost to.
2. **A valley you share.** One persistent 200 x 200 zone where other players are always visible. Parties let players
   hunt together (up to five, session-only), and rare kills, boss phases, realm breakthroughs and world events are
   announced to everyone.
3. **Short-session progression.** Levels 1-20, five cultivation realms, quest chains, a daily board and gear/crafting
   give a first-session and a first-week goal without a subscription treadmill.
4. **Ink and vermilion.** Palette-locked ink-wash art, brush-script headings, paper-scroll UI, red seals; nothing neon
   and nothing generic-fantasy.
5. **Data over code.** Every tunable number (classes, mobs, bosses, loot, gear, recipes, quests, realms, event windows,
   XP curve) lives in `server/src/data.ts` or `shared/protocol.ts`; the client renders what the server tells it.
6. **English with a Chinese aesthetic (rule).** No hanzi in UI, world signage, VFX, server strings, docs or tests.
   `npm run check:english` (client) fails on any CJK character. The deprecated protocol `*Zh` fields are always sent
   empty and never rendered.

## Visual identity: "Ink and Vermilion"

Shuimo ink-wash landscape meets stylized 3D. Misty mountains, bamboo, pagodas, paper lanterns, seal stamps. Soft,
painterly, low-saturation world with sparing vermilion and gold accents.

### Palette (use these exact tokens)

| Token | Hex | Use |
|---|---|---|
| ink | #1a1a1f | text on paper, outlines, UI frames |
| ink-soft | #3a3a44 | secondary lines, shadows |
| paper | #f2ead8 | UI panels, parchment surfaces |
| paper-dark | #d9cdb0 | panel borders, inactive |
| vermilion | #c8372d | seals, HP, danger, key accents |
| jade | #4fa58b | Qi, nature, heal, friendly |
| gold | #c9a227 | rewards, level-ups, rare |
| mist | #8fa3ad | fog, distant mountains, sky |
| mist-light | #cfd9dc | horizon haze |

### World rendering rules

- Toon/cel shading with 2-3 tone bands, dark ink outline on characters and props.
- Heavy layered depth fog tinted mist/mist-light; distant mountain silhouettes in 3-4 receding grey-blue layers.
- Palette-locked materials; no pure white/black. Paper-grain feel in sky/UI.
- All models procedural (primitives, lathe, extrude) - no external art assets required.
- Ambient life: drifting mist, falling petals, lantern glow, pond ripples and koi, bamboo sway, birds, fireflies at
  night.
- A **16-minute day/night cycle** (dawn, day, dusk, night) drives sky, light and ambience; `?tod=0..1` freezes it and
  `?todspeed=` changes the speed for screenshots/tests.
- A **deterministic weather layer** on its own cycle: mostly clear, sometimes heavy drifting mist banks, occasionally
  soft ink-rain, crossfading over seconds and leaning with the shared wind. It is atmosphere only (no gameplay effect)
  and reads as part of the same ink-wash air; `?weather=clear|mist|rain` freezes it for screenshots/tests. Reduce motion
  damps its drift.
- The camera treats props as solid (baked collider grid), even though the server only enforces world bounds.

### UI rules

- Panels look like paper scrolls / lacquered wood with vermilion seal-stamp corners; windows open with a small
  damped-spring motion (disabled by Reduce motion).
- **Fonts:** display/headings/logo/banners = **Ma Shan Zheng** (Latin brush script, bundled subset); body/HUD/chat/
  tooltips = **Noto Serif** (Latin 400/600/700), bundled locally via @fontsource as `--font-display` / `--font-body`.
  No CDN fonts.
- **Icons:** hand-drawn vector brush pictograms (`client/src/ui/icons.ts` + `gearicons.ts`) on vermilion seal squares -
  skills, items, materials, NPC seals, currency, map legend. No letters in icons.
- HP vermilion on ink, Qi jade, XP gold; damage numbers in ink brush style, crits paper-white on a vermilion splash
  with a small CRIT label, heals in jade; level-up in gold brush lettering; quest completion stamps a COMPLETE seal.
- **Never colour alone:** pattern cues (hatched Qi bar, striped HP bar, signs on numbers, rarity diamond pips, map
  shapes), colour-assist modes, high contrast.
- Chat is a bottom-left scroll with All / Chat / System tabs; minimap is a round ink-wash disc top-right; bosses use a
  top-centre bar and a big warning banner for the next telegraphed pattern.
- **Client-only chrome vs server truth:** the server owns all game state (inventory, quests, daily board, bestiary,
  wallet, event state, party membership, mount flag, cache readiness). Client-only panels - Combat Log (C), Session
  Statistics (V), Quest Tracker, Bestiary display (Shift+B, fed by the persisted server counters), Party panel (O,
  rendering the server's session-only party state), Combat Feedback overlay and the cosmetic companion/mount/weather
  visuals - are display-only and reset per connection.

## The world: Cloudmist Valley

One zone, 200 x 200 units, spawn near (0, -80). The plaza is the social hub: paifang gate, pagoda, lanterns, and six
NPCs - **Elder Lin** (main quest chain), **Lantern Keeper Mei** (errand + Thorns of the Reed chain), **Gate Warden Wu**
(the side-quest gate), **Notice Board Keeper Fen** (daily board), **Artisan Tao** (crafting), **Peddler Hao** (trade).
Around it: a lotus pond with an arched stone bridge and koi (Jade Serpents, Lotus Toad Wardens, Thorn Sprites on the
north bank); a bamboo grove to the west (Bamboo Spirits); fox hills to the east (Fox Spirits and the named rare Old
Whisker); a misty hollow to the south-west (Ink Wisps, and the drowned shrine of the Hollow Hierophant); the south-east
hollow of the Mist Warden; and the ruined northern shrine of the **Stone Guardian**. Six discoverable **places of
interest** (Hermit's Rest, Old Waystone, Serpent's Rest, Fox Fire Hollow, Hound Ridge Cairn, Cloudmist Overlook) feed
the Journal's Atlas with XP and lore. No mob spawn lies within 35 units of the spawn plaza.

## Characters and classes

Four classes, four skills each, all sharing one rule set (100 Qi, 0.3 s GCD, dodge roll). Roles are soft - there is no
holy trinity requirement - but each class has a clear feel:

- **Sword Cultivator** - melee bruiser: fast slash, sword-qi bolt, heavy strike, damage-reduction/self-heal guard.
- **Talisman Master** - ranged caster: burning fire bolt, point AoE thunder, slowing frost seal, defensive wind step.
- **Physician** - support: cheap needle, party heal aura, AoE light, big self-heal.
- **Blade Dancer** - crit skirmisher: very fast slash, whirlwind bolt, blade storm AoE, heal + damage reduction.

Design intent: every class can solo the open world; classes differ in rhythm (melee risk, ranged kiting, support
sustain, crit mobility), not in required group slots. Numbers live in `data.ts` and are tuned against bots.

## Combat design

- **Qi economy.** Skills cost Qi (3-30) and regenerate 10/s after a 0.4 s pause. Casting everything on cooldown costs
  ~10.5-11 Qi/s, so the bare rotation is almost sustainable; dodges (15 Qi) and mashed cooldowns are what drain the pool.
  Tension comes from dodging.
- **Dodge roll (Space).** Server-authoritative 6-unit dash over 0.25 s with 0.25 s of invulnerability, 1.5 s cooldown,
  15 Qi. A hit that lands during i-frames is negated and reported as "Dodged!".
- **Telegraph vocabulary.** Ground shapes: circle (boss slam/stomp, scatter), cone (fox bite, hound bite), line (bamboo
  smash, toad/thorn spit, boss beam) and a sweeping phase-3 beam (static warning, then a 90-degree sweep with damage
  ticks). Mobs freeze while winding up and the shape locks where it was aimed; damage lands only on players still
  inside. Regular-mob swings are visually quieter than boss attacks so the fight reads at a glance.
- **Status effects.** Burn (Fire Talisman, 3 ticks, visible flame cue), poison (Jade Serpent bite, 4 s of damage
  ticks), slow (Frost Seal, on mobs) and guard buffs (damage-taken multipliers). Potions share a 15 s cooldown.
- **Mob design.** Each family teaches one idea: passive-until-hit spitters (toad, thorn sprite) teach spacing;
  pack hounds teach pulls; the serpent teaches side-stepping a lunge; the rare teaches a group fight.
- **Boss design.** Three bosses share the slam/stomp/scatter/beam vocabulary at different speeds and add one signature
  each: the Guardian's phase-3 rotating rune beam, the Mist Warden's faster telegraphs, the Hollow Hierophant's wave
  summons of Thorn Sprites (capped, cleared on death/leash so adds can never pile up forever). Signature attacks are
  dodgeable; enrage timers stop endless kiting; the touch-range melee punishes standing inside the boss.
- **Death costs 5 seconds**, not gear or XP; the valley is meant to be retried immediately.
- **World events: Mist Surge, Lantern Tide and Market Day.** Three repeating, clock-driven windows give the valley a
  shared rhythm: every 8 minutes the mist surges for 90 s and all mobs deal +20% damage (risk), every 10 minutes the
  lantern tide rises for 2 minutes so kills pay +50% coin and +25% XP (reward), and every 15 minutes Peddler Hao's market
  opens for 3 minutes with 25% cheaper buys and 50% better sells (economy). Each is announced in chat and on a HUD banner
  with a countdown, and each is a bounded multiplier/price shift on existing systems, never a new reward source. The
  first window of each opens one full interval after a server starts, so a fresh world begins calm.

## Ambient and social systems (0.5.0)

- **Parties (O).** Session-only groups of up to five: invite by name, accept/decline, leave, with leader migration and
  disconnect cleanup. The party panel shows members, class, level and live HP, plus the pending-invite prompt. Parties
  are not persisted and are not a guild: the design goal is "hunt together for a session", not a social structure.
- **Shared kill XP.** Living party members within 45 units of a kill get 50% of their own level-scaled kill XP for it;
  loot, coin, jade and quest credit still go only to the credited killers. The benefit is a quiet shared-hunt line, so
  grouping rewards proximity without duplicating loot or letting alt/bot parties farm.
- **Spirit companion (P).** A purely cosmetic lantern-fox wisp that drifts after the player. The on/off choice is
  remembered per browser and reduced motion freezes its bob/orbit. It carries the ink-wash palette and adds life to
  travel without touching gameplay - the mount is for speed, the companion is for company.
- **Spirit-sword mount (R).** A server-authoritative travel toggle: a flying jian lifts the rider and raises movement
  speed to 1.6x, with the anti-cheat ceilings scaled so the speed is legal. Casting or dying dismounts; it never adds
  combat power. Other players see the jian in snapshots. It is deliberately the only speed buff in the build.
- **Weather layer.** Deterministic clear/mist/rain moods crossfade on a slow cycle, purely atmospheric and palette-locked;
  the mist thickens the ambient ground haze and the rain reads as soft ink strokes. `?weather=` freezes it for
  screenshots and accessibility review; Reduce motion damps the drift.
- **Treasure caches.** Six fixed caches (one per landmark) give an exploration micro-loop: press F within 3.5 units for
  15-30 coin, a material roll and a 20% fine-gear chance; the cache refills after 120 s. State is global and
  session-only, so the feature adds a reason to walk the whole valley without touching the economy's tested bounds.

## Progression

- **Levels 1-20** on a curve of `round(30 * lv^1.6)` (26,063 XP total; target pace: level 8 in 12-15 minutes, cap in
  ~1.5 h of normal play including quests). Kill XP scales with the level difference (+50% for higher mobs, down to 10%
  for grey ones).
- **Five cultivation realms** as named milestones: Qi Condensation (lv1) -> Foundation Establishment (lv5, +20 max HP)
  -> Core Formation (lv10, +40) -> Nascent Soul (lv15, +60) -> Spirit Severing (lv20, +80). Crossing a boundary is a
  **breakthrough**: a personal bonus line, a zone announcement, permanent max HP, and the realm shown next to the
  level/XP bar. The realm table lives in `shared/protocol.ts` so server HP math and client display cannot disagree.
- **Equipment** is the main power curve beyond levels: six slots, four rarities (common/fine/rare/epic), class-locked
  weapons, level gates, five named sets with 2/3/4-piece bonuses, and a 40% cap on total damage reduction. Drops,
  recipes and the peddler are the three acquisition paths, so the same gear set can be earned or bought.
- **Crafting and trade** turn mob drops (7 materials) into potions and gear (13 recipes); the peddler buys surplus
  materials and stocks the starter kit and one end-game set piece. Market Day windows make the stall a timed economy
  beat (25% cheaper buys, 50% better sells) without changing the listed base prices.
- **Questing:** Elder Lin's 4-quest main chain (the finale hands out the rare Cloudmist Pendant), **16 side quests**
  across four NPCs in short chains gated by level and prerequisites, and the 3-of-11 daily board on a fixed UTC-day
  schedule (deterministic for everyone, rewards claimed exactly once).
- **Collection:** **30 merit seals** with points and some titles, 6 places of interest in the Atlas, and the **Bestiary /
  Codex** - a persisted kill count for all 11 mob types, where undiscovered entries read "???" until the player slays
  one. Titles can be worn and appear under the nameplate. A few seals use derived counters (bestiary coverage, all three
  bosses, complete gear sets) instead of a single counter, so collection goals can span systems.
- **Two currencies:** coin (mob drops, quests, dailies) and jade (bosses, chain completion, dailies); jade gates the
  epic end-game recipe.
- **Pacing targets** (tuned against bots, not human sessions): gear around levels 5-8, first boss at level 8, daily
  board as the repeatable loop, level cap as the long-term goal.

## Multiplayer, server and persistence

- Authoritative single-process server: 20 Hz simulation, 10 Hz full-state JSON snapshots of entities within 60 units,
  client prediction with reconciliation and 100 ms interpolation. Up to 100 players in the one zone.
- **Accounts at v3:** name + password (salted scrypt, never logged), plus a one-use 5-minute launcher token. Failed
  logins are rate limited. Server-side validation for movement, casts, loot, trade, quests and claims; movement is
  replayed against a speed budget.
- **Persistent characters**: level/XP/position, inventory, Elder Lin progress, gear, side quests, merit seals, titles,
  discovered places, bestiary counters, coin/jade, daily progress and the bestiary - all in SQLite, autosaved and written
  through on change. Old saves are migrated in place. Party membership, mount state and treasure caches are deliberately
  **session-only** (nothing to persist, nothing to desync).
- Social design: shared zone chat, system announcements for rare kills, boss phases, breakthroughs and world events,
  nameplates with titles and level-difference colouring, and session-only parties with shared kill XP. Guilds, PvP,
  mail and player trading are not in this slice.

## Accessibility and comfort

Settings live in one versioned object (exportable/importable) and cover the sound mixer (master + music/ambience/
effects/interface), text/chat sizing, floating-number categories, colour-assist modes, pattern cues, high contrast,
reduce motion (OS default), photosensitivity-safe mode, plain heading font and camera-shake intensity. Controls are
keyboard reachable with focus rings; chat, loot and warnings are ARIA live regions. No feature is conveyed by colour
alone.

## The slice we are building (MVP loop)

Login (name + password or launcher) -> choose one of four classes -> spawn in the plaza -> meet Elder Lin and the
plaza NPCs -> hunt spirits and serpents (solo or in a session party) -> side quests, gear and crafting -> ride the
spirit-sword mount between landmarks and open the treasure caches -> break through realms -> chase the Lantern Tide
while dodging the Mist Surge -> take on the three telegraphed bosses with other players -> daily board, bestiary,
atlas and titles as the long tail. The public feature list, controls and run instructions are in `../README.md`.

## Out of scope for this slice

Guilds, housing, player-to-player trading, PvP, multiple zones/instances, mail, auction house, dungeons/raids, a
localisation system, password recovery and payments. Accounts, persistence, session-only parties, the daily board, the
launcher handoff, the mount and the accessibility suite are in scope (parties deliberately stop at "hunt together for a
session" - there is no guild layer).
