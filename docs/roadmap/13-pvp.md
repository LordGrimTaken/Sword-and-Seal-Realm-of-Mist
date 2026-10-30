# PvP

1. **Ranked 1v1 arena, "Mist Gate"** — a circular ink-wash ring at the plaza paifang where players queue for 1v1 matches, running on the existing 20Hz tick and JSON snapshots so no new netcode path is needed; rated results seed the PvP leaderboard.
2. **Unranked skirmish queue** — a free 1v1 practice queue with no rating change that reuses the arena's dodge and Qi rules, so a new Sword Cultivator can drill dodge-roll timing against a live Talisman Master before ladder play.
3. **Arena round timer with sudden-death Qi drain** — matches cap at 90 seconds, after which both players' Qi pools drain at 5/s to force a decisive clash, preventing a Frost Seal + Wind Step kite from stalling forever.
4. **Ranked tiers named after merit titles** — ladder tiers reuse the existing title system (e.g. Initiate, Wandering Cultivator, Peak Master) from `data.ts`, so rank progress is shown through the worn-title field rather than a new UI.
5. **Arena map variants from valley landmarks** — rotate the arena floor between the lotus pond ring, the bamboo grove, and the shrine approach as procedural layouts, so ranked play gets variety without new zone art.
6. **Ranked placement matches** — the first 5 matches calibrate a player's rating with larger swings before it stabilizes, mirroring how the XP curve front-loads early levels up to the level-20 cap.
7. **Queue from anywhere in the valley** — players can queue for arena while farming mobs and are teleported to the ring on accept, reusing the spawn-at-plaza relocation path so PvP does not interrupt the open-world loop.
8. **Match-outcome chat lines** — post-match results arrive as `chat` events with `sys:true` (`Victory: +18 rating`) in the same format as existing daily-claim lines, keeping PvP messaging consistent with the rest of the protocol.
9. **Arena leaver penalty** — disconnecting mid-match grants the opponent the win and docks rating plus a coin fine from the leaver's wallet, so a rage-quit cannot rob a Sword Cultivator of a scored win.
10. **Warmup ring spectate seeds** — queued fighters stand in a highlighted ink-outline ring near the paifang before the match, which later becomes the entry point for the full spectator mode.
11. **Rating line in the player frame** — show a small gold (#c9a227) rating number under the jade Qi bar, with a hatched pattern cue so colour-assist users read rank without relying on colour alone.
12. **PvP balance multiplier table** — a dedicated per-skill PvP damage/heal multiplier table in `content.ts` so arena numbers can be tuned for player targets without touching the 27-mob PvE balance.

13. **3v3 battleground, "Bridge of Mist"** — capture the stone bridge over the lotus pond where Jade Serpents also spawn and attack both teams, converting existing mob AI into a live third-party pressure on the objective.
14. **5v5 battleground, "Bamboo Grove Skirmish"** — a point-control map in the bamboo grove where Bamboo Spirit packs aggro onto whichever team holds the node, making the existing mob leash a battleground momentum mechanic.
15. **Payload battleground, "Relic Cart"** — escort a slow guardian-core cart from the spawn plaza to the ruined shrine while Stone Hound adds try to stop it, reusing the Stone Guardian's line/beam telegraph language as defender hazards.
16. **Battleground Qi orbs** — jade Qi pickups scattered on the map grant 25 Qi on pickup, rewarding map control and letting a Physician sustain a push past the base 10/s regen.
17. **Battleground respawn waves** — deaths respawn in a 10-second wave at the team's side of the map, reusing the "You return to the plaza, renewed." wording as a PvP respawn cue instead of instant individual respawns.
18. **Objective-progress chat format** — node control and cart progress are reported in the same `[N/4]` two-objective line style as quest progress, so the battleground HUD and chat stay visually consistent.
19. **Battleground stat normalization** — all fighters enter with normalized gear and the same 100-point Qi pool so a level 5 and a level 20 compete fairly, closing the cap gap without a new gearing track.
20. **Daily battleground task on Fen's board** — add a "Win a battleground" entry to the `DAILY_POOL` paying coin/jade/XP like the other dailies, so PvP plugs into the existing daily-board economy.
21. **Battleground map vote** — the pre-match screen lets players choose between the bridge and grove maps with a 3-choice panel matching the daily-task UI, giving the queue a lightweight tactical pick.
22. **Comeback mechanic, "Ink Tide"** — when a team trails by two nodes, a slow mist wave lowers the leading team's visibility range, reusing the depth-fog system as a tactical comeback lever instead of rubber-banding the score.
23. **Battleground MVP toast** — the top objective scorer earns a post-match title via the existing `toast` kind "title", feeding the merit/title system without a new reward type.
24. **Physician cross-team heal rules** — Spring Rain heals only teammates in battlegrounds, but Purifying Light can also cleanse an enemy's burn/poison DoT as a niche counter, giving the healer a genuine PvP decision.

25. **`/duel` command** — a 1v1 challenge within 16 units opens a consent prompt, using the same command routing as `/talk` and validating the range server-side before any hit lands.
26. **Duel ring boundary** — the duel draws a 20-unit vermilion (#c8372d) ink circle on the ground and leaving it forfeits, so a Talisman Master cannot kite a Sword Cultivator out of reach forever.
27. **Duel coin wager** — both sides may stake coin from their wallets before the duel, settled to the winner through the existing `wallet` sync message, so duels carry optional stakes without a new currency.
28. **Duel spectator ring** — nearby players become non-interactive spectators with a mist-dimmed screen during a duel, the direct precursor to the full spectator mode.
29. **Duel pause on mob aggro** — a duel is paused or cancelled if a Stone Hound or Fox Spirit aggros either fighter, so open-world duels near mob packs stay fair instead of turning into accidental 2v1s.
30. **Duel fatigue cooldown** — a player can only duel the same opponent once per 2 minutes, preventing spawn-camp duels at the plaza and protecting fresh players from repeated challenges.
31. **Duel result broadcast** — a `chat` System line like "X defeated Y in a duel." broadcasts to the nearby area, consistent with the existing System-line conventions.
32. **No-stakes duel history** — a "no stakes" duel flag skips rating but still records win/loss history shown in the merit progress panel, so casual sparring leaves a trace.
33. **Duels in the boss arena** — allow duels on the Stone Guardian arena floor after the boss is dead, reusing its already-telegraphed floor as a neutral PvP stage with clear sightlines.

34. **Opt-in open PvP, "Mist Frontier"** — mark the north mist line of Cloudmist Valley as an opt-in open-PvP area where Old Whisker roams, making contested rare hunting a real risk-reward choice.
35. **PvP flag warmup** — entering the frontier applies a 5-second "drawing your weapon" ink-outline pulse before you can attack or be attacked, giving colour-assist and reduce-motion users a clear non-flash cue.
36. **Safe plaza sanctuary** — the spawn plaza, paifang, and notice board remain sanctuaries where the PvP flag drops automatically, protecting new players and daily-board traffic from frontier ganking.
37. **Frontier kill bounty** — killing a flagged player drops a fraction of their coin to the killer via the existing wallet path with a per-kill cap, so it reads as a bounty, not a mugging.
38. **Frontier drop bonus** — mobs inside the frontier drop +25% coin and jade, reusing the existing drop tables so the risk of being jumped is balanced by better loot.
39. **Notoriety counter** — repeated frontier kills stack a "Wanted" merit-style flag shown as a vermilion seal in the player frame, making repeat gankers visible and targetable by everyone in the zone.
40. **Frontier respawn shrine** — dying in the frontier respawns at a shrine inside the frontier, not the plaza, keeping PvP deaths localized instead of dumping players back near Fen.
41. **Level-banded frontier** — the frontier warns or refuses entry outside a ±4 level band, reusing the kill-XP level-delta window so a level 20 cannot farm level 5s.
42. **Frontier atlas entry** — first entry into the frontier unlocks a place in the atlas (POI kind), tying the PvP zone into the existing exploration and discoverable-places system.
43. **Fog stealth in the frontier** — inside the frontier, standing still within heavy fog layers hides your nameplate until you move, rewarding ambush play with the existing layered-fog renderer.

44. **Two sects, "Vermilion Sect" vs "Jade Sect"** — a faction choice at Elder Lin (vermilion #c8372d vs jade #4fa58b) that tints the player's seal and title, giving PvP a persistent allegiance without a second zone.
45. **Faction war score, "Merit of the Sect"** — weekly faction war effort accrues sect points for kills and node flips, stored in the existing `node:sqlite` database and reported with the daily-progress message style.
46. **Faction war battleground, "Shrine Siege"** — a 10v10 fight over the ruined shrine where the Stone Guardian arena becomes a capturable keep, reusing its cone/line/beam telegraph language as defender traps.
47. **Faction supply caravans** — AI-piloted supply carts (reusing mob pathing) travel between plaza and shrine and can be raided by the rival sect for jade, creating open-world faction content.
48. **Faction ranks mirror merit seals** — sect rank (Aspirant, Disciple, Elder) maps onto the existing merit/title system, so war effort feeds the same progression UI as PvE achievements.
49. **Weekly faction rewards** — the winning sect's members receive a wallet payout and a cosmetic title distributed through the existing claim flow, matching the daily-board reward pattern.
50. **Faction war schedule** — the war runs in 90-minute windows on a UTC schedule announced through the `chat` System-line format, so players in any timezone can plan around it.
51. **Faction balance lock** — when one sect outnumbers the other beyond a threshold, Elder Lin nudges new players toward the smaller sect, preventing a one-sided steamroll.
52. **Faction war anti-grief** — kills against players more than 5 levels below you grant no sect points and flag the attacker, reusing the level-delta rule from kill XP.
53. **Faction banner object** — a procedural banner (pole + cloth primitive) marks captured nodes, tinted vermilion or jade, reusing the palette tokens and the no-external-assets procedural model rule.

54. **PvP currency, "Sect Coins"** — a separate wallet field earned from arena, battlegrounds, and war, spendable at a PvP vendor, keeping PvP rewards from inflating the existing coin/jade economy.
55. **PvP gear set across all 6 slots** — a dedicated PvP set (one piece per slot) whose stats favor survivability (HP, dodge cooldown reduction), so PvP gearing does not force players through the 10 PvE recipes.
56. **PvP gear in the 4 rarity tiers** — Sect Coins buy gear across the existing common/uncommon/rare/epic tiers, so the rarity pips and labels reuse the current UI verbatim.
57. **Dodge-cooldown reduction affix** — a PvP-only affix trims the 1.5s dodge cooldown (the PvP-defining skill) but never below a server-enforced floor, so dodging stays fair.
58. **Qi-regeneration or dodge-cost affix** — PvP gear can raise Qi regen above 10/s or lower the 15-Qi dodge cost, tuning the resource game specifically for player-vs-player fights.
59. **PvP gear stat ceiling** — total PvP gear stats are clamped so a full PvP set equals a full PvE set in raw power and only redistributes stats, avoiding mandatory PvP farming for PvE progression.
60. **Seasonal PvP rewards** — each season grants a unique cosmetic title and a recolored ink-brush icon based on the final rating tier, reusing the title and toast systems.
61. **PvP ink-tint transmog** — PvP achievements unlock palette-tinted (vermilion/gold) versions of existing gear models, cosmetic only, so wins are shown off without power creep.
62. **Loss consolation payout** — every ranked loss still grants a small Sect Coin amount, so a losing streak still progresses toward gear instead of bricking the queue economy.

63. **Arena rating leaderboard** — a top-100 scroll-panel leaderboard reachable from the paifang, stored in sqlite and rendered like the daily-board list, showing name, class, and rating.
64. **Class-filtered leaderboards** — separate boards for Sword Cultivator, Talisman Master, and Physician so a healer is not ranked against melee burst on the same ladder.
65. **Win-streak "hot streak" flag** — a current win streak is shown with a gold flame pictogram beside the player's name, using the gold #c9a227 accent and a pattern cue for colour-assist users.
66. **Weekly objective leaderboard** — track battleground node captures and cart escorts per week, so a support Physician can top a board without ever winning a duel.
67. **Faction war contribution leaderboard** — ranks players by sect points earned, feeding the merit/title rewards and giving healers credit through assist scoring.
68. **Leaderboard snapshot caching** — the server caches top-100 results in sqlite and refreshes on a timer instead of recomputing per request, respecting the 20Hz-tick cost discipline.
69. **Top-rank titles** — the top 3 per class per season earn a permanent "Peak" title, reusing the worn-title field shown under the player's name.
70. **Hide-my-rating privacy flag** — a setting lets a player hide their own rating from others (but not from the server's matchmaker), respecting privacy and accessibility preferences.

71. **Server-authoritative PvP movement validation** — since the server already owns position, PvP rejects out-of-range skill casts and overlong dodge-roll distances using the same PvE validation, tightened for PvP.
72. **Rate-limit dodge and skill messages** — cap dodge/skill messages per tick to reject burst-spam macros that bypass the 1.5s dodge cooldown and skill cooldowns, where such cheats matter most.
73. **Qi-delta sanity check** — verify each cast's Qi cost against the server's authoritative pool so a client claiming to cast Heaven-Splitting Strike for 0 Qi is refused, mirroring the existing cast-without-enough-Qi refusals.
74. **Teleport/distance anomaly detection** — flag position deltas beyond the 6-unit dodge plus movement speed per tick as impossible and rubber-band the player, protecting the arena and the frontier.
75. **PvP kill-switch** — a cheater detected in PvP is auto-flagged and removed from rated queues for the season, with a System chat line noting the action in the existing refusal-message style.
76. **Server-side match replay hash** — store a lightweight log of PvP match inputs in sqlite for post-hoc review, so disputes are checked against the authoritative record rather than a client report.

77. **Arena spectate toggle** — any player can watch a ranked match from the warmup ring with a mist-dimmed, non-interactive camera, reusing the depth-fog render and toggling off for colour-assist clarity.
78. **Spectator camera presets** — a follow cam on each combatant plus a top-down overhead view cycle with a hotkey, so observers can read both players' Qi bars and dodge windows.
79. **Spectator HUD overlay** — the spectator HUD shows both fighters' HP/Qi bars (vermilion/jade) and skill cooldown ticks in a paper-scroll panel, reusing the existing player-frame components.
80. **Battleground spectator fog-of-war** — in battlegrounds and faction war, spectators see team positions as pictogram icons at reduced detail rather than full models, preventing ghosting intel while still showing the score.
