// JIUZHOU — shared network contract. Server and client BOTH import this file.
// Owner: coordinator. Server/client agents must NOT edit it; request changes instead.
// Transport: WebSocket, JSON text frames (swap for binary later). Server is authoritative.

export const PROTOCOL_VERSION = 3;
export const TICK_RATE = 20;          // server simulation ticks per second
export const SNAPSHOT_RATE = 10;      // snapshots sent per second (every 2nd tick)
export const WORLD_SIZE = 200;        // zone is a square, x/z in [-100, 100]
export const PLAYER_SPEED = 6;        // world units / second
export const INTEREST_RADIUS = 60;    // only entities within this radius are sent

export type ClassId = "sword" | "talisman" | "physician";
// sword      Sword Cultivator — melee, high damage, short range
// talisman   Talisman Master  — ranged, elemental talisman bolts, AoE
// physician  Physician        — support, heals self/allies, weak damage

export type EntityKind = "player" | "mob" | "npc";

export interface EntityState {
  id: number;
  k: EntityKind;
  n: string;        // display name (e.g. "Bamboo Spirit")
  x: number;
  z: number;
  r: number;        // facing, radians (0 = +z)
  hp: number;
  mhp: number;
  lv: number;
  cls?: ClassId;    // players only
  mob?: MobType;    // mobs only
  st?: "idle" | "move" | "attack" | "dead"; // animation hint
}

export type MobType = "bamboo_spirit" | "fox_spirit" | "stone_guardian" | "jade_serpent"; // jade_serpent: pond/bridge mob

export interface SkillDef {
  id: number;       // 1..4 hotbar slot
  name: string;
  nameZh: string;
  cooldown: number; // seconds
  range: number;
  kind: "melee" | "bolt" | "aoe" | "heal";
}

// ---------- Client -> Server ----------
export type ClientMsg =
  | { t: "login"; name: string; cls: ClassId; v: number; pw?: string; tok?: string } // v3: pw 4-64 chars; unknown name + pw registers, known name needs matching pw; tok = short-lived launcher session token from POST /api/auth, replaces pw
  | { t: "input"; seq: number; dx: number; dz: number }       // dx,dz in [-1,1]; server normalizes
  | { t: "cast"; skill: number; target?: number; tx?: number; tz?: number }
  | { t: "chat"; text: string }                                // max 120 chars, server trims
  | { t: "claim"; id: string }                                  // v3: claim a completed daily task reward
  | { t: "ping"; c: number };

// ---------- Server -> Client ----------
export type ServerMsg =
  | { t: "welcome"; id: number; zone: ZoneInfo; skills: SkillDef[]; tickRate: number }
  | { t: "snap"; tick: number; ack: number; ents: EntityState[]; gone: number[] } // ack = last processed input seq
  | { t: "ev"; e: GameEvent }
  | { t: "pong"; c: number; s: number }
  | { t: "inv"; items: InvItem[] }   // full inventory; sent after welcome and whenever it changes (v2)
  | { t: "wallet"; coin: number; jade: number }   // v3: sent after welcome and on change. coin = soft currency, jade = rare currency
  | { t: "daily"; tasks: DailyTask[]; resetIn: number } // v3: daily board, resetIn seconds to next UTC reset
  | { t: "error"; msg: string };

export interface DailyTask {
  id: string; title: string; desc: string;
  have: number; need: number;
  coin: number; jade: number; xp: number;   // rewards
  done: boolean; claimed: boolean;
}

export interface InvItem { item: string; itemZh: string; qty: number }

export interface ZoneInfo {
  id: string;           // "cloudmist_valley"
  name: string;         // "Cloudmist Valley"
  nameZh: string;       // always empty (English-only UI)
  size: number;
  spawn: { x: number; z: number };
}

export type GameEvent =
  | { k: "damage"; src: number; dst: number; amount: number; crit: boolean; skill?: number }
  | { k: "heal"; src: number; dst: number; amount: number }
  | { k: "death"; id: number; killer?: number }
  | { k: "cast"; src: number; skill: number; tx: number; tz: number }   // for VFX
  | { k: "chat"; from: string; text: string; sys?: boolean }
  | { k: "xp"; amount: number; lv: number; xp: number; next: number }
  | { k: "levelup"; lv: number }
  | { k: "loot"; item: string; itemZh: string; qty: number }
  // v2: telegraphed boss attack. Ground circle at (x,z) with radius; damage lands `delay` seconds after the event
  // to every player still inside it. Lets players dodge.
  | { k: "telegraph"; src: number; x: number; z: number; radius: number; delay: number };
