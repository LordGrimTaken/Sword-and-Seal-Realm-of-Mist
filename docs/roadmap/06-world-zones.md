# World & Zones

1. **Add Vermilion Peaks as the level 20+ volcanic zone** — a terraced caldera whose procedurally-carved basalt columns replace Cloudmist Valley's mist palette with ember-toned fog (#c8372d glow) and offer 27-mob-tier Stone Hound / Stone Guardian variant packs that drop vermilion-tier crafting materials for the 4th rarity of gear.

2. **Gate Vermilion Peaks behind the Elder Lin quest chain finale** — completing Elder Lin's 4-step chain (plus the Gate Warden Wu side quest) unlocks the Stone Guardian's sealed gate as a teleport anchor, so progression into the new zone is diegetic rather than a level check.

3. **Design Jade Sea as a shallow-flooded rice-paddy basin** — ankle-deep water slows movement by 20% except along raised causeway paths, and Lotus Toad packs ambush from submerged spawn points that only surface when a player's Qi falls below 40, teaching the Physician to manage ally Qi mid-travel.

4. **Build the Underworld as a persistent after-death sub-zone** — instead of a plain respawn timer, a player who falls in the open world wakes in a paper-lantern cavern where they spend 10 Qi to re-enter the living world, and can spend jade at a ferryman NPC to respawn closer to their corpse.

5. **Create the Spirit Forest as a dense vertical bamboo canopy zone** — Fox Spirit and Bamboo Spirit mobs path between procedurally-grown bamboo stalks that block line-of-sight for the Talisman Master's ranged skills, forcing repositioning rather than turret-style kiting.

6. **Make Cloudmist Summit the endgame gathering and vista zone** — a 200x200-unit exposed ridge reached only by climbing, holding the "Cloudmist Peak" atlas place and a daily board exclusive to level 20, with Old Whisker spawning here at triple his normal rate.

7. **Instance the Stone Guardian's lair as a 5-player dungeon** — a private copy of the boss arena tuned for a full party (Sword Cultivator, Talisman Master, Physician composition) with scaled HP and a "Vermilion Slab" rare drop feeding the 10-recipe crafting table.

8. **Add a solo "Mist Trial" dungeon with a branching seed** — each run procedurally reorders three arena rooms (Stone Hound gauntlet, Jade Serpent corridor, Bamboo Spirit thicket) so the Notice Board Fen "Trial" quest stays fresh across dailies.

9. **Create a Jade Sea raid-style "Serpent's Coil" instance** — a multi-phase Jade Serpent broodmother with the existing line/beam telegraph vocabulary reused as water-spout patterns, dropping a jade-tier trinket slot that doesn't exist in the current 6 gear slots.

10. **Introduce an Underworld timed "Lantern Run" instance** — players carry a vermilion paper lantern whose light radius shrinks over time; reaching each checkpoint adds seconds, and the run ends at a Meridian statue that refunds one spent Qi per checkpoint for build experimentation.

11. **Add a "Fox Den" micro-instance reachable from Spirit Forest** — a 3-room burrow of Fox Spirit packs guarding a chest that rewards one random tier-3 crafting recipe, giving recipe collection a targeted farm beyond the shop.

12. **Make each dungeon respect the single-process server's 20Hz tick** — instance copies share the authoritative loop but serialize per-instance state as separate SQLite-backed zones, avoiding the known full-state JSON snapshot cost scaling linearly with party count.

13. **Add open-world POI shrines that convert coin into temporary Qi** — a "Mist Shrine" consumes 50 coin to grant a 10/s-over-10s Qi surge, giving the wallet a combat-relevant sink beyond the shop and letting a depleted Physician rejoin a fight.

14. **Place discoverable "Inkstone" landmarks that unlock atlas entries** — interacting with a carved inkstone adds its place to the atlas and grants a small merit seal reward, so exploration feeds the existing merit/title economy.

15. **Add a "Cloudmist Bell" audio-POI (visual-first for accessibility)** — a huge hanging bell renders with a pulsing gold outline ring; striking it triggers a server broadcast, and a captioned haptic/screen-flash cue replaces any audio for the photosensitive-safe mode.

16. **Create "Guild Gate" ruins as a non-functional POI** — a collapsed archway whose Notice Board plaque foreshadows future guild housing, using English-only plaque text so it reads as lore without shipping guild systems.

17. **Add a wandering merchant POI that follows the day/night cycle** — Peddler Hao's cart relocates along known road POIs at dusk, and his night-only stock adds a jade-priced crafting material, tying the existing shop NPC to world time.

