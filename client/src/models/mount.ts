// 0.5.0 spirit-sword mount: a flying jian the player stands on. Procedural, ink-and-vermilion palette:
// a pale jade-steel leaf blade with an ink-edged hull, a gold guard, an ink-wrapped hilt with a vermilion tassel,
// a soft jade under-glow and a faint additive trail that only really shows while the rider is travelling.
// The static sword is baked into one toon mesh + one ink hull (2 draw calls per mounted player); the glow/trail
// are 4 additive quads. Everything is local to the avatar root: origin = the rider's feet plane, +z = forward.
import * as THREE from "three";
import { PAL, hex } from "../world/toon";
import { bake, glowPart, part } from "./common";

export interface SpiritSwordMount {
  /** attach under the player avatar root (local units; origin = feet plane, +z = forward) */
  root: THREE.Group;
  /** per-frame hover bob, glow pulse and trail fade; `moving` = the rider is travelling this frame */
  update(dt: number, moving: boolean): void;
}

/** Soft radial glow (shared by every mount's under-glow quad). */
let glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, "rgba(255,255,248,0.95)");
  gr.addColorStop(0.35, "rgba(186,236,214,0.55)");
  gr.addColorStop(0.72, "rgba(120,190,170,0.18)");
  gr.addColorStop(1, "rgba(120,190,170,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Soft streak that fades toward its far (-z) end, used for the faint speed trail behind the blade. */
let streakTex: THREE.CanvasTexture | null = null;
function streakTexture(): THREE.CanvasTexture {
  if (streakTex) return streakTex;
  const cv = document.createElement("canvas"); cv.width = 64; cv.height = 128;
  const g = cv.getContext("2d")!;
  const lin = g.createLinearGradient(0, 0, 0, 128);
  lin.addColorStop(0, "rgba(255,255,250,0.9)");   // near the blade (v=0 -> +z edge)
  lin.addColorStop(0.35, "rgba(205,238,224,0.5)");
  lin.addColorStop(1, "rgba(150,205,190,0)");     // far tail
  g.fillStyle = lin; g.fillRect(0, 0, 64, 128);
  // taper the sides so the streak reads as a swipe, not a rectangle
  g.globalCompositeOperation = "destination-in";
  const side = g.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, "rgba(0,0,0,0)"); side.addColorStop(0.5, "rgba(0,0,0,1)"); side.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = side; g.fillRect(0, 0, 64, 128);
  streakTex = new THREE.CanvasTexture(cv);
  streakTex.colorSpace = THREE.SRGBColorSpace;
  return streakTex;
}

