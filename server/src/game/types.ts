import type { ClassId, EntityState, GearSlot, GearStats, InvItem } from "../../../shared/protocol.ts";
import type { MobDef } from "../data.ts";
import type { TokenBucket } from "./util.ts";

/** stage = index into QUESTS (== QUESTS.length when all done); status 0 = not accepted, 1 = active, 2 = objective complete (turn in). */
export interface QuestState { stage: number; status: 0 | 1 | 2; progress: number; progress2: number /* second objective (loot), if the quest has one */; mei: 0 | 1 | 2 /* Lantern Keeper Mei errand: 0 not started, 1 accepted, 2 done */ }

/** 0.4.0 content state of one player (loaded at login, written through to ContentDb on change). */
export interface ContentState {
  equipped: Map<GearSlot, string>;
  quests: Map<string, { st: 1 | 2; p: [number, number, number] }>;   // side quests: 1 accepted, 2 turned in
  counters: Map<string, number>;
  merits: Set<string>;
  pois: Set<string>;
  titles: Set<string>;
  title: string;
  dirty: boolean;           // side-quest collect counts may have changed (pack changed): resend `sq` on the next content tick
}

export type Anim = "idle" | "move" | "attack" | "dead";

interface Base {
  id: number; n: string; x: number; z: number; r: number;
  hp: number; mhp: number; lv: number; st: Anim;
  visible: boolean;       // false => not in grid / never sent (e.g. despawned corpse)
  state: EntityState;     // reused wire object, refreshed every snapshot
}

export interface Player extends Base {
  /** TEST_MODE only (/testdrops): every loot roll succeeds so tests are deterministic. */
  testDrops?: boolean;
  k: "player"; cls: ClassId; xp: number;
  inDx: number; inDz: number; inTime: number; ack: number;
  cdReady: number[];      // index = skill id (1..4), sim-time when ready
  gcdReady: number; lastHurt: number; attackUntil: number; respawnAt: number;
  guardUntil: number; guardMult: number;
  send: (json: string) => void;
  known: Set<number>;     // entity ids the client currently knows about
  chatBucket: TokenBucket;
  quest: QuestState; nearElder: boolean;
  inv: Map<string, InvItem>;
  poisonUntil: number; poisonNext: number; poisonDmg: number; poisonSrc: number; // damage over time (Jade Serpent)
  qi: number; mqi: number; qiResumeAt: number; qiMsgAt: number;                  // 0.4.0 jade Qi pool
  gear: GearStats; cx?: ContentState; potionReady: number;                        // 0.4.0 content: summed equipment bonuses, content state, shared potion cooldown
  dodgeReady: number; dashUntil: number; dashLeft: number; dashDx: number; dashDz: number; invulnUntil: number; // 0.4.0 dodge roll
}

export interface Mob extends Base {
  k: "mob"; def: MobDef; spawnX: number; spawnZ: number;
  ai: "idle" | "chase" | "return" | "dead";
  threat: Map<number, number>; target: number;
  nextAttack: number; attackUntil: number; slowUntil: number; slowMult: number;
  wanderX: number; wanderZ: number; wanderAt: number;
  deadAt: number; respawnAt: number;
  windupUntil: number; windupTarget: number; windupX: number; windupZ: number; // Jade Serpent lunge: frozen until windupUntil, then dashes at windupTarget
  packCalled?: boolean;   // 0.4.0: this mob already called its pack for the current fight
  swing?: SwingState;     // regular-mob telegraphed swing in progress (fox cone / bamboo line)
  boss?: BossState;
}

export interface SwingState { at: number; dir: number }
export interface BeamState { start: number; lead: number; end: number; dir0: number; sweep: number; nextTick: number; x: number; z: number }

export interface PendingSlam { at: number; x: number; z: number; radius: number; dmg: number }
export interface BossState {
  engagedAt: number;      // sim time combat began (0 = not engaged)
  nextSlam: number; patternIdx: number; rr: number; // round-robin target index
  phase2: boolean; enraged: boolean;
  phase3: boolean; beam?: BeamState;   // phase 3 (<25% HP): cracked open, rotating rune beam
  pending: PendingSlam[];
}

export interface Npc extends Base { k: "npc" }
export type Entity = Player | Mob | Npc;
