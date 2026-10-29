// Player settings: one versioned object persisted to localStorage, applied to the audio buses and to the document (CSS variables and data attributes).
// UI code reads values through `settings.get()` and reacts to `settings.onChange()`. Everything is wrapped so a blocked localStorage never breaks the game.
import { audio, setHoverTicks } from "../audio/instance";

export type ColorMode = "off" | "protan" | "deutan" | "tritan";

export interface Settings {
  v: 1;
  vol: { master: number; music: number; amb: number; sfx: number; ui: number };
  muted: boolean;
  muteBlur: boolean;
  hoverTicks: boolean;
  /** Reading size of panels, chat, tooltips and dialogs: 1, 1.25 or 1.5. */
  textScale: number;
  chatSize: number;
  chatOpacity: number;
  chatStamps: boolean;
  dmg: { dealt: boolean; taken: boolean; heal: boolean; status: boolean; scale: number; simpleCrit: boolean };
  cb: ColorMode;
  cues: boolean;
  contrast: boolean;
  reduceMotion: boolean;
  safeFlash: boolean;
  plainFont: boolean;
  /** Camera shake strength, 0 (off) to 1.5. Read by the camera. */
  shake: number;
}

const KEY = "jz.settings.v1";

function defaults(): Settings {
  let rm = false;
  try { rm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* ignore */ }
  return {
    v: 1,
    vol: { master: 0.7, music: 1, amb: 1, sfx: 1, ui: 1 },
    muted: false, muteBlur: false, hoverTicks: true,
    textScale: 1, chatSize: 12.5, chatOpacity: 1, chatStamps: false,
    dmg: { dealt: true, taken: true, heal: true, status: true, scale: 1, simpleCrit: false },
    cb: "off", cues: false, contrast: false, reduceMotion: rm, safeFlash: false, plainFont: false, shake: 1,
  };
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Merge untrusted data (storage or an imported file) over the defaults, clamping every field. */
export function sanitize(raw: unknown): Settings {
  const d = defaults();
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const vol = (r.vol && typeof r.vol === "object" ? r.vol : {}) as Record<string, unknown>;
  const dm = (r.dmg && typeof r.dmg === "object" ? r.dmg : {}) as Record<string, unknown>;
  const cb = r.cb === "protan" || r.cb === "deutan" || r.cb === "tritan" ? r.cb : "off";
  return {
    v: 1,
    vol: { master: num(vol.master, 0, 1, d.vol.master), music: num(vol.music, 0, 1, 1), amb: num(vol.amb, 0, 1, 1), sfx: num(vol.sfx, 0, 1, 1), ui: num(vol.ui, 0, 1, 1) },
    muted: bool(r.muted, d.muted), muteBlur: bool(r.muteBlur, d.muteBlur), hoverTicks: bool(r.hoverTicks, d.hoverTicks),
    textScale: [1, 1.25, 1.5].includes(r.textScale as number) ? (r.textScale as number) : 1,
    chatSize: num(r.chatSize, 11, 18, d.chatSize), chatOpacity: num(r.chatOpacity, 0.35, 1, 1), chatStamps: bool(r.chatStamps, false),
    dmg: { dealt: bool(dm.dealt, true), taken: bool(dm.taken, true), heal: bool(dm.heal, true), status: bool(dm.status, true), scale: num(dm.scale, 0.6, 1.8, 1), simpleCrit: bool(dm.simpleCrit, false) },
    cb, cues: bool(r.cues, false), contrast: bool(r.contrast, false), reduceMotion: bool(r.reduceMotion, d.reduceMotion), safeFlash: bool(r.safeFlash, false),
    plainFont: bool(r.plainFont, false), shake: num(r.shake, 0, 1.5, 1),
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
    // first run with the new panel: carry over the old master volume and mute keys
    const s = defaults();
    const v = parseFloat(localStorage.getItem("jz.vol") ?? "");
    if (Number.isFinite(v)) s.vol.master = Math.min(1, Math.max(0, v));
    s.muted = localStorage.getItem("jz.mute") === "1";
    return s;
  } catch { return defaults(); }
}

/** Colour-assist matrices: simulate the deficiency (Machado et al., full severity), then push the lost red/green or blue/yellow contrast into the channels that remain visible. */
const SIM: Record<Exclude<ColorMode, "off">, number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const SHIFT: Record<Exclude<ColorMode, "off">, number[]> = {
  protan: [1, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  deutan: [1, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  tritan: [1, 0, 0.7, 0, 1, 0.7, 0, 0, 1],
};
export function assistMatrix(mode: Exclude<ColorMode, "off">): number[] {
  const S = SIM[mode], C = SHIFT[mode];
  // M = I + C * (I - S)
  const E = S.map((v, i) => (i % 4 === 0 ? 1 : 0) - v);
  const M: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let acc = r === c ? 1 : 0;
    for (let k = 0; k < 3; k++) acc += C[r * 3 + k] * E[k * 3 + c];
    M.push(acc);
  }
  return M;
}

function installFilters() {
  if (document.getElementById("jz-cb-filters")) return;
  const rows = (["protan", "deutan", "tritan"] as const).map((m) => {
    const M = assistMatrix(m);
    const v = [M[0], M[1], M[2], 0, 0, M[3], M[4], M[5], 0, 0, M[6], M[7], M[8], 0, 0, 0, 0, 0, 1, 0].map((x) => x.toFixed(4)).join(" ");
    return `<filter id="jz-cb-${m}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${v}"/></filter>`;
  }).join("");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "jz-cb-filters";
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
  svg.innerHTML = `<defs>${rows}</defs>`;
  document.body.appendChild(svg);
}

type Listener = (s: Settings) => void;

class Store {
  private s: Settings = load();
  private ls: Listener[] = [];
  private inited = false;

  get(): Settings { return this.s; }
  onChange(fn: Listener): () => void { this.ls.push(fn); return () => { this.ls = this.ls.filter((x) => x !== fn); }; }

  /** Shallow patch with one level of nesting for `vol` and `dmg`. */
  set(patch: Partial<Omit<Settings, "vol" | "dmg">> & { vol?: Partial<Settings["vol"]>; dmg?: Partial<Settings["dmg"]> }) {
    const next = { ...this.s, ...patch, vol: { ...this.s.vol, ...(patch.vol ?? {}) }, dmg: { ...this.s.dmg, ...(patch.dmg ?? {}) } } as Settings;
    this.s = sanitize(next);
    this.save();
    this.apply();
    for (const f of this.ls) { try { f(this.s); } catch { /* a listener must never break settings */ } }
  }
  reset() { this.s = defaults(); this.save(); this.apply(); for (const f of this.ls) { try { f(this.s); } catch { /* ignore */ } } }

  toJson(): string { return JSON.stringify(this.s, null, 2); }
  /** Returns an error message, or null when the settings were imported. */
  fromJson(text: string): string | null {
    let o: unknown;
    try { o = JSON.parse(text); } catch { return "That is not valid settings text."; }
    if (!o || typeof o !== "object" || (o as { v?: unknown }).v !== 1) return "Those settings are from a different version.";
    this.s = sanitize(o); this.save(); this.apply();
    for (const f of this.ls) { try { f(this.s); } catch { /* ignore */ } }
    return null;
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
      localStorage.setItem("jz.vol", String(this.s.vol.master)); // kept for the early-boot audio gesture code
      localStorage.setItem("jz.mute", this.s.muted ? "1" : "0");
    } catch { /* ignore */ }
  }

  /** Push the current values into audio and the document. Safe to call repeatedly. */
  apply() {
    const s = this.s;
    audio.setMasterVolume(s.vol.master);
    audio.setMuted(s.muted);
    audio.setBusVolume("music", s.vol.music); audio.setBusVolume("amb", s.vol.amb);
    audio.setBusVolume("sfx", s.vol.sfx); audio.setBusVolume("ui", s.vol.ui);
    setHoverTicks(s.hoverTicks);
    this.blur();
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.cb = s.cb;
    root.dataset.cues = s.cues || s.cb !== "off" ? "1" : "0";
    root.dataset.contrast = s.contrast ? "high" : "normal";
    root.dataset.motion = s.reduceMotion ? "reduced" : "full";
    root.dataset.font = s.plainFont ? "plain" : "brush";
    root.dataset.safe = s.safeFlash ? "1" : "0";
    root.dataset.stamps = s.chatStamps ? "1" : "0";
    root.style.setProperty("--tz", String(s.textScale));
    root.style.setProperty("--chat-fs", `${s.chatSize}px`);
    root.style.setProperty("--chat-op", String(s.chatOpacity));
    root.style.setProperty("--fl-scale", String(s.dmg.scale));
    if (s.cb !== "off" && document.body) installFilters();
  }

  private blur() {
    try { audio.setBlurMuted(this.s.muteBlur && typeof document !== "undefined" && !document.hasFocus()); } catch { /* ignore */ }
  }

  init() {
    if (this.inited) return;
    this.inited = true;
    const refresh = () => this.blur();
    window.addEventListener("blur", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    this.apply();
  }
}

export const settings = new Store();
if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => settings.init());
  else settings.init();
}
