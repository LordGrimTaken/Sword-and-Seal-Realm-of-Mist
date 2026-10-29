import { WORLD_SIZE } from "@shared/protocol";
import { audio } from "../audio/instance";

/** Landmarks of Cloudmist Valley (world x/z, radius in world units). Mirrors the minimap's static layer. */
const LANDMARKS: Array<{ id: string; name: string; x: number; z: number; r: number; col: string; note: string }> = [
  { id: "plaza", name: "Spawn Plaza", x: 0, z: -80, r: 13, col: "rgba(242,234,216,.95)", note: "Paifang gate, pagoda and the elders" },
  { id: "pond", name: "Lotus Pond", x: 0, z: -34, r: 15.5, col: "rgba(95,140,150,.75)", note: "Jade Serpents coil by the stone bridge" },
  { id: "bamboo", name: "Bamboo Grove", x: -40, z: 10, r: 24, col: "rgba(79,165,139,.55)", note: "Bamboo Spirits, levels 1-3" },
  { id: "fox", name: "Fox Hills", x: 55, z: 30, r: 22, col: "rgba(201,146,70,.5)", note: "Fox Spirits, levels 3-6" },
  { id: "shrine", name: "Ruined Shrine", x: 0, z: 85, r: 14, col: "rgba(90,90,100,.55)", note: "The Stone Guardian waits here" },
];

const CELL = 10; // fog-of-war grid, world units per cell
const N = Math.ceil(WORLD_SIZE / CELL);
const REVEAL = 26; // world units around the player that become explored
const KEY = "jz.map.explored.v1";

interface Dot { x: number; z: number; k: "player" | "mob" | "npc"; dead: boolean; mob?: string }

/** Full-screen ink-wash parchment map (key N or a click on the minimap). Explored areas are revealed as the player walks; the rest stays under mist.
 *  The wheel zooms, dragging pans. Icons carry shape as well as colour (square = boss, diamond = serpent, ring = player, triangle = you). */
export class WorldMap {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private legend: HTMLElement;
  private fog = new Uint8Array(N * N);
  private fogDirty = false;
  private fogVer = 0;
  private fogLayer: HTMLCanvasElement | null = null;
  private fogKey = "";
  private sprite: HTMLCanvasElement | null = null;
  private lastSave = 0;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private drag: { x: number; y: number; px: number; py: number } | null = null;
  private hover = "";
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private last: { me: { x: number; z: number }; yaw: number; dots: Dot[] } | null = null;

