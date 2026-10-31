// 0.5.0 P3 "The Hollow Trial" client UI: a compact paper card that only appears while a run is live (wave, modifier chips,
// countdown + timer bar, Leave) plus the gate prompt ("F Start the Hollow Trial") projected over the fixed gate. The state
// is entirely server-authored: `{t:"trial", state}` arrives on login and on every change; this file is just a view and
// sends `start`/`leave` through the game's network bridge (the server validates range, cooldown and run uniqueness).
import * as THREE from "three";
import type { ServerMsg, TrialModifierId, TrialStateView } from "@shared/protocol";
import { esc, plain } from "./glyphs";

type TrialMsg = Extract<ServerMsg, { t: "trial" }>;

export interface TrialUiCallbacks {
  /** start / leave: forwarded to the server `{t:"trial"}` message; the server is authoritative. */
  send(a: "start" | "leave"): void;
  /** short HUD toast for start / clear / fail transitions (the chat log also carries the server's system lines). */
  toast(msg: string): void;
  /** ground height, so the gate prompt sits on the terrain (same art hook the other world prompts use). */
  heightAt(x: number, z: number): number;
}

/** Chip label + one-line explanation per rolled modifier (ids are the server's stable strings). */
const MODS: Record<TrialModifierId, { name: string; blurb: string }> = {
  swift: { name: "Swift", blurb: "Foes move 35% faster." },
  armoured: { name: "Armoured", blurb: "Foes have 40% more health." },
  frenzied: { name: "Frenzied", blurb: "Foes hit 30% harder." },
  sparse: { name: "Sparse", blurb: "Fewer foes each wave." },
};
/** Mirrors TRIAL.timeLimitSec: only used for the timer bar until the first active state arrives with its own endsIn. */
const FALLBACK_LIMIT = 300;

export class TrialUi {
  readonly el: HTMLElement;
  private readonly prompt: HTMLElement;
  private state: TrialStateView | null = null;
  private lastHtml = "";
  private lastPrompt = "";
  private endsAt = 0;      // performance.now() target for the current run's timer
  private maxEnds = 0;     // seconds the run started with (bar fraction)
  private cooldownAt = 0;  // performance.now() until the gate is ready again
  private shownResult = false;
  private readonly tmp = new THREE.Vector3();

  constructor(root: HTMLElement, private cb: TrialUiCallbacks) {
    this.el = document.createElement("div");
    this.el.id = "trial";
    this.el.className = "panel";
    this.el.setAttribute("role", "region");
    this.el.setAttribute("aria-label", "The Hollow Trial");
    this.el.addEventListener("click", (e) => {
      const a = ((e.target as HTMLElement).closest("[data-a]") as HTMLElement | null)?.dataset.a;
      if (a === "leave") this.cb.send("leave");
    });
    this.prompt = document.createElement("div");
    this.prompt.id = "trialprompt";
    root.appendChild(this.el);
    root.appendChild(this.prompt);
    this.render();
  }

  /** Fresh server state (login sync + every change). Toasts only on real transitions. */
  set(m: TrialMsg) {
    const next = m.state;
    const prev = this.state;
    this.state = next;
    const now = performance.now();
    this.cooldownAt = now + Math.max(0, next.cooldown || 0) * 1000;
    if (next.active) {
      if (next.endsIn > 0) { this.endsAt = now + next.endsIn * 1000; this.maxEnds = Math.max(this.maxEnds, next.endsIn); }
      if (!prev || !prev.active) { this.maxEnds = next.endsIn || FALLBACK_LIMIT; this.shownResult = false; this.cb.toast(`The Hollow Trial begins — wave ${next.wave}/${next.waves}.`); }
    }
    if (next.result && !this.shownResult) {
      this.shownResult = true;
      this.cb.toast(next.resultText || (next.result === "clear" ? "Hollow Trial cleared!" : "Hollow Trial failed."));
    }
    this.render();
  }

  /** Drop all state silently (reconnect / logout); the next login sync repopulates it. */
  clear() {
    this.state = null; this.lastHtml = ""; this.lastPrompt = ""; this.shownResult = false;
    this.el.innerHTML = ""; this.prompt.classList.remove("show");
    this.el.classList.remove("show");
  }

