// All tunable game data lives here: zone, classes/skills, mobs, spawns, NPCs, XP curve.
import { realmForLevel } from "../../shared/protocol.ts";
import type { ClassId, GearSlot, GearStats, ItemInfo, MobType, Rarity, SkillDef, ZoneInfo } from "../../shared/protocol.ts";

export const ZONE: ZoneInfo = {
  id: "cloudmist_valley",
  name: "Cloudmist Valley",
  nameZh: "",
  size: 200,
  spawn: { x: 0, z: -80 },
};

export const TUNING = {
  respawnDelay: 5,        // seconds a dead player waits before returning to spawn
  corpseTime: 3,          // seconds a dead mob stays visible
  rangeSlack: 1.5,        // latency tolerance added to skill range checks
  gcd: 0.3,               // global cooldown between any two casts
  inputStale: 0.5,        // seconds; last input is dropped if the client goes quiet
  outOfCombat: 5,         // seconds without damage before player regen starts
  regenPctPerSec: 0.02,
  maxPlayers: 100,
  chatMax: 120,
  // networking robustness
  heartbeatMs: 5000,       // ping interval
  heartbeatMissed: 6,      // silent intervals tolerated before a client is dropped (6 x 5 s = 30 s of total silence)
  snapDropBuffered: 256_000,   // bytes queued on a socket above which snapshots are skipped (not sent) for it
  killBuffered: 16_000_000,    // bytes queued above which the connection is considered dead and terminated
  // first-minutes friendliness
  safeSpawnRadius: 35,     // no mob spawn point within this distance of ZONE.spawn
};

// ---------------- Mist Surge: a repeating world event (0.5.0) ----------------
/** The Mist Surge is derived from the deterministic simulation clock (`world.time`), so no per-player state is involved.
 *  For the first `durationSec` of every `intervalSec` window every mob deals `mobDamageMult` times its normal damage.
 *  The first window opens one full interval after a world starts (a fresh world begins calm), then it repeats forever. */
export const MIST_SURGE = {
  intervalSec: 480,      // one surge window every 8 minutes
  durationSec: 90,       // ...of which the surge is active for 90 seconds
  mobDamageMult: 1.2,    // +20% mob damage while it runs
};

/** The Mist Surge window at `time` seconds of sim time. `endsIn` = whole seconds left in an active surge (0 when inactive). */
export function mistSurgeAt(time: number): { active: boolean; endsIn: number } {
  const { intervalSec, durationSec } = MIST_SURGE;
  if (!(intervalSec > 0) || !(durationSec > 0) || durationSec >= intervalSec) return { active: false, endsIn: 0 }; // disabled/misconfigured
  const t = time - intervalSec; // first window opens after one quiet interval
  if (t < 0) return { active: false, endsIn: 0 };
  const into = t % intervalSec;
  if (into >= durationSec) return { active: false, endsIn: 0 };
  return { active: true, endsIn: Math.max(1, Math.ceil(durationSec - into)) };
}

/** Damage multiplier mobs deal at `time`: 1 normally, `mobDamageMult` during a Mist Surge. */
export const mistSurgeMult = (time: number) => (mistSurgeAt(time).active ? MIST_SURGE.mobDamageMult : 1);

// ---------------- Lantern Tide: a second repeating world event (0.5.0) ----------------
/** The Lantern Tide shares the Mist Surge shape and the same deterministic clock derivation, but rewards instead of threatens:
 *  while it runs, kills pay a bounded bonus (kill coin x `coinMult`, kill XP x `xpMult`). It is a multiplier on the existing
 *  kill-reward path, never a new reward source, so the economy stays inside its tested bounds. The first window opens one
 *  full interval after a world starts, so a fresh server (and every server test suite) begins calm. */
export const LANTERN_TIDE = {
  intervalSec: 600,      // one tide window every 10 minutes
  durationSec: 120,      // ...of which the tide is active for 2 minutes
  coinMult: 1.5,         // +50% coin from kills while the tide is on
  xpMult: 1.25,          // +25% kill XP while the tide is on
};

/** The Lantern Tide window at `time` seconds of sim time. `endsIn` = whole seconds left in an active tide (0 when inactive). */
export function lanternTideAt(time: number): { active: boolean; endsIn: number } {
  const { intervalSec, durationSec } = LANTERN_TIDE;
  if (!(intervalSec > 0) || !(durationSec > 0) || durationSec >= intervalSec) return { active: false, endsIn: 0 }; // disabled/misconfigured
  const t = time - intervalSec; // first window opens after one quiet interval
  if (t < 0) return { active: false, endsIn: 0 };
  const into = t % intervalSec;
  if (into >= durationSec) return { active: false, endsIn: 0 };
  return { active: true, endsIn: Math.max(1, Math.ceil(durationSec - into)) };
}

/** Kill-coin multiplier at `time`: 1 normally, `coinMult` during a Lantern Tide (rounded by the caller, after the base roll). */
export const lanternTideCoinMult = (time: number) => (lanternTideAt(time).active ? LANTERN_TIDE.coinMult : 1);
/** Kill-XP multiplier at `time`: 1 normally, `xpMult` during a Lantern Tide (rounded by the caller, after killXp). */
export const lanternTideXpMult = (time: number) => (lanternTideAt(time).active ? LANTERN_TIDE.xpMult : 1);

// ---------------- Market Day: a third repeating world event (0.5.0) ----------------
/** Market Day is the economy counterpart of the other two events: for the first `durationSec` of every `intervalSec` window
 *  Peddler Hao's transactions shift in the player's favour - he buys from players for `sellMult` times the normal sell
 *  price and sells to players for `buyMult` times the normal SHOP price. The multipliers are applied only when a shop
 *  transaction is priced (`buy`/`sell` in game/content.ts) and the shop dialog quotes the same shifted prices; the static
 *  SHOP table, kill rewards, quest rewards and daily claims are untouched. The first window opens one full interval after a
 *  world starts (and the interval is longer than every server test suite), so a fresh world begins calm. */
export const MARKET_DAY = {
  intervalSec: 900,      // one market window every 15 minutes
  durationSec: 180,      // ...of which the market is open for 3 minutes
  buyMult: 0.75,         // buying from Peddler Hao costs 25% less
  sellMult: 1.5,         // selling to Peddler Hao pays 50% more
};

/** The Market Day window at `time` seconds of sim time. `endsIn` = whole seconds left in an open market (0 when inactive). */
export function marketDayAt(time: number): { active: boolean; endsIn: number } {
  const { intervalSec, durationSec } = MARKET_DAY;
  if (!(intervalSec > 0) || !(durationSec > 0) || durationSec >= intervalSec) return { active: false, endsIn: 0 }; // disabled/misconfigured
  const t = time - intervalSec; // first window opens after one quiet interval
  if (t < 0) return { active: false, endsIn: 0 };
  const into = t % intervalSec;
  if (into >= durationSec) return { active: false, endsIn: 0 };
  return { active: true, endsIn: Math.max(1, Math.ceil(durationSec - into)) };
}

/** Shop-buying multiplier at `time`: 1 normally, `buyMult` (< 1) while the market is open (applied to the SHOP price by the caller). */
export const marketBuyMult = (time: number) => (marketDayAt(time).active ? MARKET_DAY.buyMult : 1);
/** Shop-selling multiplier at `time`: 1 normally, `sellMult` (> 1) while the market is open (applied to the sell price by the caller). */
export const marketSellMult = (time: number) => (marketDayAt(time).active ? MARKET_DAY.sellMult : 1);

// ---------------- Qi and dodge roll (0.4.0) ----------------
/** Jade Qi pool. Every skill costs Qi (see the `qi` field of each skill below) and the dodge roll costs `dodgeCost`.
 *  Balance target: casting every skill the moment it comes off cooldown costs ~10.5-11 Qi/s against 10 Qi/s regen, so rotation alone is almost
 *  sustainable; every dodge (15) or mashed cooldown comes out of the pool, which empties after ~20 s of dodging between casts. Tension comes from dodging. */
export const QI = {
  max: 100,
  regenPerSec: 10,
  regenDelay: 0.4,       // seconds after spending before regeneration resumes
  dodgeCost: 15,
  dodgeDist: 6,          // world units covered by the roll
  dodgeTime: 0.25,       // seconds the roll lasts == i-frame length
  dodgeCooldown: 1.5,
  msgEvery: 1,           // min seconds between "not enough Qi" messages per player
};

// ---------------- Levelling ----------------
export const MAX_LEVEL = 20;
/** XP needed to go from `lv` to `lv + 1`: round(30 * lv^1.6). lv1 30, lv2 91, lv5 394, lv8 836, lv10 1194, lv19 3335. Total to lv8 2167, to the cap 26063.
 *  Pacing target (about one kill per 30-40 s incl. walking/resting, plus quests): lv8 in ~12-15 min, the cap in ~1.5 h. Callers never ask for it at the cap. */
export const xpToNext = (lv: number) => Math.round(30 * Math.pow(Math.max(1, lv), 1.6));
/** Clamp a stored (level, xp) pair into the current curve: level in [1, MAX_LEVEL], carry over any xp that now exceeds the (new) threshold, xp = 0 at the cap. */
export function normalizeProgress(level: number, xp: number): { lv: number; xp: number } {
  let lv = Number.isFinite(level) ? Math.min(MAX_LEVEL, Math.max(1, Math.floor(level))) : 1;
  let x = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  while (lv < MAX_LEVEL && x >= xpToNext(lv)) { x -= xpToNext(lv); lv++; }
  if (lv >= MAX_LEVEL) x = 0;
  return { lv, xp: x };
}
/** Kill-XP multiplier by level difference d = mobLevel - playerLevel. Red/orange (mob higher) pays up to +50% at +5; at or up to 2 below is full;
 *  then it fades (grey): -3 0.8, -4 0.6, -5 0.4, -6 0.2, -7 or lower 0.1 (never below 1 xp). */
export function xpLevelMult(d: number): number {
  if (d >= 0) return 1 + 0.1 * Math.min(d, 5);
  if (d >= -2) return 1;
  return [0.8, 0.6, 0.4, 0.2][-d - 3] ?? 0.1;
}
export const killXp = (xpPerLv: number, mobLv: number, playerLv: number) => Math.max(1, Math.round(xpPerLv * mobLv * xpLevelMult(mobLv - playerLv)));

// ---------------- Economy: two-tier currency ----------------
/** coin = soft currency dropped by mobs; jade = rare currency (boss, finishing Elder Lin's chain, dailies). */
export const COIN = {
  dropChance: 0.85,              // normal mobs; bosses always drop
  base: 2, perLv: 1.5,           // average coin per kill = base + perLv * mobLv, +-30 %
  spread: [0.7, 1.3] as [number, number],
  bossMult: 12,
  minGreyMult: 0.25,             // grey mobs (xp mult < 0.25) still pay a quarter
};
export const JADE = { bossKill: 3, chainComplete: 10 };

// ---------------- Daily quest board ----------------
export interface DailyDef {
  id: string; title: string; desc: string;
  kind: "kill" | "loot" | "xp" | "talk";   // what advances it
  target: string;                          // mob type / item name / npc key ("mei"); unused for xp
  need: number;
  coin: number; jade: number; xp: number;  // rewards
}
export const DAILY_COUNT = 3;
export const DAILY_POOL: DailyDef[] = [
  { id: "bamboo_purge", title: "Bamboo Purge", desc: "Slay 15 Bamboo Spirits.", kind: "kill", target: "bamboo_spirit", need: 15, coin: 60, jade: 1, xp: 250 },
  { id: "fox_tails", title: "Tails for the Tinker", desc: "Gather 6 Fox Tails.", kind: "loot", target: "Fox Tail", need: 6, coin: 80, jade: 1, xp: 300 },
  { id: "pond_patrol", title: "Pond Patrol", desc: "Defeat 5 Jade Serpents.", kind: "kill", target: "jade_serpent", need: 5, coin: 70, jade: 1, xp: 300 },
  { id: "shrine_duty", title: "Shrine Duty", desc: "Defeat the Stone Guardian.", kind: "kill", target: "stone_guardian", need: 1, coin: 250, jade: 3, xp: 1200 },
  { id: "word_with_mei", title: "A Word with Mei", desc: "Speak to Lantern Keeper Mei.", kind: "talk", target: "mei", need: 1, coin: 20, jade: 1, xp: 100 },
  { id: "steady_cultivation", title: "Steady Cultivation", desc: "Earn 1500 XP.", kind: "xp", target: "", need: 1500, coin: 100, jade: 1, xp: 400 },
  // 0.5.0: newer content on Fen's board. Normal dailies stay in the 60-100 coin / 250-400 XP band;
  // the two new bosses pay like Shrine Duty (a boss daily is always the premium task).
  { id: "reed_sweep", title: "Reed Sweep", desc: "Defeat 8 Thorn Sprites.", kind: "kill", target: "thorn_sprite", need: 8, coin: 65, jade: 1, xp: 280 },
  { id: "hollow_lights", title: "Hollow Lights", desc: "Defeat 6 Ink Wisps.", kind: "kill", target: "ink_wisp", need: 6, coin: 70, jade: 1, xp: 300 },
  { id: "cold_light", title: "Cold Light", desc: "Gather 4 Wisp Essence.", kind: "loot", target: "Wisp Essence", need: 4, coin: 80, jade: 1, xp: 320 },
  { id: "second_ward", title: "The Second Ward", desc: "Defeat the Mist Warden.", kind: "kill", target: "mist_warden", need: 1, coin: 230, jade: 3, xp: 1150 },
  { id: "masked_summoner", title: "The Masked Summoner", desc: "Defeat the Hollow Hierophant.", kind: "kill", target: "hollow_hierophant", need: 1, coin: 280, jade: 4, xp: 1400 },
  // 0.5.0: the fourth boss daily. Boss dailies stay at or above the best normal daily (100 coin / 1 jade / 400 XP).
  { id: "hollow_wedding", title: "The Hollow Wedding", desc: "Defeat the Hollow Bride.", kind: "kill", target: "hollow_bride", need: 1, coin: 320, jade: 4, xp: 1600 },
  // 0.5.0 P3: the Twin Wardens daily asks for BOTH wardens (the pair is the encounter).
  { id: "twin_wardens", title: "The Twin Wardens", desc: "Defeat both Twin Wardens.", kind: "kill", target: "twin_warden", need: 2, coin: 340, jade: 4, xp: 1700 },
];

