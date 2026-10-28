import * as THREE from "three";

const CELL = 0.5;
const MIN_DIST = 1.5;
const CLEAR = 0.45; // gap kept between camera and geometry
const LAYERS = 3;   // vertical intervals stored per grid cell (platform / open space under eaves / roof)
const GAP = 0.9;    // intervals closer than this merge, so thin vertical gaps do not count as open space

/**
 * Static occluder field: a 2D grid storing, per cell, the lowest and highest world-space Y of solid geometry
 * (structures rasterised triangle by triangle, trees/rocks as shrunken boxes). Baked once from the scene graph.
 * Each cell keeps up to LAYERS separate vertical intervals so the camera can sit in the open space under eaves / between a
 * pagoda's platform and its roofs instead of treating the whole column as solid.
 */
class Colliders {
  private x0 = 0; private z0 = 0; private w = 0; private h = 0;
  private lo = new Float32Array(0);
  private hi = new Float32Array(0);
  ready = false;

  bake(scene: THREE.Object3D) {
    scene.updateMatrixWorld(true);
    const tris: Float32Array[] = []; // flat world-space triangle lists
    const boxes: number[] = [];      // minx,miny,minz,maxx,maxy,maxz
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const parent = o.parent?.name;
      if (parent === "structures" && mesh.name !== "batch_outline" && mesh.name !== "outline") {
        const g = mesh.geometry as THREE.BufferGeometry;
        const pos = g.getAttribute("position");
        const idx = g.index;
        const n = idx ? idx.count : pos.count;
        const arr = new Float32Array(n * 3);
        const v = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
          arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
        }
        tris.push(arr);
      } else if (parent === "vegetation" && (mesh as THREE.InstancedMesh).isInstancedMesh && mesh.name !== "bamboo") {
        const im = mesh as THREE.InstancedMesh;
        if (im.count > 200) return;
        im.geometry.computeBoundingBox();
        const bb = im.geometry.boundingBox!;
        if (bb.max.y - bb.min.y < 0.8) return; // lily pads etc.
        const m = new THREE.Matrix4(), b = new THREE.Box3(), cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m);
          m.premultiply(im.matrixWorld);
          // trunk/core footprint: shrink the box horizontally so wide canopies do not wall the arm off
          const sh = new THREE.Box3(
            new THREE.Vector3(cx + (bb.min.x - cx) * 0.45, bb.min.y, cz + (bb.min.z - cz) * 0.45),
            new THREE.Vector3(cx + (bb.max.x - cx) * 0.45, bb.max.y, cz + (bb.max.z - cz) * 0.45));
          b.copy(sh).applyMatrix4(m);
          boxes.push(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
        }
      }
    });
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const a of tris) for (let i = 0; i < a.length; i += 3) {
      minX = Math.min(minX, a[i]); maxX = Math.max(maxX, a[i]); minZ = Math.min(minZ, a[i + 2]); maxZ = Math.max(maxZ, a[i + 2]);
    }
    for (let i = 0; i < boxes.length; i += 6) {
      minX = Math.min(minX, boxes[i]); maxX = Math.max(maxX, boxes[i + 3]); minZ = Math.min(minZ, boxes[i + 2]); maxZ = Math.max(maxZ, boxes[i + 5]);
    }
    if (!isFinite(minX)) return;
    this.x0 = minX - 2; this.z0 = minZ - 2;
    this.w = Math.ceil((maxX - minX + 4) / CELL); this.h = Math.ceil((maxZ - minZ + 4) / CELL);
    this.lo = new Float32Array(this.w * this.h * LAYERS).fill(1e9);
    this.hi = new Float32Array(this.w * this.h * LAYERS).fill(-1e9);
    for (const a of tris) {
      for (let i = 0; i + 8 < a.length; i += 9) this.tri(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4], a[i + 5], a[i + 6], a[i + 7], a[i + 8]);
    }
    for (let i = 0; i < boxes.length; i += 6) {
      const cx0 = this.cx(boxes[i]), cx1 = this.cx(boxes[i + 3]), cz0 = this.cz(boxes[i + 2]), cz1 = this.cz(boxes[i + 5]);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.mark(cx, cz, boxes[i + 1], boxes[i + 4]);
    }
    this.ready = true;
  }

  private cx(x: number) { return Math.max(0, Math.min(this.w - 1, Math.floor((x - this.x0) / CELL))); }
  private cz(z: number) { return Math.max(0, Math.min(this.h - 1, Math.floor((z - this.z0) / CELL))); }
  private mark(cx: number, cz: number, lo: number, hi: number) {
    const base = (cz * this.w + cx) * LAYERS;
    let empty = -1, near = 0, nearD = Infinity;
    for (let i = 0; i < LAYERS; i++) {
      const l = this.lo[base + i], h = this.hi[base + i];
      if (h < l) { if (empty < 0) empty = i; continue; }
      if (lo <= h + GAP && hi >= l - GAP) { if (lo < l) this.lo[base + i] = lo; if (hi > h) this.hi[base + i] = hi; return; }
      const d = lo > h ? lo - h : l - hi;
      if (d < nearD) { nearD = d; near = i; }
    }
    if (empty >= 0) { this.lo[base + empty] = lo; this.hi[base + empty] = hi; return; }
    if (lo < this.lo[base + near]) this.lo[base + near] = lo;
    if (hi > this.hi[base + near]) this.hi[base + near] = hi;
  }
  private tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
    const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
    const n = Math.max(1, Math.min(160, Math.ceil(e / (CELL * 0.7))));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      const x = ax * w + bx * u + cx * v, y = ay * w + by * u + cy * v, z = az * w + bz * u + cz * v;
      this.mark(this.cx(x), this.cz(z), y, y);
    }
  }
  /** is the world point inside solid geometry (with a small vertical tolerance)? */
  solid(x: number, y: number, z: number): boolean {
    if (!this.ready) return false;
    const fx = Math.floor((x - this.x0) / CELL), fz = Math.floor((z - this.z0) / CELL);
    if (fx < 0 || fz < 0 || fx >= this.w || fz >= this.h) return false;
    const base = (fz * this.w + fx) * LAYERS;
    for (let i = 0; i < LAYERS; i++) if (y >= this.lo[base + i] - 0.2 && y <= this.hi[base + i] + 0.3) return true;
    return false;
  }
}

