// Cloudmist Valley terrain: analytic height field + painterly ground texture.
import { WIND } from "./wind";
import * as THREE from "three";
import { clamp, fbm, hash2, lerp, mulberry32, smoothstep, vnoise } from "./noise";
import { toonGradient } from "./toon";

export const WATER_Y = -0.35;
export const POND = { x: 0, z: -34, r: 15.5 };
export const BRIDGE = { zc: -34, half: 19, width: 2.5, endY: 0.7, rise: 2.6 };
export const PLAZA = { x: 0, z: -80, r: 13 };
export const SHRINE_HILL = { x: 0, z: 85, top: 8.2 };
export const GROVE = { x0: -62, x1: -18, z0: -22, z1: 42 };
export const FOX = { x: 55, z: 30 };
export const TERRAIN_SIZE = 300;

const dist = (x: number, z: number, cx: number, cz: number) => Math.hypot(x - cx, z - cz);

/** centerline of the lantern path (x as a function of z) */
export function pathX(z: number): number {
  if (z < -22) return 0;
  const k = smoothstep(-22, -4, z);
  const toShrine = 1 - smoothstep(52, 76, z);
  return 9 * Math.sin((z + 22) * 0.052) * k * toShrine;
}
/** is point (x,z) on the path; returns 0..1 coverage */
export function pathMask(x: number, z: number): number {
  if (z < PLAZA.z + 4 || z > 80) return 0;
  const w = z < -22 ? 3.0 : 2.3;
  const d = Math.abs(x - pathX(z) - (vnoise(z * 0.2, 3) - 0.5) * 0.6);
  return 1 - smoothstep(w - 0.5, w + 0.7, d);
}

function bump(x: number, z: number, cx: number, cz: number, r: number): number {
  return 1 - smoothstep(0, r, dist(x, z, cx, cz));
}

export function pondD(x: number, z: number): number {
  const a = Math.atan2(z - POND.z, x - POND.x);
  const rr = POND.r * (1 + 0.2 * (vnoise(Math.cos(a) * 1.7 + 5, Math.sin(a) * 1.7 + 5) - 0.5) * 2);
  return dist(x, z, POND.x, POND.z) / rr;
}

export function terrainHeight(x: number, z: number): number {
  let h = (fbm(x * 0.016 + 10, z * 0.016 + 3, 3) - 0.5) * 4.5;
  h += (fbm(x * 0.07, z * 0.07, 2) - 0.5) * 0.7;
  // fox-spirit hills
  const fh = bump(x, z, FOX.x, FOX.z, 52);
  h += fh * fh * (5.5 + 4.5 * fbm(x * 0.045 + 40, z * 0.045 + 7, 3)) ;
  // bamboo grove: gentle swell
  h += bump(x, z, -40, 10, 40) * 0.9;
  // shrine hill with a flat courtyard top
  const sd = dist(x, z, SHRINE_HILL.x, SHRINE_HILL.z * 1.0);
  const sh = 1 - smoothstep(13, 34, sd);
  h = lerp(h, SHRINE_HILL.top + 0.35 * (fbm(x * 0.1, z * 0.1, 2) - 0.5), sh);
  // pond
  const d = pondD(x, z);
  h = lerp(h, 0.7, 1 - smoothstep(1.0, 2.6, d));
  h -= (1 - smoothstep(0.5, 1.12, d)) * 3.6;
  // plaza flat
  const pl = 1 - smoothstep(PLAZA.r, PLAZA.r + 9, dist(x, z, PLAZA.x, PLAZA.z));
  h = lerp(h, 0.35, pl);
  // outer rim rises into walls of hills
  const e = smoothstep(86, 130, Math.max(Math.abs(x), Math.abs(z)));
  h += e * e * 13;
  return h;
}

export function bridgeY(z: number): number {
  const t = (z - BRIDGE.zc) / BRIDGE.half;
  return BRIDGE.endY + BRIDGE.rise * (1 - t * t);
}

/** exported ground height incl. bridge deck */
export function heightAt(x: number, z: number): number {
  let h = terrainHeight(x, z);
  if (Math.abs(x) < BRIDGE.width - 0.1 && Math.abs(z - BRIDGE.zc) < BRIDGE.half) h = Math.max(h, bridgeY(z));
  return h;
}

