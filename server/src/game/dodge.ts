// 0.4.0: Qi pool helpers and the dodge roll (server-authoritative dash with i-frames).
import { QI } from "../data.ts";
import { isNum } from "./util.ts";
import type { Player } from "./types.ts";
import type { World } from "./world.ts";

/** Qi regenerates continuously (after a short pause following a spend). */
export function qiTick(world: World, p: Player, dt: number) {
  if (p.qi < p.mqi && world.time >= p.qiResumeAt) p.qi = Math.min(p.mqi, p.qi + QI.regenPerSec * dt);
}

/** Tries to pay `cost` Qi. On failure tells the player (rate limited) and returns false. */
export function spendQi(world: World, p: Player, cost: number, what: string): boolean {
  if (cost <= 0) return true;
  if (p.qi + 1e-6 < cost) {
    if (world.time - p.qiMsgAt >= QI.msgEvery) { p.qiMsgAt = world.time; world.sysTo(p, `Not enough Qi for ${what} (need ${cost}, have ${Math.floor(p.qi)}).`); }
    return false;
  }
  p.qi = Math.max(0, p.qi - cost);
  p.qiResumeAt = world.time + QI.regenDelay;
  return true;
}

export const isInvulnerable = (world: World, p: Player) => world.time < p.invulnUntil;
export const dodgeCooldownLeft = (world: World, p: Player) => Math.max(0, p.dodgeReady - world.time);

/** Space: roll QI.dodgeDist units in the wanted direction (or the facing) over QI.dodgeTime s, invulnerable for that time. */
export function handleDodge(world: World, p: Player, msg: { dx?: unknown; dz?: unknown }) {
  if (p.st === "dead") return;
  if (world.time < p.dodgeReady) return; // on cooldown: silently ignored (client tracks it)
  let dx = isNum(msg.dx) ? msg.dx : 0, dz = isNum(msg.dz) ? msg.dz : 0;
  if (Math.abs(dx) > 100 || Math.abs(dz) > 100) return;
  let mag = Math.hypot(dx, dz);
  if (mag < 1e-3) { dx = Math.sin(p.r); dz = Math.cos(p.r); mag = 1; } // no direction: roll the way we face
  dx /= mag; dz /= mag;
  if (!spendQi(world, p, QI.dodgeCost, "a dodge")) return;
  p.dodgeReady = world.time + QI.dodgeCooldown;
  p.dashDx = dx; p.dashDz = dz; p.dashLeft = QI.dodgeDist; p.dashUntil = world.time + QI.dodgeTime;
  p.invulnUntil = world.time + QI.dodgeTime;
  p.r = Math.atan2(dx, dz);
  p.inDx = p.inDz = 0; // the roll replaces ordinary movement
  world.emitNear(p.x, p.z, { k: "dodge", id: p.id, x: p.x, z: p.z, dx, dz, dist: QI.dodgeDist, dur: QI.dodgeTime });
}

/** Per-tick roll movement. Returns true while rolling (ordinary input movement is skipped). */
export function dashTick(world: World, p: Player, dt: number, half: number): boolean {
  if (p.dashLeft <= 0) return false;
  const step = Math.min(p.dashLeft, (QI.dodgeDist / QI.dodgeTime) * dt);
  p.dashLeft -= step;
  p.x = Math.max(-half, Math.min(half, p.x + p.dashDx * step));
  p.z = Math.max(-half, Math.min(half, p.z + p.dashDz * step));
  if (world.time >= p.dashUntil) p.dashLeft = 0;
  return true;
}
