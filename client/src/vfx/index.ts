// JIUZHOU VFX: pooled particle + mesh effects per class/skill, ink-splatter hits.
import * as THREE from "three";
import type { ClassId } from "../../../shared/protocol";
import { Particles } from "./particles";
import { drawSymbol, symbolTexture, type SymbolName } from "../world/symbols";
import { heightAt } from "../world/terrain";
import { createExtras } from "./extras";

const C = (h: number) => new THREE.Color(h);
const INK = C(0x1a1a1f), INKS = C(0x3a3a44), PAPER = C(0xf2ead8), PAPERD = C(0xd9cdb0), VERM = C(0xc8372d), VERMB = C(0xff6a4a), JADE = C(0x4fa58b), JADEB = C(0x8fe3c0), GOLD = C(0xc9a227), GOLDB = C(0xffdf7a), MIST = C(0x8fa3ad), MISTL = C(0xcfd9dc), ICE = C(0xbfe6ee);

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

// ---------- geometry builders ----------
function crescentGeo(span = 1.25, R = 1, tw = 0.34, segs = 28): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = -span + (2 * span * i) / segs;
    const w = tw * (1 - Math.pow(a / span, 2));
    pos.push(Math.sin(a) * R, 0, Math.cos(a) * R - R);                      // outer (leading) edge
    col.push(1, 1, 1, 1);
    pos.push(Math.sin(a) * (R - w), 0, Math.cos(a) * (R - w) - R);          // inner edge, fades out
    col.push(0.55, 0.9, 0.8, 0);
    if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}
function columnGeo(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute("position"); const col: number[] = [];
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); col.push(1, 1, 1, y < 0.5 ? 0.9 : 0.0); }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  return g;
}
function bladeGeo(): THREE.BufferGeometry { // tall thin falling blade (double-sided diamond)
  const g = new THREE.PlaneGeometry(1, 1, 1, 1); g.translate(0, 0.5, 0);
  const col: number[] = []; const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) col.push(1, 1, 1, p.getY(i) > 0.5 ? 0.0 : 1);
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  return g;
}
function glyphTexture(): THREE.CanvasTexture { // vermilion seal with a brush taiji spiral
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#c8372d"; g.beginPath(); g.roundRect(6, 6, 116, 116, 8); g.fill();
  g.strokeStyle = "#f2ead8"; g.lineWidth = 4; g.strokeRect(14, 14, 100, 100);
  drawSymbol(g, "taiji", 24, 24, 80, "#f2ead8");
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function talismanTex(): THREE.CanvasTexture { // paper charm: framed zigzag seal marks, circles and dotted lines
  const cv = document.createElement("canvas"); cv.width = 64; cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#f2ead8"; g.fillRect(0, 0, 64, 128);
  g.strokeStyle = "#c8372d"; g.lineWidth = 4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeRect(4, 4, 56, 120);
  drawSymbol(g, "charm", 6, 24, 52, "#c8372d");
  g.fillStyle = "#c8372d"; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(14 + i * 9, 106, 1.8, 0, 7); g.fill(); }
  g.beginPath(); g.arc(32, 14, 5, 0, 7); g.stroke();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * Draw-call budget: every live pooled mesh / glyph sprite costs one draw call. Effects triggered by other players are
 * dropped once `active` reaches `budget`; the local player's own effects (`prio`) always play.
 */
const fxBudget = { active: 0, budget: 14, prio: true };

class Pool<T extends THREE.Object3D> {
  items: { o: T; used: boolean }[] = [];
  constructor(parent: THREE.Object3D, n: number, make: () => T) {
    for (let i = 0; i < n; i++) { const o = make(); o.visible = false; parent.add(o); this.items.push({ o, used: false }); }
  }
  get(): { o: T; release(): void } | null {
    if (!fxBudget.prio && fxBudget.active >= fxBudget.budget) return null;
    const it = this.items.find((i) => !i.used);
    if (!it) return null;
    it.used = true; it.o.visible = true; fxBudget.active++;
    return { o: it.o, release: () => { if (it.used) fxBudget.active--; it.used = false; it.o.visible = false; } };
  }
}

function basicMat(additive: boolean, vc = true, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: vc, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, map: map ?? null, toneMapped: false, fog: false });
}

export interface ShapeTelegraph {
  shape: "cone" | "line"; dir: number; len: number; arc?: number; width?: number;
  delay: number; sweep?: number; lead?: number; beam?: boolean;
}
interface Live { u: number; dur: number; tick: (u: number, dt: number) => void; done: () => void; }