// ---------- ground texture ----------
const TEX = 1024;
function c3(hex: number): [number, number, number] {
  const c = new THREE.Color(hex); c.convertLinearToSRGB();
  return [c.r * 255, c.g * 255, c.b * 255];
}
function mix3(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function makeGroundTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = TEX;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(TEX, TEX);
  const grassA = c3(0x93aa9d), grassB = c3(0x5d7d70), dry = c3(0x9fab94), hillWarm = c3(0x92a392);
  const stone = c3(0xb4b5a6), stoneDark = c3(0x959688), bed = c3(0x48625f), sand = c3(0xb4b49a);
  const rock = c3(0x8f9a94), moss = c3(0x58796a), mud = c3(0x8e9283);
  const S = TERRAIN_SIZE;
  for (let py = 0; py < TEX; py++) {
    for (let px = 0; px < TEX; px++) {
      const x = (px / TEX - 0.5) * S;
      const z = (0.5 - py / TEX) * S; // canvas y flipped later by texture.flipY (we paint north-up with z up)
      const n1 = fbm(x * 0.05, z * 0.05, 3);
      const n2 = fbm(x * 0.22 + 9, z * 0.22 + 4, 2);
      let col = mix3(grassA, grassB, clamp(n1 * 2.0 - 0.45 + (n2 - 0.5) * 0.35, 0, 1));
      col = mix3(col, dry, smoothstep(0.55, 0.8, fbm(x * 0.03 + 70, z * 0.03, 3)) * 0.5);
      const fox = bump(x, z, FOX.x, FOX.z, 55);
      col = mix3(col, hillWarm, fox * 0.55);
      // grove moss
      const gx = smoothstep(GROVE.x0 - 8, GROVE.x0 + 8, x) * (1 - smoothstep(GROVE.x1 - 8, GROVE.x1 + 8, x));
      const gz = smoothstep(GROVE.z0 - 8, GROVE.z0 + 8, z) * (1 - smoothstep(GROVE.z1 - 8, GROVE.z1 + 8, z));
      col = mix3(col, moss, gx * gz * (0.55 + 0.3 * n2));
      // shrine hill: bare rock/earth
      const sh = 1 - smoothstep(10, 30, dist(x, z, SHRINE_HILL.x, SHRINE_HILL.z));
      col = mix3(col, mix3(rock, mud, n2), sh * (0.55 + 0.3 * n2));
      // outer rim
      const e = smoothstep(90, 130, Math.max(Math.abs(x), Math.abs(z)));
      col = mix3(col, rock, e * 0.8);
      // pond bed + shore
      const h = terrainHeight(x, z);
      const pd = pondD(x, z);
      if (pd < 1.7) {
        const shore = smoothstep(WATER_Y + 0.55, WATER_Y - 0.1, h);
        col = mix3(col, sand, shore * 0.8 * (1 - smoothstep(1.2, 1.7, pd)));
        col = mix3(col, bed, smoothstep(WATER_Y + 0.05, WATER_Y - 1.1, h));
      }
      // plaza
      const pr = dist(x, z, PLAZA.x, PLAZA.z);
      if (pr < PLAZA.r + 3) {
        const m = 1 - smoothstep(PLAZA.r - 0.4, PLAZA.r + 0.3, pr);
        col = mix3(col, mix3(stoneDark, stone, n2), m);
      }
      // path: dark packed earth between the instanced flagstones
      const pm = pathMask(x, z);
      if (pm > 0) col = mix3(col, mix3(mud, c3(0x737a6d), 0.5 + n2 * 0.4), pm * 0.9);
      // boss courtyard slab ring
      const bd = dist(x, z, 0, 84);
      if (bd < 11) {
        const f = 1 - smoothstep(9, 11, bd);
        col = mix3(col, mix3(stoneDark, stone, n2), f * 0.8);
      }
      const k = (py * TEX + px) * 4;
      img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // painterly dabs + grass tuft dashes
  const rnd = mulberry32(7);
  const toPx = (x: number, z: number): [number, number] => [(x / S + 0.5) * TEX, (0.5 - z / S) * TEX];
  ctx.globalAlpha = 0.07;
  for (let i = 0; i < 2600; i++) {
    const x = (rnd() - 0.5) * S, z = (rnd() - 0.5) * S;
    const [px, py] = toPx(x, z);
    ctx.fillStyle = rnd() < 0.5 ? "#e9e2c9" : "#3a4a44";
    ctx.beginPath(); ctx.ellipse(px, py, 6 + rnd() * 18, 2 + rnd() * 5, rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // path wear: pale dusty centre, dark ruts, pebbles flung to the edges
  ctx.globalAlpha = 1;
  for (let z = -62; z < 78; z += 0.45) {
    const cx = pathX(z);
    for (const [off, col, a, wd] of [[0, "#bbc2b2", 0.28, 22], [-1.0, "#454b44", 0.22, 5], [1.0, "#454b44", 0.22, 5]] as [number, string, number, number][]) {
      const [px, py] = toPx(cx + off * (z < -22 ? 1.2 : 0.8), z);
      ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(px, py, wd * 0.35 * (0.6 + rnd()), 1.4 + rnd() * 1.2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  const pebC = ["#8a8f86", "#a2a89a", "#6c716a", "#bdc2b0"];
  for (let i = 0; i < 1500; i++) {
    const z = -60 + rnd() * 138, side = rnd() < 0.5 ? -1 : 1;
    const w = z < -22 ? 3.1 : 2.4;
    const x = pathX(z) + side * (w * 0.8 + rnd() * 1.6);
    const [px, py] = toPx(x, z);
    ctx.globalAlpha = 0.65; ctx.fillStyle = pebC[Math.floor(rnd() * 4)];
    ctx.beginPath(); ctx.ellipse(px, py, 0.8 + rnd() * 1.6, 0.6 + rnd() * 1.1, rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // boss courtyard rune ring (dull vermilion, runes pulse separately)
  ctx.globalAlpha = 0.5; ctx.strokeStyle = "#8a3a30"; ctx.lineWidth = 2;
  const [bx, by] = toPx(0, 84);
  const pxPerU = TEX / S;
  for (const rr of [6.3, 8.6]) { ctx.beginPath(); ctx.arc(bx, by, rr * pxPerU, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function makeDetailTexture(): THREE.CanvasTexture {
  const N = 256;
  const cv = document.createElement("canvas"); cv.width = cv.height = N;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // tileable noise via periodic sampling of value noise on a torus-ish blend
    const s = 8 / N;
    const f = (u: number, v: number) => {
      const a = vnoise(u, v), b = vnoise(u - 8, v), c = vnoise(u, v - 8), d = vnoise(u - 8, v - 8);
      const fx = u / 8, fy = v / 8;
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    };
    const u = x * s, v = y * s;
    const n = f(u, v) * 0.75 + hash2(x, y) * 0.25;
    const g = 205 + n * 50;
    const k = (y * N + x) * 4;
    img.data[k] = g; img.data[k + 1] = g; img.data[k + 2] = g - 4; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function buildTerrain(): THREE.Mesh {
  const seg = 124;
  const g = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const map = makeGroundTexture();
  const detail = makeDetailTexture();
  const mat = new THREE.MeshToonMaterial({ map, gradientMap: toonGradient() });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uDetail = { value: detail };
    s.uniforms.uWT = WIND.time;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWp = (modelMatrix * vec4(position,1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWp; uniform sampler2D uDetail; uniform float uWT;")
      .replace("#include <map_fragment>", `
        #ifdef USE_MAP
          vec2 gUv = vec2((vWp.x / ${TERRAIN_SIZE.toFixed(1)} + 0.5), (0.5 + vWp.z / ${TERRAIN_SIZE.toFixed(1)}));
          // texture was painted with z up -> flipY gives uv.y = 0.5 + z/S
          vec4 sampledDiffuseColor = texture2D(map, gUv);
          float dt = texture2D(uDetail, vWp.xz * 0.13).r * texture2D(uDetail, vWp.xz * 0.037 + 0.3).r;
          sampledDiffuseColor.rgb *= 0.78 + dt * 0.42;
          // close-range ink-wash / dry-brush grain: stretched strokes + dabs + speckle (fades with distance)
          float gNear = 1.0 - smoothstep(14.0, 62.0, length(vWp - cameraPosition));
          vec2 gq = vWp.xz;
          float s1 = (texture2D(uDetail, vec2(gq.x * 0.95, gq.y * 0.12)).r - 0.8) * 5.0;
          float s2 = (texture2D(uDetail, vec2(gq.x * 0.2 + 0.4, gq.y * 0.75)).r - 0.8) * 5.0;
          float s3 = (texture2D(uDetail, gq * 2.3 + 0.17).r - 0.8) * 5.0;
          float wash = (texture2D(uDetail, gq * 0.052 + 0.6).r - 0.8) * 5.0;
          float stroke = (s1 - 0.5) * 0.34 + (s2 - 0.5) * 0.22;
          vec3 tint = mix(vec3(0.86, 0.95, 0.9), vec3(1.08, 1.06, 0.92), wash);
          sampledDiffuseColor.rgb *= mix(vec3(1.0), tint * (1.0 + stroke), gNear);
          sampledDiffuseColor.rgb *= 1.0 - smoothstep(0.78, 0.95, s3) * 0.22 * gNear;
          // drifting cloud shadows: slow low-frequency patches of dimmer, cooler ground that slide across the valley
          float cl = texture2D(uDetail, vWp.xz * 0.0062 + vec2(uWT * 0.0042, uWT * 0.0016)).r * texture2D(uDetail, vWp.xz * 0.0019 + vec2(0.3, uWT * 0.0008)).r;
          float cshade = smoothstep(0.36, 0.72, (cl - 0.62) / 0.38) * (1.0 - smoothstep(60.0, 160.0, length(vWp.xz - cameraPosition.xz)) * 0.5);
          sampledDiffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.87, 0.94), cshade * 0.85);
          diffuseColor *= sampledDiffuseColor;
        #endif`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "terrain";
  return mesh;
}
