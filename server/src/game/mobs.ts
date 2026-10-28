import { MOBS, MOB_SPAWNS, TUNING, ZONE } from "../data.ts";
import { applyPoison, enrageMult, hurtPlayer, mobAttack } from "./combat.ts";
import type { GameEvent } from "../../../shared/protocol.ts";
import type { Mob, Player } from "./types.ts";
import type { World } from "./world.ts";
import { clamp, dist, mulberry32, rand } from "./util.ts";

export function spawnMobs(world: World): Mob[] {
  const rng = mulberry32(0x9e3779b9);
  const out: Mob[] = [];
  for (const g of MOB_SPAWNS) {
    const def = MOBS[g.type];
    const placed: Array<[number, number]> = [];
    const count = g.points ? g.points.length : g.count;
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0;
      if (g.points) { [x, z] = g.points[i]; placed.push([x, z]); }
      else for (let tries = 0; tries < 30; tries++) {
        x = g.x[0] + rng() * (g.x[1] - g.x[0]);
        z = g.z[0] + rng() * (g.z[1] - g.z[0]);
        if (dist(x, z, ZONE.spawn.x, ZONE.spawn.z) >= TUNING.safeSpawnRadius && placed.every(([px, pz]) => dist(px, pz, x, z) >= (g.spacing ?? 7))) break;
      }
      if (!g.points) placed.push([x, z]);
      const lv = g.lv[0] + (i % (g.lv[1] - g.lv[0] + 1));
      const hp = def.hpBase + def.hpPerLv * lv;
      const m: Mob = {
        id: world.allocId(), k: "mob", n: def.name, x, z, r: rng() * Math.PI * 2, hp, mhp: hp, lv, st: "idle",
        visible: true, state: { id: 0, k: "mob", n: def.name, x, z, r: 0, hp, mhp: hp, lv, mob: def.type, st: "idle" },
        def, spawnX: x, spawnZ: z, ai: "idle", threat: new Map(), target: 0, nextAttack: 0, attackUntil: 0,
        slowUntil: 0, slowMult: 1, wanderX: x, wanderZ: z, wanderAt: rand(0, 5), deadAt: 0, respawnAt: 0,
        windupUntil: 0, windupTarget: 0, windupX: 0, windupZ: 0,
        boss: def.boss ? { engagedAt: 0, nextSlam: 0, patternIdx: 0, rr: 0, phase2: false, enraged: false, pending: [] } : undefined,
      };
      m.state.id = m.id;
      out.push(m);
    }
  }
  return out;
}

function moveToward(world: World, m: Mob, tx: number, tz: number, speed: number, dt: number): number {
  const d = dist(m.x, m.z, tx, tz);
  if (d < 1e-3) return 0;
  const step = Math.min(d, speed * dt);
  m.x = clamp(m.x + ((tx - m.x) / d) * step, -world.half, world.half);
  m.z = clamp(m.z + ((tz - m.z) / d) * step, -world.half, world.half);
  m.r = Math.atan2(tx - m.x, tz - m.z);
  return step;
}

function pickTarget(world: World, m: Mob): Player | undefined {
  let best: Player | undefined, bestThreat = 0;
  for (const [pid, t] of m.threat) {
    const p = world.players.get(pid);
    if (!p || p.st === "dead") { m.threat.delete(pid); continue; }
    if (dist(p.x, p.z, m.spawnX, m.spawnZ) > m.def.leash) continue;
    if (t > bestThreat) { best = p; bestThreat = t; }
  }
  return best;
}

function findAggro(world: World, m: Mob): Player | undefined {
  let best: Player | undefined, bd = Infinity;
  world.grid.query(m.x, m.z, m.def.aggro, (e) => {
    if (e.k !== "player" || e.st === "dead") return;
    const d = dist(e.x, e.z, m.x, m.z);
    if (d < bd) { bd = d; best = e; }
  });
  return best;
}

// ---------------- Stone Guardian boss mechanics ----------------
function bossReset(m: Mob) {
  const b = m.boss!;
  b.engagedAt = 0; b.pending.length = 0; b.phase2 = false; b.enraged = false; b.patternIdx = 0;
}

