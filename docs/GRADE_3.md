# JIUZHOU v0.2.0 - Independent Grade 3

Grader: independent, ran the release zip and the repo snapshot. Method: unzip + player README, builds, bot suite x3, two-page Playwright sessions (SwiftShader, ~10 fps, ping inflated by CPU starvation, not network), websocket bots for server-side checks, code reading. Screenshots: `docs/shots/grade3_*.png`. A TEST_MODE=1 server (ports 9071/9072) was used for `/testlevel N`, `/testtp X Z` (typed as chat); a normal server on 9061/9062 was used for gate 5 and for the TEST_MODE-inert check.

## Hard gates
| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | Clean build, zero TS errors | PASS | client `typecheck`, `lint`, `vite build` (alt outDir) clean; server `typecheck` clean |
| 2 | Two clients see each other move | PASS | two pages list each other; one moved 3 u and the other saw the new position. Under CPU starvation one page sometimes took seconds to see the other, then converged |
| 3 | No uncaught exceptions, 3 min | PASS | 7.5 min soak with a second bot fighting: 0 pageerrors, 0 console errors (only SwiftShader "GPU stall" warnings); server logs 0 errors. Console errors appear only while I deliberately killed the server |
| 4 | Kill mob, gain XP, server-authoritative | PASS (via bot) | Headless browser could not kill reliably (10 fps, 2-5 s ping, Tab picked out-of-range mobs). A websocket bot with each class killed a Bamboo Spirit and received `xp` events (sword +10, talisman +30, physician +10). Server computes damage/XP (server/src/game/combat.ts); client only sends `cast`/`input` |
| 5 | Non-developer start from zip README | PASS | fresh unzip, `NO_OPEN=1 PORT=9061 WEB_PORT=9062 DB_PATH=... node scripts/play.mjs`: /health ok, client 200, loads in Playwright, login works. README says button "Enter the Valley", actual is "Enter World (v0.2 label)" |

No hard-gate failure, so no 60 cap.

## Verified extras
- Bot suite `npm test`: 87/87 PASS on all 3 runs.
- Chat escaping: `<b>`/`<img onerror>` shown as text, nothing injected (hud.ts ~270 uses text nodes).
- Production server: `/testlevel 25` was inert (level stayed 1). Speed clamp: dx=1000 gives 6 u/s (world.ts:80-82). Malformed JSON, typed junk, 100 KB frame (closed by maxPayload 2048), 300-message chat spam: server survives, /health ok. Duplicate-name rejection not conclusively tested.
- Quest chain by bot: stages 1-3 accepted, completed, rewarded, items consumed. Stage 3 turn-in and stage 4 were not completed in my run (bot stopped at 3/4 serpents); the repo suite covers boss turn-in (PASS).
- Boss: telegraphs (r7, 1.8 s; phase 2 three r4.5 rings), real damage (30-88 per hit; a lv20 sword bot ended 56/595 HP); a lv12 talisman died to it in-browser and respawned at the plaza. A real, dodgeable fight.
- Persistence: relog restored level 20, position and inventory (incl. Guardian Core).
- Reconnect: server killed and restarted; page auto-reconnected in ~22 s as the same character.
- Perf (renderer.info): 47-72 draw calls, 340-362k triangles (under the 150 / 400k limits, triangles close to cap). Geometries/textures rose 56->67 / 20->32 in the first 3 min then plateaued and fell over 7.5 min: no leak. JS heap ~60 MB.
- Audio: full procedural WebAudio code (ambient guzheng bed, per-class cast sounds, hit/death/loot/level-up/warn, master gain, mute, volume slider); AudioContext `running` after a click. Never listened to; quality unverifiable.
- Desktop: client/electron/main.cjs + server-process.cjs, electron-builder config, release.yml (win/mac/linux), launchers .sh/.bat read and plausible. No installer built or run by me.

## Score sheet
| # | Category | Max | Score | Justification / evidence |
|---|---|---|---|---|
| 1 | Visual art direction | 20 | 14 | Cohesive outlined toon look, red/gold paifang, lanterns, lotus pond, fog; trees, rocks, foxes still read as generic faceted low-poly and there is no real ink-wash painterly layer; mountains weak at gameplay camera. `grade3_bridge_pond.png`, `grade3_fox.png`, `grade3_boss_fight2.png` |
| 2 | Chinese aesthetic | 10 | 8 | Correct unmirrored hanzi (plaque, valley name, lantern words), seal-stamp UI, brush titles, bilingual names; props somewhat repetitive. `grade3_hud_1920.png`, `grade3_login.png` |
| 3 | Gameplay and combat | 15 | 11 | Three distinct kits, boss telegraphs, mob aggro, death loop work; feel at real fps unproven, Tab targets far mobs causing "Target is out of range" spam, balance past lv5 untested. `grade3_boss_fight2.png` |
| 4 | Multiplayer/server | 15 | 12 | Fixed 20 Hz, clamped input, interest + gone, persistence, robustness, 87/87 tests; no structure collision on the server (README admits it), 5+ client interest only covered by repo suite |
| 5 | UI/UX | 12 | 10 | Scroll login, lacquer HUD, glyph hotbar, minimap, boss bar, dialog, help with volume; clean at 1280x720 and 1920x1080; chat panel crowds the hotbar area a little. `grade3_hud_1280.png`, `grade3_npc_dialog.png`, `grade3_help.png` |
| 6 | Content/progression | 8 | 6 | One zone with distinct regions, 4 mob types + boss, 2 quest NPCs + 4-step chain; content ends about lv8, thin for 10-15 min |
| 7 | Audio | 5 | 4 | Comprehensive wiring and mute/volume, context running; never heard |
| 8 | Technical/perf | 10 | 9 | Budgets met, lint/type clean, no memory growth, graceful reconnect; triangles near cap, README button text wrong, one 800 KB JS chunk |
| 9 | Desktop delivery | 5 | 3 | Electron code, builder config, CI workflow and launchers exist and the zip launcher works; no installer built, so capped at 3. Zip has LICENSE-NOTES but no project LICENSE |
| | **Total** | **100** | **77** | |

## Verdict
77 >= 75 threshold, zero hard-gate failures, every category at or above 50% of its points (lowest: desktop 60%, gameplay 73%). **SHIP, marginally (+2).** The score depends on unverified items: audio never heard, no real-GPU frame rate, no Electron build.

## Top 6 remaining fixes (est. points)
1. Art: true ink-wash treatment (brushy sky/mountain layers, painterly ground and foliage, de-faceted trees/rocks, richer mob models): +3 to +4.
2. Build and run Electron installers (at least AppImage and a Windows portable) and add a project LICENSE: +2.
3. Real-hardware verification (real GPU fps, a human listening to audio); cut triangles toward ~250k for margin: +1 to +2.
4. Server-side structure/pond collision so prediction and authority match: +1 to +2.
5. Content depth: mobs beyond lv4, gear use, second quest region so 10-15 min scales past lv8: +1 to +2.
6. Tab should prefer in-range targets (stops "out of range" spam), fix README button name, split the 800 KB bundle: +1.
