import * as THREE from "three";

/** Tab-target rules shared by the game loop. Pure helpers first (easy to reason about), then the ground ring + plate styling. */

/** Furthest hostile Tab will pick: about the longest skill range. */
export const TAB_RANGE = 40;
/** A selected target further than this (or dead / gone) is dropped automatically. Stays below the server interest radius (60). */
export const DROP_RANGE = 50;
/** Half angle (radians) of the "in front of the camera" cone that is preferred by Tab. */
const CONE_HALF = (40 * Math.PI) / 180;

export interface TargetMob { id: number; x: number; z: number; dead: boolean }

/**
 * Hostile targets ordered for Tab cycling.
 * Only living mobs within `range` of the player qualify. Groups, in order: inside the camera's forward cone, elsewhere in
 * front of the camera, behind the camera (dropped when any mob is in front). Each group is nearest-first.
 */
export function orderTargets(
  me: { x: number; z: number },
  cam: { x: number; z: number; fx: number; fz: number },
  mobs: Iterable<TargetMob>,
  range = TAB_RANGE,
): number[] {
  const rows: Array<{ id: number; g: number; d: number }> = [];
  let anyFront = false;
  for (const m of mobs) {
    if (m.dead) continue;
    const d = Math.hypot(m.x - me.x, m.z - me.z);
    if (!(d <= range)) continue;
    const vx = m.x - cam.x, vz = m.z - cam.z;
    const vl = Math.hypot(vx, vz);
    const dot = vl < 1e-4 ? 1 : (vx * cam.fx + vz * cam.fz) / vl; // cos of the angle to the camera forward
    const front = dot > 0.05;
    const g = front && dot >= Math.cos(CONE_HALF) ? 0 : front ? 1 : 2;
    if (front) anyFront = true;
    rows.push({ id: m.id, g, d });
  }
  return rows
    .filter((r) => !anyFront || r.g < 2)
    .sort((a, b) => a.g - b.g || a.d - b.d || a.id - b.id)
    .map((r) => r.id);
}

/** Next target id for Tab (dir = 1) or Shift+Tab (dir = -1); -1 when there is nothing to pick. */
export function cycleFrom(order: number[], current: number, dir: 1 | -1): number {
  const n = order.length;
  if (!n) return -1;
  const i = order.indexOf(current);
  if (i < 0) return dir > 0 ? order[0] : order[n - 1];
  return order[(i + dir + n) % n];
}

// ------------------------------------------------------------------ ink-brush ground ring

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** One hand-painted looking brush circle: tapered stroke that thins and splits into dry-brush streaks near its end, with splatter. */
function ringTexture(main: string, shade: string): THREE.CanvasTexture {
  const S = 512, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const R = rng(7);
  g.translate(S / 2, S / 2);
  const stroke = (r: number, w0: number, w1: number, a0: number, turns: number, col: string, alpha: number, jit: number) => {
    const N = 220;
    g.fillStyle = col; g.globalAlpha = alpha;
    g.beginPath();
    const outer: Array<[number, number]> = [], inner: Array<[number, number]> = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, a = a0 + u * turns * Math.PI * 2;
      const w = w0 + (w1 - w0) * Math.pow(u, 1.4) + Math.sin(u * 23) * jit + Math.sin(u * 7 + 1) * jit * 0.8;
      const rr = r + Math.sin(u * 5.3 + 2) * 2.5;
      outer.push([Math.cos(a) * (rr + w / 2), Math.sin(a) * (rr + w / 2)]);
      inner.push([Math.cos(a) * (rr - w / 2), Math.sin(a) * (rr - w / 2)]);
    }
    outer.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    for (let i = inner.length - 1; i >= 0; i--) g.lineTo(inner[i][0], inner[i][1]);
    g.closePath(); g.fill();
  };
  // soft wash under the line (ink bleed)
  stroke(196, 52, 30, 0.3, 0.93, shade, 0.55, 3);
  // main bold stroke: heavy at the start, thin at the lift-off
  stroke(196, 44, 9, 0.3, 0.93, main, 1, 2.6);
  // dry-brush streaks near the tail
  g.globalAlpha = 0.9; g.strokeStyle = main;
  for (let k = 0; k < 6; k++) {
    g.lineWidth = 1.2 + R() * 2.2;
    g.beginPath();
    const a0 = 0.3 + 0.93 * Math.PI * 2 * (0.62 + R() * 0.3), span = 0.25 + R() * 0.5, off = (k - 2.5) * 4.2;
    for (let i = 0; i <= 24; i++) { const a = a0 + (i / 24) * span; g.lineTo(Math.cos(a) * (196 + off), Math.sin(a) * (196 + off)); }
    g.stroke();
  }
  // thin inner companion ring
  g.globalAlpha = 0.75; g.strokeStyle = main; g.lineWidth = 4.5;
  g.beginPath(); g.arc(0, 0, 168, 0, Math.PI * 2); g.stroke();
  // four seal-like ticks on the cardinal points
  g.globalAlpha = 1; g.fillStyle = main;
  for (let i = 0; i < 4; i++) {
    g.save(); g.rotate((i * Math.PI) / 2 + Math.PI / 4);
    g.beginPath(); g.moveTo(206, -9); g.lineTo(244, 0); g.lineTo(206, 9); g.closePath(); g.fill();
    g.restore();
  }
  // splatter
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2, r = 206 + R() * 40, s = 1 + R() * 3.4;
    g.globalAlpha = 0.4 + R() * 0.55; g.fillStyle = R() < 0.3 ? shade : main;
    g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, s, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const PALETTE: Record<"hostile" | "npc" | "friend", [string, string]> = {
  hostile: ["#d8321f", "#4a0f0a"], // vermilion over dark ink wash
  npc: ["#d1a52b", "#4a3a0c"],
  friend: ["#4fa58b", "#10302a"],
};

