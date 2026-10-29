// Extra brush-style skill / impact effects: ink splash on every hit, bagua casting circle under talisman casts, dry-brush scorch line left by a sword-qi wave.
// Self-contained (own tiny timer list, hard-capped so it never adds more than a handful of draw calls); the parent calls update(dt).
import * as THREE from "three";

interface Anim { u: number; dur: number; tick: (u: number) => void; done: () => void }
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);

function lcg(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** radial ink splat: fat core, long thin flung streaks with beads at the ends (alpha mask, white) */
function splatStarTexture(): THREE.CanvasTexture {
  const N = 256, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d")!, r = lcg(31);
  g.translate(N / 2, N / 2); g.fillStyle = g.strokeStyle = "#fff"; g.lineCap = "round";
  g.beginPath();
  for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI * 2, rr = 26 * (0.75 + r() * 0.5); g[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr); }
  g.fill();
  const rays = 11;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + (r() - 0.5) * 0.35, len = 56 + r() * 62;
    for (let s = 0; s < 14; s++) { // tapered stroke drawn as stacked segments
      const t0 = s / 14, t1 = (s + 1) / 14;
      g.lineWidth = Math.max(0.8, (11 * (1 - t0) + 1.5) * (0.6 + r() * 0.5) * (0.5 + 0.5 * (len / 118)));
      g.beginPath(); g.moveTo(Math.cos(a) * (24 + t0 * len), Math.sin(a) * (24 + t0 * len)); g.lineTo(Math.cos(a) * (24 + t1 * len), Math.sin(a) * (24 + t1 * len)); g.stroke();
    }
    const e = 24 + len + 4 + r() * 6; g.beginPath(); g.arc(Math.cos(a) * e, Math.sin(a) * e, 2 + r() * 5, 0, 7); g.fill();
  }
  for (let i = 0; i < 26; i++) { const a = r() * 7, d = 40 + r() * 85; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.8 + r() * 2.6, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

/** eight trigrams on two brush rings */
function baguaTexture(): THREE.CanvasTexture {
  const N = 512, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d")!, r = lcg(5);
  g.translate(N / 2, N / 2); g.lineCap = "round"; g.strokeStyle = g.fillStyle = "#fff";
  const ring = (rad: number, w: number) => { g.lineWidth = w; g.beginPath(); for (let i = 0; i <= 90; i++) { const a = (i / 90) * 6.2832, rr = rad + Math.sin(a * 5 + rad) * 1.4 + (r() - 0.5) * 0.9; g[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr); } g.stroke(); };
  ring(244, 5); ring(170, 4); ring(126, 3);
  const tri = [7, 3, 5, 1, 0, 4, 2, 6]; // line patterns (bit set = solid)
  for (let k = 0; k < 8; k++) {
    g.save(); g.rotate((k / 8) * Math.PI * 2);
    for (let l = 0; l < 3; l++) {
      const y = -(188 + l * 15), half = 36, solid = (tri[k] >> l) & 1;
      g.lineWidth = 7;
      g.beginPath();
      if (solid) { g.moveTo(-half, y); g.lineTo(half, y); } else { g.moveTo(-half, y); g.lineTo(-7, y); g.moveTo(7, y); g.lineTo(half, y); }
      g.stroke();
    }
    g.restore();
  }
  // yin-yang dots at the centre
  g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 44, 0, 7); g.stroke();
  g.beginPath(); g.arc(0, 0, 44, -Math.PI / 2, Math.PI / 2); g.arc(0, 22, 22, Math.PI / 2, -Math.PI / 2, true); g.arc(0, -22, 22, Math.PI / 2, -Math.PI / 2); g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** dry-brush stroke: long bristle streaks that break up towards the tail (feibai) */
function brushTexture(): THREE.CanvasTexture {
  const W = 512, H = 64, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!, r = lcg(9);
  for (let y = 0; y < H; y++) {
    const edge = 1 - Math.abs(y / (H - 1) * 2 - 1);
    const bristle = 0.55 + r() * 0.45, gap = 0.55 + 0.45 * r();
    for (let x = 0; x < W; x += 2) {
      const t = x / W;
      const keep = bristle > 0.15 + t * 0.7 * gap ? 1 : 0; // later columns drop more bristles
      const a = keep * Math.min(1, edge * 2.2) * Math.min(1, t * 14) * (1 - Math.pow(t, 6)) * (0.7 + 0.3 * r());
      g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x, y, 2, 1);
    }
  }
  const t = new THREE.CanvasTexture(cv); return t;
}

