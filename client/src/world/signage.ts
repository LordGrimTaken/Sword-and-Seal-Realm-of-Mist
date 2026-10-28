// All in-world lettering in one place: lacquer boards (one atlas, one draw), lantern words, swaying banners.
// Text is real English brushwork from the bundled Ma Shan Zheng face; every board is emitted for BOTH faces so it always reads left-to-right.
import * as THREE from "three";
import { brushText, canvasTex } from "./calligraphy";
import { drawSymbol, type SymbolName } from "./symbols";
import { toonGradient } from "./toon";

interface Rect { x: number; y: number; w: number; h: number }
const AW = 2048, AH = 2048;
export const BOARD: Record<string, Rect> = {
  plaque: { x: 8, y: 8, w: 1100, h: 330 },
  pagoda: { x: 1128, y: 8, w: 860, h: 308 },
  tablet: { x: 8, y: 358, w: 860, h: 310 },
  valley: { x: 888, y: 358, w: 760, h: 260 },
  coupletL: { x: 8, y: 688, w: 330, h: 660 },
  coupletR: { x: 358, y: 688, w: 330, h: 660 },
  steleA: { x: 708, y: 688, w: 300, h: 660 },
  steleB: { x: 1028, y: 688, w: 300, h: 660 },
  steleC: { x: 1348, y: 688, w: 300, h: 660 },
  steleD: { x: 1668, y: 688, w: 300, h: 660 },
};

function gold(g: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, "#f6dc7a"); gr.addColorStop(0.55, "#d9b032"); gr.addColorStop(1, "#a97d1c");
  return gr;
}

function lacquer(g: CanvasRenderingContext2D, r: Rect, bg: string, frame: string) {
  g.fillStyle = bg; g.fillRect(r.x, r.y, r.w, r.h);
  // wood grain
  g.globalAlpha = 0.12; g.strokeStyle = "#000";
  for (let i = 0; i < 40; i++) { const yy = r.y + (i / 40) * r.h + Math.sin(i * 7) * 3; g.lineWidth = 1 + (i % 3); g.beginPath(); g.moveTo(r.x, yy); g.bezierCurveTo(r.x + r.w * 0.3, yy + 5, r.x + r.w * 0.6, yy - 6, r.x + r.w, yy + 2); g.stroke(); }
  g.globalAlpha = 1;
  g.strokeStyle = frame; g.lineWidth = 10; g.strokeRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
  g.lineWidth = 3; g.strokeRect(r.x + 24, r.y + 24, r.w - 48, r.h - 48);
  g.fillStyle = frame;
  for (const [cx, cy] of [[r.x + 16, r.y + 16], [r.x + r.w - 16, r.y + 16], [r.x + 16, r.y + r.h - 16], [r.x + r.w - 16, r.y + r.h - 16]]) { g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill(); }
}

/** vermilion square seal with a paper-coloured pictogram (no letters) */
function seal(g: CanvasRenderingContext2D, x: number, y: number, s: number, sym: SymbolName) {
  g.save();
  g.fillStyle = "#c8372d"; g.fillRect(x, y, s, s);
  g.strokeStyle = "#f2ead8"; g.lineWidth = Math.max(3, s * 0.04); g.strokeRect(x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88);
  drawSymbol(g, sym, x + s * 0.17, y + s * 0.17, s * 0.66, "#f2ead8", "#f2ead8");
  g.restore();
}

