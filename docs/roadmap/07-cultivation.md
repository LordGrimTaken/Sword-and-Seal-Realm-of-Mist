# Cultivation & Progression

1. **Map the level cap to a realm ladder** — Replace the bare 20-level cap with the classic xianxia ladder where levels 1–20 equal Qi Refining (9 stages plus a peak), so the existing cap reads as "Qi Refining Great Perfection" instead of a flat number.

2. **Show the current realm in the character sheet** — Render the active realm (e.g. "Qi Refining, 7th Stage") in jade ink on the paper-scroll character panel, with a vermilion seal stamp that visibly fills as a breakthrough approaches.

3. **Gate content by realm instead of level** — Make the Stone Guardian boss arena require "Qi Refining 9th Stage" rather than a level number, so realm terminology drives Elder Lin's quest chain and boss gating.

4. **Scale the Qi pool with realm stage** — Start the 100-point Qi pool at Qi Refining 1st stage and add +10 Qi per stage, so a 9th-stage cultivator holds 180 Qi and has more headroom for dodge rolls (15 Qi) and skill casts.

5. **Raise Qi regen at each realm breakthrough** — Bump the 10/s regen to 12/s at Foundation Establishment and higher at later realms, so higher-realm builds can sustain longer skill rotations before the pool empties.

6. **Define Foundation Establishment as levels 21–40** — Add Foundation Establishment as the next 20-level band with its own stat curve, unlocked only after the first breakthrough tribulation is survived.

7. **Define Core Formation as levels 41–60** — Add Core Formation as a third band unlocked by a Core Formation tribulation, raising the cap to 60 with realm-tier stat growth.

8. **Define Nascent Soul as levels 61–80** — Add Nascent Soul as a capstone band unlocked by a Nascent Soul tribulation, raising the cap to 80 and rendering the realm name in gold ink on the nameplate.

9. **Cap the ladder at a transcendent realm** — End the ladder at a Spirit Severing / Ascension band spanning levels 81–100 so prestige has a clear, reachable ceiling rather than an infinite climb.

10. **Show realm tier on mob nameplates** — Render each mob's realm tier (e.g. "Foundation Establishment") under its name in ink-soft, so a player can tell at a glance whether a Bamboo Spirit pack outranks them.

11. **Add a breakthrough ritual at each realm peak** — When a player hits the top stage of a realm, replace normal XP gain with a "Breakthrough" quest from Elder Lin that demands crafted pills and boss drops as materials.

12. **Add a lightning tribulation minigame** — Trigger a solo tribulation arena that reuses the Stone Guardian telegraph system, dropping telegraphed lightning bolts the player must dodge-roll through to survive.

13. **Make tribulation failure non-lethal but costly** — On failure, consume the breakthrough materials but keep the player alive, returning them to the prior stage with a short cooldown, and keep the effect photosensitive-safe (no strobing flashes).

14. **Scale tribulation bolt count with realm** — Use 3 bolts for Qi Refining → Foundation, 5 for Foundation → Core, and 7 for Core → Nascent, so each successive tribulation is mechanically harder, not just numerically.

15. **Reward each breakthrough with a realm passive** — Grant a permanent passive on success (e.g. Foundation grants +20 max Qi, Core Formation grants +5% skill damage) so breakthroughs feel transformative.

16. **Post tribulation materials on the Notice Board** — Let Notice Board Fen offer an "Impending Tribulation" daily that rewards breakthrough materials, giving solo players a farm path for the ritual.

17. **Render tribulation clouds as a zone weather event** — During a tribulation, tint Cloudmist Valley's depth fog with jade and vermilion and darken the mist so other players see a breakthrough is in progress.

18. **Phase the tribulation arena into a private instance** — Isolate the player during a breakthrough so roaming Stone Hound packs cannot wander in and interrupt the ritual.

19. **Record breakthroughs in the atlas** — Add a "Tribulations Survived" entry to the discoverable atlas so each character's breakthrough history is tracked and visible.

20. **Add a colour-assist and reduced-motion tribulation mode** — Provide a variant where bolts are slow, linear, and high-contrast (per the accessibility priority) so the ritual is playable by photosensitive players.

21. **Add one talent tree per class** — Give Sword Cultivator, Talisman Master, and Physician each a 20-node tree whose nodes modify their existing 4 skills rather than adding generic stats.

22. **Add Sword Cultivator melee talents** — Nodes like "Blade Echo: your slash leaves an ink trail that strikes a second time" directly modify the class's existing melee skills.

