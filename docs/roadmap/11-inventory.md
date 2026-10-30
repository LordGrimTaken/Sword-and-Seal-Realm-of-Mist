# Inventory & Storage

1. **Elder Lin's Scroll Vault** — A paper-scroll-styled bank near Elder Lin in Cloudmist Valley that holds overflow from the 30-slot bag, giving players a coin-gated storage surface separate from the combat inventory.

2. **Coin-Cost Vault Tabs** — Each vault tab costs increasing coin from the wallet, so storage expansion feeds the existing coin economy instead of adding a new currency.

3. **Jade-Locked Vault Tier** — A premium vault tier bought with jade from the wallet offers deep storage for collectors while keeping coin tabs affordable for new players.

4. **Quest-Item Vault Section** — A no-cost section of the vault reserved for Elder Lin and Wu/Tao/Hao/Mei/Fen quest tokens so those items never crowd the 30 combat bag slots mid-quest.

5. **Vault Access via Atlas** — The vault is reachable from the atlas map (places), letting players bank between Cloudmist Valley farm loops without walking back to spawn near 0,-80.

6. **Per-Item-Type Vault Grouping** — The vault auto-groups the 6 gear slots, materials for the 10 recipes, and consumables into scroll-style sections labelled with vector pictogram icons.

7. **Vault History Ledger** — A node:sqlite-backed ledger of the last 50 deposit/withdraw actions, undoable within the session, to recover from a mis-click without a server rollback.

8. **Rarity Highlight in Vault** — Stored gear rows are marked by the four rarity tiers using ink-outline rank symbols plus colour, so the colour-assist accessibility option still distinguishes tiers.

9. **Bank at Respawn** — The vault is available at the respawn area so a player who died to Stone Guardian can re-gear without an extra run back to Elder Lin.

10. **Vault Capacity Meter** — A capacity meter shows slots used/total in ink on paper with a vermilion warning near full, so players know before their next Bamboo Spirit grind.

11. **Atlas-Linked Material Codex** — The existing atlas extends into a material codex recording which of the 27 mobs drops what, so farmers can target Bamboo Spirit versus Jade Serpent.

12. **Boss Trophy Codex Entry** — Defeating Stone Guardian through all three phases including enrage unlocks a codex page with the slam/cone/line/beam telegraph diagrams as a reference scroll.

13. **Rare Mob Codex Page** — Old Whisker gets a dedicated codex page tracking encounters and kills, since a rare spawn warrants its own collection log.

14. **Recipe Discovery Ledger** — The 10 recipes appear as locked ink outlines in the codex until crafted once, giving crafters a completion goal tied to the crafting system.

15. **Per-Class Gear Set Collection** — A collection view groups the 6 gear slots per class (Sword Cultivator, Talisman Master, Physician) to track full-rarity sets for each.

16. **Codex Progress Merit Seals** — Completing codex categories awards merit seals and titles, wiring item collections into the existing merit/title system.

17. **Mob Kill-Count Ledger** — A kill-count codex across all 27 mobs pairs naturally with the daily board's hunt quests and gives collectors a numeric completion target.

18. **Codex Search by Drop Source** — Search codex entries by mob or recipe so a player hunting "Jade Serpent" finds every item that creature drops.

19. **Sort by Rarity with Pattern Assist** — Sort gear by the four rarity tiers using ink-outline rank symbols alongside colour, so sorting stays legible under the colour-assist option.

20. **Sort by Gear Slot Order** — One-tap sort arranges items by the 6 gear slots in order, so players see at a glance which slot lacks an upgrade.

21. **Class-Compatibility Filter** — A class filter (Sword Cultivator, Talisman Master, Physician) hides gear the current class can't equip, reducing clutter in the 30-slot bag.

22. **Mob Drop-Origin Filter** — Filter items by their source mob (Bamboo Spirit, Fox Spirit, Stone Hound, Lotus Toad, Jade Serpent, Old Whisker) for targeted farming checklists.

23. **Quest-Relevance Filter** — Highlight or filter items tied to Elder Lin or the Wu/Tao/Hao/Mei/Fen side quests so quest items surface above vendor trash.

24. **Sort by Sell Value** — Sort inventory by shop sell value (coin and jade) so quick-sell decisions are one glance instead of per-item math.

25. **Persistent Sort Preference** — Save the last sort/filter choice in node:sqlite so the paper-scroll inventory reopens the same way each login.