// ---------------- Classes & skills ----------------
export interface SkillData {
  def: SkillDef;
  target: "enemy" | "point" | "self"; // what the client must supply
  power: number;       // multiplier on caster attack stat (damage, or spell power for heals)
  radius?: number;     // aoe radius / ally heal radius
  healPct?: number;    // extra heal as fraction of target max HP
  healAllies?: boolean;// heal nearby allied players too (centered on caster)
  slow?: { mult: number; dur: number }; // applied to mob hit
  burn?: { base: number; perLv: number; ticks: number; every: number }; // damage over time applied to the mob hit
  guard?: { mult: number; dur: number };// incoming damage multiplier on caster
}
export interface ClassData {
  name: string;
  baseHp: number; hpPerLevel: number;
  atk: number; atkPerLevel: number;
  crit: number; critMult: number;
  skills: SkillData[]; // index 0..3 => skill ids 1..4
}

const sk = (id: number, name: string, nameZh: string, cooldown: number, range: number, kind: SkillDef["kind"], qi: number): SkillDef =>
  ({ id, name, nameZh, cooldown, range, kind, qi });

export const CLASSES: Record<ClassId, ClassData> = {
  sword: {
    name: "Sword Cultivator", baseHp: 120, hpPerLevel: 25, atk: 9, atkPerLevel: 3, crit: 0.12, critMult: 1.6,
    skills: [
      { def: sk(1, "Flowing Slash", "", 1.0, 3.5, "melee", 3), target: "enemy", power: 1.0 },
      { def: sk(2, "Sword Qi Wave", "", 3.0, 14, "bolt", 12), target: "enemy", power: 1.3 },
      { def: sk(3, "Heaven-Splitting Strike", "", 8.0, 4.0, "melee", 25), target: "enemy", power: 3.2 },
      { def: sk(4, "Qi Guard", "", 15.0, 0, "heal", 15), target: "self", power: 0, healPct: 0.1, guard: { mult: 0.5, dur: 5 } },
    ],
  },
  talisman: {
    name: "Talisman Master", baseHp: 90, hpPerLevel: 18, atk: 8, atkPerLevel: 3, crit: 0.15, critMult: 1.7,
    skills: [
      { def: sk(1, "Fire Talisman", "", 1.2, 20, "bolt", 5), target: "enemy", power: 1.1, burn: { base: 1.5, perLv: 0.7, ticks: 3, every: 1 } },
      { def: sk(2, "Thunder Talisman", "", 6.0, 24, "aoe", 20), target: "point", power: 1.6, radius: 6 },
      { def: sk(3, "Frost Seal", "", 8.0, 18, "bolt", 15), target: "enemy", power: 0.8, slow: { mult: 0.4, dur: 4 } },
      { def: sk(4, "Wind Step", "", 12.0, 0, "heal", 15), target: "self", power: 0, guard: { mult: 0.6, dur: 4 } },
    ],
  },
  physician: {
    name: "Physician", baseHp: 105, hpPerLevel: 22, atk: 6, atkPerLevel: 2.5, crit: 0.1, critMult: 1.5,
    skills: [
      { def: sk(1, "Jade Needle", "", 1.0, 16, "bolt", 3), target: "enemy", power: 1.0 },
      { def: sk(2, "Spring Rain", "", 7.0, 0, "heal", 22), target: "self", power: 3.0, healPct: 0.15, radius: 12, healAllies: true },
      { def: sk(3, "Purifying Light", "", 6.0, 14, "aoe", 18), target: "point", power: 2.2, radius: 5 },
      { def: sk(4, "Meridian Surge", "", 20.0, 0, "heal", 30), target: "self", power: 0, healPct: 0.4 },
    ],
  },
  blade: {
    name: "Blade Dancer", baseHp: 100, hpPerLevel: 20, atk: 8, atkPerLevel: 2.8, crit: 0.2, critMult: 1.7,
    skills: [
      { def: sk(1, "Gale Slash", "", 0.8, 3.5, "melee", 3), target: "enemy", power: 0.85 },
      { def: sk(2, "Whirlwind Arc", "", 3.0, 14, "bolt", 12), target: "enemy", power: 1.4 },
      { def: sk(3, "Storm of Blades", "", 8.0, 0, "aoe", 20), target: "point", power: 1.8, radius: 5 },
      { def: sk(4, "Dancer's Grace", "", 12.0, 0, "heal", 15), target: "self", power: 0, healPct: 0.08, guard: { mult: 0.55, dur: 5 } },
    ],
  },
};

/** Max HP from class levels plus the cultivation realm's flat bonus (see REALMS in shared/protocol.ts). The bonus only
 *  changes at a breakthrough level (5/10/15/20), so every level still adds hpPerLevel and the curve stays monotonic. */
export const maxHpFor = (cls: ClassId, lv: number) => CLASSES[cls].baseHp + CLASSES[cls].hpPerLevel * (lv - 1) + realmForLevel(lv).hpBonus;
export const attackFor = (cls: ClassId, lv: number) => CLASSES[cls].atk + CLASSES[cls].atkPerLevel * (lv - 1);

// ---------------- Mobs ----------------
export interface LootEntry { item: string; itemZh: string; chance: number; min: number; max: number }
export interface LungeDef {
  range: number;        // starts a lunge when the target is within this distance
  windup: number;       // seconds the mob freezes (telegraphed by its attack anim) before it dashes
  reach: number;        // the strike lands only if the target is within this distance of where the dash ends
  poisonBase: number; poisonPerLv: number; poisonTicks: number; poisonEvery: number; // damage over time as periodic `damage` events
}
export interface BossDef {
  slamEvery: [number, number];   // seconds between telegraphs (random in range), phase 1
  slamEvery2: number;            // seconds between telegraphs below phase2At
  firstSlam: number;             // seconds after engage until the first telegraph
  phase2At: number;              // hp fraction
  slam: { radius: number; delay: number; dmg: number };      // pattern A: circle on a player
  stomp: { radius: number; delay: number; dmg: number };     // pattern B: circle around the boss
  scatter: { radius: number; delay: number; dmg: number; n: number; spread: number }; // pattern C (phase 2): n circles around a player
  phase3At: number;              // hp fraction: the Guardian cracks open and gains the rotating rune beam
  beam: { len: number; width: number; lead: number; sweepTime: number; sweep: number; tickEvery: number; dmg: number }; // pattern D (phase 3): sweeping line, damage per tick to everyone on it after `lead`
  enrageAfter: number;           // seconds of continuous combat until enrage
  enrageMult: number;            // damage multiplier when enraged
  creditRange: number;           // players within this distance of the boss at death are credited
  targetRange: number;           // telegraph targets are chosen among players this close
  /** 0.5.0 summon-adds mechanic: while engaged, every `every` seconds call `count` minions of `type` beside the boss. */
  summon?: { type: MobType; count: number; every: number };
  /** 0.5.0 The Hollow Bride: a deterministic VEILED/REVEALED rhythm instead of (or in front of) the pattern rotation.
   *  The phase is derived from `world.time - boss.engagedAt`, so the state machine stores no extra per-mob data. */
  veil?: VeilDef;
  /** 0.5.0 P3 The Twin Wardens: the linked-pair mechanic (shared ward while both live, survivor enrage, pair-kill bonus). */
  twin?: TwinDef;
}

/** 0.5.0 P3 The Twin Wardens: TWO bosses that are stronger together. While BOTH live each takes `wardDamageMult` damage
 *  (-35% by default); when one dies the survivor's BossDef.enrageMult applies (+55%) and its pattern cadence drops to 75%,
 *  and a `togetherWindowSec` window opens: killing the survivor inside it pays the together bonus (coin + jade + an existing
 *  rare item through the normal loot path). Natural `enrageAfter` is pushed far out so the only enrage is the bonded one. */
export interface TwinDef {
  wardDamageMult: number;     // damage-taken multiplier while both wardens are alive (0.65 = -35%)
  togetherWindowSec: number;  // kill the survivor within this many seconds of its partner for the together bonus
  togetherCoin: number;       // bonus coin per credited killer on a together kill
  togetherJade: number;       // bonus jade per credited killer on a together kill
  togetherItem: string;       // an EXISTING item, granted through the normal inventory/loot path on a together kill
}

/** VEILED/REVEALED rhythm for a veil boss (data-driven; see veilPhaseAt). While VEILED the boss is immune to all damage and
 *  only lashes with its telegraphed swing while drifting; while REVEALED it takes full damage and hits `revealDmgMult` harder. */
export interface VeilDef {
  veilSec: number;        // VEILED phase length, seconds
  revealSec: number;      // REVEALED phase length, seconds (the damage window)
  lashEvery: number;      // seconds between telegraphed lashes while VEILED (a new veil always opens with `firstLash`)
  firstLash: number;      // delay after a veil begins until the first lash
  revealDmgMult: number;  // melee damage multiplier while REVEALED (the "hits harder" part)
  driftSpeedMult: number; // movement multiplier while VEILED (she drifts, she does not charge)
}

export type VeilPhase = "veiled" | "revealed";
/** Deterministic phase for a veil boss: the first `veilSec` seconds of each cycle after engagement are VEILED, the rest REVEALED.
 *  A boss that has not engaged yet (engagedAt 0) is reported as REVEALED, so damage is never wrongly blocked before the fight. */
