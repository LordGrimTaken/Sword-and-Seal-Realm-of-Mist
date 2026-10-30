# Social & Multiplayer

1. **Party frames with Qi readout** — Add a paper-scroll party panel showing each member's class pictogram, vermilion HP bar, jade Qi bar, level, and worn title (the existing `EntityState.ttl`), so a Physician can see who needs Spring Rain without re-targeting.
2. **Party leader ping on the round minimap** — Let the leader click the ink-wash minimap disc to drop a jade ping that renders as a small gold seal on all members' maps, so a group can point at the ruined shrine or a Fox Spirit hill.
3. **Group XP and loot credit shares** — Extend the Stone Guardian kill-credit logic so party members within the zone receive the shared 2000 XP and jade split, instead of only the player who lands the final hit.
4. **Class role tags in the party panel** — Show Sword Cultivator as melee, Talisman Master as ranged, and Physician as healer via the existing `cls` field, using vector pictograms rather than letters per the icon rules.
5. **Party dodge-cooldown indicators** — Surface each member's dodge readiness (reuse the per-recipient `dcd` seconds field) as a seal that fills over the 1.5s cooldown, so the group can coordinate rolls out of a Stone Guardian beam.
6. **Leave/join party ink-fade transitions** — When a member disconnects or joins, slide them in/out of the scroll panel with an ink-fade rather than a hard swap, while still honoring the reduce-motion setting.
7. **Party invite via whisper target** — Add an `/invite <name>` chat command that sends an in-chat accept/decline line, mirroring the existing `/talk` and `/quest` slash-command pattern.
8. **Party heal/dodge callouts** — Emit a jade "Healed!" or vermilion "Dodged!" line in Party chat when Spring Rain lands or an i-frame negates a hit, reinforcing the existing `dodged` event for the whole group.
9. **Sect founding with a vermilion seal** — Let a lv10+ player found a sect by naming it and stamping a custom seal chosen from the vermilion/gold/jade motifs, stored server-side like the existing titles.
10. **Sect roster grouped by class** — Show a sect's roster grouped by Sword Cultivator / Talisman Master / Physician pictograms so officers can see healer availability before organizing a Stone Guardian run.
11. **Sect merit ledger** — Track member contributions (mob kills, daily board claims, boss assists) as a paper ledger that feeds the same merit points already shown in the `prog` message.
12. **Sect ranks tied to merit seals** — Map sect rank (Initiate, Disciple, Elder) to merit thresholds so advancement reuses the existing merit seals/titles system instead of a parallel progression track.
13. **Sect-only chat channel** — Add a chat tab that filters `chat` events to sect members, alongside the existing All / Chat / System tabs in the bottom-left scroll panel.
14. **Sect hall marker on the world map** — Place a sect gathering point in Cloudmist Valley that appears as a gold seal POI in the fog-of-war world map after founding, so members have a fixed meeting spot near the plaza.
15. **Sect daily board bonus** — Grant a small coin/jade bonus to sect members who complete the shared daily board together, tying into Fen's existing board and `wallet` messages.
16. **Sect auto-promotion on inactivity** — Auto-promote the longest-serving active member when a sect has no online officer for a set period, so a dead leadership never blocks a Stone Guardian group from forming.
17. **Friends list with online status** — Maintain a friends list that shows each friend's presence in Cloudmist Valley and last-seen time, reusing the server's connection state.
18. **Friend nameplate jade accent** — Render friends' nameplates with a jade accent and allies with a subtle paper highlight, keeping vermilion for danger so colour-assist still differentiates by shape.
19. **Ignore list that filters chat server-side** — Store ignored names on the server and drop their `chat` events before they reach the client, so a blocked player's taunts never render in any channel.
20. **Friend join notification** — Emit a quiet gold system line "Friend <name> entered Cloudmist Valley" on login, so players can regroup at the spawn plaza without spamming whispers.
21. **Whisper `/tell` with autocomplete** — Add a `/tell` command with friend-name autocomplete in the chat input, following the existing slash-command pattern for `/talk` and `/quest`.
22. **Blocked-player client culling** — Make an ignored player's `EntityState` not render on screen or the minimap within INTEREST_RADIUS, so the ignore list works visually as well as in chat.
23. **Friend compass on the minimap** — Show a faint gold dot on the round minimap pointing toward a selected friend, helping players regroup for a shared world event without opening the full map.
24. **Social list export** — Fold friends/ignore into a social settings list that can be exported/imported alongside the existing settings export, so players can move it between the Electron launcher and the browser client.
25. **LFG flag with role and level** — Let a player set an "LFG" status carrying their `cls` and level, shown as a seal on the nameplate so others can invite the right role for a Stone Guardian attempt.
26. **LFG board beside the notice board** — Add an LFG board near Fen's stand listing players who want a group, grouped by class pictogram and level band (lv1-5 grind, lv6-8 boss).
27. **Boss LFG quick-join** — A one-click "Join Stone Guardian group" that assembles one Sword Cultivator, one Talisman Master, and one Physician when all three roles are looking.
28. **LFG auto-clear on join** — Auto-remove a player's LFG flag when they join a full party, so stale "looking" seals don't litter the valley after a group forms.
29. **LFG filter by content** — Let players filter LFG by Bamboo/Fox grind, pond cleanse (Jade Serpent), or Stone Guardian, matching the existing quest titles exactly.
30. **LFG rate-limit guard** — Rate-limit LFG flag toggling so a player can't flick it every tick and spam the `chat` feed, mirroring the daily board's claim-race guards.
31. **LFG leader handoff** — Allow an LFG-assembled group to transfer leader, so a Physician who formed the group can pass it to the Sword Cultivator tank before the boss pull.
32. **LFG ready check** — Add a party "Ready?" prompt that pings each member with a confirm seal, so the group confirms dodge rolls and Qi bars before the Stone Guardian enrage phase.
33. **Chat tabs for All/Chat/Party/System** — Extend the existing All / Chat / System tabs with Party and Sect tabs, each filtering `chat` events server-side to reduce JSON noise on the snap stream.
34. **Ink-brush emote strokes** — Add procedural brush-stroke emotes (bow, meditate, cheer) rendered above the player and tied to an `/emote` command, keeping the ink-wash aesthetic with no text glyphs.
35. **Emote wheel on a lacquered holder** — Provide a radial emote wheel styled as a seal-holder, keyboard- and focus-ring-reachable per the accessibility rules.
36. **Chat profanity and length guards** — Enforce the existing 120-char trim plus a profanity filter on `{t:"chat"}`, rejecting or cleaning text before it broadcasts to the zone.
37. **Chat fade and pin** — Let the chat panel fade toward transparent after idle and pin to stay visible, keeping ink-on-paper text legible without blocking the misty world view.
38. **ARIA live regions per channel** — Announce each channel's new messages via separate ARIA live regions so screen-reader users distinguish System (Elder Lin dialog) from Party coordination.
39. **Emote-on-target shortcuts** — Bind an emote to a clicked ally (a Physician bows before casting Spring Rain) so co-op gestures read as clear social signals without text.
40. **System boss callout channel** — Route the existing boss lines ("Stone Guardian's runes blaze crimson!") into a distinct System channel so they don't drown party coordination during the enrage.
41. **Mentor pairing across level gaps** — Let a lv15+ player mentor a lv1-8 player, awarding both a merit seal as the apprentice levels, reusing the existing merit-points pipeline.
42. **Apprentice XP catch-up** — Give the apprentice a small bonus multiplier on mob-kill XP while the mentor is online in the same zone, using the existing `xpPerLv` curve.
43. **Mentor waypoint to the shrine** — Let a mentor place a temporary waypoint on the apprentice's fog-of-war map so they can reach the Stone Guardian together without wandering the 200x200 zone.
44. **Mentor dodge-roll lesson** — Add a scripted lesson where the mentor demonstrates the dodge roll (15 Qi, 1.5s cd) and the apprentice must i-frame a Fox Spirit bite to advance.
45. **Class-specific mentor tips** — Serve rotating mentor tips keyed to the apprentice's `cls` (e.g., "Sword Cultivator: raise Qi Guard before Heaven-Splitting Strike") in the journal.
46. **Mentor/apprentice private channel** — Add a private mentor-apprentice chat scope so guidance doesn't flood the All channel, following the channel-tab pattern.
47. **Mentorship completion seal** — Award a "Master of the Valley" title when an apprentice reaches lv8 and clears the Stone Guardian under a mentor, feeding the existing titles/`prog` system.
48. **Mentor roster limits** — Cap active apprentices per mentor (e.g., 3) and mentors per apprentice to 1, preventing power-leveling abuse without anti-cheat infrastructure.
49. **Opt-in duel request** — Add a `/duel <name>` command that sends a consent dialog (never auto-accept), keeping PvP fully optional per the out-of-scope PvP note.
50. **Duel arena bounds in the plaza** — Confine duels to a small ring near the spawn plaza so a duel never drags Bamboo Spirits or Stone Hounds into a third party.
51. **Duel telegraphs reused** — Reuse the existing `telegraph` event shapes (circle/cone/line) for both players' skill casts in a duel, so the Stone Guardian's ground-warning UX carries over.
52. **Duel Qi and dodge parity** — Keep the 100-point Qi pool and dodge roll (15 Qi, 1.5s cd) identical in duels, making the duel a pure mirror of PvE combat.
53. **Duel outcome as a merit seal** — Record friendly duel wins/losses as a tracked stat and award a "Blade Dancer" merit seal at milestones, never touching wallet coin/jade.
54. **Duel spectator chat** — Let nearby players spectate a duel and post reactions to the System channel, with the duelists' nameplates tinted gold during the bout.
55. **Duel forfeit and stalemate cap** — Add a forfeit command and a time cap so a Physician-vs-Physician heal stalemate ends cleanly without draining both Qi pools forever.
56. **Duel kill-feed line** — Broadcast a short ink-styled line "A defeated B in a duel" to zone chat, reusing the `chat` event's `sys` flag like the existing boss lines.
57. **Role-aware group finder queue** — Match one Sword Cultivator, one Talisman Master, and one Physician for a Stone Guardian group, preferring players in matching level bands.
58. **Group finder reserve slot** — Reserve the fourth slot for a second Talisman Master or Physician based on demand, since the boss favors ranged and heals.
59. **Group finder gather prompt** — When the group is full, gather members at the shrine entrance via a shared "ready to descend" prompt, avoiding manual travel across the valley.
60. **Group finder backfill** — If a member drops mid-boss, ping the LFG board for a same-class replacement so the Stone Guardian's 3 phases don't reset solo.
61. **Group finder leave penalty** — Track mid-run leaves and lower that player's queue priority, a soft guard that needs no full anti-cheat system.
62. **Group finder role pins on the map** — Show queued roles as pictogram pins on the round minimap so a manually-formed party can see who else is looking nearby.
63. **Group finder suggested level range** — Recommend lv6-8 for Stone Guardian and lv1-5 for Bamboo/Fox grinding, mirroring the quest and mob level bands.
64. **Group finder chat handoff** — After a match, auto-join the Party channel and post a summary line with each member's class and level, so the team knows its composition instantly.
65. **Two-player combo shield-break** — Add a boss mechanic where a Sword Cultivator's Qi Guard and a Physician's Spring Rain overlap to crack a Stone Guardian shield phase, encouraging class pairing.
66. **Shared shrine cleanse event** — A co-op event where three players stand on three shrine seals simultaneously to cleanse the pond (mirroring Cleanse the Pond) for a group reward.
67. **Lantern-lighting co-op quest** — Extend Mei's Wicks for the Lanterns into a group version where multiple players light lanterns together for a larger coin reward.
68. **Boss enrage heal check** — In the Stone Guardian enrage, require coordinated Physician heals (Spring Rain plus Meridian Surge) to out-sustain the burn, making a healer essential rather than optional.
69. **Group dodge-sync checkpoint** — Add a co-op gauntlet where all members must dodge roll through a beam in the same tick window to advance, using the shared `dodge` event for VFX.
70. **Co-op loot table entry** — Give the Stone Guardian a co-op-only loot entry (an epic charm) that drops only when 2+ credited players are present, reusing the `loot` event.
71. **Shared merit for group clears** — Award every party member the same merit points for a boss clear, mirroring the existing "3 jade to each credited player" boss reward.
72. **Co-op daily board tasks** — Add daily tasks that count group kills ("Defeat the Stone Guardian in a party"), extending the DAILY_POOL with party-aware `have/need` counts.
73. **Old Whisker rare-spawn alert** — Broadcast a gold zone-wide line when the rare Old Whisker fox spawns, so players converge on its hill and share the kill credit.
74. **Mist-surge world event** — Periodically thicken the fog and spawn waves of Bamboo and Fox Spirits across the valley, scaling rewards to the participating player count.
75. **Stone Guardian world siege** — A scheduled event where the Stone Guardian leaves its shrine and marches toward the plaza, requiring zone-wide players to repel it before it reaches spawn.
76. **Lotus pond bloom event** — A time-limited event where the pond blooms and Lotus Toads surface with bonus drops, encouraging players to gather at the stone bridge.
77. **Event contribution tiers** — Score shared-world-event participation by damage/heals dealt (reusing `damage`/`heal` events) and grant tiered coin/jade/merit rewards at the end.
78. **Event leaderboard on the notice board** — Show a temporary top-contributor list at Fen's board during a world event, styled as a paper ledger with gold names for top scorers.
79. **Event telegraph broadcasts** — During a world event, broadcast boss-level cone/line/beam telegraphs to all participants via the existing `telegraph` event, so every player sees and dodges the shared danger.
80. **Event loot chest with shared claim** — End a world event with a communal reward chest at the plaza where each participant claims a scaled reward, using the `wallet` coin/jade messages and the 30-slot bag.