23. **Add Talisman Master ranged talents** — Nodes like "Lingering Talisman: projectiles stick and detonate for 30% splash" extend the class's existing ranged skills.

24. **Add Physician healing talents** — Nodes like "Overflowing Qi: your heal refunds a small amount of Qi" modify the class's existing heal kit.

25. **Add a shared utility tree** — Include a fourth tree with dodge-roll and Qi-management nodes (e.g. reduce dodge cost from 15 to 12 Qi) available to every class.

26. **Grant talent points on level-up and breakthrough** — Award 1 point per level plus a 3-point bonus per successful breakthrough, giving players a sink for both progression systems.

27. **Respec talents for coin at the shop** — Let players reset a tree at the shop for a scaling coin fee, keeping jade as the premium wallet currency for storage and cosmetics.

28. **Lock high-tier talents behind realm** — Require Foundation Establishment for tier-3 nodes so talent depth tracks the realm ladder instead of being level-only.

29. **Preview talent effects with brush pictograms** — Render each node as a hand-drawn vector brush pictogram with a tooltip showing the exact numeric delta before spending a point.

30. **Persist talent loadouts in the JSON snapshot** — Extend the authoritative full-state snapshot to carry the talent loadout so headless tests can verify build integrity deterministically.

31. **Add reincarnation as prestige at the cap** — At level 80 (Nascent Soul peak), allow a voluntary reincarnation that resets level while keeping the realm ladder progress unlocked.

32. **Grant a prestige merit seal per reincarnation** — Award an account-bound merit seal showing the reincarnation count, tying prestige directly into the existing merit seal system.

33. **Add prestige-only passive perks** — Reward each reincarnation with a small permanent multiplier (e.g. +2% all damage) so rebirths compound into meaningful power.

34. **Keep gear but level-gate it on rebirth** — Move equipped gear into the 30-slot bag and level-gate it on reincarnation so prestige never deletes crafted items.

35. **Accelerate re-leveling with a rebirth XP bonus** — Give reincarnated characters +25% XP per prestige tier to shorten the re-climb through the realm ladder.

36. **Unlock a prestige ink style** — Reward reincarnation with an exclusive ink-wash outline color (a faint gold rim) applied to the procedural character model.

37. **Add a prestige leaderboard to the Notice Board** — Let Notice Board Fen display the top reincarnated cultivators by prestige tier, giving prestige a visible social signal.

38. **Tie prestige to the daily board** — Add a daily board entry "Walk the Path Again" that grants bonus XP to reincarnated characters completing Elder Lin quests.

39. **Raise the cap in realm bands, not all at once** — Ship the cap increase as staged content: unlock Foundation (to 40), then Core (to 60), then Nascent (to 80), each behind its own tribulation.

40. **Add Elder and Ancestor mob variants** — Recolor ink outlines and raise stats on existing mobs (e.g. Ancestor Bamboo Spirit, Elder Jade Serpent) instead of modeling new creatures, covering the raised cap with the existing 27-mob roster.

41. **Add realm-tier loot tables to existing mobs** — Make higher-realm mob variants drop higher-rarity gear from the 4-rarity system so the cap raise feeds the crafting and shop economy.

42. **Extend crafting recipes beyond 10** — Add realm-gated recipes (e.g. a Foundation-tier pill) so Artisan Tao's vendor stock grows with the raised cap.

43. **Raise bag slots with realm** — Award +5 bag slots at each breakthrough so higher-realm players can carry the additional realm-tier materials.

44. **Continue Elder Lin's chain past the cap** — Extend the 4-step quest chain into Foundation and Core arcs so the cap raise has story continuity with the existing NPC.

45. **Add a realm-gated daily board** — Post realm-specific dailies (e.g. "Hunt the Ancestor Serpent") that appear only for Foundation+ characters.

46. **Make merit seals equippable with stat effects** — Convert passive merit seals from cosmetic to small stat-granting items (e.g. +2% Qi regen) so they feed progression.

47. **Add a merit-seal slot in the character sheet** — Render a dedicated seal slot framed by the vermilion seal-corner motif, showing the equipped seal's buff at a glance.

48. **Tie seals to discoverable places** — Grant a merit seal when a player discovers every place in the Cloudmist Valley atlas, linking seals to exploration progress.

49. **Add realm-appropriate titles** — Add titles like "Survivor of the First Tribulation" and "Slayer of Old Whisker" that display in the paper-scroll nameplate.

