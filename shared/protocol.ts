// JIUZHOU — shared network contract. Server and client BOTH import this file.
// Owner: coordinator. Server/client agents must NOT edit it; request changes instead.
// Transport: WebSocket, JSON text frames (swap for binary later). Server is authoritative.

export const PROTOCOL_VERSION = 3;
export const TICK_RATE = 20;          // server simulation ticks per second
export const SNAPSHOT_RATE = 10;      // snapshots sent per second (every 2nd tick)
export const WORLD_SIZE = 200;        // zone is a square, x/z in [-100, 100]
export const PLAYER_SPEED = 6;        // world units / second
export const INTEREST_RADIUS = 60;    // only entities within this radius are sent

export type ClassId = "sword" | "talisman" | "physician" | "blade";
// sword      Sword Cultivator — melee, high damage, short range
// talisman   Talisman Master  — ranged, elemental talisman bolts, AoE
// physician  Physician        — support, heals self/allies, weak damage
// blade      Blade Dancer     — fast crit melee skirmisher, whirlwind bursts

// ---------- Cultivation realms (0.5.0) ----------
/** A named cultivation stage gated by level. `hpBonus` is the flat max-HP bonus a character has once the realm is
 *  reached (0 for the starting realm), so crossing a boundary is a "breakthrough" worth announcing. */
export interface RealmDef { name: string; minLv: number; hpBonus: number }
export const REALMS: RealmDef[] = [
  { name: "Qi Condensation", minLv: 1, hpBonus: 0 },
  { name: "Foundation Establishment", minLv: 5, hpBonus: 20 },
  { name: "Core Formation", minLv: 10, hpBonus: 40 },
  { name: "Nascent Soul", minLv: 15, hpBonus: 60 },
  { name: "Spirit Severing", minLv: 20, hpBonus: 80 },
];
/** The realm a character of `lv` belongs to. Clamped: below the first realm gives the first, above the last the last. */
export function realmForLevel(lv: number): RealmDef {
  let realm = REALMS[0];
  for (const r of REALMS) if (lv >= r.minLv) realm = r;
  return realm;
}

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
  burning?: boolean; // 0.4.0 additive: mob is taking burn damage over time (Fire Talisman); the client shows a flame cue while true
  ttl?: string;     // 0.4.0 additive: active title of a player (shown under the nameplate)
  mounted?: boolean; // 0.5.0 additive: players only - riding the spirit-sword mount (client draws the jian + trail and raises the avatar)
  // 0.5.0 additive: veil bosses (the Hollow Bride) only - true while she is in the VEILED phase (immune, lashing from behind
  // the veil). Readability/status flag for the client model + tint only: the immunity itself is enforced server-side in the
  // boss state machine and is NEVER inferred from this field. Absent (undefined) for every other mob.
  veiled?: boolean;
}

/** One party member as the party panel needs them: identity, class, level and the live HP bar (hp/mhp rounded). */
export interface PartyMemberView { name: string; cls: ClassId; lv: number; hp: number; mhp: number }

/** One treasure cache as the client needs it: stable numeric id, fixed world position and whether it can be opened now. */
export interface ChestStateView { id: number; x: number; z: number; ready: boolean }

/** One item offered in a trade. `name` + `qty` is the authoritative reference; `slot` is the current bag index for display only. */
export interface TradeItemView { slot: number; name: string; qty: number; zh?: string }
/** One side of a trade as that side's player sees it: the offered items, the coin offer and that side's ready flag. */
export interface TradeSideView { items: TradeItemView[]; coin: number; ready: boolean }
/** Full trade state for one player: the peer's name, their own side and the peer's side. Both sides get the symmetric view. */
export interface TradeStateView { peer: string; mine: TradeSideView; theirs: TradeSideView }

/** 0.5.0 P3 "The Hollow Trial": the random modifiers a run was rolled with. Ids are stable strings so HUD chips can style them. */
export type TrialModifierId = "swift" | "armoured" | "frenzied" | "sparse";
/** The public trial state sent to every player (login sync + every change). `active` false means "at rest"; `cooldown` counts down. */
export interface TrialStateView {
  active: boolean;
  wave: number;            // 1-based current wave while active, 0 when idle
  waves: number;           // total waves per run (5)
  modifiers: TrialModifierId[];
  mobsLeft: number;        // hostiles still standing in the current wave
  participants: string[];  // display names of the players credited in this run
  endsIn: number;          // whole seconds left on the run timer (0 when idle)
  cooldown: number;        // whole seconds until a new run may start (0 = ready)
  gate: { x: number; z: number };
  startRange: number;      // how close a player must stand to start a run
  result?: "clear" | "fail"; // set on the state broadcast that ends a run
  resultText?: string;       // short human line for the clear/fail toast
}

