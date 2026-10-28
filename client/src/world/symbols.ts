// Non-letter brush symbols for VFX flashes, talisman charms and seals: pictograms and abstract marks drawn as tapered brush strokes.
// Nothing here is a character of any alphabet; every mark is a picture (flame, wave, lotus ...) or a geometric rune.
import * as THREE from "three";

export type SymbolName =
  | "slash" | "crescent" | "burst" | "guard" | "flame" | "bolt" | "snow" | "swirl" | "needle" | "rain" | "lotus"
  | "wave" | "plum" | "sprout" | "crack" | "taiji" | "rune" | "mountain" | "charm";

type P = (t: number) => [number, number];
const TAU = Math.PI * 2;

/** one tapered brush stroke: round stamps along a parametric path in unit coordinates (0..1), width profile `w(t)` in unit size */
function stroke(g: CanvasRenderingContext2D, s: number, grow: number, p: P, w: (t: number) => number, n = 36): void {
  n *= 3; // dense stamps so thin strokes read as continuous brush lines, not beads
  for (let i = 0; i <= n; i++) {
    const t = i / n, [x, y] = p(t);
    g.beginPath(); g.arc(x * s, y * s, Math.max(0.4, (w(t) * s + grow) / 2), 0, TAU); g.fill();
  }
}
const taper = (w: number, tail = 0.25) => (t: number) => w * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * (1 + tail))) ** 0.6);
const even = (w: number) => () => w;
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): P => (t) => { const a = a0 + (a1 - a0) * t; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
const line = (x0: number, y0: number, x1: number, y1: number): P => (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
const spiral = (cx: number, cy: number, r0: number, r1: number, a0: number, turns: number): P => (t) => { const a = a0 + t * turns * TAU, r = r0 + (r1 - r0) * t; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
function dot(g: CanvasRenderingContext2D, s: number, grow: number, x: number, y: number, r: number): void { g.beginPath(); g.arc(x * s, y * s, r * s + grow / 2, 0, TAU); g.fill(); }
function poly(pts: [number, number][]): P {
  const segs: number[] = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); tot += d; }
  return (t) => {
    let d = t * tot, i = 0;
    while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++; }
    const k = segs[i] > 0 ? d / segs[i] : 0;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
  };
}

