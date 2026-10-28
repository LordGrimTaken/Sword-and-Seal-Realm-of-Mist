// Palette + toon / ink-outline material helpers (shared by world, models, vfx).
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const PAL = {
  ink: 0x1a1a1f, inkSoft: 0x3a3a44, paper: 0xf2ead8, paperDark: 0xd9cdb0,
  vermilion: 0xc8372d, jade: 0x4fa58b, gold: 0xc9a227, mist: 0x8fa3ad, mistLight: 0xcfd9dc,
} as const;

/** mix two hex colors, returns THREE.Color (linear working space) */
export function mixHex(a: number, b: number, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}
export function hex(a: number, b?: number, t = 0.5): THREE.Color {
  return b === undefined ? new THREE.Color(a) : mixHex(a, b, t);
}

let gradTex: THREE.DataTexture | null = null;
/** three tone bands (shadow / mid / light) */
export function toonGradient(): THREE.DataTexture {
  if (gradTex) return gradTex;
  const d = new Uint8Array([
    120, 124, 140, 255,
    190, 190, 196, 255,
    255, 252, 244, 255,
  ]);
  gradTex = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  gradTex.minFilter = gradTex.magFilter = THREE.NearestFilter;
  gradTex.generateMipmaps = false;
  gradTex.needsUpdate = true;
  return gradTex;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
export interface ToonOpts {
  emissive?: number; emissiveIntensity?: number; vertexColors?: boolean;
  side?: THREE.Side; transparent?: boolean; opacity?: number;
}
export function toon(color: number, o: ToonOpts = {}): THREE.MeshToonMaterial {
  const key = [color, o.emissive ?? -1, o.emissiveIntensity ?? 1, o.vertexColors ? 1 : 0, o.side ?? 0, o.opacity ?? 1].join("|");
  let m = toonCache.get(key);
  if (m) return m;
  m = new THREE.MeshToonMaterial({
    color, gradientMap: toonGradient(), vertexColors: !!o.vertexColors,
    side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
  if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  toonCache.set(key, m);
  return m;
}

// ---------- inverted hull outlines ----------
const outlineMats = new Map<string, THREE.MeshBasicMaterial>();
export function outlineMaterial(thick: number, color: number = PAL.ink): THREE.MeshBasicMaterial {
  const key = thick.toFixed(4) + "_" + color;
  let m = outlineMats.get(key);
  if (m) return m;
  m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace(
      "#include <begin_vertex>",
      `vec3 transformed = position + normalize(normal) * ${thick.toFixed(4)};`,
    );
  };
  m.customProgramCacheKey = () => "outline" + thick.toFixed(4);
  outlineMats.set(key, m);
  return m;
}

const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** geometry whose normals are smoothed (welded) so the hull has no cracks */
export function hullGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let h = hullCache.get(g);
  if (h) return h;
  h = new THREE.BufferGeometry();
  h.setAttribute("position", g.getAttribute("position"));
  if (g.index) h.setIndex(g.index);
  h = mergeVertices(h, 1e-3);
  h.computeVertexNormals();
  hullCache.set(g, h);
  return h;
}

/** add an ink outline child to a mesh. */
export function outlined<T extends THREE.Mesh>(mesh: T, thick = 0.03, color: number = PAL.ink): T {
  const o = new THREE.Mesh(hullGeometry(mesh.geometry), outlineMaterial(thick, color));
  o.name = "outline";
  o.matrixAutoUpdate = true;
  mesh.add(o);
  return mesh;
}

export function toonMesh(g: THREE.BufferGeometry, color: number, thick = 0.03, o: ToonOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(g, toon(color, o));
  if (thick > 0) outlined(m, thick);
  return m;
}

export function dispose(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}

let bakedOutline: THREE.MeshBasicMaterial | null = null;
/** outline material whose thickness comes from a per-vertex `aThick` attribute (used by merged avatars) */
export function bakedOutlineMaterial(): THREE.MeshBasicMaterial {
  if (bakedOutline) return bakedOutline;
  const m = new THREE.MeshBasicMaterial({ color: PAL.ink, side: THREE.BackSide });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aThick;")
      .replace("#include <begin_vertex>", "vec3 transformed = position + normalize(normal) * aThick;");
  };
  m.customProgramCacheKey = () => "bakedOutline";
  bakedOutline = m;
  return m;
}
