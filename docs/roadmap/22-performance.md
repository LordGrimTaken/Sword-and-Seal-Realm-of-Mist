# Client Performance & Rendering

1. **Fold per-mob sub-meshes into the Batch** — Merge the body, head and ink-outline geometry of the 27 Cloudmist Valley mobs into the existing `Batch` merge keyed by material, so a bamboo grove pull becomes a few draw calls instead of one per body part.
2. **One geometry per Stone Guardian phase** — Swap the boss's rune ring, slab arms and glowing core as a single per-phase geometry key, keeping the three-phase fight inside a fixed draw-call budget while only the material/emissive changes.
3. **Draw-call ceiling assertion** — Add a debug assertion against `renderer.info.render.calls` so a regression in the plaza, grove or shrine hill is caught before release, not after a full party gathers.
4. **Collapse instanced vegetation into mergeGeometries** — Audit bamboo stalks, flagstones and rocks to confirm they go through the `Batch` merge rather than separate `InstancedMesh`/single draws, since the valley props are static.
5. **Explicit per-view triangle budget** — Pick a target (e.g. ~250k) for the 124x124 terrain plus 27 mobs, party and boss, and surface `renderer.info.render.triangles` in the debug HUD every frame.
6. **Dedupe the toon material programs** — Guarantee every bamboo stalk, fox spirit and player shares the same three-band `toonGradient` shader and cached `MeshToonMaterial`, so near-duplicate outline/toon variants never compile twice.
7. **Merge floating text into one layer** — Draw damage numbers, nameplates, HP/Qi bars and buff icons into a single canvas or CSS layer rather than per-entity DOM nodes, so 27 mobs and a party stop forcing layout work.
8. **Palette-index the batch color attribute** — Replace the three-float per-vertex color in `Batch` with an index into the eight ink/paper/vermilion/jade/gold/mist tokens to shrink static vertex buffers and their per-frame uploads.

9. **Distance LOD for bamboo and lanterns** — Swap distant grove and path-lantern clusters to merged impostor billboards instead of full cylinder/segment geometry, since they are the densest props in Cloudmist Valley.
10. **Terrain far-mesh LOD** — Keep the near 15.6k-vertex height field around the player but drop to a coarse skirted mesh at range, so the 200x200 valley's outer rim stops overdrawing the fill rate.
11. **Bake mountain silhouettes** — Render the 3–4 receding mist/mist-light mountain layers as one painted far plane rather than full geometry, preserving depth without paying per-layer triangle cost.
12. **Stone Guardian LOD tiers** — Full rune-ring slabs within ~30 units, a static two-band toon proxy to ~90 units, and a billboard beyond, keeping boss readability from the shrine courtyard without full detail.
13. **Player avatar LOD** — Drop the baked outline's `aThick` hull and reduce limb segments for distant players while keeping their worn title/nameplate, so a LAN party stays cheap on screen.
14. **Dither LOD swaps with reduce-motion** — Cross-fade or dither bamboo-sway LOD transitions so popping doesn't fight the `reduceMotion` setting or trigger photosensitive players.
15. **Tie LOD to camera zoom** — Drive LOD selection from the follow camera's orbit distance so zooming out over the lotus pond doesn't keep distant props at full detail.
16. **Data-driven LOD distances** — Put per-class LOD thresholds (mob, player, structure, vegetation) in one file so all 27 mob families and valley props share tunable, consistent transitions.

17. **Opt-in WebGPURenderer toggle** — Add a settings toggle for an experimental WebGPU path with a WebGL fallback, so Chrome/Edge players can opt in while Firefox/Safari and the headless test harness stay on WebGL.
18. **Port the ink outline to WGSL** — Reimplement the inverted-hull and `bakedOutline` `aThick` outline in WGSL so the cel shading and vermilion/gold accents survive a WebGPU switch exactly.
19. **Compute the particle pool** — Move the CPU-simulated point-sprite mist/petal/ink-splat pool to a WebGPU compute pass so combat against 27 mobs and the boss's AoE bursts stops looping every particle on the JS thread.
20. **Render bundles for static world** — Record the static valley batch (terrain, structures, lanterns) once into a WebGPU render bundle and replay it, cutting per-frame CPU command encoding.
21. **Compute frustum cull** — Implement a compute-shader cull on the WebGPU path so the 200x200 valley submits only visible mobs, structures and vegetation each frame.
22. **Adapter-lost graceful reload** — Probe for a stable adapter and fall back to WebGL on adapter loss, since the Electron launcher and LAN friends run different GPUs and drivers.
23. **Benchmark the boss fight on both paths** — Measure WebGPU vs WebGL draw-call throughput on the shrine-hill fight (telegraphs, cone/line/beam decals, enrage particles) before making WebGPU the default.
24. **Keep the composer native** — Run MSAA, tone-mapping and the colour-space final pass natively on whichever backend, so the ink-wash grade and the photosensitive-safe filter stay identical across WebGL and WebGPU.

