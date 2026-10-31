// 0.5.0 P3 "The Hollow Trial": a repeatable 5-wave challenge at a fixed gate in the valley. A player at the gate starts a
// run (nearby players join it, so a party fights together); every run rolls 1-2 deterministic modifiers from a run seed and
// spawns EXISTING mob types in waves around the gate. The server owns every part of the lifecycle: start validation, wave
// spawns, wave-clear detection, the run timer, clear/fail, reward payout and — most importantly — removing every mob it
// spawned. Nothing is instanced: the trial is a scripted encounter wrapped around the normal entity/mob systems, so the
// regular AI, leash, threat and damage rules all apply unchanged.
//
// State is pushed to every player on login and on every change as `{t:"trial", state}` (see TrialStateView). The client only
// ever sends `{t:"trial", a:"start"|"leave"}`; range, cooldown, run uniqueness and rewards are all validated here.
import type { ServerMsg, TrialModifierId, TrialStateView } from "../../../shared/protocol.ts";
import { GEAR, MATERIALS, MOBS, TRIAL, TRIAL_MODIFIERS, trialModifiers, trialReward } from "../data.ts";
import { economy } from "../economy.ts";
import { addItem } from "./inventory.ts";
import { grantXp } from "./combat.ts";
import { makeMob } from "./mobs.ts";
import type { Mob, Player } from "./types.ts";
import type { World } from "./world.ts";
import { clamp, dist, rand } from "./util.ts";

/** Stored in `Mob.summonedBy` for every trial spawn. Summoned mobs never respawn (updateMob), and the marker also lets
 *  content() find trial spawns; the +1e6 offset keeps it away from boss add ids. */
export const TRIAL_MOB_MARKER = 1_000_000;

type TrialMsg = Extract<ServerMsg, { t: "trial" }>;

interface Run {
  id: number;
  participants: Set<number>;
  /** 0-based index into TRIAL.waveMobs; the HUD shows wave + 1. */
  wave: number;
  /** Entity ids spawned by the current wave (removed when the wave is cleared or the run ends). */
  mobIds: number[];
  modifiers: TrialModifierId[];
  startedAt: number;
  deadline: number;
}

const isTest = () => process.env.TEST_MODE === "1";
/** TEST_MODE only (mirrors TEST_BOSS_RESPAWN / TEST_CHEST_RESPAWN): shorten the timer/cooldown so probes can observe fail paths. */
const timeLimitSec = () => (isTest() && Number(process.env.TEST_TRIAL_TIME) > 0 ? Number(process.env.TEST_TRIAL_TIME) : TRIAL.timeLimitSec);
const cooldownSec = () => (isTest() && process.env.TEST_TRIAL_COOLDOWN !== undefined && Number(process.env.TEST_TRIAL_COOLDOWN) >= 0 ? Number(process.env.TEST_TRIAL_COOLDOWN) : TRIAL.cooldownSec);

/** Existing items the clear reward can roll (materials + rare/epic gear): never a new item definition. */
const LOOT_POOL: string[] = [...MATERIALS.map((m) => m.name), ...GEAR.filter((g) => g.rarity === "rare" || g.rarity === "epic").map((g) => g.name)];

export class TrialManager {
  private run: Run | null = null;
  private cooldownUntil = 0;
  private nextId = 1;
  /** Players that already received the login-time state (sent with their first snapshot, standard 0.5.0 pattern). */
  private readonly known = new WeakSet<Player>();

  constructor(private readonly world: World) {}

  // ---------------------------------------------------------------- dispatch / login / disconnect
  /** Handle a client `{t:"trial", a:"start"|"leave"}`. Every field is validated here. */
  handle(p: Player, msg: { a?: unknown }) {
    switch (msg.a) {
      case "start": return this.start(p);
      case "leave": return this.leave(p);
      default: return;
    }
  }

  /** Login sync: the whole state (idle + gate coords + cooldown, or the live run). */
  onLogin(p: Player) {
    if (this.known.has(p)) return;
    this.known.add(p);
    this.sendTo(p);
  }

  /** Disconnect: the participant is dropped; if nobody is left the run fails and every spawned mob is removed. */
  onPlayerLeft(p: Player) {
    const r = this.run;
    if (!r || !r.participants.delete(p.id)) return;
    if (!r.participants.size) this.fail("the last challenger left the trial");
    else this.broadcast();
  }

