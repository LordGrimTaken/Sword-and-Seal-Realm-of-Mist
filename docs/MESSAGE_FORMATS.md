# Server message formats

(Same table as server/README.md.)

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
| Other | `Welcome to Cloudmist Valley, <name>.`, `Commands: /talk ... /quest ...`, `You return to the plaza, renewed.` |
Commands: `/talk`, `/talk elder`, `/talk mei`, `/quest`. Quest titles: Clear Bamboo Spirits, Collect Fox Tails, Cleanse the Pond, Defeat the Stone Guardian. Items: Bamboo Fiber, Fox Tail, Jade Scale, Serpent Gall, Guardian Core, Healing Tonic, Jade Charm, Lotus Antidote, Lotus Charm, Guardian's Seal, Cloudmist Pendant, Paper Lantern.

## v3 additions: wallet, daily board, Notice Board Keeper Fen, levels
Protocol v3 (`shared/protocol.ts`). Everything below is owned by `server/src/economy.ts` (+ `data.ts`).

### JSON messages (server -> client)
```jsonc
{"t":"wallet","coin":120,"jade":3}
{"t":"daily","resetIn":31152,"tasks":[
  {"id":"bamboo_purge","title":"Bamboo Purge","desc":"Slay 15 Bamboo Spirits.","have":8,"need":15,"coin":60,"jade":1,"xp":250,"done":false,"claimed":false}, ...3 tasks ]}
```
- Login order: `welcome`, `xp` event, `inv`, **`wallet`**, **`daily`**, then the welcome chat lines and snapshots.
- `wallet` is re-sent on every coin/jade change (kill drop, boss, chain, claim). `daily` is re-sent on every progress change, on claim (also on a refused claim, to resync), and at 00:00 UTC for players who stay online (the server checks once a second). `resetIn` = whole seconds until the next 00:00 UTC (1..86400); count it down locally.
- `have` is capped at `need`; `done` = `have >= need`; `claimed` = reward already taken today. Tasks are always 3, ids come from the pool in `DAILY_POOL` (`bamboo_purge`, `fox_tails`, `pond_patrol`, `shrine_duty`, `word_with_mei`, `steady_cultivation`). The board is a deterministic function of the UTC date.
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

Client -> server: `{"t":"equip","item":"Bamboo Weave Hat"}`, `{"t":"unequip","slot":"head"}`, `{"t":"use","item":"Healing Tonic"}`, `{"t":"npc","npc":"wu|tao|hao","a":"talk|accept|turnin","q":"<quest id>"}`, `{"t":"craft","id":"bamboo_hat"}`, `{"t":"buy","item":"...","qty":1}`, `{"t":"sell","item":"...","qty":1}`, `{"t":"title","id":"<title or empty>"}`. Every request is validated on the server (range to the NPC, level, class, materials, wallet, bag space); refusals come back as `error`.

Server -> client:
- `items` (catalogue of `ItemInfo`, sent once after login), `gear` (`slots` + summed `stats`), `npcdlg` (`npc`, `name`, `role`, `lines`, `quests`, optional `craft` / `buy` / `sell`), `sq` (the player's side quests), `prog` (merit seals, points, worn title, owned titles, places), `toast` (`kind` poi, ach, title, item or quest).
- `EntityState.ttl` is the worn title shown under a player's name.
- Login order adds `items`, `gear`, `sq`, `prog` after `daily`.
