# JIUZHOU server

Authoritative game server for (Cloudmist Valley vertical slice). Implements `../shared/protocol.ts` **v2** exactly (v2 = additive: `jade_serpent` mob type, `{t:"inv"}` message, `telegraph` event).

## Run
```
npm install
npm run dev      # tsx watch
npm run start    # tsx src/server.ts
npm test         # boots a server on :8971 (TEST_MODE=1) with a temp DB and runs the bot suite incl. the boss fight (PASS/FAIL summary, exit code 1 on failure)
npm run soak     # 3-minute soak: 3 bots (one per class) on :8972 with a temp DB; PASS/FAIL + time-to-kill table
npm run typecheck
```
Port **8787** (`PORT`), characters DB `DB_PATH` (default `server/data/jiuzhou.db`). `GET /health` returns JSON. Tests: `BOT_PORT` (npm test has about 85 checks: protocol/robustness, gameplay, quest chain, jade serpents + pond quest + inventory, boss fight), `BOT_URL` (test an already running server), `BOT_VERBOSE=1`.
Requires Node >= 22.5 (`node:sqlite`, prints an ExperimentalWarning).

## Architecture
1. `src/server.ts`: HTTP + `ws` server, sessions, JSON parsing/validation, per-connection token-bucket rate limit, login flow, 20 Hz drift-corrected loop, 30 s autosave, heartbeat (see Reliability), graceful shutdown (SIGINT/SIGTERM).
2. `src/game/world.ts`: the simulation. Entities, player movement, snapshots, event fan-out, chat.
3. Input: each `input` sets the player's held direction (normalized to <=1, so never faster than PLAYER_SPEED); `ack` = highest seq received. A held input expires after 0.5 s of silence, so clients must send inputs continuously while moving (send 0,0 to stop).
4. `src/game/grid.ts`: spatial hash (30u cells) rebuilt each tick; used for mob aggro and per-client interest.
5. Snapshots every 2nd tick: each client gets full state of all entities within INTEREST_RADIUS (60) each snapshot, plus `gone` ids that left interest since last snapshot.
6. `src/game/mobs.ts`: mob AI (idle wander, aggro, chase, melee, leash/return+heal, respawn) and spawn generation (deterministic seed).
7. `src/game/combat.ts`: cast validation (skill id, cooldown + 0.3 s GCD, target/range with 1.5u latency slack), damage/heal/crit, threat, XP/level-up, loot, death.
8. `src/data.ts`: ALL numbers: zone, tuning, classes + skills, mobs, spawn groups, NPCs, XP curve.
9. `src/db.ts`: `node:sqlite` characters table (name NOCASE key, class, level, xp, x, z).
10. Events (`ev`): damage/cast/heal/death go to players near the event; xp/levelup/loot only to the recipient; chat is zone-wide.
11. Player death: respawn at the plaza after 5 s with a system message. Mobs give XP+loot to everyone with threat on them.
12. Memory is bounded: per-mob threat maps cleared on death/leave, fixed entity set, input frames capped at 2 KB, send backpressure drops snapshots.
13. `src/game/quests.ts`: Elder Lin quest chain (see Quests).

## Reliability (heartbeat and send buffers)
Cause of the earlier drops of stalled headless clients: the old heartbeat terminated a socket that had not answered a ping within a single 15 s interval, and any socket with more than 4 MB queued was terminated. A client whose event loop was blocked for several seconds (no pong, no reads) could be dropped by either rule. Now (all in `TUNING`, `data.ts`):
- Heartbeat: ping every `heartbeatMs` = 5 s; any frame or pong resets the counter; the client is dropped only after `heartbeatMissed` = 6 silent intervals (about 30 s of total silence). Verified: a client blocked for 22 s stays connected.
- Send buffer: if a socket has more than `snapDropBuffered` = 256 KB queued, snapshots are skipped for that socket (the next snapshot is full state, so nothing is lost; `droppedSnaps` in `/health` counts them) while events keep flowing. Only above `killBuffered` = 16 MB is the connection terminated (and logged).
- `/health` also reports `entities`, `mobs`, `droppedSnaps`, `rss`.

