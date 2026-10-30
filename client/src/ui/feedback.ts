import { settings } from "./settings";

/** Below this fraction of max health the wounded edge starts breathing (the low-HP warning threshold). */
const LOW_HP = 0.3;
/** Damage flash length: a brief beat measured in milliseconds, so a slow frame never stretches or stutters it. */
const FLASH_MS = 420;
/** One slow breath of the low-health edge (full cycle, in milliseconds). */
const PULSE_MS = 2600;
/** How long the low-health warning takes to fade in or out when the threshold is crossed. */
const LOW_FADE_MS = 450;
/** Edge strength of the damage beat and of the low-health warning when motion is reduced: one still edge, no strobe. */
const STILL_FLASH = 0.4;
const STILL_EDGE = 0.24;

/** Live OS "reduce motion" preference, cached once. It also covers stored settings that predate the preference. */
let motionQuery: MediaQueryList | null = null;
function osReducedMotion(): boolean {
  try {
    if (!motionQuery) motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    return motionQuery.matches;
  } catch { return false; }
}

/** Read-only snapshot for the debug surface (`window.__jz.combatFeedback`) and UI tests. */
export interface CombatFeedbackDebug {
  /** damage flashes triggered this session (0 in photosensitivity safe mode) */
  flashes: number;
  /** true while the local player is strictly below 30% health and alive */
  lowHp: boolean;
  /** opacity currently painted by the damage edge, 0..1 */
  flash: number;
  /** opacity currently painted by the low-health edge, 0..1 */
  edge: number;
  /** true when the overlay draws still edges instead of animating (reduced motion / safe flash) */
  still: boolean;
}

/**
 * Combat feedback overlay (client-only): a vermilion ink edge that flashes whenever the local player is struck
 * and breathes slowly while their health stays below 30%. Two full-screen, pointer-events:none layers are
 * inserted as the FIRST children of the HUD root, so they tint the edges of the 3D stage but paint underneath
 * every panel, nameplate and full-screen overlay and never take a click.
 *
 * The whole effect is time based (milliseconds) instead of a CSS animation: it is frame-rate independent and
 * can drop to a single still edge when motion is reduced. `damage()` is called from the game's damage-event
 * handler; `update()` is called once per frame with the local player's health fraction, and `reset()` clears it
 * when a reconnect replaces the session. It talks to nothing but the DOM and the settings store.
 */
export class CombatFeedback {
  private readonly flashEl: HTMLElement;
  private readonly edgeEl: HTMLElement;
  /** performance.now() when the current damage flash started (-1e9 = none). */
  private flashAt = -1e9;
  /** performance.now() when health first dropped under the threshold: the pulse phase is anchored here. */
  private lowSince = -1e9;
  /** Strictly below the threshold right now (the eased visual value is lowMix). */
  private low = false;
  /** 0..1 eased fade of the low-health edge, so crossing the threshold never pops. */
  private lowMix = 0;
  private flashes = 0;
  private lastNow = 0;
  private shownFlash = 0;
  private shownEdge = 0;

  constructor(root: HTMLElement) {
    this.flashEl = document.createElement("div");
    this.flashEl.className = "cbf cbf-flash";
    this.flashEl.setAttribute("aria-hidden", "true");
    this.edgeEl = document.createElement("div");
    this.edgeEl.className = "cbf cbf-lowhp";
    this.edgeEl.setAttribute("aria-hidden", "true");
    // first children of the HUD: above the stage, below every panel / nameplate / overlay added before or after
    root.insertBefore(this.flashEl, root.firstChild);
    root.insertBefore(this.edgeEl, root.firstChild);
  }

  /** The local player took a hit: restart the vermilion edge flash (a no-op in photosensitivity safe mode). */
  damage(now = performance.now()) {
    if (settings.get().safeFlash) return;
    this.flashes++;
    this.flashAt = now;
  }

  /** Forget the flash and the low-health edge (a reconnect starts a clean session). */
  reset() {
    this.flashAt = -1e9;
    this.lowSince = -1e9;
    this.low = false;
    this.lowMix = 0;
    this.flashes = 0;
    this.lastNow = 0;
    this.paint(0, 0);
  }

  /**
   * Per frame. `hpFrac` is the local player's health / max health; pass 1 while dead or before the first
   * snapshot, so a death never leaves the warning edge breathing under the death screen.
   *
   * Normal motion: the flash is a 420 ms decay, the low-health edge is a 2.6 s breath between 12% and 28% opacity.
   * Reduced motion: the flash becomes one still edge and the low-health edge holds a steady 24% (no pulse).
   * Photosensitivity safe mode: no hit flash at all, low-health edge still and steady.
   */
  update(hpFrac: number, now = performance.now()) {
    const st = settings.get();
    const still = st.reduceMotion || st.safeFlash || osReducedMotion();
    const dt = this.lastNow > 0 ? Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000)) : 1 / 60;
    this.lastNow = now;

    // ---- low health: strictly under 30% while alive, eased in and out
    const frac = Number.isFinite(hpFrac) ? hpFrac : 1;
    const low = frac > 0 && frac < LOW_HP;
    if (low && !this.low) this.lowSince = now;
    this.low = low;
    const goal = low ? 1 : 0;
    const step = (dt * 1000) / LOW_FADE_MS;
    this.lowMix = this.lowMix < goal ? Math.min(goal, this.lowMix + step) : Math.max(goal, this.lowMix - step);

    let edge = 0;
    if (this.lowMix > 0 && still) edge = STILL_EDGE * this.lowMix; // steady edge under reduced motion / safe mode
    else if (this.lowMix > 0) {
      const breath = 0.5 - 0.5 * Math.cos(((now - this.lowSince) / PULSE_MS) * Math.PI * 2);
      edge = (0.12 + 0.16 * breath) * this.lowMix;
    }

    // ---- damage flash: a fast vermilion beat; reduced motion gets one still edge, safe mode nothing at all
    let flash = 0;
    const age = now - this.flashAt;
    if (!st.safeFlash && age >= 0 && age < FLASH_MS) flash = still ? STILL_FLASH : 0.85 * (1 - age / FLASH_MS) ** 1.6;

    this.paint(flash, edge);
  }

  /** Read-only snapshot for the debug surface / UI tests. */
  debug(): CombatFeedbackDebug {
    const st = settings.get();
    return {
      flashes: this.flashes,
      lowHp: this.low,
      flash: this.shownFlash,
      edge: this.shownEdge,
      still: st.reduceMotion || st.safeFlash || osReducedMotion(),
    };
  }

  /** Write an opacity only when it visibly changes (this runs every frame). */
  private paint(flash: number, edge: number) {
    const f = Math.round(flash * 1000) / 1000, e = Math.round(edge * 1000) / 1000;
    if (f !== this.shownFlash) { this.shownFlash = f; this.flashEl.style.opacity = String(f); }
    if (e !== this.shownEdge) { this.shownEdge = e; this.edgeEl.style.opacity = String(e); }
  }
}
