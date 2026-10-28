export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Deterministic PRNG so mob placement is stable across restarts. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple token bucket; `take(nowSeconds)` returns false when the caller is over the limit. */
export class TokenBucket {
  private tokens: number;
  private last = 0;
  constructor(private cap: number, private perSec: number) { this.tokens = cap; }
  take(now: number): boolean {
    if (this.last === 0) this.last = now;
    this.tokens = Math.min(this.cap, this.tokens + (now - this.last) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
