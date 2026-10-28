/** Snapshot interpolation for remote entities: render ~100 ms behind the newest data. */
export const INTERP_DELAY_MS = 100;

export interface Sample { t: number; x: number; z: number; r: number }

function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class Track {
  samples: Sample[] = [];

  push(t: number, x: number, z: number, r: number) {
    const s = this.samples;
    if (s.length && t <= s[s.length - 1].t) t = s[s.length - 1].t + 0.001;
    s.push({ t, x, z, r });
    if (s.length > 40) s.splice(0, s.length - 40);
  }

  /** Sample at render time `t` (ms, same clock as push). Clamps at the ends (no extrapolation). */
  sample(t: number, out: { x: number; z: number; r: number }) {
    const s = this.samples;
    if (!s.length) return out;
    // drop stale samples but keep one before t
    while (s.length > 2 && s[1].t <= t) s.shift();
    const a = s[0];
    if (s.length === 1 || t <= a.t) { out.x = a.x; out.z = a.z; out.r = a.r; return out; }
    const b = s[1];
    if (t >= b.t) { out.x = b.x; out.z = b.z; out.r = b.r; return out; }
    const k = (t - a.t) / (b.t - a.t);
    // very large jumps (teleport / respawn) are not interpolated
    const dx = b.x - a.x, dz = b.z - a.z;
    if (dx * dx + dz * dz > 30 * 30) { out.x = b.x; out.z = b.z; out.r = b.r; return out; }
    out.x = a.x + dx * k;
    out.z = a.z + dz * k;
    out.r = lerpAngle(a.r, b.r, k);
    return out;
  }
}