export function veilPhaseAt(time: number, engagedAt: number, veil: VeilDef): VeilPhase {
  const cycle = veil.veilSec + veil.revealSec;
  if (!(cycle > 0) || !(engagedAt > 0)) return "revealed";
  const elapsed = Math.max(0, time - engagedAt);
  return elapsed % cycle < veil.veilSec ? "veiled" : "revealed";
}
/** Ground-telegraphed melee swing: the mob freezes for `windup` s showing a cone/line in front of it, then hits everyone still inside. */
export interface SwingDef { shape: "cone" | "line"; windup: number; reach: number; arc: number /* cone opening, radians */; width: number /* line width */ }
export interface MobDef {
  type: MobType; name: string;
  hpBase: number; hpPerLv: number;
  dmgBase: number; dmgPerLv: number;
  speed: number; aggro: number; leash: number; wander: number;
  attackRange: number; attackCd: number;
  respawn: number;      // seconds after death
  xpPerLv: number;
  loot: LootEntry[];
  lunge?: LungeDef;
  swing?: SwingDef;
  boss?: BossDef;
  pack?: number;        // 0.4.0: when this mob starts a fight, idle mobs of the same type within this distance join it
  rare?: boolean;       // 0.4.0: named rare spawn (announced when it falls)
}
export const MOBS: Record<MobType, MobDef> = {
  bamboo_spirit: {
    type: "bamboo_spirit", name: "Bamboo Spirit", hpBase: 60, hpPerLv: 30, dmgBase: 4, dmgPerLv: 2,
    speed: 3.2, aggro: 9, leash: 30, wander: 8, attackRange: 2.2, attackCd: 1.6, respawn: 15, xpPerLv: 10,
    loot: [{ item: "Bamboo Fiber", itemZh: "", chance: 0.7, min: 1, max: 2 }],
    swing: { shape: "line", windup: 0.5, reach: 3.6, arc: 0, width: 1.9 }, // stalk smash: strip in front of it
  },
  fox_spirit: {
    type: "fox_spirit", name: "Fox Spirit", hpBase: 90, hpPerLv: 40, dmgBase: 4.5, dmgPerLv: 2,
    speed: 4.6, aggro: 14, leash: 38, wander: 10, attackRange: 2.4, attackCd: 1.4, respawn: 25, xpPerLv: 12,
    loot: [{ item: "Fox Tail", itemZh: "", chance: 0.6, min: 1, max: 1 }, { item: "Fox-Fur Boots", itemZh: "", chance: 0.03, min: 1, max: 1 }],
    swing: { shape: "cone", windup: 0.4, reach: 3.5, arc: 1.45, width: 0 }, // bite: ~83 degree cone
  },
  // Jade Serpent: fast lunge with a 0.55 s windup, then poison (periodic damage events) for 4 s. lv2-4 around the pond/bridge.
  jade_serpent: {
    type: "jade_serpent", name: "Jade Serpent", hpBase: 80, hpPerLv: 40, dmgBase: 3, dmgPerLv: 1.5,
    speed: 4.4, aggro: 9, leash: 32, wander: 6, attackRange: 2.6, attackCd: 3.0, respawn: 25, xpPerLv: 12,
    loot: [
      { item: "Jade Scale", itemZh: "", chance: 0.7, min: 1, max: 1 },
      { item: "Serpent Gall", itemZh: "", chance: 0.08, min: 1, max: 1 },
    ],
    lunge: { range: 7, windup: 0.55, reach: 2.8, poisonBase: 2, poisonPerLv: 0.7, poisonTicks: 4, poisonEvery: 1 },
  },
  stone_guardian: {
    type: "stone_guardian", name: "Stone Guardian", hpBase: 800, hpPerLv: 150, dmgBase: 24, dmgPerLv: 1,
    speed: 3.0, aggro: 12, leash: 40, wander: 3, attackRange: 4.0, attackCd: 2.6, respawn: 120, xpPerLv: 250,
    loot: [{ item: "Guardian Core", itemZh: "", chance: 1, min: 1, max: 1 }],
    boss: {
      slamEvery: [8, 10], slamEvery2: 8, firstSlam: 3,
      phase2At: 0.5,
      slam: { radius: 7, delay: 1.8, dmg: 90 },
      stomp: { radius: 8, delay: 1.7, dmg: 80 },
      scatter: { radius: 4.5, delay: 2.0, dmg: 55, n: 3, spread: 9 },
      phase3At: 0.25,
      beam: { len: 28, width: 2.8, lead: 0.9, sweepTime: 3.0, sweep: Math.PI / 2, tickEvery: 0.3, dmg: 26 },
      enrageAfter: 150, enrageMult: 1.5, creditRange: 70, targetRange: 40,
    },
  },
  // ---- 0.4.0 content mobs ----
  // Lotus Toad Warden: passive until hit (aggro ~0), then spits a slow bolt modelled as a long narrow line telegraph. Pond shore, lv3-5.
  lotus_toad: {
    type: "lotus_toad", name: "Lotus Toad Warden", hpBase: 70, hpPerLv: 35, dmgBase: 3, dmgPerLv: 1.4,
    speed: 3.0, aggro: 0.01, leash: 28, wander: 4, attackRange: 9, attackCd: 3.2, respawn: 25, xpPerLv: 11,
    loot: [{ item: "Toad Jelly", itemZh: "", chance: 0.7, min: 1, max: 1 }],
    swing: { shape: "line", windup: 0.9, reach: 9, arc: 0, width: 1.3 },
  },
  // Stone Hound: the first pack mob. Pulling one pulls the whole pack (`pack` radius). lv5-7 in the northern foothills.
  stone_hound: {
    type: "stone_hound", name: "Stone Hound", hpBase: 130, hpPerLv: 45, dmgBase: 6, dmgPerLv: 2.3,
    speed: 5.0, aggro: 11, leash: 36, wander: 8, attackRange: 2.4, attackCd: 1.5, respawn: 30, xpPerLv: 13, pack: 16,
    loot: [
      { item: "Hound Fang", itemZh: "", chance: 0.6, min: 1, max: 1 },
      { item: "Stone Hound Greaves", itemZh: "", chance: 0.03, min: 1, max: 1 },
    ],
    swing: { shape: "cone", windup: 0.45, reach: 3.4, arc: 1.5, width: 0 },
  },
  // Old Whisker, the Grey Fox: a roaming named rare (lv5, ~5x a normal fox's health, wide bite), 20 minute respawn.
  old_whisker: {
    type: "old_whisker", name: "Old Whisker, the Grey Fox", hpBase: 700, hpPerLv: 100, dmgBase: 7, dmgPerLv: 2.5,
    speed: 5.4, aggro: 12, leash: 40, wander: 14, attackRange: 2.8, attackCd: 1.6, respawn: 1200, xpPerLv: 55, rare: true,
    loot: [
      { item: "Silver Tail Cloak", itemZh: "", chance: 0.35, min: 1, max: 1 },
      { item: "Hollow Seal Fragment", itemZh: "", chance: 1, min: 1, max: 1 },
      { item: "Fox Tail", itemZh: "", chance: 1, min: 1, max: 2 },
    ],
    swing: { shape: "cone", windup: 0.5, reach: 4.6, arc: 2.2, width: 0 },
  },
  // Ink Wisp: a floating ink-shadow spirit in the misty hollow south of the pond. Fast, weak, lashes with a strip of ink.
  ink_wisp: {
    type: "ink_wisp", name: "Ink Wisp", hpBase: 55, hpPerLv: 26, dmgBase: 3, dmgPerLv: 1.5,
    speed: 4.2, aggro: 10, leash: 30, wander: 9, attackRange: 2.6, attackCd: 1.6, respawn: 20, xpPerLv: 11,
    loot: [
      { item: "Wisp Essence", itemZh: "", chance: 0.75, min: 1, max: 1 },
      { item: "Serpent Gall", itemZh: "", chance: 0.04, min: 1, max: 1 },
    ],
    swing: { shape: "line", windup: 0.5, reach: 3.4, arc: 0, width: 1.5 },
  },
  // Mist Warden: a second boss in the south-east hollow. Faster telegraphs than the Guardian but less raw health; drops wisps' essence.
  mist_warden: {
    type: "mist_warden", name: "Mist Warden", hpBase: 600, hpPerLv: 110, dmgBase: 20, dmgPerLv: 1,
    speed: 3.4, aggro: 12, leash: 45, wander: 3, attackRange: 4.2, attackCd: 2.4, respawn: 150, xpPerLv: 220,
    loot: [
      { item: "Wisp Essence", itemZh: "", chance: 1, min: 2, max: 3 },
      { item: "Serpent Gall", itemZh: "", chance: 1, min: 1, max: 2 },
    ],
    boss: {
      slamEvery: [6, 8], slamEvery2: 6, firstSlam: 2.5,
      phase2At: 0.5,
      slam: { radius: 6, delay: 1.5, dmg: 70 },
      stomp: { radius: 7, delay: 1.4, dmg: 62 },
      scatter: { radius: 4, delay: 1.8, dmg: 45, n: 3, spread: 8 },
      phase3At: 0.3,
      beam: { len: 24, width: 3.2, lead: 0.8, sweepTime: 2.5, sweep: Math.PI / 2, tickEvery: 0.25, dmg: 22 },
      enrageAfter: 120, enrageMult: 1.4, creditRange: 70, targetRange: 40,
    },
  },
  // Thorn Sprite: a small, passive-until-provoked ranged mob that spits a thorn. It reuses the Lotus Toad's line-telegraph `swing` (no new AI):
  // slower, shorter spit than the toad's, so it stays a gentle step up from the toads along the pond's north bank. lv3-5.
  thorn_sprite: {
    type: "thorn_sprite", name: "Thorn Sprite", hpBase: 60, hpPerLv: 30, dmgBase: 3, dmgPerLv: 1.2,
    speed: 3.4, aggro: 0.01, leash: 28, wander: 6, attackRange: 7, attackCd: 2.8, respawn: 22, xpPerLv: 10,
    loot: [
      { item: "Bamboo Fiber", itemZh: "", chance: 0.7, min: 1, max: 2 },
      { item: "Thornweave Hood", itemZh: "", chance: 0.05, min: 1, max: 1 }, // 0.5.0: the fifth gear set's hood; the sprites weave it from the reeds' thorn-fibre
    ],
    swing: { shape: "line", windup: 0.8, reach: 7, arc: 0, width: 1.2 },
  },
  // Hollow Hierophant: the third boss, a masked summoner at a drowned shrine in the south-west misty hollow beyond the Ink Wisps.
  // Its signature is the summon: every 10 s it calls two Thorn Sprites out of the reeds. Less raw health than the Stone Guardian,
  // but the arena fills with adds (capped, and cleared when the boss dies or leashes) so the fight is about clearing them, not outlasting them. lv9.
  hollow_hierophant: {
    type: "hollow_hierophant", name: "Hollow Hierophant", hpBase: 880, hpPerLv: 125, dmgBase: 18, dmgPerLv: 1.1,
    speed: 3.2, aggro: 12, leash: 42, wander: 3, attackRange: 4.2, attackCd: 2.5, respawn: 150, xpPerLv: 235,
    loot: [
      { item: "Wisp Essence", itemZh: "", chance: 1, min: 2, max: 2 },
      { item: "Serpent Gall", itemZh: "", chance: 1, min: 1, max: 2 },
      { item: "Thornweave Robe", itemZh: "", chance: 0.2, min: 1, max: 1 }, // 0.5.0: a thorn-spun robe woven from the reeds it calls
    ],
    boss: {
      slamEvery: [6.5, 8.5], slamEvery2: 6.5, firstSlam: 3,
      phase2At: 0.55,
      slam: { radius: 6.5, delay: 1.6, dmg: 68 },
      stomp: { radius: 7.5, delay: 1.5, dmg: 60 },
      scatter: { radius: 4, delay: 1.8, dmg: 42, n: 3, spread: 8.5 },
      phase3At: 0.28,
      beam: { len: 26, width: 3.0, lead: 0.85, sweepTime: 2.8, sweep: Math.PI / 2, tickEvery: 0.3, dmg: 20 },
      enrageAfter: 140, enrageMult: 1.45, creditRange: 70, targetRange: 40,
      summon: { type: "thorn_sprite", count: 2, every: 10 },
    },
  },
  // The Hollow Bride: the fourth boss, a ceremonial wraith on the eastern ridge above the Fox Fire Hollow. Her hook is a
  // deterministic VEILED/REVEALED rhythm: 8 s VEILED (immune to damage, lashes telegraphed lines while drifting toward a
  // chosen player at 55% speed), then 5 s REVEALED (takes full damage, melee x1.5). Players dodge the lashes, burst the
  // reveal. The generic pattern fields below are present for shape-compatibility but the veil fight replaces the rotation. lv12.
  hollow_bride: {
    type: "hollow_bride", name: "The Hollow Bride", hpBase: 1400, hpPerLv: 260, dmgBase: 26, dmgPerLv: 1.6,
    speed: 3.2, aggro: 14, leash: 46, wander: 3, attackRange: 5.0, attackCd: 1.9, respawn: 180, xpPerLv: 320,
    loot: [
      { item: "Wisp Essence", itemZh: "", chance: 1, min: 2, max: 3 },
      { item: "Serpent Gall", itemZh: "", chance: 1, min: 1, max: 2 },
      { item: "Jade Scale Vest", itemZh: "", chance: 0.15, min: 1, max: 1 }, // 0.5.0: her bridal scales, once a fine robe
    ],
    swing: { shape: "line", windup: 0.9, reach: 12, arc: 0, width: 1.8 }, // kerchief lash: a long line, used only while VEILED
    boss: {
      slamEvery: [9, 11], slamEvery2: 9, firstSlam: 4,
      phase2At: 0.5,
      slam: { radius: 7, delay: 1.7, dmg: 70 },
      stomp: { radius: 8, delay: 1.6, dmg: 62 },
      scatter: { radius: 4.5, delay: 1.9, dmg: 44, n: 3, spread: 8.5 },
      phase3At: 0.25,
      beam: { len: 26, width: 2.8, lead: 0.9, sweepTime: 2.8, sweep: Math.PI / 2, tickEvery: 0.32, dmg: 20 },
      enrageAfter: 200, enrageMult: 1.45, creditRange: 80, targetRange: 50,
      veil: { veilSec: 8, revealSec: 5, lashEvery: 2.6, firstLash: 1.4, revealDmgMult: 1.5, driftSpeedMult: 0.55 },
    },
  },
  // 0.5.0 P3 The Twin Wardens: a linked PAIR of bosses on the eastern rise — two spawn points 6 units apart at (45,-16) and
  // (51,-16). While both live each takes 35% less damage; when one falls the survivor enrages (+55% damage, pattern cadence
  // x0.75) and a 25 s window opens: kill the second inside it for bonus coin/jade and a guaranteed existing rare charm.
  // Both use the generic pattern rotation, so respawn/leash/reset/credit all behave like every other boss. lv11.
  twin_warden: {
    type: "twin_warden", name: "Twin Warden", hpBase: 760, hpPerLv: 120, dmgBase: 20, dmgPerLv: 1.0,
    speed: 3.3, aggro: 13, leash: 44, wander: 3, attackRange: 4.2, attackCd: 2.4, respawn: 180, xpPerLv: 250,
    loot: [
      { item: "Guardian Core", itemZh: "", chance: 1, min: 1, max: 1 },
      { item: "Serpent Gall", itemZh: "", chance: 1, min: 1, max: 2 },
      { item: "Warden's Seal Charm", itemZh: "", chance: 0.1, min: 1, max: 1 }, // the same rare charm the warden's quest yields
    ],
    boss: {
      slamEvery: [7.5, 9], slamEvery2: 7, firstSlam: 3,
      phase2At: 0.55,
      slam: { radius: 6.5, delay: 1.6, dmg: 66 },
      stomp: { radius: 7.5, delay: 1.5, dmg: 58 },
      scatter: { radius: 4, delay: 1.8, dmg: 42, n: 3, spread: 8.5 },
      phase3At: 0.27,
      beam: { len: 24, width: 2.6, lead: 0.9, sweepTime: 2.6, sweep: Math.PI / 2, tickEvery: 0.32, dmg: 20 },
      enrageAfter: 600, enrageMult: 1.55, creditRange: 72, targetRange: 40, // natural enrage is effectively out of reach: the bond enrage is the mechanic
      twin: { wardDamageMult: 0.65, togetherWindowSec: 25, togetherCoin: 200, togetherJade: 2, togetherItem: "Warden's Seal Charm" },
    },
  },
};