## Quests (Elder Lin)
Implemented without protocol changes: everything is `chat` events with `sys:true`.
- Trigger: the player sends the chat text `/talk` while within 16 units of Elder Lin (plaza, about 10 units from spawn). `/talk` is consumed by the server (not broadcast). `/quest` shows progress from anywhere. Walking within 5 units of Elder Lin sends a one-time "Type /talk" hint. Other `/xyz` text gets a short help line.
- Chain (v2, 4 quests): 1. Clear 5 Bamboo Spirits (100 XP + 2 Healing Tonic); 2. Collect 3 Fox Tails (220 XP + Jade Charm; the 3 tails are taken from the pack); 3. **Cleanse the Pond**: defeat 4 Jade Serpents and bring 2 Jade Scales (240 XP + 2 Lotus Antidote + Lotus Charm; the 2 scales are taken from the pack); 4. Defeat the Stone Guardian (600 XP + Guardian's Seal + **Cloudmist Pendant**, on top of the Guardian Core that drops from the boss).
- Flow: `/talk` accepts the quest -> kills/loot update progress -> on completion a sys message says to return -> `/talk` at Elder Lin turns in (XP via the normal `xp`/`levelup` events, items into the inventory plus a `loot` event each) and automatically accepts the next quest. Progress and stage persist in the sqlite `quests` table (`stage, status, progress, progress2`, written on every change; restored at login). Old v1 saves are migrated on startup (stage >= 2 shifts by one because the pond quest was inserted before the guardian). Credit goes to every player with threat on the mob; for the boss only those within 70 units of it when it dies.
- Exact text patterns (unchanged for existing quests; `N/T` is now `/4`):
  - `[Quest 1/4] Clear Bamboo Spirits: 3/5` progress; `Quest accepted: [Quest 1/4] ...: 0/5`; `... 5/5 - objective complete! Return to Elder Lin and type /talk.`; `Quest complete: Clear Bamboo Spirits  (+60 XP)`; dialog lines are `Elder Lin: <text>`.
  - Two-objective quest (pond): the counter is the combined count with a breakdown in the tail, `[Quest 3/4] Cleanse the Pond: 3/6 (Jade Serpents 3/4, Jade Scales 0/2)`. The tail never contains the word "complete" until done, so the existing client regex `^(Quest accepted:\s*)?\[Quest\s+(\d+)\s*\/\s*(\d+)\]\s*(.*?):\s*(\d+)\s*\/\s*(\d+)(.*)$` keeps working (it shows 3/6; the breakdown is in the tail group).
  - Pack full: `Your pack is full; <item> was lost.`
- All text/numbers: `QUESTS` in `data.ts`.

## Lantern Keeper Mei (errand "Wicks for the Lanterns")
A small delivery quest independent of Elder Lin's chain (`MEI_QUEST` in `data.ts`, logic in `quests.ts`). Mei stands at (7,-74), 12 units from Elder Lin. `/talk mei` talks to Mei and `/talk elder` to Elder Lin (the client sends the one whose dialog is open; each needs you within 16 units); a bare `/talk` goes to Elder Lin when she is in reach, else to Mei. A dead player gets "You cannot speak while defeated".
- Flow: `/talk mei` accepts (`Lantern Keeper Mei: <intro>`, `Task accepted: Wicks for the Lanterns: 0/5 Bamboo Fiber`); progress is counted from the pack (Bamboo Fiber drops from Bamboo Spirits, 70%), `/talk` again shows `Task: ...: n/5 Bamboo Fiber`; with 5 in the pack it turns in: `Task complete: Wicks for the Lanterns  (+90 XP)`, 5 fibres consumed, Paper Lantern + Healing Tonic added (each with a `loot` event and an `inv` update). One-time; afterwards Mei only chats. `/quest` also lists an open task.
- The task lines intentionally avoid the `[Quest n/N]` and `Quest ...:` formats so the client's Elder Lin tracker ignores them; the NPC dialog shows them as notes.
- Persistence: column `mei` (0 none, 1 accepted, 2 done) on the sqlite `quests` row; databases created before v0.2.0 get the column via `ALTER TABLE` on startup. Covered by section [F2] of `npm test`.

## Inventory
- Table `items(name, item, item_zh, qty)` in sqlite, one row per stack, written on every change (upsert / delete at 0), loaded at login. Limits (`INV` in `data.ts`): 99 per stack, 30 stacks; overflow loot is dropped with a sys message.
- Protocol: `{t:"inv", items:[{item,itemZh,qty}]}` (full list) is sent right after `welcome` (and the initial `xp` event) and after every change (loot, quest reward, quest-item consumption). The `loot` event is still sent for every item gained (for the loot log). Stored item names are the English names (`Fox Tail`, `Jade Scale`, ...).
- Items: Bamboo Fiber, Fox Tail, Jade Scale, Serpent Gall (rare, 8%), Guardian Core, plus quest rewards. There are no consumables yet (Healing Tonic / Lotus Antidote are collectables).

## Jade Serpent (mob 4)
`jade_serpent`, lv 2-4, 6 fixed spawn points on the dry shore of the lotus pond / stone bridge (pond centre (0,-34), bridge along x=0, z -53..-15 in `client/src/world/terrain.ts`): (-26,-43) (-25,-31) (25,-43) (26,-30) (14,-17) (-12,-14). Nearest is 45 units from the plaza spawn (rule: >= 35), spacing >= 12 (aggro is 9, so no chain-pulls), none inside the bamboo box. They are visible from the plaza edge (interest radius 60) but never aggro it.
- Behaviour: hp 80+40/lv, fast chase (4.4 u/s). When the target is within 7 units it coils for 0.55 s (frozen, `st:"attack"`), then dashes to where the target stood and bites if the target is within 2.8 units of the landing point: moving sideways during the coil dodges it. A bite does 3+1.5/lv damage and applies **poison**: 2+0.7/lv damage per second for 4 s as ordinary periodic `damage` events (src = the serpent); re-bites refresh instead of stacking; guard buffs reduce it; poison stops on death/respawn. Bite cooldown 3 s, respawn 25 s, 12 XP/lv.
- Loot: Jade Scale 70%, Serpent Gall 8%.

## Stone Guardian (boss)
HP 2000, lv 8, melee 32 (24+1/lv) every 2.6 s on the highest-threat player in reach 4, speed 3 (slower than players, so ranged classes can kite). 2000 XP (lv8 x 250) to every credited participant. Telegraphed ground slams (`telegraph` event: `x,z,radius,delay`; damage lands `delay` s later on every living player still inside, guard buff applies):
| Pattern | Where | Radius | Delay | Damage |
|---|---|---|---|---|
| Slam (A) | on a player (round-robin over players within 40) | 7 | 1.8 s | 90 |
| Stomp (B) | around the boss | 8 | 1.7 s | 80 |
| Scatter (C, below 50% HP) | 3 circles: one on a player, two within 5.4-9 of it, all emitted in the same tick | 4.5 | 2.0 s | 55 each |
Sequence: first telegraph 3 s after engage, then A, B, A, B ... every 8-10 s; at the moment HP drops below 50% the next telegraph (within 1.5 s) is C, then the sequence is A, C, B, C every 8 s and the System line "Stone Guardian's runes blaze crimson!" is sent. A full-HP lv6 player (198-245 HP) survives any single hit; two overlapping hits can kill. Enrage after 150 s of combat: all boss damage x1.5, telegraphs 25% faster ("... is enraged!"). Leash 40 from its post: when nobody with threat is within it (or all are dead) it walks back and regenerates 25%/s, clearing pending slams. Respawn 120 s (deterministic sim time); after death, XP, loot, quest credit go only to threat-holders within 70 units.

## TEST_MODE hooks (tests only)
With env `TEST_MODE=1` (set by `npm test`; never set it in production) chat accepts `/testlevel N`, `/testtp X Z`, `/testquest STAGE [status]`, `/testgive Item_Name N`, `/testheal`; they bypass the chat rate limit. `TEST_BOSS_RESPAWN=<seconds>` (only with TEST_MODE) shortens the boss respawn so the test can observe it (the suite uses 20 s). Without TEST_MODE these are ordinary chat text.

## First minutes
No mob spawn point lies within `TUNING.safeSpawnRadius` = 35 of the spawn (nearest bamboo is about 60 away, foxes about 100). Spawn groups have a `spacing` so mobs no longer chain-pull (bamboo 11, fox 15).

## Soak test
`npm run soak` boots a server (`SOAK_PORT`, default 8911), runs 3 bots (sword, talisman, physician) for `SOAK_SECONDS` (default 180): they `/talk` to Elder Lin, hunt bamboo spirits with a real skill rotation (Qi Guard / Wind Step / Spring Rain used reactively), return to turn in, hunt fox spirits, loot, chat, and the sword bot makes one scripted run into the Stone Guardian to die and respawn. Asserts: zero server error log lines, no dropped connection, XP for every class, loot, chat, quest turn-ins, death+respawn, server RSS growth < 30% (baseline at t=20 s), constant entity count, bounded client-visible entities, snapshot rate 8-12/s in every 10 s window, no dropped snapshots. Also prints time-to-kill tables. `SOAK_CLASSES=physician` runs one class alone (the only way to get clean per-class kill times, because bots otherwise share mobs); `SOAK_DUMP_KILLS=1` lists each kill.

## Tuning table (all in `src/data.ts`)
Time to kill = first own hit to kill, one class alone, player lv1-2 vs lv1-3 Bamboo Spirits (median of bot runs; targets in parentheses). Fox column: player lv3 vs lv3-4 Fox Spirits.
| Class | HP (lv1) | Atk | Skills | TTK bamboo | TTK fox |
|---|---|---|---|---|---|
| Sword | 120 (+25/lv) | 9 (+3/lv) | Slash x1.0 1s; Qi Wave x1.3 3s; Heaven-Splitting x3.2 8s; Qi Guard -50% dmg 5 s + 10% heal, 15s | 9-10 s (6-12) | 9-11 s |
| Talisman | 90 (+18/lv) | 8 (+3/lv) | Fire x1.1 1.2s; Thunder AoE x1.6 6s; Frost Seal x0.8 + slow 8s; Wind Step -40% dmg 4s, 12s | 8-13 s (8-14) | 10-13 s |
| Physician | 105 (+22/lv) | 6 (+2.5/lv) | Jade Needle x1.0 1s; Spring Rain heal 3.0x atk + 15% max HP (party) 7s; Purifying Light AoE x2.2 6s; Meridian Surge heal 40% max HP 20s | 17-18 s (12-20) | 15-17 s |

Mobs: Bamboo Spirit hp 60+30/lv, dmg 4+2/lv per 1.6 s, aggro 9, 10 XP/lv, lv1-3. Fox Spirit hp 90+40/lv, dmg 4.5+2/lv per 1.4 s, lv3-4, 12 XP/lv. Jade Serpent and Stone Guardian: see their sections. A lone bamboo spirit deals 4-5 hp/s, so an AFK player dies to a pack in roughly 10-30 s, while Qi Guard / Spring Rain / Meridian Surge keep a single pull survivable. Jade Serpent TTK (mixed run, lv3-5 players vs lv2-4 serpents): sword ~2-7 s, talisman ~7-10 s, physician ~4-6 s, in line with foxes; the lunge/poison costs a lv4 talisman roughly one death per 3 minutes when it ignores the coil. Stone Guardian: a lv6 sword+talisman+physician trio with a dodging bot AI kills it in 18-33 s (boss HP 2000; damage shares about 892/462/646), with at most one bot death. Bots do still die occasionally to fox pulls at lv3 (about one death per 150 s for talisman).

## Data files
`src/data.ts` (everything tunable), `data/jiuzhou.db` (created on first run; gitignored).

## Known limitations
- No terrain/obstacle collision (bridge, pond, buildings): only world bounds.
- Qi Guard / Wind Step are "guard" buffs (damage reduction), sent as kind `heal` with range 0 (protocol has no buff kind). There is no movement-speed buff because snapshots carry no speed.
- Snapshots are full-state, not delta; JSON transport.
- A name can be taken by anyone (no passwords). Class is fixed at character creation.
- Inventory is a plain list of stacks (no equipment/consumable effects, no trading/dropping).
- Quest dialog is English-only system chat; no client-side NPC window. The Stone Guardian is tuned for a small group (no party system; threat/credit is per player). No PvP. Single zone, single process, no horizontal scaling.
- Chat text is not HTML-escaped; clients must render it as text.

## Localization (English only)
All player-facing text is English. The deprecated protocol fields `ZoneInfo.nameZh`, `SkillDef.nameZh`, `InvItem.itemZh` and `loot.itemZh` are always sent as `""`. Entity names (`Elder Lin`, `Lantern Keeper Mei`, `Gate Warden Wu`, `Bamboo Spirit`, `Fox Spirit`, `Jade Serpent`, `Stone Guardian`) carry no hanzi. Classes: Sword Cultivator, Talisman Master, Physician. Old sqlite rows with hanzi item names are rewritten to English on startup (`CharacterDb.migrateItemNames`; loading also maps/drops them defensively). Tested in section [I] of `npm test` (scans every server frame of the whole run for CJK).

## Message formats
All are `chat` events with `sys:true` and from `System`. `N` = 1-based stage, total is always `/4`.
| Kind | Exact format |
|---|---|
| Elder dialog | `Elder Lin: <text>` |
| Mei dialog | `Lantern Keeper Mei: <text>` |
| Quest progress | `[Quest N/4] <Title>: <cur>/<max>` e.g. `[Quest 1/4] Clear Bamboo Spirits: 3/5` |
| Two-objective progress | `[Quest 3/4] Cleanse the Pond: 3/6 (Jade Serpents 3/4, Jade Scales 0/2)` |
| Accepted | `Quest accepted: [Quest N/4] <Title>: 0/<max>` |
| Objective done | `<progress line> - objective complete! Return to Elder Lin and type /talk.` |
| `/quest` when ready | `<progress line> - complete! Return to Elder Lin and type /talk.` |
| Turn-in | `Quest complete: <Title>  (+<xp> XP)` (two spaces before the paren) |
| Mei accepted | `Task accepted: Wicks for the Lanterns: 0/5 Bamboo Fiber` |
| Mei progress | `Task: Wicks for the Lanterns: <n>/5 Bamboo Fiber` (`/quest` appends ` - bring it to Lantern Keeper Mei.`) |
| Mei done | `Task complete: Wicks for the Lanterns  (+150 XP)` |
| Pack full | `Your pack is full; <item> was lost.` / `... was left behind.` |
| Boss | `Stone Guardian's runes blaze crimson!`, `Stone Guardian is enraged!` |
| Other | `Welcome to Cloudmist Valley, <name>.`, `Commands: /talk ... /quest ...`, `You return to the plaza, renewed.` |
Commands: `/talk`, `/talk elder`, `/talk mei`, `/quest`. Quest titles: Clear Bamboo Spirits, Collect Fox Tails, Cleanse the Pond, Defeat the Stone Guardian. Items: Bamboo Fiber, Fox Tail, Jade Scale, Serpent Gall, Guardian Core, Healing Tonic, Jade Charm, Lotus Antidote, Lotus Charm, Guardian's Seal, Cloudmist Pendant, Paper Lantern.

## v3: levels 1-20, wallet, daily board (`src/economy.ts`)
- **Levels**: `MAX_LEVEL` 20, `xpToNext = round(30*lv^1.6)` (26063 XP total; lv8 after ~12-15 min, cap after ~1.5 h at roughly one kill per 35 s). Kill XP scales with the level difference (`xpLevelMult` in `data.ts`: +10 % per level above up to +50 %, full within 2 below, then 0.8/0.6/0.4/0.2/0.1). Stored characters are clamped by `normalizeProgress` at login. Six extra spawn groups (lv 5-20 bamboo/fox, far from the plaza) give the curve something to level on. Quest XP: 100/220/380/1500, Mei 150, boss 2000.
- **Wallet**: `coin` (85 % of normal kills, `2 + 1.5*mobLv` +-30 %, boss x12) and `jade` (boss 3, chain end 10, dailies). Tables `wallet` and `daily` are created by `economy.ts` on its own connection to the same sqlite file. `{t:"wallet",coin,jade}` after login and on every change.
- **Dailies**: 3 of `DAILY_POOL` (data.ts) per UTC date (seeded shuffle), progress per character per day, `{t:"daily",tasks,resetIn}`; `{t:"claim",id}` grants once (database transaction flips `claimed`, wallet saved with it). `/daily`, Notice Board Keeper Fen (`/talk fen`). Formats: `docs/MESSAGE_FORMATS.md`.
- TEST_MODE hooks added: `/testxp N`, `/testdaily [n]`, `/testwallet C J`, `/testclock H` (shift the server clock by H hours; `reset`). Tests: `npm run test:economy` (unit + server, `ECO_PORT`, `ECO_DB`); `npm test` runs both suites.

## Launcher account API and session tokens
Same HTTP server as `/health` (port `PORT`). Contract with the launcher: `../docs/LAUNCHER.md` section 3.
- `GET /health` -> `{ok, players, version, uptime, ...diagnostics}`. `version` comes from the repo `VERSION` file (fallback `package.json`).
- `POST /api/auth/register` / `POST /api/auth/login`, body `{name, pw}` (JSON, `Content-Type: application/json`, max 2 KB) -> `200 {ok:true, token, name, expiresIn:300}` or `{ok:false, error}`. Register only creates the account (scrypt); the character is created on the first game login (a legacy character with the same name is claimed). Status codes: 400 invalid name/pw/JSON, 401 wrong password, 404 unknown name (login) or unknown path, 405 wrong method, 409 name taken/in use, 413 body too big, 415 content type, 429 rate limited. Error texts are the in-game ones (`Wrong password for that name.`, `No account with that name. Register first.`, `That name is already taken.`, `Too many attempts. Wait a minute.`). Passwords are never logged.
- Rate limit: wrong passwords and unknown-name logins count in the SAME limiter as the in-game login (5 failures/60 s per IP, 5 per name). Account creation is additionally capped at 10/min per IP. The IP is the socket address (no proxy header is trusted; behind a reverse proxy all players share its IP, so add trusted-proxy support first).
- CORS: `CORS_ORIGINS` (comma list; `*` allows any) are echoed back in `Access-Control-Allow-Origin`; origin `null` (file://) only with `ALLOW_NULL_ORIGIN=1`. Requests with no `Origin` header (the Electron launcher) are never blocked. `OPTIONS` preflight returns 204.
- Tokens: `base64url(JSON{name,exp,jti}).base64url(HMAC-SHA256)`, 300 s, single use (jti kept in memory until exp, so a restart forgets used jtis but tokens are only valid for 5 min). Secret: `TOKEN_SECRET` (>= 8 chars), else a random one persisted as `token.secret` next to `DB_PATH` (a warning is logged; set the env var in production). In-game `login` accepts `tok` instead of `pw`: it must be valid, unexpired, unused and for the same name (case-insensitive), else `Session expired. Sign in again from the launcher.` A token is only spent by a login that gets past the name/online/full checks.
- Tests: `npm run test:api` (`API_PORT`, `API_DB`; part of `npm test`, runs after economy; the rate-limit section is last and blocks 127.0.0.1 on its own spawned server).
