# JIUZHOU independent grade 1

Grader ran the snapshot at /tmp/jz-grade/jiuzhou: server on :8901, `vite preview` of the built client on :8902, Playwright + SwiftShader (about 10 fps, frame stalls of 3-24 s with two pages open). Raw scratch in /tmp/jz-grade-out/. Cited screenshots are copied to docs/shots/grade1_*.png.

## Verdict: 66 / 100. FAIL (below the 75 threshold). No hard-gate failure. No category below 50% (Content is exactly 50%).

## Hard gates
| # | Gate | Result | Evidence |
|---|---|---|---|
| 1 | Clean install/build, zero TS errors | PASS | `npm run build` (tsc --noEmit + vite) in client/ OK; `npm run typecheck` in server/ OK; `node scripts/package.mjs --skip-client-build` produced a 21.4 MB zip (593 files). |
| 2 | Two clients see each other | PASS | Alpha (sword) and Beta (talisman) both listed each other in `__jz.state.ents`; Alpha's movement was reflected in Beta's view (z -79.66 -> -76.66). |
| 3 | No uncaught exceptions in 3-min session | PASS, with caveats | Server log has no errors; the browser had no pageerrors, only an audio warning (`Oscillator.frequency.setValueAtTime value 27753.2 outside nominal range`, audio/index.ts:198). Two stalled headless clients were dropped by the server with no logged reason (see Networking). |
| 4 | Kill a mob, gain XP, server-authoritative | PASS | Talisman page killed a Bamboo Spirit and got +8 XP and a "Bamboo Fiber" loot event (WS event capture). Damage, XP and movement are all computed in server/src/game/combat.ts and world.ts. Server `npm test` (bots): 41/41 PASS. |
| 5 | Non-developer start from README | PASS | `PORT=8903 WEB_PORT=8904 NO_OPEN=1 node scripts/play.mjs` started server + web, /health OK, page 200. A Windows .bat launcher exists but I did not run it. |

## Score sheet
| # | Category | Max | Score | Justification / evidence |
|---|---|---|---|---|
| 1 | Visual art direction | 20 | 13 | Real toon+ink-edge post pass, paper grain, fog, lantern glow and petals read as stylised xianxia in grade1_plaza, but grade1_hills shows generic low-poly trees and flat green ground. I never saw layered mountain silhouettes from the gameplay camera. The camera has no collision, so it sits inside a gate pillar (grade1_path_bridge) and dithered occluder blobs cover the player (grade1_grove). I could not capture a good boss or VFX shot: the one boss visit ended in the death overlay (grade1_shrine). |
| 2 | Chinese aesthetic authenticity | 10 | 7 | Paifang, stone lions, lanterns, pagoda, bilingual names, brush font, seal-square skill icons and a scroll login (grade1_login). The JIUZHOU plaque on the gate renders mirrored when seen from the plaza side (grade1_plaza, grade1_vfx1), a visible hanzi defect. |
| 3 | Gameplay and combat | 15 | 9 | Targeting (Tab), casts, cooldowns, aggro/chase, death and respawn all verified. Per-class kits are defined in server/src/data.ts. In my runs only the talisman got a kill; sword and physician died without kills (headless latency is a confound). Two clustered Bamboo Spirits killed a lv1 player in about 12 s, which felt brutal. I did not fight the boss. NPCs do nothing. |
| 4 | Multiplayer, server, networking | 15 | 11 | Fixed 20 Hz tick, 10 Hz snapshots, server-side velocity clamp (world.ts:70-75), input validation, token-bucket rate limit, interest radius 60 with `gone` handling, prediction + reconciliation (net/predict.ts), SQLite persistence; bot suite 41/41. Two stalled clients (Beta in an early run, Theta mid-run, grade1_vfx1) were dropped by the server with an empty-reason "connection lost" (likely `terminate()` at server.ts:30 or the heartbeat at server.ts:157) and the server logs no reason. |
| 5 | UI and UX | 12 | 9 | Scroll-styled login, HUD with frames, hotbar, XP bar, minimap, zone banner, chat, damage floats, death overlay (grade1_shrine) and a disconnect dialog (grade1_vfx1). Chat is safe (textContent, hud.ts:185-192). Deductions: the "ms / fps" readout is confusing and the camera/occluder issues above. |
| 6 | Content and progression | 8 | 4 | One zone, 3 mob types plus a boss, a sensible XP curve (data.ts). The 3 NPCs are static with no dialog or quests (grep found none). No reward path beyond XP and loot-log text. |
| 7 | Audio | 5 | 4 | Procedural WebAudio with ambient bed, UI, per-class cast, hit, death, level-up, loot and footstep wiring (game.ts:258-311, 411, 534), a mute button and a volume slider (hud.ts:71). I cannot hear it. One out-of-range oscillator warning. |
| 8 | Technical quality, performance | 10 | 6 | Draw calls were 57-190 (above 150 during combat, e.g. 168 and 187), about 290k triangles. The geometry count leaks: 71 -> 430 over 150 s of combat, and 176 -> 236 over a 3-min session. `EntityManager.remove` (entities.ts:63-68) only does `scene.remove`, with no dispose. JS heap was flat at about 35 MB. No lint config, `client/src/stubs/*` is dead code, no client tests. README is accurate. |
| 9 | Desktop delivery | 5 | 3 | Electron main.cjs is sane (contextIsolation, sandbox) and the launchers, VERSION, LICENSE-NOTES and a zip script all work. Electron was not run, no Windows or macOS build exists, and the app is client-only (the server is separate), so it falls under the documented-fallback cap of 3. |
| | **Total** | **100** | **66** | |

## Top 8 fixes, ranked by estimated points gained
1. **Fix the camera** (+3 art, +1 UI). Add camera collision against structures and trees (raycast from the target to the camera and pull in), and drop the "dither blob" occluder. Re-check grade1_path_bridge and grade1_grove.
2. **Add NPC interaction and one quest** (+3 content, +1 gameplay). Click an NPC to open a paper-scroll dialog. Add a server-tracked "kill 5 Bamboo Spirits" quest with an XP reward and a boss-hunt follow-up.
3. **Rebalance early combat and prove all 3 classes** (+2 gameplay). Lower lv1-3 mob damage or aggro stacking (bamboo aggro 10, dmg 4+2/lv) and give the sword a gap-closer. Add a bots test that each class kills 3 mobs without dying.
4. **Fix the geometry leak and cut combat draw calls** (+2 tech). Dispose avatar geometries and materials on `remove`, or pool avatars by mob type. Pool or batch the VFX meshes to stay under 150 calls.
5. **Make disconnects diagnosable and robust** (+1.5 net, +0.5 tech). Log the reason on every `terminate`/`close`, and have the client auto-reconnect and re-login. Reproduce with a throttled client.
6. **Fix the mirrored JIUZHOU plaque and do an art pass on hills and boss** (+2 art, +1 culture). Flip the plaque text or double-face it, add layered ink mountains visible from the gameplay camera, and give the hills distinct materials instead of flat green. Capture proper boss and VFX screenshots.
7. **Ship a real desktop package** (+2 desktop). Spawn the bundled server from Electron main (or bundle it) and build at least one real installer, with a smoke test in CI.
8. **Cleanup** (+1 tech). Delete `client/src/stubs`, clamp the oscillator frequency at audio/index.ts:198, add eslint plus a few client unit tests, and hide the confusing ms readout.