export interface SpawnGroup {
  type: MobType; count: number; x: [number, number]; z: [number, number]; lv: [number, number];
  spacing?: number; /* min distance between spawn points, default 7 */
  points?: Array<[number, number]>; /* fixed spawn points (overrides x/z/count) */
}
// Pond: centre (0,-34), radius ~15.5-18.6; stone bridge runs along x=0 from z=-53 to z=-15 (client/src/world/terrain.ts).
// Serpent points are dry shore 21+ from the pond centre, 35+ from the plaza spawn, 10+ apart, and clear of the bamboo box (x<-20, z>-20).
export const MOB_SPAWNS: SpawnGroup[] = [
  { type: "bamboo_spirit", count: 12, x: [-60, -20], z: [-20, 40], lv: [1, 3], spacing: 11 },
  { type: "fox_spirit", count: 8, x: [30, 80], z: [0, 60], lv: [3, 4], spacing: 15 },
  { type: "jade_serpent", count: 6, x: [0, 0], z: [0, 0], lv: [2, 4], points: [[-26, -43], [-25, -31], [25, -43], [26, -30], [14, -17], [-12, -14]] },
  { type: "stone_guardian", count: 1, x: [0, 0], z: [85, 85], lv: [8, 8] },
  // v3 higher-level tiers so the 1-20 curve has something to level on (same mob types, scaled by level). Appended after the originals so the seeded
  // placement of the older groups is unchanged. Kept >= 75 from the plaza and >= 15 from the lv1-4 hunting grounds so low levels are not pulled into them.
  { type: "bamboo_spirit", count: 7, x: [-95, -65], z: [56, 72], lv: [5, 8], spacing: 11 },        // north-west
  { type: "fox_spirit", count: 6, x: [70, 90], z: [-45, -20], lv: [7, 11], spacing: 9 },           // east, below the fox hills
  { type: "bamboo_spirit", count: 6, x: [-98, -86], z: [-30, 40], lv: [12, 15], spacing: 11 },     // far west edge
  { type: "fox_spirit", count: 6, x: [86, 98], z: [-10, 40], lv: [13, 17], spacing: 11 },          // far east edge
  { type: "bamboo_spirit", count: 6, x: [-98, -60], z: [78, 95], lv: [17, 20], spacing: 11 },      // north-west corner
  { type: "fox_spirit", count: 6, x: [50, 95], z: [78, 95], lv: [18, 20], spacing: 11 },           // north-east corner
  // 0.4.0 content (appended last, so the seeded placement of every older group is unchanged)
  { type: "lotus_toad", count: 6, x: [0, 0], z: [0, 0], lv: [3, 5], points: [[22, -36], [-23, -37], [16, -50], [-17, -50], [20, -20], [-20, -18]] }, // pond shore
  { type: "stone_hound", count: 6, x: [0, 0], z: [0, 0], lv: [5, 7], points: [[-34, 62], [-30, 66], [-36, 68], [-12, 70], [-8, 66], [-14, 74]] },   // two packs of three, northern foothills
  { type: "old_whisker", count: 1, x: [0, 0], z: [0, 0], lv: [5, 5], points: [[58, 22]] },                                                           // named rare, fox hills
  { type: "ink_wisp", count: 4, x: [0, 0], z: [0, 0], lv: [4, 6], points: [[-45, -55], [-51, -58], [-46, -62], [-54, -55]] },                        // misty hollow, south-west
  { type: "mist_warden", count: 1, x: [0, 0], z: [0, 0], lv: [8, 8], points: [[60, -60]] },                                                           // second boss, south-east hollow
  { type: "thorn_sprite", count: 4, x: [0, 0], z: [0, 0], lv: [3, 5], points: [[-14, -4], [-3, -10], [12, -8], [23, -10]] },                      // thorn sprites on the rise along the pond's north bank: 24-33 from the pond centre, 70-77 from the plaza spawn, 10+ from every other fixed spawn point and either side of the bridge landing's path
  { type: "hollow_hierophant", count: 1, x: [0, 0], z: [0, 0], lv: [9, 9], points: [[-72, -72]] },                                                   // third boss, the drowned shrine at the south-west edge of the misty hollow: 72 from the plaza spawn and 24+ from the nearest Ink Wisp
  // 0.5.0: fourth boss arena, "the eastern bride-steps" — a fixed point on the open eastern ridge (96, 62):
  // 171 from the plaza spawn, 99/127/215 from the Guardian/Warden/Hierophant arenas, 16 from the nearest mob box
  // (the fox hills group, which is spread over a 50x60 box) and 43 from the Fox Fire Hollow POI. Terrain there is
  // flat and low (heightAt 0.35), so the 5 s REVEALED burst window is fought on open ground.
  { type: "hollow_bride", count: 1, x: [0, 0], z: [0, 0], lv: [12, 12], points: [[96, 62]] },                                                       // fourth boss, the Hollow Bride
  // 0.5.0 P3: The Twin Wardens arena — the linked pair sits 6 units apart on the eastern rise at (45,-16) and (51,-16):
  // 78 / 82 from the plaza spawn, 44.9-46.5 from the nearest other boss arena (Mist Warden) and >=100 from the rest,
  // 53-58 from the Hollow Trial gate, 16 from the nearest mob-spawn box, 12.5+ from the nearest POI (Serpent's Rest);
  // flat ground (heightAt -0.7, slope 0.06-0.08). The pair never respawns alone: each warden has its own 180 s timer.
  { type: "twin_warden", count: 2, x: [0, 0], z: [0, 0], lv: [11, 11], points: [[45, -16], [51, -16]] },                                             // fifth boss: the Twin Wardens (a pair)
];

/** Inventory limits. */
export const INV = { maxStack: 99, maxSlots: 30 };

// ---------------- 0.5.0 P3: "The Hollow Trial" (repeatable wave challenge with modifiers) ----------------
/** The random modifiers a trial run can roll. Ids are stable strings (HUD chip styling keys). */
export type TrialModifierId = "swift" | "armoured" | "frenzied" | "sparse";
export interface TrialModifierDef {
  id: TrialModifierId;
  name: string;   // chip label
  blurb: string;  // one-line explanation (tooltip + panel)
}
export const TRIAL_MODIFIERS: TrialModifierDef[] = [
  { id: "swift", name: "Swift", blurb: "The hollow dead move 35% faster and recover from swings sooner." },
  { id: "armoured", name: "Armoured", blurb: "Every foe has 40% more health." },
  { id: "frenzied", name: "Frenzied", blurb: "Every foe hits 30% harder and attacks sooner." },
  { id: "sparse", name: "Sparse", blurb: "Fewer foes stand in each wave (but each one still counts)." },
];

/** The trial gate ("the Hollow Gate") sits in the open meadow between the bamboo grove and the fox hills.
 *  Clearances (checked by content.ts): 98 from the plaza spawn, 67 from the Stone Guardian arena, >= 55 from every other
 *  boss arena, 24 from the nearest mob-spawn box/point, 43 from the nearest place of interest, terrain slope 0.11, h 0.04. */
export const TRIAL = {
  id: "hollow_trial",
  name: "The Hollow Trial",
  x: 4, z: 18,
  /** A player must stand this close to the gate to see the prompt / start a run. */
  startRange: 9,
  /** Players within this radius when a run starts (or while it runs) join it: a nearby party fights together. */
  joinRange: 18,
  /** A participant further than this from the gate drops out of the run. */
  dropRange: 70,
  waves: 5,
  /** Whole-run timer; expiry fails the run. */
  timeLimitSec: 300,
  /** No new run may start for this long after one ends (clear or fail): stops infinite farming. */
  cooldownSec: 180,
  /** Wave composition: EXISTING mob types only (no bosses), scaled by run level. Each wave is a list of spawn groups. */
  waveMobs: [
    [{ type: "bamboo_spirit", count: 3, lv: 14 }],
    [{ type: "fox_spirit", count: 4, lv: 14 }],
    [{ type: "stone_hound", count: 3, lv: 15 }, { type: "thorn_sprite", count: 2, lv: 15 }],
    [{ type: "jade_serpent", count: 2, lv: 16 }, { type: "ink_wisp", count: 3, lv: 16 }],
    [{ type: "lotus_toad", count: 2, lv: 17 }, { type: "stone_hound", count: 3, lv: 17 }],
  ] as Array<Array<{ type: MobType; count: number; lv: number }>>,
  /** Mobs spawn on a ring around the gate (world units). */
  spawnInner: 5, spawnOuter: 13,
  /** "Sparse" keeps ceil(count * sparseMult) foes per group (never fewer than 1). */
  sparseMult: 0.6,
  baseCoin: 140, coinPerWave: 70,
  baseXp: 450, xpPerWave: 160,
  itemChance: 0.35,
  /** Each modifier adds 18% to the coin/XP clear reward (difficulty pays). */
  modifierRewardMult: 0.18,
  /** Hard per-run caps so even a perfect run cannot be farmed for unbounded currency. */
  maxCoin: 900, maxJade: 5, maxItemChance: 0.6,
};