18. **Scatter "Qi Springs" as regenerating gather nodes** — standing in a Qi Spring for 3 seconds restores Qi at 3x the base 10/s regen and triggers a brief jade (#4fa58b) ground glow, creating contested rest points in the open world.

19. **Add a "Stone Guardian's Scar" environmental POI** — a permanent cracked-earth crater where the boss's slam telegraph once landed, acting as a lore anchor and a safe preview of the slam pattern before players enter the instance.

20. **Build a "Summit Shrine" fast-travel anchor network** — discoverable shrines in each zone act as teleport targets, costing one jade per jump, with the spawn point at (0, -80) as the free default anchor.

21. **Hide a secret path behind a breakable ink-wash rock face** — a wall with subtly different ink-outline stroke density can be struck by any skill to reveal a hidden alcove, rewarding attentive players without a minimap marker.

22. **Add a "Bamboo Maze" hidden route in Spirit Forest** — the procedural bamboo layout generates one unmarked gap per seed that leads to a hidden Old Whisker spawn, making rare-mob hunting a navigation puzzle rather than a grind.

23. **Create a "Reflection Pool" secret that only appears at night** — a still pond in Jade Sea mirrors a hidden NPC's lantern after dusk; stepping onto the reflection tiles in order reveals a submerged chest, gating the reward on the day/night cycle.

24. **Hide a "Crane's Wing" climbing shortcut on the Summit** — a faint brush-stroke ledge sequence (rendered as a paper-ink handhold trail) bypasses the long switchback path, with each handhold costing Qi to grip so the dodge roll budget matters.

25. **Add a "Vermilion Door" secret in the Peaks that requires a crafted key** — a sealed door opens only with a "Cinnabar Key" from the 10-recipe crafting table, turning crafting into a traversal unlock rather than pure gear.

26. **Place a hidden "Meridian Map" scroll that reveals all atlas POIs for one zone** — finding it toggles that zone's undiscovered places visible on the atlas, a discoverable-quality-of-life reward consistent with the paper-scroll UI.

27. **Create a "False Path" secret with a server-side trap trigger** — a corridor that looks traversable triggers a rockfall once the server's collision update detects entry, since server-side structure collision is currently absent and must be faked with scripted triggers.

28. **Add a "Koi Staircase" hidden route in Jade Sea** — stepping on a specific sequence of koi-shaped stepping stones raises a submerged causeway, a pure environment puzzle with no combat that demonstrates the traversal layer's potential.

29. **Hide a "Fox Tail" collectible trail in Spirit Forest** — ten tucked-away brush-stroke tails scattered across the canopy grant a "Tail Collector" title when all are found, extending the titles system into world exploration.

30. **Create a secret "Underworld Echo" room that replays your own last death** — a shadowy arena spawns a ghost silhouette of your last 10 seconds before death as a non-combat trace, helping players study positioning without a combat threat.

31. **Implement climbing as a Qi-metered vertical traversal skill** — holding a climb key drains Qi at 20/s while scaling marked rock faces; the 100-point pool limits exposure, and the dodge roll's 15 Qi cost becomes a real decision mid-climb.

32. **Add swimming to Jade Sea with a breath/depth model** — deep water drains Qi instead of a separate oxygen bar, and Lotus Toads gain a lunge attack against swimmers, making the shallow causeways the strategic path.

33. **Add a glide/float traversal for the Talisman Master** — a "Mist Step" movement skill lets the ranged class cross gaps by spending Qi over distance, giving the kite-oriented class a mobility tool that doesn't encroach on melee Sword Cultivator closing.

34. **Implement a "Qi Leap" universal air-dash** — a 25-Qi burst that jumps short gaps, tuned to a 1.5s cooldown shared with the dodge roll so players choose between evasion and traversal on the same resource.

35. **Add zone teleportation via the shrine network with an in-transit cost** — teleporting to a discovered shrine costs jade and a 3-second channel that mobs can interrupt, so fast travel is a real choice rather than free escape.

36. **Implement fly/levitation as a limited Summit-only reward** — a "Cloudstep" buff earned at Cloudmist Summit lets players hover over the ridge for a short window, a scenic traversal unlock that doesn't trivialize other zones' verticality.

37. **Add a "Vine Swing" traversal point in Spirit Forest** — procedurally-placed vine anchors let players swing across canopy gaps with a timed release, an input-skill traversal that tests timing outside of combat.

38. **Implement climbable bamboo with a swaying apex** — climbing a tall bamboo stalk lets the player survey nearby mobs and POIs, a lightweight vertical-scouting mechanic that leverages the existing procedural bamboo model.

39. **Add a "Mist Bridge" traversal that solidifies under light** — a fog gap in Cloudmist Valley becomes a walkable bridge only while a nearby brazier is lit, combining the mist palette (#8fa3ad) with a simple switch-puzzle traversal gate.

40. **Implement underwater-to-surface transitions without zone teleports** — swimming up onto a Jade Sea causeway should be a continuous authoritative position update, avoiding the JSON full-state snapshot hitch by interpolating the waterline crossing.

41. **Add a "Return to Peak" respawn-teleport item** — a consumable scroll that instantly returns the player to the Summit shrine, priced in coin at the shop so traversal convenience has an ongoing wallet sink.

42. **Define each zone as a biome with a distinct fog colour and density** — Cloudmist Valley uses heavy layered mist (#8fa3ad), Vermilion Peaks uses thin ember fog, and Underworld uses near-black depth fog with paper-white lantern glows, so the fog itself communicates location.

43. **Give Spirit Forest a canopy-density biome modifier** — dense bamboo reduces draw distance and muffles mob aggro radius, while clearings expose longer sightlines, making the Talisman Master's range advantage terrain-dependent.

44. **Make Jade Sea's biome wetness interact with skills** — standing in water reduces fire-like skill effectiveness and increases Lotus Toad damage, a light elemental modifier that stays within the existing 3-class skill set rather than adding elements.

45. **Add a "Petrified Grove" biome sub-region in the Peaks** — ash-coated petrified trees block line-of-sight for ranged classes, and Stone Hound packs here are stationary ambushers, varying the standard roaming-mob behavior.

46. **Create a "Moonlit Terrace" biome in Underworld** — a low-gravity-illusion zone where jump arcs are slightly higher, using paper-lantern floating motes for visual feedback, so traversal feels distinct without new physics.

47. **Add a summit snow/ice biome with a traction modifier** — the upper Cloudmist Summit ridge has slick terrain where the dodge roll slides an extra distance, testing roll control and feeding the reduce-motion option with a toggle to damp the slide.

48. **Make biome transitions visually smooth with blending fog** — crossing from Valley mist to Peaks ember fades the fog colour and density over a few meters, avoiding hard palette pop while preserving the ink-wash aesthetic.

49. **Add biome-specific gathering nodes** — Jade Sea spawns "Pearl Lotus" and the Peaks spawn "Cinder Ore" as node types tied to the 10-recipe crafting table, so crafting material variety maps onto zones rather than random drops.

50. **Add a "Mist Veil" biome weather pocket** — a localized fog bank in Cloudmist Valley that periodically engulfs a stretch of road, hiding mobs and dimming the atlas marker, a small dynamic obstacle that respects the palette.

51. **Implement a full day/night cycle on the 20Hz tick with server-authoritative time** — the server broadcasts a time-of-day value each tick, and clients lerp fog, lantern, and silhouette colours, so day/night is consistent across the single shared process.

52. **Gate certain mobs to night** — Old Whisker and a new "Moon Fox" variant spawn only after dusk, and Notice Board Fen's night bounties reward extra merit, making the daily board time-aware.

53. **Tie Elder Lin's 4th quest step to a dusk window** — the final Elder Lin objective only becomes interactive at dusk, a light time-gate that teaches players the day/night system through the main quest chain.

54. **Make the Underworld's day/night cycle inverted** — the Underworld brightens at night (lanterns flare) and dims by day, reinforcing its otherworldly nature and staggering peak population between zones.

55. **Add weather as a server-broadcast state with visual and gameplay hooks** — rain in Jade Sea raises Lotus Toad aggression slightly, while valley mist clears after rain, a modest gameplay effect layered on the fog renderer.

56. **Implement a "Vermilion Storm" rare weather event in the Peaks** — a telegraphed storm of ember particles briefly empowers Stone Hound packs and increases rare drop odds, announced via an ARIA live region for accessibility.

57. **Add a photosensitive-safe weather fallback** — lightning or flashing storm effects are replaced with slow fades and a caption in reduced-motion / photosensitive-safe mode, per the accessibility priority.

58. **Make lantern POIs and braziers react to nightfall** — every lantern in Cloudmist Valley ignites at dusk with a gold (#c9a227) glow, serving as both atmosphere and a navigation aid, and the Underworld ferryman's fare drops at night.

59. **Tie the daily board reset to the day/night boundary** — Notice Board Fen refreshes bounties at dawn rather than wall-clock time, so daily progression is legible from the sky itself.

60. **Add a "Dawn Chorus" atmospheric transition with captioned cues** — the night-to-day shift triggers a short non-audio visual cue (mist lifting, silhouettes sharpening) with a text caption, since audio has never been heard by a human and must not be load-bearing.

61. **Implement a "Moonless Night" ultra-dark phase** — on moonless nights, fog depth increases and the player's light radius shrinks, but high-contrast mode keeps mobs and paths clearly outlined so the darkness doesn't exclude low-vision players.

62. **Add weather-driven traversal hazards** — a heavy rain raises Jade Sea water level slightly, submerging low causeways and forcing the raised koi staircase route, making weather a real navigation variable.

63. **Implement server-authoritative structure collision for buildings and ponds** — replace the current "walk through buildings/pond" limitation with a collision grid generated from each structure's footprint, validated at 20Hz so position snaps are authoritative.

64. **Add a NavMesh or grid-based collision layer for procedural bamboo and rocks** — procedural models need runtime collision capsules baked at spawn, so the Spirit Forest canopy and Stone Guardian arena blocks line-of-sight and movement consistently.

65. **Implement pond collision with a swim-vs-block rule** — ponds become swimmable depth zones with a defined shoreline, rather than hard blockers, so Jade Sea's water traversal and Cloudmist Valley's ponds share one consistent rule.

66. **Add invisible-wall fallbacks with diegetic mist boundaries** — the 200x200 zone edge should render as an impassable "thick mist" wall (denser #8fa3ad fog) instead of a hard invisible plane, so the boundary reads as world fiction.

67. **Server-validate dodge-roll destinations against collision** — the roll's 15-Qi cost should fail or slide along a wall rather than teleport through a building, closing the collision gap for the existing movement skill.

68. **Add climbable-surface tagging to the collision grid** — mark which surfaces accept climbing so the traversal skill only engages on intended rock faces and bamboo, preventing climb-anywhere exploits.

69. **Implement soft boundaries that push rather than block** — when a player tries to leave the zone, the server applies a gentle counter-force and a caption ("The mist turns you back"), avoiding a jarring hard stop while staying authoritative.

70. **Add a "Seamless Border" between Cloudmist Valley and Vermilion Peaks** — a single shared boundary where crossing triggers a load of the adjacent zone within the same process, since the current build is single-zone and must not fork into separate processes prematurely.

71. **Implement zone-entry validation on the server** — the server checks a player's unlock flags (Elder Lin chain for the Peaks) before accepting a zone-crossing teleport, so progression gates hold under the authoritative model.

72. **Add collision for the Stone Guardian's telegraph walls** — the boss's line/beam and cone telegraphs should create temporary collision zones so players can't simply walk out of a telegraphed area mid-cast.

73. **Persist discovered POIs, secrets, and atlas state to node:sqlite** — exploration progress (found shrines, hidden paths, atlas entries) must survive relog, keyed to the player's SQLite row alongside wallet and merit seals.

74. **Add a "Zone Map" UI panel with fog-of-war reveal** — the paper-scroll UI gets a stylized atlas overlay that reveals discovered regions in ink-wash tones, with unexplored areas as blank paper (#f2ead8), consistent with the palette.

75. **Render receding mountain silhouettes per zone with parallax** — each zone layers 2-3 procedural silhouette ridges at different depths behind the fog, with the palette's ink (#1a1a1f) and mist tones, reinforcing the ink-wash depth without assets.

76. **Add zone-specific skybox gradients** — Cloudmist Valley's sky leans mist (#8fa3ad), the Peaks lean ember, and Underworld stays near-black, using procedural shaders so no external skybox assets are needed.

77. **Implement a "Travelers' Post" rest POI that heals and persists a checkpoint** — resting at a post restores HP/Qi to full and sets a respawn checkpoint, giving the open world a safe-point economy beyond the spawn at (0, -80).

78. **Add a "Lantern Trail" connecting zones visually at night** — a chain of lit lanterns marks the main road from Cloudmist Valley toward the Peaks gate, a diegetic breadcrumb trail that also aids low-vision navigation.

79. **Make world discovery grant merit seals and titles cumulatively** — every new atlas place, hidden path, and shrine discovered awards merit toward existing seals and unlocks a "Wayfarer" title track, so exploration meaningfully feeds the existing progression systems.

80. **Add a "Mist Whisper" server-hint system for stuck explorers** — after a player wanders a small area for too long, a captioned NPC-voice hint (rendered as text, no audio dependency) suggests a nearby POI or secret, an accessibility-friendly guidance net for the open world.
