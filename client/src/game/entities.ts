import * as THREE from "three";
import type { EntityState } from "@shared/protocol";
import { createCharacterModel, createMobModel, createNpcModel, type Avatar } from "../art";
import { Track, INTERP_DELAY_MS } from "../net/interp";
import { spiritSwordMount, disposeSpiritSwordMount, type SpiritSwordMount } from "../models/mount";

/** Mob types that use the boss presentation (larger scale, bigger shadow, phase-3 model state). */
const BOSS_MOBS: ReadonlySet<string> = new Set(["stone_guardian", "mist_warden", "hollow_hierophant"]);

export interface Ent {
  id: number;
  s: EntityState;
  avatar: Avatar;
  track: Track;
  /** current render position (x,z) and facing */
  x: number;
  z: number;
  r: number;
  y: number;
  attackUntil: number;
  lastMoveAt: number;
  dead: boolean;
  /** baked body / ink-outline meshes, toggled by distance LOD to keep draw calls low */
  body: THREE.Object3D[];
  outline: THREE.Object3D[];
  shadow: THREE.Object3D[];
  lod: number;
  /** dodge roll in progress (performance.now() ms): the avatar somersaults forward about its middle */
  roll?: { start: number; dur: number };
  /** burn status VFX (server `burning` flag), created lazily on the first burn and hidden/reset when it ends */
  burn?: BurnCue;
  /** 0.5.0 spirit-sword mount (server `mounted` flag): the flying jian under the avatar (created lazily, reused) */
  mount?: SpiritSwordMount;
  /** smoothed avatar lift (world units) while mounted: the rider stands on the floating blade */
  lift: number;
}

/** Gameplay-camera readability: characters are scaled up modestly; height is updated so plates/rings follow. */
const SCALE = { player: 1.22, npc: 1.2, mob: 1.2, boss: 1.0 };

/** 0.5.0 spirit-sword mount: how far the rider is lifted above the ground so the jian floats under their feet. */
const MOUNT_LIFT = 0.62;
/** Shadow blobs are authored at this local height; while the rider is lifted it is pushed back down to the ground. */
const SHADOW_Y = 0.05;

/** Warm emissive tint of a burning body. */
const BURN_EMISSIVE = 0xff6a24;

/**
 * Per-entity burn cue: two additive flame sprites ride on the avatar while its baked body material glows warm.
 * Everything is created on the first burn and reused afterwards; `stopBurn` hides the sprites and restores the
 * captured emissive state, so the cue resets cleanly the moment the server stops sending `burning`.
 */
interface BurnCue {
  flame: THREE.Sprite;
  halo: THREE.Sprite;
  /** baked body material(s): the avatar's single skinned body mesh is tinted via its emissive channel */
  mats: THREE.MeshToonMaterial[];
  /** original emissive colour/intensity per body material, restored when the burn ends */
  emissive: number[];
  intensity: number[];
  /** rest pose of the sprites (size/height relative to the avatar's local height), restored on reset */
  base: { fw: number; fh: number; fy: number; hw: number; hh: number; hy: number };
  on: boolean;
  /** flicker clock since this burn started */
  t: number;
  seed: number;
}

let burnTex: THREE.Texture | null = null;