  // ---------------------------------------------------------------- start / leave
  start(p: Player) {
    if (p.st === "dead") return this.world.sysTo(p, "You cannot begin the trial while fallen.");
    if (this.run) return this.world.sysTo(p, "A trial is already running at the Hollow Gate.");
    const now = this.world.time;
    if (now < this.cooldownUntil) return this.world.sysTo(p, `The Hollow Gate is recharging (${Math.ceil(this.cooldownUntil - now)}s).`);
    if (dist(p.x, p.z, TRIAL.x, TRIAL.z) > TRIAL.startRange) return this.world.sysTo(p, "Stand at the Hollow Gate to begin the trial.");
    const participants = new Set<number>();
    for (const q of this.world.players.values()) if (q.st !== "dead" && dist(q.x, q.z, TRIAL.x, TRIAL.z) <= TRIAL.joinRange) participants.add(q.id);
    participants.add(p.id);
    const id = this.nextId++;
    // Deterministic per-run seed: the run counter mixed with the start time. Same seed -> same modifier roll (content-tested).
    const seed = Math.imul(id, 2654435761) ^ (Math.floor(now * 1000) & 0xffff);
    this.run = { id, participants, wave: 0, mobIds: [], modifiers: trialModifiers(seed), startedAt: now, deadline: now + timeLimitSec() };
    this.world.sysTo(p, `The Hollow Trial begins — ${TRIAL.waves} waves${this.run.modifiers.length ? ` (${this.run.modifiers.map((m) => TRIAL_MODIFIERS.find((d) => d.id === m)?.name ?? m).join(", ")})` : ""}.`);
    for (const q of this.participants()) if (q.id !== p.id) this.world.sysTo(q, `${p.n} begins the Hollow Trial — fight beside them!`);
    this.spawnWave();
  }

  leave(p: Player) {
    const r = this.run;
    if (!r) { this.sendTo(p); return; }
    if (!r.participants.delete(p.id)) return;
    if (!r.participants.size) return this.fail("the last challenger left the trial");
    this.world.sysTo(p, "You leave the Hollow Trial.");
    this.broadcast();
  }

  // ---------------------------------------------------------------- the run loop (0.5 s upkeep from world.step)
  tick() {
    const r = this.run;
    if (!r) return;
    const now = this.world.time;
    let changed = false;
    // participants: drop the fallen / disconnected / far-gone, add players who joined while it runs (a nearby party).
    for (const id of [...r.participants]) {
      const q = this.world.players.get(id);
      if (!q || q.st === "dead" || dist(q.x, q.z, TRIAL.x, TRIAL.z) > TRIAL.dropRange) { r.participants.delete(id); changed = true; }
    }
    for (const q of this.world.players.values()) {
      if (q.st !== "dead" && !r.participants.has(q.id) && dist(q.x, q.z, TRIAL.x, TRIAL.z) <= TRIAL.joinRange) { r.participants.add(q.id); changed = true; }
    }
    if (!r.participants.size) return this.fail("every challenger fell or left the trial");
    if (now >= r.deadline) return this.fail("the trial timer ran out");
    const alive = this.aliveMobs(r);
    if (alive === 0) {
      this.clearSpawned(); // remove the current wave (corpses included)
      r.wave++;
      if (r.wave >= TRIAL.waves) return this.clearRun();
      this.spawnWave();
      return;
    }
    if (changed) this.broadcast();
  }

  // ---------------------------------------------------------------- waves / end states
  /** Spawn TRIAL.waveMobs[r.wave] around the gate, with the rolled modifiers baked into each mob's (cloned) definition. */
  private spawnWave() {
    const r = this.run!;
    const groups = TRIAL.waveMobs[r.wave];
    if (!groups) return;
    const swift = r.modifiers.includes("swift"), armoured = r.modifiers.includes("armoured"), frenzied = r.modifiers.includes("frenzied"), sparse = r.modifiers.includes("sparse");
    for (const g of groups) {
      const def = { ...MOBS[g.type] }; // per-run clone: modifiers never leak into the shared MOBS data
      if (swift) { def.speed *= 1.35; def.attackCd *= 0.85; }
      if (frenzied) { def.dmgBase *= 1.3; def.dmgPerLv *= 1.3; def.attackCd *= 0.8; }
      const count = sparse ? Math.max(1, Math.ceil(g.count * TRIAL.sparseMult)) : g.count;
      for (let i = 0; i < count; i++) {
        const a = rand(0, Math.PI * 2), rad = rand(TRIAL.spawnInner, TRIAL.spawnOuter);
        const x = clamp(TRIAL.x + Math.cos(a) * rad, -this.world.half, this.world.half);
        const z = clamp(TRIAL.z + Math.sin(a) * rad, -this.world.half, this.world.half);
        const m = makeMob(this.world, def, x, z, g.lv);
        if (armoured) { m.mhp = Math.round(m.mhp * 1.4); m.hp = m.mhp; }
        m.summonedBy = TRIAL_MOB_MARKER + r.id; // never respawns (updateMob treats summoned mobs as one-shot)
        const tgt = this.nearestParticipant(x, z);
        if (tgt) { m.ai = "chase"; m.target = tgt.id; m.threat.set(tgt.id, 1); }
        this.world.entities.set(m.id, m);
        this.world.mobs.push(m);
        r.mobIds.push(m.id);
      }
    }
    for (const q of this.participants()) this.world.sysTo(q, `Hollow Trial — wave ${r.wave + 1}/${TRIAL.waves}: ${this.aliveMobs(r)} foes rise around the gate.`);
    this.broadcast();
  }