/** Deterministic 1-2 modifier roll for a run seed: the same seed always rolls the same modifiers (content-tested). */
export function trialModifiers(seed: number): TrialModifierId[] {
  let s = (Math.floor(seed) >>> 0) || 1;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const count = next() < 0.45 ? 1 : 2;
  const pool: TrialModifierId[] = TRIAL_MODIFIERS.map((m) => m.id);
  const out: TrialModifierId[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  return out;
}

/** Clear rewards for a finished run: scaled by waves cleared + modifier count, then clamped to the per-run caps.
 *  A full 5-wave run with 2 modifiers is the best case; partial clears pay proportionally less and never give the jade bonus. */
export function trialReward(wavesCleared: number, modifierCount: number): { coin: number; jade: number; xp: number; itemChance: number } {
  const w = Math.max(0, Math.min(TRIAL.waves, Math.floor(wavesCleared)));
  const m = Math.max(0, Math.min(TRIAL_MODIFIERS.length, Math.floor(modifierCount)));
  const scale = 1 + TRIAL.modifierRewardMult * m;
  const full = w >= TRIAL.waves;
  const coin = Math.min(TRIAL.maxCoin, Math.round((TRIAL.baseCoin + TRIAL.coinPerWave * w) * scale));
  const xp = Math.round((TRIAL.baseXp + TRIAL.xpPerWave * w) * scale);
  const jade = Math.min(TRIAL.maxJade, full ? 2 + m : 1);
  const itemChance = Math.min(TRIAL.maxItemChance, TRIAL.itemChance + 0.05 * m);
  return { coin, jade, xp, itemChance };
}

export const NPCS = [
  { name: "Elder Lin", x: -4, z: -70, r: 0.4 },
  { name: "Lantern Keeper Mei", x: 7, z: -74, r: -0.6 },
  { name: "Gate Warden Wu", x: -9, z: -88, r: 0.2 },
  { name: "Notice Board Keeper Fen", x: 8, z: -85, r: -1.0 }, // inside the plaza ring, clear of the lantern ring (r 11.8), flag poles (r 11), seats (+-8.5,-74.5) and Mei
  { name: "Artisan Tao", x: -6.5, z: -79, r: 1.72 },   // 0.4.0: crafts gear and tonics from drops
  { name: "Peddler Hao", x: 12.5, z: -78, r: -1.73 },  // 0.4.0: buys materials, sells tonics and starter gear
];
export const FEN_NPC = "Notice Board Keeper Fen";

// ---------------- Lantern Keeper Mei: a small delivery errand ----------------
// Talk to Mei (/talk or F within QUEST_TALK_RANGE of her) to accept; gather the items from Bamboo Spirits; talk again to hand them in.
// Progress is counted from the pack (so it needs no counters), shown as `Task: ...`, and the state (0/1/2) is stored with the quest row.
export const MEI_NPC = "Lantern Keeper Mei";
export const MEI_QUEST = {
  title: "Wicks for the Lanterns", titleZh: "",
  item: "Bamboo Fiber", itemZh: "", count: 5,
  intro: "The plaza lanterns are burning low and I am out of wicks. Bring me 5 Bamboo Fiber from the spirits in the western grove, and I will light the road for you.",
  reminder: "Five Bamboo Fiber, dear. The bamboo spirits of the western grove carry it.",
  done: "These will burn clean all night. Take this lantern; may it light your road home.",
  already: "The lanterns burn bright thanks to you. May no traveller lose their way.",
  rewardXp: 150, rewardItems: [{ item: "Paper Lantern", itemZh: "", qty: 1 }, { item: "Healing Tonic", itemZh: "", qty: 1 }],
};

// ---------------- Quests (Elder Lin) ----------------
// Delivered purely through `chat` events with sys:true. The player triggers dialog with the chat text `/talk`
// (must be within QUEST_TALK_RANGE of Elder Lin) and can check progress anywhere with `/quest`.
export const QUEST_NPC = "Elder Lin";     // matched against the NPC name
export const QUEST_TALK_RANGE = 16;       // units from Elder Lin required for /talk
export const QUEST_HINT_RANGE = 5;        // walking this close triggers a one-time "type /talk" hint
export interface QuestGoal { kind: "kill" | "loot"; target: MobType | string; count: number }
export interface RewardItem { item: string; itemZh: string; qty: number }
export interface QuestDef {
  title: string; titleZh: string;
  goal: QuestGoal;
  goal2?: QuestGoal;  // optional second objective; progress shown as the combined count (see quests.ts)
  intro: string;      // Elder Lin's dialog when the quest is given
  reminder: string;   // dialog when /talk is used mid-quest
  done: string;       // dialog on turn-in
  rewardXp: number;
  rewardItems?: RewardItem[];
  consume?: RewardItem[]; // quest items taken from the pack on turn-in
}
// Chain (v2): 1 Bamboo -> 2 Fox Tails -> 3 Cleanse the Pond (new) -> 4 Stone Guardian (final reward item).
export const QUESTS: QuestDef[] = [
  {
    title: "Clear Bamboo Spirits", titleZh: "", goal: { kind: "kill", target: "bamboo_spirit", count: 5 },
    intro: "The bamboo spirits in the western grove have grown restless. Clear 5 of them, young cultivator. Use your hotbar: keys 1-4.",
    reminder: "The grove lies to the west, past the plaza. Five Bamboo Spirits, no more.",
    done: "The grove breathes easier. Take this for your trouble.",
    rewardXp: 100, rewardItems: [{ item: "Healing Tonic", itemZh: "", qty: 2 }],
  },
  {
    title: "Collect Fox Tails", titleZh: "", goal: { kind: "loot", target: "Fox Tail", count: 3 },
    intro: "The fox spirits of the eastern hills steal from travellers. Bring me 3 Fox Tails; I can brew a ward from them.",
    reminder: "Fox spirits roam the eastern hills. Not every one leaves a tail; be patient.",
    done: "Fine tails. The ward will keep the roads safe.",
    rewardXp: 220, rewardItems: [{ item: "Jade Charm", itemZh: "", qty: 1 }],
    consume: [{ item: "Fox Tail", itemZh: "", qty: 3 }],
  },
  {
    title: "Cleanse the Pond", titleZh: "", goal: { kind: "kill", target: "jade_serpent", count: 4 },
    goal2: { kind: "loot", target: "Jade Scale", count: 2 },
    intro: "Jade Serpents have fouled the lotus pond and coil about the stone bridge. Defeat 4 Jade Serpents and bring me 2 Jade Scales. Beware: their bite is poisoned, and they strike fast after a brief coil.",
    reminder: "The lotus pond lies north of the plaza, beneath the stone bridge. Four serpents, two scales. Step aside when they coil.",
    done: "The water runs clear again. These scales will make a fine antidote.",
    rewardXp: 380, rewardItems: [{ item: "Lotus Antidote", itemZh: "", qty: 2 }, { item: "Lotus Charm", itemZh: "", qty: 1 }],
    consume: [{ item: "Jade Scale", itemZh: "", qty: 2 }],
  },
  {
    title: "Defeat the Stone Guardian", titleZh: "", goal: { kind: "kill", target: "stone_guardian", count: 1 },
    intro: "The Stone Guardian at the northern shrine has lost its master and attacks all who approach. Defeat it, but go with allies and healing. Watch the ground: when a ring of light appears, leave it before it strikes.",
    reminder: "The shrine is far to the north. Do not face the Stone Guardian alone and unprepared. Leave the glowing rings before they strike.",
    done: "The shrine is at peace. The valley owes you a debt, hero. Take the Cloudmist Pendant; it was the master's own.",
    rewardXp: 1500, rewardItems: [{ item: "Guardian's Seal", itemZh: "", qty: 1 }, { item: "Cloudmist Pendant", itemZh: "", qty: 1 }],
  },
];
export const QUEST_ALL_DONE = "You have completed all my tasks. The valley is in your debt.";

// =====================================================================================================================
// 0.4.0 CONTENT: gear, consumables, vendor, crafting, side quests, merit seals, places of interest.
// Everything below is data; the rules live in game/content.ts. Item names are the inventory keys (English only).
// =====================================================================================================================
export const GEAR_SLOTS: GearSlot[] = ["weapon", "head", "body", "boots", "charm", "pendant"];
export const RARITY_ORDER: Rarity[] = ["common", "fine", "rare", "epic"];

export interface GearDef {
  name: string; slot: GearSlot; rarity: Rarity; lv: number; cls?: ClassId;
  stats: Partial<GearStats>; flavor: string; sell: number;
}
const G = (name: string, slot: GearSlot, rarity: Rarity, lv: number, stats: Partial<GearStats>, sell: number, flavor: string, cls?: ClassId): GearDef =>
  ({ name, slot, rarity, lv, cls, stats, sell, flavor });

/** Stat scale: a level-5 sword has attack 21 and 220 HP, so a full set of fine gear is worth roughly +15 % attack, +20 % HP and -10 % damage taken; an epic weapon alone is +30 % attack at level 8. */
export const GEAR: GearDef[] = [
  // ---- Valley Wanderer set (common, bought from the peddler, weapons from the Walk the Path quest)
  G("Wanderer's Jian", "weapon", "common", 1, { atk: 2 }, 6, "A plain training sword with a cord-wrapped grip.", "sword"),
  G("Wanderer's Brush", "weapon", "common", 1, { atk: 2 }, 6, "A stiff-haired brush for painting wards.", "talisman"),
  G("Wanderer's Needle Case", "weapon", "common", 1, { atk: 2 }, 6, "Twelve silver needles in a worn lacquer case.", "physician"),
  G("Wanderer's Dao", "weapon", "common", 1, { atk: 2 }, 6, "A curved single-edged blade, light enough to dance with.", "blade"),
  G("Wanderer's Hat", "head", "common", 1, { hp: 8 }, 5, "A woven straw hat against the valley rain."),
  G("Wanderer's Robe", "body", "common", 1, { hp: 12, def: 0.02 }, 8, "Rough grey cloth, sturdy enough."),
  G("Wanderer's Sandals", "boots", "common", 1, { hp: 6 }, 5, "Straw sandals with red ties."),
  // ---- fine (crafted or dropped)
  G("Bamboo Weave Hat", "head", "fine", 3, { hp: 14, def: 0.01 }, 14, "Tightly woven bamboo strips; light and cool."),
  G("Bamboo Weave Robe", "body", "fine", 3, { hp: 22, def: 0.03 }, 24, "Bamboo fibre spun into a supple robe."),
  G("Fox-Fur Boots", "boots", "fine", 3, { hp: 10, crit: 0.015 }, 18, "Warm boots lined with russet fox fur."),
  G("Jade Scale Vest", "body", "fine", 4, { hp: 26, def: 0.04 }, 34, "Overlapping serpent scales that turn a bite aside."),
  G("Jade Charm", "charm", "fine", 1, { crit: 0.02 }, 12, "A pale charm that hums when danger is near."),
  G("Lotus Charm", "charm", "fine", 1, { hp: 15 }, 12, "A lotus carved from river jade."),
  G("Hound-Fang Charm", "charm", "fine", 5, { atk: 3, crit: 0.01 }, 30, "Two stone-hound fangs on a red cord."),
  G("Stone Hound Greaves", "boots", "fine", 5, { hp: 18, def: 0.03 }, 28, "Grey leather plated with chips of foothill stone."),
  G("Houndfang Jian", "weapon", "fine", 5, { atk: 5, crit: 0.01 }, 40, "The blade is notched like a fang.", "sword"),
  G("Houndfang Brush", "weapon", "fine", 5, { atk: 5, crit: 0.01 }, 40, "Hound-bristle tip; it paints fast, hard strokes.", "talisman"),
  G("Houndfang Needles", "weapon", "fine", 5, { atk: 5, crit: 0.01 }, 40, "Slim needles drawn from a hound's fang.", "physician"),
  G("Houndfang Dao", "weapon", "fine", 5, { atk: 5, crit: 0.01 }, 40, "A curved blade notched like a fang, quick on the draw.", "blade"),
  // ---- Thornweave set (0.5.0, fine, lv 6): the fifth set, woven from the reed bank's thorn-fibre. Hood drops from Thorn Sprites,
  // the robe is one of Artisan Tao's recipes, the boots are Peddler Hao's stock. Its bonuses trade attack for health and defence.
  G("Thornweave Hood", "head", "fine", 6, { hp: 20, def: 0.02 }, 40, "Thorn-fibre woven barb-outward; a claw slides off the neck."),
  G("Thornweave Robe", "body", "fine", 6, { hp: 30, def: 0.04 }, 56, "Reed cord and bitter gall bind a robe the reeds cannot pick apart."),
  G("Thornweave Boots", "boots", "fine", 6, { hp: 20, def: 0.03 }, 44, "Layered thorn-leather soles that grip the wet reed bank."),
  // ---- rare
  G("Silver Tail Cloak", "body", "rare", 5, { atk: 3, hp: 30, def: 0.04 }, 90, "Old Whisker's own silver fur, still cold with mist."),
  G("Cloudmist Pendant", "pendant", "rare", 6, { hp: 30, atk: 2 }, 80, "The Stone Guardian's master wore this."),
  G("Warden's Seal Charm", "charm", "rare", 6, { atk: 4, crit: 0.03, hp: 10 }, 110, "A mended Hollow Seal, now a ward instead of a curse."),
  G("Wisp Lantern", "charm", "rare", 5, { hp: 10, crit: 0.02, def: 0.01 }, 70, "A captured wisp in a paper lantern; it hums with cold, guiding light."),
  // ---- epic
  G("Cloudpiercer Jian", "weapon", "epic", 8, { atk: 9, crit: 0.03 }, 220, "Said to cut the mist itself. A gift from the Gate Warden.", "sword"),
  G("Cloudpiercer Brush", "weapon", "epic", 8, { atk: 9, crit: 0.03 }, 220, "Its ink never dries. A gift from the Gate Warden.", "talisman"),
  G("Cloudpiercer Needles", "weapon", "epic", 8, { atk: 9, crit: 0.03 }, 220, "Needles that find the quiet in any wound. A gift from the Gate Warden.", "physician"),
  G("Cloudpiercer Dao", "weapon", "epic", 8, { atk: 9, crit: 0.03 }, 220, "A blade that parts the mist before it parts a foe. A gift from the Gate Warden.", "blade"),
  G("Guardian's Heart", "pendant", "epic", 8, { hp: 45, atk: 5, def: 0.04 }, 240, "A warm stone core, set in a jade frame."),
];
export const GEAR_BY_NAME = new Map(GEAR.map((g) => [g.name, g] as const));
export const isGear = (item: string) => GEAR_BY_NAME.has(item);

// ---------------- Gear set bonuses ----------------
/** Equipping enough pieces of a named set grants escalating bonuses. Tiers are cumulative-at-or-above (e.g. 2-piece, then 4-piece). */
export interface SetBonusDef { id: string; name: string; tiers: Array<{ count: number; stats: Partial<GearStats> }> }
export const GEAR_SETS: SetBonusDef[] = [
  { id: "wanderer", name: "Wanderer", tiers: [{ count: 2, stats: { atk: 2 } }, { count: 4, stats: { hp: 15, crit: 0.01 } }] },
  { id: "bamboo", name: "Bamboo Weave", tiers: [{ count: 2, stats: { def: 0.02 } }] },
  { id: "jade", name: "Jade", tiers: [{ count: 2, stats: { hp: 10, def: 0.02 } }] },
  { id: "hound", name: "Houndfang", tiers: [{ count: 2, stats: { crit: 0.02 } }, { count: 3, stats: { atk: 3 } }] },
  { id: "thornweave", name: "Thornweave", tiers: [{ count: 2, stats: { hp: 20, def: 0.02 } }, { count: 3, stats: { atk: 3, crit: 0.02 } }] },
];
/** Item name -> set id. */
export const GEAR_SET_OF: Record<string, string> = {
  "Wanderer's Jian": "wanderer", "Wanderer's Brush": "wanderer", "Wanderer's Needle Case": "wanderer", "Wanderer's Dao": "wanderer",
  "Wanderer's Hat": "wanderer", "Wanderer's Robe": "wanderer", "Wanderer's Sandals": "wanderer",
  "Bamboo Weave Hat": "bamboo", "Bamboo Weave Robe": "bamboo",
  "Jade Scale Vest": "jade", "Jade Charm": "jade",
  "Hound-Fang Charm": "hound", "Stone Hound Greaves": "hound",
  "Houndfang Jian": "hound", "Houndfang Brush": "hound", "Houndfang Needles": "hound", "Houndfang Dao": "hound",
  "Thornweave Hood": "thornweave", "Thornweave Robe": "thornweave", "Thornweave Boots": "thornweave",
};
export const gearSetOf = (item: string) => GEAR_SET_OF[item];

export interface ConsumableDef { name: string; text: string; healPct: number; cure: boolean; qiRestore?: number; buy: number; sell: number }
/** Potions share one cooldown (`POTION_CD` seconds). */
export const POTION_CD = 15;
export const CONSUMABLES: ConsumableDef[] = [
  { name: "Healing Tonic", text: "Drink to restore 40% of your health.", healPct: 0.4, cure: false, buy: 15, sell: 6 },
  { name: "Lotus Antidote", text: "Cures poison and restores 15% of your health.", healPct: 0.15, cure: true, buy: 25, sell: 10 },
  { name: "Qi Elixir", text: "Drink to restore 50 Qi.", healPct: 0, cure: false, qiRestore: 50, buy: 20, sell: 8 },
];
export const CONSUMABLE_BY_NAME = new Map(CONSUMABLES.map((c) => [c.name, c] as const));

/** Materials and curios the peddler buys. Anything not listed here (and not gear/consumable) cannot be sold. */
export const MATERIALS: Array<{ name: string; sell: number; text: string }> = [
  { name: "Bamboo Fiber", sell: 2, text: "Tough green strands. Used for weaving and wicks." },
  { name: "Fox Tail", sell: 5, text: "A russet tail with a spark of ghost-fire." },
  { name: "Jade Scale", sell: 4, text: "A cool, hard scale from a pond serpent." },
  { name: "Serpent Gall", sell: 12, text: "Bitter and valuable to alchemists." },
  { name: "Toad Jelly", sell: 3, text: "Clear, springy jelly from a Lotus Toad Warden." },
  { name: "Hound Fang", sell: 6, text: "A grey fang, hard as the foothills." },
  { name: "Wisp Essence", sell: 5, text: "A cool mote of condensed ink-light shed by a valley spirit." },
];
/** Quest items: cannot be sold. */
export const QUEST_ITEMS: Array<{ name: string; text: string }> = [
  { name: "Hollow Seal Fragment", text: "Half of a masked sect's seal. It feels hungry." },
  { name: "Guardian Core", text: "The warm heart of the Stone Guardian." },
  { name: "Guardian's Seal", text: "The valley's thanks, pressed in red wax." },
  { name: "Paper Lantern", text: "A paper lantern from Lantern Keeper Mei." },
];

/** Everything the client needs to describe an item. */
export function itemCatalogue(): ItemInfo[] {
  const out: ItemInfo[] = [];
  for (const g of GEAR) out.push({ name: g.name, kind: "gear", slot: g.slot, rarity: g.rarity, lv: g.lv, cls: g.cls, stats: g.stats, set: gearSetOf(g.name), text: g.flavor, sell: g.sell });
  for (const c of CONSUMABLES) out.push({ name: c.name, kind: "consumable", text: c.text, sell: c.sell });
  for (const m of MATERIALS) out.push({ name: m.name, kind: "material", text: m.text, sell: m.sell });
  for (const q of QUEST_ITEMS) out.push({ name: q.name, kind: "quest", text: q.text });
  return out;
}
/** Coin the peddler pays for one of `item`, or 0 when it cannot be sold. */
export function sellPrice(item: string): number {
  return GEAR_BY_NAME.get(item)?.sell ?? CONSUMABLE_BY_NAME.get(item)?.sell ?? MATERIALS.find((m) => m.name === item)?.sell ?? 0;
}

// ---------------- NPC services ----------------
export interface NpcSvc { key: string; name: string; role: string; greet: string[]; range: number }
export const SVC_RANGE = 14;
export const NPC_SVC: NpcSvc[] = [
  { key: "wu", name: "Gate Warden Wu", role: "Warden of the Gate", range: SVC_RANGE, greet: [
    "Halt. Ah, a cultivator. Pass freely.",
    "The Gate has stood for nine hundred years. I mean to see it stand for nine hundred more.",
  ] },
  { key: "tao", name: "Artisan Tao", role: "Maker of Gear", range: SVC_RANGE, greet: [
    "Bring me what the valley gives you and I will make it into something worth wearing.",
    "Good gear is just good habits, stitched together.",
  ] },
  { key: "hao", name: "Peddler Hao", role: "Travelling Merchant", range: SVC_RANGE, greet: [
    "Fine day for honest trade, friend! I buy fangs, fibre and tails, and I sell the tonics to survive collecting them.",
    "Sell me your junk. Buy my tonics. Everybody wins, mostly me.",
  ] },
  // 0.5.0: Lantern Keeper Mei now gives side quests (the Thorns of the Reed chain) as well as her chat errand.
  { key: "mei", name: "Lantern Keeper Mei", role: "Keeper of the Lanterns", range: SVC_RANGE, greet: [
    "Mind the lanterns, dear; the valley has a way of eating light.",
    "The reeds along the pond's north bank have teeth now. I would not walk them after dark.",
  ] },
];
export const NPC_KEY_BY_NAME = new Map(NPC_SVC.map((n) => [n.name, n.key] as const));

/** What Peddler Hao sells. */
export const SHOP: Array<{ item: string; price: number }> = [
  { item: "Healing Tonic", price: 15 }, { item: "Lotus Antidote", price: 25 }, { item: "Qi Elixir", price: 20 },
  { item: "Wanderer's Hat", price: 20 }, { item: "Wanderer's Robe", price: 35 }, { item: "Wanderer's Sandals", price: 20 },
  { item: "Wanderer's Jian", price: 30 }, { item: "Wanderer's Brush", price: 30 }, { item: "Wanderer's Needle Case", price: 30 }, { item: "Wanderer's Dao", price: 30 },
  // 0.5.0: one Thornweave piece on the open market, so the fifth set has a coin-priced path besides the drop and the recipe.
  { item: "Thornweave Boots", price: 130 },
];

/** Artisan Tao's recipes. `byClass` replaces `out` with the class's own weapon. */
export interface RecipeDef { id: string; out: string; qty: number; byClass?: Partial<Record<ClassId, string>>; mats: Array<{ item: string; qty: number }>; coin: number; jade: number; lv: number }
export const RECIPES: RecipeDef[] = [
  { id: "tonic", out: "Healing Tonic", qty: 2, mats: [{ item: "Bamboo Fiber", qty: 3 }, { item: "Toad Jelly", qty: 1 }], coin: 5, jade: 0, lv: 1 },
  { id: "antidote", out: "Lotus Antidote", qty: 2, mats: [{ item: "Jade Scale", qty: 1 }, { item: "Toad Jelly", qty: 2 }], coin: 8, jade: 0, lv: 2 },
  { id: "bamboo_hat", out: "Bamboo Weave Hat", qty: 1, mats: [{ item: "Bamboo Fiber", qty: 6 }], coin: 10, jade: 0, lv: 3 },
  { id: "bamboo_robe", out: "Bamboo Weave Robe", qty: 1, mats: [{ item: "Bamboo Fiber", qty: 10 }], coin: 20, jade: 0, lv: 3 },
  { id: "fox_boots", out: "Fox-Fur Boots", qty: 1, mats: [{ item: "Fox Tail", qty: 5 }], coin: 20, jade: 0, lv: 3 },
  { id: "scale_vest", out: "Jade Scale Vest", qty: 1, mats: [{ item: "Jade Scale", qty: 6 }, { item: "Bamboo Fiber", qty: 4 }], coin: 40, jade: 0, lv: 4 },
  { id: "fang_charm", out: "Hound-Fang Charm", qty: 1, mats: [{ item: "Hound Fang", qty: 4 }, { item: "Fox Tail", qty: 2 }], coin: 45, jade: 0, lv: 5 },
  { id: "hound_greaves", out: "Stone Hound Greaves", qty: 1, mats: [{ item: "Hound Fang", qty: 5 }, { item: "Bamboo Fiber", qty: 6 }], coin: 50, jade: 0, lv: 5 },
  { id: "fang_weapon", out: "Houndfang Jian", qty: 1, byClass: { sword: "Houndfang Jian", talisman: "Houndfang Brush", physician: "Houndfang Needles", blade: "Houndfang Dao" }, mats: [{ item: "Hound Fang", qty: 6 }, { item: "Jade Scale", qty: 2 }], coin: 60, jade: 0, lv: 5 },
  { id: "wisp_lantern", out: "Wisp Lantern", qty: 1, mats: [{ item: "Wisp Essence", qty: 3 }, { item: "Bamboo Fiber", qty: 4 }], coin: 40, jade: 0, lv: 5 },
  { id: "qi_elixir", out: "Qi Elixir", qty: 2, mats: [{ item: "Wisp Essence", qty: 2 }, { item: "Bamboo Fiber", qty: 2 }], coin: 10, jade: 0, lv: 4 },
  { id: "thornweave_robe", out: "Thornweave Robe", qty: 1, mats: [{ item: "Bamboo Fiber", qty: 10 }, { item: "Toad Jelly", qty: 3 }, { item: "Serpent Gall", qty: 1 }], coin: 55, jade: 0, lv: 6 },
  { id: "guardian_heart", out: "Guardian's Heart", qty: 1, mats: [{ item: "Guardian Core", qty: 1 }, { item: "Jade Scale", qty: 4 }, { item: "Hound Fang", qty: 4 }], coin: 150, jade: 3, lv: 8 },
];
export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r] as const));
export const recipeOutput = (r: RecipeDef, cls: ClassId) => r.byClass?.[cls] ?? r.out;