  dispose() { this.el.remove(); this.prompt.remove(); }

  /** True while a run is live (the HUD shows the panel). */
  get active(): boolean { return !!this.state?.active; }
  /** Read-only copy for the debug surface (window.__jz). */
  debug(): TrialStateView | null { return this.state; }

  private cooldownLeft(): number { return Math.max(0, Math.ceil((this.cooldownAt - performance.now()) / 1000)); }

  /** F interact: can the local player start a run right now? Sends `start` and returns true when it does. */
  tryStart(px: number, pz: number): boolean {
    const st = this.state;
    if (!st || st.active || this.cooldownLeft() > 0) return false;
    if (Math.hypot(st.gate.x - px, st.gate.z - pz) > st.startRange) return false;
    this.cb.send("start");
    return true;
  }

  /** Per-frame: countdown text/bar (server only pushes on changes) + the projected gate prompt. */
  update(camera: THREE.PerspectiveCamera, px: number, pz: number, canInteract: boolean) {
    const st = this.state;
    if (!st) { this.prompt.classList.remove("show"); return; }
    if (st.active) {
      const left = Math.max(0, (this.endsAt - performance.now()) / 1000);
      const bar = this.el.querySelector(".trbar i") as HTMLElement | null;
      if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / Math.max(1, this.maxEnds))).toFixed(3)})`;
      const time = this.el.querySelector(".trtime") as HTMLElement | null;
      if (time) {
        const total = Math.max(0, Math.ceil(left));
        time.textContent = total >= 60 ? `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s` : `${total}s`;
      }
    }
    // gate prompt: only while a run can be started (or to explain the recharge), never mid-fight
    const near = Math.hypot(st.gate.x - px, st.gate.z - pz) <= st.startRange;
    let html = "";
    if (near && canInteract) {
      if (st.active) html = "";
      else if (this.cooldownLeft() > 0) html = `Hollow Gate recharging — ${this.cooldownLeft()}s`;
      else html = `<kbd>F</kbd> Start the Hollow Trial`;
    }
    if (!html) { this.prompt.classList.remove("show"); return; }
    if (html !== this.lastPrompt) { this.prompt.innerHTML = html; this.lastPrompt = html; }
    const y = this.cb.heightAt(st.gate.x, st.gate.z);
    this.tmp.set(st.gate.x, y + 2.1, st.gate.z).project(camera);
    if (this.tmp.z > 1) { this.prompt.classList.remove("show"); return; }
    const W = window.innerWidth, H = window.innerHeight;
    this.prompt.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * H - 6).toFixed(1)}px) translate(-50%, -100%)`;
    this.prompt.classList.add("show");
  }

  private render() {
    const st = this.state;
    const show = !!st?.active;
    this.el.classList.toggle("show", show);
    if (!show) { if (this.lastHtml !== "") { this.el.innerHTML = ""; this.lastHtml = ""; } return; }
    // The timer bar/text are updated per frame from the local clock, so the HTML only carries the structure.
    const chips = st!.modifiers.map((id) => {
      const info = MODS[id] ?? { name: id, blurb: "" };
      return `<span class="trmod ${esc(id)}" title="${esc(info.blurb)}">${esc(info.name)}</span>`;
    }).join("");
    const html = `<div class="trh"><span class="brush">Hollow Trial</span><small>Wave ${st!.wave}/${st!.waves}</small><button type="button" class="trleave" data-a="leave" title="Leave the trial">Leave</button></div>
      <div class="trmods">${chips || `<span class="trmod none">No modifiers</span>`}</div>
      <div class="trbar"><i style="transform:scaleX(1)"></i></div>
      <div class="trfoot"><span class="trmobs">${st!.mobsLeft} ${st!.mobsLeft === 1 ? "foe" : "foes"} left</span><span class="trtime">--</span></div>
      <div class="trhint">Clear all ${st!.waves} waves before the timer runs out.</div>`;
    if (html !== this.lastHtml) { this.el.innerHTML = html; this.lastHtml = html; }
  }
}
