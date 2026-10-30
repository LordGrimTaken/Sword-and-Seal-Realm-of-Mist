// 0.5.0 treasure caches (client side): a small procedural ink-wash chest (lacquered wood + gold bands, hinged lid,
// a soft golden glow while it is openable) plus a ChestField that keeps one per server chest, follows its ready state
// (ready -> closed + glow, opened -> lid up, empty -> no glow, respawn -> closes again) and owns the "F Open cache"
// world prompt. Placement comes from the dedicated `chests` server message, never from the entity system.
import * as THREE from "three";
import type { ChestStateView } from "@shared/protocol";
import { PAL, hex } from "../world/toon";
import { bake, glowPart, node, part } from "./common";

/** Mirrors CHEST_OPEN_RANGE on the server (server/src/game/chests.ts): how close the player must stand. */
export const CHEST_OPEN_RANGE = 3.5;

export interface ChestModel {
  root: THREE.Group;
  /** Drive the lid + ready glow from the server state (called every frame). */
  update(dt: number, ready: boolean): void;
  dispose(): void;
}

/** Soft radial glow, shared by every chest's ground halo. */
let glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 3, 64, 64, 62);
  gr.addColorStop(0, "rgba(255,246,214,0.95)");
  gr.addColorStop(0.4, "rgba(255,214,138,0.5)");
  gr.addColorStop(0.75, "rgba(220,170,70,0.15)");
  gr.addColorStop(1, "rgba(220,170,70,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T => { o.position.set(x, y, z); parent.add(o); return o; };

/** One treasure cache: dark lacquered wood, gold strapping, a hasp with a glowing gem and a hinged lid. */
export function createChestModel(): ChestModel {
  const root = new THREE.Group();
  root.name = "treasureChest";
  const body = node(); root.add(body);

  const lacquer = hex(PAL.vermilion, PAL.ink, 0.62).getHex(); // deep lacquered red-brown
  const lacquerD = hex(PAL.ink, PAL.vermilion, 0.2).getHex();
  const gold = PAL.gold, pale = PAL.paper;

  // ---- static body ----
  add(body, part(new THREE.BoxGeometry(1.06, 0.14, 0.8), lacquerD, 0.03), 0, 0.07, 0); // plinth
  add(body, part(new THREE.BoxGeometry(0.98, 0.46, 0.72), lacquer, 0.035), 0, 0.37, 0);
  add(body, part(new THREE.BoxGeometry(1.04, 0.06, 0.78), gold, 0.02), 0, 0.61, 0); // gold rim
  // vertical gold straps (front / back / sides)
  for (const s of [-1, 1]) {
    add(body, part(new THREE.BoxGeometry(0.1, 0.46, 0.02), gold, 0.02), s * 0.3, 0.37, 0.365);
    add(body, part(new THREE.BoxGeometry(0.1, 0.46, 0.02), gold, 0.02), s * 0.3, 0.37, -0.365);
    add(body, part(new THREE.BoxGeometry(0.02, 0.46, 0.1), gold, 0.02), s * 0.495, 0.37, 0.22);
    add(body, part(new THREE.BoxGeometry(0.02, 0.46, 0.1), gold, 0.02), s * 0.495, 0.37, -0.22);
    // corner fittings
    add(body, part(new THREE.BoxGeometry(0.08, 0.14, 0.08), gold, 0.02), s * 0.45, 0.16, s * 0.31);
  }
  add(body, part(new THREE.BoxGeometry(0.16, 0.18, 0.03), gold, 0.02), 0, 0.5, 0.375); // hasp plate

  // ---- hinged lid (bone pivot at the back top edge, so animating the bone tilts the baked lid) ----
  const lid = node();
  lid.position.set(0, 0.62, -0.36);
  body.add(lid);
  add(lid, part(new THREE.BoxGeometry(0.98, 0.22, 0.72), lacquer, 0.035), 0, 0.11, 0.36);       // lid slab
  add(lid, part(new THREE.BoxGeometry(1.02, 0.05, 0.06), gold, 0.02), 0, 0.23, 0.70);            // front gold lip
  add(lid, part(new THREE.BoxGeometry(0.06, 0.24, 0.74), gold, 0.02), -0.46, 0.1, 0.36);         // side straps
  add(lid, part(new THREE.BoxGeometry(0.06, 0.24, 0.74), gold, 0.02), 0.46, 0.1, 0.36);
  for (const s of [-1, 1]) add(lid, part(new THREE.BoxGeometry(0.1, 0.03, 0.72), gold, 0.02), s * 0.3, 0.225, 0.36); // top straps
  add(lid, part(new THREE.BoxGeometry(0.18, 0.1, 0.04), gold, 0.02), 0, 0.02, 0.71);            // lock hasp (hangs over the front)
  const gem = glowPart(new THREE.OctahedronGeometry(0.055), 0xffe08a, 1);
  gem.scale.y = 1.5; add(lid, gem, 0, 0.07, 0.725);
  add(lid, part(new THREE.BoxGeometry(0.16, 0.03, 0.36), pale, 0.01), 0, 0.12, 0.52); // pale inlay stripe

  const hnd = bake(root, 0.42);

  // ---- additive bits (not baked): ground halo while ready, warm inner light while open ----
  const haloMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffd98a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.1), haloMat);
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03; halo.renderOrder = 3; halo.visible = false;
  root.add(halo);
  const innerMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffe7b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.56), innerMat);
  inner.rotation.x = -Math.PI / 2; inner.position.y = 0.6; inner.visible = false;
  root.add(inner);

  let t = Math.random() * 10, lidAngle = 0, openAmt = 0;
  return {
    root,
    update(dt: number, ready: boolean) {
      t += dt;
      const targetOpen = ready ? 0 : 1;
      openAmt += (targetOpen - openAmt) * Math.min(1, dt * 7);
      lidAngle = -1.92 * openAmt;
      lid.rotation.x = lidAngle;
      // glow: breathing when ready, dark once looted
      hnd.glow.value = ready ? 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.4)) : 0.04;
      halo.visible = ready;
      haloMat.opacity = ready ? 0.24 + 0.09 * (0.5 + 0.5 * Math.sin(t * 1.9)) : 0;
      const s = 1 + 0.05 * Math.sin(t * 1.7);
      halo.scale.set(s, s, 1);
      inner.visible = openAmt > 0.15;
      innerMat.opacity = Math.min(0.5, 0.55 * openAmt);
    },
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.geometry) return;
        mesh.geometry.dispose();
        if (mesh.name === "baked") (mesh.material as THREE.Material).dispose(); // per-chest merged material
      });
      haloMat.dispose(); innerMat.dispose();
      root.clear();
    },
  };
}