/** Additive transparent quad helper (per-mount material so fading/disposal never touch another mount). */
function additiveQuad(w: number, h: number, tex: THREE.Texture, color: number, opacity: number): THREE.Mesh {
  const m = new THREE.MeshBasicMaterial({
    map: tex, color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.rotation.x = -Math.PI / 2; // lie flat, local -z = behind the rider
  mesh.userData.mountOwnMaterial = true;
  mesh.renderOrder = 4;
  return mesh;
}

/**
 * Build one spirit jian. `hover` is the avatar lift (world units) used by the entity layer while mounted: the
 * under-glow is placed at `-hover` in avatar-local space so it stays on the ground beneath the floating blade.
 */
export function spiritSwordMount(hover = 0.62): SpiritSwordMount {
  const root = new THREE.Group();
  root.name = "spiritJianMount";
  root.scale.setScalar(1.12); // a touch oversized so the blade reads under the wide robe from the gameplay camera

  // ---- static blade (baked into 1 toon mesh + 1 ink hull) ----
  const steel = hex(PAL.jade, PAL.paper, 0.62).getHex();
  const steelEdge = hex(PAL.mist, PAL.paper, 0.45).getHex();
  const jadeGlow = hex(PAL.jade, PAL.paper, 0.78).getHex();
  const pale = PAL.paper, gold = PAL.gold, ink = PAL.inkSoft;

  // flat leaf blade: a long slab + a flattened 4-sided tip
  const blade = part(new THREE.BoxGeometry(0.2, 0.055, 1.3), steel, 0.03); blade.position.set(0, 0, 0.35); root.add(blade);
  const tipGeo = new THREE.ConeGeometry(0.112, 0.52, 4);
  tipGeo.rotateX(Math.PI / 2); // apex points +z
  const tip = part(tipGeo, steelEdge, 0.03); tip.scale.set(1, 0.5, 1); tip.position.set(0, 0, 1.25); root.add(tip);
  // raised ricasso wedge where the blade meets the guard
  const ricasso = part(new THREE.BoxGeometry(0.24, 0.07, 0.22), steelEdge, 0.03); ricasso.position.set(0, 0, -0.26); root.add(ricasso);
  // the glowing centre ridge along the fuller (pulses via the bake handle's glow)
  const ridge = glowPart(new THREE.BoxGeometry(0.035, 0.012, 1.02), jadeGlow, 0.95); ridge.position.set(0, 0.034, 0.42); root.add(ridge);
  const edgeL = glowPart(new THREE.BoxGeometry(0.014, 0.01, 0.9), pale, 0.55); edgeL.position.set(-0.095, 0.03, 0.32); root.add(edgeL);
  const edgeR = edgeL.clone(); edgeR.position.x = 0.095; root.add(edgeR);
  // gold guard with two swept cloud wings
  const guard = part(new THREE.BoxGeometry(0.5, 0.085, 0.13), gold, 0.025); guard.position.set(0, 0, -0.38); root.add(guard);
  for (const s of [-1, 1]) {
    const wing = part(new THREE.BoxGeometry(0.3, 0.045, 0.1), gold, 0.025);
    wing.position.set(s * 0.3, 0, -0.44); wing.rotation.y = s * 0.42; root.add(wing);
    const curl = part(new THREE.BoxGeometry(0.14, 0.04, 0.06), gold, 0.02);
    curl.position.set(s * 0.42, 0.01, -0.52); curl.rotation.y = s * 0.9; root.add(curl);
  }
  // ink-wrapped hilt with two gold bands, pommel and a vermilion tassel
  const hiltGeo = new THREE.CylinderGeometry(0.052, 0.058, 0.42, 7); hiltGeo.rotateX(Math.PI / 2);
  const hilt = part(hiltGeo, ink, 0.022); hilt.position.set(0, 0, -0.66); root.add(hilt);
  for (const z of [-0.5, -0.84]) {
    const bandGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.035, 8); bandGeo.rotateX(Math.PI / 2);
    const band = part(bandGeo, gold, 0.02); band.position.set(0, 0, z); root.add(band);
  }
  const pommel = part(new THREE.SphereGeometry(0.065, 8, 6), gold, 0.02); pommel.position.set(0, 0, -0.9); root.add(pommel);
  for (let i = 0; i < 3; i++) {
    const strand = part(new THREE.BoxGeometry(0.022, 0.24 - i * 0.04, 0.022), PAL.vermilion, 0.01);
    strand.position.set((i - 1) * 0.045, -0.15, -0.9); strand.rotation.z = (i - 1) * 0.18; strand.rotation.x = 0.08;
    root.add(strand);
  }
  const hnd = bake(root, 0.34);

  // ---- additive glow / trail (added after bake so they stay separate, cheap quads) ----
  const halo = additiveQuad(2.5, 1.35, glowTexture(), hex(PAL.jade, PAL.paper, 0.65).getHex(), 0.16);
  halo.position.set(0, -hover + 0.03, 0.25); // on the ground under the floating blade
  halo.renderOrder = 3;
  root.add(halo);

  const trail: THREE.Mesh[] = [];
  const trailTint = hex(PAL.jade, PAL.paper, 0.5).getHex();
  for (let i = 0; i < 3; i++) {
    const q = additiveQuad(0.62 - i * 0.12, 1.5 + i * 0.55, streakTexture(), trailTint, 0.05);
    q.position.set(0, -0.02, -0.85 - i * 0.95);
    root.add(q);
    trail.push(q);
  }

  const baseY = -0.05; // blade top sits just under the rider's feet (the entity layer lifts the avatar by `hover`)
  let t = 0, speedAmt = 0;
  root.position.y = baseY;
  return {
    root,
    update(dt: number, moving: boolean) {
      t += dt;
      speedAmt += ((moving ? 1 : 0) - speedAmt) * Math.min(1, dt * 5);
      // hover: slow bob + a little bank; the whole group moves under the lifted rider
      root.position.y = baseY + Math.sin(t * 2.1) * 0.028 + speedAmt * 0.02;
      root.rotation.x = -0.05 * speedAmt + Math.sin(t * 2.4) * 0.012;
      root.rotation.z = Math.sin(t * 1.6) * 0.02;
      // blade glow breathes, flares with speed
      hnd.glow.value = 0.55 + 0.2 * Math.sin(t * 3.1) + 0.35 * speedAmt;
      // ground halo breathes and brightens while travelling
      const hm = halo.material as THREE.MeshBasicMaterial;
      hm.opacity = 0.13 + 0.05 * (0.5 + 0.5 * Math.sin(t * 2.2)) + 0.1 * speedAmt;
      const hs = 1 + 0.06 * Math.sin(t * 1.9) + 0.1 * speedAmt;
      halo.scale.set(hs, hs * 0.94, 1);
      // the faint streak: almost invisible at rest, brightens as the rider travels
      for (let i = 0; i < trail.length; i++) {
        const m = trail[i].material as THREE.MeshBasicMaterial;
        const shimmer = 0.75 + 0.25 * Math.sin(t * 9 + i * 1.7);
        m.opacity = (0.04 + 0.24 * speedAmt) * shimmer * (1 - i * 0.26);
        const sc = 0.9 + 0.18 * speedAmt + 0.03 * Math.sin(t * 6 + i);
        trail[i].scale.set(1 + 0.1 * speedAmt, sc, 1);
      }
    },
  };
}

/** Release one mount: its quads use per-mount materials, the baked body uses a per-mount merged material. */
export function disposeSpiritSwordMount(m: SpiritSwordMount) {
  m.root.removeFromParent();
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry) return;
    mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[];
    const own = mesh.userData.mountOwnMaterial === true || mesh.name === "baked";
    if (own) for (const mm of Array.isArray(mat) ? mat : [mat]) mm.dispose();
  });
  m.root.clear();
}
