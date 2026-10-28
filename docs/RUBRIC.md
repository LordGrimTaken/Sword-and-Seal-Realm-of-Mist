# JIUZHOU — Game Rubric (100 points)

Ship threshold: **total >= 75/100**, no hard-gate failures, and no category below 50% of its points.
Scoring is done by an independent grader who has NOT seen the build process. The grader must run the game (server + 2 clients), look at screenshots, and read code. Claims in READMEs or reports earn nothing without evidence. Score conservatively: when unsure between two bands, take the lower.

## Hard gates (any failure = automatic fail, score capped at 60)
1. Server and client install and build from a clean checkout with the documented commands, zero TypeScript errors.
2. Two clients can log in at once and see each other move in the same zone.
3. No uncaught exceptions in server logs or browser console during a 3-minute scripted play session.
4. A player can kill at least one mob and gain XP; the server (not client) decides damage, movement and XP.
5. The final package can be started by a non-developer using only the included README steps.

## 1. Visual art direction — 20 pts
- 16-20: Instantly reads as ink-wash / xianxia. Palette locked to DESIGN.md. Layered misty mountains, fog depth, toon+outline characters, cohesive lighting, readable at gameplay camera distance, ambient life (mist, petals, lanterns, water). Looks intentional, not placeholder.
- 11-15: Clear Chinese theme and mostly cohesive, but some flat/generic areas, weak depth, or inconsistent materials.
- 6-10: Generic low-poly with Chinese props sprinkled in.
- 0-5: Placeholder boxes or broken rendering.
Evidence: at least 6 gameplay screenshots (plaza, bamboo grove, fox hills, shrine/boss, combat with VFX, UI-heavy shot).

## 2. Chinese aesthetic authenticity and cohesion — 10 pts
- Architecture (paifang, pagoda, bridge, shrine), costume, bilingual naming (English names with Chinese-flavoured wording), seal-stamp motifs, brush-script typography, color symbolism (vermilion/jade/gold) used with taste; no culturally muddled or Orientalist clutter; lettering correct and well formed.
- 8-10 refined and consistent; 5-7 recognizable but shallow; 0-4 superficial or inaccurate.

## 3. Gameplay and combat — 15 pts
- Responsive movement and camera (3 pts); target selection (click, Tab) works reliably (2 pts); 3 classes with 4 distinct skills each, cooldowns, ranges, AoE/heal behave as designed and feel different (5 pts); mob AI (aggro, chase, leash, respawn) and a boss with a readable fight (3 pts); death/respawn loop (2 pts).
- Combat feedback: hit numbers, VFX, animation states, audio cues all trigger correctly (counted under each category, but weak feedback caps this category at 10).

## 4. Multiplayer, server and networking — 15 pts
- Authoritative server with fixed tick, validated inputs, speed clamping (4 pts).
- Interest management and snapshot delta/`gone` handling work with 5+ simulated clients (3 pts).
- Client prediction + reconciliation and interpolation: remote players move smoothly, local player has no rubber-banding on a clean connection (4 pts).
- Persistence: character level/xp/class/position survive relog (2 pts).
- Robustness: malformed JSON, abusive input, duplicate names, disconnect/reconnect do not crash the server; bot test suite passes (2 pts).

## 5. UI and UX — 12 pts
- Login/class select polish (2); HUD completeness and legibility: player/target frames, hotbar with cooldowns, XP, minimap, nameplates, damage numbers, zone banner (5); chat with system messages (2); death overlay, level-up flourish, loot log (1); consistent paper-scroll/lacquer styling with correct fonts bundled locally (2).
- Deduct for clutter, unreadable text over bright backgrounds, broken layout at 1280x720 and 1920x1080.

## 6. Content and progression — 8 pts
- Starter zone with distinct regions (3); mob variety lv1-8 plus boss and meaningful level scaling over ~10-15 minutes of play (3); NPCs present and at least one interactive/dialog or quest-style hook (2).

## 7. Audio — 5 pts
- Ambient bed (wind/water/bamboo or pentatonic guzheng-style loop), UI clicks, per-class skill sounds, hit/death/level-up cues, volume/mute control. Procedural WebAudio is acceptable. 0 if silent.

## 8. Technical quality and performance — 10 pts
- Holds 60 FPS-equivalent frame times on modest hardware (grader measures draw calls/triangles and headless frame time; under 150 draw calls and 400k triangles in the main view earns full marks) (4); clean modular code and README accuracy (3); lint/type cleanliness, no memory growth over a 5-minute session, graceful errors on server loss (3).

## 9. Desktop delivery — 5 pts
- Runs as a desktop app (Electron wrapper or equivalent) with correct config; one-command start for server and client on Windows and macOS/Linux; zip contains built client, server, README, license notes for dependencies; version stamp. If the Electron binary cannot be built in the sandbox, a documented fallback launcher caps this at 3.

## Score sheet
| # | Category | Max | Score | Evidence / notes |
|---|---|---|---|---|
| 1 | Visual art direction | 20 | | |
| 2 | Chinese aesthetic authenticity | 10 | | |
| 3 | Gameplay and combat | 15 | | |
| 4 | Multiplayer, server, networking | 15 | | |
| 5 | UI and UX | 12 | | |
| 6 | Content and progression | 8 | | |
| 7 | Audio | 5 | | |
| 8 | Technical quality, performance | 10 | | |
| 9 | Desktop delivery | 5 | | |
| | **Total** | **100** | | |

Grader output must list: hard-gate results, per-category score with one-sentence justification and file/screenshot evidence, the five most valuable fixes ranked by points gained, and the final total.