/** Keeps one ChestModel per server chest, drives closed/open/ready visuals and owns the F interact prompt. */
export class ChestField {
  readonly root = new THREE.Group();
  private readonly entries = new Map<number, { data: ChestStateView; model: ChestModel }>();
  private readonly prompt: HTMLElement;
  private readonly tmp = new THREE.Vector3();
  private hoverId = 0;

  constructor(private readonly scene: THREE.Scene, private readonly heightAt: (x: number, z: number) => number, hudRoot: HTMLElement) {
    this.root.name = "chestField";
    scene.add(this.root);
    this.prompt = document.createElement("div");
    this.prompt.id = "chestprompt";
    this.prompt.innerHTML = `<kbd>F</kbd> Open cache`;
    hudRoot.appendChild(this.prompt);
  }

  /** Apply the server `chests` message: creates models on first sight, then only follows ready/position. */
  setState(chests: ChestStateView[]) {
    if (!Array.isArray(chests)) return;
    const seen = new Set<number>();
    for (const c of chests) {
      if (!c || typeof c.id !== "number") continue;
      seen.add(c.id);
      const e = this.entries.get(c.id);
      if (e) { e.data = c; continue; }
      const model = createChestModel();
      model.root.position.set(c.x, this.heightAt(c.x, c.z), c.z);
      this.root.add(model.root);
      this.entries.set(c.id, { data: c, model });
    }
    for (const [id, e] of [...this.entries]) {
      if (seen.has(id)) continue;
      e.model.dispose();
      this.entries.delete(id);
    }
  }

  /** Id of a ready cache within reach of (x,z), else 0. */
  nearestReady(x: number, z: number): number {
    let best = 0, bd = CHEST_OPEN_RANGE;
    for (const [id, e] of this.entries) {
      if (!e.data.ready) continue;
      const d = Math.hypot(e.data.x - x, e.data.z - z);
      if (d <= bd) { bd = d; best = id; }
    }
    return best;
  }

  /** Per-frame: animate every chest, then show the F prompt over the nearest ready cache in reach. */
  update(dt: number, camera: THREE.PerspectiveCamera, px: number, pz: number, canInteract: boolean) {
    for (const e of this.entries.values()) e.model.update(dt, e.data.ready);
    const id = canInteract ? this.nearestReady(px, pz) : 0;
    this.hoverId = id;
    if (!id) { this.prompt.classList.remove("show"); return; }
    const e = this.entries.get(id)!;
    const y = this.heightAt(e.data.x, e.data.z);
    this.tmp.set(e.data.x, y + 1.15, e.data.z).project(camera);
    if (this.tmp.z > 1) { this.prompt.classList.remove("show"); return; }
    const W = window.innerWidth, H = window.innerHeight;
    this.prompt.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-this.tmp.y * 0.5 + 0.5) * H - 6).toFixed(1)}px) translate(-50%, -100%)`;
    this.prompt.classList.add("show");
  }

  /** Read-only snapshot for the debug surface (`window.__jz.state.chests`). */
  debug() {
    return [...this.entries.values()].map((e) => ({ id: e.data.id, x: e.data.x, z: e.data.z, ready: e.data.ready, hovered: e.data.id === this.hoverId }));
  }

  dispose() {
    this.prompt.remove();
    for (const e of this.entries.values()) e.model.dispose();
    this.entries.clear();
    this.scene.remove(this.root);
  }
}