  constructor(root: HTMLElement, private onToggle: (open: boolean) => void = () => {}) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const a = JSON.parse(raw) as number[]; if (Array.isArray(a) && a.length === N * N) a.forEach((v, i) => { this.fog[i] = v ? 1 : 0; }); }
    } catch { /* ignore */ }
    this.el = document.createElement("div");
    this.el.id = "wmap";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "World map");
    this.el.innerHTML = `<div class="panel wm">
      <div class="wmh"><span class="brush">Cloudmist Valley</span><small class="wmp"></small><button type="button" class="bx" data-a="close" aria-label="Close map">×</button></div>
      <div class="wmb"><canvas></canvas><div class="wmtip" aria-hidden="true"></div></div>
      <div class="wml"></div>
      <div class="wmf">N toggles the map · wheel to zoom · drag to pan · Esc closes</div>
    </div>`;
    root.appendChild(this.el);
    this.cv = this.el.querySelector("canvas") as HTMLCanvasElement;
    this.g = this.cv.getContext("2d")!;
    this.legend = this.el.querySelector(".wml") as HTMLElement;
    this.legend.innerHTML = [
      `<span><i class="lg tri"></i>You</span>`, `<span><i class="lg dotr"></i>Spirit</span>`, `<span><i class="lg sqr"></i>Boss</span>`,
      `<span><i class="lg dia"></i>Serpent</span>`, `<span><i class="lg dotg"></i>Villager</span>`, `<span><i class="lg dotj"></i>Player</span>`,
    ].join("");
    this.el.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-a=close]") || e.target === this.el) this.toggle(false); });
    this.el.addEventListener("keydown", (e) => { if (e.key !== "Escape" && e.key !== "n" && e.key !== "N") e.stopPropagation(); });
    const stage = this.el.querySelector(".wmb") as HTMLElement;
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom = Math.min(3, Math.max(1, this.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
      if (this.zoom === 1) { this.panX = 0; this.panY = 0; }
      this.redraw();
    }, { passive: false });
    stage.addEventListener("pointerdown", (e) => { this.drag = { x: e.clientX, y: e.clientY, px: this.panX, py: this.panY }; stage.setPointerCapture?.(e.pointerId); });
    stage.addEventListener("pointermove", (e) => {
      if (this.drag && this.zoom > 1) { this.panX = this.drag.px + (e.clientX - this.drag.x); this.panY = this.drag.py + (e.clientY - this.drag.y); this.redraw(); }
      this.hoverAt(e);
    });
    stage.addEventListener("pointerup", () => { this.drag = null; });
    stage.addEventListener("pointerleave", () => { this.hover = ""; (this.el.querySelector(".wmtip") as HTMLElement).classList.remove("show"); });
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== "KeyN" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return;
    this.toggle();
  };
  dispose() { window.removeEventListener("keydown", this.onKey); }

  get isOpen() { return this.el.classList.contains("show"); }
  /** Share of the valley explored so far, 0..1. */
  get explored(): number { let n = 0; for (const v of this.fog) n += v; return n / (N * N); }

  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    if (on === this.isOpen) return;
    this.el.classList.toggle("show", on);
    audio.ui(on ? "open" : "close");
    this.onToggle(on);
    if (on) this.redraw();
  }

  reset() { this.last = null; }

  /** Reveal fog around the player. Cheap enough to call every frame; the result is persisted at most every few seconds. */
  reveal(x: number, z: number) {
    const half = WORLD_SIZE / 2;
    const c0 = Math.floor((x - REVEAL + half) / CELL), c1 = Math.floor((x + REVEAL + half) / CELL);
    const r0 = Math.floor((z - REVEAL + half) / CELL), r1 = Math.floor((z + REVEAL + half) / CELL);
    for (let r = Math.max(0, r0); r <= Math.min(N - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(N - 1, c1); c++) {
      const cx = (c + 0.5) * CELL - half, cz = (r + 0.5) * CELL - half;
      if (Math.hypot(cx - x, cz - z) <= REVEAL && !this.fog[r * N + c]) { this.fog[r * N + c] = 1; this.fogDirty = true; this.fogVer++; }
    }
    const now = performance.now();
    if (this.fogDirty && now - this.lastSave > 4000) {
      this.fogDirty = false; this.lastSave = now;
      try { localStorage.setItem(KEY, JSON.stringify(Array.from(this.fog))); } catch { /* ignore */ }
    }
  }

  /** Per-frame update from the HUD. Drawing happens only while the window is open. */
  frame(me: { x: number; z: number }, yaw: number, dots: Dot[]) {
    this.reveal(me.x, me.z);
    this.last = { me, yaw, dots };
    if (this.isOpen) this.redraw();
  }

  private size(): number { const b = this.el.querySelector(".wmb") as HTMLElement; return Math.max(240, Math.floor(Math.min(b.clientWidth, b.clientHeight || b.clientWidth))); }

  /** world -> canvas pixels (north-up: -z is up). */
  private toPx(x: number, z: number, S: number): [number, number] {
    const k = (S / WORLD_SIZE) * this.zoom;
    return [S / 2 + this.panX * this.dpr + x * k, S / 2 + this.panY * this.dpr + z * k];
  }

  private hoverAt(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    const S = this.cv.width;
    const px = (e.clientX - r.left) * (S / r.width), py = (e.clientY - r.top) * (S / r.height);
    let hit = "";
    for (const l of LANDMARKS) {
      const [x, y] = this.toPx(l.x, l.z, S);
      const rr = l.r * (S / WORLD_SIZE) * this.zoom;
      if (Math.hypot(px - x, py - y) <= rr && this.isExplored(l.x, l.z)) hit = l.id;
    }
    const tip = this.el.querySelector(".wmtip") as HTMLElement;
    if (hit !== this.hover) {
      this.hover = hit;
      const l = LANDMARKS.find((m) => m.id === hit);
      if (l) { tip.innerHTML = `<b>${l.name}</b><span>${l.note}</span>`; tip.classList.add("show"); } else tip.classList.remove("show");
    }
    if (hit) { tip.style.left = `${e.clientX - r.left + 14}px`; tip.style.top = `${e.clientY - r.top + 14}px`; }
  }

  private isExplored(x: number, z: number): boolean {
    const half = WORLD_SIZE / 2;
    const c = Math.min(N - 1, Math.max(0, Math.floor((x + half) / CELL))), r = Math.min(N - 1, Math.max(0, Math.floor((z + half) / CELL)));
    return !!this.fog[r * N + c];
  }

  private buildFog(S: number, ox: number, oz: number, k: number): HTMLCanvasElement {
    const key = `${S}|${this.zoom}|${this.panX}|${this.panY}|${this.fogVer}`;
    if (this.fogLayer && key === this.fogKey) return this.fogLayer;
    const c = this.fogLayer ?? document.createElement("canvas");
    c.width = S; c.height = S;
    const f = c.getContext("2d")!;
    f.fillStyle = "rgba(160,174,180,.94)";
    f.fillRect(0, 0, S, S);
    // faint wash texture so the mist reads as ink on paper, not a flat tint
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 30; i++) {
      const x = rnd() * S, y = rnd() * S, r = (0.05 + rnd() * 0.14) * S;
      const b = f.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, "rgba(58,58,68,.10)"); b.addColorStop(1, "rgba(58,58,68,0)");
      f.fillStyle = b; f.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (!this.sprite) {
      const sp = document.createElement("canvas"); sp.width = sp.height = 64;
      const sg = sp.getContext("2d")!;
      const gr = sg.createRadialGradient(32, 32, 10, 32, 32, 32);
      gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.55, "rgba(0,0,0,.9)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
      this.sprite = sp;
    }
    f.globalCompositeOperation = "destination-out";
    const rr = CELL * k * 1.05;
    for (let r = 0; r < N; r++) for (let col = 0; col < N; col++) {
      if (!this.fog[r * N + col]) continue;
      const x = ox + (col + 0.5) * CELL * k, y = oz + (r + 0.5) * CELL * k;
      f.drawImage(this.sprite, x - rr, y - rr, rr * 2, rr * 2);
    }
    this.fogLayer = c; this.fogKey = key;
    return c;
  }

  private redraw() {
    const S0 = this.size();
    const S = S0 * this.dpr;
    if (this.cv.width !== S) { this.cv.width = S; this.cv.height = S; this.cv.style.width = `${S0}px`; this.cv.style.height = `${S0}px`; }
    const g = this.g;
    g.clearRect(0, 0, S, S);
    // parchment
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
    grad.addColorStop(0, "#efe6cd"); grad.addColorStop(1, "#d3c49c");
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    const k = (S / WORLD_SIZE) * this.zoom;
    const [ox, oz] = this.toPx(-WORLD_SIZE / 2, -WORLD_SIZE / 2, S);
    g.save();
    g.beginPath(); g.rect(0, 0, S, S); g.clip();
    // ink-wash blotches (seeded) for texture
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      const x = ox + rnd() * WORLD_SIZE * k, y = oz + rnd() * WORLD_SIZE * k, r = (0.05 + rnd() * 0.12) * S * this.zoom;
      const b = g.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, `rgba(58,58,68,${0.04 + rnd() * 0.07})`); b.addColorStop(1, "rgba(58,58,68,0)");
      g.fillStyle = b; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // landmarks
    for (const l of LANDMARKS) {
      const [x, y] = this.toPx(l.x, l.z, S);
      g.fillStyle = l.col; g.beginPath(); g.arc(x, y, l.r * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(26,26,31,.35)"; g.lineWidth = this.dpr; g.stroke();
    }
    // lantern path
    g.strokeStyle = "rgba(58,58,68,.6)"; g.lineWidth = 2.2 * this.dpr; g.setLineDash([6 * this.dpr, 5 * this.dpr]); g.beginPath();
    for (let z = -80; z <= 85; z += 5) { const [x, y] = this.toPx(0, z, S); if (z === -80) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke(); g.setLineDash([]);
    // shrine seal
    { const [x, y] = this.toPx(0, 85, S); g.fillStyle = "#c8372d"; g.fillRect(x - 4 * this.dpr, y - 4 * this.dpr, 8 * this.dpr, 8 * this.dpr); }
    // dots
    const L = this.last;
    if (L) {
      for (const d of L.dots) {
        const [x, y] = this.toPx(d.x, d.z, S);
        const boss = d.mob === "stone_guardian", serpent = d.mob === "jade_serpent";
        const r = (boss ? 6 : 4) * this.dpr;
        g.beginPath();
        g.fillStyle = d.dead ? "rgba(58,58,68,.6)" : serpent ? "#3f9d86" : d.k === "mob" ? "#c8372d" : d.k === "npc" ? "#c9a227" : "#4fa58b";
        if (serpent) { g.moveTo(x, y - r * 1.3); g.lineTo(x + r, y); g.lineTo(x, y + r * 1.3); g.lineTo(x - r, y); g.closePath(); }
        else if (boss) g.rect(x - r, y - r, r * 2, r * 2);
        else g.arc(x, y, r, 0, Math.PI * 2);
        g.fill(); g.lineWidth = this.dpr * (boss ? 1.8 : 1); g.strokeStyle = boss && !d.dead ? "#c9a227" : "#1a1a1f"; g.stroke();
      }
      // you: a triangle pointing the way the camera faces (north-up map, forward = (-sin yaw, -cos yaw))
      const [mx, my] = this.toPx(L.me.x, L.me.z, S);
      g.save(); g.translate(mx, my); g.rotate(-L.yaw);
      g.fillStyle = "#1a1a1f"; g.strokeStyle = "#f2ead8"; g.lineWidth = 1.6 * this.dpr;
      g.beginPath(); g.moveTo(0, -10 * this.dpr); g.lineTo(7 * this.dpr, 8 * this.dpr); g.lineTo(0, 4 * this.dpr); g.lineTo(-7 * this.dpr, 8 * this.dpr); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    // fog of war: a cached mist layer with soft round holes at every explored cell (rebuilt only when the fog, zoom, pan or size changes)
    g.drawImage(this.buildFog(S, ox, oz, k), 0, 0);
    // labels sit above the mist so a discovered place is never half hidden
    g.textAlign = "center";
    g.font = `${Math.round(13 * this.dpr)}px "Ma Shan Zheng", cursive`;
    for (const l of LANDMARKS) {
      if (!this.isExplored(l.x, l.z)) continue;
      const [x, y] = this.toPx(l.x, l.z, S);
      g.lineWidth = 3 * this.dpr; g.strokeStyle = "rgba(242,234,216,.9)"; g.strokeText(l.name, x, y + (l.r * k) + 15 * this.dpr);
      g.fillStyle = "#1a1a1f"; g.fillText(l.name, x, y + (l.r * k) + 15 * this.dpr);
    }
    g.restore();
    // compass
    g.restore();
    g.fillStyle = "#1a1a1f"; g.font = `${Math.round(18 * this.dpr)}px "Ma Shan Zheng", cursive`; g.textAlign = "center";
    g.fillText("N", S - 26 * this.dpr, 30 * this.dpr);
    g.beginPath(); g.moveTo(S - 26 * this.dpr, 38 * this.dpr); g.lineTo(S - 21 * this.dpr, 52 * this.dpr); g.lineTo(S - 31 * this.dpr, 52 * this.dpr); g.closePath(); g.fill();
    // frame
    g.strokeStyle = "#1a1a1f"; g.lineWidth = 3 * this.dpr; g.strokeRect(1, 1, S - 2, S - 2);
    (this.el.querySelector(".wmp") as HTMLElement).textContent = `${Math.round(this.explored * 100)}% explored`;
  }
}
