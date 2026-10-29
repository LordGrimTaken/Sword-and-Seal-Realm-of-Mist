// JIUZHOU dodge-roll VFX: an ink-brush smear along the ground plus paper-white speed streaks at waist height.
// Kept in its own module (pooled, 5 slots); the avatar's somersault is driven by EntityManager.startRoll.
import * as THREE from "three";

const INK = 0x1a1a1f, PAPER = 0xf2ead8, VERM = 0xc8372d;

/** Vertical brush stroke texture: canvas top = tail (faded, thin, dry-brush), bottom = head (solid). */
function strokeTexture(): THREE.CanvasTexture {
  const W = 64, H = 256;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);                       // 0 tail .. 1 head
    const halfW = (0.12 + 0.88 * Math.pow(t, 0.6)) * (W / 2 - 2);
    const a = Math.pow(t, 1.3);
    // dry-brush: many thin bristle lines, gaps increase toward the tail
    for (let x = -halfW; x <= halfW; x += 1) {
      const edge = 1 - Math.pow(Math.abs(x) / halfW, 3);
      const bristle = 0.55 + 0.45 * Math.sin(x * 1.7 + Math.sin(y * 0.05) * 3) * Math.sin(x * 0.63 + 2);
      const gap = rnd() < (1 - t) * 0.45 ? 0.25 : 1;
      g.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, a * edge * bristle * gap)).toFixed(3)})`;
      g.fillRect(W / 2 + x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Slot { group: THREE.Group; meshes: THREE.Mesh[]; mats: THREE.MeshBasicMaterial[]; used: boolean; age: number; dur: number; base: number[] }

export interface RollFx {
  /** Start a streak from (x,z) along (dx,dz) for `dist` units. `local` plays even when the pool is busy. */
  play(x: number, z: number, dx: number, dz: number, dist: number, dur: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createRollFx(scene: THREE.Scene, heightAt: (x: number, z: number) => number): RollFx {
  const root = new THREE.Group(); root.name = "rollfx"; scene.add(root);
  let tex: THREE.CanvasTexture | null = null; // created on the first roll so players who never roll pay nothing (texture budget)
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2); // x = width, z = length (v=1 at -z = tail)
  const mk = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const slots: Slot[] = Array.from({ length: 5 }, () => {
    const group = new THREE.Group(); group.visible = false; root.add(group);
    const defs = [ // [colour, width, height above ground, sideways offset, opacity]
      [INK, 1.5, 0.12, 0, 0.9], [VERM, 0.55, 0.14, 0, 0.55],
      [PAPER, 0.28, 0.75, 0.32, 0.85], [PAPER, 0.22, 1.25, -0.3, 0.8], [PAPER, 0.18, 0.45, -0.18, 0.7],
    ] as const;
    const meshes: THREE.Mesh[] = [], mats: THREE.MeshBasicMaterial[] = [], base: number[] = [];
    for (const [c, w, h, side, o] of defs) {
      const m = mk(c, o), mesh = new THREE.Mesh(geo, m);
      mesh.userData = { w, h, side };
      mesh.renderOrder = 4; group.add(mesh); meshes.push(mesh); mats.push(m); base.push(o);
    }
    return { group, meshes, mats, used: false, age: 0, dur: 0.6, base };
  });

  function play(x: number, z: number, dx: number, dz: number, dist: number, dur: number) {
    if (!tex) { tex = strokeTexture(); for (const q of slots) for (const m of q.mats) { m.map = tex; m.needsUpdate = true; } }
    const s = slots.find((q) => !q.used) ?? slots.reduce((a, b) => (a.age > b.age ? a : b));
    s.used = true; s.age = 0; s.dur = dur + 0.45;
    const len = dist + 1.4;
    const ex = x + dx * dist, ez = z + dz * dist;
    const sy = heightAt(x, z), ey = heightAt(ex, ez);
    // group sits at the start and faces the end point; each mesh is a strip of length `len` ending slightly past the end
    s.group.position.set(x - dx * 0.6, sy, z - dz * 0.6);
    s.group.lookAt(ex + dx * 0.8, ey, ez + dz * 0.8);
    for (const m of s.meshes) {
      const u = m.userData as { w: number; h: number; side: number };
      m.scale.set(u.w, 1, len);
      m.position.set(u.side, u.h, len / 2);
    }
    s.group.visible = true;
  }

  function update(dt: number) {
    for (const s of slots) {
      if (!s.used) continue;
      s.age += dt;
      const u = s.age / s.dur;
      if (u >= 1) { s.used = false; s.group.visible = false; continue; }
      // quick bloom in, then fade like drying ink
      const k = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
      s.mats.forEach((m, i) => { m.opacity = s.base[i] * Math.max(0, k); });
    }
  }
  function dispose() { scene.remove(root); geo.dispose(); tex?.dispose(); for (const s of slots) s.mats.forEach((m) => m.dispose()); }
  return { play, update, dispose };
}
