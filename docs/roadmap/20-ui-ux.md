# UI, UX & Accessibility

1. **Split the Qi pool into segmented ink ticks** — Render the 100-point Qi bar with 10-point ink ticks so a player can read exactly how many dodge rolls (15 Qi each) they can still afford before the pool empties.

2. **Show dodge-roll readiness directly on the Qi bar** — Mark the 15-Qi threshold as a faint vermilion line and add a radial cooldown sweep over the roll key while the 1.5s cooldown is active, so the movement tool's cost and cooldown read at a glance.

3. **Add a per-ability Qi-cost preview to the hotbar** — Gray out a skill icon and stamp its Qi cost in paper ink when the pool cannot cover it, so a Sword Cultivator never queues a slash they cannot pay for.

4. **Render boss telegraph danger by phase tint** — Color the Stone Guardian's cone, line, and beam telegraphs in jade during phase 1, gold during phase 2, and vermilion during phase 3 and enrage, so telegraph severity is readable even before the slam lands.

5. **Add an enrage countdown banner** — Show a scrolling paper-scroll banner when the Stone Guardian enters enrage so players know the damage ramp is active, not a sudden invisible spike.

6. **Display a target frame with rarity trim** — Frame the currently targeted mob in the 4-rarity colors and mark Old Whisker with a gold "rare" seal so rare hunts and boss targets are distinguishable at a glance.

7. **Add a debuff and buff timeline strip** — List active status effects with remaining time as shrinking ink strokes under the Qi bar, covering Physician heals, poison-like dot effects, and Stone Guardian slow debuffs.

8. **Track the current quest in a compact HUD card** — Show Elder Lin's current chain step and the active side quest (Wu, Tao, Hao, Mei, or Fen) with its objective and distance to the turn-in NPC on a small paper-scroll card.

9. **Surface the coin/jade wallet on the HUD** — Pin the two-wallet balance (coin and jade) near the bag button with distinct coin and jade pictograms so shopping at the shop needs no panel open to check funds.

10. **Show cooldowns as hand-drawn ink refills** — Refill each skill's hotbar icon with a brush-stroke sweep instead of a flat radial, matching the ink-wash aesthetic while keeping the 4-skill rotation readable.

11. **Provide a settings panel with instant preview** — Apply quality, fog, and UI changes live as the player drags sliders, so a fog-density tweak is seen on the layered mountains before the panel is closed.

12. **Add separate audio channels in settings** — Split master, ambient, UI, and combat-effect volume so a player can quiet Stone Guardian slam sounds while keeping Elder Lin's dialogue audible.

13. **Expose a fog-density setting** — Let players raise or lower Cloudmist Valley's heavy depth fog independently of the quality preset, since the mist is both the game's signature look and a visibility handicap.

14. **Add a camera distance and FOV setting** — Allow adjusting third-person camera pull-back and field of view so melee Sword Cultivators can frame telegraphs differently from ranged Talisman Masters.

15. **Offer graphics quality presets** — Provide Low / Medium / High presets that bundle draw distance, fog, shadow, and outline quality, then let each override individually for machines running the WebGL client at different power levels.

16. **Add a screen-shake intensity slider** — Scale the camera shake on Stone Guardian slams and enrage, defaulting low and including a zero option for players sensitive to motion.

17. **Add an FPS cap and V-Sync toggle** — Expose a frame-rate limiter and vertical sync so the 20Hz server tick is not smeared by uneven client rendering, keeping movement and dodge timing consistent.

18. **Add a UI scale setting** — Let players scale the paper-scroll HUD and panels as a percentage so high-resolution or small-window WebGL clients keep every pictogram legible.

19. **Add a network and tick diagnostics panel** — Show ping, tick rate, and snapshot size from the 20Hz WebSocket loop so players can tell client latency apart from server authority when a dodge feels late.

20. **Add a reduce-motion master switch** — A single accessibility toggle that disables camera shake, parallax fog drift, and boss screen flash together, honoring the photosensitive-safe priority without hunting through sub-settings.

21. **Add full key remapping for the hotbar** — Let players rebind the 4 class skills (Sword Cultivator, Talisman Master, or Physician) to any key, storing the map in the client config and displaying the new key on each icon.

22. **Make the dodge roll independently rebindable** — Allow the dodge roll (15 Qi, 1.5s cd) to be bound to its own key or a modifier so players can separate it from the movement keys they already use.

23. **Rebind movement to any four-direction set** — Support WASD, ESDF, arrow keys, and any custom four-key layout so left-handed and alternate-keyboard players can move through Cloudmist Valley comfortably.

24. **Add a rebindable interact key** — Let the player reassign the key that talks to Elder Lin, Wu, Tao, Hao, Mei, and Fen and loots chests, separate from attack keys.

25. **Support modifier combinations in binds** — Allow Shift, Ctrl, and Alt combinations (e.g. Shift+1 for a skill) so the 4 skills and dodge fit on compact keyboards or mouse-adjacent keys.

