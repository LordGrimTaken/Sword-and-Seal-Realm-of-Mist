// All tunable game data lives here: zone, classes/skills, mobs, spawns, NPCs, XP curve.
import type { ClassId, MobType, SkillDef, ZoneInfo } from "../../shared/protocol.ts";

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
  guard?: { mult: number; dur: number };// incoming damage multiplier on caster
}
export interface ClassData {
  name: string;
  baseHp: number; hpPerLevel: number;
  atk: number; atkPerLevel: number;
  crit: number; critMult: number;
  skills: SkillData[]; // index 0..3 => skill ids 1..4
}

const sk = (id: number, name: string, nameZh: string, cooldown: number, range: number, kind: SkillDef["kind"]): SkillDef =>
  ({ id, name, nameZh, cooldown, range, kind });

export const CLASSES: Record<ClassId, ClassData> = {
  sword: {
    name: "Sword Cultivator", baseHp: 120, hpPerLevel: 25, atk: 9, atkPerLevel: 3, crit: 0.12, critMult: 1.6,
    skills: [
      { def: sk(1, "Flowing Slash", "", 1.0, 3.5, "melee"), target: "enemy", power: 1.0 },
      { def: sk(2, "Sword Qi Wave", "", 3.0, 14, "bolt"), target: "enemy", power: 1.3 },
      { def: sk(3, "Heaven-Splitting Strike", "", 8.0, 4.0, "melee"), target: "enemy", power: 3.2 },
      { def: sk(4, "Qi Guard", "", 15.0, 0, "heal"), target: "self", power: 0, healPct: 0.1, guard: { mult: 0.5, dur: 5 } },
    ],
  },
  talisman: {
    name: "Talisman Master", baseHp: 90, hpPerLevel: 18, atk: 8, atkPerLevel: 3, crit: 0.15, critMult: 1.7,
    skills: [
      { def: sk(1, "Fire Talisman", "", 1.2, 20, "bolt"), target: "enemy", power: 1.1 },
      { def: sk(2, "Thunder Talisman", "", 6.0, 24, "aoe"), target: "point", power: 1.6, radius: 6 },
      { def: sk(3, "Frost Seal", "", 8.0, 18, "bolt"), target: "enemy", power: 0.8, slow: { mult: 0.4, dur: 4 } },
      { def: sk(4, "Wind Step", "", 12.0, 0, "heal"), target: "self", power: 0, guard: { mult: 0.6, dur: 4 } },
    ],
  },
  physician: {
    name: "Physician", baseHp: 105, hpPerLevel: 22, atk: 6, atkPerLevel: 2.5, crit: 0.1, critMult: 1.5,
    skills: [
      { def: sk(1, "Jade Needle", "", 1.0, 16, "bolt"), target: "enemy", power: 1.0 },
      { def: sk(2, "Spring Rain", "", 7.0, 0, "heal"), target: "self", power: 3.0, healPct: 0.15, radius: 12, healAllies: true },
      { def: sk(3, "Purifying Light", "", 6.0, 14, "aoe"), target: "point", power: 2.2, radius: 5 },
      { def: sk(4, "Meridian Surge", "", 20.0, 0, "heal"), target: "self", power: 0, healPct: 0.4 },
    ],
  },
};

export const maxHpFor = (cls: ClassId, lv: number) => CLASSES[cls].baseHp + CLASSES[cls].hpPerLevel * (lv - 1);
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
  enrageAfter: number;           // seconds of continuous combat until enrage
  enrageMult: number;            // damage multiplier when enraged
  creditRange: number;           // players within this distance of the boss at death are credited
  targetRange: number;           // telegraph targets are chosen among players this close
}
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
  boss?: BossDef;
}
export const MOBS: Record<MobType, MobDef> = {
  bamboo_spirit: {
    type: "bamboo_spirit", name: "Bamboo Spirit", hpBase: 60, hpPerLv: 30, dmgBase: 4, dmgPerLv: 2,
    speed: 3.2, aggro: 9, leash: 30, wander: 8, attackRange: 2.2, attackCd: 1.6, respawn: 15, xpPerLv: 10,
    loot: [{ item: "Bamboo Fiber", itemZh: "", chance: 0.7, min: 1, max: 2 }],
  },
  fox_spirit: {
    type: "fox_spirit", name: "Fox Spirit", hpBase: 90, hpPerLv: 40, dmgBase: 4.5, dmgPerLv: 2,
    speed: 4.6, aggro: 14, leash: 38, wander: 10, attackRange: 2.4, attackCd: 1.4, respawn: 25, xpPerLv: 12,
    loot: [{ item: "Fox Tail", itemZh: "", chance: 0.6, min: 1, max: 1 }],
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
      enrageAfter: 150, enrageMult: 1.5, creditRange: 70, targetRange: 40,
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
];

/** Inventory limits. */
export const INV = { maxStack: 99, maxSlots: 30 };

export const NPCS = [
  { name: "Elder Lin", x: -4, z: -70, r: 0.4 },
  { name: "Lantern Keeper Mei", x: 7, z: -74, r: -0.6 },
  { name: "Gate Warden Wu", x: -9, z: -88, r: 0.2 },
  { name: "Notice Board Keeper Fen", x: 8, z: -85, r: -1.0 }, // inside the plaza ring, clear of the lantern ring (r 11.8), flag poles (r 11), seats (+-8.5,-74.5) and Mei
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