/** Shared soft ink-wash flame sprite: pale ember core, orange body, transparent wispy tip. */
function burnFlameTexture(): THREE.Texture {
  if (burnTex) return burnTex;
  const cv = document.createElement("canvas"); cv.width = 64; cv.height = 96;
  const g = cv.getContext("2d")!;
  // one teardrop tongue whose bottom spreads into a soft ember base
  const tongue = (top: number, bot: number, w: number): Path2D => {
    const h = bot - top, cx = 32, p = new Path2D();
    p.moveTo(cx, top);
    p.bezierCurveTo(cx + w * 0.42, top + h * 0.32, cx + w * 0.56, bot - h * 0.2, cx + w * 0.24, bot - h * 0.05);
    p.bezierCurveTo(cx + w * 0.1, bot, cx - w * 0.1, bot, cx - w * 0.24, bot - h * 0.05);
    p.bezierCurveTo(cx - w * 0.56, bot - h * 0.2, cx - w * 0.42, top + h * 0.32, cx, top);
    return p;
  };
  const body = g.createLinearGradient(0, 6, 0, 92);
  body.addColorStop(0, "rgba(255,84,26,0)");
  body.addColorStop(0.22, "rgba(255,100,32,0.55)");
  body.addColorStop(0.56, "rgba(255,156,54,0.92)");
  body.addColorStop(0.84, "rgba(255,212,108,1)");
  body.addColorStop(1, "rgba(255,246,212,1)");
  g.fillStyle = body; g.fill(tongue(4, 92, 58));
  g.globalCompositeOperation = "lighter";
  const core = g.createLinearGradient(0, 38, 0, 92);
  core.addColorStop(0, "rgba(255,190,90,0)");
  core.addColorStop(0.45, "rgba(255,232,150,0.8)");
  core.addColorStop(1, "rgba(255,255,238,1)");
  g.fillStyle = core; g.fill(tongue(38, 92, 30));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  burnTex = tex;
  return tex;
}

/** One additive flame sprite (shared texture, per-entity material so fading/disposal never touch another mob). */
function flameSprite(color: number, opacity: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: burnFlameTexture(), color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
  }));
  s.renderOrder = 5;
  return s;
}

function makeAvatar(s: EntityState): Avatar {
  let a: Avatar, k: number;
  if (s.k === "player") { a = createCharacterModel(s.cls ?? "sword"); k = SCALE.player; }
  else if (s.k === "mob") { a = createMobModel(s.mob ?? "bamboo_spirit"); k = BOSS_MOBS.has(s.mob ?? "") ? SCALE.boss : SCALE.mob; }
  else { a = createNpcModel(/\bFen\b/i.test(s.n) ? "keeper" : /\bTao\b/.test(s.n) ? "artisan" : /\bHao\b/.test(s.n) ? "peddler" : "elder"); k = SCALE.npc; }
  a.root.scale.setScalar(k);
  a.height *= k;
  return a;
}

/**
 * Free GPU resources owned by one avatar. Geometries are per-avatar (baked), so they are always disposed;
 * materials from the shared toon/outline caches and the shared shadow blob are left alone. Only per-avatar
 * textured materials (talisman paper, mob runes) and their canvas textures are released.
 */
function disposeAvatar(root: THREE.Object3D) {
  root.traverse((o) => {
    const obj = o as THREE.Mesh;
    if (!obj.geometry || obj.name === "shadow") return;
    obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      const mm = m as THREE.MeshBasicMaterial & THREE.ShaderMaterial;
      const key = m.customProgramCacheKey ? m.customProgramCacheKey() : "";
      const perAvatar = mm.isShaderMaterial || key.endsWith("|dissolve") || !!mm.map;
      if (!perAvatar) continue;
      mm.map?.dispose();
      m.dispose();
    }
  });
  root.clear();
}