// ---------------- Places of interest ----------------
export interface PoiDef { id: string; name: string; x: number; z: number; r: number; xp: number; lore: string }
export const POI_RADIUS = 6;
export const POIS: PoiDef[] = [
  { id: "hermit_rest", name: "Hermit's Rest", x: -62, z: 14, r: POI_RADIUS, xp: 40, lore: "A leaning hut of bamboo. The tea beside the door is still warm, but no one is home." },
  { id: "old_waystone", name: "Old Waystone", x: 36, z: -52, r: POI_RADIUS, xp: 40, lore: "Travellers scratched their names into this stone long before the Gate was built. One mark is newer: a mask." },
  { id: "serpent_rest", name: "Serpent's Rest", x: 34, z: -22, r: POI_RADIUS, xp: 40, lore: "Shed scales glitter in the grass here. Whatever lies in the pond has been this way." },
  { id: "fox_fire_hollow", name: "Fox Fire Hollow", x: 62, z: 36, r: POI_RADIUS, xp: 60, lore: "Blue flames dance without fuel. The foxes of the hills gather here when the moon is thin." },
  { id: "hound_cairn", name: "Hound Ridge Cairn", x: -22, z: 52, r: POI_RADIUS, xp: 60, lore: "Stacked stones, one for every traveller the hounds have turned back." },
  { id: "mist_overlook", name: "Cloudmist Overlook", x: 82, z: -62, r: POI_RADIUS, xp: 80, lore: "From here the whole valley lies below, a bowl of white mist with the pagoda's roof floating on it." },
];

// ---------------- Side quests (NPC chains) ----------------
export type ObjDef =
  | { kind: "kill"; target: MobType; count: number; text: string }
  | { kind: "collect"; item: string; count: number; consume: boolean }
  | { kind: "talk"; npc: string; text: string }
  | { kind: "poi"; count: number; text: string };
