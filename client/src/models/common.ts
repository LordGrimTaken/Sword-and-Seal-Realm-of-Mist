// Shared helpers for procedural avatars: shadow blob, skinned bake (1 body draw + 1 ink-hull draw per avatar),
// glow/rim material, dissolve-into-ink-motes on death, state machine base.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toon, toonGradient, hullGeometry, bakedOutlineMaterial } from "../world/toon";

export type AvState = "idle" | "move" | "attack" | "dead";
export type Avatar = {
  root: THREE.Group;
  setState(st: AvState): void;
  update(dt: number): void;
  /** optional boss phase hint (3 = cracked open, white-hot runes); called every frame by the entity layer */
  setPhase?(n: number): void;
  height: number;
};

export const ease = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export function damp(cur: number, target: number, k: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-k * dt));
}

let blobMat: THREE.MeshBasicMaterial | null = null;
let blobGeo: THREE.PlaneGeometry | null = null;
export function shadowBlob(radius: number): THREE.Mesh {
  if (!blobMat) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 64;
    const g = cv.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, "rgba(26,26,31,0.6)"); gr.addColorStop(0.6, "rgba(26,26,31,0.3)"); gr.addColorStop(1, "rgba(26,26,31,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    blobMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    blobGeo = new THREE.PlaneGeometry(2, 2);
    blobGeo.rotateX(-Math.PI / 2);
  }
  const m = new THREE.Mesh(blobGeo!, blobMat);
  m.scale.setScalar(radius);
  m.position.y = 0.05;
  m.renderOrder = 1;
  m.name = "shadow";
  return m;
}

/** a rig node. Bones double as animation groups: all parts under them are skinned into ONE mesh at bake time. */
export const node = (): THREE.Bone => new THREE.Bone();

interface BakeInfo { color: number; outline: number; glow: number; vc: boolean }
/** a toon part; outline thickness is recorded and merged by bake() */
export function part(g: THREE.BufferGeometry, color: number, outline = 0.022, _o: unknown = {}): THREE.Mesh {
  const m = new THREE.Mesh(g, toon(0xffffff));
  m.userData.bake = { color, outline, glow: 0, vc: false } as BakeInfo;
  return m;
}
/** an unlit self-illuminated part (eyes, runes, flames). `k` = glow weight 0..1 (multiplied by the avatar's pulse). */
export function glowPart(g: THREE.BufferGeometry, color: number, k = 1): THREE.Mesh {
  const m = new THREE.Mesh(g, toon(0xffffff));
  m.userData.bake = { color, outline: 0, glow: k, vc: false } as BakeInfo;
  return m;
}
/**
 * Optional per-part skinning hook for bake(): called with the part's baked (root-space) geometry, then for its ink hull, and
 * the bone-index lookup (bone -> index in the final skeleton). Lets one continuous mesh (e.g. a snake tube) blend between bones
 * instead of being rigidly bound to one.
 */
export type SkinFn = (g: THREE.BufferGeometry, boneIndex: (b: THREE.Object3D) => number) => void;
/** a part whose geometry already carries a `color` attribute */
export function vcPart(g: THREE.BufferGeometry, outline = 0.02, glow = 0): THREE.Mesh {
  const m = new THREE.Mesh(g, toon(0xffffff));
  m.userData.bake = { color: 0xffffff, outline, glow, vc: true } as BakeInfo;
  return m;
}

export interface BakeHandle {
  /** global pulse for glow parts (set 0 to switch every glow off) */
  glow: { value: number };
  skinned: THREE.SkinnedMesh;
  hull: THREE.SkinnedMesh | null;
}

function stripTo(g: THREE.BufferGeometry, keep: string[]): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
  return g;
}

