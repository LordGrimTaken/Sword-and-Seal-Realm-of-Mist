// Merges many small static pieces into very few draw calls (one per material key).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hullGeometry, outlineMaterial } from "./toon";

export interface Xf {
  p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function xf(t: Xf): THREE.Matrix4 {
  _e.set(t.r?.[0] ?? 0, t.r?.[1] ?? 0, t.r?.[2] ?? 0, "YXZ");
  _q.setFromEuler(_e);
  _v.set(t.p?.[0] ?? 0, t.p?.[1] ?? 0, t.p?.[2] ?? 0);
  if (typeof t.s === "number") _s.set(t.s, t.s, t.s); else _s.set(t.s?.[0] ?? 1, t.s?.[1] ?? 1, t.s?.[2] ?? 1);
  return _m.clone().compose(_v, _q, _s);
}

export class Batch {
  private groups = new Map<string, THREE.BufferGeometry[]>();
  private outlineGeos: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, key: string, t: Xf, color: THREE.Color | number, outline = false): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(xf(t));
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const n = g.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color") g.deleteAttribute(k);
    let arr = this.groups.get(key);
    if (!arr) this.groups.set(key, (arr = []));
    arr.push(g);
    if (outline) this.outlineGeos.push(g);
    return this;
  }
  /** like add() but keeps the geometry's own `color` attribute (per-face painted rocks etc.) */
  addVC(geo: THREE.BufferGeometry, key: string, t: Xf, outline = false): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(xf(t));
    const n = g.getAttribute("position").count;
    if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color") g.deleteAttribute(k);
    let arr = this.groups.get(key);
    if (!arr) this.groups.set(key, (arr = []));
    arr.push(g);
    if (outline) this.outlineGeos.push(g);
    return this;
  }
  /** build merged meshes and add to parent. outlineThick > 0 also builds one welded ink hull */
  build(parent: THREE.Object3D, mats: Record<string, THREE.Material>, outlineThick = 0): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [k, arr] of this.groups) {
      const merged = mergeGeometries(arr, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mats[k]);
      mesh.name = "batch_" + k;
      parent.add(mesh);
      out.push(mesh);
    }
    if (outlineThick > 0 && this.outlineGeos.length) {
      const pos = mergeGeometries(this.outlineGeos.map((g) => {
        const h = new THREE.BufferGeometry();
        h.setAttribute("position", g.getAttribute("position").clone());
        return h;
      }), false);
      if (pos) {
        const hull = new THREE.Mesh(hullGeometry(pos), outlineMaterial(outlineThick));
        hull.name = "batch_outline";
        parent.add(hull);
        out.push(hull);
      }
    }
    this.groups.clear();
    this.outlineGeos = [];
    return out;
  }
}