50. **Gate title display behind realm** — Show realm-tier titles (e.g. "Core Elder") only after the corresponding breakthrough, so titles reflect genuine progression.

51. **Add a seal collection ledger** — Track obtained seals and titles in a lacquered ledger panel, replacing the flat list with a collectible view organized by source.

52. **Reward seals for boss first-kills** — Grant a unique merit seal for the first Stone Guardian clear, feeding the seal system with boss milestones.

53. **Add per-skill mastery ranks** — Track usage of each of the 12 skills (4 per class) and grant mastery ranks 1–5 that increase that skill's effect.

54. **Reward mastery for skill-specific feats** — Give Sword Cultivator mastery XP for landing melee hits, Physician mastery for effective healing, and Talisman Master mastery for projectile hits.

55. **Show mastery as an ink-brush progress bar** — Render a hand-drawn ink stroke that fills as a skill approaches its next mastery rank, matching the ink-wash aesthetic.

56. **Add a visual flourish at max mastery** — At mastery rank 5, add a subtle vermilion accent to the skill's effect (e.g. a red-tinged talisman trail) so mastery is visible in combat.

57. **Reduce Qi cost at mastery milestones** — At rank 3, reduce the mastered skill's Qi cost by 10%, giving a concrete rotation benefit tied to the Qi pool.

58. **Persist mastery in the JSON snapshot** — Include per-skill mastery in the full-state snapshot so headless tests can verify rank-ups deterministically.

59. **Add a mastery capstone passive per skill** — At rank 5, unlock a small passive (e.g. dodge roll grants 5 Qi) themed to that skill's class.

60. **Add a passive perks panel separate from talents** — Give players a smaller passive perk set unlocked by realm breakthroughs, distinct from talent tree nodes.

61. **Add a dodge-roll passive perk** — A perk that reduces dodge roll cooldown from 1.5s to 1.2s, directly modifying the existing movement tool.

62. **Add a Qi regen passive perk** — A perk that raises Qi regen from 10/s to 11/s, compounding with realm-based regen growth.

63. **Add a loot passive perk** — A perk that raises the rare-drop chance against the 27 mobs by a small flat amount.

64. **Add a movement passive perk** — A perk granting +10% out-of-combat move speed in Cloudmist Valley, useful for reaching discoverable places faster.

65. **Add a crafting passive perk** — A perk that reduces material cost for the 10 existing recipes by one ingredient.

66. **Gate passive perk slots by realm** — Start with 1 slot and add a slot at each breakthrough, so perk loadouts scale with the realm ladder.

67. **Make perks swappable for free at rest** — Allow perk swapping at spawn (near 0,-80) or a rest point so builds can adapt before boss attempts without a fee.

68. **Add an account-shared wallet** — Share the coin/jade wallet across characters on one account so alts benefit from a main's economy.

69. **Add account-wide atlas completion** — Share discovered places and atlas progress across characters so exploration is not repeated per alt.

70. **Make merit seals and titles account-bound** — Carry merit seals and titles across characters so prestige and boss first-kill seals persist account-wide.

71. **Add a shared account stash** — Provide a small account stash for transferring gear between characters, distinct from the per-character 30-slot bag.

72. **Make the prestige tier account-wide** — Apply the reincarnation bonus to all characters on the account, not just the one that rebirthed.

73. **Add account-wide talent templates** — Let players save a talent loadout as an account template and apply it instantly to a new character.

74. **Add an account progression ledger** — Track total account achievements (tribulations, bosses, places) in a single ledger panel separate from per-character data.

75. **Gate account features behind an unlock quest** — Introduce account-wide systems via a short Elder Lin side quest so they feel earned rather than handed out.

76. **Keep the JSON snapshot account-scoped** — Extend the authoritative server snapshot to include account-level state so multi-character progression is testable headless.

77. **Make the daily board account-wide** — Let daily board progress count across characters so alts can contribute to a shared daily pool.

78. **Unify realm, mastery, perks, and seals in one summary** — Add a single paper-scroll "Cultivation" tab that summarizes realm, mastery ranks, equipped perks, and merit seals in one view.

79. **Gate the Stone Guardian by realm, not gear score** — Require "Qi Refining 9th Stage" to enter the boss arena so the realm ladder, not item level, is the primary gating metric.

80. **Add a realm-appropriate death penalty** — Make death during a breakthrough tribulation return the player to spawn (0,-80) with a short realm-stability debuff rather than item loss, keeping the loop forgiving and non-punitive.