25. **Cache procedural generation by seed** — Generate Cloudmist Valley geometry, terrain and ground texture once from a seed+params hash and reuse it, instead of rebuilding procedural models on every cold login.
26. **Warm the ground texture in a worker** — Pre-render the 1024 ground texture and detail noise in a Web Worker during the login screen, removing the multi-frame canvas paint hitch on Enter the World.
27. **Stream avatar art by kind** — Build avatars on demand by class and mob family (Sword Cultivator, Talisman Master, Physician, the six mob families plus the Stone Guardian) rather than constructing every mesh at login.
28. **Defer world-map tiles** — Build the fog-of-war tiles and the atlas/merit place markers only when the world map (N) first opens, since that data is read on demand and never in combat.
29. **Version the font and icon assets** — Put the Ma Shan Zheng / Noto Serif Latin subsets and the vector pictogram sprite sheet behind hashed manifest entries so the paper-scroll UI caches them across sessions.
30. **Lazy-load boss audio and rune art** — Load the boss gong/war-drum stem and Stone Guardian rune textures only when the first telegraph fires, not during zone load.
31. **Lazy-load gear and recipe icons** — Decode the 6 gear-slot icons and 10 recipe thumbnails across all 4 rarity variants on first open of the gear/journal panel, not at login.
32. **Prefetch R2 fonts from Workers** — Warm the font/icon assets over HTTP/2 from the Cloudflare Workers site during the login screen so the LAN and Electron builds reuse the same browser cache.

33. **Kill per-frame vector/matrix churn** — Reuse scratch `THREE.Vector3`/`Matrix4` in entity updates, camera and telegraph handling instead of allocating each frame, removing GC pressure that stutters the 20 Hz tick.
34. **Ring-buffer the telegraph Dangers** — Reuse a fixed pool (already capped at 14) for the Stone Guardian's slams, cones, lines and beams so combat never churns short-lived allocations.
35. **Pool float arrays and text nodes** — Reuse the particle color/size/alpha TypedArrays and damage-number DOM nodes so a Thunder Talisman AoE over a bamboo pack doesn't trigger minor GC pauses.
36. **Dispose geometry on rebind** — Free geometries and their hull/outline clones for every mob/player in `dispose()` and `rebind()`, since reconnect clears all entities but must also drop GPU buffers.
37. **Track renderer.info memory** — Record `renderer.info.memory.geometries/textures` over a long session and fail a regression test if either climbs while idle in the plaza, catching leaks the headless bot suite would miss.
38. **Cap the material caches** — Keep the `toonGradient` texture and cached `MeshToonMaterial`/outline maps bounded and allocation-free during play instead of growing per material-key variation.
39. **Reuse serpent segment buffers** — Share the Jade Serpent's segmented coil buffers across its population instead of rebuilding each serpent's body from scratch at spawn.
40. **Fixed TypedArrays for prediction** — Store the 20 Hz input/prediction and dodge-roll temporaries in fixed buffers so the 15-Qi dash and skill casts don't allocate under a full party.

41. **Mobile resolution scaler** — Step the composer's render target from 100% down to ~50% while keeping the pixel-ratio-1 canvas, so phones hold 60 fps in the bamboo grove and shrine hill.
42. **Gate ink-grain fragment work** — Skip the close-range dry-brush strokes and drifting cloud-shadow samples in the performance mode so mobile GPUs aren't overdrawing per pixel.
43. **Shrink ambient particle pools on mobile** — Cut the mist, petal and lantern-glow pool sizes by a mobile tier while keeping the combat ink-splat and jade heal bursts intact.
44. **Touch controls on the same axes** — Add a virtual joystick plus 1-4 skill and dodge buttons that feed the existing input axes, so mobile taps map to the same 20 Hz input messages with no server change.
45. **Mobile far-fog tuning** — Tighten the mist fog density and draw distance on mobile to hide reduced geometry while preserving the layered-mountain palette.
46. **Disable MSAA and lights on mobile** — Turn off the composer MSAA and any dynamic-light pass on integrated mobile GPUs while keeping the paper-scroll HUD at native resolution.
47. **Mobile safe defaults** — Default the mobile performance mode to `reduceMotion`, camera shake off and safeFlash on, reusing the existing accessibility settings instead of new toggles.
48. **Phone LAN test with snapshot budget** — Test the `?server=ws://...` flow on a phone against a desktop host and budget the JSON full-state snapshot decode on a mid-range device, since snapshots are full state today.

49. **Adaptive quality governor** — Lower composer MSAA/pixel ratio when the smoothed `fpsAvg` drops below ~55 for two seconds and restore it after, so the shrine-hill boss fight self-tunes to a steady 60.
50. **Keep simulation off the render clock** — Guarantee the fixed 20 Hz input send never waits on a slow GPU frame; the existing `setInterval` pump already does this but should be profiled under heavy combat.
51. **Budget the enrage phase** — Cap simultaneous telegraph decals and ink-splat particles during the Stone Guardian's enrage so the 3-phase fight stays within one 16.6 ms frame.
52. **Single-blit composer** — Collapse the post pass to one blit + tone-map instead of multiple full-screen passes, since each pass multiplies fill-rate cost over the 200x200 valley view.
53. **No runtime geometry merges** — Forbid `mergeGeometries` or buffer rebuilds during play; any batching for boss phase swaps or props must run in a warm-up frame or behind a fade, never mid-tick.
54. **Throttle the HUD DOM** — Update nameplates and damage numbers on a throttled (not per-frame) cadence so 27 mobs and a party don't force style recalc every 16.6 ms.
55. **Cache terrain height lookups** — Cache `heightAt()` samples around the player, since the follow camera calls it every frame and the analytic fbm height field is the hot path.
56. **Render vs input clocks** — Use `requestAnimationFrame` only for rendering and keep the `setInterval` pump as the simulation clock, so a throttled background tab still drives the 20 Hz server movement.