26. **Add gamepad binding with class-aware defaults** — Provide controller bindings where the left stick moves, a face button dodges, and the triggers cast skills, giving a pad-friendly layout for each of the 3 classes.

27. **Detect and warn on key conflicts** — Highlight two conflicting bindings in vermilion and block saving until resolved, so a player never silently overwrites the interact key with a skill.

28. **Add per-character versus global bind profiles** — Let binds be saved globally or per class so a Physician can bind heals to different keys than a Sword Cultivator's melee slash without rebinding every switch.

29. **Offer one-click reset to defaults** — Provide a "Reset to Default" button that restores the shipped bindings for the current class, plus a confirm dialog to prevent accidental loss.

30. **Export and import keybind files** — Allow saving a bind profile to a JSON file and importing it on another machine, so a player's dodge and skill layout follows them across Windows and macOS clients.

31. **Localize into French with a typographic review** — Ship a French locale and audit every paper-scroll label and tooltip for text overflow, since French strings run longer than English and will stress the scroll-panel layout.

32. **Localize into German with a typographic review** — Ship a German locale and test the quest log and shop labels, since compound nouns and long words can overflow the fixed scroll-panel columns.

33. **Localize into Spanish** — Ship a Latin American and Castilian Spanish locale, translating skill names and Elder Lin's dialogue while keeping the ink-and-vermilion palette unchanged.

34. **Localize into Brazilian Portuguese** — Ship a Brazilian Portuguese locale for the full quest chain and daily board, re-testing the wallet and recipe tooltips for length.

35. **Localize into Japanese using a kana-safe font stack** — Add a Japanese locale with a font that renders kana cleanly on the ink outline, keeping the game's own English source text as the fallback for untranslated strings.

36. **Localize into Korean with a dedicated font fallback** — Add a Korean locale and bundle a Hangul-capable font so the paper-scroll UI renders natively without breaking the toon+ink outline style.

37. **Localize into Russian with a Cyrillic font stack** — Add a Russian locale and a Cyrillic-capable font fallback, re-testing the HUD's fixed-width ink bars for the longer translated labels.

38. **Add right-to-left layout support** — Introduce a mirrored layout mode for RTL languages (e.g. Arabic) so the hotbar, minimap, and quest card flip cleanly without breaking telegraph rendering.

39. **Externalize every UI string into a locale table** — Move all English strings out of the client code into a single locale file so any language is added by filling a table rather than touching logic.

40. **Format numbers and dates per locale** — Route coin/jade values, cooldown timers, and daily-board reset times through locale-aware formatters so 1.5s and currency read correctly in each language.

41. **Add a screen-reader ARIA layer to the Web client** — Tag every HUD widget, hotbar slot, and panel with ARIA roles and live regions so a screen reader can announce Qi changes, cooldowns, and quest updates in English.

42. **Announce boss telegraphs to screen readers** — Push an ARIA live message when the Stone Guardian starts a cone, line, or beam telegraph and when enrage triggers, so low-vision players are not left reacting to visuals alone.

43. **Provide a high-contrast ink mode** — Offer a high-contrast theme that thickens the ink #1a1a1f outlines against the paper #f2ead8 background and raises text contrast across all panels.

44. **Add colour-blind palettes for all four rarities** — Provide deuteranopia, protanopia, and tritanopia palettes that replace the rarity and telegraph colors with symbol plus pattern coding, not hue alone.

45. **Add colour-assist symbols to telegraphs** — Stamp the Stone Guardian's cone, line, and beam telegraphs with distinct pictograms (arrow, bar, fan) so they are readable by colour-blind and low-vision players.

46. **Add a text-scaling setting** — Let players scale dialogue, quest, and tooltip text independently of UI scale so Elder Lin's dialogue remains readable without inflating the whole HUD.

47. **Add a font-weight toggle for tooltips** — Offer a bold-body option for tooltips and quest text so low-vision players get heavier strokes on the paper-scroll panels.

48. **Add focus rings to every interactive control** — Draw a visible vermilion or gold focus outline around hotbar slots, menu tabs, and buttons so keyboard and gamepad navigation always shows the active control.

49. **Support full keyboard navigation of menus** — Make the character sheet, bag, shop, daily board, and settings traversable by Tab and arrow keys with visible focus, so no panel requires a mouse.

50. **Add a photosensitive-safe flash suppression toggle** — Cap or remove white flashes from slams, enrage, and tribulation effects, replacing them with slow ink fades so no sequence triggers a seizure.

51. **Add a first-time onboarding with Elder Lin** — Open a guided sequence where Elder Lin explains movement, the Qi pool, and the dodge roll before the player leaves spawn near 0,-80.

52. **Add a class-selection preview with animated skills** — Let new players preview each of the 3 classes' 4 skills as looping ink demonstrations before committing, so a healer, melee, or ranged choice is informed.

53. **Add a dodge-roll tutorial arena** — Teach the dodge roll's 15-Qi cost and 1.5s cooldown in a safe room with telegraphed bamboo sweeps the player must roll through to advance.

