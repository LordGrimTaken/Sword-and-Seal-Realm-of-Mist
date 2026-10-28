import * as THREE from "three";

/** Impact "juice": hit-stop, camera nudge, white-ink flash, crit vignette. All time based (ms), so frame rate does not matter. */

const KEY = "jz.juice";

/** localStorage jz.juice ("0" / "off" / "false" disables; default on). ?nojuice=1 always wins. */
export function juiceEnabled(): boolean {
  try { if (new URLSearchParams(location.search).get("nojuice") === "1") return false; } catch { /* ignore */ }
  try {
    const v = (localStorage.getItem(KEY) ?? "").trim().toLowerCase();
    if (v === "0" || v === "off" || v === "false" || v === "no") return false;
  } catch { /* storage blocked: stay on */ }
  return true;
}

function reducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export const HIT_STOP_MS = { normal: 60, crit: 100, boss: 140 };
const NUDGE_MS = 120;
const NUDGE_PX = 3;
const FLASH_MS = 80;
const VIGNETTE_MS = 260;

export class Juice {
  enabled = juiceEnabled();
  /** counters for tests / debugging */
  stats = { hits: 0, stops: 0, lastStopMs: 0, nudges: 0, flashes: 0, vignettes: 0 };
  private stopLeft = 0;       // ms of frozen animation time still owed
  private nudgeAt = -1e9; private nudgeX = 0; private nudgeY = 0;
  private flash: { mats: THREE.MeshToonMaterial[]; at: number } | null = null;
  private vignetteAt = -1e9;
  private vig: HTMLElement | null = null;
  private viewSet = false;

  /** Start (or extend to) a hit-stop of `ms`. Never stacks beyond the longest request. */
  stop(ms: number) {
    if (!this.enabled) return;
    this.stopLeft = Math.max(this.stopLeft, ms);
    this.stats.stops++; this.stats.lastStopMs = ms;
  }

  /**
   * Consume this frame's real elapsed time (seconds) and return the time the animation / VFX clocks should advance.
   * Time based: a 60 ms stop swallows 60 ms of clock whether that takes 1 frame at 10 fps or 4 frames at 60 fps.
   */
  animDt(dt: number): number {
    if (this.stopLeft <= 0) return dt;
    const eat = Math.min(dt * 1000, this.stopLeft);
    this.stopLeft -= eat;
    return Math.max(0, dt - eat / 1000);
  }
  get frozen(): boolean { return this.stopLeft > 0; }

  /** Nudge toward screen direction (nx, ny), unit-ish, y up. */
  nudge(nx: number, ny: number, now: number) {
    if (!this.enabled || reducedMotion()) return;
    const l = Math.hypot(nx, ny) || 1;
    this.nudgeX = nx / l; this.nudgeY = ny / l; this.nudgeAt = now; this.stats.nudges++;
  }

  /** Apply the decaying nudge as a sub-pixel-exact view offset on the camera (stays in sync with HUD projection). */
  applyNudge(cam: THREE.PerspectiveCamera, now: number, W: number, H: number) {
    const age = now - this.nudgeAt;
    if (age >= NUDGE_MS || age < 0) {
      if (this.viewSet) { cam.clearViewOffset(); this.viewSet = false; }
      return;
    }
    const k = (1 - age / NUDGE_MS) ** 2 * NUDGE_PX;
    // scene shifts toward the hit direction: the view window moves the opposite way (y flips: screen y grows downward)
    cam.setViewOffset(W, H, -this.nudgeX * k, this.nudgeY * k, W, H);
    this.viewSet = true;
  }
  resetView(cam: THREE.PerspectiveCamera) { if (this.viewSet) { cam.clearViewOffset(); this.viewSet = false; } }

  /** White-ink emissive pop on the given baked body meshes. */
  flashOn(bodies: THREE.Object3D[], now: number) {
    if (!this.enabled) return;
    this.clearFlash();
    const mats: THREE.MeshToonMaterial[] = [];
    for (const o of bodies) {
      const m = (o as THREE.Mesh).material;
      for (const mm of Array.isArray(m) ? m : [m]) if ((mm as THREE.MeshToonMaterial).emissive) mats.push(mm as THREE.MeshToonMaterial);
    }
    if (!mats.length) return;
    this.flash = { mats, at: now };
    this.stats.flashes++;
    this.paintFlash(1);
  }
  private paintFlash(k: number) {
    if (!this.flash) return;
    for (const m of this.flash.mats) { m.emissive.setScalar(k); }
  }
  private clearFlash() { this.paintFlash(0); this.flash = null; }

  vignette(now: number) {
    if (!this.enabled) return;
    this.vignetteAt = now; this.stats.vignettes++;
  }

  /** Per frame: decay the flash and vignette. */
  tick(now: number) {
    if (this.flash) {
      const u = (now - this.flash.at) / FLASH_MS;
      if (u >= 1) this.clearFlash(); else this.paintFlash(0.9 * (1 - u * u) + 0.1);
    }
    const va = now - this.vignetteAt;
    if (va >= 0 && va < VIGNETTE_MS) {
      if (!this.vig) {
        this.vig = document.getElementById("jz-vignette") ?? Object.assign(document.createElement("div"), { id: "jz-vignette" });
        if (!this.vig.parentElement) document.body.appendChild(this.vig);
      }
      const u = va / VIGNETTE_MS;
      this.vig.style.opacity = String((1 - u) ** 1.5);
    } else if (this.vig && this.vig.style.opacity !== "0") this.vig.style.opacity = "0";
  }

  dispose(cam: THREE.PerspectiveCamera) {
    this.clearFlash(); this.resetView(cam); this.vig?.remove(); this.vig = null;
  }
}