export class TargetRing {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private tex = new Map<string, THREE.CanvasTexture>();
  private kind = "";
  private shownAt = 0;
  private lastId = -2;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, opacity: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** `radius` = world radius of the painted circle (the stroke sits at about 0.8 of it). */
  update(now: number, t: { id: number; k: "mob" | "npc" | "player"; x: number; y: number; z: number; h: number; boss: boolean } | null) {
    if (!t) { this.mesh.visible = false; this.lastId = -2; return; }
    const kind = t.k === "mob" ? "hostile" : t.k === "npc" ? "npc" : "friend";
    if (kind !== this.kind) {
      this.kind = kind;
      let tx = this.tex.get(kind);
      if (!tx) { tx = ringTexture(PALETTE[kind][0], PALETTE[kind][1]); this.tex.set(kind, tx); }
      this.mat.map = tx; this.mat.needsUpdate = true;
    }
    if (t.id !== this.lastId) { this.lastId = t.id; this.shownAt = now; }
    const pop = Math.min(1, (now - this.shownAt) / 160);          // brush-stamp: lands slightly large, settles
    const settle = 1 + (1 - pop) * (1 - pop) * 0.45;
    const base = Math.max(1.4, t.h * 0.72) * (t.boss ? 1.5 : 1);
    const s = base * settle * (1 + Math.sin(now * 0.005) * 0.035);
    this.mesh.scale.set(s, 1, s);
    this.mesh.position.set(t.x, t.y + 0.2, t.z);
    this.mesh.rotation.y = now * 0.00032;
    this.mat.opacity = 0.55 + 0.45 * pop;
    this.mesh.visible = true;
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); this.tex.forEach((t) => t.dispose()); }
}

// ------------------------------------------------------------------ nameplate highlight (kept out of the shared stylesheet)

let styled = false;
export function installTargetStyle() {
  if (styled) return;
  styled = true;
  const st = document.createElement("style");
  st.id = "jz-target-style";
  st.textContent = `
.np.target { z-index: 5; }
.np.target .t { background: rgba(120,22,14,.82); color: #fff4e2; box-shadow: 0 0 0 1px #e0452f, 0 0 10px 1px rgba(224,69,47,.7); font-size: 14px; letter-spacing: .02em; }
.np.target .b { box-shadow: 0 0 0 1px #e0452f; }
.np.target.npc .t { background: rgba(88,66,10,.85); box-shadow: 0 0 0 1px #d1a52b, 0 0 10px 1px rgba(209,165,43,.55); }
.np.target.player .t { background: rgba(14,70,56,.85); box-shadow: 0 0 0 1px #4fa58b, 0 0 10px 1px rgba(79,165,139,.55); }
#jz-vignette { position: fixed; inset: 0; pointer-events: none; opacity: 0; z-index: 30; will-change: opacity;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(216,50,31,.22) 78%, rgba(216,50,31,.62) 100%); }
`;
  document.head.appendChild(st);
}
