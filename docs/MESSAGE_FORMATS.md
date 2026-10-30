# Server message formats

(This is the canonical player-facing system-message table; server/README.md links here instead of duplicating it.)

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
| Mei done | `Task complete: Wicks for the Lanterns  (+150 XP)` (was 90 before v3) |
| Pack full | `Your pack is full; <item> was lost.` / `... was left behind.` |
| Boss | `Stone Guardian's runes blaze crimson!`, `Stone Guardian is enraged!` |
| Other | `Welcome to Cloudmist Valley, <name>.`, the unknown-command help line (`Commands: /talk (speak to a nearby NPC; /talk mei, /talk elder or /talk fen to pick one), /quest (show quest progress), /daily (show the daily tasks).`), `You return to the plaza, renewed.` |
Commands: `/talk` (`/talk elder`, `/talk mei`, `/talk fen`), `/quest`, `/daily`. Quest titles: Clear Bamboo Spirits, Collect Fox Tails, Cleanse the Pond, Defeat the Stone Guardian. Items: Bamboo Fiber, Fox Tail, Jade Scale, Serpent Gall, Guardian Core, Healing Tonic, Jade Charm, Lotus Antidote, Lotus Charm, Guardian's Seal, Cloudmist Pendant, Paper Lantern.

## v3 additions: wallet, daily board, Notice Board Keeper Fen, levels
Protocol v3 (`shared/protocol.ts`). Everything below is owned by `server/src/economy.ts` (+ `data.ts`).

### JSON messages (server -> client)
```jsonc
{"t":"wallet","coin":120,"jade":3}
{"t":"daily","resetIn":31152,"tasks":[
  {"id":"bamboo_purge","title":"Bamboo Purge","desc":"Slay 15 Bamboo Spirits.","have":8,"need":15,"coin":60,"jade":1,"xp":250,"done":false,"claimed":false}, ...3 tasks ]}
```
- Login order: `welcome`, `xp` event, `inv`, `wallet`, `daily`, `items`, `gear`, `sq`, `prog`, `best`, then the
  welcome chat lines and snapshots. The first snapshot also carries the per-connection `surge`, `tide`, `market`,
  `party` and `chests` pushes (see the 0.5.0 section below) plus the player's `qi/mqi/dcd`.
- `wallet` is re-sent on every coin/jade change (kill drop, boss, chain, claim). `daily` is re-sent on every progress change, on claim (also on a refused claim, to resync), and at 00:00 UTC for players who stay online (the server checks once a second). `resetIn` = whole seconds until the next 00:00 UTC (1..86400); count it down locally.
- `have` is capped at `need`; `done` = `have >= need`; `claimed` = reward already taken today. Tasks are always 3, ids come from the pool in `DAILY_POOL` (`bamboo_purge`, `fox_tails`, `pond_patrol`, `shrine_duty`, `word_with_mei`, `steady_cultivation`, `reed_sweep`, `hollow_lights`, `cold_light`, `second_ward`, `masked_summoner`). The board is a deterministic function of the UTC date.
- Client -> server: `{"t":"claim","id":"bamboo_purge"}`. Valid only if the id is on today's board, `done` and not `claimed`; the reward is granted exactly once (repeat/racing claims, wrong ids, non-strings, ids over 64 chars, or unfinished tasks grant nothing and only produce one of the system lines below).