const SHAPES: Record<SymbolName, (g: CanvasRenderingContext2D, s: number, k: number) => void> = {
  // three diagonal sweeping strokes
  slash(g, s, k) {
    stroke(g, s, k, arc(0.64, 0.8, 0.52, -2.55, -1.05), taper(0.1), 40);
    stroke(g, s, k, arc(0.72, 0.86, 0.5, -2.4, -1.15), taper(0.06), 40);
    stroke(g, s, k, arc(0.56, 0.72, 0.5, -2.6, -1.25), taper(0.04), 40);
    dot(g, s, k, 0.2, 0.3, 0.025); dot(g, s, k, 0.13, 0.42, 0.018);
  },
  // flying crescent with two trailing lines
  crescent(g, s, k) {
    stroke(g, s, k, arc(0.62, 0.5, 0.34, 1.9, 4.4), taper(0.13), 44);
    stroke(g, s, k, arc(0.62, 0.5, 0.22, 2.3, 4.0), taper(0.045), 30);
    stroke(g, s, k, line(0.1, 0.4, 0.34, 0.4), taper(0.04), 14);
    stroke(g, s, k, line(0.04, 0.55, 0.3, 0.55), taper(0.03), 14);
  },
  // ring with radiating brush dashes (heaven-splitting)
  burst(g, s, k) {
    stroke(g, s, k, arc(0.5, 0.5, 0.2, 0, TAU), even(0.05), 48);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, r0 = i % 2 ? 0.3 : 0.28, r1 = i % 2 ? 0.4 : 0.47; stroke(g, s, k, line(0.5 + Math.cos(a) * r0, 0.5 + Math.sin(a) * r0, 0.5 + Math.cos(a) * r1, 0.5 + Math.sin(a) * r1), taper(0.045), 8); }
    dot(g, s, k, 0.5, 0.5, 0.05);
  },
  // circle of brush dashes around an inner ring
  guard(g, s, k) {
    for (let i = 0; i < 10; i++) { const a0 = (i / 10) * TAU; stroke(g, s, k, arc(0.5, 0.5, 0.42, a0, a0 + 0.42), taper(0.055), 10); }
    stroke(g, s, k, arc(0.5, 0.5, 0.27, 0, TAU), even(0.03), 48);
    stroke(g, s, k, arc(0.5, 0.5, 0.12, 0.4, TAU + 0.4), taper(0.05), 36);
    dot(g, s, k, 0.5, 0.5, 0.025);
  },
  // three flame tongues
  flame(g, s, k) {
    stroke(g, s, k, poly([[0.5, 0.92], [0.28, 0.72], [0.34, 0.5], [0.5, 0.36], [0.46, 0.2], [0.58, 0.06]]), taper(0.1, 0.1), 40);
    stroke(g, s, k, poly([[0.52, 0.92], [0.76, 0.74], [0.68, 0.56], [0.6, 0.46], [0.7, 0.34]]), taper(0.075, 0.1), 32);
    stroke(g, s, k, poly([[0.46, 0.9], [0.3, 0.78], [0.2, 0.62], [0.24, 0.5]]), taper(0.055, 0.1), 24);
    stroke(g, s, k, poly([[0.44, 0.78], [0.5, 0.66], [0.56, 0.78]]), taper(0.045), 12);
    dot(g, s, k, 0.82, 0.22, 0.02); dot(g, s, k, 0.16, 0.34, 0.016);
  },
  // zigzag lightning with a fork
  bolt(g, s, k) {
    stroke(g, s, k, poly([[0.62, 0.04], [0.36, 0.42], [0.58, 0.46], [0.3, 0.96]]), taper(0.12, 0.05), 40);
    stroke(g, s, k, poly([[0.58, 0.46], [0.8, 0.52], [0.7, 0.7]]), taper(0.06), 20);
    stroke(g, s, k, poly([[0.36, 0.42], [0.18, 0.34]]), taper(0.05), 10);
  },
  // six-armed snowflake
  snow(g, s, k) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
      stroke(g, s, k, line(0.5, 0.5, 0.5 + ca * 0.44, 0.5 + sa * 0.44), taper(0.05, 0.1), 16);
      for (const f of [0.55, 0.8]) for (const sgn of [-1, 1]) {
        const bx = 0.5 + ca * 0.44 * f, by = 0.5 + sa * 0.44 * f, b = a + sgn * 0.8, l = 0.13 * (1.2 - f * 0.5);
        stroke(g, s, k, line(bx, by, bx + Math.cos(b) * l, by + Math.sin(b) * l), taper(0.035), 8);
      }
    }
    dot(g, s, k, 0.5, 0.5, 0.045);
  },
  // wind: three curled streamers
  swirl(g, s, k) {
    stroke(g, s, k, spiral(0.62, 0.3, 0.14, 0.02, 0.6, 1.25), taper(0.07), 44);
    stroke(g, s, k, poly([[0.06, 0.3], [0.3, 0.26], [0.5, 0.22]]), taper(0.06), 18);
    stroke(g, s, k, spiral(0.66, 0.68, 0.14, 0.02, 0.2, 1.25), taper(0.07), 44);
    stroke(g, s, k, poly([[0.12, 0.68], [0.34, 0.66], [0.52, 0.62]]), taper(0.06), 18);
    stroke(g, s, k, poly([[0.2, 0.48], [0.56, 0.47], [0.88, 0.5]]), taper(0.045), 18);
  },
  // needle with a dotted trail and a bead
  needle(g, s, k) {
    stroke(g, s, k, line(0.12, 0.88, 0.84, 0.16), (t) => 0.02 + 0.07 * t ** 1.5, 40);
    dot(g, s, k, 0.88, 0.12, 0.05);
    for (let i = 0; i < 5; i++) dot(g, s, k, 0.08 + i * 0.045, 0.62 + i * 0.045 + 0.1, 0.012 + 0.004 * (4 - i));
    stroke(g, s, k, arc(0.88, 0.12, 0.13, 0.2, 1.6), taper(0.03), 12);
  },
  // five raindrops with falling streaks
  rain(g, s, k) {
    const drop = (x: number, y: number, r: number) => { dot(g, s, k, x, y + r * 0.5, r); stroke(g, s, k, line(x, y - r * 1.7, x, y + r * 0.2), (t) => r * 1.6 * t, 10); };
    drop(0.5, 0.32, 0.075); drop(0.26, 0.5, 0.055); drop(0.74, 0.46, 0.055); drop(0.38, 0.8, 0.045); drop(0.64, 0.78, 0.045);
    stroke(g, s, k, arc(0.5, 0.06, 0.3, 0.35, 2.8), taper(0.04), 24);
  },
  // lotus: five petals on two wave lines
  lotus(g, s, k) {
    const petal = (a: number, len: number, wd: number) => {
      const bx = 0.5, by = 0.74, tx = bx + Math.sin(a) * len, ty = by - Math.cos(a) * len;
      const nx = Math.cos(a) * wd, ny = Math.sin(a) * wd;
      stroke(g, s, k, (t) => { const u = t; const m = Math.sin(u * Math.PI); return [bx + (tx - bx) * u + nx * m * (t < 0.5 ? 1 : 1), by + (ty - by) * u + ny * m]; }, taper(0.05), 24);
      stroke(g, s, k, (t) => { const m = Math.sin(t * Math.PI); return [bx + (tx - bx) * t - nx * m, by + (ty - by) * t - ny * m]; }, taper(0.05), 24);
    };
    petal(0, 0.5, 0.11); petal(-0.62, 0.42, 0.1); petal(0.62, 0.42, 0.1); petal(-1.15, 0.3, 0.08); petal(1.15, 0.3, 0.08);
    stroke(g, s, k, poly([[0.1, 0.86], [0.3, 0.8], [0.5, 0.88], [0.7, 0.8], [0.9, 0.86]]), taper(0.04), 24);
  },
  // three wave crests
  wave(g, s, k) {
    for (let i = 0; i < 3; i++) {
      const y = 0.3 + i * 0.22;
      stroke(g, s, k, (t) => [0.05 + t * 0.9, y + Math.sin(t * TAU * 1.5 + i) * 0.07 - 0.07 * t * (i === 0 ? 1 : 0)], taper(0.07 - i * 0.012), 40);
    }
    stroke(g, s, k, spiral(0.74, 0.16, 0.08, 0.02, 3.5, 1.1), taper(0.04), 20);
    dot(g, s, k, 0.2, 0.14, 0.02); dot(g, s, k, 0.3, 0.08, 0.014);
  },
  // five-petal plum blossom with stamens
  plum(g, s, k) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2;
      dot(g, s, k, 0.5 + Math.cos(a) * 0.22, 0.5 + Math.sin(a) * 0.22, 0.14);
    }
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2 + 0.3; stroke(g, s, k, line(0.5, 0.5, 0.5 + Math.cos(a) * 0.1, 0.5 + Math.sin(a) * 0.1), even(0.012), 4); }
  },
  // sprout: two leaves on a curved stem
  sprout(g, s, k) {
    stroke(g, s, k, poly([[0.5, 0.9], [0.5, 0.58]]), taper(0.05, 0.1), 16);
    stroke(g, s, k, (t) => { const m = Math.sin(t * Math.PI); return [0.5 - 0.34 * t, 0.58 - 0.12 * t - 0.2 * m]; }, taper(0.05), 28);
    stroke(g, s, k, (t) => { const m = Math.sin(t * Math.PI); return [0.5 - 0.34 * t, 0.58 - 0.12 * t + 0.0 * m]; }, taper(0.05), 28);
    stroke(g, s, k, (t) => { const m = Math.sin(t * Math.PI); return [0.5 + 0.34 * t, 0.46 - 0.12 * t - 0.2 * m]; }, taper(0.05), 28);
    stroke(g, s, k, (t) => { const m = Math.sin(t * Math.PI); return [0.5 + 0.34 * t, 0.46 - 0.12 * t + 0.0 * m]; }, taper(0.05), 28);
    stroke(g, s, k, arc(0.5, 0.58, 0.4, 0.5, Math.PI - 0.5), taper(0.035), 24);
    dot(g, s, k, 0.5, 0.24, 0.03);
  },
  // shock: jagged radial cracks with a ring
  crack(g, s, k) {
    stroke(g, s, k, arc(0.5, 0.5, 0.12, 0, TAU), even(0.045), 36);
    const rays = [0.1, 0.9, 1.7, 2.5, 3.3, 4.1, 5.0, 5.7];
    rays.forEach((a, i) => {
      const L = 0.36 + (i % 3) * 0.05, pts: [number, number][] = [];
      for (let j = 0; j <= 4; j++) { const an = a + (j % 2 ? 0.09 : -0.07), r = 0.16 + (L - 0.16) * (j / 4); pts.push([0.5 + Math.cos(an) * r, 0.5 + Math.sin(an) * r]); }
      stroke(g, s, k, poly(pts), taper(0.05), 20);
    });
  },
  // taiji-style brush spiral: ring, two comma swirls, two dots
  taiji(g, s, k) {
    stroke(g, s, k, arc(0.5, 0.5, 0.42, 0, TAU), even(0.045), 56);
    stroke(g, s, k, arc(0.5, 0.5, 0.33, 0.15, TAU - 0.15), taper(0.025), 48);
    stroke(g, s, k, (t) => t < 0.5 ? arc(0.5, 0.3, 0.2, -Math.PI / 2, Math.PI / 2)(t * 2) : arc(0.5, 0.7, 0.2, -Math.PI / 2, -Math.PI * 1.5)(t * 2 - 1), even(0.075), 48);
    dot(g, s, k, 0.5, 0.3, 0.035); dot(g, s, k, 0.5, 0.7, 0.035);
  },
  // Stone Guardian rune: nested ring + diamond + ticks, deliberately not a letter or character
  rune(g, s, k) {
    stroke(g, s, k, arc(0.5, 0.5, 0.42, 0, TAU), even(0.05), 56);
    stroke(g, s, k, poly([[0.5, 0.16], [0.84, 0.5], [0.5, 0.84], [0.16, 0.5], [0.5, 0.16]]), even(0.04), 44);
    stroke(g, s, k, arc(0.5, 0.5, 0.15, 0, TAU), even(0.04), 32);
    dot(g, s, k, 0.5, 0.5, 0.045);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; stroke(g, s, k, line(0.5 + Math.cos(a) * 0.44, 0.5 + Math.sin(a) * 0.44, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5), even(0.03), 4); }
    stroke(g, s, k, line(0.5, 0.16, 0.5, 0.3), even(0.035), 6);
    stroke(g, s, k, line(0.16, 0.5, 0.3, 0.5), even(0.035), 6);
  },
  // distant peaks over a sun disc and wave line (seal pictogram)
  mountain(g, s, k) {
    stroke(g, s, k, poly([[0.08, 0.76], [0.34, 0.34], [0.5, 0.56], [0.68, 0.22], [0.92, 0.76]]), even(0.07), 40);
    dot(g, s, k, 0.78, 0.24, 0.07);
    stroke(g, s, k, (t) => [0.1 + t * 0.8, 0.88 + Math.sin(t * TAU * 2) * 0.03], taper(0.05), 36);
  },
  // talisman charm: framed zigzag seal marks, circles and dotted lines (no characters)
  charm(g, s, k) {
    stroke(g, s, k, arc(0.5, 0.17, 0.09, 0, TAU), even(0.03), 24);
    stroke(g, s, k, arc(0.5, 0.17, 0.035, 0, TAU), even(0.03), 12);
    for (let i = 0; i < 9; i++) dot(g, s, k, 0.14 + i * 0.09, 0.33, 0.013);
    stroke(g, s, k, spiral(0.5, 0.52, 0.12, 0.015, 0.4, 1.6), taper(0.045), 44);
    stroke(g, s, k, poly([[0.1, 0.52], [0.26, 0.52]]), even(0.03), 8);
    stroke(g, s, k, poly([[0.74, 0.52], [0.9, 0.52]]), even(0.03), 8);
    stroke(g, s, k, poly([[0.1, 0.76], [0.26, 0.9], [0.42, 0.76], [0.58, 0.9], [0.74, 0.76], [0.9, 0.9]]), even(0.035), 40);
    dot(g, s, k, 0.1, 0.62, 0.012); dot(g, s, k, 0.9, 0.62, 0.012);
  },
};

/** draw `name` into a square region of side `size` at (x,y) (top-left), with a darker ink edge underneath */
export function drawSymbol(g: CanvasRenderingContext2D, name: SymbolName, x: number, y: number, size: number, fill: string, edge?: string): void {
  g.save(); g.translate(x, y); g.lineCap = "round"; g.lineJoin = "round";
  if (edge) { g.fillStyle = edge; g.strokeStyle = edge; SHAPES[name](g, size, size * 0.05); }
  g.fillStyle = fill; g.strokeStyle = fill; SHAPES[name](g, size, 0);
  g.restore();
}

export interface SymbolTex { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement }

/** square transparent texture holding one brush symbol (no font involved, so it is ready immediately) */
export function symbolTexture(name: SymbolName, size: number, fill: string, edge?: string): SymbolTex {
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  drawSymbol(g, name, size * 0.04, size * 0.04, size * 0.92, fill, edge);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, canvas: cv };
}
