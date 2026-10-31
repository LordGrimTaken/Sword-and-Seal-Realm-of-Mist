import { MOBS, MOB_SPAWNS, TUNING, ZONE, veilPhaseAt, type MobDef, type VeilPhase } from "../data.ts";
import { applyPoison, burnTick, enrageMult, hurtPlayer, mobAttack } from "./combat.ts";
import { telegraphContains, type GameEvent } from "../../../shared/protocol.ts";
import type { Mob, Player } from "./types.ts";
import type { World } from "./world.ts";
import { clamp, dist, mulberry32, rand } from "./util.ts";

/** Build one mob from its definition. Shared by the initial spawn pass, boss summons (0.5.0) and the P3 Hollow Trial. */
export function makeMob(world: World, def: MobDef, x: number, z: number, lv: number, r = 0): Mob {
  const hp = def.hpBase + def.hpPerLv * lv;
  const m: Mob = {
    id: 0, k: "mob", n: def.name, x, z, r, hp, mhp: hp, lv, st: "idle",
    visible: true, state: { id: 0, k: "mob", n: def.name, x, z, r, hp, mhp: hp, lv, mob: def.type, st: "idle" },
    def, spawnX: x, spawnZ: z, ai: "idle", threat: new Map(), target: 0, nextAttack: 0, attackUntil: 0,
    slowUntil: 0, slowMult: 1, burnUntil: 0, burnNext: 0, burnDmg: 0, burnSrc: 0, burnEvery: 0, wanderX: x, wanderZ: z, wanderAt: rand(0, 5), deadAt: 0, respawnAt: 0,
    windupUntil: 0, windupTarget: 0, windupX: 0, windupZ: 0,
    boss: def.boss ? { engagedAt: 0, nextSlam: 0, nextSummon: 0, patternIdx: 0, rr: 0, phase2: false, phase3: false, enraged: false, pending: [] } : undefined,
  };
  m.id = world.allocId();
  m.state.id = m.id;
  return m;
}

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
      out.push(makeMob(world, def, x, z, lv, rng() * Math.PI * 2));
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