### System chat lines (`chat` event, `sys:true`, from `System`)
| Kind | Exact format |
|---|---|
| Coin drop (chosen: sys chat, there is **no** `Coin` loot item; loot events are unchanged) | `You found <N> coin.` (N >= 1, one line per kill that dropped coin; bosses always drop) |
| Jade | `You received <N> jade.` (boss kill: 3 to each credited player; finishing Elder Lin's last quest: 10) |
| Daily complete | `Daily complete: <Title>. Claim it from the notice board.` |
| Daily claimed | `Daily claimed: <Title> (+<coin> coin, +<jade> jade, +<xp> XP)` e.g. `Daily claimed: Bamboo Purge (+60 coin, +1 jade, +250 XP)` (the XP also arrives as a normal `xp` event; it does not count towards the "Earn XP" daily) |
| Claim refused | `That is not one of today's daily tasks.` / `That task is not complete yet.` / `You already claimed that reward today.` / `The notice board is busy; try again.` (database error, nothing granted) |
| Board refreshed (rollover while online) | `The notice board has been refreshed: new daily tasks are up.` |
| `/daily` (and `/talk fen`) | `Daily tasks (resets in 12h 00m):` then one line per task `- <Title>: <have>/<need> (+<coin> coin, +<jade> jade, +<xp> XP) [in progress\|ready to claim\|claimed]` then `Wallet: <coin> coin, <jade> jade`. Reset text is `Hh MMm` or `Mm`. |

### Notice Board Keeper Fen
NPC entity `Notice Board Keeper Fen` (`k:"npc"`) at x 8, z -85 (inside the plaza ring, clear of Mei, Elder Lin, Wu, the lantern ring, flag poles and seats; the brief's x12,z-84 sits on the plaza's lantern ring). `/talk fen` (within 16 units) answers `Notice Board Keeper Fen: Fresh notices go up at midnight, UTC. Finish a task, then claim your reward at the board.` followed by the `/daily` lines; far away: `Notice Board Keeper Fen is too far away. The notice board stands in the plaza near the spawn point.` Bare `/talk` routing: Elder Lin if in reach (unchanged), otherwise the nearer of Mei and Fen. The unknown-command help is now `Commands: /talk (speak to a nearby NPC; /talk mei, /talk elder or /talk fen to pick one), /quest (show quest progress), /daily (show the daily tasks).` Talking to Mei advances the `word_with_mei` daily on every `/talk mei`.

### Levels and XP (changed numbers)
Cap **20** (`MAX_LEVEL`); `xpToNext(lv) = round(30 * lv^1.6)` (lv1 30, lv5 394, lv8 836, lv19 3335; 26063 XP in total). At the cap the `xp` event has `xp:0, next:0`. Existing characters are clamped at login (level over 20 becomes 20, XP over the new threshold carries up). Kill XP = `xpPerLv x mobLv x m(d)`, `d = mobLv - playerLv`: d>=0 `1+0.1*min(d,5)`; -2..-1 1.0; -3 0.8, -4 0.6, -5 0.4, -6 0.2, <=-7 0.1 (min 1). Quest XP: chain 100 / 220 / 380 / 1500 (`Quest complete: ... (+N XP)`), Mei's errand `Task complete: Wicks for the Lanterns  (+150 XP)`. Stone Guardian pays 2000 XP at lv8 (`xpPerLv` 250).

## 0.4.0 additions: gear, side quests, crafting, merit (protocol v3, additive)
Owned by `server/src/game/content.ts` and `server/src/contentdb.ts`. Types are at the end of `shared/protocol.ts`.

Client -> server: `{"t":"equip","item":"Bamboo Weave Hat"}`, `{"t":"unequip","slot":"head"}`, `{"t":"use","item":"Healing Tonic"}`, `{"t":"npc","npc":"wu|tao|hao|mei","a":"talk|accept|turnin","q":"<quest id>"}`, `{"t":"craft","id":"bamboo_hat"}`, `{"t":"buy","item":"...","qty":1}`, `{"t":"sell","item":"...","qty":1}`, `{"t":"title","id":"<title or empty>"}`. Every request is validated on the server (range to the NPC, level, class, materials, wallet, bag space); refusals come back as `error`.

Server -> client:
- `items` (catalogue of `ItemInfo`, sent once after login), `gear` (`slots` + summed `stats`), `npcdlg` (`npc`, `name`, `role`, `lines`, `quests`, optional `craft` / `buy` / `sell`), `sq` (the player's side quests), `prog` (merit seals, points, worn title, owned titles, places), `toast` (`kind` poi, ach, title, item or quest).
- `EntityState.ttl` is the worn title shown under a player's name.
- Login order adds `items`, `gear`, `sq`, `prog`, `best` after `daily`; the first snapshot adds `surge`, `tide`, `market`, `party` and `chests` (see below).

## 0.5.0 additions: party, trade, mount, treasure caches, Lantern Tide, Market Day (protocol v3, additive)
Owned by `server/src/game/party.ts`, `server/src/game/trade.ts`, `server/src/game/chests.ts`, `server/src/game/world.ts`
and `server/src/data.ts`.

### JSON messages
```jsonc
// client -> server
{"t":"mount"}                                    // toggle the spirit-sword mount (server-authoritative speed)
{"t":"party","a":"invite","name":"Wanderer"}     // a: invite | accept | decline | leave
{"t":"openchest","id":3}                         // open the cache with this id
{"t":"trade","a":"request","name":"Wanderer"}    // a: request | accept | decline | offer | ready | cancel
{"t":"trade","a":"offer","slot":4,"qty":2}       // offer 2 from bag slot 4 (qty 0 removes); {"coin":120} sets coin
{"t":"trade","a":"ready"}                        // toggle your ready flag (both ready = atomic swap)
// server -> client
{"t":"surge","active":true,"endsIn":90}          // Mist Surge window
{"t":"tide","active":true,"endsIn":120}          // Lantern Tide window
{"t":"market","active":true,"endsIn":180}        // Market Day window
{"t":"party","members":[{"name":"Wanderer","cls":"sword","lv":5,"hp":180,"mhp":240}],"leader":"Wanderer"}
{"t":"party","members":null,"inviteFrom":"Wanderer"}   // solo + pending invite
{"t":"chests","chests":[{"id":1,"x":-42,"z":14,"ready":true}, ...6 entries ]}
{"t":"trade","state":null}                       // no trade / trade ended
{"t":"trade","state":{"peer":"Wanderer",
  "mine":{"items":[{"slot":4,"name":"Jade Scale","qty":2}],"coin":120,"ready":true},
  "theirs":{"items":[{"slot":1,"name":"Serpent Gall","qty":1}],"coin":80,"ready":false}}}   // views; both sides pushed
{"t":"trade","state":null,"invitedBy":"Wanderer"} // you have a pending trade request
```
- `EntityState.mounted` (players only) is the snapshot echo of the mount flag; the client draws the jian from it.
- `surge` / `tide` / `market` are sent on every state change and once after login (with `endsIn` seconds left when active).
- `party` is sent to every member on any change and once after login (`members: null` = solo). Session-only: never persisted.
- `chests` is sent after login and whenever a cache opens or refills. Six fixed caches, `ready` gates the F prompt; opening validates range 3.5 and refills after 120 s.

### System chat lines (`chat` event, `sys:true`, from `System`)
| Kind | Exact format |
|---|---|
| Mount toggle | `You step onto your spirit jian and rise. (R to dismount)` / `You step down from your spirit jian.` |
| Party invite | `You invite <name> to your party.` / `<name> invites you to a party. Type /accept or /decline.` |
| Party join/leave | `You join <name>'s party.` / `<name> joins the party.` / `<name> has left the party.` / `Your party has disbanded.` |
| Party leadership | `<name> is now the party leader.` / `Your invitation to <name> expired.` |
| Party refusals | `You have no pending party invitation.` / `You are already in a party. Leave it first.` / `<name> is already in a party.` / `Only the party leader can invite.` / `Your party is full (5 members max).` / `<name>'s party is full.` / `Usage: /invite <player name>.` / `No adventurer named "<name>" is online.` / `You cannot invite yourself.` / `<name> already has a pending invitation from you.` / `<name> declined your party invitation.` / `That invitation is no longer valid.` / `You are not in a party.` |
| Shared party kill XP | `Shared hunt: +<n> XP.` (at most once per 12 s per helper) |
| Treasure cache | `You open the <name> cache.` / `You found <n> coin.` / `Rare find: <item>!` / `That cache is already empty.` / `The cache is too far away.` / `A <name> is ready again nearby.` |
| Lantern Tide | `The lantern tide rises! Slain mobs give +50% coin and +25% XP for <s> s.` / `The lantern tide ebbs. Kill rewards return to normal.` |
| Market Day | `The market day opens! Peddler Hao pays +50% for goods and sells at -25% for <s> s.` / `The market day closes. Peddler Hao's prices return to normal.` |
| Mist Surge | `The mist surges! Mobs deal +20% damage for <s> s.` / `The mist recedes. Mobs deal normal damage again.` |
| Breakthrough | `Breakthrough! You have entered the <Realm> realm. (+<n> max HP)` (to the player) / `<name> has broken through to <Realm>!` (zone-wide) |
| Party chat commands | `/invite <name>`, `/accept`, `/decline`, `/leave` (or `/leaveparty`), `/party` (resync) |
- Party/mount/chest state is session-only. Persistent 0.5.0 additions go through the existing tables: bestiary kills
  (`best:<mobType>` counters), the `tideKills` merit counter, and the new merit seals that those counters unlock.
