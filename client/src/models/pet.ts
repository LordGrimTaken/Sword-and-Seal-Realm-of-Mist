// Cosmetic spirit companion: a little paper-lantern wisp with fox ears that drifts after the local player.
// Purely client-side and ambient - it is never sent over the network, cannot be targeted and has no combat effect.
// Built with the same part()/glowPart()/bake() pipeline as the mobs, so the whole pet is ONE skinned body draw
// plus ONE ink-outline draw; a soft additive halo and a handful of additive motes add two more draws at most.
import * as THREE from "three";
import { PAL, hex } from "../world/toon";
import { bake, glowPart, node, part, type BakeHandle } from "./common";

const hx = (a: number, b: number, t: number) => hex(a, b, t).getHex();
const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x = 0, y = 0, z = 0): T => {
  o.position.set(x, y, z);
  parent.add(o);
  return o;
};
/** Frame-rate independent ease toward a target: no snapping, no frame-rate dependence. */
const damp = (cur: number, target: number, k: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-k * dt));
/** Shortest-path angle damping so the pet never spins the long way round when the player turns. */
function dampAngle(cur: number, target: number, k: number, dt: number): number {
  const delta = ((target - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return cur + delta * (1 - Math.exp(-k * dt));
}

/** Warm paper-lantern light: one radial canvas texture, shared by the halo sprite and the trailing motes. */
function glowTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  gr.addColorStop(0, "rgba(255, 246, 214, 1)");
  gr.addColorStop(0.35, "rgba(255, 214, 130, 0.55)");
  gr.addColorStop(1, "rgba(201, 162, 39, 0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PAPER = hx(PAL.paper, PAL.paperDark, 0.18);
const PAPER_DARK = hx(PAL.paper, PAL.paperDark, 0.5);
const GLOW = 0xffd27a; // lantern light
const TAIL_GLOW = 0x8fe6c8; // jade wisp tip
/** Follow target: slightly behind and to the player's right shoulder, this far above the ground. */
const BACK = 0.85, SIDE = 0.55, HOVER = 1.5;
/** Number of drifting wisp motes around the companion (one Points draw). */
const N_MOTES = 7;

export interface PetDebug {
  enabled: boolean;
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** current body bob offset (0 under reduced motion) and glow pulse value, for motion checks */
  bob: number;
  glow: number;
}

/**
 * The spirit companion. Physical model + gentle animation only; the Game decides where the local player is and
 * calls update() once a frame. Toggling hides the group (no mesh is rebuilt), so switching it on and off is free.
 */
export class SpiritCompanion {
  readonly group = new THREE.Group();
  /** The baked skinned body + its glow uniform (glow parts pulse with this). */
  private readonly handle: BakeHandle;
  private readonly body: THREE.Bone;
  private readonly tail: THREE.Bone;
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly motes: THREE.Points;
  private readonly moteMat: THREE.PointsMaterial;
  private readonly motePos: Float32Array;
  private readonly moteAttr: THREE.BufferAttribute;
  private readonly texture: THREE.CanvasTexture;
  /** Top-level scene position of the pet (the model hangs a little above it). */
  private readonly pos = new THREE.Vector3();
  private yaw = 0;
  private time = 0;
  private started = false;
  private on = false;

  constructor() {
    this.group.name = "spirit-companion";
    this.group.visible = false;

    // --- procedural lantern-fox body, baked into one skinned mesh + one ink hull (2 draws) ---
    const rig = node();
    this.group.add(rig);
    this.body = node();
    rig.add(this.body);

    const shell = part(new THREE.SphereGeometry(0.2, 12, 9), PAPER, 0.022);
    shell.scale.set(1, 0.94, 1);
    this.body.add(shell);
    const belly = part(new THREE.SphereGeometry(0.17, 10, 8), PAPER_DARK, 0);
    belly.scale.set(0.82, 0.7, 0.9);
    add(this.body, belly, 0, -0.06, 0.01);
    // vermilion lacquer band around the lantern waist
    const band = part(new THREE.TorusGeometry(0.2, 0.012, 5, 16), PAL.vermilion, 0);
    band.rotation.x = Math.PI / 2;
    add(this.body, band, 0, 0.005, 0);
    // the lantern light spilling out of the bottom
    add(this.body, glowPart(new THREE.SphereGeometry(0.1, 10, 8), GLOW), 0, -0.17, 0.02);
    // fox-face glow slits
    for (const s of [-1, 1]) {
      const eye = glowPart(new THREE.BoxGeometry(0.055, 0.03, 0.02), GLOW);
      eye.rotation.z = -s * 0.32;
      add(this.body, eye, s * 0.065, 0.045, 0.185);
    }
    // fox ears, each with a glowing tip
    for (const s of [-1, 1]) {
      const ear = part(new THREE.ConeGeometry(0.07, 0.18, 5), hx(PAL.vermilion, PAL.paper, 0.3), 0.016);
      ear.rotation.z = -s * 0.24;
      ear.scale.z = 0.6;
      add(this.body, ear, s * 0.1, 0.27, -0.01);
      const tip = glowPart(new THREE.ConeGeometry(0.028, 0.07, 4), GLOW, 0.85);
      tip.rotation.z = -s * 0.24;
      add(this.body, tip, s * 0.115, 0.37, -0.01);
    }
    // crown flame leaning back in the wind
    const crown = glowPart(new THREE.ConeGeometry(0.05, 0.16, 5), hx(GLOW, PAL.vermilion, 0.25), 1);
    crown.rotation.x = 0.28;
    add(this.body, crown, 0, 0.34, -0.04);
    // ink-and-vermilion tail streamers
    this.tail = node();
    this.tail.position.set(0, -0.16, -0.16);
    this.body.add(this.tail);
    const tailCols = [hx(PAL.ink, PAL.inkSoft, 0.15), hx(PAL.ink, PAL.vermilion, 0.35), hx(PAL.vermilion, PAL.paper, 0.25)];
    tailCols.forEach((c, i) => {
      const puff = part(new THREE.SphereGeometry(0.075 - i * 0.02, 8, 6), c, 0.014);
      puff.scale.set(1, 1.25, 1);
      add(this.tail, puff, 0, -0.08 - i * 0.1, -0.02 - i * 0.03);
    });
    add(this.tail, glowPart(new THREE.SphereGeometry(0.045, 8, 6), TAIL_GLOW, 0.9), 0, -0.4, -0.11);

    this.handle = bake(this.group, 0.32);

    // --- soft additive halo + drifting motes (2 draws) ---
    this.texture = glowTexture();
    this.haloMat = new THREE.SpriteMaterial({
      map: this.texture, color: 0xffd9a0, transparent: true, opacity: 0.42,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.set(1.55, 1.55, 1);
    this.body.add(this.halo);

    const N = 7;
    this.motePos = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    this.moteAttr = new THREE.BufferAttribute(this.motePos, 3);
    geo.setAttribute("position", this.moteAttr);
    this.moteMat = new THREE.PointsMaterial({
      map: this.texture, color: 0xffe0a8, size: 0.11, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false, toneMapped: false,
    });
    this.motes = new THREE.Points(geo, this.moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
  }

  get enabled(): boolean { return this.on; }

  setEnabled(on: boolean) {
    this.on = on;
    this.group.visible = on;
    this.started = false; // re-appearing snaps straight to the player's shoulder instead of flying in from its old spot
  }

  /**
   * Follow the local player. `px/py/pz` is the player's feet position, `facing` their world yaw.
   * With reduced motion nothing bobs, breathes or orbits: the pet glides along at a fixed offset and glow.
   */
  update(dt: number, px: number, py: number, pz: number, facing: number, reduced: boolean) {
    if (!this.on) return;
    dt = Math.min(0.1, Math.max(0, dt));
    this.time += dt;
    const t = this.time;

    // behind the player's facing, a little to their right shoulder
    const tx = px - Math.sin(facing) * BACK + Math.cos(facing) * SIDE;
    const tz = pz - Math.cos(facing) * BACK - Math.sin(facing) * SIDE;
    const ty = py + HOVER;
    if (!this.started) {
      this.started = true;
      this.pos.set(tx, ty, tz);
      this.yaw = facing + Math.PI; // the spirit looks back at its cultivator
    } else {
      this.pos.x = damp(this.pos.x, tx, 4.5, dt);
      this.pos.z = damp(this.pos.z, tz, 4.5, dt);
      this.pos.y = damp(this.pos.y, ty, 6.5, dt);
      this.yaw = dampAngle(this.yaw, facing + Math.PI, 5, dt);
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    const an = reduced ? 0 : t; // frozen clock = no bobbing / pulsing / orbiting at all
    const bob = Math.sin(an * 1.9) * 0.07 + Math.sin(an * 0.63) * 0.02;
    this.body.position.y = bob;
    this.body.rotation.z = Math.sin(an * 1.15) * 0.07;
    this.body.rotation.x = Math.sin(an * 0.83 + 1.2) * 0.05;
    this.body.scale.setScalar(1 + Math.sin(an * 2.4) * 0.025);
    this.tail.rotation.x = 0.18 + Math.sin(an * 2.1) * 0.14;
    this.tail.rotation.y = Math.sin(an * 1.7) * 0.2;
    this.handle.glow.value = 0.8 + 0.2 * (0.5 - 0.5 * Math.cos(an * 2.4));
    this.haloMat.opacity = 0.36 + 0.12 * (0.5 - 0.5 * Math.cos(an * 2.4));
    this.halo.scale.setScalar(1.55 + 0.1 * Math.sin(an * 1.8));
    for (let i = 0; i < N_MOTES; i++) {
      const a = an * (0.55 + i * 0.04) + i * 2.399;
      const r = 0.3 + Math.sin(an * 1.1 + i) * 0.05;
      this.motePos[i * 3] = Math.cos(a) * r;
      this.motePos[i * 3 + 1] = 0.05 + Math.sin(an * 0.9 + i * 1.7) * 0.3;
      this.motePos[i * 3 + 2] = Math.sin(a) * r;
    }
    this.moteAttr.needsUpdate = true;
  }

  /** Read-only snapshot for the debug surface (window.__jz.pet) and UI checks. */
  debug(): PetDebug {
    return {
      enabled: this.on,
      visible: this.group.visible,
      x: +this.pos.x.toFixed(2),
      y: +this.pos.y.toFixed(2),
      z: +this.pos.z.toFixed(2),
      bob: +this.body.position.y.toFixed(4),
      glow: +this.handle.glow.value.toFixed(4),
    };
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    const bodyMat = this.handle.skinned.material;
    if (!Array.isArray(bodyMat)) bodyMat.dispose(); // the ink hull uses the shared baked outline material - leave it alone
    this.haloMat.dispose();
    this.moteMat.dispose();
    this.texture.dispose();
  }
}