function emitTelegraph(world: World, m: Mob, x: number, z: number, radius: number, delay: number, dmg: number) {
  const ev: GameEvent = { k: "telegraph", src: m.id, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, radius, delay };
  world.emitNear(x, z, ev);
  m.boss!.pending.push({ at: world.time + delay, x, z, radius, dmg });
}

/** Resolve landed slams: every living player still inside takes the damage (guard buffs apply). */
function bossResolve(world: World, m: Mob) {
  const b = m.boss!;
  if (!b.pending.length) return;
  const now = world.time;
  for (let i = b.pending.length - 1; i >= 0; i--) {
    const s = b.pending[i];
    if (now < s.at) continue;
    b.pending.splice(i, 1);
    for (const p of [...world.players.values()]) {
      if (p.st === "dead" || dist(p.x, p.z, s.x, s.z) > s.radius) continue;
      hurtPlayer(world, p, s.dmg * rand(0.95, 1.05) * enrageMult(m), m.id);
    }
  }
}

function bossFight(world: World, m: Mob) {
  const b = m.boss!, bd = m.def.boss!, now = world.time;
  if (!b.engagedAt) { b.engagedAt = now; b.nextSlam = now + bd.firstSlam; }
  if (!b.phase2 && m.hp / m.mhp < bd.phase2At) {
    b.phase2 = true;
    b.nextSlam = Math.min(b.nextSlam, now + 1.5); b.patternIdx = 1; // the new pattern (scatter) comes right away, so phase 2 is felt even by fast kills
    world.emitNear(m.x, m.z, { k: "chat", from: "System", text: `${m.def.name}'s runes blaze crimson!`, sys: true });
  }
  if (!b.enraged && now - b.engagedAt > bd.enrageAfter) {
    b.enraged = true;
    world.emitNear(m.x, m.z, { k: "chat", from: "System", text: `${m.def.name} is enraged!`, sys: true });
  }
  if (now < b.nextSlam) return;
  const cands: Player[] = [];
  for (const p of world.players.values()) if (p.st !== "dead" && dist(p.x, p.z, m.x, m.z) <= bd.targetRange) cands.push(p);
  if (!cands.length) { b.nextSlam = now + 1; return; }
  cands.sort((x, y) => x.id - y.id);
  const tgt = cands[b.rr++ % cands.length];
  const seq = b.phase2 ? ["slam", "scatter", "stomp", "scatter"] : ["slam", "stomp"];
  const pat = seq[b.patternIdx++ % seq.length];
  if (pat === "slam") emitTelegraph(world, m, tgt.x, tgt.z, bd.slam.radius, bd.slam.delay, bd.slam.dmg);
  else if (pat === "stomp") emitTelegraph(world, m, m.x, m.z, bd.stomp.radius, bd.stomp.delay, bd.stomp.dmg);
  else {
    const sc = bd.scatter;
    emitTelegraph(world, m, tgt.x, tgt.z, sc.radius, sc.delay, sc.dmg);
    for (let i = 1; i < sc.n; i++) {
      const a = rand(0, Math.PI * 2), r = sc.spread * rand(0.6, 1);
      emitTelegraph(world, m, clamp(tgt.x + Math.cos(a) * r, -world.half, world.half), clamp(tgt.z + Math.sin(a) * r, -world.half, world.half), sc.radius, sc.delay, sc.dmg);
    }
  }
  const gap = b.phase2 ? bd.slamEvery2 : rand(bd.slamEvery[0], bd.slamEvery[1]);
  b.nextSlam = now + gap * (b.enraged ? 0.75 : 1);
}

