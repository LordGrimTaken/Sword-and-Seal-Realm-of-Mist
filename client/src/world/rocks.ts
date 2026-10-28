// Faceted, chiselled, mossy rock chunks with per-face colour (stratified stone, moss on up-facing faces, rain streaks).
import * as THREE from "three";
import { mulberry32, smoothstep, vnoise } from "./noise";
import { PAL, hex } from "./toon";

export interface RockOpts {
  detail?: number;                 // icosahedron subdivision (1 = 80 faces, 2 = 320)
  cuts?: number;                   // planar chisel cuts
  moss?: number;                   // 0..1 moss coverage on up-facing faces
  stone?: THREE.Color; stoneD?: THREE.Color; mossC?: THREE.Color; mossD?: THREE.Color;
  strata?: number;                 // stripe contrast
  rough?: number;                  // vertex noise amplitude
  glowCracks?: boolean;
}

const hashV = (x: number, y: number, z: number, s: number) => vnoise(x * 1.9 + s * 3.1 + z * 0.7, y * 1.7 - z * 1.3 + s);

export function rockChunk(seed: number, sx = 1, sy = 1, sz = 1, o: RockOpts = {}): THREE.BufferGeometry {
  const rnd = mulberry32(seed * 7919 + 13);
  const stone = o.stone ?? hex(PAL.mist, PAL.paperDark, 0.28), stoneD = o.stoneD ?? hex(PAL.inkSoft, PAL.mist, 0.42);
  const mossC = o.mossC ?? hex(PAL.jade, PAL.paperDark, 0.32), mossD = o.mossD ?? hex(PAL.jade, PAL.inkSoft, 0.42);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, o.detail ?? 1);
  if (g.index) g = g.toNonIndexed();
  const p = g.getAttribute("position");
  const rough = o.rough ?? 0.34;
  const cuts: { n: THREE.Vector3; d: number }[] = [];
  const nc = o.cuts ?? 4;
  for (let i = 0; i < nc; i++) {
    const n = new THREE.Vector3(rnd() * 2 - 1, (rnd() * 2 - 1) * 0.6 + (i === 0 ? 0.9 : 0), rnd() * 2 - 1).normalize();
    cuts.push({ n, d: i === 0 ? 0.62 + rnd() * 0.15 : 0.55 + rnd() * 0.3 });
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const d = 1 - rough * 0.5 + rough * hashV(v.x, v.y, v.z, seed);
    v.multiplyScalar(d);
    for (const c of cuts) { const k = v.dot(c.n) - c.d; if (k > 0) v.addScaledVector(c.n, -k); }
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  const n = p.count, col = new Float32Array(n * 3), nr = g.getAttribute("normal");
  const mossAmt = o.moss ?? 0.6, strata = o.strata ?? 0.35;
  const c = new THREE.Color(), a = new THREE.Vector3(), b = new THREE.Vector3(), cen = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let f = 0; f < n; f += 3) {
    a.set(p.getX(f), p.getY(f), p.getZ(f)); b.set(p.getX(f + 1), p.getY(f + 1), p.getZ(f + 1));
    cen.set(a.x + b.x + p.getX(f + 2), a.y + b.y + p.getY(f + 2), a.z + b.z + p.getZ(f + 2)).multiplyScalar(1 / 3);
    nn.set(nr.getX(f), nr.getY(f), nr.getZ(f));
    const band = 0.5 + 0.5 * Math.sin(cen.y * 5.5 / Math.max(0.5, sy) + vnoise(cen.x * 2 + seed, cen.z * 2) * 3);
    c.copy(stoneD).lerp(stone, 0.35 + strata * band + 0.25 * (nn.y * 0.5 + 0.5));
    const up = smoothstep(0.35, 0.8, nn.y + (vnoise(cen.x * 3 + seed, cen.z * 3) - 0.5) * 0.7);
    const m = up * mossAmt * (0.55 + 0.45 * vnoise(cen.x * 2.2, cen.z * 2.2 + seed));
    if (m > 0.12) c.lerp(vnoise(cen.x * 5, cen.z * 5) > 0.55 ? mossC : mossD, Math.min(1, m * 1.4));
    // lower faces: damp, darker
    c.multiplyScalar(0.86 + 0.18 * Math.min(1, Math.max(0, (cen.y / sy + 1) / 2)));
    for (let k = 0; k < 3; k++) { col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b; }
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/** a boulder with 1-3 smaller companions, merged into one geometry */
export function rockCluster(seed: number, size = 1): THREE.BufferGeometry {
  const rnd = mulberry32(seed + 101);
  const parts: THREE.BufferGeometry[] = [];
  const main = rockChunk(seed, size * (0.9 + rnd() * 0.4), size * (0.7 + rnd() * 0.7), size * (0.9 + rnd() * 0.4), { moss: 0.7, detail: 1 });
  main.translate(0, size * 0.4, 0);
  parts.push(main);
  const k = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < k; i++) {
    const s = size * (0.3 + rnd() * 0.3), a = rnd() * 6.28, r = size * (0.9 + rnd() * 0.5);
    const g = rockChunk(seed * 3 + i, s * 1.2, s * (0.6 + rnd() * 0.6), s, { moss: 0.5, detail: 1, cuts: 3 });
    g.translate(Math.sin(a) * r, s * 0.25, Math.cos(a) * r);
    parts.push(g);
  }
  return mergeAll(parts);
}

/** tall leaning slab / outcrop */
export function rockSlab(seed: number, h = 3): THREE.BufferGeometry {
  const rnd = mulberry32(seed + 55);
  const parts: THREE.BufferGeometry[] = [];
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const hh = h * (0.55 + rnd() * 0.6), w = 0.55 + rnd() * 0.5;
    const g = rockChunk(seed * 5 + i, w, hh * 0.5, w * 0.7, { moss: 0.45, detail: 1, cuts: 5, strata: 0.5 });
    g.rotateZ((rnd() - 0.5) * 0.35); g.rotateY(rnd() * 3);
    g.translate((i - (n - 1) / 2) * 0.85 + (rnd() - 0.5) * 0.3, hh * 0.42, (rnd() - 0.5) * 0.8);
    parts.push(g);
  }
  return mergeAll(parts);
}

import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) for (const k of Object.keys(g.attributes)) if (!["position", "normal", "color"].includes(k)) g.deleteAttribute(k);
  return mergeGeometries(parts, false)!;
}