57. **Bake the sun into the toon gradient** — Replace real-time shadow maps with a static light term in the three-band gradient, since the cel look already reads as light/shadow and avoids a second geometry pass.
58. **Radial ink-blob ground shadows** — Fake soft shadows under mobs and players with a cheap radial ink sprite instead of shadow maps, grounding all 27 mobs and the boss without re-rendering the valley.
59. **Lanterns as emissive + sprites** — Keep paper-lantern glow as emissive toon material and additive point sprites rather than dynamic point lights, preserving the night ambience with zero light pass.
60. **Bake the boss rune glow** — Paint the shrine courtyard's dull vermilion rune ring into the ground texture and pulse a separate additive decal instead of a dynamic light that would light the whole hill.
61. **Enforce zero dynamic lights** — Cap active dynamic lights to zero (or one for the level-up pillar) and assert it in debug, since the flat painterly palette never needs real lights.
62. **Day/night as a shader uniform** — Drive the day/night tint through a uniform on the toon gradient instead of swapping light intensities, so dusk and dawn in the valley cost nothing extra.
63. **Terrain detail LOD term** — Fade out the extra detail-texture and cloud-shadow samples with distance so the close-range ink wash stays rich while far ground stays cheap.
64. **One shared fog uniform** — Use a single mist fog (color, density, near/far) across every toon, outline and particle shader so the heavy layered fog is consistent and computed once.

65. **Pool mob avatars by family** — Reuse the body/outline geometry for each of the six mob families (Bamboo Spirit, Fox Spirit, Jade Serpent, Lotus Toad, Stone Hound, rare Old Whisker) so respawns don't rebuild procedural meshes.
66. **Pool player avatars by class** — Reuse one avatar per class (Sword Cultivator, Talisman Master, Physician) and re-skin on name/gear change, so other players joining a LAN server never cause a build hitch.
67. **Pool serpent segments separately** — Reuse the Jade Serpent's segmented coil meshes independently, since its lunge/poison animation morphs more segments than other mobs.
68. **Pool telegraph ground decals** — Reuse circle/cone/line/sweeping-beam decal meshes with a wind-up shader uniform instead of allocating one per Stone Guardian slam.
69. **Pool HUD text nodes** — Reuse damage-number and nameplate nodes so a crit across a bamboo pack reuses text instead of creating dozens of DOM elements.
70. **Pool ink and heal particles** — Reuse the ink-splat hit/crit bursts and the jade heal particles so every Jade Needle or Spring Rain cast doesn't allocate new buffers.
71. **Pool the boss phase bodies** — Keep the Stone Guardian's three phase meshes in a pool that swaps on phase change, avoiding geometry rebuild at each transition.
72. **Entity freelist with an assert** — Add a global freelist so `EntityManager` can assert it never exceeds the valley's population (27 mobs + boss + party + the six NPCs: Elder Lin, Wu, Tao, Hao, Mei, Fen).

73. **Per-frame timeline in `window.__jz`** — Extend the debug object to expose a frame timeline (CPU, GPU, draw calls, triangles, GC) so the test harness can assert real-GPU 60 fps targets, not just software rendering.
74. **Draw-call hotspot overlay** — Label the biggest render groups (terrain, bamboo batch, mob avatars, UI) in the debug HUD so regressions are visible during a live Stone Guardian fight.
75. **Boss-fight backend benchmark** — Record `renderer.info.render.calls/triangles` around the boss fight and compare WebGL vs WebGPU in an automated page, since real-GPU numbers were never measured.
76. **Opt-in telemetry beacon** — Post fps/draw-call stats to the Cloudflare Workers site from consenting players so the team sees field numbers from the Windows/macOS machines they never ran.
77. **Profile pump vs interval separately** — Attribute input-send cadence and render cost to the right subsystem by profiling `pump()` and the `setInterval` fallback independently under slow frames.
78. **Worst-case stress scene** — Add a `?debug=1` scene that spawns all 27 mobs plus the boss to reproduce worst-case draw calls in headless Chromium before each release.
79. **Log shader compile counts** — Record shader-program count and compile time at startup on both backends so material-key proliferation in toon/outline variants is caught early.
80. **Frame-budget report** — Use the existing `renderer.info.autoReset=false` per-frame reset to emit a budget report when a frame exceeds 16.6 ms, tagging the culprit (entities, world update, vfx, composer).
