import type { GameEvent } from "../../../shared/protocol.ts";
import { CLASSES, MAX_LEVEL, TUNING, attackFor, killXp, maxHpFor, xpToNext, type SkillData } from "../data.ts";
import { ecoKill, ecoLoot, ecoXp } from "../economy.ts";
import type { Mob, Player } from "./types.ts";
import type { World } from "./world.ts";
import { questOnKill, questOnLoot } from "./quests.ts";
import { addItem } from "./inventory.ts";
import { isInvulnerable, spendQi } from "./dodge.ts";
import { dist, isNum, rand } from "./util.ts";

const aliveMob = (e: unknown): e is Mob => !!e && (e as Mob).k === "mob" && (e as Mob).ai !== "dead" && (e as Mob).hp > 0;

function roll(p: Player, sd: SkillData) {
  const c = CLASSES[p.cls];
  let amount = (attackFor(p.cls, p.lv) + p.gear.atk) * sd.power * rand(0.9, 1.1); // 0.4.0: equipment adds flat attack and crit chance
  const crit = Math.random() < c.crit + p.gear.crit;
  if (crit) amount *= c.critMult;
  return { amount: Math.max(1, Math.round(amount)), crit };
}

export function handleCast(world: World, p: Player, msg: { skill: unknown; target?: unknown; tx?: unknown; tz?: unknown }) {
  if (p.st === "dead") return;
  const id = msg.skill;
  if (!isNum(id) || !Number.isInteger(id) || id < 1 || id > 4) return;
  const sd = CLASSES[p.cls].skills[id - 1];
  const now = world.time;
  if (now < p.gcdReady || now < p.cdReady[id]) return; // not ready: silently ignore (client tracks cooldowns)

  let tx = p.x, tz = p.z;
  let target: Mob | undefined;
  if (sd.target === "enemy") {
    const e = isNum(msg.target) ? world.entities.get(msg.target) : undefined;
    if (!aliveMob(e)) return world.sysTo(p, "No valid target.");
    if (dist(p.x, p.z, e.x, e.z) > sd.def.range + TUNING.rangeSlack) return world.sysTo(p, "Target is out of range.");
    target = e; tx = e.x; tz = e.z;
  } else if (sd.target === "point") {
    const e = isNum(msg.target) ? world.entities.get(msg.target) : undefined;
    if (isNum(msg.tx) && isNum(msg.tz)) { tx = msg.tx; tz = msg.tz; }
    else if (aliveMob(e)) { tx = e.x; tz = e.z; }
    else return world.sysTo(p, "No target point.");
    if (dist(p.x, p.z, tx, tz) > sd.def.range + TUNING.rangeSlack) return world.sysTo(p, "Target is out of range.");
  }

  if (!spendQi(world, p, sd.def.qi ?? 0, sd.def.name)) return; // Qi is paid only once the cast is valid (range/target checked above)
  p.cdReady[id] = now + sd.def.cooldown;
  p.gcdReady = now + TUNING.gcd;
  p.attackUntil = now + 0.5;
  if (tx !== p.x || tz !== p.z) p.r = Math.atan2(tx - p.x, tz - p.z);
  world.emitNear(p.x, p.z, { k: "cast", src: p.id, skill: id, tx, tz });

  if (target) {
    const { amount, crit } = roll(p, sd);
    damageMob(world, p, target, amount, crit, id);
    if (sd.slow && target.hp > 0) { target.slowUntil = now + sd.slow.dur; target.slowMult = sd.slow.mult; }
  } else if (sd.target === "point") {
    for (const m of world.mobs) {
      if (!aliveMob(m) || dist(m.x, m.z, tx, tz) > (sd.radius ?? 5)) continue;
      const { amount, crit } = roll(p, sd);
      damageMob(world, p, m, amount, crit, id);
    }
  } else {
    // self-centered: heal and/or guard
    if (sd.guard) { p.guardUntil = now + sd.guard.dur; p.guardMult = sd.guard.mult; }
    const spell = (attackFor(p.cls, p.lv) + p.gear.atk) * sd.power;
    const heal = (t: Player) => healPlayer(world, p, t, Math.round(spell + (sd.healPct ?? 0) * t.mhp));
    heal(p);
    if (sd.healAllies) {
      for (const o of world.players.values())
        if (o !== p && o.st !== "dead" && dist(o.x, o.z, p.x, p.z) <= (sd.radius ?? 10)) heal(o);
    }
  }
}

