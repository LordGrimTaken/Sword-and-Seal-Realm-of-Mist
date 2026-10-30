# Housing & Customization

1. **Carve a cave abode into the Cloudmist Valley cliff face** — Place the player home at a fixed entrance near the 0,-80 spawn so returning players stash gear and trophies inside the single existing zone without adding a second map. The arch reads as a procedural ink-wash rock cut, half-swallowed by the heavy depth fog and layered mountain silhouettes.

2. **Open the abode as a client-rendered interior, not a server zone** — Because there is no server-side collision, the room draws as a toon-and-ink outlined interior where furniture is placed locally, so decoration never depends on authoritative physics. The 20Hz tick and JSON full-state snapshots stay untouched.

3. **Persist the whole home as one compact JSON row in node:sqlite** — Furniture positions, unlocked themes, and farm timers serialize into a single row per player, mirroring the existing full-state snapshot shape and avoiding extra tables. Load it with the same player record the wallet and merit seals already ride on.

4. **Seed the first home key through Elder Lin's chain** — Elder Lin grants the cave deed after his 4-step chain so housing is discovered through a quest rather than a menu, teaching the player the door before the decoration system. This reuses the established chain instead of inventing a new tutorial.

5. **Give each class a flavored home entry pose** — Sword Cultivator sheathes the blade on the door lintel, Talisman Master pins a paper charm over the arch, and Physician hangs a herb bundle, so the same door customizes by class without new assets. The props use the existing procedural model style.

6. **Offer a sect hall floor plan as the level-20 housing upgrade** — At the lv20 cap the player expands the cave into a small sect hall with an open training courtyard, capping the progression loop that starts in the abode. It keeps a single interior so the one-zone single-process design holds.

7. **Show the sect hall as an exterior shrine marker on the atlas** — The upgraded hall renders a vermilion-and-gold shrine marker on the atlas so passers-by can see where a player lives, tying housing to the discoverable-places system. No second zone is needed.