export class EntityManager {
  readonly map = new Map<number, Ent>();
  private tmp = { x: 0, z: 0, r: 0 };
  private qTmp = new THREE.Quaternion();
  private vTmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private heightAt: (x: number, z: number) => number, private myId: () => number) {}

  applySnapshot(ents: EntityState[], gone: number[], now: number) {
    for (const id of gone) this.remove(id);
    for (const s of ents) {
      let e = this.map.get(s.id);
      if (!e) {
        const avatar = makeAvatar(s);
        this.scene.add(avatar.root);
        e = { id: s.id, s, avatar, track: new Track(), x: s.x, z: s.z, r: s.r, y: 0, attackUntil: 0, lastMoveAt: 0, dead: false, body: [], outline: [], shadow: [], lod: 0, lift: 0 };
        avatar.root.traverse((o) => { if (o.name === "outline") e!.outline.push(o); else if (o.name === "baked") e!.body.push(o); else if (o.name === "shadow") e!.shadow.push(o); });
        this.map.set(s.id, e);
        e.y = this.heightAt(s.x, s.z);
        avatar.root.position.set(s.x, e.y, s.z);
        avatar.root.rotation.order = "YXZ"; // yaw first, so the roll somersault (rotation.x) never disturbs the facing
        avatar.root.rotation.y = s.r;
      }
      e.s = s;
      e.track.push(now, s.x, s.z, s.r);
      // 0.5.0 spirit-sword mount: build the jian lazily on the first mounted snapshot and keep it for later rides
      const mounted = s.k === "player" && s.mounted === true;
      if (mounted && !e.mount) {
        e.mount = spiritSwordMount(MOUNT_LIFT);
        e.avatar.root.add(e.mount.root);
      }
      if (e.mount) e.mount.root.visible = mounted;
    }
  }

  remove(id: number) {
    const e = this.map.get(id);
    if (!e) return;
    this.scene.remove(e.avatar.root);
    if (e.burn) { this.disposeBurn(e.burn); e.burn = undefined; }
    if (e.mount) { disposeSpiritSwordMount(e.mount); e.mount = undefined; }
    disposeAvatar(e.avatar.root);
    this.map.delete(id);
  }

  /** Dodge roll: the avatar flips forward once over `durMs`. */
  startRoll(id: number, now: number, durMs: number) {
    const e = this.map.get(id);
    if (e && e.s.k === "player") e.roll = { start: now, dur: durMs };
  }

  markAttack(id: number, now: number) {
    const e = this.map.get(id);
    if (e) e.attackUntil = now + 450;
  }

  /** Build the flame cue once per entity: two additive sprites plus the baked body material(s) to tint. */
  private makeBurnCue(e: Ent): BurnCue {
    const k = Math.max(1e-3, e.avatar.root.scale.y);
    const h = e.avatar.height / k; // avatar height in root-local units (root is scaled by k)
    const flame = flameSprite(0xffd9a0, 0.9); flame.name = "burnFlame"; flame.renderOrder = 6;
    const halo = flameSprite(0xff6a26, 0.26); halo.name = "burnHalo";
    const base = { fw: h * 0.3, fh: h * 0.44, fy: h * 0.7, hw: h * 0.82, hh: h * 0.92, hy: h * 0.52 };
    flame.position.set(base.fw * 0.16, base.fy, 0);
    flame.scale.set(base.fw, base.fh, 1);
    halo.position.set(0, base.hy, 0);
    halo.scale.set(base.hw, base.hh, 1);
    flame.visible = halo.visible = false;
    e.avatar.root.add(halo, flame);
    // e.body holds the avatar's baked skinned mesh(es); capture their emissive state so the tint can be undone exactly
    const mats: THREE.MeshToonMaterial[] = [];
    for (const o of e.body) {
      const raw = (o as THREE.Mesh).material;
      for (const m of Array.isArray(raw) ? raw : [raw]) {
        const tm = m as THREE.MeshToonMaterial;
        if (tm.isMeshToonMaterial) mats.push(tm);
      }
    }
    return {
      flame, halo, mats, base,
      emissive: mats.map((m) => m.emissive.getHex()),
      intensity: mats.map((m) => m.emissiveIntensity),
      on: false, t: 0, seed: (e.id * 2.399) % (Math.PI * 2),
    };
  }

  private startBurn(c: BurnCue) {
    c.on = true; c.t = 0;
    for (let i = 0; i < c.mats.length; i++) { c.mats[i].emissive.setHex(BURN_EMISSIVE); c.mats[i].emissiveIntensity = 0.55; }
    c.flame.visible = c.halo.visible = true;
  }

  /** Hide the cue and restore every captured value: the mob stops looking burned on the very snapshot the flag clears. */
  private stopBurn(c: BurnCue) {
    if (!c.on) return;
    c.on = false; c.t = 0;
    for (let i = 0; i < c.mats.length; i++) { c.mats[i].emissive.setHex(c.emissive[i]); c.mats[i].emissiveIntensity = c.intensity[i]; }
    c.flame.visible = c.halo.visible = false;
    c.flame.position.set(c.base.fw * 0.16, c.base.fy, 0);
    c.flame.scale.set(c.base.fw, c.base.fh, 1);
    c.halo.position.set(0, c.base.hy, 0);
    c.halo.scale.set(c.base.hw, c.base.hh, 1);
    (c.flame.material as THREE.SpriteMaterial).rotation = 0;
    (c.flame.material as THREE.SpriteMaterial).opacity = 0.9;
    (c.halo.material as THREE.SpriteMaterial).opacity = 0.26;
  }

  /** Sprites carry no geometry, so disposeAvatar() skips them: release their per-entity materials here (flame texture is shared). */
  private disposeBurn(c: BurnCue) {
    for (const s of [c.flame, c.halo]) { s.removeFromParent(); (s.material as THREE.SpriteMaterial).dispose(); }
    c.mats.length = 0;
  }

  /** Per-frame burn cue: flame flicker and warm emissive pulse while `burning`, otherwise reset (also on death / out of LOD). */
  private updateBurn(e: Ent, dt: number) {
    const burning = !e.dead && e.s.k === "mob" && e.s.burning === true;
    const cue = e.burn;
    if (!burning) { if (cue) this.stopBurn(cue); return; }
    if (!cue) e.burn = this.makeBurnCue(e);
    const c = e.burn!;
    if (!c.on) this.startBurn(c);
    // ride the same distance budget as the body: it is hidden past LOD 3, so the flames vanish with it
    const show = e.lod < 3;
    c.flame.visible = show; c.halo.visible = show;
    c.t += dt;
    const t = c.t + c.seed;
    const wob = 1 + 0.16 * Math.sin(t * 12.7) + 0.08 * Math.sin(t * 23.3 + 1.7);
    c.flame.scale.set(c.base.fw * (1.1 - 0.1 * wob), c.base.fh * wob, 1);
    c.flame.position.x = c.base.fw * 0.16 + Math.sin(t * 4.1) * c.base.fw * 0.08;
    const fm = c.flame.material as THREE.SpriteMaterial;
    fm.rotation = Math.sin(t * 5.3) * 0.14;
    fm.opacity = 0.78 + 0.18 * Math.sin(t * 17.3);
    const hs = 1 + 0.12 * Math.sin(t * 7.1 + 0.9);
    c.halo.scale.set(c.base.hw * hs, c.base.hh * hs, 1);
    (c.halo.material as THREE.SpriteMaterial).opacity = 0.22 + 0.1 * (0.5 + 0.5 * Math.sin(t * 6.7));
    const glow = 0.5 + 0.25 * (0.5 + 0.5 * Math.sin(t * 8.3));
    for (const m of c.mats) m.emissiveIntensity = glow;
  }

  /** Update interpolated transforms and animation state. `localPos` overrides the local player's position. */
  /** `animDt` (default dt) drives animation clocks and facing smoothing only; hit-stop passes less than dt so poses freeze while positions keep tracking the network. */
  update(dt: number, now: number, local: { x: number; z: number; r: number; moving: boolean } | null, cam?: THREE.Vector3, animDt: number = dt) {
    const renderT = now - INTERP_DELAY_MS;
    const me = this.myId();
    for (const e of this.map.values()) {
      const px = e.x, pz = e.z;
      let moving: boolean;
      if (e.id === me && local) {
        e.x = local.x; e.z = local.z; e.r = local.r;
        moving = local.moving;
      } else {
        e.track.sample(renderT, this.tmp);
        e.x = this.tmp.x; e.z = this.tmp.z; e.r = this.tmp.r;
        const v = Math.hypot(e.x - px, e.z - pz) / Math.max(dt, 1e-3);
        if (v > 0.6) e.lastMoveAt = now;
        moving = now - e.lastMoveAt < 160;
      }
      e.y = this.heightAt(e.x, e.z);
      e.dead = e.s.hp <= 0 || e.s.st === "dead";
      // 0.5.0 spirit-sword mount: ride a little above the ground (smoothly), float the jian under the feet and keep
      // the shadow blob projected on the ground below instead of riding up with the avatar.
      const riding = !!e.mount && e.s.mounted === true && !e.dead;
      if (e.mount && e.mount.root.visible !== riding) e.mount.root.visible = riding;
      const liftTarget = riding ? MOUNT_LIFT : 0;
      e.lift += (liftTarget - e.lift) * Math.min(1, animDt * 10);
      if (liftTarget === 0 && e.lift < 0.003) e.lift = 0;
      const lift = e.lift;
      const root = e.avatar.root;
      root.position.set(e.x, e.y + lift, e.z);
      // smooth facing
      let d = (e.r - root.rotation.y) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      root.rotation.y += d * Math.min(1, animDt * 16);
      if (e.roll && !e.dead) {
        const u = (now - e.roll.start) / e.roll.dur;
        if (u >= 1) { e.roll = undefined; root.rotation.x = 0; }
        else {
          const k = u < 0 ? 0 : u * u * (3 - 2 * u); // smoothstep: a full turn over the roll
          root.rotation.x = k * Math.PI * 2;
          // pivot about the middle of the body instead of the feet, and stay low while tumbling
          this.qTmp.setFromEuler(root.rotation);
          const half = e.avatar.height * 0.5;
          this.vTmp.set(0, half, 0).applyQuaternion(this.qTmp);
          root.position.set(e.x - this.vTmp.x, e.y + half * 0.8 - this.vTmp.y, e.z - this.vTmp.z);
        }
      } else if (e.roll) { e.roll = undefined; root.rotation.x = 0; }
      if (!e.roll) for (const sh of e.shadow) sh.position.y = SHADOW_Y - lift; // the mount lifts the body, not the shadow
      const st = e.dead ? "dead" : now < e.attackUntil || e.s.st === "attack" ? "attack" : moving ? "move" : "idle";
      if (cam) {
        // distance LOD (draw-call budget): ink hull only up close, shadow blob mid-range, body to mid-far, then skipped entirely.
        // Guardian boss is large, so it keeps wider radii. 0 = full, 1 = no hull, 2 = no hull/blob, 3 = hidden
        const d = Math.hypot(e.x - cam.x, e.z - cam.z);
        const big = BOSS_MOBS.has(e.s.mob ?? "");
        const k = big ? 1.9 : 1;
        const lod = e.id === me ? 0 : d > 32 * k ? 3 : d > 18 * k ? 2 : d > 10 * k ? 1 : 0;
        if (lod !== e.lod) {
          e.lod = lod;
          for (const o of e.outline) o.visible = lod === 0;
          for (const o of e.shadow) o.visible = lod < 2;
          for (const o of e.body) o.visible = lod < 3;
        }
      }
      this.updateBurn(e, animDt);
      if (e.mount && riding) e.mount.update(animDt, moving && !e.dead); // hover bob, glow pulse and the faint trail
      e.avatar.setState(st);
      e.avatar.setPhase?.(!e.dead && BOSS_MOBS.has(e.s.mob ?? "") && e.s.hp / Math.max(1, e.s.mhp) < 0.25 ? 3 : 0);
      e.avatar.update(animDt);
    }
  }

  clear() { for (const id of [...this.map.keys()]) this.remove(id); }
}
