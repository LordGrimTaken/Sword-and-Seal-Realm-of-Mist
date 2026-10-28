import type { Entity } from "./types.ts";

/** Uniform spatial hash, rebuilt every tick (entity counts are small; rebuild is cheaper than tracking moves). */
export class SpatialGrid {
  private cells = new Map<number, Entity[]>();
  constructor(private cell = 30) {}
  private key(cx: number, cz: number) { return (cx + 1024) * 4096 + (cz + 1024); }
  clear() { this.cells.clear(); }
  insert(e: Entity) {
    const k = this.key(Math.floor(e.x / this.cell), Math.floor(e.z / this.cell));
    const c = this.cells.get(k);
    if (c) c.push(e); else this.cells.set(k, [e]);
  }
  /** Calls fn for every entity within radius r of (x,z). */
  query(x: number, z: number, r: number, fn: (e: Entity) => void) {
    const c = this.cell, r2 = r * r;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const list = this.cells.get(this.key(cx, cz));
      if (!list) continue;
      for (const e of list) { const dx = e.x - x, dz = e.z - z; if (dx * dx + dz * dz <= r2) fn(e); }
    }
  }
}