export function healPlayer(world: World, src: Player, dst: Player, amount: number) {
  if (dst.st === "dead") return;
  const real = Math.min(amount, dst.mhp - dst.hp);
  if (real <= 0) return;
  dst.hp += real;
  world.emitNear(dst.x, dst.z, { k: "heal", src: src.id, dst: dst.id, amount: real });
}

export function damageMob(world: World, p: Player, m: Mob, amount: number, crit: boolean, skill?: number) {
  const dealt = Math.min(amount, m.hp);
  m.hp -= dealt;
  m.threat.set(p.id, (m.threat.get(p.id) ?? 0) + dealt);
  if (m.ai === "idle") { m.ai = "chase"; m.target = p.id; }
  world.emitNear(m.x, m.z, { k: "damage", src: p.id, dst: m.id, amount: dealt, crit, skill });
  if (m.hp <= 0) killMob(world, m, p);
}

/** Applies damage to a player (guard buff honoured), emits the event, handles death. Used by melee, slams and poison. */
export function hurtPlayer(world: World, p: Player, raw: number, srcId: number) {
  if (p.st === "dead") return 0;
  if (isInvulnerable(world, p)) { world.emitTo(p, { k: "dodged", id: p.id }); return 0; } // dodge roll i-frames
  let amount = raw;
  if (world.time < p.guardUntil) amount *= p.guardMult;
  amount *= 1 - p.gear.def; // 0.4.0: equipment damage reduction
  amount = Math.max(1, Math.round(amount));
  const dealt = Math.min(amount, p.hp);
  p.hp -= dealt;
  p.lastHurt = world.time;
  world.emitNear(p.x, p.z, { k: "damage", src: srcId, dst: p.id, amount: dealt, crit: false });
  if (p.hp <= 0) killPlayer(world, p, srcId);
  return dealt;
}

export function applyPoison(world: World, m: Mob, p: Player) {
  const lg = m.def.lunge;
  if (!lg || p.st === "dead") return;
  p.poisonDmg = lg.poisonBase + lg.poisonPerLv * m.lv;
  p.poisonUntil = world.time + lg.poisonTicks * lg.poisonEvery + 0.04;
  p.poisonNext = world.time + lg.poisonEvery;
  p.poisonSrc = m.id;
}

/** Called every tick per player: periodic poison damage as ordinary `damage` events. */
export function poisonTick(world: World, p: Player) {
  if (p.poisonUntil <= 0) return;
  if (world.time >= p.poisonNext) {
    if (world.time > p.poisonUntil) { p.poisonUntil = 0; return; }
    hurtPlayer(world, p, p.poisonDmg, p.poisonSrc);
    p.poisonNext += 1;
    if (p.poisonNext > p.poisonUntil) p.poisonUntil = 0;
  }
}

/** Respawn delay. TEST_MODE=1 with TEST_BOSS_RESPAWN=<s> shortens the boss timer so tests can observe it; never active otherwise. */
const respawnSeconds = (m: Mob) => (m.def.boss && process.env.TEST_MODE === "1" && Number(process.env.TEST_BOSS_RESPAWN) > 0 ? Number(process.env.TEST_BOSS_RESPAWN) : m.def.respawn);

export const enrageMult = (m: Mob) => (m.boss?.enraged ? m.def.boss!.enrageMult : 1);