export type MobType = "bamboo_spirit" | "fox_spirit" | "stone_guardian" | "jade_serpent" // jade_serpent: pond/bridge mob
  | "lotus_toad" | "stone_hound" | "old_whisker" | "ink_wisp" | "mist_warden" | "thorn_sprite" // 0.4.0 content: passive spitting toad, pack-hunting hound, named rare fox; ink_wisp: floating spirit; mist_warden: second boss; thorn_sprite: passive thorn-spitting sprite
  | "hollow_hierophant" // 0.5.0 content: third boss, a hollow summoner that calls Thorn Sprites out of the reeds
  | "hollow_bride"; // 0.5.0 content: fourth boss, a ceremonial wraith that alternates VEILED (immune) and REVEALED (vulnerable)

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
  | { t: "title"; id: string }
  // 0.5.0 additive (still v3): toggle the spirit-sword mount (flying jian). The server validates the state (not dead), flips
  // `Player.mounted`, applies the mount speed multiplier to authoritative movement and echoes the flag in EntityState.mounted.
  | { t: "mount" }
  // 0.5.0 additive (still v3), session-only party (up to PARTY_MAX players): invite by name, then accept/decline/leave.
  // The same actions are also reachable through the chat commands /invite <name>, /accept, /decline and /leave.
  | { t: "party"; a: "invite" | "accept" | "decline" | "leave"; name?: string }
  // 0.5.0 additive (still v3), treasure caches: open the cache with this id. The server validates range/readiness and answers
  // with an updated `chests` state plus the normal loot/coin/system path.
  | { t: "openchest"; id: number }
  // 0.5.0 additive (still v3), player-to-player trading. request/accept/decline drive the session; offer changes the caller's
  // side only (slot = index into the caller's current bag list, qty = units of that stack, coin = coins offered; qty 0 rejects
  // or removes the named item offer); ready toggles the caller's confirmation. Every field is validated server-side and an
  // offer is only a REFERENCE — nothing leaves a bag until both sides confirm. /trade <name>, /trade accept|decline|cancel also work.
  | { t: "trade"; a: "request" | "accept" | "decline" | "offer" | "ready" | "cancel"; name?: string; slot?: number; qty?: number; coin?: number }
  // 0.5.0 P3 additive (still v3): "The Hollow Trial" wave challenge at its gate. start asks for a run (the server validates
  // range, cooldown and that no run is live); leave drops out of the current run. The state is pushed on login + every change.
  | { t: "trial"; a: "start" | "leave" };

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
  | { t: "toast"; kind: "poi" | "ach" | "title" | "item" | "quest"; title: string; text: string }
  // 0.5.0 bestiary / codex (additive, still v3): the player's persisted kill count for every mob type, in data order.
  // 0 means never slain (the client shows the entry as undiscovered). Sent after login and again whenever a count changes.
  | { t: "best"; mobs: Array<{ type: MobType; kills: number }> }
  // 0.5.0 world event, additive (still v3): the Mist Surge window. Sent to a player on every state change (start/end) and once
  // after login (with the remaining time). active = a surge is running now; endsIn = whole seconds left (0 when inactive).
  | { t: "surge"; active: boolean; endsIn: number }
  // 0.5.0 world event #2, additive (still v3): the Lantern Tide window (same semantics/shape as `surge`, different event).
  // Sent on every state change (start/end) and once after login; endsIn = whole seconds left in the active tide (0 when inactive).
  | { t: "tide"; active: boolean; endsIn: number }
  // 0.5.0 world event #3, additive (still v3): the Market Day window (same semantics/shape as `surge`/`tide`). While it is
  // active, Peddler Hao's shop transactions use shifted transaction prices (he buys for more, sells for less) but the SHOP
  // data itself is unchanged. Sent on every state change (start/end) and once after login; endsIn = whole seconds left.
  | { t: "market"; active: boolean; endsIn: number }
  // 0.5.0 party, additive (still v3): the current group state, sent to every member on any change and once after login.
  // members = null means the player is solo. `leader` is the leader's display name; `inviteFrom` is present only while a
  // solo player has a pending invitation (so the panel can show the accept/decline prompt). Session-only, never persisted.
  | { t: "party"; members: PartyMemberView[] | null; leader?: string; inviteFrom?: string }
  // 0.5.0 treasure caches, additive (still v3): every fixed cache with its session state, sent after login and whenever one
  // opens or respawns. Small and fixed (6 entries), so it stays out of the entity/snapshot/interest path entirely.
  | { t: "chests"; chests: ChestStateView[] }
  // 0.5.0 player trading, additive (still v3): the full two-sided trade state, sent to BOTH traders on every change and once
  // after login (state null = not trading). `invitedBy` is present only for the player a waiting request is addressed to, so
  // the client can show the accept/decline prompt. Session-only; items stay in the bags until the atomic swap.
  | { t: "trade"; state: TradeStateView | null; invitedBy?: string }
  // 0.5.0 P3 "The Hollow Trial", additive (still v3): the run state at the trial gate, sent to every player once after login and
  // on every change (start, wave advance, clear/fail, cooldown tick boundaries). `active` false + `cooldown` is the resting state.
  | { t: "trial"; state: TrialStateView };

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
  slot?: GearSlot; rarity?: Rarity; lv?: number; cls?: ClassId; stats?: Partial<GearStats>; set?: string;
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
