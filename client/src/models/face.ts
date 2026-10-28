// Brush-painted faces: one canvas texture per face style, wrapped on a curved patch that hugs the front of the skull.
// Eyes, brows, lids, rouge and the zhusha mark are drawn as tapered ink strokes (sclera, iris, catch-lights, flicks) instead of
// dots, so each class reads differently at a glance: stern/sharp (sword), serene half-lidded (talisman), soft/open (physician), aged (elder).
import * as THREE from "three";
import { toonGradient } from "../world/toon";

export type FaceStyle = "stern" | "calm" | "gentle" | "elder";

const R = 0.1268;              // skull radius (+ a hair) in head space
const A = 0.78, T0 = Math.PI / 2 - 0.78, T1 = Math.PI / 2 + 0.66;
const SX = 0.95, SY = 1.02, SZ = 0.98, CY = 0.05;
const TEX = 512;
const PPM = 2700;              // texture pixels per metre of face

/** head-space metres (x right, y up) -> texture pixels, following the sphere parametrisation of the patch */
function P(x: number, y: number): [number, number] {
  const ct = Math.max(-1, Math.min(1, (y - CY) / (SY * R)));
  const th = Math.acos(ct), st = Math.max(0.2, Math.sin(th));
  const ph = Math.PI / 2 + Math.asin(Math.max(-1, Math.min(1, x / (SX * R * st))));
  return [((ph - (Math.PI / 2 - A)) / (2 * A)) * TEX, ((th - T0) / (T1 - T0)) * TEX];
}

let patchGeo: THREE.BufferGeometry | null = null;
function patch(): THREE.BufferGeometry {
  if (patchGeo) return patchGeo;
  const g = new THREE.SphereGeometry(R, 24, 18, Math.PI / 2 - A, 2 * A, T0, T1 - T0);
  g.scale(SX, SY, SZ);
  g.translate(0, CY, 0);
  patchGeo = g;
  return g;
}

type Pt = [number, number];
const INK = "#1a1a1f", VERM = "#c8372d", PAPER = "#f3ecd9";

/** Catmull-Rom sample of a metre-space polyline, mapped to pixels */
function curve(pts: Pt[], n = 36): Pt[] {
  const out: Pt[] = [];
  const c = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < n / (pts.length - 1); k++) {
    const t = k / (n / (pts.length - 1)), p0 = c(i - 1), p1 = c(i), p2 = c(i + 1), p3 = c(i + 2);
    const f = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t * t + (-a + 3 * b - 3 * cc + d) * t * t * t);
    out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** tapered brush stroke along `pts` (metres); width profile `w(t)` in pixels, t 0..1 */
function stroke(g: CanvasRenderingContext2D, pts: Pt[], color: string, w: (t: number) => number, alpha = 1): void {
  const s = curve(pts);
  g.save(); g.globalAlpha = alpha; g.fillStyle = color;
  for (let i = 0; i < s.length; i++) {
    const [px, py] = P(s[i][0], s[i][1]);
    g.beginPath(); g.arc(px, py, Math.max(0.4, w(i / (s.length - 1)) / 2), 0, 7); g.fill();
  }
  g.restore();
}
const taper = (mid: number, head = 0.35, tail = 0.15) => (t: number) => mid * Math.min(1, (t + tail) / head) * Math.min(1, (1.0 - t + 0.04) / 0.5 + 0.35) * (0.7 + 0.3 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.85));
function fillPoly(g: CanvasRenderingContext2D, pts: Pt[], fill: string, line?: string, lw = 1.5): void {
  const s = curve(pts, 40).map(([x, y]) => P(x, y));
  g.beginPath(); s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  g.fillStyle = fill; g.fill(); if (line) { g.strokeStyle = line; g.lineWidth = lw; g.stroke(); }
}
function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, sx = 1, sy = 1, alpha = 1): void {
  const [px, py] = P(x, y);
  g.save(); g.globalAlpha = alpha; g.fillStyle = color; g.translate(px, py); g.scale(sx, sy); g.beginPath(); g.arc(0, 0, r * PPM, 0, 7); g.fill(); g.restore();
}
function soft(g: CanvasRenderingContext2D, x: number, y: number, r: number, rgba: string): void {
  const [px, py] = P(x, y); const rr = r * PPM;
  const gr = g.createRadialGradient(px, py, 0, px, py, rr); gr.addColorStop(0, rgba); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(px - rr, py - rr, rr * 2, rr * 2);
}

