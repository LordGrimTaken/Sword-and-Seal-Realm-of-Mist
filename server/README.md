# JIUZHOU server

Authoritative Node + TypeScript game server for the Cloudmist Valley vertical slice. Implements
`../shared/protocol.ts` **protocol v3** exactly (release **0.5.0**; the server package is versioned independently at
0.2.0). Single process, single zone, 20 Hz simulation, JSON over WebSocket.

## Run

```
npm install
npm run dev        # tsx watch src/server.ts
npm run start      # tsx src/server.ts (one process)
npm run typecheck  # tsc --noEmit
```

- Port **8787** (`PORT`); characters + accounts + content saves in one SQLite file (`DB_PATH`, default
  `server/data/jiuzhou.db`, created on first run, gitignored). `GET /health` returns JSON
  (`ok, players, version, uptime, tick, mobs, entities, droppedSnaps, rss`).
- Requires **Node >= 22.5** for `node:sqlite` (prints an ExperimentalWarning; harmless).
- `VERSION` (repo root) is the release version reported by `/health`. `server/package.json` is versioned separately.
- Env: `PORT`, `DB_PATH`, `TEST_MODE=1` (test-only admin chat commands, see below), `TOKEN_SECRET`,
  `CORS_ORIGINS`, `ALLOW_NULL_ORIGIN=1`, `TRUST_FLY_CLIENT_IP=1`.

## Protocol (v3, with additive 0.4.0 / 0.5.0 messages)

`PROTOCOL_VERSION = 3`. Constants: `TICK_RATE` 20, `SNAPSHOT_RATE` 10, `WORLD_SIZE` 200, `PLAYER_SPEED` 6,
`INTEREST_RADIUS` 60. Transport is JSON text frames over `ws`; per-message payload cap is 2 KB and the server
validates every field (`isNum`, type checks, ranges) before it reaches the simulation.

**Client -> server** (`ClientMsg`)

| Message | Fields | Notes |
|---|---|---|
| `login` | `name, cls, v, pw?, tok?` | v must be 3; new name + password registers, known name needs its password or a launcher token |
| `input` | `seq, dx, dz` | held direction, normalized to <=1; stale/out-of-order seq ignored; expires after 0.5 s of silence |
| `cast` | `skill, target?, tx?, tz?` | skill 1-4; validated for cooldown, GCD (0.3 s), range (+1.5 u slack), Qi cost and target |
| `dodge` | `dx?, dz?` | dodge roll (direction defaults to facing) |
| `chat` | `text` | 120 code points, control chars stripped; `/talk`, `/quest`, `/daily` are commands |
| `claim` | `id` | claim one of today's completed daily tasks |
| `ping` | `c` | answered with `pong` |
| `equip` / `unequip` / `use` | `item` / `slot` / `item` | 0.4.0 content; validated (ownership, level, class, slot, potion cooldown) |
| `npc` | `npc, a, q?` | 0.4.0 side quests and dialog for `wu` / `tao` / `hao` / `mei` (`talk\|accept\|turnin`) |
| `craft` / `buy` / `sell` | `id` / `item, qty?` / `item, qty?` | Artisan Tao's recipes and Peddler Hao's shop |
| `title` | `id` | wear or clear an owned title |
| `mount` | — | 0.5.0 spirit-sword mount toggle; the server validates the rider is alive, flips `Player.mounted`, applies the 1.6x speed to authoritative movement and echoes it in snapshots |
| `party` | `a: invite\|accept\|decline\|leave, name?` | 0.5.0 session-only party actions (also reachable as chat commands `/invite Name`, `/accept`, `/decline`, `/leave`, `/party`) |
| `openchest` | `id` | 0.5.0 open one treasure cache; range/readiness validated server-side, answered with a fresh `chests` state plus the normal loot/coin path |

**Server -> client** (`ServerMsg`)