export function boardAtlas(): THREE.CanvasTexture {
  const ct = canvasTex(AW, AH, "boards", (g) => {
    g.fillStyle = "#2a2a30"; g.fillRect(0, 0, AW, AH);
    // --- main plaque: JIUZHOU, big gold brush on black lacquer, vermilion seal at the right
    let r = BOARD.plaque;
    lacquer(g, r, "#1b1b21", "#c9a227");
    brushText(g, "SWORD & SEAL", r.x + 442, r.y + r.h / 2 + 8, { size: 260, maxW: 780, fill: gold(g, r.y + 40, r.y + r.h - 40), edge: "#3a2a08", edgeW: 14, bold: 7, shadow: "rgba(0,0,0,0.5)", spacing: 1.08, dry: 0.12 });
    seal(g, r.x + r.w - 200, r.y + r.h / 2 - 80, 160, "mountain");
    // --- pagoda sign (vermilion board)
    r = BOARD.pagoda;
    lacquer(g, r, "#7a1f1c", "#d9b032");
    brushText(g, "Pagoda of\nEchoing Bells", r.x + r.w / 2, r.y + r.h / 2 + 6, { size: 120, maxW: r.w - 130, lineH: 0.98, fill: gold(g, r.y + 40, r.y + r.h - 20), edge: "#2a0c0a", edgeW: 11, bold: 4, dry: 0.1 });
    // --- weathered tablet
    r = BOARD.tablet;
    g.fillStyle = "#4a4640"; g.fillRect(r.x, r.y, r.w, r.h);
    g.globalAlpha = 0.25; g.strokeStyle = "#16130f";
    for (let i = 0; i < 36; i++) { g.lineWidth = 1 + (i % 3); const yy = r.y + (i / 36) * r.h; g.beginPath(); g.moveTo(r.x, yy); g.bezierCurveTo(r.x + 200, yy + 7, r.x + 500, yy - 8, r.x + r.w, yy + 3); g.stroke(); }
    g.globalAlpha = 1;
    g.strokeStyle = "#8c7a3c"; g.lineWidth = 8; g.strokeRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20);
    brushText(g, "Shrine of the\nStone Guardian", r.x + r.w / 2, r.y + r.h / 2 + 6, { size: 120, maxW: r.w - 110, lineH: 0.98, fill: "#d0b04a", edge: "#1c170b", edgeW: 9, bold: 4, dry: 0.4 });
    // moss + cracks
    g.fillStyle = "rgba(88,121,98,0.55)";
    for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(r.x + Math.random() * r.w, r.y + (Math.random() < 0.5 ? 6 : r.h - 6) + (Math.random() - 0.5) * 18, 14 + Math.random() * 40, 6 + Math.random() * 10, 0, 0, 7); g.fill(); }
    g.strokeStyle = "#0f0d0a"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(r.x + 700, r.y); g.lineTo(r.x + 730, r.y + 90); g.lineTo(r.x + 690, r.y + 150); g.lineTo(r.x + 730, r.y + r.h); g.stroke();
    // --- fallen valley board (jade-black)
    r = BOARD.valley;
    lacquer(g, r, "#1f2b27", "#c9a227");
    brushText(g, "Cloudmist Valley", r.x + r.w / 2, r.y + r.h / 2 + 6, { size: 140, maxW: r.w - 110, fill: gold(g, r.y + 40, r.y + r.h - 20), edge: "#14100a", edgeW: 11, bold: 4, dry: 0.1 });
    // --- gate couplets: one short verse per pillar, a word per line
    const couplets: [keyof typeof BOARD, string][] = [["coupletL", "Mist\nfolds\nthe\nhills"], ["coupletR", "Pines\nkeep\nthe\nroad"]];
    for (const [key, txt] of couplets) {
      r = BOARD[key];
      lacquer(g, r, "#1b1b21", "#c9a227");
      brushText(g, txt, r.x + r.w / 2, r.y + r.h / 2 + 4, { size: 170, maxW: r.w - 90, lineH: 0.9, fill: gold(g, r.y + 40, r.y + r.h - 40), edge: "#2a1c04", edgeW: 9, bold: 5, dry: 0.1 });
    }
    // --- steles (stone, carved place names and a pictogram)
    const steles: [keyof typeof BOARD, string, SymbolName][] = [["steleA", "LOTUS\nPOND", "lotus"], ["steleB", "CLOUDMIST\nVALLEY", "mountain"], ["steleC", "BAMBOO\nGROVE", "wave"], ["steleD", "FOX\nHILLS", "flame"]];
    for (const [key, txt, sym] of steles) {
      r = BOARD[key];
      g.fillStyle = "#a7a393"; g.fillRect(r.x, r.y, r.w, r.h);
      g.globalAlpha = 0.18;
      for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < 0.5 ? "#fff" : "#2a2a2a"; g.fillRect(r.x + Math.random() * r.w, r.y + Math.random() * r.h, 2 + Math.random() * 6, 2 + Math.random() * 3); }
      g.globalAlpha = 1;
      g.strokeStyle = "#5c594d"; g.lineWidth = 8; g.strokeRect(r.x + 12, r.y + 12, r.w - 24, r.h - 24);
      brushText(g, txt, r.x + r.w / 2, r.y + r.h * 0.4, { size: 125, maxW: r.w - 70, lineH: 1.05, fill: "#23211c", edge: "#d8d3c2", edgeW: 4, bold: 3, dry: 0.15 });
      seal(g, r.x + r.w / 2 - 55, r.y + r.h - 190, 110, sym);
      g.fillStyle = "rgba(88,121,98,0.5)"; g.beginPath(); g.ellipse(r.x + r.w * 0.3, r.y + r.h - 10, 70, 18, 0, 0, 7); g.fill();
    }
  });
  ct.tex.generateMipmaps = true;
  ct.tex.minFilter = THREE.LinearMipmapLinearFilter;
  return ct.tex;
}