26. **Filter Chips for Rarity/Slot/Type** — Toggleable ink-outline filter chips (rarity, gear slot, consumable, quest) stack on the bag view so players combine filters without typing.

27. **Per-Class Gear Loadout** — Save a full 6-slot loadout per class so switching among Sword Cultivator, Talisman Master, and Physician is one tap instead of six drags.

28. **Stone Guardian Boss Loadout** — A dedicated loadout slot biased toward dodge-relevant stats, since the dodge roll (15 Qi, 1.5s cooldown) is central to surviving the boss's telegraphed attacks.

29. **Qi-Sustain Loadout Preset** — A preset favouring Qi regen gear to keep the 100-point Qi pool topped up for dodge rolls and skill spam during the enrage phase.

30. **Loadout Diff Against Current** — Equipping a loadout shows a per-slot diff against current gear with ink/vermilion gain-loss arrows across the 6 slots.

31. **Loadout Integrity Check** — Warn when a saved loadout references a piece that was sold or salvaged so a one-tap swap never leaves broken slots.

32. **Named Loadout Scrolls** — Let players name loadouts ("Boss", "Farm", "Healer") shown on paper-scroll tabs with pictogram icons for quick recognition.

33. **Loadout-Locked Items Skip Junk** — Items pinned in a loadout are immune to quick-sell/junk, preventing the "sold my best rarity sword" mistake.

34. **Mark-as-Junk Toggle** — A single junk flag on any item lets players tag Bamboo Spirit trash while farming, then bulk-clear it at the shop later.

35. **Junk-Safe Rarity Gate** — Quick-sell/junk is disabled by default above a rarity threshold (the gold-tinted top tier), so a rare Old Whisker drop can't be one-tapped away.

36. **Mob-Trash Quick-Sell Filter** — One button sells every junk-marked item whose source is a common mob (Bamboo/Fox Spirit, Stone Hound) while keeping quest and codex items.

37. **Sell Preview with Coin/Jade Total** — The quick-sell confirmation shows the exact coin total and any jade-valued items before committing the batch.

38. **Undo Last Quick-Sell (Buyback)** — A shop buyback tab holds the last quick-sold batch at the same price for 60 seconds, recovering from a mis-click.

39. **Auto-Junk Pickup Rules** — User-defined rules auto-flag drops as junk (e.g., "lowest rarity, non-quest") so the bag stays clean during mob grinding.

40. **Daily Board Trash Turn-In** — Junk-marked items can be turned in for a small merit seal credit, tying disposal into the daily board loop.

41. **Consumable Stack Cap Display** — Show "x / max" on stacks of Qi potions and mist herbs so players know when a stack will spill into a second bag slot.

42. **Auto-Stack on Pickup** — New drops auto-merge into existing stacks in the 30-slot bag to avoid duplicate partial stacks of the same material.

43. **Stack Split with Count Slider** — A slider splits stacks for multi-recipe crafting or for depositing exact counts into the vault.

44. **Recipe-Ingredient Stack Badge** — Materials for the 10 recipes show a "craftable count" badge computed from current stacks, so crafters see readiness at a glance.

45. **Boss Drop No-Auto-Merge** — Stone Guardian and Old Whisker drops never silently merge, so rarity and stat variance stays visible per item rather than per stack.

46. **Full-Stack Vault Move** — One action moves an entire stack between bag and vault, respecting the paper-scroll drag affordance without partial-transfer friction.

47. **Stack Counts in Snapshot** — The JSON full-state snapshot transmits stack counts as itemId plus count rather than one entry per unit, keeping the 20Hz tick payload lean.

48. **Elder Lin Reward Mail** — Completed Elder Lin chain and Wu/Tao/Hao/Mei/Fen rewards that exceed the 30-slot bag arrive by mail instead of being lost.

49. **Boss Loot Mail on Full Bag** — If the bag is full when Stone Guardian dies, the loot is mailed rather than dropped, protecting high-value boss drops.

50. **Paper-Scroll Mail Styling** — The inbox uses the paper #f2ead8 scroll aesthetic with ink #1a1a1f text and vermilion unread markers, matching the UI palette.

51. **Coin/Jade Attachment Safety** — Mail attachments of coin or jade are claimed into the wallet explicitly, never auto-credited, to avoid accidental claims.

