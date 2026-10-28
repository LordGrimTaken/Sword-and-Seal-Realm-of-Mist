import { audio } from "../audio/instance";

const CONTROLS: Array<[string, string]> = [
  ["W A S D / arrows", "Move (relative to the camera)"],
  ["Right-mouse drag", "Orbit the camera"],
  ["Mouse wheel", "Zoom"],
  ["Left click", "Select target · click an NPC to speak"],
  ["Tab / Esc", "Cycle hostile targets / clear target"],
  ["1 2 3 4", "Use hotbar skills (hover a skill for details)"],
  ["F", "Speak to the nearest NPC"],
  ["L", "Quest log"],
  ["I", "Bag (items and materials)"],
  ["B", "Notice Board (daily tasks and rewards)"],
  ["Enter", "Chat (Enter sends, Esc cancels) · /quest"],
  ["M", "Mute / unmute"],
  ["F1 or ?", "This help window"],
  ["F11 / F12", "Fullscreen / devtools (desktop app)"],
];

export interface HelpOptions {
  onLowRes(on: boolean): void;
  getLowRes(): boolean;
}

/** F1 / ? settings and help overlay: controls, volume, render scale. */
export class HelpOverlay {
  private el: HTMLElement;
  constructor(root: HTMLElement, private opt: HelpOptions) {
    this.el = document.createElement("div");
    this.el.id = "help";
    this.el.innerHTML = `
      <div class="panel hp">
        <div class="rodt"></div>
        <h3><span class="brush">Help</span> <span class="amp">&amp;</span> Settings</h3>
        <table>${CONTROLS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join("")}</table>
        <div class="set">
          <label>Volume <input type="range" id="hv" min="0" max="100" step="5" /></label>
          <label><input type="checkbox" id="hm" /> Mute (M)</label>
          <label><input type="checkbox" id="hl" /> Performance mode: render at 1x resolution</label>
        </div>
        <div class="dbt"><button class="btn sm" type="button" id="hc">Close</button></div>
        <div class="rodb"></div>
      </div>`;
    root.appendChild(this.el);
    const vol = this.el.querySelector("#hv") as HTMLInputElement;
    const mute = this.el.querySelector("#hm") as HTMLInputElement;
    const low = this.el.querySelector("#hl") as HTMLInputElement;
    vol.addEventListener("input", () => {
      const v = parseInt(vol.value, 10) / 100;
      audio.setMasterVolume(v);
      try { localStorage.setItem("jz.vol", String(v)); } catch { /* ignore */ }
      const hv = document.getElementById("vol") as HTMLInputElement | null;
      if (hv) hv.value = vol.value;
    });
    mute.addEventListener("change", () => {
      audio.setMuted(mute.checked);
      try { localStorage.setItem("jz.mute", mute.checked ? "1" : "0"); } catch { /* ignore */ }
    });
    low.addEventListener("change", () => this.opt.onLowRes(low.checked));
    for (const i of [vol, mute, low]) i.addEventListener("keydown", (e) => { if (e.key !== "Escape" && e.key !== "F1") e.stopPropagation(); });
    (this.el.querySelector("#hc") as HTMLElement).addEventListener("click", () => this.toggle(false));
    this.el.addEventListener("pointerdown", (e) => { if (e.target === this.el) this.toggle(false); });
  }
  get isOpen() { return this.el.classList.contains("show"); }
  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    if (on) {
      const hv = document.getElementById("vol") as HTMLInputElement | null;
      (this.el.querySelector("#hv") as HTMLInputElement).value = hv?.value ?? "70";
      (this.el.querySelector("#hm") as HTMLInputElement).checked = audio.isMuted();
      (this.el.querySelector("#hl") as HTMLInputElement).checked = this.opt.getLowRes();
    }
    this.el.classList.toggle("show", on);
  }
}
