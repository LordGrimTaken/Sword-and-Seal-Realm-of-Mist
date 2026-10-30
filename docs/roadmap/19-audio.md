# Audio & Music

1. **Main theme "Mist and Ink"** — A sparse bamboo-flute melody over a low bowed-string ink-wash drone that opens paper-quiet, setting the Cloudmist Valley mood before any combat, with a single vermilion pipa accent reserved for boss and merit-seal moments so the red-ink beat is felt, not just seen.

2. **Login/launcher theme** — A gentle looping motif for the Electron launcher and login screen whose flute line only enters after the WebSocket handshake confirms the Node server, turning connection status into sound.

3. **Character-select theme** — An animated arrangement that weaves in the three class signatures — a sword clang for Sword Cultivator, paper flutter for Talisman Master, and a jade chime for Physician — so the theme previews the class before selection.

4. **Load-screen motif** — A short, loop-safe phrase that can resolve cleanly at any frame while the Three.js scene streams in, so the paper-scroll loading screen never cuts a melody mid-phrase.

5. **Cloudmist Valley exploration theme** — The zone-wide neutral track at a slow, breathing tempo with a deliberately sparse melody that leaves headroom for mob calls, boss telegraphs, and quest VO across the 200x200 valley.

6. **Bamboo Grove arrangement** — A variant of the exploration theme that swaps the flute for hollow bamboo-knock percussion, tied to the Bamboo Spirit and Fox Spirit territory so the grove is recognizable by ear through heavy fog.

7. **Misty Lake arrangement** — A wet, reverb-heavy arrangement led by a two-string bowed fiddle for the Jade Serpent and Lotus Toad shore, reflecting water lapping and low mist.

8. **Stone Quarry arrangement** — A low, percussive arrangement built on slow rock-hammer strikes for the Stone Hound lair and the quarry approach to the Stone Guardian arena.