export interface SideQuestDef {
  id: string; npc: string; title: string; minLv: number; requires?: string[];
  intro: string; reminder: string; done: string;
  obj: ObjDef[];
  rewardXp: number; rewardCoin?: number; rewardJade?: number;
  rewardItems?: Array<{ item: string; qty: number }>;
  rewardByClass?: Partial<Record<ClassId, string>>;   // one class-specific item
  rewardTitle?: string;
}
export const SIDE_QUESTS: SideQuestDef[] = [
  {
    id: "wu_path", npc: "wu", title: "Walk the Path", minLv: 1,
    intro: "You stand at the Gate of Cloudmist Valley. Beyond it lie bamboo, fox hills and a shrine whose master is gone. Before you walk it, learn who keeps this plaza. Speak with Elder Lin, Lantern Keeper Mei and Notice Board Keeper Fen, then come back to me. Press F near each of them.",
    reminder: "Elder Lin, Lantern Keeper Mei and Notice Board Keeper Fen. All three stand within the plaza. A traveller who knows no one has no one to run to.",
    done: "Good. Now you know where to run. Take this; every wanderer should carry something that cuts, paints or heals.",
    obj: [{ kind: "talk", npc: "elder", text: "Speak with Elder Lin" }, { kind: "talk", npc: "mei", text: "Speak with Lantern Keeper Mei" }, { kind: "talk", npc: "fen", text: "Speak with Notice Board Keeper Fen" }],
    rewardXp: 80, rewardCoin: 15, rewardByClass: { sword: "Wanderer's Jian", talisman: "Wanderer's Brush", physician: "Wanderer's Needle Case", blade: "Wanderer's Dao" },
  },
  {
    id: "tao_start", npc: "tao", title: "A Smith's First Lesson", minLv: 2, requires: ["wu_path"],
    intro: "Gear is not found, it is made. Bring me 4 Bamboo Fiber from the grove and 2 Toad Jelly from the Lotus Toad Wardens by the pond. Careful with the toads: they leave you alone until struck, then spit from a distance. Step out of the line before the spit lands.",
    reminder: "Four Bamboo Fiber, two Toad Jelly. Bamboo Spirits in the western grove, Lotus Toad Wardens along the pond shore.",
    done: "Strong fibre, clean jelly. Watch how I weave it. Now you can ask me to make things for you. Here, a hat to start.",
    obj: [{ kind: "collect", item: "Bamboo Fiber", count: 4, consume: true }, { kind: "collect", item: "Toad Jelly", count: 2, consume: true }],
    rewardXp: 140, rewardCoin: 20, rewardItems: [{ item: "Bamboo Weave Hat", qty: 1 }],
  },
  {
    id: "hao_toads", npc: "hao", title: "Toads for the Pot", minLv: 3,
    intro: "Do you know what a toad warden's jelly sells for? Not much, but the toads themselves are a menace to my pond-side trade. Put down 6 Lotus Toad Wardens and I will make it worth your while. They spit in a straight line; sidestep it.",
    reminder: "Six Lotus Toad Wardens, along the pond shore north of the plaza. They will not bother you until you bother them.",
    done: "The pond is quiet, the road is safe, and my cart rolls on. Here is your share.",
    obj: [{ kind: "kill", target: "lotus_toad", count: 6, text: "Defeat Lotus Toad Wardens" }],
    rewardXp: 200, rewardCoin: 45, rewardItems: [{ item: "Healing Tonic", qty: 2 }],
  },
  {
    id: "wu_masks", npc: "wu", title: "Masks in the Hills", minLv: 4, requires: ["wu_path"],
    intro: "Three nights ago I saw lantern-light on the hills where no lantern should be. Masked figures, moving like they were sleepwalking. Travellers speak of them as the Hollow Sect. Walk the valley and find 3 of its landmarks: the hermit's hut, the old waystone, the cairns. Look for the masks they left behind. Open your journal with J to see which places you have found.",
    reminder: "Three landmarks, anywhere in the valley: Hermit's Rest, the Old Waystone, Serpent's Rest, Fox Fire Hollow, Hound Ridge Cairn, Cloudmist Overlook. Walk close and you will know.",
    done: "Masks scratched into the waystone, cold ashes at the hut. So they were here. Thank you for walking it for me. Take this; I will not forget it.",
    obj: [{ kind: "poi", count: 3, text: "Discover places of interest" }],
    rewardXp: 320, rewardCoin: 30, rewardTitle: "Pathfinder",
  },
  {
    id: "hao_fangs", npc: "hao", title: "Fangs for the Peddler", minLv: 5, requires: ["hao_toads"],
    intro: "Strange business. Someone in a mask offered me a fortune for hound fangs, then vanished. I do not sell to ghosts, but I will happily collect fangs from the Stone Hounds in the northern foothills and turn a profit. Bring me 4. Be warned: they hunt in packs. Pull one and you pull them all.",
    reminder: "Four Hound Fangs from the Stone Hounds in the northern foothills, towards the shrine. Take on a pack with a friend, or pull them one at a time from range.",
    done: "Look at those! Real stone-hound teeth. My masked friend will be sorry he missed out.",
    obj: [{ kind: "collect", item: "Hound Fang", count: 4, consume: true }],
    rewardXp: 340, rewardCoin: 90, rewardItems: [{ item: "Lotus Antidote", qty: 2 }],
  },
  {
    id: "hao_wisps", npc: "hao", title: "Wisps of the Hollow", minLv: 4,
    intro: "South of the pond, where the mist never lifts, little lights drift where no lantern burns. Ink Wisps. Skittish, fast, and they shed a cold essence when they fade. Clear out 4 of them and bring me 2 of their essence. Light keeps the masks away, and I pay well for things that keep the dark at bay.",
    reminder: "Four Ink Wisps and two Wisp Essence, in the misty hollow south-west of the pond. They lash with a strip of ink; sidestep the wind-up.",
    done: "Cold light in a jar. The masks hate it. Take this; a lantern to carry your own light.",
    obj: [{ kind: "kill", target: "ink_wisp", count: 4, text: "Defeat Ink Wisps" }, { kind: "collect", item: "Wisp Essence", count: 2, consume: true }],
    rewardXp: 260, rewardCoin: 50, rewardItems: [{ item: "Wisp Lantern", qty: 1 }],
  },
  {
    id: "wu_fox", npc: "wu", title: "The Grey Fox", minLv: 5, requires: ["wu_masks"],
    intro: "Old Whisker, the grey fox of the hills, is older than the Gate. Travellers say a masked man was seen carrying something to his den. Find him in the fox hills and put him down. He is five times the fox of any other; bring friends. He bites in a wide arc: stay behind him or dodge-roll with Space.",
    reminder: "Old Whisker roams the fox hills, east of the valley. If he is not there, he is resting; the hills are his for twenty minutes at a time.",
    done: "So it is true. Old Whisker is gone, and he carried a piece of the Hollow Sect's seal. Keep it safe; Artisan Tao may know what to do with it.",
    obj: [{ kind: "kill", target: "old_whisker", count: 1, text: "Defeat Old Whisker, the Grey Fox" }],
    rewardXp: 520, rewardCoin: 60, rewardItems: [{ item: "Lotus Antidote", qty: 2 }],
  },
  {
    id: "tao_seal", npc: "tao", title: "Mending the Seal", minLv: 6, requires: ["wu_fox", "tao_start"],
    intro: "A Hollow Seal Fragment! The seal is how the masked sect drains qi from spirits. Broken, it is only a hungry stone. I can bind it into a ward, if you bring me 3 Jade Scales and 2 Toad Jelly to set the binding. Do not lose the fragment. Old Whisker will not return for twenty minutes.",
    reminder: "The Hollow Seal Fragment from Old Whisker, 3 Jade Scales from the pond serpents, and 2 Toad Jelly from the toads. Then I can bind it.",
    done: "There. A ward where a curse was. Wear it close, and the next mask that sees you will remember its manners.",
    obj: [{ kind: "collect", item: "Hollow Seal Fragment", count: 1, consume: true }, { kind: "collect", item: "Jade Scale", count: 3, consume: true }, { kind: "collect", item: "Toad Jelly", count: 2, consume: true }],
    rewardXp: 620, rewardCoin: 80, rewardItems: [{ item: "Warden's Seal Charm", qty: 1 }], rewardTitle: "Seal Mender",
  },
  {
    id: "wu_finale", npc: "wu", title: "The Guardian's Silence", minLv: 8, requires: ["wu_fox"],
    intro: "The Stone Guardian was not always a monster. Its master, who wore the Cloudmist Pendant, went north to seal something and never returned. The Hollow Sect wants the Guardian's core to open that seal again. Defeat the Guardian at the shrine, and bring me its core before they find a way to take it. This is the hardest thing I have asked of anyone. Go with allies, and watch the ground.",
    reminder: "The Stone Guardian waits at the ruined shrine, far to the north. Bring me its core. It will not be easy alone. Leave every glowing ring before it strikes.",
    done: "Its core, whole. The sect will not have it. You have done the valley, and an old man at a gate, a great service. This blade is the best thing I own. It is yours.",
    obj: [{ kind: "collect", item: "Guardian Core", count: 1, consume: true }],
    rewardXp: 1200, rewardCoin: 150, rewardJade: 5, rewardByClass: { sword: "Cloudpiercer Jian", talisman: "Cloudpiercer Brush", physician: "Cloudpiercer Needles", blade: "Cloudpiercer Dao" }, rewardTitle: "Keeper of the Gate",
  },
  {
    id: "wu_warden", npc: "wu", title: "The Mist Ward", minLv: 8, requires: ["wu_finale"],
    intro: "You have silenced the Guardian. But the seal it kept has a second warden: a thing of mist and old stone that walks the south-east hollow. The Hollow Sect has poisoned its purpose. Put it down before it turns on the valley. It is faster than the Guardian, and its rings come quicker.",
    reminder: "The Mist Warden waits in the south-east hollow. It is fast; leave its glowing rings and run around its sweeping beam.",
    done: "The second ward is quiet. You have done what the Gate could not, twice over. Take this, Mistbreaker; the valley will remember.",
    obj: [{ kind: "kill", target: "mist_warden", count: 1, text: "Defeat the Mist Warden" }],
    rewardXp: 1800, rewardCoin: 200, rewardJade: 4, rewardItems: [{ item: "Wisp Lantern", qty: 1 }], rewardTitle: "Mistbreaker",
  },
  // ---- 0.5.0: Thorns of the Reed, Lantern Keeper Mei's three-step side-quest chain. A linear chain: each step requires the one
  // before it and opens one level higher. Step 1 uses the Bamboo Fiber and Serpent Gall drops, step 2 the new Thorn Sprites, and
  // step 3 turns the sprites' own fibre into Mei's ward for a gear reward and a title (titles are collected into ALL_TITLES via QUEST_TITLES).
  {
    id: "mei_reeds", npc: "mei", title: "Thorns in the Reeds", minLv: 4,
    intro: "The reed banks north of the pond have gone sour. Thorn Sprites have rooted in them, and their thorns scratch at my lantern glass every night. Bring me 4 Bamboo Fiber to re-wick the plaza lanterns, and 3 Serpent Gall from the Jade Serpents for a bitter wash the thorns will not cross. The serpents coil before they strike; the sprites will leave you alone until you strike first.",
    reminder: "Four Bamboo Fiber from the bamboo spirits in the western grove, three Serpent Gall from the Jade Serpents around the pond. The gall is rare; keep at it. The serpents coil before they strike.",
    done: "Bamboo for wicks, and gall bitter enough to burn. The lanterns will hold the dark off another season. Here is your share.",
    obj: [{ kind: "collect", item: "Bamboo Fiber", count: 4, consume: true }, { kind: "collect", item: "Serpent Gall", count: 3, consume: true }],
    rewardXp: 320, rewardCoin: 45, rewardItems: [{ item: "Healing Tonic", qty: 2 }],
  },
  {
    id: "mei_sprites", npc: "mei", title: "The Sprite's Heart", minLv: 5, requires: ["mei_reeds"],
    intro: "The wash has kept them off the lanterns, but the sprites are still nested in the reeds along the north bank, and no one can walk the towpath without a thorn in the leg. Defeat 6 Thorn Sprites for me. They keep their distance and spit a thorn down a straight line: step out of the line before it lands. They will not stir until you strike first.",
    reminder: "Six Thorn Sprites, on the rise along the pond's north bank. They spit a thorn down a straight line; sidestep the wind-up and close the distance. They leave you alone until you strike first.",
    done: "So the reeds are quiet again. They left a knot of thorn-fibre behind, tough as wire. I can bind a ward from that, but I will need more.",
    obj: [{ kind: "kill", target: "thorn_sprite", count: 6, text: "Defeat Thorn Sprites" }],
    rewardXp: 440, rewardCoin: 65, rewardItems: [{ item: "Qi Elixir", qty: 2 }],
  },
  {
    id: "mei_warden", npc: "mei", title: "Reedwarden", minLv: 6, requires: ["mei_sprites"],
    intro: "Two more lengths of Bamboo Fiber and the ward is done: I will bind the sprites' thorn-fibre around a reed frame and set it in the banks, and they will not root there again. Bring me 2 Bamboo Fiber. Then I will name you what you have become: Reedwarden of the pond.",
    reminder: "Two Bamboo Fiber, dear. The bamboo spirits in the western grove carry it, and the sprites shed it. Then I can bind the ward.",
    done: "There: the frame is set, the thorns hold, and the reeds are quiet. Take this lantern; it does not blow out in the wet, and its light does not flinch. When the valley asks who kept the reeds, tell them: Reedwarden.",
    obj: [{ kind: "collect", item: "Bamboo Fiber", count: 2, consume: true }],
    rewardXp: 700, rewardCoin: 100, rewardJade: 2, rewardItems: [{ item: "Wisp Lantern", qty: 1 }], rewardTitle: "Reedwarden",
  },
  // ---- 0.5.0: the Forge-Sworn chain, Artisan Tao's three-step commission. A linear chain like Thorns of the Reed: step 1 is a
  // kill trial against the Stone Hound packs (never a side-quest kill target before), step 2 gathers fang-iron and quench jelly,
  // and step 3 sets the temper with cold wisp light for a Hound-Fang Charm and a new title (titles flow into ALL_TITLES via QUEST_TITLES).
  {
    id: "tao_hounds", npc: "tao", title: "Sparks in the Foothills", minLv: 5,
    intro: "I have promised the Gate Warden a charm that turns a hound's bite, and I will not sell him an untested one. Take a blade into the northern foothills and put down 8 Stone Hounds. I want to see how the pack fights before I set the fang-iron: they run in threes, so strike one and its packmates come, and their bite sweeps a cone in front of them. Step out of the cone, not through it.",
    reminder: "Eight Stone Hounds in the northern foothills, towards the shrine. They hunt in threes; pull one and the pack follows. Their bite is a cone; step out of it and strike from the side.",
    done: "Eight, and you are still standing. The pack bites as one, so the charm must answer a whole cone, not a single set of teeth. Now I need the fangs.",
    obj: [{ kind: "kill", target: "stone_hound", count: 8, text: "Defeat Stone Hounds" }],
    rewardXp: 380, rewardCoin: 70, rewardItems: [{ item: "Healing Tonic", qty: 2 }],
  },
  {
    id: "tao_quench", npc: "tao", title: "The Quenching Bath", minLv: 6, requires: ["tao_hounds"],
    intro: "Fang-iron takes a careful quench. Bring me 4 Hound Fang for the charm's teeth and 3 Toad Jelly from the Lotus Toad Wardens to fill the bath; the jelly keeps the temper even and stops the fang-iron from cracking. The toads leave you be until you strike them, and their spit comes down a straight line. Step out of the line before it lands.",
    reminder: "Four Hound Fang and three Toad Jelly. Hounds on the northern foothills, toads along the pond shore. Step out of the toads' spit line.",
    done: "Fang and jelly, and the bath is ready. The charm will hold a bite off now. One last thing: the temper needs cold wisp light to set.",
    obj: [{ kind: "collect", item: "Hound Fang", count: 4, consume: true }, { kind: "collect", item: "Toad Jelly", count: 3, consume: true }],
    rewardXp: 520, rewardCoin: 90, rewardItems: [{ item: "Lotus Antidote", qty: 2 }],
  },
  {
    id: "tao_oath", npc: "tao", title: "The Whetstone Oath", minLv: 7, requires: ["tao_quench"],
    intro: "Last of it. Bring me 2 Wisp Essence from the Ink Wisps in the misty south hollow: cold light set in fang-iron keeps a charm from going dull in the wet, and I do not forge dull work. The wisps lash a line of ink before they strike; stay off the line. Then the charm is yours, and I will put a smith's name to it: Forge-Sworn.",
    reminder: "Two Wisp Essence, from the Ink Wisps drifting in the misty hollow south of the pond. They lash a line of ink; stay off the line.",
    done: "There it is: hound's tooth, toad's jelly, wisp's cold light, all holding together. Wear it, Forge-Sworn. The valley will know the smith who armed you.",
    obj: [{ kind: "collect", item: "Wisp Essence", count: 2, consume: true }],
    rewardXp: 800, rewardCoin: 150, rewardJade: 3, rewardItems: [{ item: "Hound-Fang Charm", qty: 1 }], rewardTitle: "Forge-Sworn",
  },
];
export const SIDE_QUEST_BY_ID = new Map(SIDE_QUESTS.map((q) => [q.id, q] as const));

