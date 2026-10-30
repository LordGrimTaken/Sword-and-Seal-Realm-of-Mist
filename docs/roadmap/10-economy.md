# Economy & Trading

1. **Coin-only auction board in the Elder Lin quarter** — Place a paper-scroll auction board beside the existing shop so Cloudmist Valley's first gear market is priced in coin while jade is kept out of equipment pricing and reserved for premium sinks.
2. **Jade-only vanity auction tab** — A second tab accepts only jade for titles, atlas pages, and place-name banners, giving the jade wallet its own market without contaminating the coin economy that gear and recipes flow through.
3. **Rarity-scaled listing fee** — Charge an auction listing fee that climbs through the 4 rarities so flooding the board with common drops from the 27 mobs is discouraged and rare/epic listings stay scarce enough to matter.
4. **Ten-percent buyout tax as a coin sink** — A flat 10% buyout tax is burned server-side on every sale, draining the coin faucet fed by mob drops and the daily board so total coin in circulation trends down between content updates.
5. **Bid and buyout hybrid orders** — Each auction order carries both a minimum bid and an optional buyout so a Paper-scroll listing can move instantly or run an open auction, mirroring how the Stone Guardian's telegraphed windows reward both patience and decisive reads.
6. **Single-zone shared board in node:sqlite** — Because the server is one zone on one process, store every auction order in node:sqlite and broadcast state changes over the existing WebSocket JSON tick so all clients see one consistent board with no extra service.
7. **Sale price history panel** — Show the last ten completed sales per item with the seller's place-name hidden, giving crafters a real price signal instead of guessing what the 10 recipes actually sell for.
8. **Class-filtered gear search** — Let the auction filter by Sword Cultivator, Talisman Master, and Physician so a healer is not paging through melee scabbards while hunting a herb satchel.
9. **Six-slot gear filter** — Add an auction filter for each of the 6 gear slots so buyers can jump straight to the exact slot rather than scrolling a merged equipment list.
10. **Level-band filter up to the level 20 cap** — A 1-20 banded filter keeps level-appropriate gear findable so a fresh character is not buried under late-game epic listings.
11. **Twenty-four-hour relist cycle** — Listings expire after 24 hours and return to the seller's 30-slot bag, creating a re-listing cadence that recycles dead orders instead of letting the board accumulate stale junk.
12. **Face-to-face trade window** — Open a two-pane trade window between any two players in Cloudmist Valley so quest items from Elder Lin's chain or side-quest rewards can be handed over without routing through the auction board.
13. **Double-lock trade confirmation** — Require both players to lock their offered items and then confirm the locked state, so neither side can swap an item after the other has committed.
14. **Trade distance requirement** — Require both players to stand within a short range of each other in the 200x200 zone so trading has a physical meeting point instead of a menu reachable from anywhere.
15. **Trade blocked in combat** — Cancel any open trade window the moment either player takes or deals damage, preventing a mid-fight window from being used to dump inventory during a mob pull.
16. **Trade blocked during Stone Guardian enrage** — Refuse new trade requests while the Stone Guardian is in its enrage phase, keeping the boss arena a pure fight instead of a market during the hardest telegraphed windows.
17. **Item-for-item barter without coin** — Allow direct item-for-item trades with no coin field, so two crafters can swap the rare Old Whisker drop for a Jade Serpent scale without minting any new coin.
18. **Explicit coin split fields** — Give both sides of the trade window a coin entry box with a running total so uneven trades settle the difference in coin cleanly and legibly.
19. **Trade log persisted in node:sqlite** — Append every completed trade to the same sqlite database the server already uses, so a disputed swap can be audited later instead of vanishing with the WebSocket frame.
20. **Level 5 trade unlock** — Gate player-to-player trading behind level 5 so brand-new accounts cannot be used as mules to move the level 1 quest rewards around.
21. **Right-click trade request** — Invoke a trade from a right-click context menu on another player's ink-wash silhouette, with an accept/decline paper-scroll prompt so initiating a trade is an explicit act.
22. **Spawn-side marketplace stalls** — Reserve a stall plaza near the 0,-80 spawn so returning players find a visible row of player shops without scattering stalls across the fog.
23. **Stall rent as a recurring coin sink** — Charge a daily coin rent for each stall so an idle shop costs its owner something, pulling coin out of the economy while the owner is offline.
24. **Six-slot stall capacity** — Limit each stall to 6 sale slots rather than the full 30-slot bag so one player cannot front-run the whole auction board with a personal storefront.
25. **Offline stall persistence** — Persist stall inventory and prices in node:sqlite so a stall keeps selling while its owner is logged out, matching the single-process always-on server model.
26. **Ink-brush stall sign** — Let owners write a short stall name rendered in the paper-and-ink UI, keeping shop labels legible without any hanzi and in the ink-wash palette.
27. **Paper-scroll stall UI with ARIA and focus rings** — Build the stall browse panel on the same scroll texture with full ARIA labels, high-contrast text, and visible focus rings so the accessibility priority carries into the market.
28. **Stall browse and search** — Add a search field over all active stalls so a buyer can locate a specific crafted recipe output instead of walking each stall by hand.
29. **Per-sale stall tax** — Burn a small percentage of each stall sale as a tax that differs from the auction buyout tax, giving two distinct sinks for two distinct venues.
30. **Designated stall zone only** — Restrict stall placement to the marketplace plaza so the 200x200 zone keeps its layered-mountain vistas and mob paths clear of shop clutter.
31. **Durability repair at the blacksmith** — Introduce gear durability that decays through deaths and Stone Guardian attempts, so repair at the existing shop becomes a steady coin sink tied to how hard the player pushes content.
32. **Rarity-scaled repair cost** — Price repairs by rarity so an epic drop costs meaningfully more to maintain than a common one, making rarity a long-term cost decision rather than a free upgrade.
33. **Fast-travel shrine inside Cloudmist Valley** — Add a coin-per-use shrine that jumps between named sub-locations within the single zone, creating a convenience sink that never leaves the one-zone process model.
34. **Respec for skill points** — Sell a respec that refunds allocated skill points at a coin cost rising with level, letting a player reroll from a Talisman Master build without a free reroll loop.
35. **Dodge-and-Qi respec tier** — Offer a separate respec for the dodge roll (15 Qi, 1.5s cooldown) and the 100-point Qi pool choices, priced in jade or heavy coin so mobility and resource talents are not freely swapped mid-fight.
36. **Bag expansion beyond 30 slots** — Sell extra bag slots in coin at an escalating per-slot price so the 30-slot cap becomes a progression target that drains coin as players hoard more.
37. **Storage chest rental** — Rent a bank chest at the spawn plaza for coin, giving players a place to park atlas pages and seasonal mats without letting the bag grow for free.
38. **Paid rename and title recolor** — Charge coin or jade to rename a character or recolor an earned title, converting vanity into a sink without affecting combat balance.
39. **Gear dye in the ink-and-vermilion palette** — Sell one-time dyes drawn from the ink, paper, vermilion, jade, gold, and mist palette so cosmetic recoloring becomes a repeat coin sink on the procedural gear.
40. **Atlas page reprint sink** — Charge coin to reprint a lost or sold atlas page so the atlas completion loop can correct mistakes while still costing something.
41. **Recipe cost balancing across the 10 recipes** — Tune each of the 10 recipes so their material inputs roughly equal the coin value of their outputs, keeping crafting from being a free mint or a guaranteed loss.
42. **Drop-rate-to-price correlation for the 27 mobs** — Price mob materials inversely to their drop rate so the common Bamboo Spirit scraps stay cheap while the rare Old Whisker drop commands a premium.
43. **Old Whisker material premium** — Give the rare Old Whisker a unique high-value drop that anchors the top end of the market and gives the rare spawn a real economic reason to be hunted.
44. **Stone Guardian drop pricing** — Price the boss's telegraphed-slam rewards above anything farmable from trash mobs so clearing the 3-phase enrage fight is the best coin-per-hour path.
45. **Qi potion pricing against the 10/s regen** — Price consumable Qi potions so a burst potion is worth buying over the free 10/s regen only in tight rotations, preventing potions from trivializing the Qi pool design.
46. **Class-demand weighting** — Track demand per class and nudge vendor buybacks and auction defaults so Physician herb mats and Sword Cultivator scabbards price differently under real demand.
47. **Vendor buyback floor** — Give the shop a minimum buyback price for every item so a vendor is always a valid exit and no drop is worth strictly zero coin.
48. **Crafted-versus-dropped price floor** — Set a crafted item's floor above its material cost so crafting never undercuts raw material sales into a loss, preserving the crafting loop's incentive.
49. **Vendor price anchors** — Publish fixed vendor anchor prices for consumables and basic gear so players have a baseline against which to judge auction listings instead of a purely free-floating market.
50. **Weekly price audit via sqlite query** — Run a weekly query over the sale log in node:sqlite to flag items that drifted far from their material cost, giving the server operator a concrete rebalance signal.
51. **Level-gated pricing up to the cap** — Anchor gear value to its required level so a level 20 epic cannot be dumped to a level 5 buyer at a price that breaks early progression.
52. **Mob-material salvage loop** — Let players salvage unneeded gear back into the raw mob materials the 10 recipes consume, so dead drops re-enter the crafting economy instead of rotting in the 30-slot bag.
53. **Recipe mastery that lowers costs** — Add a crafting mastery bar that slightly reduces material cost or increases success quality per recipe, giving repeat crafters an economic edge without new content.
54. **Material node respawn in the 200x200 zone** — Place harvest nodes for the crafting materials on a respawn timer across Cloudmist Valley so gathering has a geography and a throughput the market can price.
55. **Jade Serpent scale as a crafted ingredient** — Make the Jade Serpent drop a scale used across several recipes so a specific mob stays in demand and its parts hold value.
56. **Talisman Master consumable talisman crafting** — Let a Talisman Master craft single-use talismans that let ranged skills fire without Qi, creating a consumable market that only one class can supply.
57. **Physician bandage and herb crafting** — Let a Physician craft bandages and herbs that boost heal-over-time ticks, so the healer becomes a supplier of in-demand consumables rather than a passive buyer.
58. **Crafted durability bonus** — Give crafted gear a durability edge over identical dropped gear so the crafting loop offers a reason to buy crafted over farmed, tying into the repair sink.
59. **Quality roll on craft results** — Allow a crafted item to roll a higher quality band within its rarity, giving repeat crafts a gambling element that drives demand for materials.
60. **Crafting failure and material return** — Make a failed craft return a portion of its materials so the loop never deletes value outright, keeping prices stable instead of spiking on bad rolls.
61. **Mob-scaled material drop table** — Tune material drop tables across all 27 mobs so no single spawn is both the fastest coin farm and the best material farm, spreading players across the zone.
62. **Seasonal event currency** — Introduce a limited seasonal currency earned only during a festival window, spent on exclusive gear and titles so the seasonal economy has its own self-contained supply.
63. **Limited-time seasonal vanity** — Sell seasonal ink-wash vanities that retire when the event ends, creating scarcity that drives jade or event-currency spending without inflating the base coin pool.
64. **Festival ink material** — Add a seasonal gathering material used in temporary recipes so the seasonal loop touches the 10-recipe crafting system rather than sitting beside it.
65. **Seasonal daily board variation** — Rotate the daily board to feature seasonal objectives during the event, shifting daily coin rewards toward seasonal currency and pulling demand off the permanent market.
66. **Seasonal atlas page rewards** — Tie one atlas page to a seasonal event so the atlas stays a multi-season goal and returning players have a timed reason to complete it.
67. **Seasonal price swing window** — Let seasonal materials spike during the event and crash after it ends, giving traders a real timing decision instead of a flat market.
68. **Seasonal title and merit seal** — Award a seasonal merit seal or title for event participation so the seasonal economy pays out in prestige that later feeds the vanity sinks.
69. **Seasonal catch-up vendor** — Offer a post-event vendor that sells missed seasonal rewards at a steep jade premium, converting fear-of-missing-out into a sink while keeping content attainable.
70. **Coin cap per character** — Cap the coin a single character can hold so no player can hoard past a ceiling and unbalance a future auction or vendor, pushing excess into sinks.
71. **Bound-versus-tradeable item flag** — Mark quest rewards and merit-seal items as bound to the character so the tradable pool stays limited to farmed and crafted goods.
72. **Diminishing returns on repeat mob kills** — Reduce coin and material yield when the same mob type is farmed repeatedly in a window, curbing bot-style farming inflation without nerfing normal play.
73. **Daily-board coin faucet cap** — Keep the daily board's coin reward fixed and non-scaling so the primary faucet stays predictable and the auction tax sink can outpace it over time.
74. **Auction tax escalation on relist** — Raise the listing fee slightly on rapid relisting of the same item so cancel-and-relist spam cannot dodge the sink and re-enter the board for free.
75. **Trade-session coin audit** — Record coin totals before and after each trade in the sqlite log so any coin dupe or negative-balance bug can be traced to a specific session.
76. **Vendor restock rotation** — Rotate a subset of shop stock on a timer so vendor-bought goods cannot be endlessly resold for profit against a static price list.
77. **Jade-to-coin one-way conversion** — Allow jade to convert into coin but never the reverse, so premium currency can backstop a coin-poor player without letting coin be laundered into premium.
78. **Jade cosmetic-only guarantee** — Keep jade purchasable only for cosmetics, vanity, and the vanity auction tab, protecting the coin economy from pay-to-win pressure on gear.
79. **Instant relist jade sink** — Let players pay a small jade fee to relist an expired auction instantly instead of waiting out the 24-hour cycle, turning impatience into a premium sink.
80. **Gourd and pouch vanity sink** — Sell cosmetic gourds, brush-holders, and satchels that overlay the class off-hands in jade, so the visible gear slots have a pure-vanity spend that never touches combat stats.