function paint(style: FaceStyle): HTMLCanvasElement {
  const cv = document.createElement("canvas"); cv.width = cv.height = TEX;
  const g = cv.getContext("2d")!;
  g.lineJoin = "round"; g.lineCap = "round";
  const EX = 0.047, EY = 0.058;
  for (const s of [-1, 1]) {
    const E = (dx: number, dy: number): Pt => [s * (EX + dx), EY + dy];   // eye-space (dx outward from the nose)
    if (style === "stern") {
      // narrow, up-slanted eye: pale almond, dark iris, heavy upper lid with a long flick, vermilion liner
      fillPoly(g, [E(-0.036, 0.001), E(-0.014, 0.013), E(0.014, 0.017), E(0.037, 0.011), E(0.036, 0.0), E(0.012, -0.007), E(-0.014, -0.004)], PAPER, "rgba(26,26,31,0.6)", 1.2);
      disc(g, s * (EX + 0.005), EY + 0.002, 0.0148, INK, 0.92, 1.12);
      disc(g, s * (EX + 0.009), EY + 0.009, 0.0042, "#ffffff"); disc(g, s * EX, EY - 0.004, 0.0022, "#ffffff", 1, 1, 0.8);
      stroke(g, [E(-0.04, 0.0), E(-0.014, 0.018), E(0.016, 0.023), E(0.042, 0.018), E(0.07, 0.034)], INK, taper(17, 0.3, 0.1));
      stroke(g, [E(0.03, 0.012), E(0.054, 0.026), E(0.078, 0.046)], VERM, taper(7, 0.4, 0.2), 0.95);
      stroke(g, [E(-0.016, 0.05), E(0.018, 0.058), E(0.05, 0.07), E(0.078, 0.088)], INK, taper(17, 0.25, 0.05)); // sharp rising brow
      stroke(g, [E(-0.024, -0.012), E(0.0, -0.016), E(0.026, -0.012)], INK, taper(4), 0.35);
    } else if (style === "calm") {
      // serene half-lidded eye
      fillPoly(g, [E(-0.034, 0.0), E(-0.012, 0.01), E(0.014, 0.011), E(0.038, 0.004), E(0.03, -0.003), E(0.008, -0.008), E(-0.014, -0.006)], PAPER, "rgba(26,26,31,0.55)", 1.2);
      disc(g, s * (EX + 0.004), EY - 0.003, 0.0145, INK, 0.9, 1.0);
      disc(g, s * (EX + 0.008), EY + 0.003, 0.0035, "#ffffff", 1, 1, 0.9);
      stroke(g, [E(-0.038, 0.004), E(-0.012, 0.015), E(0.018, 0.017), E(0.046, 0.008), E(0.058, -0.002)], INK, taper(19, 0.25, 0.1));
      stroke(g, [E(-0.016, 0.052), E(0.02, 0.058), E(0.056, 0.056), E(0.082, 0.046)], INK, taper(8, 0.3, 0.1)); // long calm brow
      stroke(g, [E(-0.02, -0.012), E(0.002, -0.015), E(0.024, -0.011)], INK, taper(3), 0.3);
    } else if (style === "gentle") {
      // open, soft eye with lashes and rosy cheeks
      fillPoly(g, [E(-0.031, 0.0), E(-0.014, 0.014), E(0.01, 0.02), E(0.03, 0.013), E(0.038, 0.001), E(0.018, -0.012), E(-0.01, -0.012)], PAPER, "rgba(26,26,31,0.55)", 1.2);
      disc(g, s * (EX + 0.004), EY + 0.0, 0.0172, INK, 1, 1.05);
      disc(g, s * (EX + 0.0105), EY + 0.0085, 0.0048, "#ffffff"); disc(g, s * (EX - 0.002), EY - 0.007, 0.0026, "#ffffff", 1, 1, 0.85);
      stroke(g, [E(-0.034, 0.0), E(-0.012, 0.018), E(0.014, 0.024), E(0.034, 0.016), E(0.05, 0.022)], INK, taper(14, 0.3, 0.1));
      stroke(g, [E(0.014, -0.012), E(0.0, -0.016), E(-0.014, -0.014)], INK, taper(3), 0.4);
      stroke(g, [E(-0.014, 0.05), E(0.014, 0.06), E(0.044, 0.056), E(0.064, 0.044)], INK, taper(9, 0.3, 0.1)); // soft arch
      soft(g, s * 0.07, 0.006, 0.026, "rgba(224,110,100,0.55)");
    } else {
      // elder: smiling crescent eyes, drooping white brows, crow's feet
      stroke(g, [E(-0.03, 0.003), E(-0.008, 0.012), E(0.018, 0.012), E(0.042, 0.002)], INK, taper(8, 0.3, 0.1));
      disc(g, s * (EX + 0.006), EY + 0.004, 0.006, INK, 1, 0.8, 0.85);
      stroke(g, [E(-0.016, 0.044), E(0.016, 0.054), E(0.046, 0.046), E(0.066, 0.03)], "#26262c", taper(15, 0.2, 0.1), 0.9);
      stroke(g, [E(-0.014, 0.044), E(0.016, 0.052), E(0.046, 0.044), E(0.064, 0.03)], PAPER, taper(11, 0.2, 0.1));
      for (let k = 0; k < 3; k++) stroke(g, [E(0.046, 0.004 - k * 0.007), E(0.062, 0.006 - k * 0.011)], INK, taper(2.4), 0.45);
      stroke(g, [E(-0.02, -0.014), E(0.0, -0.02), E(0.024, -0.016)], INK, taper(3), 0.25);
    }
  }
  // nose + mouth
  stroke(g, [[0.001, 0.047], [0.004, 0.03], [-0.003, 0.024], [-0.007, 0.026]], style === "elder" ? "#5a4a44" : "#8a5a4e", taper(4), 0.7);
  if (style === "gentle") { stroke(g, [[-0.014, -0.006], [0, -0.016], [0.014, -0.006]], VERM, taper(6.5, 0.4, 0.3)); }
  else if (style === "stern") { stroke(g, [[-0.014, -0.012], [0, -0.014], [0.014, -0.012]], "#7a2420", taper(5.5, 0.4, 0.3)); }
  else if (style === "calm") { stroke(g, [[-0.011, -0.011], [0, -0.014], [0.011, -0.011]], VERM, taper(5.5, 0.4, 0.3)); }
  else { stroke(g, [[-0.012, -0.012], [0, -0.014], [0.012, -0.011]], "#8a4a40", taper(4)); }
  // zhusha (cinnabar) forehead mark for the talisman master
  if (style === "calm") {
    fillPoly(g, [[0, 0.13], [0.006, 0.12], [0.005, 0.111], [0, 0.104], [-0.005, 0.111], [-0.006, 0.12]], VERM);
    disc(g, 0.0015, 0.116, 0.0021, "#f3b8a0", 1, 1, 0.6);
  }
  // stern: faint ink shadow under the brows (severe look)
  if (style === "stern") { soft(g, 0.047, 0.078, 0.02, "rgba(26,26,31,0.16)"); soft(g, -0.047, 0.078, 0.02, "rgba(26,26,31,0.16)"); }
  return cv;
}

const texCache = new Map<FaceStyle, THREE.CanvasTexture>();
function faceTex(style: FaceStyle): THREE.CanvasTexture {
  let t = texCache.get(style);
  if (!t) {
    t = new THREE.CanvasTexture(paint(style)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
    texCache.set(style, t);
  }
  return t;
}

/** A face patch in head space. Per-avatar material (so avatar disposal never touches shared state), shared texture and geometry. */
export function faceMesh(style: FaceStyle): THREE.Mesh {
  const m = new THREE.MeshToonMaterial({ map: faceTex(style), gradientMap: toonGradient(), transparent: false, alphaTest: 0.35, alphaToCoverage: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(patch(), m);
  mesh.name = "face";
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  return mesh;
}
