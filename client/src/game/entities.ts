import * as THREE from "three";
import type { EntityState } from "@shared/protocol";
import { createCharacterModel, createMobModel, createNpcModel, type Avatar } from "../art";
import { Track, INTERP_DELAY_MS } from "../net/interp";

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
}

/** Gameplay-camera readability: characters are scaled up modestly; height is updated so plates/rings follow. */
const SCALE = { player: 1.22, npc: 1.2, mob: 1.2, boss: 1.0 };

function makeAvatar(s: EntityState): Avatar {
  let a: Avatar, k: number;
  if (s.k === "player") { a = createCharacterModel(s.cls ?? "sword"); k = SCALE.player; }
  else if (s.k === "mob") { a = createMobModel(s.mob ?? "bamboo_spirit"); k = s.mob === "stone_guardian" ? SCALE.boss : SCALE.mob; }
  else { a = createNpcModel(/\bFen\b/i.test(s.n) ? "keeper" : "elder"); k = SCALE.npc; }
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

  constructor(private scene: THREE.Scene, private heightAt: (x: number, z: number) => number, private myId: () => number) {}

  applySnapshot(ents: EntityState[], gone: number[], now: number) {
    for (const id of gone) this.remove(id);
    for (const s of ents) {
      let e = this.map.get(s.id);
      if (!e) {
        const avatar = makeAvatar(s);
        this.scene.add(avatar.root);
        e = { id: s.id, s, avatar, track: new Track(), x: s.x, z: s.z, r: s.r, y: 0, attackUntil: 0, lastMoveAt: 0, dead: false, body: [], outline: [], shadow: [], lod: 0 };
        avatar.root.traverse((o) => { if (o.name === "outline") e!.outline.push(o); else if (o.name === "baked") e!.body.push(o); else if (o.name === "shadow") e!.shadow.push(o); });
        this.map.set(s.id, e);
        e.y = this.heightAt(s.x, s.z);
        avatar.root.position.set(s.x, e.y, s.z);
        avatar.root.rotation.y = s.r;
      }
      e.s = s;
      e.track.push(now, s.x, s.z, s.r);
    }
  }

  remove(id: number) {
    const e = this.map.get(id);
    if (!e) return;
    this.scene.remove(e.avatar.root);
    disposeAvatar(e.avatar.root);
    this.map.delete(id);
  }

  markAttack(id: number, now: number) {
    const e = this.map.get(id);
    if (e) e.attackUntil = now + 450;
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
      const root = e.avatar.root;
      root.position.set(e.x, e.y, e.z);
      // smooth facing
      let d = (e.r - root.rotation.y) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      root.rotation.y += d * Math.min(1, animDt * 16);
      const st = e.dead ? "dead" : now < e.attackUntil || e.s.st === "attack" ? "attack" : moving ? "move" : "idle";
      if (cam) {
        // distance LOD (draw-call budget): ink hull only up close, shadow blob mid-range, body to mid-far, then skipped entirely.
        // Guardian boss is large, so it keeps wider radii. 0 = full, 1 = no hull, 2 = no hull/blob, 3 = hidden
        const d = Math.hypot(e.x - cam.x, e.z - cam.z);
        const big = e.s.mob === "stone_guardian";
        const k = big ? 1.9 : 1;
        const lod = e.id === me ? 0 : d > 32 * k ? 3 : d > 18 * k ? 2 : d > 10 * k ? 1 : 0;
        if (lod !== e.lod) {
          e.lod = lod;
          for (const o of e.outline) o.visible = lod === 0;
          for (const o of e.shadow) o.visible = lod < 2;
          for (const o of e.body) o.visible = lod < 3;
        }
      }
      e.avatar.setState(st);
      e.avatar.update(animDt);
    }
  }

  clear() { for (const id of [...this.map.keys()]) this.remove(id); }
}