52. **Mail Expiry Ledger** — Mail expires after a set window with a visible countdown, and expired attachments are logged so nothing vanishes silently.

53. **Merit Seal Reward Mail** — Merit seals and title grants arrive by mail, giving a tangible inbox record of achievements instead of a silent flag flip.

54. **NPC Quest-Giver Mail** — Wu, Tao, Hao, Mei, and Fen send in-character follow-up mail after their quests, reinforcing the English-only NPC voices.

55. **Account-Wide Shared Stash** — A small shared stash (fewer slots than the vault) transfers gear and materials between a player's classes under the single-process server's one-account context.

56. **Class-Tagged Shared Gear** — Items in the shared stash show which class (Sword Cultivator, Talisman Master, Physician) can equip them via pictogram badges.

57. **Shared Crafting Material Stash** — Deposit recipe materials for the 10 recipes into the shared stash so a Talisman Master crafter and a Physician healer share one stock.

58. **Shared Stash Withdraw Log** — node:sqlite logs shared-stash withdrawals with timestamp and character, keeping transfers auditable in a multiplayer world.

59. **Shared Stash Slot Locking** — Lock specific shared-stash slots to prevent accidental withdrawal of a kept quest item or a rare drop.

60. **Vault vs Shared Stash Toggle** — A single UI toggle switches between personal vault and shared stash so players never confuse the two storage surfaces.

61. **Shared Stash in Snapshot** — Shared-stash contents are included in the JSON full-state snapshot so any client sees current shared inventory without extra requests.

62. **Inventory Search by Item Name** — A search box filters the 30-slot bag by item name substring, using high-contrast focus rings and ARIA labels for accessibility.

63. **Search by Rarity Token** — Typing a rarity keyword (including the gold colour word) filters by the four rarity tiers, isolating the rarest drops instantly.

64. **Search by Mob Source** — Typing a mob name such as "Jade Serpent" or "Old Whisker" returns all drops from that mob, backed by the codex's drop-source data.

65. **Search by Recipe Ingredient** — Searching a recipe name surfaces its required materials in the bag, so crafters check readiness for any of the 10 recipes.

66. **Search Empty-State Guidance** — A "no matches" state suggests nearby terms and offers a one-tap clear, avoiding dead-end paper-scroll screens.

67. **Keyboard-First Search Navigation** — Arrow-key navigation through search results with a visible focus ring satisfies the keyboard accessibility priority.

68. **Bulk Move to Vault** — Multi-select items and move them bag-to-vault in one action, essential for a 30-slot bag filling with Bamboo Spirit drops.

69. **Bulk Junk + Sell** — Select a range, mark all junk, and sell in one flow at the shop with a single coin-total confirmation.

70. **Bulk Deposit Materials** — One tap deposits all crafting materials for the 10 recipes into the vault, keeping only combat consumables in the bag.

71. **Bulk Withdraw by Recipe** — Withdraw exactly the materials for a chosen recipe from the vault in one action, streamlining crafting resupply.

72. **Bulk Duplicate Pruning** — Highlight duplicate items and sell all but the best per slot and rarity, reducing 30-slot bloat during long farming sessions.

73. **Bulk Action Undo Window** — A short undo window for any bulk move or sell, consistent with the single-item buyback safety net.

74. **Coin-Priced Bag Expansion** — Expand the base 30-slot bag in coin increments from the wallet, the natural first coin sink for new Cloudmist Valley players.

75. **Jade-Priced Bag Tiers** — Larger bag tiers cost jade, giving premium wallet spending a storage outlet without introducing a new currency.

76. **Quest-Gated Bag Slots** — Completing Elder Lin milestones or the Wu/Tao/Hao/Mei/Fen side quests grants small bag-slot bonuses as progression rewards.

77. **Scroll-Row Bag Visual** — The bag renders as expandable paper-scroll rows so each purchased upgrade visibly adds a row, reinforcing the scroll UI metaphor.

78. **90% Full Vermilion Warning** — A vermilion edge-glow at 90% capacity warns before a Stone Guardian kill so loot isn't lost mid-fight.

79. **Bag Size Persisted in node:sqlite** — Purchased bag size persists in node:sqlite and is included in the full-state snapshot so upgrades survive reconnects.

80. **Bag Expansion Cost Curve** — Each additional slot costs more coin, balancing the 30-slot baseline against unlimited hoarding.