| Message | Contents |
|---|---|
| `welcome` | `id, zone, skills, tickRate` (first message) |
| `snap` | `tick, ack, ents, gone` + per-recipient `qi, mqi, dcd` (dodge cooldown) |
| `ev` | one `GameEvent`: `damage, heal, death, cast, chat, xp, levelup, loot, dodge, dodged, telegraph` |
| `pong` | ping reply |
| `inv` | full inventory (`InvItem[]`) after login and on every change |
| `wallet` | `coin, jade` after login and on change |
| `daily` | `tasks, resetIn` after login and on progress/claim/rollover |
| `error` | refusal text |
| `items` | item catalogue once after login (`ItemInfo[]`: gear stats, set, consumables, materials, quest items) |
| `gear` | equipped slots + summed bonuses |
| `npcdlg` | NPC dialog (name, role, greeting lines, quests; optional craft / buy / sell tabs) |
| `sq` | the player's accepted/finished side quests + objectives |
| `prog` | 30 merit seals, points, worn title, owned titles, 6 places of interest |
| `toast` | `kind` `poi\|ach\|title\|item\|quest` toast |
| `best` | 0.5.0 bestiary: persisted `kills` for every mob type, in data order (0 = never slain) |
| `surge` | 0.5.0 Mist Surge state: `active, endsIn` (sent on transition and once after login) |
| `tide` | 0.5.0 Lantern Tide state: `active, endsIn` (same semantics as `surge`, sent on transition and once after login) |
| `market` | 0.5.0 Market Day state: `active, endsIn` (third event, same semantics; drives Peddler Hao's live buy/sell prices while open) |
| `party` | 0.5.0 session-only party state: `members` (`PartyMemberView[]` or `null` = solo), `leader`, and `inviteFrom` while a pending invitation exists; sent to every member on any change and once after login |
| `chests` | 0.5.0 treasure caches: `chests: ChestStateView[]` — the 6 fixed caches with `id, x, z, ready`; sent after login and whenever one opens or refills |

Login order: `welcome`, `xp` event, `inv`, `wallet`, `daily`, `items`, `gear`, `sq`, `prog`, `best`, then the welcome
chat lines; the first snapshot also carries the player's `qi/mqi/dcd` and, once per connection, the current `surge`,
`tide`, `market`, `party` (usually solo `members: null`) and `chests` pushes.

The exact user-facing **system chat lines** (quest progress, daily board, coin/jade, side-quest text) are catalogued in
`../docs/MESSAGE_FORMATS.md`. 0.5.0 additions to that catalogue:

```
Breakthrough! You have entered the <Realm> realm. (+<n> max HP)        (to the player)
<name> has broken through to <Realm>!                                 (zone-wide)
The mist surges! Mobs deal +<n>% damage for <s> s.                    (Mist Surge start)
The mist recedes. Mobs deal normal damage again.                      (Mist Surge end)
The lantern tide rises! Slain mobs give +<n>% coin and +<n>% XP for <s> s.   (Lantern Tide start)
The lantern tide ebbs. Kill rewards return to normal.                 (Lantern Tide end)
The market day opens! Peddler Hao pays +<n>% for goods and sells at -<n>% for <s> s.   (Market Day start)
The market day closes. Peddler Hao's prices return to normal.         (Market Day end)
<Boss> summons <n> <Mob>s!                                            (Hollow Hierophant waves)
<Boss>'s runes blaze crimson! / <Boss> cracks open - white-hot runes blaze along its body! / <Boss> is enraged!
You step onto your spirit jian and rise. (R to dismount) / You step down from your spirit jian.   (mount toggle)
You invite <name> to your party. / <name> invites you to a party. Type /accept or /decline.
You join <name>'s party. / <name> joins the party. / <name> has left the party. / Your party has disbanded.
<leader> is now the party leader. / Your invitation to <name> expired. / Shared hunt: +<n> XP.   (party / shared XP)
You open the <name> cache. / You found <n> coin. / Rare find: <item>! / That cache is already empty. /
The cache is too far away. / A <name> is ready again nearby.          (treasure caches)
```

## Architecture (`src/`)

1. `server.ts` — HTTP + `ws` server: sessions, JSON validation, per-session token-bucket rate limit (100 burst,
   60/s), login (name + password or launcher token), 20 Hz drift-corrected loop, 30 s autosave, heartbeat, graceful
   shutdown (SIGINT/SIGTERM, final save), `/health` and the launcher auth API.
2. `game/world.ts` — the simulation: players, NPCs, mobs, grid, movement (server-side speed accounting), snapshots,
   interest management, event fan-out, chat commands, death/respawn, the mount toggle and all three world-event
   windows; it wires the party + chest managers into dispatch, login and the 0.5 s upkeep tick.
3. `game/combat.ts` — cast validation, damage/heal/crit, burn + poison ticks, dodge i-frames, kill credit, shared
   party kill XP, XP and levels, realm breakthroughs, loot, mob attack and the Mist Surge damage multiplier.
4. `game/mobs.ts` — mob AI (idle wander, aggro, chase, telegraphed swing, serpent lunge, boss patterns, summon adds,
   leash/return+heal, respawn) and spawn generation (fixed seed).
5. `game/quests.ts` — Elder Lin's chat-driven chain and Lantern Keeper Mei's errand; `/talk`, `/quest`, `/daily`
   command handling.
6. `game/content.ts` — 0.4.0/0.5.0 content systems: equipment, consumables, NPC side quests, crafting, trade
   (including Market Day's live `shopBuyPrice` / `shopSellPrice`), merit seals, titles, places of interest, bestiary
   counters, the derived `bestTypes`/`bosses`/`set:<id>`/`setsDone` merit counters and the persisted `tideKills`
   counter.
7. `game/party.ts` — 0.5.0 session-only parties: invite/accept/decline/leave, invite expiry (60 s), leader migration,
   disconnect cleanup, login/periodic sync, and the shared kill-XP helper (`KILL_XP_SHARE` 0.5 within
   `KILL_XP_SHARE_RANGE` 45).
8. `game/trade.ts` — 0.5.0 session-only player-to-player trading: request/accept (60 s expiry), reference-only
   offers (nothing leaves a bag until the swap), per-side ready flags, an atomic re-validated swap of items + coin
   with full rollback on any shortfall, and cancel/decline/disconnect/death/out-of-range teardown that loses nothing.
9. `game/chests.ts` — 0.5.0 treasure caches: the 6 fixed spots, range/readiness validation, coin/material/fine-gear
   grants through the normal loot path, the 120 s refill and the `chests` state push.
10. `game/gear.ts`, `game/inventory.ts` — gear stat summing (plus set bonuses); the capped item stack model.
11. `game/dodge.ts` — Qi regeneration/spending and the server-authoritative dodge roll.
12. `game/grid.ts` — spatial hash (30 u cells, rebuilt each tick) for aggro and per-client interest.
13. `game/types.ts`, `game/util.ts` — entity/state types, distance, RNG, clamping, token bucket.
14. `economy.ts` — coin/jade wallets and the 3-of-11 daily board (own tables in the same SQLite file); the Lantern
    Tide coin multiplier is applied on the existing kill-coin path.
15. `contentdb.ts` — content saves: equipment, side quests, counters, merits, places, titles, active-title profile.
16. `db.ts` — characters, Elder Lin quest row, inventory and accounts (`scrypt` hashes); startup migrations keep old saves.
17. `auth.ts` — password hashing/verification, failed-login limiter, launcher session tokens.
17. `data.ts` — **every tunable number**: zone, tuning, Qi, Mist Surge, Lantern Tide, Market Day, levels/XP, economy,
    dailies, classes/skills, mobs/spawns/bosses, NPCs, quests, gear/sets/consumables/materials/recipes, shop, places,
    merits; the realm table lives in `../shared/protocol.ts` so the client can render it.
18. `game/testmode.ts` — the `TEST_MODE=1` admin chat hooks.

Simulation loop (`World.step`, 20 Hz): advance the clock and publish Mist Surge, Lantern Tide **and** Market Day
transitions; update players (poison, Qi, dodge dash, movement with the mount speed multiplier, regen, movement
validation, pose); every 10th tick run quest proximity + content ticks, party upkeep and treasure-cache refills; update
mobs and bosses; rebuild the spatial grid; every 2nd tick send snapshots (`SNAPSHOT_RATE` 10 Hz).

Snapshots are **full state** of everything inside `INTEREST_RADIUS` (60 u) plus `gone` ids since the last snapshot; the
client interpolates 100 ms behind and predicts its own movement. Snapshots are skipped for a socket with more than
256 KB queued; only above 16 MB is the connection terminated (see Reliability).

Persistence (all in `DB_PATH`, created with `IF NOT EXISTS`, additive migrations only): `characters`, `quests`
(Elder Lin + Mei errand columns), `items`, `accounts`, `wallet`, `daily`, `equipment`, `sidequests`, `counters`
(includes `best:<mobType>` bestiary counters), `merits`, `places`, `titles`, `profile` (worn title). Every change is
written through on the game thread; no separate save flushes are required beyond the 30 s autosave for characters.

## Simulation rules

### Classes and skills

All 4 classes have 4 skills on keys 1-4, a 100-point Qi pool (regenerates 10/s after a 0.4 s pause), a shared 0.3 s
GCD and a 15-Qi dodge roll. Skill numbers (`data.ts` `CLASSES`):

| Class | HP (+/lv) | Atk (+/lv) | crit | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|---|
| Sword Cultivator | 120 (+25) | 9 (+3) | 12% | Flowing Slash melee x1.0, 1 s, 3.5 u, 3 Qi | Sword Qi Wave bolt x1.3, 3 s, 14 u, 12 Qi | Heaven-Splitting Strike melee x3.2, 8 s, 4 u, 25 Qi | Qi Guard heal 10% + 50% damage taken for 5 s, 15 s, 15 Qi |
| Talisman Master | 90 (+18) | 8 (+3) | 15% | Fire Talisman bolt x1.1, 1.2 s, 20 u, 5 Qi, burn 3 ticks | Thunder Talisman point AoE x1.6 r6, 6 s, 24 u, 20 Qi | Frost Seal bolt x0.8 + 60% slow 4 s, 8 s, 18 u, 15 Qi | Wind Step 40% damage taken for 4 s, 12 s, 15 Qi |
| Physician | 105 (+22) | 6 (+2.5) | 10% | Jade Needle bolt x1.0, 1 s, 16 u, 3 Qi | Spring Rain heal 3.0x atk + 15% max HP to self + allies r12, 7 s, 22 Qi | Purifying Light point AoE x2.2 r5, 6 s, 14 u, 18 Qi | Meridian Surge heal 40% max HP, 20 s, 30 Qi |
| Blade Dancer | 100 (+20) | 8 (+2.8) | 20% | Gale Slash melee x0.85, 0.8 s, 3.5 u, 3 Qi | Whirlwind Arc bolt x1.4, 3 s, 14 u, 12 Qi | Storm of Blades point AoE x1.8 r5, 8 s, 20 Qi | Dancer's Grace heal 8% + 45% damage taken for 5 s, 12 s, 15 Qi |

Mechanics: `guard` buffs are damage-taken multipliers; Frost Seal slows the target mob (server-side speed); Fire
Talisman applies a 3-tick burn (damage events attributed to the caster, visible as `EntityState.burning`); Jade Serpent
bites poison for 4 s; potions share a 15 s cooldown (`POTION_CD`): Healing Tonic (40% HP), Lotus Antidote (cure + 15%
HP), Qi Elixir (50 Qi). Range checks allow +1.5 u of latency slack; a cast without enough Qi is refused before the
cooldown/Qi is spent.

### Levels and cultivation realms

`MAX_LEVEL` 20; `xpToNext(lv) = round(30 * lv^1.6)` (lv1 30, lv5 394, lv8 836, lv19 3335; 26,063 XP to the cap).
Kill XP = `xpPerLv * mobLv * xpLevelMult(d)` with `d = mobLv - playerLv`: +10% per level above up to +50%, full within
2 below, then 0.8/0.6/0.4/0.2/0.1 (never below 1). Stored characters are clamped by `normalizeProgress` at login.

`REALMS` (shared with the client): Qi Condensation lv1 (+0 HP), Foundation Establishment lv5 (+20), Core Formation
lv10 (+40), Nascent Soul lv15 (+60), Spirit Severing lv20 (+80). `realmForLevel(lv)` returns the current realm and
`maxHpFor()` adds its flat bonus to class HP. A level-up that crosses a boundary sends the personal breakthrough line
(and a zone-wide announcement) and keeps the extra HP permanently; the client shows the realm next to the level/XP bar.

### Mobs (11 types) and spawns

87 spawn points across 17 spawn groups. `MOB_SPAWNS` places the earlier groups by seeded scatter (jade serpents and
every 0.4.0+ group at fixed `points`); higher-level Bamboo Spirit / Fox Spirit bands (5-8, 7-11, 12-15, 13-17, 17-20)
exist so the 1-20 curve has something to level on.

| Mob | Levels | Behaviour / loot |
|---|---|---|
| Bamboo Spirit | 1-3, 5-8, 12-15, 17-20 | melee; 0.5 s line smash; Bamboo Fiber (70%) |
| Fox Spirit | 3-4, 7-11, 13-17, 18-20 | fast; 0.4 s cone bite; Fox Tail (60%), Fox-Fur Boots (3%) |
| Jade Serpent | 2-4 | 0.55 s coil then lunge; bite poisons 4 s; Jade Scale (70%), Serpent Gall (8%) |
| Lotus Toad Warden | 3-5 | passive until hit (aggro 0.01); 0.9 s line spit at 9 u; Toad Jelly (70%) |
| Stone Hound | 5-7 | pack mob (`pack` 16): pulling one pulls the pack; cone bite; Hound Fang (60%), Stone Hound Greaves (3%) |
| Thorn Sprite | 3-5 | passive until hit; 0.8 s thorn line at 7 u; Bamboo Fiber (70%), Thornweave Hood (5%) |
| Ink Wisp | 4-6 | fast, weak; 0.5 s line ink lash; Wisp Essence (75%), Serpent Gall (4%) |
| Old Whisker, the Grey Fox | 5 | named rare (announced when killed), ~5x fox HP, wide cone, 20 min respawn; Silver Tail Cloak (35%), Hollow Seal Fragment (100%), Fox Tail |
| Stone Guardian | 8 | boss, northern shrine |
| Mist Warden | 8 | boss, south-east hollow |
| Hollow Hierophant | 9 | boss, south-west drowned shrine |

Common AI: idle wander, aggro radius, leash to spawn, return+regen, respawn timer, per-mob threat map, telegraphed
swings (`MobDef.swing`: line/cone with wind-up, the mob freezes while winding up, everyone still inside is hit).
Regular mobs are ordinary `swing`/`lunge` users — no bespoke AI per mob type.

### Bosses (3)

All bosses share the `BossDef` vocabulary: telegraphed `slam` (circle on a player), `stomp` (circle around itself),
`scatter` (3 circles, phase 2+), a phase-3 rotating `beam` (line, static warning then sweep, damage every tick),
`enrageAfter`/`enrageMult` (faster telegraphs + more damage), `creditRange` 70 and `targetRange` 40. While engaged they
also emit phase/enrage system lines (`<Boss>'s runes blaze crimson!`, `<Boss> cracks open - ...`,
`<Boss> is enraged!`).

| Boss | Level | HP | Phases | Notes |
|---|---|---|---|---|
| Stone Guardian | 8 | 2000 | slam/stomp -> scatter -> beam at 25% | 150 s enrage x1.5, drops Guardian Core |
| Mist Warden | 8 | 1480 | faster telegraphs, beam at 30% | 120 s enrage x1.4; Wisp Essence, Serpent Gall |
| Hollow Hierophant | 9 | 2005 | beam at 28% | **summons 2 Thorn Sprites every 10 s** while engaged (hard cap 6 living adds; adds are temporary, despawn on boss death/leash and their corpses prune after 3 s), 140 s enrage x1.45; Wisp Essence, Serpent Gall, Thornweave Robe (20%) |
| The Hollow Bride | 12 | 4520 | **VEILED 8 s (immune) / REVEALED 5 s** | phase derived from sim time; while veiled every damage source is refused (threat only) and she only lashes (line swing, 0.9 s windup) and drifts; while revealed she takes full damage and melee hits 1.5x. 200 s enrage x1.45, 180 s respawn; drops boss loot, added to the boss counter and a premium daily |

Boss patterns are ground-telegraphed and can be walked out of or dodge-rolled through; the server resolves the hit
with the shared `telegraphContains()` geometry. Bosses also melee anyone standing inside their touch range between
patterns (a reason not to hug them).

### World events (0.5.0): Mist Surge, Lantern Tide and Market Day

All three events share one design and one deterministic clock: config in `data.ts`, window derived from `world.time`
with no per-player state, the first window opens one full interval after a world starts (a fresh world begins calm), and
`publish*` sends the structured message plus a system chat line only on transitions. A player who logs in mid-event gets
the state with their first snapshot plus a personal line with the remaining seconds.

- **Mist Surge** (`MIST_SURGE = { intervalSec: 480, durationSec: 90, mobDamageMult: 1.2 }`): every 8 minutes all mobs
  deal +20% damage for 90 s. `mistSurgeAt(time)` returns `{ active, endsIn }`; `mistSurgeMult(time)` is applied centrally
  in `hurtPlayer()`, so melee, swings, lunges, poison and boss patterns all surge together.
- **Lantern Tide** (`LANTERN_TIDE = { intervalSec: 600, durationSec: 120, coinMult: 1.5, xpMult: 1.25 }`): every
  10 minutes kill rewards rise for 2 minutes — kill coin x1.5 and kill XP x1.25, applied on the existing kill-reward
  path (`economy.lanternTideCoinMult`, `combat.lanternTideXpMult`), never a new reward source and never quest/daily
  rewards. `lanternTideAt(time)` mirrors `mistSurgeAt`; the `tide` message and the two chat lines are the mirror of the
  surge ones.
- **Market Day** (`MARKET_DAY = { intervalSec: 900, durationSec: 180, buyMult: 0.75, sellMult: 1.5 }`): every 15 minutes
  Peddler Hao's stall opens for 3 minutes — buying costs 25% less and selling pays 50% more. The multipliers are applied
  **only at the transaction** (`content.shopBuyPrice` / `shopSellPrice`, rounded to whole coin with a floor of 1), and the
  `npcdlg` buy/sell quotes use the same functions, so the displayed price is what is charged. `SHOP` itself is never
  modified and the economy tests still read their listed prices unchanged; `marketDayAt(time)` powers the `market`
  message and the two announcement lines.

### Parties (session-only) and shared kill XP

`game/party.ts` implements the up-to-**`PARTY_MAX` = 5**-player party (leader + 4). Invite by name
(`{t:"party",a:"invite",name}` or the `/invite` chat command), then accept/decline/leave; invitations expire after
60 s and the newest incoming invite replaces an older one. The leader is the only one who can invite; when the leader
leaves or disconnects the next member is promoted; when only one member would remain the party disbands. All member
lists, invites and leader state are keyed by **live player ids and dropped on disconnect, so nothing about a party is
persisted**.

Every change is pushed as the `party` ServerMsg (a solo player gets `members: null`, plus `inviteFrom` while an invite
is pending); a periodic tick resyncs the live HP/level bars only when a value changed. The client panel (key O) only
renders this state and sends actions; the server validates every field.

**Shared kill XP:** every OTHER party member of the killer who is alive and within `KILL_XP_SHARE_RANGE` = 45 units of
the corpse receives `KILL_XP_SHARE` = 50% of **their own** level-scaled kill-XP value for that mob (so the normal
level-difference curve and the Lantern Tide multiplier apply per helper). Only XP is shared: loot, coin, jade and quest
credit still go only to the credited killers, and anyone already credited with full kill XP is skipped (no double
grants). Helpers get a rate-limited `Shared hunt: +N XP.` system line (at most once per 12 s per helper). A solo killer
takes a no-party early-out, so solo kills are bit-identical to before the feature.

### Spirit-sword mount (0.5.0)

`MOUNT = { speedMult: 1.6 }` in `game/world.ts`. The client sends `{t:"mount"}`; `World.toggleMount()` validates that the
player is alive, flips `Player.mounted`, resets the movement baseline and sends a system line ("You step onto your spirit
jian and rise. (R to dismount)" / "You step down from your spirit jian."). While mounted, the authoritative movement step
**and the anti-cheat speed ceilings** both use the multiplier, so a mounted player moves 1.6x without tripping movement
accounting (the mount is the only sanctioned speed buff). Casting any skill or dying force-dismounts (no chat line);
`EntityState.mounted` rides in every snapshot so all clients draw the jian. Mount state is session-only (starts false,
never persisted).

### Treasure caches (0.5.0)

`game/chests.ts` adds six fixed caches, one per landmark (grove, pond shore, fox hills, shrine, misty hollow, reed bank),
each with a stable numeric id and a fixed position. A player opens one with `{t:"openchest", id}` when within
`CHEST_OPEN_RANGE` = 3.5 units and the cache is ready; dead players cannot open. Opening grants 15-30 coin, a 1-2 stack
roll from the existing `MATERIALS` pool (a second stack 50% of the time) and a 20% chance of a class-usable fine gear
piece, all through the normal loot/coin/system paths. The cache then refills after `CHEST_RESPAWN_SECONDS` = 120 s (the
refill tick sends a quiet "A <name> is ready again nearby." line within 22 units). State is **session-only and global to
the World**, pushed as the tiny `chests` message on login and on every change — caches never enter the entity/snapshot/
interest path. `TEST_MODE=1` servers can shorten the refill with `TEST_CHEST_RESPAWN`.

### Economy: coin, jade and the daily board

`COIN`: 85% drop chance (bosses always), average `2 + 1.5 * mobLv` +/-30%, grey mobs pay at least a quarter, boss x12.
`JADE`: 3 per boss kill, 10 for finishing Elder Lin's chain. Both are sent as `wallet` on every change.

The daily board (`economy.ts`) picks `DAILY_COUNT` = 3 tasks from the **11-entry `DAILY_POOL`** (`bamboo_purge`,
`fox_tails`, `pond_patrol`, `shrine_duty`, `word_with_mei`, `steady_cultivation`, `reed_sweep`, `hollow_lights`,
`cold_light`, `second_ward`, `masked_summoner`) by a seeded shuffle of the UTC date: same date = same board. Progress is
per character per day (`kill`/`loot`/`xp`/`talk` kinds) and stored in `wallet` + `daily` tables; `claim` is one
transaction (flip `claimed` + save wallet) so a reward can only ever be granted once, and the board refreshes/announces
at 00:00 UTC for players who stay online. Exact text formats: `../docs/MESSAGE_FORMATS.md`.

### Content systems (0.4.0 / 0.5.0, `game/content.ts`)

- **Equipment**: 6 slots x 4 rarities, **31 pieces**; class-locked weapons (Jian/Brush/Needles/Dao), level gates,
  Attack/Health/Crit/Damage-taken stats, total damage reduction capped at 40%, **5 sets** with 2/3/4-piece tiers
  (Wanderer, Bamboo Weave, Jade, Houndfang, Thornweave). Equipment lives in its own table; `gear` is re-sent on change.
- **Consumables**: 3 potions sharing a 15 s cooldown (see above); `use` is validated server-side.
- **Crafting**: **13 recipes** at Artisan Tao (potions, Bamboo Weave/Fox-Fur pieces, Jade Scale Vest, Houndfang charm/
  greaves/class weapons, Wisp Lantern, Qi Elixir, Thornweave Robe, epic Guardian's Heart at lv8/3 jade). Cost = mob
  materials + coin (+ jade where listed) and a level gate; every material can be obtained from a mob or a quest.
- **Trade**: Peddler Hao buys the **7 materials** (and spare gear/consumables at their sell price) and stocks **11 shop
  items** (3 potions, Wanderer starter kit, Thornweave Boots); `buy`/`sell` validate stock, price, quantity and pack space.
  During a Market Day window the transaction prices shift (`shopBuyPrice` = -25%, `shopSellPrice` = +50%, rounded, floor
  1 coin) while `SHOP`'s listed base prices stay untouched; the `npcdlg` quote and the actual debit/payout use the same
  function, so no arbitrage loop is created.
- **Side quests**: **16** in `SIDE_QUESTS`, gated by `minLv` + `requires` and accepted/handed in through the structured
  `npcdlg` panel (`npc` messages): Gate Warden Wu 5, Artisan Tao 5, Peddler Hao 3, Lantern Keeper Mei 3. Objectives
  (`kill`/`collect`/`talk`/`poi`) advance from the same kill/loot/talk/place events as the rest of the game; rewards can
  be XP, coin, jade, items, a class item or a title. At most 8 quests may be active; pack space is checked before
  granting; collect objectives are taken from the pack on turn-in only when `consume` is set. Six quest titles are
  collected into `ALL_TITLES` via `QUEST_TITLES`.
- **Merit seals and titles**: **30 achievements** across Combat/Exploration/Story/Craft (points, some grant a title);
  `prog` lists seals, points, owned titles, worn title (`EntityState.ttl` under the nameplate) and the **6 places of
  interest** (walk close to discover, XP + lore + Atlas entry). Counters are the generic `counters` store; the
  `bestTypes` (distinct mobs in the bestiary), `bosses` (distinct bosses killed), `set:<setId>` (worn pieces of a set)
  and `setsDone` (complete sets worn) values are DERIVED and rebuilt in memory by `recount()` at login/equipment
  changes, so they never add rows to the DB. `tideKills` is a normal persisted counter bumped only while a Lantern Tide
  is active.
- **Bestiary counters**: every kill bumps `best:<mobType>` in the generic persisted counter store; the full 11-entry
  list is re-sent as `best` on login and whenever a count changes. The client (Shift+B) renders it; the server has no
  separate table and no schema change.
- Inventory: 30 stacks x 99 (`INV`), full list pushed as `inv` after login and on every change; overflow loot is left
  behind with a system line.
- Death: player dies -> respawn at the plaza after 5 s (`TUNING.respawnDelay`), full HP/Qi, no item loss.

### Quests and dialog

- **Elder Lin (main chain, 4 quests, chat-driven)**: Clear Bamboo Spirits (kill 5, 100 XP + 2 Healing Tonics) ->
  Collect Fox Tails (3, 220 XP + Jade Charm, tails consumed) -> Cleanse the Pond (4 Jade Serpents + 2 Jade Scales,
  380 XP + 2 Lotus Antidotes + Lotus Charm, scales consumed) -> Defeat the Stone Guardian (1500 XP + Guardian's Seal +
  Cloudmist Pendant). `/talk` within 16 u accepts/turns in; `/quest` shows progress anywhere; kills/loot update the
  current objective; turning in auto-accepts the next quest; stage/status/progress persist in the `quests` table and old
  saves are migrated (`progress2`, `mei` columns via ALTER TABLE). Kill credit goes to every player with threat; boss
  credit only to threat-holders within 70 u at the kill.
- **Lantern Keeper Mei (errand, chat-driven)**: `/talk mei` accepts "Wicks for the Lanterns" (5 Bamboo Fiber, counted
  from the pack), `/quest` lists it, turn-in gives 150 XP + Paper Lantern + Healing Tonic and consumes the fibre; the
  state is the `mei` column (0/1/2). Bare `/talk` goes to Elder Lin when in reach, otherwise to the nearer of Mei/Fen.
- **Side-quest NPCs (structured panel)**: Wu, Tao, Hao and Mei speak through `npcdlg`/`sq` (offer/active/ready/done),
  with Accept/Hand-in buttons and Tao/Hao's craft/buy/sell tabs. Talk objectives count through the same `npc talk` path.
- `/daily` (also Notice Board Keeper Fen) prints the board; `/test*` commands exist only with `TEST_MODE=1`.

## Reliability (heartbeat and send buffers)

- Heartbeat: ping every `heartbeatMs` = 5 s; any frame or pong resets the counter; the client is dropped only after
  `heartbeatMissed` = 6 silent intervals (~30 s), so multi-second stalls are tolerated.
- Send buffer: above `snapDropBuffered` = 256 KB queued for a socket, snapshots are skipped (the next snapshot is full
  state, so nothing is lost; `droppedSnaps` in `/health` counts them) while events keep flowing. Only above
  `killBuffered` = 16 MB is the connection terminated.
- Memory stays bounded: fixed entity set, threat maps cleared on death/leave, 2 KB message cap, per-session rate limit,
  snapshots skipped under backpressure.
- Server authority: movement is replayed against a speed budget (with a short history window) and snaps back on
  violations; casts, loot, quests, trade and claims are all validated server-side.

## TEST_MODE hooks (tests only)

With `TEST_MODE=1` (never set in production) chat accepts these and they bypass the chat rate limit:
`/testlevel N`, `/testtp X Z`, `/testquest STAGE [status]`, `/testgive Item_Name N`, `/testdrops`, `/testkill [type] [N]`,
`/testxp N`, `/testdaily [n]`, `/testwallet C J`, `/testclock H` (or `reset`), `/testqi N [holdS]`, `/testbosshp F`,
`/testheal`, and `/testwarp X Z` (an unsanctioned jump used to test movement accounting). Without TEST_MODE this text is
ordinary chat.

## Tests and soak

```
npm test                 # node scripts/run-all.mjs: bots -> telegraph -> economy -> api-test -> dodge -> content
npm run test:telegraph   # TELE_PORT 8991
npm run test:economy     # ECO_PORT 8974
npm run test:dodge       # DODGE_PORT 8975
npm run test:content     # CONTENT_PORT 8977
npm run test:api         # API_PORT 8976 (then dodge)
npm run soak             # SOAK_PORT 8972, SOAK_SECONDS 180, 3 bots by default (SOAK_CLASSES to pick)
```

`run-all.mjs` runs every suite in sequence on its own temp DB and prints a PASS/FAIL summary (exit 1 on failure).
`bots.ts` spawns a TEST_MODE server on `BOT_PORT` 8971 and covers protocol/robustness, gameplay, classes, quests, the
boss fight, death/respawn, persistence, save migrations, account flows and the English-only scan; the focused suites
cover telegraph geometry/dodging, the economy + daily board, the launcher auth API, the dodge/Qi rules and the
0.4/0.5 content data + wire messages. `BOT_URL` reuses an already running server; `BOT_VERBOSE=1` streams server logs.

Soak: 3 bots for 3 minutes; asserts zero server error log lines, no dropped connections, XP for every class, loot,
chat, quest turn-ins, death+respawn, bounded RSS growth and entity counts, snapshot rate 8-12/s and no dropped
snapshots, and prints time-to-kill tables. `SOAK_URL` targets an existing server; `SOAK_DUMP_KILLS=1` logs each kill.

## Launcher account API and session tokens

Same HTTP server as `/health` (port `PORT`); contract documented in `../docs/LAUNCHER.md`.
- `GET /health` -> `{ok, players, version, uptime, tick, mobs, entities, droppedSnaps, rss}`.
- `POST /api/auth/register` / `POST /api/auth/login`, JSON body `{name, pw}` (Content-Type required, max 2 KB) ->
  `200 {ok:true, token, name, expiresIn:300}` or `{ok:false, error}`. Register only creates the account (salted scrypt);
  the character is created on the first game login, and a legacy character with the same name is claimed by it.
  Status codes: 400 invalid name/password/JSON, 401 wrong password, 404 unknown name (login) / unknown path, 405 wrong
  method, 409 name taken/in use, 413 body too big, 415 wrong content type, 429 rate limited.
- Rate limits: failed passwords and unknown-name logins count in the same limiter as the in-game login (5 failures per
  IP and per name per 60 s); registration is additionally capped at 10/min per IP (scrypt is CPU heavy). The client IP
  is the socket address; `TRUST_FLY_CLIENT_IP=1` opts into trusting Fly's overwritten `Fly-Client-IP` header.
- CORS: origins listed in `CORS_ORIGINS` (`*` allows any) are echoed in `Access-Control-Allow-Origin`; `null`
  (file://) only with `ALLOW_NULL_ORIGIN=1`; requests with no `Origin` (the Electron launcher) are never blocked.
  `OPTIONS` preflight returns 204.
- Tokens: `base64url(JSON{name, exp, jti}).base64url(HMAC-SHA256)`, 300 s, single use (jti remembered until expiry).
  Secret from `TOKEN_SECRET` (>= 8 chars) or a random one persisted as `token.secret` next to `DB_PATH` (a warning is
  logged; set the env var in production). The game `login` accepts `tok` instead of `pw`; it must be valid, unexpired,
  unused and for the same name, and is only spent by a login that passes the name/online/full checks.

## Localization (English only)

All player-facing text is English. The deprecated `*Zh` protocol fields (`ZoneInfo.nameZh`, `SkillDef.nameZh`,
`InvItem.itemZh`, `loot.itemZh`) are always sent as `""`. Entity names (Elder Lin, Lantern Keeper Mei, Gate Warden Wu,
Notice Board Keeper Fen, Artisan Tao, Peddler Hao and all mobs), class names (Sword Cultivator, Talisman Master,
Physician, Blade Dancer), item names and titles carry no hanzi; old SQLite rows with hanzi item names are rewritten to
English on startup. The client's `check:english` script and the server test suite both fail on any CJK character.

## Known limitations

- **No terrain/obstacle collision on the server**: only world bounds are enforced, so a modified client could walk
  through buildings and the pond (the client camera/visuals treat props as solid).
- Snapshots are full-state JSON, not delta/binary; a single zone and a single process (no horizontal scaling).
- **No guilds/PvP/mail/auction house or dungeons**: only NPC trading and session-only player-to-player trading.
  Parties and trades are session-only (parties max 5, never persisted) and treasure-cache state is session-only/
  global (a restart refills all caches); the mount is a travel toggle (1.6x) and the companion/weather are cosmetic.
  No password recovery (name +
  password accounts only).
- Balance is tuned against bots and scripted checks, not human play sessions; the late levels (10-20) have the least
  coverage. The boss bar in the client is still wired to the Stone Guardian only.
- Quest dialog for Elder Lin and Mei is chat/system text; only the side-quest NPCs have a structured window. The world
  chat is plain text and must be rendered as text by clients (not HTML).
- Because the server has no prop collision, movement validation only protects against speed/teleport cheats.