54. **Add a Qi-management tutorial** — Walk players through spending and regenerating the 100-point Qi pool (10/s regen) so they understand why spamming all 4 skills empties it.

55. **Add a pre-boss telegraph primer** — Before the Stone Guardian arena, run a short lesson that reuses its cone, line, and beam telegraphs on harmless ink markers so the fight's core language is taught, not discovered.

56. **Add a gear-equipping tutorial** — After the first quest reward, guide the player through equipping one of the 6 gear slots and reading the stat change, so gearing is understood early.

57. **Add a crafting introduction at Artisan Tao** — Walk a new player through their first recipe using the shop's 10 recipes, showing material gathering and the craft result before they craft on their own.

58. **Add a daily-board introduction at Fen** — Explain the daily board's reset and reward cadence when the player first talks to Fen, so the daily loop is not missed.

59. **Add an atlas and merit-seal introduction** — Introduce the discoverable places and merit seal/title systems with a short popover when the player first earns one, tying exploration to visible progress.

60. **Add a persistent training dummy near spawn** — Place a target dummy near spawn (0,-80) where players can practice the 4 skills, dodge roll, and Qi management safely before real mob pulls.

61. **Add skill tooltips with Qi cost, cooldown, and damage** — Show every skill's Qi cost, cooldown, and damage/heal values in one tooltip, using the dodge roll's 15-Qi / 1.5s numbers as the formatting template.

62. **Add gear tooltips with side-by-side stat comparison** — When hovering a gear piece, compare its stats against the currently equipped slot across the 6 slots, highlighting gains in jade and losses in vermilion.

63. **Add mob tooltips with weakness and rarity info** — On hover or lock-on, show a mob's rarity, level band, and any elemental or positional weakness, so players learn the 27-mob roster's counters without trial and error.

64. **Add quest-reward tooltips** — Show the exact coin, jade, gear, or merit-seal reward for each Elder Lin and side-quest step before accepting, so players weigh the effort.

65. **Add recipe tooltips with material checklists** — List each recipe's required materials and mark which are in the 30-slot bag, so a player can see at a glance whether they can craft right now.

66. **Add title and merit-seal tooltips with unlock sources** — Show how each title and seal was earned (e.g. "Slayer of Old Whisker" from the rare kill) so collection progress is legible.

67. **Add a dodge-roll tooltip explaining cost and cooldown** — When a player hovers the roll key, show the 15-Qi cost, 1.5s cooldown, and current availability so the movement tool's rules are always one hover away.

68. **Add status-effect tooltips** — Let players hover a buff or debuff in the timeline strip to see its name, source, and exact effect, so a Stone Guardian slow or Physician heal is never a mystery.

69. **Add vendor price tooltips at the shop** — Show the coin/jade buy and sell price for every item in the shop so players can weigh a purchase against their wallet before committing.

70. **Add hold-to-inspect deep tooltips** — Let players hold a modifier key to expand a tooltip into a detailed panel with exact numbers, so the default tooltip stays light while power players can dig into full stats.

71. **Add a minimap with a fog-of-war ink overlay** — Render Cloudmist Valley as a minimap where unexplored area sits under the ink #1a1a1f and explored area clears to paper #f2ead8, so atlas progress is visible as the player moves.

72. **Place quest markers on the minimap** — Show Elder Lin chain and side-quest objectives (Wu, Tao, Hao, Mei, Fen) as vermilion ink pins with a distance label, so turn-in locations are reachable without opening the full map.

73. **Mark mob and boss locations on the minimap** — Add subtle ink dots for Bamboo/Fox Spirit packs, Jade Serpent, Lotus Toad, Stone Hound, and a gold seal for Old Whisker and the Stone Guardian arena, so hunting routes are planned from the map.

74. **Rotate the minimap with the player** — Let the minimap rotate with the player's facing or lock north with a toggle, and draw the player arrow in vermilion so orientation never disorients during a dodge.

75. **Add NPC pictogram pins to the minimap** — Mark Elder Lin, Wu, Tao, Hao, Mei, Fen, the shop, and the daily board with distinct vector pictogram icons so players can navigate to services at a glance.

76. **Expand the minimap into a full-world atlas view** — Provide a zoomable full-screen map of Cloudmist Valley with layered-mountain contours, fog shading, and all discovered places from the atlas collected in one view.

77. **Add clickable pins for waypoints and fast travel** — Let players click a discovered place on the atlas to set a waypoint line or, where enabled, fast-travel, so return trips to spawn (0,-80) are not a long walk.

78. **Show player coordinates on the map** — Display the player's current coordinates under the minimap so players can share a spawn or mob location with a precise number instead of a vague description.

79. **Draw the 200x200 zone bounds clearly** — Render the Cloudmist Valley boundary as a visible ink frame on the atlas so players understand where the single zone ends before they hit the edge.

80. **Add a ping/waypoint marker for groups** — Let a player drop a temporary vermilion ping on the minimap that other party members see, so a Stone Guardian pull or Old Whisker sighting can be called out precisely.