  /** Remove every mob this trial spawned (alive or corpse) from the world: entities map + the update list. */
  private clearSpawned() {
    const r = this.run;
    if (!r) return;
    for (const id of r.mobIds) {
      const e = this.world.entities.get(id);
      if (!e) continue;
      this.world.entities.delete(id);
      const i = this.world.mobs.indexOf(e as Mob);
      if (i >= 0) this.world.mobs.splice(i, 1);
      const m = e as Mob;
      m.threat.clear();
      m.target = 0;
      m.ai = "dead";
    }
    r.mobIds = [];
  }

  /** All five waves cleared: pay out through the existing economy/XP/inventory paths, then clean up and start the cooldown. */
  private clearRun() {
    const r = this.run!;
    const rewards = trialReward(TRIAL.waves, r.modifiers.length);
    const winners = this.participants();
    this.clearSpawned();
    for (const p of winners) {
      economy()!.addCoin(this.world, p, rewards.coin);
      economy()!.addJade(this.world, p, rewards.jade);
      grantXp(this.world, p, rewards.xp, "quest");
      this.world.sysTo(p, `Hollow Trial cleared! You receive ${rewards.coin} coin, ${rewards.jade} jade and ${rewards.xp} XP.`);
    }
    for (const p of winners) {
      if (Math.random() >= rewards.itemChance || !LOOT_POOL.length) continue;
      const item = LOOT_POOL[Math.floor(Math.random() * LOOT_POOL.length)];
      const stored = addItem(this.world, p, item, "", 1);
      if (stored > 0) { this.world.emitTo(p, { k: "loot", item, itemZh: "", qty: stored }); this.world.sysTo(p, `The trial yields ${item}.`); }
    }
    this.finish("clear", `Hollow Trial cleared! +${rewards.coin} coin, +${rewards.jade} jade, +${rewards.xp} XP.`);
  }

  private fail(reason: string) {
    if (!this.run) return;
    const losers = this.participants();
    this.clearSpawned();
    for (const p of losers) this.world.sysTo(p, `Hollow Trial failed: ${reason}. No rewards this time.`);
    this.finish("fail", `Hollow Trial failed: ${reason}.`);
  }

  /** End the run: store the cooldown, clear the pointer, then broadcast the terminal state (with `result`) to everyone. */
  private finish(result: "clear" | "fail", resultText: string) {
    if (!this.run) return;
    this.run = null;
    this.cooldownUntil = this.world.time + cooldownSec();
    const json = JSON.stringify({ t: "trial", state: this.view(result, resultText) } satisfies TrialMsg);
    for (const p of this.world.players.values()) p.send(json);
  }

  // ---------------------------------------------------------------- state / helpers
  private view(result?: "clear" | "fail", resultText?: string): TrialStateView {
    const r = this.run, now = this.world.time;
    return {
      active: !!r,
      wave: r ? r.wave + 1 : 0,
      waves: TRIAL.waves,
      modifiers: r ? [...r.modifiers] : [],
      mobsLeft: r ? this.aliveMobs(r) : 0,
      participants: r ? this.participants().map((p) => p.n) : [],
      endsIn: r ? Math.max(0, Math.ceil(r.deadline - now)) : 0,
      cooldown: Math.max(0, Math.ceil(this.cooldownUntil - now)),
      gate: { x: TRIAL.x, z: TRIAL.z },
      startRange: TRIAL.startRange,
      ...(result ? { result } : {}),
      ...(resultText ? { resultText } : {}),
    };
  }

  /** Live hostiles of the current wave (dead mobs are ignored so the wave can clear the moment the last one falls). */
  private aliveMobs(r: Run): number {
    let n = 0;
    for (const id of r.mobIds) {
      const m = this.world.entities.get(id) as Mob | undefined;
      if (m && m.ai !== "dead" && m.hp > 0) n++;
    }
    return n;
  }

  private participants(): Player[] {
    const r = this.run;
    if (!r) return [];
    const out: Player[] = [];
    for (const id of r.participants) { const p = this.world.players.get(id); if (p) out.push(p); }
    return out;
  }

  private nearestParticipant(x: number, z: number): Player | null {
    let best: Player | null = null, bd = Infinity;
    for (const p of this.participants()) { const d = dist(p.x, p.z, x, z); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  private sendTo(p: Player) { p.send(JSON.stringify({ t: "trial", state: this.view() } satisfies TrialMsg)); }

  private broadcast() {
    const json = JSON.stringify({ t: "trial", state: this.view() } satisfies TrialMsg);
    for (const p of this.world.players.values()) p.send(json);
  }
}
