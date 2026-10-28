import type { ClassId, EntityState, InvItem } from "../../../shared/protocol.ts";
import type { MobDef } from "../data.ts";
import type { TokenBucket } from "./util.ts";

/** stage = index into QUESTS (== QUESTS.length when all done); status 0 = not accepted, 1 = active, 2 = objective complete (turn in). */
export interface QuestState { stage: number; status: 0 | 1 | 2; progress: number; progress2: number /* second objective (loot), if the quest has one */; mei: 0 | 1 | 2 /* Lantern Keeper Mei errand: 0 not started, 1 accepted, 2 done */ }

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
}

export interface Mob extends Base {
  k: "mob"; def: MobDef; spawnX: number; spawnZ: number;
  ai: "idle" | "chase" | "return" | "dead";
  threat: Map<number, number>; target: number;
  nextAttack: number; attackUntil: number; slowUntil: number; slowMult: number;
  wanderX: number; wanderZ: number; wanderAt: number;
  deadAt: number; respawnAt: number;
  windupUntil: number; windupTarget: number; windupX: number; windupZ: number; // Jade Serpent lunge: frozen until windupUntil, then dashes at windupTarget
  boss?: BossState;
}

export interface PendingSlam { at: number; x: number; z: number; radius: number; dmg: number }
export interface BossState {
  engagedAt: number;      // sim time combat began (0 = not engaged)
  nextSlam: number; patternIdx: number; rr: number; // round-robin target index
  phase2: boolean; enraged: boolean;
  pending: PendingSlam[];
}

export interface Npc extends Base { k: "npc" }
export type Entity = Player | Mob | Npc;