export function mobAttack(world: World, m: Mob, p: Player) {
  const amount = (m.def.dmgBase + m.def.dmgPerLv * m.lv) * rand(0.9, 1.1) * enrageMult(m);
  m.attackUntil = world.time + 0.4;
  hurtPlayer(world, p, amount, m.id);
}

export function killMob(world: World, m: Mob, killer: Player) {
  m.hp = 0; m.ai = "dead"; m.st = "dead"; m.target = 0;
  m.deadAt = world.time; m.respawnAt = world.time + respawnSeconds(m);
  m.windupUntil = 0;
  if (m.boss) { m.boss.pending.length = 0; m.boss.engagedAt = 0; m.boss.phase2 = false; m.boss.enraged = false; }
  world.emitNear(m.x, m.z, { k: "death", id: m.id, killer: killer.id });
  for (const pid of m.threat.keys()) {
    const p = world.players.get(pid);
    if (!p) continue;
    // boss: only participants still in range get credit (no free rides from across the valley)
    if (m.def.boss && dist(p.x, p.z, m.x, m.z) > m.def.boss.creditRange) continue;
    const lvBefore = p.lv;
    grantXp(world, p, killXp(m.def.xpPerLv, m.lv, p.lv), "kill"); // level-difference scaling lives in data.ts (xpLevelMult)
    for (const loot of m.def.loot) {
      if (!(p.testDrops && process.env.TEST_MODE === "1") && Math.random() >= loot.chance) continue;
      const qty = loot.min + Math.floor(Math.random() * (loot.max - loot.min + 1));
      const stored = addItem(world, p, loot.item, "", qty);
      if (stored > 0) world.emitTo(p, { k: "loot", item: loot.item, itemZh: "", qty: stored });
      else world.sysTo(p, `Your pack is full; ${loot.item} was left behind.`);
      questOnLoot(world, p, loot.item, qty);
      if (stored > 0) ecoLoot(world, p, loot.item, stored);
    }
    questOnKill(world, p, m.def.type);
    ecoKill(world, p, m, lvBefore);
  }
  m.threat.clear();
  if (m.def.type === "stone_guardian") world.sysAll(`${m.def.name} has been defeated by ${killer.n}!`);
}

export function killPlayer(world: World, p: Player, killerId?: number) {
  p.hp = 0; p.st = "dead"; p.inDx = p.inDz = 0; p.poisonUntil = 0;
  p.respawnAt = world.time + TUNING.respawnDelay;
  world.emitNear(p.x, p.z, { k: "death", id: p.id, killer: killerId });
  world.sysTo(p, `You have fallen. You will return to the plaza in ${TUNING.respawnDelay} seconds.`);
}

/** `src`: "kill" | "quest" (default) | "daily". Daily-claim XP does not count towards the "earn XP" daily. At the cap nothing is stored, but the amount still counts for that daily. */
export function grantXp(world: World, p: Player, amount: number, src: "kill" | "quest" | "daily" = "quest") {
  if (p.lv >= MAX_LEVEL) { if (src !== "daily") ecoXp(world, p, amount); return; }
  p.xp += amount;
  let leveled = false;
  while (p.lv < MAX_LEVEL && p.xp >= xpToNext(p.lv)) {
    p.xp -= xpToNext(p.lv);
    p.lv++;
    leveled = true;
  }
  if (p.lv >= MAX_LEVEL) p.xp = 0;
  if (leveled) { p.mhp = maxHpFor(p.cls, p.lv) + p.gear.hp; p.hp = p.mhp; }
  world.emitTo(p, xpEvent(p, amount));
  if (leveled) {
    world.emitTo(p, { k: "levelup", lv: p.lv });
    world.sysAll(`${p.n} has reached level ${p.lv}!`);
  }
  if (src !== "daily") ecoXp(world, p, amount);
}

export const xpEvent = (p: Player, amount: number): GameEvent =>
  ({ k: "xp", amount, lv: p.lv, xp: p.xp, next: p.lv >= MAX_LEVEL ? 0 : xpToNext(p.lv) });