9. **Village theme (Elder Lin's pavilion)** — A warm, safe-town variant with a plucked-zither melody and no combat layer, giving players a quiet breather while they turn in Elder Lin's chain and the Wu, Tao, Hao, Mei, and Fen side quests.

10. **Boss arena prelude** — A stripped, held-note prelude in the Stone Guardian's arena before the fight triggers, so the music itself telegraphs that a boss awaits beyond the fog.

11. **Region crossfade at fog gates** — A smooth equal-power crossfade among the four sub-region arrangements driven by the player's position in the 200x200 valley, with no hard cuts between zones.

12. **Region music ducking for dialogue** — The region track auto-ducks about 6 dB whenever Elder Lin or a side-quest NPC speaks, then restores, so English VO is always intelligible over music.

13. **Altitude music layer** — As the player climbs the layered mountains at the valley's edge, the arrangement thins out and gains wind, making height audible even when fog hides the horizon.

14. **Day/night music variant** — The exploration theme shifts to a sparser, lower-octave arrangement at night so the same zone feels different without a second full track.

15. **Shrine/interior music** — A long-reverb, resonant variant for jade shrine interiors and atlas place-discovery moments, clearly distinct from open-valley exploration.

16. **Combat layer (low intensity)** — A percussive layer that fades in on first aggro from a Bamboo or Fox Spirit and fades out when combat ends, keeping the region melody beneath it.

17. **Combat layer (high intensity)** — A denser, faster-percussion layer reserved for multi-mob pulls, the Stone Hound, or the rare Old Whisker, so rising difficulty is audible before it is fatal.

18. **Boss phase-one music** — A deliberate, mid-tempo arrangement for the Stone Guardian's opening phase, built around the rhythm of its telegraphed slams.

19. **Boss phase-two music** — A faster, more layered arrangement that begins when the Guardian enters its second phase, signaling the new cone and line telegraph patterns.

20. **Boss phase-three music** — A maximal, sustained arrangement for the Guardian's final phase with a climbing tension line that resolves only on the kill.

21. **Enrage layer** — A driving, urgent percussion and bowed-string layer that locks in when the Stone Guardian enrages and does not release until the fight ends.

22. **Low-health heartbeat layer** — A soft rhythmic pulse layered under everything when the player drops below roughly 30 HP, so danger is felt even while the screen is busy with telegraphs.

23. **Qi-depleted warning tone** — A short, thin tone when the 100-point Qi pool runs dry and skills refuse to fire, distinct from damage audio so the cause is immediately clear.

24. **Victory resolution** — A resolving, major-adjacent phrase on mob or boss clear that settles the ink-wash drone back into the region theme.

25. **Defeat resolution** — A sparse, non-punishing falling phrase on player death that crossfades to the region theme, keeping death meditative rather than a harsh failure sting.

26. **Combat music ducking for telegraphs** — Boss music ducks briefly during each cone, line, and beam warning so the telegraph tone is never masked by the mix.

27. **Sword Cultivator slash SFX** — A crisp ink-brush slash with a metallic edge for melee sword strikes, pitch-scaled across the four Sword Cultivator skills so each reads distinctly.

28. **Sword Cultivator skill flourish** — A rising whoosh layered over each melee skill so the four Sword Cultivator abilities remain audibly distinct even at the server's 20 Hz tick.

29. **Talisman Master paper flutter** — A light paper-rustle on every talisman throw, matching the paper-scroll UI and the ranged class's identity.

30. **Talisman Master detonation** — A dry paper-crack detonation with a brief vermilion spark accent when a talisman lands, clearly distinct from melee slashes.

31. **Physician healing pulse** — A soft jade-tone chime for each heal tick, so the Physician's four skills read as restorative rather than offensive.

32. **Physician heal-burst chime** — A warmer, fuller chime when a large heal lands, giving the healer satisfying confirmation separate from damage numbers.

33. **Dodge roll whoosh** — A fast, directional whoosh with a breathy tail for the 15-Qi, 1.5-second-cooldown dodge roll, so the Qi cost is felt in the motion.

34. **Qi regen tick** — A barely-audible ascending shimmer each time the 10-per-second Qi regen crosses a threshold, feedback that never competes with combat.

35. **Qi-insufficient fail SFX** — A short, dull "denied" thunk when a skill is attempted below its Qi cost, distinct from the depletion warning tone.

36. **Footstep surface variety** — Distinct footfalls for bamboo mat, stone, dirt, and water edges that switch with the procedural terrain under the player.

37. **Level-up stinger** — A bright, ceremonial rise on level-up that grows subtly grander as the player approaches the level-20 cap, marking each of the 20 levels as earned.

38. **Gear equip SFX (six slots)** — Distinct cloth, leather, and metal variants for equipping each of the six gear slots, plus a soft chime when a slot fills versus empties.

39. **Rarity drop chime (four rarities)** — Four escalating chimes matched to the four rarity colors, from a soft note for common to a gold-bright layered chime for the rarest, so rarity is audible even without color.

40. **Coin pickup (wallet coin)** — A light, bright coin jingle for coin drops that stays crisp in rapid succession without clipping.

41. **Jade pickup (wallet jade)** — A deeper, resonant jade-tone for jade currency, clearly distinct from coin so the two wallet currencies are never confused by ear.

42. **Bag open/close (30 slots)** — A paper-rustle open and a soft close for the 30-slot bag, echoing the paper-scroll UI texture.

43. **Bag-full denial** — A firm paper-thunk when the 30-slot bag is full and an item cannot be picked up, distinct from the Qi-denied thunk.

44. **Shop purchase chime** — A confident coin-and-confirm chime for the shop, with a lower "insufficient funds" tone for failed purchases.

45. **Recipe craft success** — A satisfying layered chime for completing any of the 10 recipes, layering the rarity chime on top when a craft yields a higher-rarity item.

46. **Quest accept stamp** — A paper-stamp sound for accepting Elder Lin's chain or the Wu, Tao, Hao, Mei, and Fen side quests, echoing the paper-scroll UI.

47. **Quest complete sting** — A warm resolve phrase for each quest stage, slightly brighter for Elder Lin's main chain than for side quests.

48. **Daily board stamp** — A distinct stamp-and-ink sound for the daily board, with a soft fanfare when the daily completes.

49. **Merit seal/title earned** — A ceremonial vermilion-seal stamp sound for merit seal and title unlocks, the audio mirror of the red-ink stamp visual.

50. **Atlas/place discovery chime** — A quiet, wonder-filled chime when a new atlas location or place is discovered, encouraging exploration of the valley's fog-hidden corners.

51. **Paper-scroll roll/unroll** — A continuous paper unroll and roll sound for opening and closing the paper-scroll UI, the signature UI texture.

52. **UI button click** — A consistent, low-latency ink-drop click for all paper-scroll buttons, tuned so rapid clicks never comb-filter into mush.

53. **Drag-and-drop item** — A short paper-grab and release for dragging items between the 30 bag slots and the six gear slots.

54. **Elder Lin quest VO** — Full English voice lines for Elder Lin's main chain in a calm, wizened tone with subtle pavilion reverb.

55. **Side-quest NPC VO (Wu, Tao, Hao, Mei, Fen)** — Five distinct English voices for the side-quest NPCs so each quest giver is recognizable by ear before you read the name.

56. **Boss telegraph callouts** — Grinding-stone roars from the Stone Guardian that precede each cone, line, and beam telegraph, doubling the visual warning.

57. **Class combat callouts** — Sparse English combat barks per class — sword, talisman, healing — that fire rarely enough to never spam.

58. **Player hit/grunt** — A short, breathy grunt on taking a hit, pitch-varied so repeated damage never sounds like a looping sample.

59. **Boss taunt lines** — One or two low, resonant Stone Guardian taunts at phase transitions and enrage, reinforcing the three-phase structure.

60. **Death whisper** — A single quiet English whisper or sigh on player death, replacing a harsh sting to keep the ink-wash tone meditative.

61. **Spatial panning for mob calls** — Mob calls pan in stereo by their position relative to the camera, so a Fox Spirit behind you is heard before it is seen.

62. **Spatial Qi pulse direction** — Healing and Qi pulses originate from the Physician's and target's world positions, so a heal landing across the arena is localizable.

63. **Distance attenuation for telegraphs** — Telegraph warning tones attenuate and reverb by distance from the Stone Guardian, so ranged players still read them clearly at range.

64. **Doppler on dodge and melee** — The dodge roll and fast melee skills get a subtle Doppler pitch bend so motion reads spatially even in stereo.

65. **HRTF headphone mode** — A headphone preset using HRTF so the three classes, 27 mobs, and the boss localize in 3D, critical when fog hides threats.

66. **Reverb zones** — Separate reverb spaces for bamboo grove (open), stone quarry (hard slap), shrine interior (long tail), and Misty Lake shore (wet), crossfading at borders.

67. **Distance culling and LOD** — Far mobs and ambience are attenuated and low-pass filtered so the fog-covered valley never overwhelms the mix.

68. **Bamboo Spirit chitter** — A light, hollow knock-and-rattle call for the Bamboo Spirit, audible a short distance through fog before it is seen.

69. **Fox Spirit call** — A high, soft two-note cry for the Fox Spirit, pitched so it is unmistakable inside a mixed pull.

70. **Jade Serpent hiss** — A wet, low hiss for the Jade Serpent that pans with the mob and warns of its ranged attack.

71. **Lotus Toad croak** — A deep, resonant croak for the Lotus Toad that doubles as its aggro bark near the Misty Lake.

72. **Stone Hound growl** — A grinding stone growl for the Stone Hound, low enough to feel tectonic and distinct from organic mobs.

73. **Old Whisker rare sting** — A distinct, slightly mischievous plucked-string sting when the rare Old Whisker spawns or is first seen, so a rare is never missed by ear.

74. **Mob aggro bark** — A universal short bark on aggro that triggers the combat-music crossfade and alerts players mid-quest.

75. **Mob death dissolve** — A soft ink-wash dissolve sound as each mob fades on death, tying combat deaths to the palette rather than a generic poof.

76. **Mob spawn coalesce** — A fog-coalescing whoosh when mobs materialize out of the mist, so spawns read as part of the environment.

77. **Telegraph warning tones (cone/line/beam)** — Three distinct warning tones for the Stone Guardian's cone, line, and beam telegraphs, so the shape of the incoming attack is identifiable by sound alone.

78. **Stone Guardian slam impact** — A heavy, low impact with a rock-shard crackle for each telegraphed slam, felt more than heard.

79. **Stone Guardian enrage roar and rock shatter** — A tectonic roar with shattering stone at enrage, plus a distinct shatter for the rock-breaking moments across its three phases.

80. **Accessibility audio presets** — A photosensitive-safe mode that removes strobe-like audio flashes, a reduce-motion mode that softens whooshes, and colour-assist chimes with focus-ring audio so rarity, telegraphs, and UI focus are conveyed without relying on color or sight.