8. **Add a mist-diffused skylight to the abode ceiling** — A procedural paper-shaded opening washes the room in the mist color (#8fa3ad) so interiors share the valley's fog palette rather than a flat dungeon gray. It doubles as a readable light source for high-contrast players.

9. **Keep the abode's entrance footprint inside the existing 200x200 grid** — The home door sits at a fixed cell near spawn and its interior is a separate client scene, so no new zone coordinates or navmesh are required. This respects the single-zone limitation while still feeling like a distinct place.

10. **Add a home-return seal usable anywhere in Cloudmist Valley** — A consumable seal returns the player to their cave entrance on a short channel, giving the 200x200 valley a soft fast-travel anchor without a second map. It spends one bag slot in the 30-slot inventory.

11. **Make the abode double as a logout resting spot** — Logging out inside the home banks a small rested Qi-regen bonus on next login, encouraging players to end sessions in their cave. It threads the 10/s regen into a housing reward.

12. **Lock the cave behind a jade-and-coin deed purchase in the shop** — The shop sells the deed for a wallet split of coin and jade so both currencies gain a housing sink beyond gear recipes. Returning the deed to the abode door unlocks placement.

13. **Place furniture by dragging into a paper-scroll grid, not free space** — Furniture snaps to a visible grid overlaid on the toon-shaded floor so placement is legible and consistent without server collision. The grid uses the ink (#1a1a1f) outline against the paper (#f2ead8) floor.

14. **Render furniture from the same procedural model system as mobs and gear** — Tables, scroll stands, and incense burners are built from the procedural ink-wash mesh library so the art team adds no hand-modeled decor. They inherit the toon-and-ink outline for a coherent look.

15. **Add a paper-scroll furniture catalog with vector pictogram icons** — Each decor item gets a vector pictogram in the paper-scroll UI, matching the existing icon language and staying sharp at any resolution. Colour-assist mode recolors the pictograms to jade and vermilion without losing meaning.

16. **Tier furniture by the 4 gear rarities as a visual language** — Common furniture is bare ink, rare adds jade trim, epic adds vermilion, legendary adds gold filigree, reusing the 4-rarity vocabulary players already read on gear. No new rarity system is introduced.

17. **Craft furniture through the existing 10 recipes** — Extend the crafting bench so several of the 10 recipes produce decor instead of gear, keeping the recipe economy shared. Artisan Tao stocks the furniture recipes as a side-quest vendor.

18. **Let the Talisman Master craft paper-lantern light sources** — A class-flavored decor lets Talisman Masters make lanterns whose glow tints mist or vermilion, giving the ranged class a housing identity. The light stays within the photosensitive-safe brightness cap.

19. **Add a vermilion seal wall that displays earned merit titles** — A wall scroll shows the player's titles as ink-and-vermilion seal stamps, converting the merit/title system into a visible room trophy. It teaches the title UI through the home.

20. **Mount discovered atlas places as a calligraphy map on the wall** — Each atlas place the player discovers inscribes a new brush stroke on a wall map, so exploration visibly fills the home. The map stays English-only with pictogram markers.

21. **Add a Qi-focus meditation cushion as functional decor** — Sitting on the cushion grants a small idle regen on top of the 10/s rate, giving a gameplay reason to place furniture. It ties the core Qi pool into the room.

22. **Add a storage chest that expands beyond the 30 bag slots** — A decor chest adds a home-only stash so players can bank crafting mats and trophies beyond the 30-slot inventory, a natural housing reward. The stash persists in the home JSON row.

23. **Support reduce-motion still variants for animated furniture** — Incense smoke, lantern flicker, and candle glow get "still" toggles so reduce-motion and photosensitive-safe players can decorate without animated light. Flutter is cosmetic only, never required.

24. **Make every furniture interaction keyboard and focus-ring accessible** — Placement and pickup follow full keyboard navigation with visible focus rings on the paper-scroll UI, and ARIA labels announce item names to screen readers. This matches the existing accessibility-first priority.

25. **Add a courtyard rock garden that reshuffles procedurally** — A sand-and-stone garden recomposes its procedural rocks on each visit, giving a living decor element from the same mesh system. It stays still under reduce-motion.

26. **Add jade-and-gold floor sconces as a wallet sink** — Premium lighting fixtures priced in jade give the wallet a cosmetic sink beyond consumables and shop gear. Their glow respects the mist and vermilion palette.

27. **Add a cliffside farming plot outside the cave entrance** — A small terrace near the home grows herb seeds planted from the 10-recipe crafting materials, tying farming to the existing herb economy the Physician's satchel already uses. No new zone is required.

28. **Run farm growth on server wall-clock, not the 20Hz tick** — Plot timers advance on real time persisted in the node:sqlite row, so growth survives offline play without tick load. Harvest checks run on login, matching the snapshot-based state.

29. **Grow Fox Spirit and Bamboo Spirit reagents** — Plantable nodes yield reagents tied to specific mob drops, so farming complements hunting the 27-mob roster instead of replacing it. Each plot names its mob source in English.

30. **Give the Physician a class farming perk** — The healer's herb satchel doubles harvest yield, making farming a natural Physician role and giving the class an identity outside combat. Other classes plant normally.

31. **Add a Lotus Toad pond plot for slow, high-value crops** — A small pond grows lotus reagents over a longer timer for higher returns, mirroring the Lotus Toad's patient recovery theme. It diversifies plot types beyond soil.

32. **Gate a rare plot unlock behind the daily board** — Completing daily board tasks can award a one-time fertile-plot unlock, weaving farming into the daily loop. The plot holds a rare seed that feeds high-tier recipes.

33. **Add a Jade Serpent trellis that grows a Qi-restoring herb** — Harvesting the trellis grants a temporary boost to the 10/s Qi regen for a short buff, linking the farm to the core resource pool. It rewards tending with combat value.

34. **Make Stone Hound dung a fertilizer drop** — Stone Hound kills occasionally drop fertilizer that shortens farm timers, giving a mob a farming purpose and reusing an existing mob rather than adding one. The fertilizer is a bag item in the 30-slot inventory.

35. **Add a harvest minigame that respects reduce-motion** — A simple tap-timing harvest produces bonus yield, with a "still" auto-harvest toggle for reduce-motion players so no one is forced into twitch input. Accessibility parity is preserved.

36. **Show plot states as paper-scroll pictogram badges** — Ready, growing, and withered states render as distinct vector pictograms on each plot card, legible to colour-assist users without relying on hue alone. High-contrast mode thickens the outline.

37. **Mount the Stone Guardian's core as a centerpiece trophy** — Defeating the boss in its third phase grants a drop that mounts on a plinth in the home, commemorating the slams and telegraphs the player learned. It is the marquee trophy of the housing system.

38. **Hang a head trophy from the rare Old Whisker** — Finding and slaying the rare Old Whisker awards a rare mount, making the rarest mob hunt a housing flex. It sits at rare tier in the 4-rarity trophy display.

39. **Compile each of the 27 mobs into a bestiary wall** — Each distinct mob adds a small ink seal to a bestiary scroll, turning the full 27-mob roster into a collectible room display. It reuses the atlas-style progress the player already understands.

40. **Make Stone Guardian trophies phase-aware** — A trophy records which phase you survived and which telegraph type you dodged, then displays a subtle vermilion mark, so the trophy remembers the fight specifics rather than a flat "slain" label.

41. **Add a dodge-master trophy tied to the 15-Qi roll** — A trophy unlocks for dodging a Stone Guardian cone, line, and beam telegraph within one fight using the 1.5s-cooldown dodge, rewarding mastery of the core mobility tool. It is earned, not bought.

42. **Gate trophy mounting behind merit seals** — Higher-tier mounts require a corresponding merit seal, so the merit/title system gates trophy display and gives seals a housing use. It links progression to decoration.

43. **Add a trophy lighting mode for photosensitive-safe players** — Trophies glow by default but offer a "still" non-pulsing display so boss cores do not strobe, honoring the photosensitive-safe priority. Brightness stays within the capped range.

44. **Let trophies grant a small rested-Qi aura in the home** — Displayed boss trophies confer a modest Qi regen while inside the abode, making trophies functional as well as decorative. It threads the 10/s regen into housing rewards.

45. **Add a Stone Hound and Fox Spirit pair-plinth for small mobs** — Common mobs like Stone Hound and Fox Spirit share a small plinth so low-tier hunts still earn a shelf spot, keeping the trophy wall accessible before the boss. The plinth uses the paper-and-ink base.

46. **Show trophy rarity with the 4-rarity seal colors** — Common, rare, epic, and legendary trophies render their seals in matching rarity ink so the tier is read at a glance, consistent with gear rarity. No new color language is introduced.

47. **Default the abode to private with an invite seal** — Visitors can only enter with an issued seal, so players control who sees their home; the seal is an inventory item in the 30-slot bag. No accounts/passwords system is needed, keeping it out of scope.

48. **Grant visitor passes as wallet coin items** — A player buys a visitor pass with coin from the shop and hands it to another player in-world, giving the wallet a social sink without a trade system. It reuses the existing shop.

49. **Support a "sect hall open door" toggle for the level-20 upgrade** — The upgraded sect hall can be set open so any player may enter the training courtyard, fitting the communal hall theme. The abode itself stays invite-only by default.

50. **Let visitors place only on a marked guest shelf** — Visitors can leave a single item on a designated guest shelf but cannot move the owner's furniture, protecting the owner's layout without full permission modeling. It is a simple two-tier permission.

51. **Log visitor names as English calligraphy in a guest scroll** — Each visit inscribes a name on a guest scroll, so the owner sees who stopped by, presented in English with pictogram markers. It builds a social record without friend lists.

52. **Add a "quiet" mode that hides the home from the atlas marker** — Players can hide their shrine marker so their home is not broadcast on the discoverable-places map, giving privacy control over visibility. It is a single toggle in the door UI.

53. **Allow removing a visitor from the door panel** — The owner can remove a guest from the home with a focus-ring-accessible button, keeping control in the player's hands. The action persists only in the live session, not the snapshot.

54. **Make visitor entry a 20Hz-safe teleport into the client interior** — Entering a home repositions the client to the private interior scene without moving server-side physics, since there is no server collision. The server only records who is present in the JSON row.

55. **Extend Elder Lin's chain with a "found the cave" epilogue** — After the 4-step chain, Elder Lin points the player to the cave and rewards the deed, folding housing into the main NPC arc instead of a separate intro. It reuses the existing chain beat.

56. **Give Artisan Tao a furniture apprenticeship side quest** — Artisan Tao teaches the first furniture recipe and rewards a starter table, making the craftsman NPC the housing mentor. It sits beside his existing side quest.

57. **Give Peddler Hao a jade-furniture delivery quest** — Hao asks the player to deliver a jade lamp to a home, spending jade and rewarding a rare decor, tying the wallet to housing. It reuses Hao's merchant persona.

58. **Give Warden Wu a home-defense quest** — Wu tasks the player with placing a warding scroll at the cave door to deter a Stone Hound incursion, linking combat to housing. The reward is a reusable door charm.

59. **Give Mei a garden quest for the farming plot** — Mei asks the player to grow a specific herb, introducing farming through the NPC rather than a menu. It seeds the farming loop with a narrative reason.

60. **Give Fen a guest-scroll quest** — Fen tasks the player with inviting another player to visit, teaching visitor permissions socially. The reward is an ornate guest shelf.

61. **Add a repeatable daily "tidy the sect hall" task on the board** — The daily board adds a housing task that rewards coin for placing or rearranging furniture, keeping the room active in the daily loop. It is a low-friction habit quest.

62. **Add a Stone Guardian trophy quest for the first mount** — After the boss dies, a follow-up asks the player to mount the core and rewards a trophy plinth, teaching the trophy system through the fight. It completes the boss-to-trophy arc.

63. **Add a quest that unlocks the level-20 sect hall expansion** — A quest at the lv20 cap sends the player to gather materials for the hall upgrade, gating the expansion behind play rather than a menu button. It caps the housing progression line.

64. **Make housing quest rewards span the 4 rarities of decor** — Each housing quest line awards common through legendary decor, so the quest chain doubles as a rarity tutorial for furniture. It mirrors how gear teaches rarity.

65. **Ship an "Ink and Vermilion" default theme** — The abode defaults to the signature palette (ink walls, paper floor, vermilion trim, jade accents, gold fixtures, mist light) so every home starts on-brand. It is the zero-cost baseline.

66. **Add a "Lotus Pond" theme with jade and mist tones** — A jade-heavy theme replaces vermilion accents with jade and mist, letting players restyle the room to a calmer palette. It reuses the existing palette colors in different ratios.

67. **Add a "Vermilion Dawn" theme with high-contrast options** — A bolder theme with stronger vermilion and ink contrast, plus an explicit high-contrast toggle that thickens outlines. It serves players who need greater legibility.

68. **Add a "Stone Guardian" boss theme with grey rock tones** — A theme earned from the boss uses stone-and-ink tones with subtle telegraphed-glow accents, commemorating the fight in the decor. It unlocks alongside the trophy.

69. **Make themes swap with a single palette recolor, not new models** — Themes recolor the procedural furniture library rather than adding new meshes, keeping asset scope small and the one-zone budget intact. It is a color-set swap in the JSON row.

70. **Add a reduce-motion "still world" theme** — A theme that disables all idle animation (smoke, flicker, water) for reduce-motion and photosensitive-safe players, presented as a cosmetic choice rather than a penalty. It is one toggle with full coverage.

71. **Add an atlas-themed wall scroll for explorers** — A theme that renders the discoverable-places map across the room's walls, so exploration progress becomes the room's art. It ties the atlas into housing decor.

72. **Sell themes in the shop for jade** — Premium themes are a jade purchase in the existing shop, giving the wallet a recurring cosmetic sink beyond one-time gear. Coin themes stay available for budget players.

73. **Preview themes in a paper-scroll "before you buy" pane** — The shop and door UI show a live toon-shaded preview of the room under each theme, so players see the recolor before spending jade. The preview honors reduce-motion settings.

74. **Tie one theme to a daily board completion streak** — A streak-based theme unlocks after consecutive daily board clears, rewarding consistent play with a cosmetic. It gives the daily loop a housing payoff.

75. **Frame the "shared hall" as a sect hall, since guilds are out of scope** — Before real guilds exist, a shared sect hall lets a group of players pool into one communal home keyed to a founder's deed, giving the guild-hall fantasy without the guild system. It stays within current scope.

76. **Let the level-20 sect hall bind a small number of resident players** — The upgraded hall can bind a handful of residents who share the space and its stash, approximating a guild hall with the existing single-process world. Residents are recorded in the shared JSON row.

77. **Add a shared trophy wall for group boss kills** — The sect hall displays a combined Stone Guardian trophy that records every resident present at the kill, making group content legible in the hall. It reuses the phase-aware trophy data.

78. **Add a communal farming plot with per-resident tend rights** — The hall's shared plot lets any resident water and harvest, but a simple "last harvester" ledger prevents double-spending, avoiding full trade logic. It is a lightweight shared resource.

79. **Use the wallet to pool a hall upgrade fund** — Residents can each deposit coin toward a shared hall upgrade, a cooperative sink that reuses the wallet without a trading system. A simple deposit ledger lives in the JSON row.

80. **Keep the shared hall single-zone and single-process** — The hall is another client-rendered interior reachable from the valley, so no second zone or second process is added, respecting the known single-zone/process limitation. It is scope-safe by design.
