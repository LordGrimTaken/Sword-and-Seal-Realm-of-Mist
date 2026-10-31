import { audio } from "../audio/instance";
import { settings, type ColorMode } from "./settings";

const CONTROLS: Array<[string, string]> = [
  ["W A S D / arrows", "Move (relative to the camera)"],
  ["Right-mouse drag", "Orbit the camera"],
  ["Mouse wheel", "Zoom"],
  ["Left click", "Select target · click an NPC to speak"],
  ["Tab / Esc", "Cycle hostile targets / clear target"],
  ["1 2 3 4", "Use hotbar skills (hover a skill for details)"],
  ["Space", "Dodge roll: dash with brief invulnerability (costs Qi)"],
  ["F", "Speak to the nearest NPC · open a nearby treasure cache"],
  ["L", "Quest log"],
  ["G", "Gear: equip armour, charms and weapons; drink potions"],
  ["J", "Journal: side quests, merit seals, titles and atlas"],
  ["I", "Bag (search, sort and filter your items)"],
  ["N or click the minimap", "World map (explored areas are revealed)"],
  ["B", "Notice Board (daily tasks and rewards)"],
  ["Shift+B", "Bestiary: every mob you have discovered and its kill count"],
  ["C", "Combat log: recent damage dealt/taken, crits and heals"],
  ["V", "Session statistics: kills, damage, healing, XP and time"],
  ["P", "Spirit companion: toggle the lantern-wisp that follows you"],
  ["R", "Spirit-sword mount: ride the flying jian (faster travel; casting dismounts)"],
  ["O", "Party: members, invites and the leader (/invite Name to start one)"],
  ["Trading", "Trade with a nearby player: /trade Name · /trade accept · /trade decline · /trade cancel"],
  ["Enter", "Chat (Enter sends, Esc cancels) · /quest · /invite Name · /accept · /leave · /trade Name"],
  ["M", "Mute / unmute"],
  ["F1 or ?", "This window (Controls, Sound, Display, Access)"],
  ["F11 / F12", "Fullscreen / devtools (desktop app)"],
  ["Veiled foes", "The Hollow Bride is immune while her veil is up — dodge the lashes, then burst while she is revealed"],
];

export interface HelpOptions {
  onLowRes(on: boolean): void;
  getLowRes(): boolean;
  /** "What's new" button: open the client-side patch-notes window (the help window closes first). */
  onPatchNotes?(): void;
}

