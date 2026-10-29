// Instanced vegetation + rocks: bamboo (swaying), cloud-pines, blossom/ginkgo trees, rocks, karst spires, lotus.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Batch } from "./batch";
import { cone, cyl, sph } from "./geo";
import { rockCluster, rockSlab } from "./rocks";
import { fbm, mulberry32, smoothstep, vnoise } from "./noise";
import { BRIDGE, FOX, GROVE, PLAZA, POND, WATER_Y, pathMask, pondD, terrainHeight } from "./terrain";
import { PAL, hex, toonGradient } from "./toon";
import { applyWind } from "./wind";

function colorize(g: THREE.BufferGeometry, c: THREE.Color | ((x: number, y: number, z: number) => THREE.Color)): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  const p = g.getAttribute("position");
  for (let i = 0; i < n; i++) {
    const col = typeof c === "function" ? c(p.getX(i), p.getY(i), p.getZ(i)) : c;
    arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}
function finish(parts: THREE.BufferGeometry[], withUv = false): THREE.BufferGeometry {
  const keep = withUv ? ["position", "normal", "color", "uv"] : ["position", "normal", "color"];
  const list = parts.map((g) => {
    const q = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(q.attributes)) if (!keep.includes(k)) q.deleteAttribute(k);
    // non-leaf parts (trunks, limbs) sample the opaque centre of the leaf texture
    if (withUv && !q.getAttribute("uv")) q.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(q.getAttribute("position").count * 2).fill(0.5), 2));
    return q;
  });
  const m = mergeGeometries(list, false)!;
  return m;
}
function xfGeo(g: THREE.BufferGeometry, p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, "YXZ")), new THREE.Vector3(...s));
  g.applyMatrix4(m); return g;
}

export interface VegOut { group: THREE.Group; update(t: number): void; lotusPos: THREE.Vector3[]; }

const timeU = { value: 0 };
const LEAF_SHADE = hex(PAL.jade, PAL.ink, 0.62); // undersides sink to deep ink-jade, never muddy brown