/** one English word per lantern face, three cells in a row (transparent background) */
const LANTERN_WORDS = ["Fortune", "Peace", "Harmony"];
function lanternAtlas(): THREE.CanvasTexture {
  return canvasTex(768, 160, "lanterns", (g) => {
    LANTERN_WORDS.forEach((w, i) => brushText(g, w, i * 256 + 128, 82, { size: 110, maxW: 232, fill: "#f6d86a", edge: "#5a1a10", edgeW: 8 }));
  }).tex;
}

/** banner cloth cells (vertical cloth, lettering rotated to read top-to-bottom along the length) */
function bannerAtlas(): THREE.CanvasTexture {
  return canvasTex(1024, 512, "banners", (g) => {
    const cell = (i: number, bg: string, edge: string, txt: string, fill: string, size: number) => {
      const x = i * 256;
      g.fillStyle = bg; g.fillRect(x, 0, 256, 512);
      g.fillStyle = edge; g.fillRect(x, 0, 14, 512); g.fillRect(x + 242, 0, 14, 512); g.fillRect(x, 0, 256, 18); g.fillRect(x, 494, 256, 18);
      g.strokeStyle = edge; g.lineWidth = 3; g.strokeRect(x + 28, 32, 200, 448);
      brushText(g, txt, x + 128, 205, { size, maxW: 310, bold: 4, rot: Math.PI / 2, fill, edge: "rgba(0,0,0,0.45)", edgeW: 6, dry: 0.15 });
      // tattered hem
      g.globalCompositeOperation = "destination-out";
      for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(x + k * 44 + 6, 512); g.lineTo(x + k * 44 + 24, 512 - 18 - (k % 3) * 12); g.lineTo(x + k * 44 + 42, 512); g.fill(); }
      g.globalCompositeOperation = "source-over";
    };
    cell(0, "#a52a22", "#d9b032", "Fortune", "#f2d56a", 150);
    cell(1, "#26272d", "#c9a227", "Mist", "#efe6cf", 170);
    cell(2, "#3d7f6c", "#e6d49a", "Jiuzhou", "#f4ecd6", 150);
    cell(3, "#d8cdb0", "#7a1f1c", "Guard", "#1d1d22", 160);
  }).tex;
}

export const BANNER_CELL = { fu: 0, cloud: 1, jiuzhou: 2, guard: 3 } as const;

export class Signage {
  private bp: number[] = []; private bu: number[] = []; private bn: number[] = []; private bi: number[] = [];
  private lp: number[] = []; private lu: number[] = []; private li: number[] = [];
  private np: number[] = []; private nu: number[] = []; private ni: number[] = []; private nph: number[] = [];

