import { PLAYER_SPEED, TICK_RATE, WORLD_SIZE } from "@shared/protocol";

export const STEP = 1 / TICK_RATE;
const HALF = WORLD_SIZE / 2;

interface Pending { seq: number; dx: number; dz: number }

/**
 * Client-side prediction for the local player.
 * Inputs are simulated in fixed steps of 1/TICK_RATE (one input message per step); the server
 * is expected to apply each input as one tick of movement at PLAYER_SPEED. On every snapshot we
 * rewind to the server position and replay all inputs newer than `ack`.
 */
export class Predictor {
  x = 0;
  z = 0;
  prevX = 0;
  prevZ = 0;
  seq = 0;
  ready = false;
  pending: Pending[] = [];
  /** visual error offset that decays toward 0 so corrections are smooth */
  offX = 0;
  offZ = 0;
  lastErr = 0;

  reset(x: number, z: number) {
    this.x = this.prevX = x;
    this.z = this.prevZ = z;
    this.pending.length = 0;
    this.offX = this.offZ = 0;
    this.ready = true;
  }

  private apply(dx: number, dz: number) {
    this.x = Math.max(-HALF, Math.min(HALF, this.x + dx * PLAYER_SPEED * STEP));
    this.z = Math.max(-HALF, Math.min(HALF, this.z + dz * PLAYER_SPEED * STEP));
  }

  /** Advance one fixed step with the given (already clamped to unit length) direction. */
  step(dx: number, dz: number): number {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.seq++;
    this.apply(dx, dz);
    this.pending.push({ seq: this.seq, dx, dz });
    if (this.pending.length > 240) this.pending.shift();
    return this.seq;
  }

  /** Apply authoritative state from a snapshot. */
  reconcile(ack: number, sx: number, sz: number) {
    if (!this.ready) { this.reset(sx, sz); return; }
    const ox = this.x, oz = this.z;
    this.pending = this.pending.filter((p) => p.seq > ack);
    this.x = sx;
    this.z = sz;
    for (const p of this.pending) this.apply(p.dx, p.dz);
    const ex = ox - this.x, ez = oz - this.z;
    this.lastErr = Math.hypot(ex, ez);
    if (this.lastErr > 4) {
      // teleport / respawn / big desync: snap
      this.prevX = this.x; this.prevZ = this.z;
      this.offX = this.offZ = 0;
    } else {
      // shift prev with the correction so the visual stays continuous; the offset then decays away
      this.prevX -= ex;
      this.prevZ -= ez;
      this.offX += ex;
      this.offZ += ez;
    }
  }

  /** Visual position: interpolate between last two fixed steps + decaying error offset. */
  visual(alpha: number, dt: number, out: { x: number; z: number }) {
    const k = Math.exp(-dt * 12);
    this.offX *= k;
    this.offZ *= k;
    if (Math.abs(this.offX) < 1e-4) this.offX = 0;
    if (Math.abs(this.offZ) < 1e-4) this.offZ = 0;
    out.x = this.prevX + (this.x - this.prevX) * alpha + this.offX;
    out.z = this.prevZ + (this.z - this.prevZ) * alpha + this.offZ;
  }
}