/** 0.4.0 pack mobs (Stone Hound): the first to fight pulls every idle packmate within `def.pack` onto the same target, once per fight. */
function callPack(world: World, m: Mob, t: Player) {
  m.packCalled = true;
  for (const o of world.mobs) {
    if (o === m || o.def.type !== m.def.type || o.ai !== "idle" || dist(o.x, o.z, m.x, m.z) > m.def.pack!) continue;
    o.ai = "chase"; o.target = t.id; o.threat.set(t.id, o.threat.get(t.id) ?? 1);
  }
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

// ---------------- boss mechanics (shared by every MobDef with a `boss` config) ----------------
// 0.5.0 summon-adds: hard cap on living adds per boss fight (3 waves of 2). Past the cap a wave is skipped, so a long or
// stalemated fight can never accumulate an army; everything the boss called is removed when it dies or leashes.
const SUMMON_CAP = 6;
/** Seconds between a summon's death and its corpse being removed (it never respawns - adds are temporary by design). */
const SUMMON_CORPSE = 3;

/** Remove every summoned add of `boss` from the world at once (boss died / leashed / reset). */
function despawnAdds(world: World, boss: Mob) {
  for (let i = world.mobs.length - 1; i >= 0; i--) { // backwards: never disturbs the world's forward update loop
    const o = world.mobs[i];
    if (o.summonedBy !== boss.id) continue;
    world.mobs.splice(i, 1);
    world.entities.delete(o.id);
    o.visible = false;
  }
}

/** Drop the corpses of adds that have finished dissolving. Called from the boss's own tick (its index is below every add's). */
function pruneAdds(world: World, boss: Mob) {
  const now = world.time;
  for (let i = world.mobs.length - 1; i >= 0; i--) {
    const o = world.mobs[i];
    if (o.summonedBy !== boss.id || o.ai !== "dead" || now < o.deadAt + SUMMON_CORPSE) continue;
    world.mobs.splice(i, 1);
    world.entities.delete(o.id);
  }
}

/** Keep the boss's living summons in the fight: an add that leashed home re-joins as soon as the boss's target is back in its reach. */
function commandAdds(world: World, boss: Mob, t: Player) {
  for (const o of world.mobs) {
    if (o.summonedBy !== boss.id || o.ai !== "idle") continue;
    if (dist(t.x, t.z, o.spawnX, o.spawnZ) > o.def.leash) continue;
    o.ai = "chase"; o.target = t.id; o.threat.set(t.id, (o.threat.get(t.id) ?? 0) + 1);
  }
}

/** The signature mechanic: call `summon.count` minions of `summon.type` on a ring beside the boss, already fighting its target. */
function summonAdds(world: World, m: Mob) {
  const sm = m.def.boss!.summon!;
  const living = world.mobs.reduce((n, o) => n + (o.summonedBy === m.id && o.ai !== "dead" ? 1 : 0), 0);
  if (living + sm.count > SUMMON_CAP) return; // capped: skip this wave, the timer still advances
  const def = MOBS[sm.type];
  const base = rand(0, Math.PI * 2);
  for (let i = 0; i < sm.count; i++) {
    const a = base + (i / sm.count) * Math.PI * 2 + rand(-0.3, 0.3);
    const d = rand(2.8, 4.4); // "beside itself": a ring just outside the boss's melee
    const add = makeMob(world, def, clamp(m.x + Math.cos(a) * d, -world.half, world.half), clamp(m.z + Math.sin(a) * d, -world.half, world.half), m.lv, a);
    add.summonedBy = m.id;
    add.ai = "chase"; add.target = m.target;
    for (const [pid, t] of m.threat) add.threat.set(pid, t); // the adds join the fight that is already happening
    world.mobs.push(add);
    world.entities.set(add.id, add);
  }
  world.emitNear(m.x, m.z, { k: "chat", from: "System", text: `${m.def.name} summons ${sm.count} ${def.name}${sm.count === 1 ? "" : "s"}!`, sys: true });
}

function bossReset(world: World, m: Mob) {
  const b = m.boss!;
  b.engagedAt = 0; b.pending.length = 0; b.phase2 = false; b.phase3 = false; b.beam = undefined; b.enraged = false; b.patternIdx = 0; b.nextSummon = 0;
  if (m.def.boss!.veil) { b.rr = 0; b.nextSlam = 0; m.state.veiled = false; } // 0.5.0 veil boss: a reset fight starts over in the veil
  if (m.def.boss!.summon) despawnAdds(world, m); // a resetting boss does not leave its summons behind
}

function emitTelegraph(world: World, m: Mob, x: number, z: number, radius: number, delay: number, dmg: number) {
  const ev: GameEvent = { k: "telegraph", src: m.id, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, radius, delay };
  world.emitNear(x, z, ev);
  m.boss!.pending.push({ at: world.time + delay, x, z, radius, dmg });
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Phase 3 rune beam: a line from the boss that holds still for `lead` s (warning), then sweeps `sweep` radians over `sweepTime` s, hurting everything on it. */
function emitBeam(world: World, m: Mob, tgt: Player) {
  const b = m.boss!, bd = m.def.boss!.beam, now = world.time;
  const sgn = Math.random() < 0.5 ? -1 : 1, sweep = sgn * bd.sweep;
  const dir0 = Math.atan2(tgt.x - m.x, tgt.z - m.z) - sweep / 2; // the sweep passes over the chosen player midway
  b.beam = { start: now, lead: bd.lead, end: now + bd.lead + bd.sweepTime, dir0, sweep, nextTick: now + bd.lead, x: m.x, z: m.z };
  world.emitNear(m.x, m.z, { k: "telegraph", src: m.id, x: r2(m.x), z: r2(m.z), radius: bd.len, delay: bd.lead + bd.sweepTime, shape: "line", dir: r2(dir0), len: bd.len, width: bd.width, sweep: r2(sweep), lead: bd.lead, beam: true });
}
const beamAngle = (bm: NonNullable<Mob["boss"]>["beam"] & object, now: number, sweepTime: number) => bm.dir0 + bm.sweep * clamp((now - bm.start - bm.lead) / sweepTime, 0, 1);

/** Damage ticks along the rotating beam (after the lead-in). */
function beamTick(world: World, m: Mob) {
  const b = m.boss!, bm = b.beam;
  if (!bm) return;
  const bd = m.def.boss!.beam, now = world.time;
  if (now >= bm.nextTick && now >= bm.start + bm.lead) {
    const ang = beamAngle(bm, now, bd.sweepTime);
    const geom = { shape: "line" as const, x: bm.x, z: bm.z, radius: bd.len, len: bd.len, width: bd.width };
    for (const p of [...world.players.values()]) {
      if (p.st === "dead" || !telegraphContains(geom, p.x, p.z, ang)) continue;
      hurtPlayer(world, p, bd.dmg * rand(0.95, 1.05) * enrageMult(m), m.id);
    }
    bm.nextTick = Math.max(bm.nextTick + bd.tickEvery, now + 0.05);
  }
  if (now >= bm.end) b.beam = undefined;
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
  if (!b.engagedAt) { b.engagedAt = now; b.nextSlam = now + bd.firstSlam; if (bd.summon) b.nextSummon = now + bd.summon.every; }
  if (!b.phase2 && m.hp / m.mhp < bd.phase2At) {
    b.phase2 = true;
    b.nextSlam = Math.min(b.nextSlam, now + 1.5); b.patternIdx = 1; // the new pattern (scatter) comes right away, so phase 2 is felt even by fast kills
    world.emitNear(m.x, m.z, { k: "chat", from: "System", text: `${m.def.name}'s runes blaze crimson!`, sys: true });
  }
  if (!b.phase3 && m.hp / m.mhp < bd.phase3At) {
    b.phase3 = true; b.patternIdx = 0; // the beam is the first pattern of phase 3
    b.nextSlam = Math.min(b.nextSlam, now + 1.5);
    world.emitNear(m.x, m.z, { k: "chat", from: "System", text: `${m.def.name} cracks open - white-hot runes blaze along its body!`, sys: true });
  }
  if (!b.enraged && now - b.engagedAt > bd.enrageAfter) {
    b.enraged = true;
    world.emitNear(m.x, m.z, { k: "chat", from: "System", text: `${m.def.name} is enraged!`, sys: true });
  }
  if (bd.summon) { // 0.5.0: keep the adds fighting, clear finished corpses, then call the next wave when the timer says so
    const t = world.players.get(m.target);
    if (t && t.st !== "dead") commandAdds(world, m, t);
    pruneAdds(world, m);
    if (now >= b.nextSummon) { summonAdds(world, m); b.nextSummon = now + bd.summon.every; }
  }
  if (now < b.nextSlam) return;
  const cands: Player[] = [];
  for (const p of world.players.values()) if (p.st !== "dead" && dist(p.x, p.z, m.x, m.z) <= bd.targetRange) cands.push(p);
  if (!cands.length) { b.nextSlam = now + 1; return; }
  cands.sort((x, y) => x.id - y.id);
  const tgt = cands[b.rr++ % cands.length];
  const seq = b.phase3 ? ["beam", "scatter", "slam", "beam", "stomp", "scatter"] : b.phase2 ? ["slam", "scatter", "stomp", "scatter"] : ["slam", "stomp"];
  const pat = seq[b.patternIdx++ % seq.length];
  if (pat === "beam") emitBeam(world, m, tgt);
  else if (pat === "slam") emitTelegraph(world, m, tgt.x, tgt.z, bd.slam.radius, bd.slam.delay, bd.slam.dmg);
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
  if (pat === "beam") b.nextSlam = Math.max(b.nextSlam, now + bd.beam.lead + bd.beam.sweepTime + 2.5); // never stack another pattern on a running beam
}

// ---------------- 0.5.0 The Hollow Bride: VEILED / REVEALED rhythm ----------------
/**
 * The Hollow Bride's encounter script. Unlike the other bosses she does not use the pattern rotation: `veilPhaseAt` derives
 * VEILED/REVEALED deterministically from (world.time - engagedAt), and this function only handles what that formula cannot
 * express: the one-shot transition announcements, the drift re-targeting while veiled and the lash timer. Damage immunity is
 * applied in combat.damageMob from the same deterministic phase (server-authoritative, never client-driven); movement speed,
 * the swing (lash, VEILED only) and the melee (REVEALED only) are gated in updateMob from the phase computed there.
 */
function brideFight(world: World, m: Mob, now: number) {
  const b = m.boss!, bd = m.def.boss!, v = bd.veil!;
  if (!b.engagedAt) {
    b.engagedAt = now;
    b.patternIdx = 0; // announced-phase marker: 0 = none yet, 1 = veiled announced, 2 = revealed announced
    b.nextSlam = now + v.firstLash;
    b.rr = now + 3.5; // next drift re-target
  }
  const phase = veilPhaseAt(now, b.engagedAt, v);
  const announced = phase === "veiled" ? 1 : 2;
  if (b.patternIdx !== announced) {
    b.patternIdx = announced;
    if (phase === "veiled") {
      b.nextSlam = now + v.firstLash; // every new veil opens with a readable windup before the first lash
      b.rr = now + 2.5;
      world.emitNear(m.x, m.z, { k: "chat", from: "System", text: `${m.def.name} draws her veil tight — strikes pass through her!`, sys: true });
    } else {
      world.emitNear(m.x, m.z, { k: "chat", from: "System", text: `${m.def.name}'s veil falls away — strike now!`, sys: true });
    }
  }
  if (phase !== "veiled") return; // REVEALED: normal chase/melee; the lash belongs to the veil
  // drift toward a player: re-pick a random target in range every few seconds so the drift is visible and can be re-positioned
  if (now >= b.rr) {
    b.rr = now + 3.5;
    const cands: Player[] = [];
    for (const p of world.players.values()) if (p.st !== "dead" && dist(p.x, p.z, m.x, m.z) <= bd.targetRange) cands.push(p);
    if (cands.length) {
      const pick = cands[Math.floor(Math.random() * cands.length)];
      m.target = pick.id;
      m.threat.set(pick.id, Math.max(1, m.threat.get(pick.id) ?? 0));
    }
  }
  // kerchief lash: on the lash timer, ready a telegraphed line swing (swingStep does the warning + the hit)
  if (now >= b.nextSlam) { b.nextSlam = now + v.lashEvery; m.nextAttack = now; }
}

// ---------------- Fox Spirit bite / Bamboo Spirit smash: ground telegraph, then a hit on everyone still inside ----------------
/** Returns true while the mob is busy with its swing (frozen wind-up or the strike itself). */
function swingStep(world: World, m: Mob, t: Player, d: number): boolean {
  const sw = m.def.swing!, now = world.time;
  if (m.swing) {
    if (now < m.swing.at) return true; // winding up: frozen, the shape is locked to where it was aimed
    const dir = m.swing.dir;
    m.swing = undefined;
    const geom = { shape: sw.shape, x: m.x, z: m.z, radius: sw.reach, dir, arc: sw.arc, len: sw.reach, width: sw.width };
    for (const p of [...world.players.values()]) {
      if (p.st === "dead" || !telegraphContains(geom, p.x, p.z, dir)) continue;
      mobAttack(world, m, p);
    }
    return true;
  }
  if (d <= m.def.attackRange && now >= m.nextAttack) {
    const dir = Math.atan2(t.x - m.x, t.z - m.z);
    m.r = dir; m.swing = { at: now + sw.windup, dir };
    m.nextAttack = now + m.def.attackCd;
    m.attackUntil = now + sw.windup + 0.3;
    const ev: GameEvent = sw.shape === "cone"
      ? { k: "telegraph", src: m.id, x: r2(m.x), z: r2(m.z), radius: sw.reach, delay: sw.windup, shape: "cone", dir: r2(dir), arc: sw.arc }
      : { k: "telegraph", src: m.id, x: r2(m.x), z: r2(m.z), radius: sw.reach, delay: sw.windup, shape: "line", dir: r2(dir), len: sw.reach, width: sw.width };
    world.emitNear(m.x, m.z, ev);
    return true;
  }
  return false;
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
  if (m.ai !== "chase" && m.swing) m.swing = undefined;
  if (m.ai === "dead") {
    if (m.boss) { m.boss.beam = undefined; if (m.def.boss!.summon) despawnAdds(world, m); } // 0.5.0: a dead boss's summons vanish with it
    if (def.boss?.veil) m.state.veiled = false; // 0.5.0: a fallen veil boss is not "veiled" any more
    if (m.visible && now >= m.deadAt + 3) m.visible = false;
    if (m.summonedBy) return; // summoned adds never respawn: the boss prunes the corpse in pruneAdds (no add accumulation)
    if (now >= m.respawnAt) {
      m.x = m.spawnX; m.z = m.spawnZ; m.hp = m.mhp; m.ai = "idle"; m.st = "idle"; m.visible = true;
      m.threat.clear(); m.target = 0; m.slowUntil = 0; m.burnUntil = 0; m.windupUntil = 0;
      if (m.boss) bossReset(world, m);
    }
    return;
  }
  if (m.boss) { bossResolve(world, m); beamTick(world, m); }
  burnTick(world, m);
  if (m.hp <= 0) return; // burn may have finished it this tick (killMob set ai/st to dead)
  // 0.5.0 veil boss: the phase is a pure function of the sim clock and the engagement time (no stored state machine).
  const veilDef = def.boss?.veil;
  let veilPhase: VeilPhase | null = veilDef && m.boss?.engagedAt ? veilPhaseAt(now, m.boss.engagedAt, veilDef) : null;
  if (veilDef) m.state.veiled = veilPhase === "veiled"; // client readability flag; undefined for every other mob
  const speed = def.speed * (now < m.slowUntil ? m.slowMult : 1) * (veilPhase === "veiled" && veilDef ? veilDef.driftSpeedMult : 1);
  let moved = false;

  if (m.ai === "idle") {
    m.packCalled = false; // 0.4.0: a pack mob may call its pack again in its next fight
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
    if (!t || dist(m.x, m.z, m.spawnX, m.spawnZ) > def.leash) { m.ai = "return"; m.target = 0; m.threat.clear(); m.windupUntil = 0; if (m.boss) bossReset(world, m); }
    else {
      if (m.boss) {
        if (def.boss!.veil) brideFight(world, m, now); // 0.5.0 veil boss: deterministic VEILED/REVEALED rhythm (no pattern rotation)
        else bossFight(world, m);
        if (veilDef) { // the engagement may have just started this tick, so re-read the phase after the boss step
          veilPhase = m.boss.engagedAt ? veilPhaseAt(now, m.boss.engagedAt, veilDef) : null;
          m.state.veiled = veilPhase === "veiled";
        }
      }
      if (def.pack && !m.packCalled) callPack(world, m, t);
      const d = dist(m.x, m.z, t.x, t.z);
      if (m.boss?.beam) { // channelling the rune beam: rooted, turning with the sweep
        m.r = beamAngle(m.boss.beam, now, def.boss!.beam.sweepTime); m.attackUntil = now + 0.3;
      } else if (def.lunge && lungeStep(world, m, t, d)) { /* busy lunging */ }
      else if (def.swing && veilPhase !== "revealed" && swingStep(world, m, t, d)) { /* telegraphed swing: the bride's lash only while VEILED */ }
      else if (d <= def.attackRange && veilPhase !== "veiled") {
        m.r = Math.atan2(t.x - m.x, t.z - m.z);
        if (now >= m.nextAttack) { m.nextAttack = now + def.attackCd; mobAttack(world, m, t); }
      } else if (veilPhase === "veiled" && d <= def.attackRange) {
        m.r = Math.atan2(t.x - m.x, t.z - m.z); // veiled: she sways in place between lashes instead of meleeing
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