/** Third-person orbit-follow camera with a spring arm: shortens when terrain or static props sit between hero and camera. */
export class FollowCamera {
  yaw = Math.PI;      // camera sits at -z of the player, looking toward +z
  pitch = 0.36;       // radians above horizon
  dist = 9;
  /** fraction of the desired distance currently used (1 = unobstructed); useful for fading the hero when very close */
  armDist = 9;
  readonly cam: THREE.PerspectiveCamera;
  private focus = new THREE.Vector3();
  private inited = false;
  private colliders = new Colliders();
  private dir = new THREE.Vector3();
  private side = new THREE.Vector3();
  private pt = new THREE.Vector3();
  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeDur = 1;

  constructor(cam: THREE.PerspectiveCamera) { this.cam = cam; }

  /** Bake static colliders from the built world (call once after createWorld). */
  bakeWorld(scene: THREE.Object3D) { this.colliders.bake(scene); }

  orbit(dYaw: number, dPitch: number) {
    this.yaw -= dYaw;
    this.pitch = Math.max(0.08, Math.min(1.35, this.pitch + dPitch));
  }
  zoom(delta: number) {
    this.dist = Math.max(3.5, Math.min(30, this.dist * Math.exp(delta * 0.0012)));
  }

  /** Brief screen shake (impact feedback). Amplitude is in world units at the camera; later calls never weaken a stronger shake in progress. */
  shake(amp: number, dur: number) {
    if (amp * (dur > 0 ? 1 : 0) < this.shakeAmp * (this.shakeLeft / this.shakeDur)) return;
    this.shakeAmp = amp; this.shakeLeft = dur; this.shakeDur = Math.max(0.01, dur);
  }

  /** Horizontal forward / right vectors of the camera, for camera-relative movement. */
  forward(): [number, number] { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }
  right(): [number, number] { return [Math.cos(this.yaw), -Math.sin(this.yaw)]; }

  /** Largest arm length <= want along the ray focus -> focus + dir*want that stays clear of terrain and props. */
  private clearDist(want: number, heightAt: (x: number, z: number) => number): number {
    const f = this.focus, d = this.dir, s = this.side, p = this.pt;
    const step = 0.35;
    let best = want;
    for (const off of [0, -0.45, 0.45]) {
      let seenFree = false;
      for (let t = 0.6; t <= want; t += step) {
        p.set(f.x + d.x * t + s.x * off, f.y + d.y * t, f.z + d.z * t + s.z * off);
        const blocked = heightAt(p.x, p.z) + 0.45 > p.y || this.colliders.solid(p.x, p.y, p.z);
        if (!blocked) seenFree = true;
        else if (seenFree || t > 1.4) { best = Math.min(best, Math.max(MIN_DIST, t - CLEAR - step)); break; }
      }
    }
    return best;
  }

  update(dt: number, target: THREE.Vector3, heightAt: (x: number, z: number) => number) {
    if (!this.inited) { this.focus.copy(target); this.inited = true; this.armDist = this.dist; }
    const k = 1 - Math.exp(-dt * 14);
    this.focus.lerp(target, k);
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    this.side.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const ok = this.clearDist(this.dist, heightAt);
    // snap in quickly (never clip), ease back out slowly (no pumping)
    const rate = ok < this.armDist ? 30 : 2.5;
    this.armDist += (ok - this.armDist) * (1 - Math.exp(-dt * rate));
    if (this.armDist > this.dist) this.armDist = this.dist;
    if (ok < this.armDist) this.armDist = ok;
    const p = this.cam.position;
    p.copy(this.focus).addScaledVector(this.dir, this.armDist);
    const minY = heightAt(p.x, p.z) + 0.7;
    if (p.y < minY) p.y = minY;
    this.cam.lookAt(this.focus);
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const k = this.shakeAmp * (this.shakeLeft / this.shakeDur);
      const t = performance.now() * 0.05;
      p.x += Math.sin(t * 1.7) * k; p.y += Math.sin(t * 2.3 + 1) * k * 0.8; p.z += Math.cos(t * 1.3) * k;
    }
  }
}
