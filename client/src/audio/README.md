# JIUZHOU audio (procedural WebAudio, no assets)

```ts
import { createGameAudio } from "./audio";
const audio = createGameAudio();           // no AudioContext yet; every call is a safe no-op until resume()
```

API (`GameAudio`): `resume, setMasterVolume(0..1), setMuted, isMuted, startAmbient, stopAmbient,
ui("click"|"open"|"close"|"error"|"chat"|"target"), cast(skill 1..4, cls), hit(crit), death, levelUp,
loot, mobDeath, bossRoar, warn (boss gong), impact (slam thud), footstep, setListenerIntensity(0..1)`.

## Wiring
1. First gesture: `addEventListener("pointerdown"|"keydown", () => { audio.resume(); audio.startAmbient(); }, { once: true })`.
   `startAmbient()` called earlier is remembered and starts once the context is running.
2. Events (`GameEvent`): `damage` -> `audio.hit(e.crit)` (only when local player is src or dst);
   `cast` -> `audio.cast(e.skill, cls of e.src)` (also on local hotbar press for instant feedback; avoid double-play);
   `death` -> `mobDeath()` for mobs, `death()` for local player, `bossRoar()` when boss spawns/aggros;
   `levelup` -> `levelUp()`; `loot` -> `loot()`; `chat` -> `ui("chat")`.
3. UI: `ui("click")` on buttons, `open`/`close` on panels, `error` on failed cast, `target` on target change.
4. Each frame (or on state change) while moving: `footstep()` every ~0.35 s (internally throttled 160 ms).
5. Combat music: `audio.setListenerIntensity(inCombat ? 1 : 0)` (call every frame/tick is fine; fade it client-side if you want smoother).
6. Settings: `setMasterVolume(v)`, `setMuted(m)` (e.g. M key).

Safety: calls never throw; one-shots are rate-limited and polyphony-capped (28 voices); master compressor + tanh soft clip keeps output below 0 dBFS.

## Self-test
`selftest.ts` renders every sound in an `OfflineAudioContext` and reports peak/RMS (`window.__audioSelfTest()`).
Run: `node scripts/audio-selftest.mjs` (bundles `selftest.ts` with vite/esbuild into a temp dir, renders every sound in headless chromium and fails on SILENT/CLIPPING).
