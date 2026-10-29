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
  ttl?: string;     // 0.4.0 additive: active title of a player (shown under the nameplate)
}

export type MobType = "bamboo_spirit" | "fox_spirit" | "stone_guardian" | "jade_serpent" // jade_serpent: pond/bridge mob
  | "lotus_toad" | "stone_hound" | "old_whisker"; // 0.4.0 content: passive spitting toad, pack-hunting hound, named rare fox

export interface SkillDef {
  id: number;       // 1..4 hotbar slot
  name: string;
  nameZh: string;
  cooldown: number; // seconds
  range: number;
  kind: "melee" | "bolt" | "aoe" | "heal";
  qi?: number;      // 0.4.0 additive: Qi cost per cast (absent = free)
}

// ---------- Client -> Server ----------
export type ClientMsg =
  | { t: "login"; name: string; cls: ClassId; v: number; pw?: string; tok?: string } // v3: pw 4-64 chars; unknown name + pw registers, known name needs matching pw; tok = short-lived launcher session token from POST /api/auth, replaces pw
  | { t: "input"; seq: number; dx: number; dz: number }       // dx,dz in [-1,1]; server normalizes
  | { t: "cast"; skill: number; target?: number; tx?: number; tz?: number }
  | { t: "chat"; text: string }                                // max 120 chars, server trims
  | { t: "claim"; id: string }                                  // v3: claim a completed daily task reward
  | { t: "dodge"; dx?: number; dz?: number }                    // 0.4.0 additive (still v3): dodge roll; dx,dz = wanted direction (server normalizes; zero/absent = facing)
  | { t: "ping"; c: number }
  // 0.4.0 content (additive, still v3): gear, consumables, NPC quests and trade, titles. All validated server-side.
  | { t: "equip"; item: string } | { t: "unequip"; slot: string } | { t: "use"; item: string }
  | { t: "npc"; npc: string; a: "talk" | "accept" | "turnin"; q?: string }
  | { t: "craft"; id: string } | { t: "buy"; item: string; qty?: number } | { t: "sell"; item: string; qty?: number }
  | { t: "title"; id: string };

// ---------- Server -> Client ----------
export type ServerMsg =
  | { t: "welcome"; id: number; zone: ZoneInfo; skills: SkillDef[]; tickRate: number }
  | { t: "snap"; tick: number; ack: number; ents: EntityState[]; gone: number[]; qi?: number; mqi?: number; dcd?: number } // ack = last processed input seq. 0.4.0 additive, per recipient: qi/mqi = own Qi / max Qi, dcd = seconds until the dodge roll is ready (0 = ready)
  | { t: "ev"; e: GameEvent }
  | { t: "pong"; c: number; s: number }
  | { t: "inv"; items: InvItem[] }   // full inventory; sent after welcome and whenever it changes (v2)
  | { t: "wallet"; coin: number; jade: number }   // v3: sent after welcome and on change. coin = soft currency, jade = rare currency
  | { t: "daily"; tasks: DailyTask[]; resetIn: number } // v3: daily board, resetIn seconds to next UTC reset
  | { t: "error"; msg: string }
  // 0.4.0 content (additive, still v3)
  | { t: "items"; items: ItemInfo[] }                       // item catalogue (gear stats, consumables), sent once after welcome
  | { t: "gear"; slots: Record<string, string | null>; stats: GearStats }   // equipped items per slot + summed bonuses
  | { t: "npcdlg"; npc: string; name: string; role: string; lines: string[]; quests: SideQuestView[]; craft?: CraftView[]; buy?: BuyView[]; sell?: SellView[] }
  | { t: "sq"; quests: SideQuestView[] }                    // the player's accepted/finished side quests (journal)
  | { t: "prog"; ach: AchView[]; pts: number; title: string | null; titles: string[]; pois: PoiView[] } // merit seals, titles, discovered places
  | { t: "toast"; kind: "poi" | "ach" | "title" | "item" | "quest"; title: string; text: string };

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
  // 0.4.0 additive: dodge roll. "dodge" = a player started a roll (VFX, sent to everyone nearby); "dodged" = i-frames negated a hit on `id` (sent to that player).
  | { k: "dodge"; id: number; x: number; z: number; dx: number; dz: number; dist: number; dur: number }
  | { k: "dodged"; id: number }
  // v3.1 (additive, old clients keep drawing a circle of `radius`): optional `shape` variants. Angles are radians, 0 = +z, direction vector (sin a, cos a).
  //   circle (default)  centre (x,z), `radius`
  //   cone              apex (x,z), reach `radius`, full opening `arc`, facing `dir`   (fox bite)
  //   line              start (x,z), `len` long, `width` wide, facing `dir`            (bamboo smash, boss beam)
  // `sweep` (radians, signed) rotates a line from `dir` over the last `delay - lead` seconds; `lead` = static warning seconds first. Beams deal damage only after `lead`.
  | { k: "telegraph"; src: number; x: number; z: number; radius: number; delay: number;
      shape?: "circle" | "cone" | "line"; dir?: number; arc?: number; len?: number; width?: number; sweep?: number; lead?: number; beam?: boolean };

