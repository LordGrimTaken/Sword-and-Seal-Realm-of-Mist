import * as THREE from "three";
import { Batch, type Xf } from "./batch";

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const sph = (r: number, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
export const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);

/**
 * Chinese curved-eave roof. hip=true: pyramid (pagoda), false: gable with ridge along X.
 * origin at eave level centre; ridge at y=rise; corners curl up by `curl`.
 */
export function roofGeom(hx: number, hz: number, rise: number, curl: number, hip: boolean, uvRep = 6, seg = 12, thick = 0.22): THREE.BufferGeometry {
  const n = seg + 1;
  const pos: number[] = [], uv: number[] = [];
  const idx: number[] = [];
  const topY = (u: number, v: number) => {
    const au = Math.abs(u), av = Math.abs(v);
    if (hip) {
      const m = Math.max(au, av);
      return rise * Math.pow(1 - m, 1.35) + curl * Math.pow(au * av, 2.0);
    }
    return rise * Math.pow(1 - av, 1.3) + curl * (Math.pow(av, 5) * 0.55 + Math.pow(au, 6) * 0.9);
  };
  for (let layer = 0; layer < 2; layer++) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = (i / seg) * 2 - 1, v = (j / seg) * 2 - 1;
      const y = topY(u, v) - (layer ? thick : 0);
      pos.push(u * hx, y, v * hz);
      uv.push((u * 0.5 + 0.5) * uvRep, (v * 0.5 + 0.5) * uvRep);
    }
  }
  const L = n * n;
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);              // top (faces up)
    idx.push(L + a, L + b, L + c, L + b, L + d, L + c); // bottom
  }
  // skirt on the four edges
  const edge = (arr: number[]) => {
    for (let k = 0; k < arr.length - 1; k++) {
      const a = arr[k], b = arr[k + 1];
      idx.push(a, L + a, b, b, L + a, L + b);
    }
  };
  const e0: number[] = [], e1: number[] = [], e2: number[] = [], e3: number[] = [];
  for (let i = 0; i < n; i++) { e0.push(i); e1.push((n - 1) * n + i); e2.push(i * n); e3.push(i * n + n - 1); }
  edge(e0); edge(e1); edge(e2); edge(e3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Wraps a Batch with a local origin + yaw so structures are authored in local coords. */
export class Local {
  constructor(public b: Batch, public ox: number, public oy: number, public oz: number, public yaw = 0) {}
  add(geo: THREE.BufferGeometry, key: string, t: Xf, color: THREE.Color | number, outline = false): this {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const p = t.p ?? [0, 0, 0];
    // rotation about Y by yaw: x' = x cos + z sin ; z' = -x sin + z cos
    const wx = this.ox + p[0] * c + p[2] * s, wz = this.oz - p[0] * s + p[2] * c;
    this.b.add(geo, key, { p: [wx, this.oy + p[1], wz], r: [t.r?.[0] ?? 0, (t.r?.[1] ?? 0) + this.yaw, t.r?.[2] ?? 0], s: t.s }, color, outline);
    return this;
  }
}

export function localVC(L: Local, geo: THREE.BufferGeometry, key: string, t: Xf, outline = false): void {
  const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
  const p = t.p ?? [0, 0, 0];
  const wx = L.ox + p[0] * c + p[2] * s, wz = L.oz - p[0] * s + p[2] * c;
  L.b.addVC(geo, key, { p: [wx, L.oy + p[1], wz], r: [t.r?.[0] ?? 0, (t.r?.[1] ?? 0) + L.yaw, t.r?.[2] ?? 0], s: t.s }, outline);
}

export function roofTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#e8e8e8"; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#9a9aa2"; g.lineWidth = 2;
  for (let r = 0; r < 4; r++) {
    const y = r * 16;
    g.beginPath(); g.moveTo(0, y + 1); g.lineTo(64, y + 1); g.stroke();
    for (let c = 0; c < 4; c++) { const x = c * 16 + (r % 2) * 8; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
  }
  g.fillStyle = "rgba(255,255,255,0.35)";
  for (let r = 0; r < 4; r++) g.fillRect(0, r * 16 + 4, 64, 3);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