export function createVfx(scene: THREE.Scene): {
  /** `local` = the player's own cast (always plays); others are dropped when the draw-call budget is used up */
  cast(skill: number, cls: ClassId, from: THREE.Vector3, to: THREE.Vector3, local?: boolean): void;
  hit(at: THREE.Vector3, crit: boolean): void;
  update(dt: number): void;
  levelUp(at: THREE.Vector3): void;
  respawn(at: THREE.Vector3): void;
  /** Red/vermilion ground danger zone that fills over `delay` seconds, then flashes and bursts (ink shockwave + dust). Pooled, terrain-conforming. */
  telegraph(at: THREE.Vector3, radius: number, delay: number): void;
  /** Cone / line ground danger zone in the same red ink style (mob bite / smash, boss beam). A `sweep` rotates the line from `dir` after `lead` s (beam). */
  telegraphShape(at: THREE.Vector3, o: ShapeTelegraph): void;
  /** Boss slam impact (shockwave, cracks, dust, crack-star symbol). `telegraph` plays this automatically when it fires. */
  bossSlam(at: THREE.Vector3, radius?: number): void;
} {
  const root = new THREE.Group(); root.name = "vfx"; scene.add(root);
  const ink = new Particles(root, 700, false, true);
  const glow = new Particles(root, 900, true, false);
  const soft = new Particles(root, 500, false, false);   // normal-blended soft (rain, frost mist, leaves)

  const cres = crescentGeo(), colGeo = columnGeo(), blade = bladeGeo();
  const ringGeo = new THREE.RingGeometry(0.88, 1, 56); ringGeo.rotateX(-Math.PI / 2);
  const ringGeoThin = new THREE.RingGeometry(0.95, 1, 56); ringGeoThin.rotateX(-Math.PI / 2);
  const needleGeo = new THREE.ConeGeometry(0.035, 0.9, 5); needleGeo.rotateX(Math.PI / 2); needleGeo.translate(0, 0, 0.45);
  const crystalGeo = new THREE.ConeGeometry(0.22, 1, 5); crystalGeo.translate(0, 0.5, 0);
  const cardGeo = new THREE.PlaneGeometry(0.34, 0.68);
  const talTex = talismanTex(), glyphTex = glyphTexture();

  const arcs = new Pool(root, 8, () => new THREE.Mesh(cres, basicMat(false)));
  const rings = new Pool(root, 14, () => new THREE.Mesh(ringGeo, basicMat(false, false)));
  const ringsT = new Pool(root, 6, () => new THREE.Mesh(ringGeoThin, basicMat(true, false)));
  const colsN = new Pool(root, 3, () => new THREE.Mesh(colGeo, basicMat(false)));
  const cols = new Pool(root, 5, () => new THREE.Mesh(colGeo, basicMat(true)));
  const blades = new Pool(root, 3, () => new THREE.Mesh(blade, basicMat(true)));
  const cards = new Pool(root, 8, () => new THREE.Mesh(cardGeo, basicMat(false, false, talTex)));
  const needles = new Pool(root, 9, () => new THREE.Mesh(needleGeo, basicMat(false, false)));
  const crystals = new Pool(root, 18, () => new THREE.Mesh(crystalGeo, basicMat(false, false)));
  const spheres = new Pool(root, 3, () => new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uCol: { value: new THREE.Color() }, uA: { value: 1 }, uT: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uA, uT; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); float band = 0.5 + 0.5*sin(uT*6.0 + vN.y*9.0); gl_FragColor = vec4(uCol, (f*0.9 + 0.08 + band*0.08*f) * uA);
 #include <colorspace_fragment>
 }`,
  })));
  const seals = new Pool(root, 4, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex, transparent: true, depthWrite: false, toneMapped: false, fog: false })); return s; });
  // lightning ribbons
  const BOLT_SEG = 14;
  const bolts = new Pool(root, 10, () => {
    const g = new THREE.BufferGeometry();
    const n = (BOLT_SEG + 1) * 3 * 2;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(n * 3);
    for (let p = 0; p < 2; p++) for (let i = 0; i <= BOLT_SEG; i++) {
      const base = (p * (BOLT_SEG + 1) + i) * 3;
      const set = (k: number, c: THREE.Color) => { col[(base + k) * 3] = c.r; col[(base + k) * 3 + 1] = c.g; col[(base + k) * 3 + 2] = c.b; };
      set(0, GOLD); set(1, new THREE.Color(1, 1, 0.95)); set(2, GOLD);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const idx: number[] = [];
    for (let p = 0; p < 2; p++) for (let i = 0; i < BOLT_SEG; i++) {
      const a = (p * (BOLT_SEG + 1) + i) * 3, b = a + 3;
      idx.push(a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
    }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    m.frustumCulled = false;
    return m;
  });
  function shapeBolt(m: THREE.Mesh, top: THREE.Vector3, bot: THREE.Vector3, w: number, jag: number) {
    const p = (m.geometry as THREE.BufferGeometry).getAttribute("position") as THREE.BufferAttribute;
    const dir = new THREE.Vector3().subVectors(top, bot);
    const side = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
    for (let pl = 0; pl < 2; pl++) {
      for (let i = 0; i <= BOLT_SEG; i++) {
        const t = i / BOLT_SEG;
        const c = new THREE.Vector3().copy(bot).addScaledVector(dir, t);
        const j = (i === 0 ? 0 : 1) * jag * (1 - t * 0.2);
        c.x += (Math.random() - 0.5) * j; c.z += (Math.random() - 0.5) * j;
        const ww = w * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.05 + 0.05) * Math.PI * 0.9 + 0.3));
        const base = (pl * (BOLT_SEG + 1) + i) * 3;
        p.setXYZ(base, c.x - side[pl].x * ww, c.y, c.z - side[pl].z * ww);
        p.setXYZ(base + 1, c.x, c.y, c.z);
        p.setXYZ(base + 2, c.x + side[pl].x * ww, c.y, c.z + side[pl].z * ww);
      }
    }
    p.needsUpdate = true;
  }

  const extras = createExtras(root, (x, z) => heightAt(x, z));
  const live: Live[] = [];
  /** Timed effect. Remembers whether it was started by a budget-exempt (local) cast so delayed pool grabs inside it follow the same rule. */
  function run(dur: number, tick: (u: number, dt: number) => void, done: () => void = () => {}) {
    const pr = fxBudget.prio;
    if (pr) { live.push({ u: 0, dur, tick, done }); return; }
    const under = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { const o = fxBudget.prio; fxBudget.prio = false; try { f(...a); } finally { fxBudget.prio = o; } };
    live.push({ u: 0, dur, tick: under(tick), done: under(done) });
  }
  const tint = (o: THREE.Object3D, c: THREE.Color, a = 1) => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial; m.color.copy(c); m.opacity = a; };
  const setA = (o: THREE.Object3D, a: number) => { ((o as THREE.Mesh).material as THREE.Material).opacity = a; };


  // ---------- brush-symbol flash + ink-splash decals ----------
  const flashCache = new Map<string, THREE.SpriteMaterial>();
  function flashMat(ch: SymbolName, hex: string, edge: string): THREE.SpriteMaterial {
    const k = ch + hex; let m = flashCache.get(k);
    if (!m) { m = new THREE.SpriteMaterial({ map: symbolTexture(ch, 256, hex, edge).tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false }); flashCache.set(k, m); }
    return m;
  }
  /** a brush-drawn pictogram (flame, wave, lotus ...) that blooms in the air then bleeds away */
  function glyphFlash(ch: SymbolName, at: THREE.Vector3, size: number, hex = "#f2ead8", edge = "#1a1a1f", dur = 0.7, rise = 0.6) {
    if (!fxBudget.prio && fxBudget.active >= fxBudget.budget) return;
    fxBudget.active++;
    const sp = new THREE.Sprite(flashMat(ch, hex, edge).clone()); sp.renderOrder = 20; sp.position.copy(at); sp.scale.setScalar(0.01); root.add(sp);
    const m = sp.material as THREE.SpriteMaterial; const y0 = at.y;
    run(dur, (u) => {
      const k = easeOut(clamp01(u * 4));
      sp.scale.setScalar(size * (0.5 + 0.55 * k + u * 0.15)); sp.position.y = y0 + u * rise;
      m.opacity = u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5; m.rotation = (1 - k) * 0.35;
    }, () => { root.remove(sp); m.dispose(); fxBudget.active--; });
  }
  const splatTex = (() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 256; const g = cv.getContext("2d")!;
    let sd = 7; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
    g.fillStyle = "#fff";
    const blob = (x: number, y: number, rad: number) => { g.beginPath(); for (let i = 0; i <= 14; i++) { const a = (i / 14) * 6.283, rr = rad * (0.75 + r() * 0.45); g[i ? "lineTo" : "moveTo"](x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
    blob(128, 128, 46);
    for (let i = 0; i < 16; i++) { const a = r() * 6.283, d = 50 + r() * 50; const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d; blob(x, y, 3 + r() * 9);
      g.lineWidth = 2 + r() * 5; g.strokeStyle = "#fff"; g.beginPath(); g.moveTo(128 + Math.cos(a) * 40, 128 + Math.sin(a) * 40); g.lineTo(x, y); g.stroke(); }
    for (let i = 0; i < 40; i++) { const a = r() * 6.283, d = 55 + r() * 70; blob(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 1 + r() * 3); }
    const t = new THREE.CanvasTexture(cv); return t;
  })();
  const decalGeo = new THREE.PlaneGeometry(1, 1); decalGeo.rotateX(-Math.PI / 2);
  const decals = new Pool(root, 8, () => { const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.renderOrder = 2; return m; });
  /** ink splash stain on the ground, optionally tinted (vermilion / jade / gold) */
  function decal(at: THREE.Vector3, r: number, color: THREE.Color = INK, life = 1.6, alpha = 0.85) {
    const h = decals.get(); if (!h) return;
    h.o.position.set(at.x, at.y + 0.06, at.z); h.o.rotation.y = rnd(0, 6.28); tint(h.o, color, 0);
    run(life, (u) => { const k = easeOut(clamp01(u * 7)); h.o.scale.setScalar(r * (0.45 + 0.55 * k) * 2); setA(h.o, alpha * (u < 0.08 ? u / 0.08 : u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45)); }, () => h.release());
  }

  // ---------- reusable effect primitives ----------
  function ringFx(at: THREE.Vector3, r0: number, r1: number, dur: number, color: THREE.Color, thin = false, delay = 0, alpha = 0.9, additive = false) {
    const pool = additive ? ringsT : thin ? rings : rings;
    const h = pool.get(); if (!h) return;
    h.o.position.copy(at); h.o.position.y += 0.08; h.o.scale.setScalar(r0); tint(h.o, color, 0);
    run(dur + delay, (u) => {
      const k = clamp01((u * (dur + delay) - delay) / dur);
      if (k <= 0) { setA(h.o, 0); return; }
      h.o.scale.setScalar(r0 + (r1 - r0) * easeOut(k)); setA(h.o, alpha * (1 - k) * Math.min(1, k * 8));
    }, () => h.release());
  }
  function burst(p: Particles, at: THREE.Vector3, n: number, speed: number, life: number, size: number, color: THREE.Color | THREE.Color[], grav = 0, up = 0.3, spread = 1, drag = 1.5) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), e = rnd(-0.2, 1) * spread, s = speed * rnd(0.5, 1);
      const c = Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color;
      p.emit(at.x, at.y, at.z, Math.cos(a) * s * (1 - e * 0.3), s * (up + e * 0.7), Math.sin(a) * s * (1 - e * 0.3), life * rnd(0.7, 1.2), size * rnd(0.7, 1.2), size * 0.3, c, 1, drag, grav);
    }
  }
  function inkBurst(at: THREE.Vector3, n: number, speed: number, scale = 1, color = INK) {
    burst(ink, at, n, speed, 0.55, 0.32 * scale, color, 9, 0.5, 1, 2.0);
  }
  function chest(v: THREE.Vector3, h = 1.1) { return new THREE.Vector3(v.x, v.y + h, v.z); }
  function dirOf(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 {
    const d = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    return d.normalize();
  }
  function seal(at: THREE.Vector3, size: number, dur = 0.45) {
    const h = seals.get(); if (!h) return;
    h.o.position.copy(at); h.o.scale.setScalar(0.01);
    run(dur, (u) => {
      const k = easeOut(clamp01(u * 3)); h.o.scale.setScalar(size * (0.4 + 0.8 * k) * (u > 0.7 ? 1 - (u - 0.7) * 1.2 : 1));
      (h.o.material as THREE.SpriteMaterial).opacity = u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45;
      (h.o.material as THREE.SpriteMaterial).rotation = (1 - k) * 0.6 - 0.1;
    }, () => h.release());
  }

  // projectile: card or needle or arc moving along a straight path with trail callback
  function fly(obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, speed: number, onTrail: (p: THREE.Vector3, dt: number) => void, onArrive: () => void, release: () => void, spin = 0, arcH = 0) {
    const dist = Math.max(0.5, a.distanceTo(b)); const dur = Math.max(0.12, dist / speed);
    const p = new THREE.Vector3();
    run(dur, (u, dt) => {
      p.lerpVectors(a, b, u); p.y += Math.sin(u * Math.PI) * arcH;
      obj.position.copy(p);
      if (spin) obj.rotation.z += spin * dt;
      onTrail(p, dt);
    }, () => { onArrive(); release(); });
  }

  // =============== SWORD ===============
  function swordCast(skill: number, from: THREE.Vector3, to: THREE.Vector3) {
    const d = dirOf(from, to), yaw = Math.atan2(d.x, d.z);
    const f = chest(from, 1.05);
    if (skill === 1) { // Flowing Slash — sweeping ink-white crescent
      glyphFlash('slash', chest(from, 1.9).addScaledVector(d, 1.4), 1.8, '#f2ead8'); decal(new THREE.Vector3(from.x, from.y, from.z).addScaledVector(d, 1.6), 1.8, INK, 1.0, 0.6);
      for (let k = 0; k < 2; k++) {
        const h = arcs.get(); if (!h) break;
        const R = k === 0 ? 2.9 : 3.3;
        h.o.rotation.order = "YXZ"; h.o.position.copy(f).addScaledVector(d, 0.6);
        tint(h.o, k === 0 ? PAPER : INKS, 0);
        run(0.32, (u) => {
          const s = easeOut(u);
          h.o.scale.set(R * (0.7 + 0.5 * s), 1, R * (0.6 + 0.5 * s));
          h.o.rotation.set(0, yaw + (0.9 - 1.8 * s) * 0.0, 0.5 - 1.1 * s + (k ? 0.1 : 0));
          h.o.position.copy(f).addScaledVector(d, 0.5 + 0.9 * s);
          setA(h.o, (k === 0 ? 1 : 0.6) * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85));
        }, () => h.release());
      }
      for (let i = 0; i < 16; i++) { const t = rnd(); const p = new THREE.Vector3().copy(f).addScaledVector(d, 0.8 + t * 1.5); p.y += rnd(-0.7, 0.7); p.x += (Math.random() - 0.5) * 0.5; ink.emit(p.x, p.y, p.z, d.x * 2, rnd(-0.5, 1), d.z * 2, 0.45, 0.22, 0.05, INK, 0.9, 2, 1); }
      for (let i = 0; i < 10; i++) { const p = new THREE.Vector3().copy(f).addScaledVector(d, rnd(0.5, 2.2)); glow.emit(p.x, p.y + rnd(-0.6, 0.6), p.z, d.x * 2, 0.5, d.z * 2, 0.35, 0.3, 0.05, JADEB, 0.9, 2, 0); }
    } else if (skill === 2) { // Sword Qi Wave — flying vertical crescent
      glyphFlash('crescent', chest(from, 1.9).addScaledVector(d, 0.8), 1.5, '#8fe3c0');
      const h = arcs.get(); if (!h) return;
      h.o.rotation.order = "YXZ"; h.o.rotation.set(0, yaw, Math.PI / 2); h.o.scale.set(1.7, 1, 1.7);
      tint(h.o, PAPER, 1);
      const a = chest(from, 1.0).addScaledVector(d, 0.8), b = chest(to, 1.0);
      let t = 0, nextGhost = 0.05, ghosts = 0;
      extras.scorch(from, to, fxBudget.prio);
      fly(h.o, a, b, 30, (p, dt) => {
        t += dt; setA(h.o, 1);
        if (ghosts < 3 && t > nextGhost) { // afterimage crescents left hanging along the path, fading
          nextGhost += 0.06; ghosts++;
          const gh = arcs.get();
          if (gh) { gh.o.rotation.order = "YXZ"; gh.o.rotation.set(0, yaw, Math.PI / 2); gh.o.position.copy(p); gh.o.scale.set(1.6 - ghosts * 0.1, 1, 1.6); tint(gh.o, ghosts % 2 ? INKS : PAPER, 0.55); run(0.4, (u) => setA(gh.o, 0.55 * (1 - u)), () => gh.release()); }
        }
        ink.emit(p.x, p.y + rnd(-0.9, 0.9), p.z, -d.x * 1.5, rnd(-0.3, 0.3), -d.z * 1.5, 0.35, 0.3, 0.05, INK, 0.8, 2, 0);
        glow.emit(p.x, p.y + rnd(-0.8, 0.8), p.z, 0, 0.2, 0, 0.3, 0.35, 0.05, JADEB, 0.9, 0, 0);
        h.o.scale.set(1.7 + Math.sin(t * 30) * 0.05, 1, 1.7);
      }, () => { burst(glow, b, 14, 5, 0.4, 0.3, [JADEB, PAPER], 0, 0.3); inkBurst(b, 8, 4, 0.8); ringFx(new THREE.Vector3(b.x, b.y - 0.9, b.z), 0.4, 2, 0.3, JADE); }, () => h.release());
    } else if (skill === 3) { // Heaven-Splitting Strike
      const T = to.lengthSq() === 0 ? from : to;
      const g = new THREE.Vector3(T.x, T.y, T.z);
      glyphFlash('burst', new THREE.Vector3(g.x, g.y + 5, g.z), 3.2, '#ffdf7a', '#1a1a1f', 0.9, 1.0); decal(g, 4.8, INK, 2.2, 0.9);
      const bl = blades.get();
      if (bl) {
        bl.o.rotation.y = yaw + 0.3; tint(bl.o, GOLDB, 0);
        run(0.5, (u) => {
          const fall = easeOut(clamp01(u / 0.22));
          bl.o.position.set(g.x, g.y + 16 * (1 - fall), g.z);
          bl.o.scale.set(0.9 * (1 + 2 * clamp01((u - 0.2) * 4)), 16, 1);
          setA(bl.o, u < 0.22 ? 1 : Math.max(0, 1 - (u - 0.22) / 0.28));
        }, () => bl.release());
        const bl2 = blades.get(); if (bl2) { bl2.o.rotation.y = yaw + 1.6; tint(bl2.o, PAPER, 0); run(0.5, (u) => { const fall = easeOut(clamp01(u / 0.22)); bl2.o.position.set(g.x, g.y + 16 * (1 - fall), g.z); bl2.o.scale.set(0.5, 16, 1); setA(bl2.o, u < 0.22 ? 1 : Math.max(0, 1 - (u - 0.22) / 0.28)); }, () => bl2.release()); }
      }
      // delayed impact
      let hit = false;
      run(0.9, (u) => { if (!hit && u > 0.2 / 0.9) { hit = true;
        ringFx(g, 0.5, 6, 0.55, PAPER, false, 0, 1); ringFx(g, 0.3, 4.2, 0.5, GOLDB, true, 0.04, 1, true); ringFx(g, 0.2, 7.5, 0.7, INKS, false, 0.08, 0.7);
        burst(ink, new THREE.Vector3(g.x, g.y + 0.3, g.z), 26, 7, 0.7, 0.45, INK, 12, 0.9, 0.6, 1.2);
        burst(glow, new THREE.Vector3(g.x, g.y + 0.4, g.z), 22, 8, 0.5, 0.4, [GOLDB, PAPER], 6, 0.7, 0.5);
        // cracks
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + rnd(-0.2, 0.2); const len = rnd(2, 4.4);
          for (let k = 1; k < 9; k++) { const rr = len * k / 8; ink.emit(g.x + Math.sin(a) * rr, g.y + 0.1, g.z + Math.cos(a) * rr, 0, 0, 0, 0.9, 0.22 * (1 - k / 10), 0.1, INK, 0.9, 0, 0); }
        }
      } });
    } else { // Qi Guard — golden-jade shield bubble
      glyphFlash('guard', chest(from, 2.4), 1.5, '#ffdf7a'); decal(new THREE.Vector3(from.x, from.y, from.z), 2.2, GOLD, 1.6, 0.55);
      const h = spheres.get(); if (!h) return;
      const m = h.o.material as THREE.ShaderMaterial; m.uniforms.uCol.value.copy(GOLDB).lerp(JADEB, 0.4);
      const base = new THREE.Vector3(from.x, from.y + 1.0, from.z);
      ringFx(from, 0.4, 2.4, 0.5, GOLD, true, 0, 1, true); ringFx(from, 0.2, 1.8, 0.6, JADEB, true, 0.1, 0.8, true);
      run(1.6, (u, dt) => {
        h.o.position.copy(base); const s = 1.55 * (0.4 + 0.6 * easeOut(clamp01(u * 5))) * (1 + Math.sin(u * 30) * 0.015);
        h.o.scale.set(s, s * 1.2, s);
        m.uniforms.uT.value += dt; m.uniforms.uA.value = u < 0.1 ? u / 0.1 : u > 0.65 ? Math.max(0, 1 - (u - 0.65) / 0.35) : 1;
        if (Math.random() < 0.6) { const a = rnd(0, 6.28); glow.emit(from.x + Math.cos(a) * 1.3, from.y + 0.1, from.z + Math.sin(a) * 1.3, 0, rnd(1.5, 3), 0, 0.8, 0.22, 0.04, Math.random() < 0.5 ? GOLDB : JADEB, 0.9, 0.3, 0); }
      }, () => h.release());
    }
  }

  // =============== TALISMAN ===============
  function launchCard(from: THREE.Vector3, to: THREE.Vector3, trailC: THREE.Color[], arriveFx: (b: THREE.Vector3) => void) {
    const h = cards.get(); if (!h) { arriveFx(chest(to)); return; }
    const a = chest(from, 1.25), b = chest(to, 1.0);
    h.o.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2, 0); h.o.rotation.order = "YXZ";
    setA(h.o, 1);
    const d = dirOf(from, to);
    // card faces travel: plane normal across; give a slight tilt
    h.o.rotation.set(0.2, Math.atan2(d.x, d.z) + Math.PI / 2, 0);
    fly(h.o, a, b, 22, (p, dt) => {
      h.o.rotation.x += dt * 8;
      for (let i = 0; i < 2; i++) { const c = trailC[Math.floor(Math.random() * trailC.length)]; glow.emit(p.x + rnd(-0.1, 0.1), p.y + rnd(-0.1, 0.1), p.z + rnd(-0.1, 0.1), -d.x * 2 + rnd(-0.4, 0.4), rnd(0.2, 1.2), -d.z * 2 + rnd(-0.4, 0.4), 0.4, 0.3, 0.04, c, 0.9, 1, 0); }
      ink.emit(p.x, p.y, p.z, rnd(-0.3, 0.3), 0.5, rnd(-0.3, 0.3), 0.5, 0.2, 0.4, INKS, 0.35, 1, 0);
    }, () => arriveFx(b), () => h.release());
  }
  function talismanCast(skill: number, from: THREE.Vector3, to: THREE.Vector3) {
    const d = dirOf(from, to);
    if (skill === 1) { // Fire Talisman
      glyphFlash('flame', chest(from, 2.1).addScaledVector(d, 0.8), 1.7, '#ff6a4a');
      launchCard(from, to, [VERMB, GOLDB, VERM], (b) => {
        burst(glow, b, 30, 6, 0.55, 0.55, [VERMB, GOLDB, VERM], -2, 0.9, 1, 1.2);
        burst(ink, b, 8, 3, 0.7, 0.6, INKS, -1.5, 1, 0.6, 1.5);
        ringFx(new THREE.Vector3(b.x, b.y - 0.9, b.z), 0.3, 2.6, 0.45, VERMB, true, 0, 1, true);
        for (let i = 0; i < 10; i++) soft.emit(b.x + rnd(-0.3, 0.3), b.y, b.z + rnd(-0.3, 0.3), rnd(-0.5, 0.5), rnd(1, 2.5), rnd(-0.5, 0.5), 0.9, 0.5, 1.1, MIST, 0.4, 0.5, 0);
      });
    } else if (skill === 2) { // Thunder Talisman (AoE)
      const g = new THREE.Vector3(to.x, to.y, to.z);
      const card = cards.get();
      glyphFlash('bolt', new THREE.Vector3(g.x, g.y + 6.5, g.z), 3.0, '#ffdf7a', '#1a1a1f', 0.9, 0.5); decal(g, 5.2, INK, 2.0, 0.9); decal(g, 3.2, VERM, 1.6, 0.6);

      if (card) { card.o.position.set(g.x, g.y + 5.5, g.z); card.o.rotation.set(0, 0, 0); card.o.scale.setScalar(2.2);
        run(0.8, (u) => { card.o.position.y = g.y + 5 + Math.sin(u * 8) * 0.15 + u * 0.8; card.o.rotation.y += 0.12; setA(card.o, u > 0.75 ? (1 - u) * 4 : 1); card.o.scale.setScalar(2.2); if (Math.random() < 0.7) glow.emit(g.x + rnd(-0.5, 0.5), card.o.position.y + rnd(-0.5, 0.5), g.z + rnd(-0.5, 0.5), 0, -1, 0, 0.35, 0.3, 0.05, GOLDB, 0.9, 0, 0); }, () => card.release()); }
      ringFx(g, 0.5, 5.0, 0.6, GOLDB, true, 0, 1, true); ringFx(g, 0.5, 5.0, 0.9, VERM, false, 0.05, 0.9); ringFx(g, 0.3, 3.4, 0.8, INK, false, 0.1, 0.6);
      for (let i = 0; i < 4; i++) {
        const delay = 0.1 + i * 0.1;
        const ang = rnd(0, 6.28), rr = i === 0 ? 0 : rnd(1.2, 4.2);
        const tx = g.x + Math.cos(ang) * rr, tz = g.z + Math.sin(ang) * rr;
        const hb = bolts.get(); if (!hb) continue;
        const top = new THREE.Vector3(tx + rnd(-1, 1), g.y + 15, tz + rnd(-1, 1)), bot = new THREE.Vector3(tx, g.y + 0.1, tz);
        let flick = 0;
        run(0.4 + delay, (u, dt) => {
          const t = u * (0.4 + delay) - delay;
          if (t < 0) { setA(hb.o, 0); return; }
          if (t < 0.03) { burst(glow, new THREE.Vector3(tx, g.y + 0.3, tz), 12, 5, 0.4, 0.45, [GOLDB, PAPER], 6, 0.9, 0.5); inkBurst(new THREE.Vector3(tx, g.y + 0.3, tz), 5, 3, 0.6); }
          flick -= dt; if (flick <= 0) { shapeBolt(hb.o, top, bot, 0.28 * (i === 0 ? 1.3 : 1), 1.6); flick = 0.035; }
          setA(hb.o, Math.max(0, 1 - t / 0.35) * (0.7 + Math.random() * 0.5));
        }, () => hb.release());
      }
    } else if (skill === 3) { // Frost Seal
      glyphFlash('snow', chest(from, 2.1).addScaledVector(d, 0.8), 1.7, '#bfe6ee');
      launchCard(from, to, [ICE, MISTL, PAPER], (b) => {
        const g = new THREE.Vector3(b.x, b.y - 1.0, b.z);
        ringFx(g, 0.3, 3.2, 0.7, ICE, false, 0, 0.9); ringFx(g, 0.2, 2.2, 0.9, PAPER, true, 0.05, 0.9, true);
        for (let i = 0; i < 12; i++) {
          const h = crystals.get(); if (!h) break;
          const a = (i / 12) * 6.28 + rnd(-0.3, 0.3), rr = i < 4 ? rnd(0, 0.5) : rnd(0.7, 1.7), hh = i < 4 ? rnd(1.6, 2.3) : rnd(0.7, 1.4);
          h.o.position.set(g.x + Math.cos(a) * rr, g.y, g.z + Math.sin(a) * rr);
          h.o.rotation.set((Math.random() - 0.5) * 0.5, rnd(0, 6), (Math.random() - 0.5) * 0.5);
          tint(h.o, i % 3 === 0 ? PAPER : ICE, 0.85);
          const delay = rnd(0, 0.12);
          run(1.5, (u) => { const t = Math.max(0, u * 1.5 - delay); const k = easeOut(clamp01(t / 0.15)); h.o.scale.set(0.6 + 0.4 * k, hh * k, 0.6 + 0.4 * k); setA(h.o, 0.9 * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1)); }, () => h.release());
        }
        burst(soft, g, 16, 2.6, 1.2, 1.2, [MISTL, ICE], -0.2, 0.2, 0.8, 1.5);
        burst(glow, new THREE.Vector3(g.x, g.y + 0.6, g.z), 18, 4, 0.8, 0.22, [PAPER, ICE], -0.6, 0.6, 1);
      });
    } else { // Wind Step
      glyphFlash('swirl', chest(from, 2.2), 1.7, '#cfd9dc');
      const f = new THREE.Vector3(from.x, from.y, from.z);
      ringFx(f, 0.3, 2.2, 0.45, MISTL, true, 0, 1, true); ringFx(f, 0.2, 1.4, 0.5, JADEB, false, 0.05, 0.8);
      const t = new THREE.Vector3(to.x, to.y, to.z);
      const leafC = [JADE, JADEB, PAPERD, GOLD];
      for (let k = 0; k < 2; k++) {
        const h = colsN.get(); if (!h) break;
        tint(h.o, k ? MISTL : PAPER, 0);
        run(0.7, (u, dt) => { h.o.position.set(f.x, f.y, f.z); const r = (0.9 + k * 0.45) * (0.8 + 0.5 * u); h.o.scale.set(r, 2.6 + k * 0.6, r); h.o.rotation.y += dt * (9 - k * 5); setA(h.o, 0.5 * (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8)); }, () => h.release());
      }
      run(0.7, (u) => {
        for (let i = 0; i < 6; i++) {
          const a = u * 14 + i * 1.05, h = u * 2.4 + i * 0.2, rr = 0.9 * (1 - u * 0.5);
          soft.emit(f.x + Math.cos(a) * rr, f.y + h, f.z + Math.sin(a) * rr, Math.cos(a + 1.5) * 1.5, 1, Math.sin(a + 1.5) * 1.5, 0.6, 0.5, 0.2, leafC[(Math.random() * 4) | 0], 0.95, 0.3, 0);
        }
        if (Math.random() < 0.8) glow.emit(f.x + rnd(-1, 1), f.y + rnd(0, 2), f.z + rnd(-1, 1), d.x * 5, 0.2, d.z * 5, 0.35, 0.35, 0.05, MISTL, 0.5, 1, 0);
      });
      if (t.distanceTo(f) > 1) for (let i = 0; i < 20; i++) { const k = i / 20; ink.emit(f.x + (t.x - f.x) * k, f.y + 0.9 + rnd(-0.4, 0.4), f.z + (t.z - f.z) * k, 0, 0.3, 0, 0.45, 0.2, 0.05, INKS, 0.35, 1, 0); }
    }
  }

  // =============== PHYSICIAN ===============
  function physicianCast(skill: number, from: THREE.Vector3, to: THREE.Vector3) {
    const d = dirOf(from, to);
    if (skill === 1) { // Jade Needle
      glyphFlash('needle', chest(from, 2.0).addScaledVector(d, 0.6), 1.5, '#8fe3c0');
      const a = chest(from, 1.2), b = chest(to, 1.0);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      for (let i = 0; i < 3; i++) {
        const h = needles.get(); if (!h) break;
        tint(h.o, i === 1 ? JADEB : JADE, 1);
        const off = (i - 1) * 0.22;
        const aa = new THREE.Vector3(a.x + d.z * off, a.y + (i === 1 ? 0.1 : -0.05), a.z - d.x * off).addScaledVector(d, 0.4);
        const bb = new THREE.Vector3(b.x + d.z * off * 0.3, b.y + (i - 1) * 0.08, b.z - d.x * off * 0.3);
        h.o.rotation.set(0, yaw, 0);
        const delay = i * 0.05;
        h.o.visible = false;
        run(delay + 0.01, () => {}, () => {
          h.o.visible = true;
          const dir2 = new THREE.Vector3().subVectors(bb, aa).normalize();
          h.o.rotation.set(Math.asin(-dir2.y), Math.atan2(dir2.x, dir2.z), 0);
          fly(h.o, aa, bb, 38, (p) => { glow.emit(p.x, p.y, p.z, 0, 0, 0, 0.3, 0.2, 0.02, JADEB, 0.9, 0, 0); ink.emit(p.x, p.y, p.z, 0, 0, 0, 0.25, 0.1, 0.02, PAPER, 0.5, 0, 0); }, () => { burst(glow, bb, 6, 3, 0.35, 0.22, [JADEB, PAPER], 0, 0.4); }, () => h.release());
        });
      }
    } else if (skill === 2) { // Spring Rain (heal)
      const g = new THREE.Vector3(to.x, to.y, to.z);
      glyphFlash('rain', new THREE.Vector3(g.x, g.y + 4.5, g.z), 2.6, '#8fe3c0', '#1a1a1f', 1.0, 0.4); decal(g, 4.0, JADE, 2.0, 0.55);
      ringFx(g, 0.5, 4.2, 0.7, JADE, false, 0, 0.8); ringFx(g, 0.3, 3.2, 1.0, JADEB, true, 0.1, 0.9, true);
      for (let i = 0; i < 4; i++) { const a = rnd(0, 6.28), rr = rnd(0.5, 3); soft.emit(g.x + Math.cos(a) * rr, g.y + 6.5, g.z + Math.sin(a) * rr, 0, 0, 0, 1.5, 2.6, 3.4, MISTL, 0.35, 0, 0); }
      run(1.6, (u) => {
        for (let i = 0; i < 8; i++) { const a = rnd(0, 6.28), rr = Math.sqrt(Math.random()) * 3.5; const px = g.x + Math.cos(a) * rr, pz = g.z + Math.sin(a) * rr, cc = Math.random() < 0.5 ? JADE : INKS; for (let k = 0; k < 4; k++) soft.emit(px, g.y + 6.5 + k * 0.16, pz, 0, -10, 0, 0.62, 0.13 - k * 0.02, 0.1, cc, 0.9 - k * 0.15, 0, 0); }
        if (Math.random() < 0.7) { const a = rnd(0, 6.28), rr = Math.sqrt(Math.random()) * 3; glow.emit(g.x + Math.cos(a) * rr, g.y + 0.2, g.z + Math.sin(a) * rr, 0, rnd(1, 2.2), 0, 1.0, 0.3, 0.05, Math.random() < 0.6 ? JADEB : GOLDB, 0.9, 0.4, 0); }
        if (u < 0.9 && Math.random() < 0.5) { const a = rnd(0, 6.28), rr = Math.sqrt(Math.random()) * 3.2; ringFx(new THREE.Vector3(g.x + Math.cos(a) * rr, g.y - 0.05, g.z + Math.sin(a) * rr), 0.05, 0.5, 0.35, MISTL, true, 0, 0.7); }
      });
    } else if (skill === 3) { // Purifying Light
      const g = new THREE.Vector3(to.x, to.y, to.z);
      glyphFlash('lotus', new THREE.Vector3(g.x, g.y + 4.5, g.z), 2.6, '#ffdf7a', '#1a1a1f', 1.0, 0.8); decal(g, 3.4, GOLD, 1.8, 0.6);
      const h = cols.get();
      if (h) { tint(h.o, GOLDB.clone().lerp(PAPER, 0.5), 0);
        run(1.4, (u) => { const k = easeOut(clamp01(u * 6)); const r = 1.25 * k * (1 - 0.35 * clamp01((u - 0.5) * 2)); h.o.position.set(g.x, g.y, g.z); h.o.scale.set(r, 10 * k, r); h.o.rotation.y += 0.02; setA(h.o, 0.8 * (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3)); }, () => h.release()); }
      const h2 = cols.get();
      if (h2) { tint(h2.o, JADEB, 0);
        run(1.4, (u) => { const k = easeOut(clamp01(u * 5)); const r = 1.9 * k; h2.o.position.set(g.x, g.y, g.z); h2.o.scale.set(r, 7 * k, r); setA(h2.o, 0.35 * (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3)); }, () => h2.release()); }
      ringFx(g, 0.4, 3.0, 0.8, GOLDB, true, 0, 1, true); ringFx(g, 0.3, 2.2, 1.2, PAPER, false, 0.1, 0.6); ringFx(g, 0.6, 1.5, 1.2, JADE, true, 0.2, 0.9, true);
      run(1.3, () => { for (let i = 0; i < 2; i++) { const a = rnd(0, 6.28), rr = rnd(0.2, 1.5); glow.emit(g.x + Math.cos(a) * rr, g.y + 0.1, g.z + Math.sin(a) * rr, 0, rnd(2, 5), 0, 1.0, 0.28, 0.05, Math.random() < 0.5 ? GOLDB : PAPER, 0.95, 0.3, 0); } });
    } else { // Meridian Surge
      const f = new THREE.Vector3(from.x, from.y, from.z);
      glyphFlash('wave', new THREE.Vector3(f.x, f.y + 3.0, f.z), 1.8, '#ffdf7a'); decal(f, 2.6, JADE, 1.4, 0.55);
      for (let i = 0; i < 3; i++) {
        const r = ringsT.get(); if (!r) break;
        tint(r.o, i === 1 ? GOLDB : JADEB, 0);
        run(0.9, (u) => { const k = clamp01(u * 1.2 - i * 0.12); r.o.position.set(f.x, f.y + 0.1 + easeOut(k) * 2.1, f.z); r.o.scale.setScalar(0.9 - 0.35 * k + i * 0.05); setA(r.o, k <= 0 ? 0 : 0.95 * (1 - k)); }, () => r.release());
      }
      ringFx(f, 0.3, 2.6, 0.6, JADE, false, 0, 0.8);
      run(1.0, (u) => { for (let i = 0; i < 3; i++) { const a = u * 16 + i * 2.09, h = (u * 2.2) + i * 0.1; glow.emit(f.x + Math.cos(a) * 0.55, f.y + (h % 2.1), f.z + Math.sin(a) * 0.55, 0, 1.2, 0, 0.5, 0.26, 0.04, i % 2 ? GOLDB : JADEB, 0.95, 0.5, 0); } });
      for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.28; for (let k = 0; k < 4; k++) glow.emit(f.x, f.y + 1.0, f.z, Math.cos(a) * (3 + k * 1.4), rnd(-0.2, 0.6), Math.sin(a) * (3 + k * 1.4), 0.4, 0.2, 0.03, JADEB, 0.9, 2.5, 0); }
    }
  }

  // =============== hit ===============
  function hit(at: THREE.Vector3, crit: boolean) {
    const p = new THREE.Vector3(at.x, at.y + 1.0, at.z);
    extras.splat(p, crit);
    decal(new THREE.Vector3(at.x + rnd(-0.4, 0.4), at.y, at.z + rnd(-0.4, 0.4)), crit ? 1.5 : 0.8, crit ? VERM : INK, crit ? 1.4 : 0.8, 0.8);
    if (crit) {
      burst(ink, p, 18, 8, 0.7, 0.5, VERM, 8, 0.4, 1, 1.6);
      burst(ink, p, 10, 5, 0.6, 0.4, INK, 9, 0.5, 1, 1.6);
      burst(glow, p, 18, 9, 0.4, 0.35, [VERMB, GOLDB], 0, 0.3, 1, 2);
      seal(new THREE.Vector3(p.x, p.y + 0.5, p.z), 1.5, 0.55);
      ringFx(new THREE.Vector3(p.x, p.y - 0.9, p.z), 0.3, 2.4, 0.4, VERM, true, 0, 1, true);
      // radial ink lines
      for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.28; for (let k = 0; k < 3; k++) ink.emit(p.x, p.y, p.z, Math.cos(a) * (6 + k * 2), rnd(-1, 1), Math.sin(a) * (6 + k * 2), 0.22, 0.2, 0.02, INK, 0.8, 4, 0); }
    } else {
      burst(ink, p, 14, 6, 0.55, 0.36, INK, 9, 0.5, 1, 1.8);
      burst(glow, p, 5, 6, 0.25, 0.22, PAPER, 0, 0.3, 1, 2);
      burst(ink, p, 4, 3, 0.5, 0.25, INKS, 6, 0.8, 1, 1.8);
    }
  }


  function levelUp(at: THREE.Vector3) {
    const g = new THREE.Vector3(at.x, at.y, at.z);
    // Gold pillar: normal-blended body (keeps saturated #c9a227) plus a narrow additive core that stays gold, never white.
    const h = colsN.get();
    if (h) { tint(h.o, GOLD, 0); run(1.8, (u) => { const k = easeOut(clamp01(u * 5)); const r = 1.3 * (1 - 0.5 * clamp01((u - 0.5) * 2)); h.o.position.copy(g); h.o.scale.set(r, 22 * k, r); h.o.rotation.y += 0.03; setA(h.o, 0.62 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)); }, () => h.release()); }
    const h2 = cols.get();
    if (h2) { tint(h2.o, GOLD, 0); run(1.6, (u) => { const k = easeOut(clamp01(u * 4)); h2.o.position.copy(g); h2.o.scale.set(0.5, 16 * k, 0.5); setA(h2.o, 0.4 * (u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5)); }, () => h2.release()); }
    ringFx(g, 0.4, 5, 0.9, GOLDB, true, 0, 1, true); ringFx(g, 0.3, 3.4, 1.2, PAPER, false, 0.1, 0.7); ringFx(g, 0.3, 7, 1.1, GOLD, true, 0.2, 0.8, true);
    decal(g, 3.2, GOLD, 2.0, 0.7);
    glyphFlash('plum', new THREE.Vector3(g.x, g.y + 3.2, g.z), 2.6, '#ffdf7a', '#1a1a1f', 1.4, 1.2);
    run(1.6, () => { for (let i = 0; i < 3; i++) { const a = rnd(0, 6.28), rr = rnd(0.2, 1.4); glow.emit(g.x + Math.cos(a) * rr, g.y + 0.1, g.z + Math.sin(a) * rr, 0, rnd(4, 9), 0, 1.3, 0.3, 0.05, Math.random() < 0.6 ? GOLDB : PAPER, 0.95, 0.2, 0); } });
  }
  function respawn(at: THREE.Vector3) {
    const g = new THREE.Vector3(at.x, at.y, at.z);
    for (let i = 0; i < 4; i++) ringFx(g, 0.2, 3.5 + i * 0.8, 1.0, i % 2 ? JADEB : PAPER, true, i * 0.15, 0.9, true);
    ringFx(g, 0.2, 2.4, 1.2, INKS, false, 0.05, 0.6);
    decal(g, 2.4, INK, 1.4, 0.6);
    glyphFlash('sprout', new THREE.Vector3(g.x, g.y + 2.6, g.z), 1.8, '#8fe3c0', '#1a1a1f', 1.2, 0.8);
    burst(glow, new THREE.Vector3(g.x, g.y + 0.2, g.z), 28, 2.5, 1.2, 0.26, [JADEB, PAPER, GOLDB], -1.5, 1.4, 0.8, 1.2);
  }


  // =============== TELEGRAPH (boss ground danger zone) ===============
  const SEAL_TEX = symbolTexture("taiji", 256, "#f2ead8", "#6a1512").tex;
  const teleGeoBase = (() => { // polar disc grid, unit radius (x,z); y filled per spawn from the terrain
    const SEG = 72, RINGS = 14, pos: number[] = [], idx: number[] = [];
    pos.push(0, 0, 0);
    for (let r = 1; r <= RINGS; r++) for (let k = 0; k < SEG; k++) { const a = (k / SEG) * Math.PI * 2, rr = r / RINGS; pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); }
    for (let k = 0; k < SEG; k++) idx.push(0, 1 + ((k + 1) % SEG), 1 + k);
    for (let r = 1; r < RINGS; r++) for (let k = 0; k < SEG; k++) {
      const a = 1 + (r - 1) * SEG + k, b = 1 + (r - 1) * SEG + ((k + 1) % SEG), c = a + SEG, d = b + SEG;
      idx.push(a, b, c, b, d, c);
    }
    return { pos, idx };
  })();
  const teleMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: {
      uProg: { value: 0 }, uFlash: { value: 0 }, uAlpha: { value: 1 }, uTime: { value: 0 }, uSeed: { value: 0 },
      uSeal: { value: SEAL_TEX }, uVerm: { value: VERM.clone() }, uDeep: { value: C(0x7a1a14) }, uInk: { value: INK.clone() }, uPaper: { value: PAPER.clone() },
    },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      uniform float uProg, uFlash, uAlpha, uTime, uSeed; uniform sampler2D uSeal; uniform vec3 uVerm, uDeep, uInk, uPaper; varying vec2 vP;
      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float r = length(vP); if (r > 1.0) discard;
        float ang = atan(vP.y, vP.x);
        // ink-brush wobble of every ring edge
        float wob = (vn(vec2(ang * 3.0 + uSeed, uSeed * 1.7)) - 0.5) * 0.045 + (vn(vec2(ang * 11.0, uSeed + uTime * 0.4)) - 0.5) * 0.012;
        float rw = r - wob;
        // outer brush ring: thick wet stroke, dry-brush streaks along the arc
        float ring = smoothstep(0.86, 0.9, rw) * (1.0 - smoothstep(0.975, 1.0, rw));
        float dry = 0.62 + 0.38 * vn(vec2(ang * 22.0 + uSeed * 3.0, rw * 40.0));
        float inkEdge = smoothstep(0.935, 0.975, rw) * (1.0 - smoothstep(0.975, 1.0, rw)); // dark outer lip
        // inner thin ring + eight faint spokes
        float ring2 = (1.0 - smoothstep(0.0, 0.012, abs(rw - 0.52))) * 0.6;
        float spokes = (1.0 - smoothstep(0.0, 0.02, abs(sin(ang * 4.0)) * r)) * smoothstep(0.12, 0.3, r) * (1.0 - smoothstep(0.82, 0.9, r)) * 0.28;
        // radial fill (ink wash flooding outwards from the seal), with a bright leading edge
        float fr = uProg * 0.9;
        float fill = 1.0 - smoothstep(fr - 0.02, fr + 0.01, rw);
        fill *= step(rw, 0.9);
        float lead = (1.0 - smoothstep(0.0, 0.03, abs(rw - fr))) * step(0.001, uProg) * step(rw, 0.9);
        float flow = 0.8 + 0.2 * vn(vec2(rw * 9.0 - uTime * 2.0, ang * 4.0));
        float urgent = smoothstep(0.7, 1.0, uProg) * (0.5 + 0.5 * sin(uTime * 22.0));
        // base danger tint inside the zone
        float inside = step(rw, 0.9) * (0.2 + 0.08 * vn(vP * 7.0 + uSeed));
        vec3 col = uDeep; float a = inside;
        col = mix(col, mix(uVerm, uDeep, 0.3), fill * 0.92); a = max(a, fill * (0.5 + 0.14 * flow));
        col = mix(col, vec3(1.0, 0.45, 0.32), lead * 0.9 + urgent * 0.25 * fill); a = max(a, lead * 0.95);
        col = mix(col, uVerm, ring * dry); a = max(a, ring * dry * 0.92);
        col = mix(col, uInk, inkEdge * 0.75); a = max(a, inkEdge * 0.85);
        col = mix(col, uDeep, ring2); a = max(a, ring2 * 0.7);
        col = mix(col, uVerm, spokes); a = max(a, spokes * 0.6);
        // central seal
        vec2 su = vec2(-vP.x, vP.y) / 0.2; float rot = 0.0; float cs = cos(rot), sn = sin(rot); su = mat2(cs, -sn, sn, cs) * su;
        if (abs(su.x) < 1.0 && abs(su.y) < 1.0) {
          vec4 sc = texture2D(uSeal, su * 0.5 + 0.5);
          float cr = max(abs(su.x), abs(su.y)); float sq = 1.0 - smoothstep(0.88, 0.98, cr);
          vec3 seal = mix(uVerm, uPaper, sc.a * 0.95); seal = mix(seal, uInk, (1.0 - smoothstep(0.84, 0.9, cr)) * 0.0);
          float sa = sq * (0.55 + 0.45 * uProg);
          col = mix(col, seal, sa); a = max(a, sa);
        }
        // impact flash: whole zone blooms bright vermilion-white then fades
        col = mix(col, mix(vec3(1.0, 0.8, 0.7), uPaper, 0.4), uFlash * 0.85); a = max(a, uFlash * (1.0 - smoothstep(0.6, 1.0, r)) + uFlash * ring);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const teleSlots = Array.from({ length: 3 }, () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(teleGeoBase.pos), 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(teleGeoBase.idx);
    const m = new THREE.Mesh(g, teleMat()); m.frustumCulled = false; m.visible = false; m.renderOrder = 3; root.add(m);
    return { m, used: false };
  });
  function bossSlam(at: THREE.Vector3, radius = 6) {
    const prio = fxBudget.prio; fxBudget.prio = true;
    try {
      const g = new THREE.Vector3(at.x, at.y, at.z);
      ringFx(g, 0.5, radius * 1.3, 0.55, PAPER, false, 0, 1);
      ringFx(g, 0.4, radius * 1.05, 0.5, VERMB, true, 0.03, 1, true);
      ringFx(g, 0.3, radius * 1.55, 0.8, INKS, false, 0.07, 0.75);
      ringFx(g, 0.2, radius * 0.8, 0.9, INK, false, 0.14, 0.5);
      decal(g, radius * 0.95, INK, 2.4, 0.9); decal(g, radius * 0.55, VERM, 1.6, 0.6);
      glyphFlash("crack", new THREE.Vector3(g.x, g.y + 3.4, g.z), 3.4, "#ff6a4a", "#1a1a1f", 0.95, 1.0);
      // ink shockwave: a ring of ink + dust thrown outward at the edge of the zone
      const nRing = Math.min(90, Math.round(26 + radius * 6));
      for (let i = 0; i < nRing; i++) {
        const a = (i / nRing) * Math.PI * 2 + rnd(-0.05, 0.05), rr = radius * rnd(0.78, 0.98), sp = rnd(5, 9);
        const px = g.x + Math.cos(a) * rr, pz = g.z + Math.sin(a) * rr, py = heightAt(px, pz) + 0.15;
        ink.emit(px, py, pz, Math.cos(a) * sp, rnd(2, 6), Math.sin(a) * sp, rnd(0.5, 0.8), rnd(0.3, 0.55), 0.08, i % 4 === 0 ? VERM : INK, 0.9, 1.6, 10);
        if (i % 2 === 0) soft.emit(px, py + 0.1, pz, Math.cos(a) * sp * 0.5, rnd(0.8, 2.2), Math.sin(a) * sp * 0.5, rnd(0.9, 1.5), rnd(0.8, 1.2), rnd(2.0, 3.2), i % 4 === 0 ? PAPERD : MIST, 0.5, 1.6, 0);
      }
      // dust column + cracks + embers at the centre
      for (let i = 0; i < 22; i++) { const a = rnd(0, 6.28), rr = rnd(0, radius * 0.6); soft.emit(g.x + Math.cos(a) * rr, g.y + 0.2, g.z + Math.sin(a) * rr, Math.cos(a) * 1.5, rnd(1.8, 4.5), Math.sin(a) * 1.5, rnd(1, 1.8), rnd(0.9, 1.4), rnd(2.4, 3.8), i % 3 ? PAPERD : MISTL, 0.45, 1.2, 0); }
      burst(glow, new THREE.Vector3(g.x, g.y + 0.5, g.z), 30, 9, 0.6, 0.4, [VERMB, GOLDB, VERM], 4, 0.9, 0.6, 1.4);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + rnd(-0.25, 0.25), len = radius * rnd(0.55, 1.0), n = Math.round(len * 3);
        for (let k = 1; k <= n; k++) { const rr = len * k / n, jig = rnd(-0.12, 0.12); const px = g.x + Math.sin(a + jig) * rr, pz = g.z + Math.cos(a + jig) * rr; ink.emit(px, heightAt(px, pz) + 0.1, pz, 0, 0, 0, 1.1, 0.26 * (1 - k / (n + 3)), 0.08, INK, 0.92, 0, 0); }
      }
    } finally { fxBudget.prio = prio; }
  }
  function telegraph(at: THREE.Vector3, radius: number, delay: number) {
    const slot = teleSlots.find((x) => !x.used);
    const dur = Math.max(0.15, delay);
    const g = new THREE.Vector3(at.x, at.y, at.z);
    if (!slot) { run(dur, () => {}, () => bossSlam(g, radius)); return; }  // pool exhausted: still deliver the hit
    slot.used = true;
    const m = slot.m, u = (m.material as THREE.ShaderMaterial).uniforms;
    const pos = (m.geometry as THREE.BufferGeometry).getAttribute("position") as THREE.BufferAttribute;
    // conform to the terrain: each vertex follows heightAt (+ a lift that grows with local slope so steep ground never clips it)
    for (let i = 0; i < pos.count; i++) {
      const lx = teleGeoBase.pos[i * 3], lz = teleGeoBase.pos[i * 3 + 2];
      const wx = g.x + lx * radius, wz = g.z + lz * radius;
      const y = heightAt(wx, wz);
      const sl = Math.abs(heightAt(wx + 0.4, wz) - y) + Math.abs(heightAt(wx, wz + 0.4) - y);
      pos.setXYZ(i, lx, y - g.y + 0.07 + sl * 0.22, lz);
    }
    pos.needsUpdate = true;
    m.position.set(g.x, g.y, g.z); m.scale.set(radius, 1, radius); m.visible = true;
    u.uSeed.value = Math.random() * 20; u.uProg.value = 0; u.uFlash.value = 0; u.uAlpha.value = 0; u.uTime.value = 0;
    const TAIL = 0.6, total = dur + TAIL;
    let burstDone = false;
    live.push({
      u: 0, dur: total,
      tick: (k, dt) => {
        const t = k * total;
        u.uTime.value += dt;
        if (t < dur) { u.uProg.value = t / dur; u.uAlpha.value = Math.min(1, t * 6); u.uFlash.value = 0; }
        else {
          if (!burstDone) { burstDone = true; u.uProg.value = 1; bossSlam(g, radius); }
          const f = (t - dur) / TAIL;
          u.uFlash.value = Math.max(0, 1 - f * 4.5); u.uAlpha.value = 1 - clamp01((f - 0.15) / 0.85);
        }
      },
      done: () => { m.visible = false; slot.used = false; },
    });
  }

  // =============== SHAPED TELEGRAPHS (cone / line / rotating beam) ===============
  // One grid mesh in (u along, v across) space; the vertex shader passes uv through, positions are laid out in world space (terrain-conforming) by layoutWedge.
  const wedgeMat = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: {
      uProg: { value: 0 }, uFlash: { value: 0 }, uAlpha: { value: 1 }, uTime: { value: 0 }, uSeed: { value: 0 }, uLive: { value: 0 }, uBeam: { value: 0 },
      uVerm: { value: VERM.clone() }, uDeep: { value: C(0x7a1a14) }, uInk: { value: INK.clone() }, uPaper: { value: PAPER.clone() }, uHot: { value: C(0xffb070) },
    },
    vertexShader: `varying vec2 vUV; void main(){ vUV = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      uniform float uProg, uFlash, uAlpha, uTime, uSeed, uLive, uBeam; uniform vec3 uVerm, uDeep, uInk, uPaper, uHot; varying vec2 vUV;
      float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        float u = vUV.x, v = vUV.y;
        float wob = (vn(vec2(u * 6.0 + uSeed, uSeed * 1.7)) - 0.5) * 0.09 + (vn(vec2(u * 19.0, uSeed + uTime * 0.5)) - 0.5) * 0.025;
        float av = abs(v) - wob;
        if (av > 1.0 || u > 1.0 || u < 0.0) discard;
        // beam fades toward its far tip; zones close with a brush cap
        float far = mix(1.0, 1.0 - smoothstep(0.82, 1.0, u), uBeam);
        float edge = smoothstep(0.8, 0.9, av) * (1.0 - smoothstep(0.97, 1.0, av));
        float dry = 0.6 + 0.4 * vn(vec2(u * 34.0 + uSeed * 3.0, av * 16.0));
        float lip = smoothstep(0.92, 0.975, av) * (1.0 - smoothstep(0.975, 1.0, av));
        float cap = (1.0 - uBeam) * smoothstep(0.9, 0.96, u) * (1.0 - smoothstep(0.985, 1.0, u));
        // ink wash flooding outwards along the zone, bright leading edge
        float fill = 1.0 - smoothstep(uProg - 0.03, uProg + 0.01, u);
        float lead = (1.0 - smoothstep(0.0, 0.035, abs(u - uProg))) * step(0.001, uProg) * step(uProg, 0.995);
        float flow = 0.8 + 0.2 * vn(vec2(u * 12.0 - uTime * 3.0, v * 3.0));
        float urgent = smoothstep(0.7, 1.0, uProg) * (0.5 + 0.5 * sin(uTime * 24.0)) * (1.0 - uBeam);
        float base = 0.2 + 0.08 * vn(vec2(u * 9.0, v * 5.0) + uSeed);
        vec3 col = uDeep; float a = base;
        col = mix(col, mix(uVerm, uDeep, 0.3), fill * 0.92); a = max(a, fill * (0.5 + 0.14 * flow));
        col = mix(col, vec3(1.0, 0.45, 0.32), lead * 0.9 + urgent * 0.25 * fill); a = max(a, lead * 0.95);
        col = mix(col, uVerm, max(edge * dry, cap)); a = max(a, max(edge * dry, cap) * 0.92);
        col = mix(col, uInk, lip * 0.75); a = max(a, lip * 0.85);
        // live beam: hot core stripe with flicker (white-hot centre)
        float core = (1.0 - smoothstep(0.0, 0.55, av)) * uLive;
        float flick = 0.8 + 0.2 * sin(uTime * 40.0 + u * 14.0) * vn(vec2(u * 8.0 - uTime * 6.0, 1.0));
        col = mix(col, uHot, core * 0.9 * flick); col = mix(col, vec3(1.0, 0.95, 0.85), pow(core, 3.0) * 0.85); a = max(a, core * 0.95);
        a *= far;
        col = mix(col, mix(vec3(1.0, 0.8, 0.7), uPaper, 0.4), uFlash * 0.8); a = max(a, uFlash * (1.0 - smoothstep(0.7, 1.0, u)) * 0.9);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const WEDGE_NU = 28, WEDGE_NV = 14;
  const wedgeIdx = (() => { const idx: number[] = []; for (let i = 0; i < WEDGE_NU; i++) for (let j = 0; j < WEDGE_NV; j++) { const a = i * (WEDGE_NV + 1) + j, b = a + 1, c = a + WEDGE_NV + 1, d = c + 1; idx.push(a, c, b, b, c, d); } return idx; })();
  const wedgeUV = (() => { const uv: number[] = []; for (let i = 0; i <= WEDGE_NU; i++) for (let j = 0; j <= WEDGE_NV; j++) uv.push(i / WEDGE_NU, -1 + (2 * j) / WEDGE_NV); return new Float32Array(uv); })();
  const wedgeSlots = Array.from({ length: 8 }, () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((WEDGE_NU + 1) * (WEDGE_NV + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("uv", new THREE.BufferAttribute(wedgeUV, 2));
    g.setIndex(wedgeIdx);
    const m = new THREE.Mesh(g, wedgeMat()); m.frustumCulled = false; m.visible = false; m.renderOrder = 3; root.add(m);
    return { m, used: false };
  });
  /** Lay the zone out in world space (relative to `g`), following the terrain. `d` = facing now (rotates for beams). */
  function layoutWedge(m: THREE.Mesh, g: THREE.Vector3, o: ShapeTelegraph, d: number) {
    const pos = (m.geometry as THREE.BufferGeometry).getAttribute("position") as THREE.BufferAttribute;
    const hw = (o.width ?? 2) / 2, half = (o.arc ?? 1.4) / 2;
    const back = o.shape === "line" ? hw : 0; // the hit test reaches half a width behind the origin
    const sd = Math.sin(d), cd = Math.cos(d);
    let n = 0;
    for (let i = 0; i <= WEDGE_NU; i++) for (let j = 0; j <= WEDGE_NV; j++) {
      const u = i / WEDGE_NU, v = -1 + (2 * j) / WEDGE_NV;
      let lx: number, lz: number;
      if (o.shape === "line") { const al = -back + u * (o.len + back); lx = sd * al + cd * v * hw; lz = cd * al - sd * v * hw; }
      else { const a = d + v * half; lx = Math.sin(a) * u * o.len; lz = Math.cos(a) * u * o.len; }
      const wx = g.x + lx, wz = g.z + lz, y = heightAt(wx, wz);
      const sl = Math.abs(heightAt(wx + 0.4, wz) - y) + Math.abs(heightAt(wx, wz + 0.4) - y);
      pos.setXYZ(n++, lx, y - g.y + 0.08 + sl * 0.22, lz);
    }
    pos.needsUpdate = true;
  }
  function telegraphShape(at: THREE.Vector3, o: ShapeTelegraph) {
    const slot = wedgeSlots.find((x) => !x.used);
    if (!slot) return; // pool exhausted: server damage still lands, only the decoration is dropped
    slot.used = true;
    const g = new THREE.Vector3(at.x, at.y, at.z);
    const m = slot.m, u = (m.material as THREE.ShaderMaterial).uniforms;
    const beam = !!o.beam, lead = o.lead ?? 0, dur = Math.max(0.15, o.delay);
    // beams also show a faint ghost of where the sweep will end
    let ghost: (typeof wedgeSlots)[number] | undefined;
    if (beam && o.sweep) {
      ghost = wedgeSlots.find((x) => !x.used);
      if (ghost) {
        ghost.used = true; const gu = (ghost.m.material as THREE.ShaderMaterial).uniforms;
        layoutWedge(ghost.m, g, o, o.dir + o.sweep);
        ghost.m.position.set(g.x, g.y, g.z); ghost.m.scale.set(1, 1, 1); ghost.m.visible = true;
        gu.uSeed.value = Math.random() * 20; gu.uProg.value = 1; gu.uFlash.value = 0; gu.uAlpha.value = 0; gu.uTime.value = 0; gu.uLive.value = 0; gu.uBeam.value = 1;
      }
    }
    layoutWedge(m, g, o, o.dir);
    m.position.set(g.x, g.y, g.z); m.scale.set(1, 1, 1); m.visible = true;
    u.uSeed.value = Math.random() * 20; u.uProg.value = 0; u.uFlash.value = 0; u.uAlpha.value = 0; u.uTime.value = 0; u.uLive.value = 0; u.uBeam.value = beam ? 1 : 0;
    const TAIL = beam ? 0.45 : 0.5, total = dur + TAIL;
    let burstDone = false;
    live.push({
      u: 0, dur: total,
      tick: (k, dt) => {
        const t = k * total;
        u.uTime.value += dt;
        if (t < dur) {
          if (beam) {
            u.uProg.value = Math.min(1, t / Math.max(0.2, lead * 0.7)); u.uAlpha.value = Math.min(1, t * 5);
            if (ghost) (ghost.m.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.3 * Math.min(1, t * 3);
            const sweepT = dur - lead, f = clamp01((t - lead) / Math.max(0.1, sweepT));
            const ang = o.dir + (o.sweep ?? 0) * f;
            if (t >= lead) {
              u.uLive.value = Math.min(1, (t - lead) * 8);
              if (!burstDone) { burstDone = true; ringFx(g, 0.4, 2.4, 0.5, PAPER, false, 0, 0.9); glyphFlash("crack", new THREE.Vector3(g.x, g.y + 3.0, g.z), 2.6, "#ffb070", "#1a1a1f", 0.7, 0.9); }
              layoutWedge(m, g, o, ang);
              // embers and ink motes thrown off the beam
              const sa = Math.sin(ang), ca = Math.cos(ang);
              for (let i = 0; i < 3; i++) { const along = rnd(1, o.len * 0.95), side = rnd(-0.5, 0.5) * (o.width ?? 2); const px = g.x + sa * along + ca * side, pz = g.z + ca * along - sa * side; glow.emit(px, heightAt(px, pz) + 0.2, pz, rnd(-0.4, 0.4), rnd(1.2, 3.2), rnd(-0.4, 0.4), rnd(0.35, 0.7), rnd(0.18, 0.32), 0.04, i === 0 ? GOLDB : VERMB, 0.9, 0.5, -0.6); }
              if (Math.random() < 0.5) { const along = rnd(1, o.len * 0.9), px = g.x + sa * along, pz = g.z + ca * along; ink.emit(px, heightAt(px, pz) + 0.15, pz, rnd(-1, 1), rnd(1, 2.5), rnd(-1, 1), rnd(0.4, 0.7), 0.2, 0.05, INK, 0.8, 1.2, 4); }
            }
          } else {
            u.uProg.value = t / dur; u.uAlpha.value = Math.min(1, t * 7); u.uFlash.value = 0;
          }
        } else {
          const f = (t - dur) / TAIL;
          if (beam) { u.uAlpha.value = 1 - clamp01(f); u.uLive.value = 1 - clamp01(f * 2); if (ghost) (ghost.m.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.3 * (1 - clamp01(f)); }
          else {
            if (!burstDone) {
              burstDone = true; u.uProg.value = 1;
              // a small ink burst thrown out of the zone (the big boss slam effect is reserved for the circle)
              const sa = Math.sin(o.dir), ca = Math.cos(o.dir);
              for (let i = 0; i < 16; i++) {
                const al = rnd(0.3, 1) * o.len, side = o.shape === "line" ? rnd(-0.5, 0.5) * (o.width ?? 2) : rnd(-0.5, 0.5) * (o.arc ?? 1.4) * al;
                const px = g.x + sa * al + ca * side, pz = g.z + ca * al - sa * side;
                ink.emit(px, heightAt(px, pz) + 0.15, pz, rnd(-1.4, 1.4) + sa * 2, rnd(1.5, 3.2), rnd(-1.4, 1.4) + ca * 2, rnd(0.3, 0.55), rnd(0.14, 0.26), 0.06, i % 4 === 0 ? VERM : INK, 0.9, 1.6, 8);
              }
            }
            u.uFlash.value = Math.max(0, 1 - f * 4.5); u.uAlpha.value = 1 - clamp01((f - 0.15) / 0.85);
          }
        }
      },
      done: () => { m.visible = false; slot.used = false; if (ghost) { ghost.m.visible = false; ghost.used = false; } },
    });
  }

  function cast(skill: number, cls: ClassId, from: THREE.Vector3, to: THREE.Vector3, local = true) {
    fxBudget.prio = local;
    try { castInner(skill, cls, from, to); } finally { fxBudget.prio = true; }
  }
  function castInner(skill: number, cls: ClassId, from: THREE.Vector3, to: THREE.Vector3) {
    if (cls === "sword" || cls === "blade") swordCast(skill, from, to);
    else if (cls === "talisman") { extras.bagua(from, fxBudget.prio); talismanCast(skill, from, to); }
    else physicianCast(skill, from, to);
  }

  function update(dt: number) {
    dt = Math.min(dt, 0.1);
    for (let i = live.length - 1; i >= 0; i--) {
      const l = live[i];
      l.u = Math.min(1, l.u + dt / l.dur);
      l.tick(l.u, dt);
      if (l.u >= 1) { l.done(); live.splice(i, 1); }
    }
    ink.update(dt); glow.update(dt); soft.update(dt); extras.update(dt);
  }
  return { cast, hit, update, levelUp, respawn, telegraph, telegraphShape, bossSlam };
}