// ---------------- Jade Serpent lunge ----------------
/** Returns true while the serpent is busy with a lunge (windup or strike), so it neither walks nor melees. */
function lungeStep(world: World, m: Mob, t: Player, d: number): boolean {
  const lg = m.def.lunge!, now = world.time;
  if (m.windupUntil > 0) {
    if (now < m.windupUntil) return true; // coiling: frozen
    // strike: dash to the point the target occupied when the coil began; the bite lands only if they are still close to it
    const tx = m.windupX, tz = m.windupZ;
    m.windupUntil = 0;
    const dd = dist(m.x, m.z, tx, tz);
    const stop = Math.max(0, dd - 1.2);
    if (dd > 1e-3) { m.x = clamp(m.x + ((tx - m.x) / dd) * stop, -world.half, world.half); m.z = clamp(m.z + ((tz - m.z) / dd) * stop, -world.half, world.half); m.r = Math.atan2(tx - m.x, tz - m.z); }
    const victim = world.players.get(m.windupTarget);
    if (victim && victim.st !== "dead" && dist(victim.x, victim.z, m.x, m.z) <= lg.reach) {
      mobAttack(world, m, victim);
      if ((victim.st as string) !== "dead") applyPoison(world, m, victim);
    }
    return true;
  }
  if (d <= lg.range && now >= m.nextAttack) {
    m.windupUntil = now + lg.windup; m.windupTarget = t.id; m.windupX = t.x; m.windupZ = t.z;
    m.nextAttack = now + m.def.attackCd;
    m.attackUntil = now + lg.windup + 0.2; m.r = Math.atan2(t.x - m.x, t.z - m.z);
    return true;
  }
  return false;
}

export function updateMob(world: World, m: Mob, dt: number) {
  const now = world.time, def = m.def;
  if (m.ai === "dead") {
    if (m.visible && now >= m.deadAt + 3) m.visible = false;
    if (now >= m.respawnAt) {
      m.x = m.spawnX; m.z = m.spawnZ; m.hp = m.mhp; m.ai = "idle"; m.st = "idle"; m.visible = true;
      m.threat.clear(); m.target = 0; m.slowUntil = 0; m.windupUntil = 0;
      if (m.boss) bossReset(m);
    }
    return;
  }
  if (m.boss) bossResolve(world, m);
  const speed = def.speed * (now < m.slowUntil ? m.slowMult : 1);
  let moved = false;

  if (m.ai === "idle") {
    const t = findAggro(world, m);
    if (t) { m.ai = "chase"; m.target = t.id; m.threat.set(t.id, m.threat.get(t.id) ?? 1); }
    else {
      if (m.hp < m.mhp) m.hp = Math.min(m.mhp, m.hp + m.mhp * 0.05 * dt);
      if (now >= m.wanderAt) {
        const a = rand(0, Math.PI * 2), r = rand(0, def.wander);
        m.wanderX = m.spawnX + Math.cos(a) * r; m.wanderZ = m.spawnZ + Math.sin(a) * r;
        m.wanderAt = now + rand(3, 8);
      }
      moved = moveToward(world, m, m.wanderX, m.wanderZ, speed * 0.4, dt) > 0;
    }
  }

  if (m.ai === "chase") {
    let t = world.players.get(m.target);
    if (!t || t.st === "dead" || dist(t.x, t.z, m.spawnX, m.spawnZ) > def.leash) {
      t = pickTarget(world, m);
      m.target = t ? t.id : 0;
    }
    if (!t || dist(m.x, m.z, m.spawnX, m.spawnZ) > def.leash) { m.ai = "return"; m.target = 0; m.threat.clear(); m.windupUntil = 0; if (m.boss) bossReset(m); }
    else {
      if (m.boss) bossFight(world, m);
      const d = dist(m.x, m.z, t.x, t.z);
      if (def.lunge && lungeStep(world, m, t, d)) { /* busy lunging */ }
      else if (d <= def.attackRange) {
        m.r = Math.atan2(t.x - m.x, t.z - m.z);
        if (now >= m.nextAttack) { m.nextAttack = now + def.attackCd; mobAttack(world, m, t); }
      } else moved = moveToward(world, m, t.x, t.z, speed, dt) > 0;
    }
  }

  if (m.ai === "return") {
    m.hp = Math.min(m.mhp, m.hp + m.mhp * 0.25 * dt);
    moved = moveToward(world, m, m.spawnX, m.spawnZ, def.speed * 1.5, dt) > 0;
    if (dist(m.x, m.z, m.spawnX, m.spawnZ) < 0.5) { m.hp = m.mhp; m.ai = "idle"; m.wanderAt = now + rand(1, 4); }
  }

  m.st = now < m.attackUntil ? "attack" : moved ? "move" : "idle";
}