// ---------------- Merit seals (achievements) and titles ----------------
/** counter keys, all produced by `server/src/game/content.ts` (or the economy/quest systems it hooks into):
 *  `kills` (all), `kill:<mobType>`, `best:<mobType>` (bestiary kills), `bestTypes` (mob types discovered),
 *  `bosses` (distinct bosses defeated), `tideKills` (kills during a Lantern Tide), `talk:<npc>` (0/1 each),
 *  `talked` (distinct npcs), `greet:<npc>` (greeting lines heard), `craft`, `poi` (places found), `quest` (side
 *  quests done), `lv` (highest level), `equipped` (slots filled), `rare` (rare+ items worn), `set:<setId>` (worn
 *  pieces of a set), `setsDone` (complete sets worn), `chain` (Elder Lin's chain done). `ACHIEVEMENTS` is validated
 *  against the real counter set by the content test. */
export interface AchDef { id: string; name: string; desc: string; cat: "Combat" | "Exploration" | "Story" | "Craft"; pts: number; counter: string; need: number; title?: string }
export const ACHIEVEMENTS: AchDef[] = [
  { id: "first_blood", name: "First Blood", desc: "Defeat your first spirit.", cat: "Combat", pts: 5, counter: "kills", need: 1 },
  { id: "bamboo_bane", name: "Bamboo Bane", desc: "Defeat 60 Bamboo Spirits.", cat: "Combat", pts: 10, counter: "kill:bamboo_spirit", need: 60, title: "Bamboo Bane" },
  { id: "fox_hunter", name: "Fox Hunter", desc: "Defeat 40 Fox Spirits.", cat: "Combat", pts: 10, counter: "kill:fox_spirit", need: 40, title: "Fox Hunter" },
  { id: "pond_purifier", name: "Pond Purifier", desc: "Defeat 25 Jade Serpents.", cat: "Combat", pts: 10, counter: "kill:jade_serpent", need: 25, title: "Pond Purifier" },
  { id: "toad_tamer", name: "Toad Tamer", desc: "Defeat 15 Lotus Toad Wardens.", cat: "Combat", pts: 5, counter: "kill:lotus_toad", need: 15 },
  { id: "pack_breaker", name: "Pack Breaker", desc: "Defeat 15 Stone Hounds.", cat: "Combat", pts: 10, counter: "kill:stone_hound", need: 15, title: "Pack Breaker" },
  { id: "whiskers_bane", name: "Whisker's Bane", desc: "Defeat Old Whisker, the Grey Fox.", cat: "Combat", pts: 15, counter: "kill:old_whisker", need: 1, title: "Whisker's Bane" },
  { id: "guardian_breaker", name: "Guardian Breaker", desc: "Defeat the Stone Guardian.", cat: "Combat", pts: 20, counter: "kill:stone_guardian", need: 1, title: "Guardian Breaker" },
  { id: "level_5", name: "Seasoned Walker", desc: "Reach level 5.", cat: "Story", pts: 5, counter: "lv", need: 5 },
  { id: "level_10", name: "Rising Cultivator", desc: "Reach level 10.", cat: "Story", pts: 10, counter: "lv", need: 10 },
  { id: "level_20", name: "Master of the Valley", desc: "Reach level 20.", cat: "Story", pts: 25, counter: "lv", need: 20, title: "Master of the Valley" },
  { id: "talk_all", name: "Know Your Neighbours", desc: "Speak with all six people of the plaza.", cat: "Story", pts: 10, counter: "talked", need: 6 },
  { id: "valley_hero", name: "Hero of the Valley", desc: "Finish all of Elder Lin's tasks.", cat: "Story", pts: 20, counter: "chain", need: 1, title: "Hero of the Valley" },
  { id: "side_3", name: "Helping Hand", desc: "Finish 3 side quests.", cat: "Story", pts: 10, counter: "quest", need: 3 },
  { id: "side_8", name: "Friend of the Plaza", desc: "Finish 8 side quests.", cat: "Story", pts: 25, counter: "quest", need: 8, title: "Friend of the Plaza" },
  { id: "wanderer", name: "Wanderer", desc: "Discover 3 places of interest.", cat: "Exploration", pts: 10, counter: "poi", need: 3 },
  { id: "cartographer", name: "Cartographer", desc: "Discover all 6 places of interest.", cat: "Exploration", pts: 20, counter: "poi", need: 6, title: "Cartographer" },
  { id: "apprentice", name: "Apprentice Smith", desc: "Craft 5 items with Artisan Tao.", cat: "Craft", pts: 10, counter: "craft", need: 5, title: "Apprentice Smith" },
  { id: "well_dressed", name: "Well Dressed", desc: "Fill all six equipment slots.", cat: "Craft", pts: 15, counter: "equipped", need: 6 },
  { id: "rare_find", name: "A Rare Find", desc: "Wear a rare or epic item.", cat: "Craft", pts: 10, counter: "rare", need: 1 },
  // ---- 0.6.0: goals tied to the systems added since the first collection (bestiary, the three bosses, the Lantern
  // Tide, gear sets, deeper crafting, the full side-quest chain and the cultivation realms). Needs that mirror a data
  // size (mob types, bosses, side quests, set pieces, rare/epic slots) are derived from the data so they cannot drift.
  { id: "codex_complete", name: "Codex Complete", desc: "Discover every mob type in the Bestiary.", cat: "Exploration", pts: 25, counter: "bestTypes", need: (Object.keys(MOBS) as MobType[]).length, title: "Keeper of the Codex" },
  { id: "three_wards", name: "Warden of the Valley", desc: "Defeat every valley boss.", cat: "Combat", pts: 25, counter: "bosses", need: (Object.keys(MOBS) as MobType[]).filter((t) => MOBS[t].boss).length, title: "Wardbreaker" },
  { id: "valley_veteran", name: "Valley Veteran", desc: "Defeat 150 spirits in the valley.", cat: "Combat", pts: 15, counter: "kills", need: 150, title: "Valley Veteran" },
  { id: "tide_rider", name: "Tide Rider", desc: "Defeat 20 spirits while a Lantern Tide is running.", cat: "Combat", pts: 10, counter: "tideKills", need: 20 },
  { id: "master_smith", name: "Master Smith", desc: "Craft 25 items with Artisan Tao.", cat: "Craft", pts: 15, counter: "craft", need: 25, title: "Master Smith" },
  { id: "adorned", name: "The Adorned", desc: "Wear rare or epic gear in four slots at once.", cat: "Craft", pts: 15, counter: "rare", need: new Set(GEAR.filter((g) => g.rarity === "rare" || g.rarity === "epic").map((g) => g.slot)).size, title: "The Adorned" },
  { id: "thornweave_adept", name: "Thornweave Adept", desc: "Wear all three Thornweave pieces at once.", cat: "Craft", pts: 10, counter: "set:thornweave", need: Object.values(GEAR_SET_OF).filter((s) => s === "thornweave").length, title: "Thornweave Adept" },
  { id: "set_collector", name: "Set Collector", desc: "Wear every piece of any one equipment set at once.", cat: "Craft", pts: 5, counter: "setsDone", need: 1 },
  // 0.5.0 P3: both linked wardens fall -> the pair seal (counter kill:twin_warden is produced by the normal kill hook).
  { id: "twin_breaker", name: "Twinbreaker", desc: "Defeat both Twin Wardens.", cat: "Combat", pts: 20, counter: "kill:twin_warden", need: 2, title: "Twinbreaker" },
  { id: "side_all", name: "Friend of the Valley", desc: "Finish every side quest.", cat: "Story", pts: 25, counter: "quest", need: SIDE_QUESTS.length, title: "Friend of the Valley" },
  { id: "nascent_soul", name: "Nascent Soul", desc: "Reach level 15, the Nascent Soul realm.", cat: "Story", pts: 15, counter: "lv", need: 15, title: "Nascent Soul" },
];
export const ACH_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a] as const));
/** Titles that quests grant (achievement titles come from ACHIEVEMENTS). */
export const QUEST_TITLES = SIDE_QUESTS.flatMap((q) => (q.rewardTitle ? [q.rewardTitle] : []));
export const ALL_TITLES = [...new Set([...ACHIEVEMENTS.flatMap((a) => (a.title ? [a.title] : [])), ...QUEST_TITLES])];