function avatarMaterial(glow: { value: number }, rim: number): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), vertexColors: true });
  m.onBeforeCompile = (s) => {
    s.uniforms.uGlow = glow;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow; varying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow; uniform float uGlow;")
      .replace("#include <opaque_fragment>", `
        float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.4);
        outgoingLight += vec3(1.0, 0.9, 0.74) * rimF * ${rim.toFixed(2)} * (1.0 - vGlow);
        outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.4, clamp(vGlow * uGlow, 0.0, 1.0));
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => "avatarBaked" + rim.toFixed(2);
  return m;
}

/**
 * Collapse every part()/glowPart()/vcPart() mesh under `root` into ONE SkinnedMesh (+ ONE skinned ink hull).
 * Each part is bound 100% to its nearest `node()` ancestor, so animating those nodes (rotation/position/scale)
 * deforms the single mesh. Call once, with the rig in its rest pose.
 */
export function bake(root: THREE.Object3D, rim = 0.3): BakeHandle {
  const rootBone = new THREE.Bone(); rootBone.name = "rootBone";
  root.add(rootBone);
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bones: THREE.Bone[] = [rootBone];
  root.traverse((o) => { if ((o as THREE.Bone).isBone && o !== rootBone) bones.push(o as THREE.Bone); });
  const idx = new Map<THREE.Object3D, number>(); bones.forEach((b, i) => idx.set(b, i));
  const parts: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.bake) parts.push(m); });

  const geos: THREE.BufferGeometry[] = [], hulls: THREE.BufferGeometry[] = [];
  const tmp = new THREE.Matrix4();
  const skinAttrs = (g: THREE.BufferGeometry, bi: number) => {
    const n = g.getAttribute("position").count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  };
  for (const k of parts) {
    const info = k.userData.bake as BakeInfo;
    let b: THREE.Object3D | null = k.parent;
    while (b && !(b as THREE.Bone).isBone) b = b.parent;
    const bi = b ? idx.get(b) ?? 0 : 0;
    k.updateWorldMatrix(true, false);
    tmp.multiplyMatrices(rootInv, k.matrixWorld);
    const keep = info.vc ? ["position", "normal", "color"] : ["position", "normal"];
    const geo = stripTo(k.geometry.index ? k.geometry.toNonIndexed() : k.geometry.clone(), keep);
    geo.applyMatrix4(tmp);
    const n = geo.getAttribute("position").count;
    if (!info.vc) {
      const c = new THREE.Color(info.color);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    geo.setAttribute("aGlow", new THREE.BufferAttribute(new Float32Array(n).fill(info.glow), 1));
    const skinFn = k.userData.skinFn as SkinFn | undefined;
    if (skinFn) skinFn(geo, (o) => idx.get(o) ?? 0); else skinAttrs(geo, bi);
    geos.push(geo);
    if (info.outline > 0) {
      const hl = hullGeometry(k.geometry);
      const h = stripTo(hl.index ? hl.toNonIndexed() : hl.clone(), ["position", "normal"]);
      h.applyMatrix4(tmp);
      const hn = h.getAttribute("position").count;
      h.setAttribute("aThick", new THREE.BufferAttribute(new Float32Array(hn).fill(info.outline), 1));
      if (skinFn) skinFn(h, (o) => idx.get(o) ?? 0); else skinAttrs(h, bi);
      hulls.push(h);
    }
    k.parent?.remove(k);
  }
  const glow = { value: 1 };
  const merged = mergeGeometries(geos, false)!;
  merged.computeBoundingSphere();
  if (merged.boundingSphere) merged.boundingSphere.radius *= 1.5;
  const skinned = new THREE.SkinnedMesh(merged, avatarMaterial(glow, rim));
  skinned.name = "baked";
  const skeleton = new THREE.Skeleton(bones);
  root.add(skinned);
  root.updateMatrixWorld(true);
  skinned.bind(skeleton, skinned.matrixWorld);
  let hull: THREE.SkinnedMesh | null = null;
  if (hulls.length) {
    const hg = mergeGeometries(hulls, false)!;
    hg.computeBoundingSphere();
    if (hg.boundingSphere) hg.boundingSphere.radius *= 1.5;
    hull = new THREE.SkinnedMesh(hg, bakedOutlineMaterial());
    hull.name = "outline";
    root.add(hull);
    hull.bind(skeleton, hull.matrixWorld);
  }
  return { glow, skinned, hull };
}

/** ink-dissolve: swaps meshes to per-avatar cloned materials with a dithered fade uniform, and releases ink motes */
export class Dissolve {
  uniform = { value: 1 };
  private orig = new Map<THREE.Mesh, THREE.Material>();
  private clones = new Map<THREE.Material, THREE.Material>();
  active = false;
  private motes: THREE.Points | null = null;
  private moteSeed: Float32Array | null = null;
  private moteTime = 0;
  constructor(private root: THREE.Object3D) {}
  private patch(m: THREE.Material): THREE.Material {
    let c = this.clones.get(m);
    if (c) return c;
    c = m.clone();
    const u = this.uniform;
    const prev = (m as THREE.Material & { onBeforeCompile?: (s: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => void }).onBeforeCompile;
    c.onBeforeCompile = (s, r) => {
      if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(s, r);
      s.uniforms.uFade = u;
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uFade;")
        .replace("void main() {", "void main() {\n if (uFade < 0.999) { vec2 q = floor(gl_FragCoord.xy * 0.5); float n = fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); if (n > uFade) discard; }\n");
    };
    const key = (m.customProgramCacheKey ? m.customProgramCacheKey() : "") + "|dissolve";
    c.customProgramCacheKey = () => key;
    this.clones.set(m, c);
    return c;
  }
  private makeMotes(): void {
    const box = new THREE.Box3().setFromObject(this.root);
    const sz = box.getSize(new THREE.Vector3());
    const N = 90;
    const base = new Float32Array(N * 3), seed = new Float32Array(N * 4);
    const rx = Math.max(0.3, sz.x * 0.35), rz = Math.max(0.3, sz.z * 0.35), hh = Math.max(0.8, sz.y);
    for (let i = 0; i < N; i++) {
      base.set([(Math.random() - 0.5) * 2 * rx, Math.random() * hh, (Math.random() - 0.5) * 2 * rz], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uT: { value: 0 }, uPx: { value: 500 }, uS: { value: Math.max(0.6, hh / 2) } },
      vertexShader: `attribute vec4 aSeed; uniform float uT; uniform float uPx; uniform float uS; varying float vA; varying float vK;
        void main(){
          float t = uT; vec3 p = position;
          p.y += t * (0.5 + aSeed.x * 1.6) * uS; p.x += sin(t * 3.0 + aSeed.y * 20.0) * 0.25 * t * uS; p.z += cos(t * 2.6 + aSeed.z * 20.0) * 0.25 * t * uS;
          vA = (1.0 - smoothstep(0.35 + aSeed.w * 0.4, 1.0, t)) * smoothstep(0.0, 0.1, t); vK = aSeed.w;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((0.12 + aSeed.z * 0.18) * uS * projectionMatrix[1][1] * uPx / max(-mv.z, 0.1), 1.0, 60.0);
        }`,
      fragmentShader: `varying float vA; varying float vK; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; float a = smoothstep(1.0, 0.55, d) * vA; if (a < 0.02) discard;
        vec3 col = mix(vec3(0.10, 0.10, 0.12), vec3(0.78, 0.22, 0.18), step(0.9, vK)); gl_FragColor = vec4(col, a * 0.9); }`,
    });
    this.motes = new THREE.Points(g, m);
    this.motes.frustumCulled = false; this.motes.visible = false; this.motes.renderOrder = 6;
    this.motes.onBeforeRender = (r) => { const sz = r.getDrawingBufferSize(new THREE.Vector2()); m.uniforms.uPx.value = sz.y * 0.5; };
    this.root.add(this.motes);
  }
  begin(): void {
    if (this.active) return;
    this.active = true;
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.name !== "shadow") { this.orig.set(mesh, mesh.material as THREE.Material); mesh.material = this.patch(mesh.material as THREE.Material); }
    });
    if (!this.motes) this.makeMotes();
    this.moteTime = 0;
    if (this.motes) this.motes.visible = true;
  }
  set(f: number): void {
    this.uniform.value = f;
    if (this.motes) { this.motes.visible = this.active && f < 0.999; (this.motes.material as THREE.ShaderMaterial).uniforms.uT.value = 1 - f; }
  }
  end(): void {
    if (!this.active) return;
    this.active = false;
    this.orig.forEach((m, mesh) => { mesh.material = m; });
    this.orig.clear();
    this.uniform.value = 1;
    if (this.motes) this.motes.visible = false;
  }
}

/** state tracker with smooth blends used by all rigs */
export class Anim {
  t = 0; state: AvState = "idle"; stateT = 0;
  move = 0; atk = 0; dead = 0;
  setState(s: AvState) { if (s !== this.state) { this.state = s; this.stateT = 0; } }
  tick(dt: number) {
    this.t += dt; this.stateT += dt;
    this.move = damp(this.move, this.state === "move" ? 1 : 0, 12, dt);
    this.atk = damp(this.atk, this.state === "attack" ? 1 : 0, 18, dt);
    this.dead = this.state === "dead" ? clamp01(this.dead + dt / 0.7) : 0;
  }
}