type TabId = "controls" | "sound" | "display" | "access";
const TABS: Array<[TabId, string]> = [["controls", "Controls"], ["sound", "Sound"], ["display", "Display"], ["access", "Access"]];

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** F1 / ? window: Controls, Sound (mixer), Display and Access tabs. Settings persist (versioned) and can be exported or imported as text. */
export class HelpOverlay {
  private el: HTMLElement;
  private tab: TabId = "controls";
  constructor(root: HTMLElement, private opt: HelpOptions) {
    this.el = document.createElement("div");
    this.el.id = "help";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Help and settings");
    const slider = (id: string, label: string, min: number, max: number, step: number) =>
      `<label class="srow"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" /><output data-for="${id}"></output></label>`;
    const check = (id: string, label: string, hint = "") =>
      `<label class="crow"><input type="checkbox" id="${id}" /><span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
    this.el.innerHTML = `
      <div class="panel hp">
        <div class="rodt"></div>
        <h3><span class="brush">Settings</span> <span class="amp">&amp;</span> Help</h3>
        <div class="jz-tabs" role="tablist">${TABS.map(([id, n]) => `<button type="button" class="jz-tab" role="tab" data-quiet data-tab="${id}" aria-selected="false">${n}</button>`).join("")}</div>
        <div class="tp" data-pane="controls" role="tabpanel">
          <table>${CONTROLS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join("")}</table>
          <p class="hint">Keys are fixed in this build. Rebinding is planned.</p>
        </div>
        <div class="tp set" data-pane="sound" role="tabpanel">
          ${slider("s-master", "Master", 0, 100, 5)}
          ${slider("s-music", "Music", 0, 100, 5)}
          ${slider("s-amb", "Ambience", 0, 100, 5)}
          ${slider("s-sfx", "Effects", 0, 100, 5)}
          ${slider("s-ui", "Interface", 0, 100, 5)}
          ${check("s-mute", "Mute all sound (M)")}
          ${check("s-blur", "Mute when the window is in the background")}
          ${check("s-hover", "Soft tick when hovering buttons")}
          <div class="dbt"><button class="btn sm" type="button" id="s-test">Play test sounds</button></div>
        </div>
        <div class="tp set" data-pane="display" role="tabpanel">
          <div class="crow seg"><span>Text size</span><span class="segs" role="group" aria-label="Text size">${[1, 1.25, 1.5].map((v) => `<button type="button" data-quiet data-ts="${v}" aria-pressed="false">${pct(v)}</button>`).join("")}</span></div>
          ${slider("s-chatsize", "Chat text", 11, 18, 0.5)}
          ${slider("s-chatop", "Chat opacity", 35, 100, 5)}
          ${check("s-stamps", "Chat timestamps")}
          <h4>Floating numbers</h4>
          ${check("s-d-dealt", "Damage you deal")}
          ${check("s-d-taken", "Damage you take")}
          ${check("s-d-heal", "Healing")}
          ${check("s-d-status", "Status text (Dodged!, XP)")}
          ${check("s-d-simple", "Simple critical hits", "No ink splash behind critical numbers")}
          ${slider("s-d-scale", "Number size", 60, 180, 10)}
          ${check("s-low", "Performance mode", "Render at 1x resolution")}
        </div>
        <div class="tp set" data-pane="access" role="tabpanel">
          <label class="srow"><span>Colour assist</span><select id="s-cb"><option value="off">Off</option><option value="protan">Protanopia (red-weak)</option><option value="deutan">Deuteranopia (green-weak)</option><option value="tritan">Tritanopia (blue-weak)</option></select><output></output></label>
          ${check("s-cues", "Pattern cues", "Hatched Qi bar, signs on damage numbers (automatic with colour assist)")}
          ${check("s-contrast", "High contrast", "Darker panels, heavier outlines")}
          ${check("s-motion", "Reduce motion", "Calms panel animations and banners")}
          ${check("s-safe", "Photosensitivity safe mode", "No hit flashes or strobing effects")}
          ${check("s-font", "Plain heading font", "Replace brush lettering with a clear serif")}
          ${slider("s-shake", "Camera shake", 0, 150, 10)}
          <div class="xp">
            <textarea id="s-json" rows="3" spellcheck="false" aria-label="Settings text" placeholder="Export puts your settings here. Paste settings here and press Import to load them."></textarea>
            <div class="dbt"><button class="btn sm" type="button" id="s-exp">Export</button> <button class="btn sm" type="button" id="s-imp">Import</button> <button class="btn sm" type="button" id="s-reset">Reset all</button> <span class="msg" id="s-msg" role="status"></span></div>
          </div>
        </div>
        <div class="dbt"><button class="btn sm ghost" type="button" id="wnbtn">What's new</button><button class="btn sm" type="button" id="hc">Close</button></div>
        <div class="rodb"></div>
      </div>`;
    root.appendChild(this.el);
    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    const rng = (id: string) => q<HTMLInputElement>("#" + id);

    for (const b of this.el.querySelectorAll<HTMLElement>("[data-tab]")) b.addEventListener("click", () => { this.setTab(b.dataset.tab as TabId); audio.ui("tab"); });
    // tablist keyboard support: arrows move between tabs
    q(".jz-tabs").addEventListener("keydown", (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== "ArrowRight" && k !== "ArrowLeft") return;
      e.stopPropagation();
      const i = TABS.findIndex(([id]) => id === this.tab);
      const n = TABS[(i + (k === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0];
      this.setTab(n);
      q<HTMLElement>(`[data-tab="${n}"]`).focus();
    });

    // --- sound
    const bind = (id: string, get: () => number, set: (v: number) => void, fmt: (v: number) => string, scale = 1) => {
      const el = rng(id);
      const out = q<HTMLElement>(`output[data-for="${id}"]`);
      el.addEventListener("input", () => { const v = parseFloat(el.value) / scale; set(v); out.textContent = fmt(v); });
      return () => { el.value = String(Math.round(get() * scale)); out.textContent = fmt(get()); };
    };
    const refreshers: Array<() => void> = [
      bind("s-master", () => settings.get().vol.master, (v) => settings.set({ vol: { master: v }, muted: v > 0 ? false : settings.get().muted }), pct, 100),
      bind("s-music", () => settings.get().vol.music, (v) => settings.set({ vol: { music: v } }), pct, 100),
      bind("s-amb", () => settings.get().vol.amb, (v) => settings.set({ vol: { amb: v } }), pct, 100),
      bind("s-sfx", () => settings.get().vol.sfx, (v) => settings.set({ vol: { sfx: v } }), pct, 100),
      bind("s-ui", () => settings.get().vol.ui, (v) => settings.set({ vol: { ui: v } }), pct, 100),
      bind("s-chatsize", () => settings.get().chatSize, (v) => settings.set({ chatSize: v }), (v) => `${v}px`),
      bind("s-chatop", () => settings.get().chatOpacity, (v) => settings.set({ chatOpacity: v }), pct, 100),
      bind("s-d-scale", () => settings.get().dmg.scale, (v) => settings.set({ dmg: { scale: v } }), pct, 100),
      bind("s-shake", () => settings.get().shake, (v) => settings.set({ shake: v }), (v) => (v <= 0 ? "Off" : pct(v)), 100),
    ];
    const cb = (id: string, get: () => boolean, set: (v: boolean) => void) => {
      const el = rng(id);
      el.addEventListener("change", () => set(el.checked));
      refreshers.push(() => { el.checked = get(); });
    };
    cb("s-mute", () => settings.get().muted, (v) => settings.set({ muted: v }));
    cb("s-blur", () => settings.get().muteBlur, (v) => settings.set({ muteBlur: v }));
    cb("s-hover", () => settings.get().hoverTicks, (v) => settings.set({ hoverTicks: v }));
    cb("s-stamps", () => settings.get().chatStamps, (v) => settings.set({ chatStamps: v }));
    cb("s-d-dealt", () => settings.get().dmg.dealt, (v) => settings.set({ dmg: { dealt: v } }));
    cb("s-d-taken", () => settings.get().dmg.taken, (v) => settings.set({ dmg: { taken: v } }));
    cb("s-d-heal", () => settings.get().dmg.heal, (v) => settings.set({ dmg: { heal: v } }));
    cb("s-d-status", () => settings.get().dmg.status, (v) => settings.set({ dmg: { status: v } }));
    cb("s-d-simple", () => settings.get().dmg.simpleCrit, (v) => settings.set({ dmg: { simpleCrit: v } }));
    cb("s-low", () => this.opt.getLowRes(), (v) => this.opt.onLowRes(v));
    cb("s-cues", () => settings.get().cues, (v) => settings.set({ cues: v }));
    cb("s-contrast", () => settings.get().contrast, (v) => settings.set({ contrast: v }));
    cb("s-motion", () => settings.get().reduceMotion, (v) => settings.set({ reduceMotion: v }));
    cb("s-safe", () => settings.get().safeFlash, (v) => settings.set({ safeFlash: v }));
    cb("s-font", () => settings.get().plainFont, (v) => settings.set({ plainFont: v }));
    const sel = q<HTMLSelectElement>("#s-cb");
    sel.addEventListener("change", () => settings.set({ cb: sel.value as ColorMode }));
    refreshers.push(() => { sel.value = settings.get().cb; });
    for (const b of this.el.querySelectorAll<HTMLElement>("[data-ts]")) b.addEventListener("click", () => settings.set({ textScale: parseFloat(b.dataset.ts!) }));
    const segs = () => { for (const b of this.el.querySelectorAll<HTMLElement>("[data-ts]")) b.setAttribute("aria-pressed", String(parseFloat(b.dataset.ts!) === settings.get().textScale)); };
    refreshers.push(segs);
    this.refresh = () => refreshers.forEach((f) => f());
    settings.onChange(() => { if (this.isOpen) this.refresh(); });

    q("#s-test").addEventListener("click", () => {
      audio.ui("click");
      window.setTimeout(() => audio.hit(false), 220);
      window.setTimeout(() => audio.loot(2), 480);
      window.setTimeout(() => audio.warn(), 1300);
    });
    const msg = q<HTMLElement>("#s-msg");
    const json = q<HTMLTextAreaElement>("#s-json");
    q("#s-exp").addEventListener("click", () => {
      json.value = settings.toJson();
      json.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* ignore */ }
      msg.textContent = copied ? "Copied to the clipboard." : "Select and copy the text.";
    });
    q("#s-imp").addEventListener("click", () => {
      const err = settings.fromJson(json.value);
      msg.textContent = err ?? "Settings imported.";
      if (!err) { this.refresh(); this.opt.onLowRes(this.opt.getLowRes()); }
    });
    q("#s-reset").addEventListener("click", () => { settings.reset(); this.refresh(); msg.textContent = "Settings reset."; });

    // keys typed in the window's fields must not reach the game (Esc and F1 still close it)
    for (const i of this.el.querySelectorAll<HTMLElement>("input, select, textarea, button")) i.addEventListener("keydown", (e) => { if (e.key !== "Escape" && e.key !== "F1") e.stopPropagation(); });
    q("#hc").addEventListener("click", () => this.toggle(false));
    q("#wnbtn").addEventListener("click", () => { this.toggle(false); this.opt.onPatchNotes?.(); });
    this.el.addEventListener("pointerdown", (e) => { if (e.target === this.el) this.toggle(false); });
    this.setTab("controls");
    this.refresh();
    this.fit();
    window.addEventListener("resize", this.fit);
    settings.onChange(this.fit);
  }
  private refresh: () => void = () => undefined;

  /** Size the scrolling pane so the whole window fits the viewport at any text size. The window is zoomed by --tz, so the pane limit is given in unzoomed pixels. */
  private fit = () => {
    const tz = settings.get().textScale || 1;
    this.el.style.setProperty("--hp-max", `${Math.max(150, Math.min(430, Math.floor((window.innerHeight - 270) / tz)))}px`);
  };

  get isOpen() { return this.el.classList.contains("show"); }
  get activeTab(): TabId { return this.tab; }

  setTab(id: TabId) {
    this.tab = id;
    for (const p of this.el.querySelectorAll<HTMLElement>("[data-pane]")) p.hidden = p.dataset.pane !== id;
    for (const b of this.el.querySelectorAll<HTMLElement>("[data-tab]")) { const on = b.dataset.tab === id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle("on", on); }
  }

  /** Open (optionally on a given tab) or close. F1 always opens on Controls so the key list is the first thing a player sees. */
  toggle(force?: boolean, tab?: TabId) {
    const on = force ?? !this.isOpen;
    if (on) { this.setTab(tab ?? "controls"); this.refresh(); }
    this.el.classList.toggle("show", on);
    if (!on && this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); // a hidden focused control would swallow the next key press
    if (on) (this.el.querySelector(`[data-tab="${this.tab}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }
}