  /** Board centred at (x,y,z), facing direction (sin yaw, 0, cos yaw). Both faces are emitted (second face reads correctly from behind). */
  board(key: keyof typeof BOARD, x: number, y: number, z: number, w: number, h: number, yaw: number, o: { tilt?: number; both?: boolean; off?: number } = {}): this {
    const r = BOARD[key];
    const pad = 6;
    const u0 = (r.x + pad) / AW, u1 = (r.x + r.w - pad) / AW, v1 = 1 - (r.y + pad) / AH, v0 = 1 - (r.y + r.h - pad) / AH;
    const off = o.off ?? 0.03;
    const faces = o.both === false ? [0] : [0, Math.PI];
    for (const f of faces) {
      const a = yaw + f;
      const nx = Math.sin(a), nz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
      const t = o.tilt ?? 0, cr = Math.cos(t), sr = Math.sin(t) * (f ? -1 : 1);
      const corner = (sx: number, sy: number): [number, number, number] => {
        const rxp = sx * (w / 2), up = sy * (h / 2);
        const R = rxp * cr - up * sr, U = rxp * sr + up * cr;
        return [x + rx * R + nx * off, y + U, z + rz * R + nz * off];
      };
      const base = this.bp.length / 3;
      const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      for (const p of pts) { this.bp.push(p[0], p[1], p[2]); this.bn.push(nx, 0, nz); }
      this.bu.push(u0, v0, u1, v0, u1, v1, u0, v1);
      this.bi.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /** word quads on all four sides of a lantern of radius r at (x,y,z) */
  lanternSign(x: number, y: number, z: number, r: number, glyph: 0 | 1 | 2, yaw = 0): this {
    const u0 = glyph / 3 + 0.01, u1 = (glyph + 1) / 3 - 0.01;
    for (let k = 0; k < 4; k++) {
      const a = yaw + (k * Math.PI) / 2;
      const nx = Math.sin(a), nz = Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
      const d = r * 0.97, hw = r * 0.62, hh = r * 0.4;
      const base = this.lp.length / 3;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) this.lp.push(x + nx * d + rx * sx * hw, y + sy * hh, z + nz * d + rz * sx * hw);
      this.lu.push(u0, 0.02, u1, 0.02, u1, 0.98, u0, 0.98);
      this.li.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /** hanging banner (top edge at y, hangs down h) */
  banner(x: number, y: number, z: number, w: number, h: number, yaw: number, cell: number): this {
    const u0 = cell * 0.25 + 0.003, u1 = cell * 0.25 + 0.247;
    const nx = Math.sin(yaw), nz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const SEG = 6;
    for (const face of [0, 1]) {
      const base = this.np.length / 3;
      const o = face ? -0.03 : 0.0;
      for (let j = 0; j <= SEG; j++) {
        const t = j / SEG;
        for (const sx of [-1, 1]) { this.np.push(x + rx * sx * w / 2 + nx * o, y - t * h, z + rz * sx * w / 2 + nz * o); this.nph.push(t); }
        if (face) this.nu.push(u1, 1 - t, u0, 1 - t); else this.nu.push(u0, 1 - t, u1, 1 - t);
      }
      for (let j = 0; j < SEG; j++) { const a = base + j * 2; if (face) this.ni.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else this.ni.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    void nx; void nz;
    return this;
  }

  build(parent: THREE.Object3D): { update(t: number): void } {
    const uniforms = { uTime: { value: 0 } };
    const mk = (pos: number[], uv: number[], idx: number[], normals?: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      if (normals) g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      g.setIndex(idx);
      return g;
    };
    if (this.bp.length) {
      const m = new THREE.Mesh(mk(this.bp, this.bu, this.bi, this.bn), new THREE.MeshToonMaterial({ map: boardAtlas(), gradientMap: toonGradient() }));
      m.name = "signage_boards"; parent.add(m);
    }
    if (this.lp.length) {
      const g = mk(this.lp, this.lu, this.li);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: lanternAtlas(), transparent: true, alphaTest: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.name = "signage_lanterns"; m.renderOrder = 2; parent.add(m);
    }
    if (this.np.length) {
      const g = mk(this.np, this.nu, this.ni);
      g.setAttribute("aT", new THREE.Float32BufferAttribute(this.nph, 1));
      const mat = new THREE.MeshBasicMaterial({ map: bannerAtlas(), transparent: true, alphaTest: 0.5 });
      mat.onBeforeCompile = (s) => {
        s.uniforms.uTime = uniforms.uTime;
        s.vertexShader = s.vertexShader
          .replace("#include <common>", "#include <common>\nattribute float aT; uniform float uTime;")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            float wv = sin(uTime * 1.7 + position.x * 0.8 + position.z * 0.6 + aT * 3.0) * 0.22 + sin(uTime * 3.1 + aT * 5.0 + position.x) * 0.06;
            transformed.x += wv * aT * aT; transformed.z += cos(uTime * 1.3 + position.x * 0.5 + aT * 2.0) * 0.16 * aT * aT;
            transformed.y += abs(wv) * -0.05 * aT;`);
      };
      mat.customProgramCacheKey = () => "banner";
      const m = new THREE.Mesh(g, mat);
      m.name = "signage_banners"; m.frustumCulled = false; parent.add(m);
    }
    return { update(t: number) { uniforms.uTime.value = t; } };
  }
}