export interface Extras {
  /** brush-ink burst billboard at the hit point (normal = ink black, crit = vermilion, bigger) */
  splat(at: THREE.Vector3, crit: boolean, local?: boolean): void;
  /** gold bagua ring on the ground that blooms and spins at a talisman cast */
  bagua(at: THREE.Vector3, local?: boolean): void;
  /** dry-brush scorch stroke on the ground between two points, fading away */
  scorch(a: THREE.Vector3, b: THREE.Vector3, local?: boolean): void;
  update(dt: number): void;
}

export function createExtras(root: THREE.Object3D, groundY: (x: number, z: number) => number): Extras {
  const live: Anim[] = [];
  const splatTex = splatStarTexture(), bagTex = baguaTexture(), brushTex = brushTexture();
  let active = 0;
  const CAP = 10;
  const start = (dur: number, tick: (u: number) => void, done: () => void) => { live.push({ u: 0, dur, tick, done }); };

  const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
  const sprites: THREE.Sprite[] = [], baguas: THREE.Mesh[] = [], scorches: THREE.Mesh[] = [];
  const free = <T extends THREE.Object3D>(list: T[], make: () => T): T | null => {
    const f = list.find((o) => !o.visible); if (f) return f;
    if (list.length >= 5) return null;
    const o = make(); o.visible = false; root.add(o); list.push(o); return o;
  };

  return {
    splat(at, crit, local = true) {
      if (!local && active >= CAP) return;
      const sp = free(sprites, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: splatTex, transparent: true, depthWrite: false, toneMapped: false, fog: false })); s.renderOrder = 19; return s; });
      if (!sp) return;
      active++; sp.visible = true;
      const m = sp.material as THREE.SpriteMaterial; m.color.set(crit ? 0xc8372d : 0x1a1a1f);
      const size = crit ? 2.5 : 1.45, rot = rnd(0, 6.28);
      sp.position.copy(at); sp.position.y += 0.1;
      start(crit ? 0.42 : 0.3, (u) => {
        const k = easeOut(clamp01(u / 0.3));
        sp.scale.setScalar(size * (0.35 + 0.65 * k) * (1 + u * 0.12)); m.rotation = rot;
        m.opacity = (u < 0.4 ? 1 : 1 - (u - 0.4) / 0.6) * 0.92;
      }, () => { sp.visible = false; active--; });
    },
    bagua(at, local = true) {
      if (!local && active >= CAP) return;
      const mesh = free(baguas, () => new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: bagTex, color: 0xe8c25a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
      if (!mesh) return;
      active++; mesh.visible = true;
      const m = mesh.material as THREE.MeshBasicMaterial;
      const x = at.x, z = at.z, y = groundY(x, z) + 0.09, dir = Math.random() < 0.5 ? 1 : -1;
      start(0.85, (u) => {
        const k = easeOut(clamp01(u / 0.35));
        mesh.position.set(x, y, z); mesh.scale.setScalar(0.5 + 2.7 * k + u * 0.5); mesh.rotation.y = dir * (u * 2.4 + (1 - k) * 1.2);
        m.opacity = (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85) * 0.85;
      }, () => { mesh.visible = false; active--; });
    },
    scorch(a, b, local = true) {
      if (!local && active >= CAP) return;
      const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 0.5) return;
      const mesh = free(scorches, () => new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ map: brushTex, color: 0x1a1a1f, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
      if (!mesh) return;
      active++; mesh.visible = true;
      const m = mesh.material as THREE.MeshBasicMaterial;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, y = groundY(mx, mz) + 0.07, yaw = Math.atan2(b.x - a.x, b.z - a.z);
      mesh.position.set(mx, y, mz); mesh.rotation.y = yaw - Math.PI / 2; // plane's x axis (brush length) along the travel direction
      start(1.5, (u) => {
        const grow = easeOut(clamp01(u / 0.12));
        mesh.scale.set(len * grow, 1, 0.9 + 0.5 * Math.min(1, u * 3));
        m.opacity = 0.85 * (u < 0.25 ? 1 : 1 - (u - 0.25) / 0.75);
      }, () => { mesh.visible = false; active--; });
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const l = live[i]; l.u = Math.min(1, l.u + dt / l.dur); l.tick(l.u);
        if (l.u >= 1) { l.done(); live.splice(i, 1); }
      }
    },
  };
}