/** Ink-wash leaf dab: irregular soft-edged blob with brush-like mottling (alpha for the edge, grey value for the wash). */
let leafTexCache: THREE.CanvasTexture | null = null;
function leafTexture(): THREE.CanvasTexture {
  if (leafTexCache) return leafTexCache;
  const N = 64, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const ctx = cv.getContext("2d")!, img = ctx.createImageData(N, N);
  const rnd = mulberry32(77);
  const lobes = Array.from({ length: 7 }, () => 0.82 + rnd() * 0.3), ph = rnd() * 6;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    const edge = 0.92 * lobes[Math.floor(((a + Math.PI) / (Math.PI * 2)) * 7) % 7] * (0.94 + 0.06 * Math.sin(a * 5 + ph));
    const wob = (fbm(x * 0.21, y * 0.21) - 0.5) * 0.35;
    const alpha = THREE.MathUtils.clamp((edge + wob - r) / 0.22, 0, 1);
    const wash = 0.74 + 0.3 * smoothstep(0.1, 0.85, 1 - r) + (fbm(x * 0.13 + 9, y * 0.13) - 0.5) * 0.35; // dry-brush grey value
    const i = (y * N + x) * 4, c = Math.round(255 * THREE.MathUtils.clamp(wash, 0.45, 1));
    img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  leafTexCache = t;
  return t;
}
function leafMat(): THREE.MeshToonMaterial {
  const m = toonInst();
  m.map = leafTexture(); m.alphaTest = 0.42; m.alphaToCoverage = false;
  // Cards close to the camera (arm pushed into a canopy) dissolve with a screen-space dither instead of filling the view.
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
      { float nearFade = smoothstep(1.0, 2.6, length(vViewPosition));
        float dith = fract(dot(floor(gl_FragCoord.xy), vec2(0.7548776662, 0.5698402910)));
        if (nearFade < dith) discard; }`);
  };
  m.customProgramCacheKey = () => "leafNearFade";
  return m;
}

function bambooGeometry(): THREE.BufferGeometry {
  const stalk = hex(PAL.jade, PAL.paperDark, 0.45), node = hex(PAL.jade, PAL.inkSoft, 0.45);
  const leafA = hex(PAL.jade, PAL.paper, 0.1), leafB = hex(PAL.jade, PAL.inkSoft, 0.3);
  const H = 12;
  const pts: THREE.Vector2[] = [];
  const r = 0.1;
  pts.push(new THREE.Vector2(r * 1.15, 0));
  const NN = 5;
  for (let k = 1; k <= NN; k++) {
    const y = (k / NN) * H * 0.98;
    const rr = r * (1 - 0.35 * k / NN);
    pts.push(new THREE.Vector2(rr * 1.3, y), new THREE.Vector2(rr, y + 0.06));
  }
  pts.push(new THREE.Vector2(0.01, H));
  const lathe = new THREE.LatheGeometry(pts, 4);
  colorize(lathe, (x, y) => { const t = ((y / (H * 0.98)) * NN) % 1; return (y > 0.5 && (t < 0.04 || t > 0.97)) ? node : stalk; });
  const parts: THREE.BufferGeometry[] = [lathe];
  const rnd = mulberry32(3);
  for (let k = 0; k < 5; k++) {
    const y = H * (0.5 + 0.09 * k);
    const a = k * 2.4 + rnd();
    for (let b = 0; b < 2; b++) {
      const ang = a + (b - 0.5) * 0.9;
      const blade = new THREE.BufferGeometry();
      const w = 0.2, l = 1.3 + rnd() * 0.4;
      const v = new Float32Array([-w, 0, 0, w, 0, 0, 0, -0.45, l * 0.55, -w * 0.5, -0.3, l * 0.5, w * 0.5, -0.3, l * 0.5, 0, -0.95, l]);
      blade.setAttribute("position", new THREE.BufferAttribute(v, 3));
      blade.setIndex([0, 1, 4, 0, 4, 3, 3, 4, 5]);
      blade.computeVertexNormals();
      colorize(blade, rnd() < 0.5 ? leafA : leafB);
      xfGeo(blade, [0, y + b * 0.12, 0], [0, ang, 0]);
      parts.push(blade);
    }
  }
  return finish(parts);
}

/** one drooping, ragged-edged needle pad: a layered "cloud-pine" bough */
function boughGeo(r: number, h: number, seed: number, top: THREE.Color, bot: THREE.Color): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const N = 10;
  const rim: THREE.Vector3[] = [], mid: THREE.Vector3[] = [];
  for (let j = 0; j < N; j++) {
    const a = (j / N) * Math.PI * 2 + rnd() * 0.1;
    const rr = r * (j % 2 ? 0.74 : 1.0) * (0.88 + rnd() * 0.24);
    rim.push(new THREE.Vector3(Math.cos(a) * rr * 1.1, -h * (j % 2 ? 0.95 : 0.35) - rnd() * 0.08, Math.sin(a) * rr));
    mid.push(new THREE.Vector3(Math.cos(a) * rr * 0.55, h * 0.25 + rnd() * 0.05, Math.sin(a) * rr * 0.55));
  }
  const apex = new THREE.Vector3(0, h * 0.75, 0);
  const pos: number[] = [], col: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, k: number) => {
    for (const v of [a, b, c]) { pos.push(v.x, v.y, v.z); const cc = top.clone().lerp(bot, k); col.push(cc.r, cc.g, cc.b); }
  };
  for (let j = 0; j < N; j++) {
    const k = (j + 1) % N;
    tri(apex, mid[j], mid[k], 0.0);
    tri(mid[j], rim[j], rim[k], 0.25 + (j % 2) * 0.15); tri(mid[j], rim[k], mid[k], 0.2);
    // underside: darker
    tri(new THREE.Vector3(0, -h * 0.15, 0), rim[k], rim[j], 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** gnarled trunk: twisting tube with root flare, tapering to the crown */
function gnarledTrunk(pts: THREE.Vector3[], r0: number, r1: number, bark: THREE.Color, barkD: THREE.Color, seg = 12, rad = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, rad, false);
  const p = g.getAttribute("position");
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const sg = Math.floor(i / (rad + 1)), t = sg / seg;
    const c = curve.getPointAt(Math.min(1, t));
    const rr = (r0 + (r1 - r0) * t) * (1 + 0.25 * Math.sin(t * 17 + (i % (rad + 1)) * 1.9) * (1 - t) + (t < 0.12 ? (0.12 - t) * 3.2 : 0));
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * rr, c.y + (p.getY(i) - c.y) * rr, c.z + (p.getZ(i) - c.z) * rr);
    const cc = bark.clone().lerp(barkD, 0.5 + 0.5 * Math.sin((i % (rad + 1)) * 2.3 + t * 9));
    col.set([cc.r, cc.g, cc.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function pineGeometry(): THREE.BufferGeometry {
  const bark = hex(PAL.inkSoft, PAL.paperDark, 0.2), barkD = hex(PAL.ink, PAL.inkSoft, 0.5);
  const needle = hex(PAL.jade, PAL.ink, 0.6), needleL = hex(PAL.jade, PAL.paperDark, 0.28);
  const trunk = gnarledTrunk([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.45, 1.5, 0.2), new THREE.Vector3(-0.35, 3.0, 0.1), new THREE.Vector3(0.4, 4.6, -0.2), new THREE.Vector3(0.05, 6.4, 0)], 0.34, 0.1, bark, barkD, 9, 6);
  const parts: THREE.BufferGeometry[] = [trunk];
  // exposed roots
  for (let i = 0; i < 4; i++) { const a = i * 1.7 + 0.3; parts.push(colorize(xfGeo(cone(0.16, 0.9, 5), [Math.sin(a) * 0.38, 0.1, Math.cos(a) * 0.38], [Math.cos(a) * 1.3, 0, -Math.sin(a) * 1.3]), barkD)); }
  const pads: [number, number, number, number, number][] = [[1.9, 2.9, 0.4, 1.9, 0.5], [-1.9, 4.1, -0.3, 1.8, 0.45], [0.9, 5.3, 1.0, 1.5, 0.4], [-0.6, 5.9, -0.9, 1.35, 0.4], [0.2, 6.8, 0.1, 1.2, 0.36]];
  pads.forEach(([x, y, z, r, h], i) => {
    // knotted branch reaching to the pad
    const br = gnarledTrunk([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x * 0.4, (y - 0.7) * 0.25 + 0.2, z * 0.4), new THREE.Vector3(x * 0.85, 0.1, z * 0.85)], 0.13, 0.05, bark, barkD, 5, 5);
    parts.push(xfGeo(br, [0, y - 0.7 - (i % 2) * 0.1, 0]));
    for (let l = 0; l < 2; l++) {
      const g = boughGeo(r * (1 - l * 0.38), h * (1 - l * 0.2), i * 7 + l, l ? needleL : needleL.clone().lerp(needle, 0.5), needle);
      xfGeo(g, [x * (1 - l * 0.12), y + l * 0.42, z * (1 - l * 0.12)], [0, i * 1.3 + l, 0.05 * (i % 2 ? 1 : -1)]);
      parts.push(g);
    }
  });
  return finish(parts);
}

/** blossom/ginkgo/maple tree: gnarled forked trunk + spherical clusters of leaf cards with outward (round) normals */
function treeGeometry(canopy: THREE.Color, canopy2: THREE.Color, seed = 1, alt?: THREE.Color, altP = 0): THREE.BufferGeometry {
  const bark = hex(PAL.inkSoft, PAL.paperDark, 0.22), barkD = hex(PAL.ink, PAL.inkSoft, 0.5);
  const rnd = mulberry32(seed * 131 + 7);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(gnarledTrunk([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.25, 1.0, 0.1), new THREE.Vector3(-0.1, 2.1, 0.2), new THREE.Vector3(0.1, 3.0, 0)], 0.3, 0.14, bark, barkD, 8, 6));
  const balls: [number, number, number, number][] = [[0.0, 4.5, 0.0, 1.5], [1.6, 3.9, 0.5, 1.1], [-1.6, 3.8, -0.3, 1.15], [0.4, 5.6, 0.4, 1.0], [-0.5, 3.9, 1.4, 0.95]];
  for (const [bx, by, bz, br] of balls) {
    // limb to the cluster
    parts.push(gnarledTrunk([new THREE.Vector3(0.0, 2.7, 0), new THREE.Vector3(bx * 0.45, 2.9 + (by - 2.9) * 0.45, bz * 0.45), new THREE.Vector3(bx * 0.85, by - 0.55, bz * 0.85)], 0.11, 0.04, bark, barkD, 5, 5));
    const cards = 40;
    for (let i = 0; i < cards; i++) {
      // random point on/inside sphere (biased to the surface)
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rs = Math.sqrt(1 - u * u);
      const d = new THREE.Vector3(rs * Math.cos(th), u * 0.82, rs * Math.sin(th));
      const dist = br * (0.7 + rnd() * 0.35);
      const c = new THREE.Vector3(bx + d.x * dist, by + d.y * dist, bz + d.z * dist);
      const size = (0.3 + rnd() * 0.22) * (0.8 + br * 0.25);
      const n = d.clone().normalize();
      const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      const sides = 6, pos: number[] = [], nor: number[] = [], colr: number[] = [];
      const tone = canopy.clone().lerp(canopy2, THREE.MathUtils.clamp(0.5 + d.y * 0.6 + (rnd() - 0.5) * 0.5, 0, 1));
      // ink-wash modelling: most cards read jade/grey, undersides sink toward soft ink, tops catch the light
      if (alt && rnd() < altP) tone.lerp(alt, 0.75 + rnd() * 0.25);
      tone.lerp(LEAF_SHADE, THREE.MathUtils.clamp(-d.y * 0.42 + (rnd() - 0.5) * 0.12, 0, 0.45));
      const uvs: number[] = [];
      for (let k = 0; k < sides; k++) {
        const a0 = (k / sides) * Math.PI * 2, a1 = ((k + 1) / sides) * Math.PI * 2;
        const r0 = size * (0.9 + rnd() * 0.15), r1 = size * (0.9 + rnd() * 0.15);
        const P = (a: number, r: number) => new THREE.Vector3().copy(c).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r * 0.85).addScaledVector(n, -Math.hypot(Math.cos(a), Math.sin(a)) * r * 0.12);
        const rot = (i * 0.9) % (Math.PI * 2);
        uvs.push(0.5, 0.5, 0.5 + Math.cos(a0 + rot) * 0.5, 0.5 + Math.sin(a0 + rot) * 0.5, 0.5 + Math.cos(a1 + rot) * 0.5, 0.5 + Math.sin(a1 + rot) * 0.5);
        for (const v of [c.clone().addScaledVector(n, size * 0.14), P(a0, r0), P(a1, r1)]) {
          pos.push(v.x, v.y, v.z);
          const nn = v.clone().sub(new THREE.Vector3(bx, by, bz)).normalize().lerp(n, 0.35).normalize();
          nor.push(nn.x, nn.y, nn.z);
          colr.push(tone.r, tone.g, tone.b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      parts.push(g);
    }
  }
  return finish(parts, true);
}

function karstGeometry(): THREE.BufferGeometry {
  const cLow = hex(PAL.inkSoft, PAL.mist, 0.4), cTop = hex(PAL.mist, PAL.paperDark, 0.2);
  const pts: THREE.Vector2[] = [];
  const H = 40;
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const r = 8.5 * Math.pow(1 - t, 1.15) * (1 + 0.1 * Math.sin(t * 13 + 1)) + 0.5 * (1 - t);
    pts.push(new THREE.Vector2(Math.max(0.06, r), t * H));
  }
  const g = new THREE.LatheGeometry(pts, 8);
  const p = g.getAttribute("position");
  for (let k = 0; k < p.count; k++) {
    const y = p.getY(k), t = y / H, a = Math.atan2(p.getZ(k), p.getX(k));
    const d = 0.78 + vnoise(a * 2.2 + 3, y * 0.15) * 0.5;
    p.setX(k, p.getX(k) * d + t * t * 5); p.setZ(k, p.getZ(k) * d);
  }
  g.computeVertexNormals();
  colorize(g, (x, y) => cLow.clone().lerp(cTop, smoothstep(0.0, 0.95, y / H)));
  return finish([g]);
}

function toonInst(extra?: (s: THREE.WebGLProgramParametersWithUniforms) => void): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: THREE.DoubleSide });
  if (extra) m.onBeforeCompile = extra;
  return m;
}

function scatter(mesh: THREE.InstancedMesh, pts: { x: number; z: number; s: number; ry: number; sy?: number; dy?: number; tilt?: number; col?: THREE.Color }[]) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  pts.forEach((p, i) => {
    e.set(p.tilt ?? 0, p.ry, (p.tilt ?? 0) * 0.7, "YXZ"); q.setFromEuler(e);
    v.set(p.x, terrainHeight(p.x, p.z) + (p.dy ?? 0), p.z);
    sc.set(p.s, p.s * (p.sy ?? 1), p.s);
    m.compose(v, q, sc);
    mesh.setMatrixAt(i, m);
    if (p.col) mesh.setColorAt(i, p.col);
  });
  mesh.count = pts.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
}

export function buildVegetation(): VegOut {
  const group = new THREE.Group();
  group.name = "vegetation";
  const rnd = mulberry32(2024);
  const lotusPos: THREE.Vector3[] = [];

  // ---- bamboo ----
  const bPts: { x: number; z: number; s: number; ry: number; sy: number; col: THREE.Color }[] = [];
  const taken = new Map<string, boolean>();
  const tryBamboo = (x: number, z: number, minGap: number) => {
    const key = Math.round(x / minGap) + "," + Math.round(z / minGap);
    if (taken.has(key)) return;
    if (pondD(x, z) < 1.3 || pathMask(x, z) > 0.05) return;
    taken.set(key, true);
    const v = 0.75 + rnd() * 0.5;
    bPts.push({ x, z, s: 0.8 + rnd() * 0.5, ry: rnd() * 6.28, sy: v, col: new THREE.Color().setHSL(0.33 + rnd() * 0.03, 0.12 + rnd() * 0.1, 0.88 + rnd() * 0.12) });
  };
  for (let i = 0; i < 2600 && bPts.length < 380; i++) {
    const x = GROVE.x0 + rnd() * (GROVE.x1 - GROVE.x0), z = GROVE.z0 + rnd() * (GROVE.z1 - GROVE.z0);
    const edge = Math.min(smoothstep(GROVE.x0, GROVE.x0 + 8, x) , 1 - smoothstep(GROVE.x1 - 8, GROVE.x1, x)) * Math.min(smoothstep(GROVE.z0, GROVE.z0 + 8, z), 1 - smoothstep(GROVE.z1 - 8, GROVE.z1, z));
    const n = fbm(x * 0.08 + 3, z * 0.08, 3);
    if (rnd() > edge * (0.35 + n)) continue;
    // clearings for combat
    if (n < 0.33) continue;
    tryBamboo(x, z, 1.7);
  }
  for (let i = 0; i < 300; i++) { // stray clumps elsewhere
    const x = (rnd() - 0.5) * 190, z = (rnd() - 0.5) * 190;
    if (fbm(x * 0.05 + 80, z * 0.05, 3) > 0.62 && Math.hypot(x - PLAZA.x, z - PLAZA.z) > 18) tryBamboo(x, z, 2.2);
  }
  const bambooMat = toonInst((s) => {
    s.uniforms.uTime = timeU;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <begin_vertex>", `
        vec3 transformed = vec3(position);
        float hh = clamp(position.y / 12.0, 0.0, 1.0);
        vec3 ip = vec3(instanceMatrix[3]);
        float ph = ip.x * 0.37 + ip.z * 0.51;
        float sw = (sin(uTime * 1.1 + ph) * 0.55 + sin(uTime * 2.1 + ph * 2.3) * 0.2) * hh * hh * 0.85;
        transformed.x += sw;
        transformed.z += cos(uTime * 0.9 + ph * 1.3) * 0.3 * hh * hh;
      `);
  });
  applyWind(bambooMat, { height: 12, amp: 1.25, idle: 0.0 });
  const bamboo = new THREE.InstancedMesh(bambooGeometry(), bambooMat, bPts.length);
  scatter(bamboo, bPts);
  bamboo.name = "bamboo";
  group.add(bamboo);

  // ---- pines (fox hills + shrine hill + rim) ----
  const pPts: { x: number; z: number; s: number; ry: number; sy: number; tilt: number }[] = [];
  for (let i = 0; i < 900 && pPts.length < 54; i++) {
    const x = (rnd() - 0.5) * 220, z = (rnd() - 0.5) * 220;
    const fox = Math.hypot(x - FOX.x, z - FOX.z) < 40;
    const shrine = Math.hypot(x, z - 85) > 14 && Math.hypot(x, z - 85) < 34;
    const rim = Math.max(Math.abs(x), Math.abs(z)) > 92;
    if (!(fox || shrine || rim) || pathMask(x, z) > 0 || pondD(x, z) < 1.4) continue;
    if (rnd() > 0.6 + (fox ? 0.2 : 0)) continue;
    pPts.push({ x, z, s: 0.8 + rnd() * 0.9, ry: rnd() * 6.28, sy: 0.9 + rnd() * 0.4, tilt: (rnd() - 0.5) * 0.1 });
  }
  const pineMat = toonInst();
  applyWind(pineMat, { height: 7, amp: 0.34, idle: 0.35 });
  const pines = new THREE.InstancedMesh(pineGeometry(), pineMat, pPts.length);
  scatter(pines, pPts);
  group.add(pines);

  // ---- blossom & ginkgo & maple trees ----
  let treeSeed = 1;
  const mk = (a: THREE.Color, b: THREE.Color, pts: { x: number; z: number }[], scaleMul = 1, alt?: THREE.Color, altP = 0) => {
    const g = treeGeometry(a, b, treeSeed++, alt, altP);
    const lm = leafMat();
    applyWind(lm, { height: 8, amp: 0.3, idle: 0.35 });
    const m = new THREE.InstancedMesh(g, lm, pts.length);
    scatter(m, pts.map((p) => ({ x: p.x, z: p.z, s: (0.85 + rnd() * 0.5) * scaleMul, ry: rnd() * 6.28, sy: 1, tilt: 0 })));
    group.add(m);
  };
  const blossom: { x: number; z: number }[] = [];
  const around = (cx: number, cz: number, rMin: number, rMax: number, n: number, out: { x: number; z: number }[], avoidPath = true) => {
    for (let i = 0; i < n * 8 && out.length < n + out.length; i++) {
      if (n <= 0) break;
      const a = rnd() * 6.28, r = rMin + rnd() * (rMax - rMin);
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if ((avoidPath && pathMask(x, z) > 0) || pondD(x, z) < 1.3) continue;
      out.push({ x, z }); n--;
    }
  };
  around(POND.x, POND.z, 18, 26, 9, blossom);
  around(PLAZA.x, PLAZA.z, 15, 24, 8, blossom);
  // blossom: soft blush accents (about a third of the cards) over a jade-grey wash canopy
  mk(hex(PAL.jade, PAL.mist, 0.3), hex(PAL.jade, PAL.paper, 0.22), blossom, 1, hex(PAL.paper, PAL.vermilion, 0.2), 0.26);
  const ginkgo: { x: number; z: number }[] = [];
  around(-27, -72, 11, 18, 5, ginkgo); around(30, -30, 5, 14, 3, ginkgo);
  mk(hex(PAL.jade, PAL.mist, 0.35), hex(PAL.jade, PAL.paper, 0.3), ginkgo, 1.05, hex(PAL.gold, PAL.paper, 0.12), 0.3);
  const maple: { x: number; z: number }[] = [];
  around(FOX.x - 10, FOX.z - 25, 4, 18, 4, maple); around(-14, 58, 6, 12, 1, maple);
  // maple: palette-locked autumn: mist/jade wash canopy with vermilion accents on a minority of cards (never a solid red mass)
  mk(hex(PAL.jade, PAL.mist, 0.45), hex(PAL.jade, PAL.paper, 0.16), maple, 0.95, hex(PAL.vermilion, PAL.mist, 0.38), 0.14);

  // ---- rocks: chiselled mossy clusters + leaning slab outcrops ----
  const rockTypes = [rockCluster(1, 1.0), rockCluster(2, 1.3), rockCluster(5, 0.75), rockSlab(3, 3.4)];
  const R: { x: number; z: number; s: number; ry: number; sy: number; dy: number }[][] = [[], [], [], []];
  const addRock = (x: number, z: number, big = 1, slab = 0.18) => {
    if (pathMask(x, z) > 0.02 || pondD(x, z) < 0.8) return;
    const t = rnd() < slab ? 3 : Math.floor(rnd() * 3);
    R[t].push({ x, z, s: (0.7 + rnd() * 0.9) * big * (t === 3 ? 0.9 : 1), ry: rnd() * 6.28, sy: 0.85 + rnd() * 0.4, dy: -0.15 });
  };
  for (let i = 0; i < 26; i++) addRock(FOX.x + (rnd() - 0.5) * 70, FOX.z + (rnd() - 0.5) * 70, 1.2, 0.3);
  for (let i = 0; i < 16; i++) { const a = rnd() * 6.28; addRock(POND.x + Math.sin(a) * (POND.r + 1 + rnd() * 3), POND.z + Math.cos(a) * (POND.r + 1 + rnd() * 3) * 0.95, 0.8, 0.1); }
  for (let i = 0; i < 18; i++) { const a = rnd() * 6.28, r = 14 + rnd() * 16; addRock(Math.sin(a) * r, 85 + Math.cos(a) * r, 1.3, 0.35); }
  for (let i = 0; i < 26; i++) addRock((rnd() - 0.5) * 190, (rnd() - 0.5) * 190, 1.0);
  for (let i = 0; i < 16; i++) { const a = rnd() * 6.28; addRock(Math.sin(a) * (97 + rnd() * 20), Math.cos(a) * (97 + rnd() * 20), 3.0, 0.5); }
  rockTypes.forEach((g, i) => {
    const m = new THREE.InstancedMesh(g, toonInst(), Math.max(1, R[i].length));
    scatter(m, R[i]);
    group.add(m);
  });

  // ---- karst spires on the horizon rim ----
  const karst = new THREE.InstancedMesh(karstGeometry(), toonInst(), 11);
  const kp: { x: number; z: number; s: number; ry: number; dy: number }[] = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.3, r = 112 + rnd() * 25;
    kp.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, s: 0.8 + rnd() * 0.8, ry: rnd() * 6, dy: -3 });
  }
  scatter(karst, kp);
  group.add(karst);

  // ---- pond reeds & cattails (swaying) ----
  {
    const reedG = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const rr = mulberry32(17);
      const g1 = hex(PAL.jade, PAL.paperDark, 0.4), g2 = hex(PAL.jade, PAL.inkSoft, 0.45), brown = hex(PAL.inkSoft, PAL.gold, 0.3);
      for (let i = 0; i < 6; i++) {
        const ang = rr() * 6.28, off = rr() * 0.22, H = 1.3 + rr() * 1.0, w = 0.05 + rr() * 0.03, lean = 0.3 + rr() * 0.6;
        const pos: number[] = [], col: number[] = [];
        const S = 3;
        const pt = (t: number) => ({ x: Math.cos(ang) * (off + lean * t * t * 0.6), y: H * t, z: Math.sin(ang) * (off + lean * t * t * 0.6) });
        const c = rr() < 0.5 ? g1 : g2;
        const nx = -Math.sin(ang), nz = Math.cos(ang);
        for (let k = 0; k < S; k++) {
          const t0 = k / S, t1 = (k + 1) / S, p0 = pt(t0), p1 = pt(t1), w0 = w * (1 - t0 * 0.85), w1 = w * (1 - t1 * 0.85);
          const q = [[p0.x - nx * w0, p0.y, p0.z - nz * w0], [p0.x + nx * w0, p0.y, p0.z + nz * w0], [p1.x + nx * w1, p1.y, p1.z + nz * w1], [p1.x - nx * w1, p1.y, p1.z - nz * w1]];
          for (const i3 of [0, 1, 2, 0, 2, 3]) { pos.push(...q[i3]); const cc = c.clone().lerp(g1, t0 * 0.6); col.push(cc.r, cc.g, cc.b); }
        }
        const gg = new THREE.BufferGeometry();
        gg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); gg.computeVertexNormals();
        parts.push(gg);
        if (i % 3 === 0) { // cattail head
          const tp = pt(0.78);
          parts.push(colorize(xfGeo(cyl(0.045, 0.045, 0.34, 5), [tp.x, tp.y + 0.1, tp.z]), brown));
        }
      }
      return finish(parts);
    })();
    const reedPts: { x: number; z: number; s: number; ry: number; sy: number; col: THREE.Color }[] = [];
    for (let i = 0; i < 900 && reedPts.length < 90; i++) {
      const a = rnd() * 6.28, rr = POND.r * (0.88 + rnd() * 0.34);
      const x = POND.x + Math.sin(a) * rr, z = POND.z + Math.cos(a) * rr * 0.97;
      const pd = pondD(x, z);
      if (pd < 0.82 || pd > 1.12 || Math.abs(x) < BRIDGE.width + 1.2 || pathMask(x, z) > 0) continue;
      reedPts.push({ x, z, s: 0.7 + rnd() * 0.7, ry: rnd() * 6.28, sy: 0.8 + rnd() * 0.5, col: new THREE.Color().setHSL(0.34 + rnd() * 0.05, 0.1 + rnd() * 0.1, 0.78 + rnd() * 0.3) });
    }
    const reedMat = toonInst((sh) => {
      sh.uniforms.uTime = timeU;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace("#include <begin_vertex>", `
          vec3 transformed = vec3(position);
          float hh = clamp(position.y / 2.0, 0.0, 1.0);
          vec3 ip = vec3(instanceMatrix[3]);
          float ph = ip.x * 0.7 + ip.z * 0.9;
          transformed.x += (sin(uTime * 1.6 + ph + position.y) * 0.1 + sin(uTime * 3.1 + ph * 2.0) * 0.03) * hh * hh * 1.6;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * 0.08 * hh * hh * 1.6;`);
    });
    applyWind(reedMat, { height: 2, amp: 0.55, idle: 0.0 });
    const reeds = new THREE.InstancedMesh(reedG, reedMat, reedPts.length);
    scatter(reeds, reedPts.map((p) => ({ ...p, dy: -0.05 })));
    reeds.name = "reeds";
    group.add(reeds);
  }

  // ---- wildflower clusters ----
  {
    const fg = (() => {
      const parts: THREE.BufferGeometry[] = [];
      const rr = mulberry32(23);
      const stem = hex(PAL.jade, PAL.inkSoft, 0.35), centre = hex(PAL.gold, PAL.paper, 0.2);
      for (let i = 0; i < 5; i++) {
        const a = rr() * 6.28, d = 0.05 + rr() * 0.28, h = 0.28 + rr() * 0.25;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        // thin stem (2 tris)
        const sp = [x, 0, z - 0.012, x, 0, z + 0.012, x + 0.04, h, z];
        const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
        sg.setAttribute("color", new THREE.Float32BufferAttribute([...stem.toArray(), ...stem.toArray(), ...stem.toArray()], 3)); sg.computeVertexNormals(); parts.push(sg);
        // 5-petal star head (white; instanceColor tints it)
        const pos: number[] = [], col: number[] = [];
        const cx = x + 0.04, cy = h, cz = z, R = 0.085 + rr() * 0.03;
        for (let k = 0; k < 5; k++) {
          const a0 = (k / 5) * 6.283, a1 = a0 + 0.9, am = a0 + 0.45;
          pos.push(cx, cy + 0.01, cz, cx + Math.cos(a0) * R * 0.55, cy, cz + Math.sin(a0) * R * 0.55, cx + Math.cos(am) * R, cy + 0.015, cz + Math.sin(am) * R);
          pos.push(cx, cy + 0.01, cz, cx + Math.cos(am) * R, cy + 0.015, cz + Math.sin(am) * R, cx + Math.cos(a1) * R * 0.55, cy, cz + Math.sin(a1) * R * 0.55);
          for (let q = 0; q < 6; q++) { const cc = q % 3 === 0 ? centre : new THREE.Color(1, 1, 1); col.push(cc.r, cc.g, cc.b); }
        }
        const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); hg.computeVertexNormals();
        parts.push(hg);
      }
      return finish(parts);
    })();
    const tints = [hex(PAL.paper), hex(PAL.paper, PAL.vermilion, 0.3), hex(PAL.gold, PAL.paper, 0.35), hex(0x9a8fd0, PAL.paper, 0.35), hex(PAL.vermilion, PAL.paper, 0.45)];
    const fp: { x: number; z: number; s: number; ry: number; col: THREE.Color }[] = [];
    for (let i = 0; i < 6000 && fp.length < 280; i++) {
      const x = (rnd() - 0.5) * 190, z = (rnd() - 0.5) * 190;
      if (pathMask(x, z) > 0 || pondD(x, z) < 1.2 || Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 1 || Math.hypot(x, z - 85) < 12) continue;
      const nn = fbm(x * 0.09 + 5, z * 0.09 + 17, 3);
      if (nn < 0.52 || rnd() > (nn - 0.45) * 2.2) continue;
      // each patch shares a tint
      const tint = tints[Math.floor(fbm(x * 0.03, z * 0.03, 2) * 9.99) % tints.length];
      fp.push({ x, z, s: 1.25 + rnd() * 0.8, ry: rnd() * 6.28, col: tint.clone().multiplyScalar(0.9 + rnd() * 0.3) });
    }
    const fm = new THREE.InstancedMesh(fg, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: THREE.DoubleSide }), fp.length);
    scatter(fm, fp.map((p) => ({ ...p, dy: 0 })));
    fm.name = "flowers";
    group.add(fm);
  }

  // ---- lotus pond ----
  const padG = new THREE.CircleGeometry(0.62, 10, 0.4, Math.PI * 2 - 0.55);
  padG.rotateX(-Math.PI / 2);
  colorize(padG, hex(PAL.jade, PAL.inkSoft, 0.3));
  const pads: { x: number; z: number; s: number; ry: number; col: THREE.Color }[] = [];
  for (let i = 0; i < 300 && pads.length < 70; i++) {
    const a = rnd() * 6.28, r = Math.sqrt(rnd()) * POND.r * 0.95;
    const x = POND.x + Math.sin(a) * r, z = POND.z + Math.cos(a) * r;
    if (pondD(x, z) > 0.88 || Math.abs(x) < BRIDGE.width + 0.8) continue;
    if (terrainHeight(x, z) > WATER_Y - 0.3) continue;
    pads.push({ x, z, s: 0.8 + rnd() * 1.0, ry: rnd() * 6.28, col: new THREE.Color().setHSL(0.38 + rnd() * 0.05, 0.1 + rnd() * 0.1, 0.8 + rnd() * 0.25) });
  }
  const padM = new THREE.InstancedMesh(padG, toonInst(), pads.length);
  const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), vv = new THREE.Vector3(), ss = new THREE.Vector3();
  pads.forEach((p, i) => {
    ee.set(0, p.ry, 0); qq.setFromEuler(ee); vv.set(p.x, WATER_Y + 0.06, p.z); ss.set(p.s, 1, p.s);
    mm.compose(vv, qq, ss); padM.setMatrixAt(i, mm); padM.setColorAt(i, p.col);
  });
  padM.instanceMatrix.needsUpdate = true; padM.instanceColor!.needsUpdate = true;
  group.add(padM);
  // blooms
  const bl = new Batch();
  const petalG = cone(0.13, 0.55, 5);
  const pink = hex(PAL.paper, PAL.vermilion, 0.28), tip = hex(PAL.vermilion, PAL.paper, 0.35);
  for (let i = 0; i < 16; i++) {
    const p = pads[Math.floor(rnd() * pads.length)];
    const bx = p.x + (rnd() - 0.5) * 0.6, bz = p.z + (rnd() - 0.5) * 0.6;
    lotusPos.push(new THREE.Vector3(bx, WATER_Y, bz));
    bl.add(cyl(0.03, 0.03, 0.7, 4), "solid", { p: [bx, WATER_Y + 0.3, bz] }, hex(PAL.jade, PAL.inkSoft, 0.4));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 6.283;
      bl.add(petalG, "solid", { p: [bx + Math.sin(a) * 0.12, WATER_Y + 0.8, bz + Math.cos(a) * 0.12], r: [Math.cos(a) * 0.75, 0, -Math.sin(a) * 0.75], s: [1, 1, 0.8] }, k % 2 ? pink : tip);
    }
    bl.add(sph(0.07, 5, 4), "solid", { p: [bx, WATER_Y + 0.72, bz] }, hex(PAL.gold));
  }
  bl.build(group, { solid: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }) });

  return { group, update(t) { timeU.value = t; }, lotusPos };
}
