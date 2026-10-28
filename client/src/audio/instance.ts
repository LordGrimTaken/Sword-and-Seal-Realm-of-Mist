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
    warn: wrap("warn", undefined), impact: wrap("impact", undefined), footstep: wrap("footstep", undefined),
    setListenerIntensity: wrap("setListenerIntensity", undefined),
  };
}

export const audio: GameAudio = safe();

/** First user gesture unlocks WebAudio and starts the ambient bed; also click sounds on buttons. */
export function installAudioGestures() {
  const unlock = () => { audio.resume(); audio.startAmbient(); };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest && t.closest("button, .btn, .cc")) audio.ui("click");
  }, true);
  let vol = 0.7, muted = false;
  try { vol = parseFloat(localStorage.getItem("jz.vol") ?? "0.7"); muted = localStorage.getItem("jz.mute") === "1"; } catch { /* ignore */ }
  if (!isFinite(vol)) vol = 0.7;
  audio.setMasterVolume(vol);
  audio.setMuted(muted);
}