/** Shape of a telegraph for hit testing (shared so server damage and client prediction agree). */
export interface TelegraphGeom { shape?: "circle" | "cone" | "line"; x: number; z: number; radius: number; dir?: number; arc?: number; len?: number; width?: number }

/** True when the ground point (px,pz) lies inside the telegraph. `dir` overrides the stored facing (used for rotating beams). */
export function telegraphContains(t: TelegraphGeom, px: number, pz: number, dir: number = t.dir ?? 0): boolean {
  const dx = px - t.x, dz = pz - t.z;
  if (t.shape === "cone") {
    const d = Math.hypot(dx, dz);
    if (d > t.radius) return false;
    if (d < 1e-6) return true;
    let diff = (Math.atan2(dx, dz) - dir) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return Math.abs(diff) <= (t.arc ?? 1.4) / 2;
  }
  if (t.shape === "line") {
    const fx = Math.sin(dir), fz = Math.cos(dir), hw = (t.width ?? 2) / 2;
    const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
    return Math.abs(across) <= hw && along >= -hw && along <= (t.len ?? t.radius);
  }
  return Math.hypot(dx, dz) <= t.radius;
}

// ---------------------------------------------------------------------------------------------------------------
// 0.4.0 content types (additive). Everything the server sends about gear, side quests, merits and places.
export type GearSlot = "weapon" | "head" | "body" | "boots" | "charm" | "pendant";
export type Rarity = "common" | "fine" | "rare" | "epic";
/** Summed bonuses of the equipped gear: atk = flat attack, hp = flat max HP, crit = added crit chance (0.02 = +2 %), def = damage reduction (0.04 = -4 % damage taken). */
export interface GearStats { atk: number; hp: number; crit: number; def: number }
export interface ItemInfo {
  name: string;
  kind: "gear" | "consumable" | "material" | "quest";
  slot?: GearSlot; rarity?: Rarity; lv?: number; cls?: ClassId; stats?: Partial<GearStats>;
  text: string;    // flavour or use description
  sell?: number;   // coin the peddler pays (absent = cannot be sold)
}
export interface QuestObjView { text: string; have: number; need: number }
export interface SideQuestView {
  id: string; title: string; npc: string;
  st: "offer" | "active" | "ready" | "done";
  text: string;               // what the NPC says right now (offer / reminder / turn-in line)
  obj: QuestObjView[];
  rewards: string[];          // short reward strings, e.g. "320 XP", "Hound-Fang Charm"
}
export interface CraftView { id: string; out: string; qty: number; mats: Array<{ item: string; qty: number }>; coin: number; jade: number; lv: number }
export interface BuyView { item: string; price: number }
export interface SellView { item: string; price: number }
export interface AchView { id: string; name: string; desc: string; cat: string; pts: number; have: number; need: number; done: boolean; title?: string }
export interface PoiView { id: string; name: string; found: boolean; x?: number; z?: number }
