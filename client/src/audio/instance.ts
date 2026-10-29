// Shared, crash-proof audio singleton. Every call is wrapped so audio can never break the game.
import { createGameAudio, type GameAudio } from "./index";

function safe(): GameAudio {
  let real: GameAudio | null = null;
  try { real = createGameAudio(); } catch (e) { console.warn("audio unavailable", e); }
  const wrap = <K extends keyof GameAudio>(k: K, fallback: unknown) =>
    ((...a: unknown[]) => {
      if (!real) return fallback;
      try { return (real[k] as (...x: unknown[]) => unknown)(...a); } catch { return fallback; }
    }) as GameAudio[K];
  return {
    resume: wrap("resume", undefined), setMasterVolume: wrap("setMasterVolume", undefined),
    setMuted: wrap("setMuted", undefined), isMuted: wrap("isMuted", false),
    startAmbient: wrap("startAmbient", undefined), stopAmbient: wrap("stopAmbient", undefined),
    ui: wrap("ui", undefined), cast: wrap("cast", undefined), hit: wrap("hit", undefined),
    death: wrap("death", undefined), levelUp: wrap("levelUp", undefined), loot: wrap("loot", undefined),
    mobDeath: wrap("mobDeath", undefined), bossRoar: wrap("bossRoar", undefined),
    warn: wrap("warn", undefined), impact: wrap("impact", undefined), footstep: wrap("footstep", undefined), dodge: wrap("dodge", undefined),
    setListenerIntensity: wrap("setListenerIntensity", undefined),
    setBusVolume: wrap("setBusVolume", undefined), setBlurMuted: wrap("setBlurMuted", undefined), setBoss: wrap("setBoss", undefined),
    levels: wrap("levels", { master: 0, music: 0, amb: 0, sfx: 0, ui: 0, muted: false, blurMuted: false, boss: false }),
  };
}

export const audio: GameAudio = safe();

let hoverTicks = true;
/** Quiet tick when the pointer enters a button or slot (rate limited per element and globally). */
export function setHoverTicks(on: boolean) { hoverTicks = on; }

/** First user gesture unlocks WebAudio and starts the ambient bed; also click sounds on buttons. */
export function installAudioGestures() {
  const unlock = () => { audio.resume(); audio.startAmbient(); };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest && t.closest("button, .btn, .cc") && !t.closest("[data-quiet]")) audio.ui("click");
  }, true);
  let lastHover: Element | null = null;
  document.addEventListener("pointerover", (e) => {
    if (!hoverTicks) return;
    const t = (e.target as HTMLElement | null)?.closest?.("button, .btn, .slot, .jz-tab, .bi, [data-hover]") ?? null;
    if (t === lastHover) return;
    lastHover = t;
    if (t && (e as PointerEvent).pointerType !== "touch") audio.ui("hover");
  }, true);
  let vol = 0.7, muted = false;
  try { vol = parseFloat(localStorage.getItem("jz.vol") ?? "0.7"); muted = localStorage.getItem("jz.mute") === "1"; } catch { /* ignore */ }
  if (!isFinite(vol)) vol = 0.7;
  audio.setMasterVolume(vol);
  audio.setMuted(muted);
}
