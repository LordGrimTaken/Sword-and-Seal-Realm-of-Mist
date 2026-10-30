// 0.4.0 content systems on top of the world: equipment and consumables, NPC side-quest chains, Artisan Tao's crafting, Peddler Hao's trade,
// places of interest, merit seals and titles. Server-authoritative: the client only asks (`equip`, `npc`, `craft`, ...) and renders what it is told
// (`items`, `gear`, `npcdlg`, `sq`, `prog`, `toast`). State lives in `p.cx` (loaded at login) and is written through to ContentDb on every change.
import type { AchView, BuyView, ClientMsg, CraftView, GearSlot, MobType, PoiView, QuestObjView, ServerMsg, SellView, SideQuestView } from "../../../shared/protocol.ts";
import {
  ACHIEVEMENTS, ACH_BY_ID, ALL_TITLES, CONSUMABLE_BY_NAME, GEAR, GEAR_BY_NAME, GEAR_SETS, GEAR_SET_OF, GEAR_SLOTS, INV, MOBS, NPCS, NPC_KEY_BY_NAME, NPC_SVC, POIS, POTION_CD, QUESTS, RECIPES, RECIPE_BY_ID,
  SHOP, SIDE_QUESTS, SIDE_QUEST_BY_ID, itemCatalogue, lanternTideAt, marketBuyMult, marketSellMult, maxHpFor, recipeOutput, sellPrice, type SideQuestDef,
} from "../data.ts";
import { ContentDb } from "../contentdb.ts";
import { ecoAddCoin, ecoAddJade, ecoSpendCoin, ecoSpendJade, ecoWalletOf, contentHooks } from "../economy.ts";
import { grantXp } from "./combat.ts";
import { sumGear } from "./gear.ts";
import { addItem, invQty, removeItem } from "./inventory.ts";
import type { ContentState, Mob, Player } from "./types.ts";
import type { World } from "./world.ts";
import { dist } from "./util.ts";

const MAX_ACTIVE_QUESTS = 8;
const str = (v: unknown, max = 64): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const send = (p: Player, m: ServerMsg) => p.send(JSON.stringify(m));
const ITEMS_JSON = JSON.stringify({ t: "items", items: itemCatalogue() } satisfies ServerMsg);

// ---------------------------------------------------------------- merit-seal counters (0.6.0)
/** Merit seals may only reference counters the server really produces. Some goals (bestiary coverage, all bosses,
 *  full gear sets) cannot be expressed with any pre-0.6.0 counter, so this module adds two kinds of support:
 *
 *  - DERIVED counters - computed in memory only by `recount()`, NEVER written to the ContentDb counter store and
 *    never incremented anywhere else; they are rebuilt from persisted state on every login, so no schema change is
 *    involved: `bestTypes` (number of `best:<mob>` entries > 0), `bosses` (number of `kill:<boss>` entries > 0),
 *    `set:<setId>` (worn pieces of a set, from the saved equipment map) and `setsDone` (complete sets worn).
 *  - `tideKills` - a NORMAL incrementing counter like `kill:<mob>` (bumped in `onKill` only while the deterministic
 *    Lantern Tide window is active, persisted by the usual `bump()` path, so it survives a relog).
 *
 *  Both kinds ride on the existing kill/equip paths in this file: no new gameplay hooks were added, and nothing is
 *  written outside the counters a relog can rebuild. `isAchievementCounter()` (exported) is the content test's
 *  registry so an `ACHIEVEMENTS` entry can never point at a counter the server cannot produce. */
const TALK_KEYS = ["elder", "mei", "fen", "wu", "tao", "hao"];
const BOSS_TYPES = (Object.keys(MOBS) as MobType[]).filter((type) => !!MOBS[type].boss);
/** Distinct slots a set spans = the most pieces of it one character can wear at once (a set is "complete" at that count). */
const SET_SLOT_COUNT = new Map(GEAR_SETS.map((s) => [s.id, new Set(GEAR.filter((g) => GEAR_SET_OF[g.name] === s.id).map((g) => g.slot)).size] as const));
/** Single-number counters that are not `prefix:name` shaped; every one is produced by the content/economy/quest systems. */
const PLAIN_COUNTERS = new Set(["kills", "lv", "poi", "chain", "quest", "craft", "equipped", "rare", "talked", "bestTypes", "bosses", "setsDone", "tideKills"]);

/** True when `key` is a counter the content/economy/quest systems actually produce. Exported for the data checks,
 *  so `ACHIEVEMENTS` entries can never reference a counter the server cannot produce. */
export function isAchievementCounter(key: string): boolean {
  if (PLAIN_COUNTERS.has(key)) return true;
  const mob = /^(?:kill|best):(.+)$/.exec(key);
  if (mob) return Object.prototype.hasOwnProperty.call(MOBS, mob[1]);
  const set = /^set:(.+)$/.exec(key);
  if (set) return GEAR_SETS.some((s) => s.id === set[1]);
  const talk = /^(?:talk|greet):(.+)$/.exec(key);
  return !!talk && TALK_KEYS.includes(talk[1]);
}

// ---------------------------------------------------------------- pure helpers (exported for tests)
/** Can the pack take all of `adds`? (new stacks need free slots, existing stacks need room under the stack cap) */
export function canHold(inv: ReadonlyMap<string, { qty: number }>, adds: Array<{ item: string; qty: number }>): boolean {
  const merged = new Map<string, number>();
  for (const a of adds) merged.set(a.item, (merged.get(a.item) ?? 0) + a.qty);
  let fresh = 0;
  for (const [item, qty] of merged) {
    const have = inv.get(item)?.qty ?? 0;
    if (!have) fresh++;
    if (have + qty > INV.maxStack) return false;
  }
  return inv.size + fresh <= INV.maxSlots;
}
export const maxHpOf = (p: Player) => maxHpFor(p.cls, p.lv) + p.gear.hp;

// ---------------------------------------------------------------- shop pricing (0.5.0 Market Day)
// The static SHOP table and `sellPrice()` stay the single source of truth (the content checks and the "no coin loop"
// invariants read them unchanged). Market Day only reshapes the price of a transaction at the moment it happens, with a
// whole-coin rounding and a floor of 1 coin, applied identically to the shop dialog quotes and the actual debit/payout.
/** What Peddler Hao charges for one item costing `base` at sim time `time` (25% off while the market is open). */
export const shopBuyPrice = (base: number, time: number) => Math.max(1, Math.round(base * marketBuyMult(time)));
/** What Peddler Hao pays for one item worth `base` at sim time `time` (50% more while the market is open). */
export const shopSellPrice = (base: number, time: number) => Math.max(1, Math.round(base * marketSellMult(time)));

export class Content {
  constructor(readonly db: ContentDb) {}

  // ---------------------------------------------------------------- login / persistence
  login(w: World, p: Player) {
    const n = p.n;
    const cx: ContentState = { equipped: new Map(), quests: new Map(), counters: new Map(), merits: new Set(), pois: new Set(), titles: new Set(), title: "", dirty: false };
    for (const r of this.db.loadEquipment(n)) {
      const d = GEAR_BY_NAME.get(r.item);
      if (d && d.slot === r.slot) cx.equipped.set(d.slot, r.item);
    }
    for (const r of this.db.loadQuests(n)) if (SIDE_QUEST_BY_ID.has(r.qid) && (r.state === 1 || r.state === 2)) cx.quests.set(r.qid, { st: r.state, p: [r.p0, r.p1, r.p2] });
    for (const r of this.db.loadCounters(n)) cx.counters.set(r.key, r.val);
    for (const r of this.db.loadMerits(n)) cx.merits.add(r.id);
    for (const id of this.db.loadPlaces(n)) if (POIS.some((x) => x.id === id)) cx.pois.add(id);
    for (const t of this.db.loadTitles(n)) cx.titles.add(t);
    const at = this.db.loadActiveTitle(n);
    if (at && cx.titles.has(at)) cx.title = at;
    p.cx = cx;
    p.gear = sumGear(cx.equipped);
    p.mhp = maxHpOf(p); p.hp = p.mhp;
    p.state.ttl = cx.title || undefined;
    if (p.quest.stage >= QUESTS.length) cx.counters.set("chain", 1);
    cx.counters.set("lv", Math.max(cx.counters.get("lv") ?? 0, p.lv));
    cx.counters.set("poi", cx.pois.size);
    this.recount(cx);
    p.send(ITEMS_JSON);
    this.sendGear(p); this.sendSq(p);
    this.evalAll(w, p, true);
    this.sendProg(p);
    this.sendBest(p);
  }

  private count(p: Player, key: string) { return p.cx?.counters.get(key) ?? 0; }
  private setCounter(p: Player, key: string, val: number) {
    const cx = p.cx!;
    if (cx.counters.get(key) === val) return false;
    cx.counters.set(key, val);
    try { this.db.setCounter(p.n, key, val); } catch { /* best effort */ }
    return true;
  }
  /** Derived counters. The first three are the original 0.4.0 behaviour, unchanged. The 0.6.0 additions are DERIVED
   *  (they exist only in the in-memory map; they are never written to the DB and are rebuilt here at login):
   *  `bestTypes`/`bosses` from the persisted `best:`/`kill:` counters, and `set:<setId>`/`setsDone` from the saved
   *  equipment map. Everything is recomputed from state that is already persisted, so nothing new is stored. */
  private recount(cx: ContentState) {
    cx.counters.set("equipped", cx.equipped.size);
    let rare = 0;
    for (const it of cx.equipped.values()) { const r = GEAR_BY_NAME.get(it)?.rarity; if (r === "rare" || r === "epic") rare++; }
    cx.counters.set("rare", rare);
    cx.counters.set("talked", TALK_KEYS.filter((k) => cx.counters.get(`talk:${k}`)).length);
    cx.counters.set("bestTypes", this.bestTypesOf(cx));
    cx.counters.set("bosses", this.bossesOf(cx));
    let setsDone = 0;
    for (const s of GEAR_SETS) {
      const worn = [...cx.equipped.values()].filter((it) => GEAR_SET_OF[it] === s.id).length;
      cx.counters.set(`set:${s.id}`, worn);
      if (worn > 0 && worn === (SET_SLOT_COUNT.get(s.id) ?? 0)) setsDone++;
    }
    cx.counters.set("setsDone", setsDone);
  }
  private bestTypesOf(cx: ContentState) { return (Object.keys(MOBS) as MobType[]).filter((t) => (cx.counters.get(`best:${t}`) ?? 0) > 0).length; }
  private bossesOf(cx: ContentState) { return BOSS_TYPES.filter((t) => (cx.counters.get(`kill:${t}`) ?? 0) > 0).length; }
  /** Refresh one DERIVED counter in the in-memory map (no DB write) and evaluate its seals when it changed. */
  private setDerived(w: World, p: Player, key: string, val: number) {
    const cx = p.cx!;
    if ((cx.counters.get(key) ?? 0) === val) return;
    cx.counters.set(key, val);
    this.evalKey(w, p, key);
  }
  /** Evaluate the gear-derived seals after an equipment change (`recount` has already refreshed set:<id>/setsDone). */
  private evalGearDerived(w: World, p: Player) {
    for (const s of GEAR_SETS) this.evalKey(w, p, `set:${s.id}`);
    this.evalKey(w, p, "setsDone");
  }
  private bump(w: World, p: Player, key: string, by = 1) {
    if (!p.cx) return;
    if (this.setCounter(p, key, this.count(p, key) + by)) this.evalKey(w, p, key);
  }

  // ---------------------------------------------------------------- merit seals and titles
  private evalKey(w: World, p: Player, key: string, quiet = false) {
    const cx = p.cx!;
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (a.counter !== key || cx.merits.has(a.id) || this.count(p, key) < a.need) continue;
      changed = true;
      this.earn(w, p, a.id, quiet);
    }
    if (changed) this.sendProg(p);
  }
  private evalAll(w: World, p: Player, quiet = false) {
    this.recount(p.cx!);
    for (const a of ACHIEVEMENTS) if (!p.cx!.merits.has(a.id) && this.count(p, a.counter) >= a.need) this.earn(w, p, a.id, quiet);
  }
  private earn(w: World, p: Player, id: string, quiet: boolean) {
    const a = ACH_BY_ID.get(id)!, cx = p.cx!;
    cx.merits.add(id);
    try { this.db.addMerit(p.n, id); } catch { /* best effort */ }
    if (!quiet) { w.sysTo(p, `Merit seal earned: ${a.name} (+${a.pts} points)`); this.toast(p, "ach", a.name, a.desc); }
    if (a.title) this.addTitle(w, p, a.title, quiet);
  }
  addTitle(w: World, p: Player, title: string, quiet = false) {
    const cx = p.cx!;
    if (cx.titles.has(title)) return;
    cx.titles.add(title);
    try { this.db.addTitle(p.n, title); } catch { /* best effort */ }
    if (!cx.title) this.setTitle(w, p, title);
    if (!quiet) { w.sysTo(p, `New title: ${title}. Choose your title in the journal (J).`); this.toast(p, "title", title, "New title unlocked"); }
  }
  setTitle(_w: World, p: Player, title: string) {
    const cx = p.cx!;
    if (title !== "" && !cx.titles.has(title)) return;
    cx.title = title;
    p.state.ttl = title || undefined;
    try { this.db.setActiveTitle(p.n, title); } catch { /* best effort */ }
    this.sendProg(p);
  }
  private toast(p: Player, kind: Extract<ServerMsg, { t: "toast" }>["kind"], title: string, text: string) { send(p, { t: "toast", kind, title, text }); }

  sendProg(p: Player) {
    const cx = p.cx;
    if (!cx) return;
    const ach: AchView[] = ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc, cat: a.cat, pts: a.pts, have: Math.min(a.need, this.count(p, a.counter)), need: a.need, done: cx.merits.has(a.id), title: a.title }));
    const pts = ACHIEVEMENTS.reduce((n, a) => n + (cx.merits.has(a.id) ? a.pts : 0), 0);
    const pois: PoiView[] = POIS.map((x) => (cx.pois.has(x.id) ? { id: x.id, name: x.name, found: true, x: x.x, z: x.z } : { id: x.id, name: x.name, found: false }));
    send(p, { t: "prog", ach, pts, title: cx.title || null, titles: ALL_TITLES.filter((t) => cx.titles.has(t)), pois });
  }

  /** 0.5.0 bestiary: every mob type with the player's persisted kill count (`best:<mobType>` counters). Counts are
   *  written through the generic ContentDb counter store, so they survive a relog with no schema change. */
  sendBest(p: Player) {
    const cx = p.cx;
    if (!cx) return;
    const mobs = (Object.keys(MOBS) as MobType[]).map((type) => ({ type, kills: cx.counters.get(`best:${type}`) ?? 0 }));
    send(p, { t: "best", mobs });
  }

  // ---------------------------------------------------------------- places of interest + periodic upkeep (every 0.5 s per player)
  tick(w: World, p: Player) {
    const cx = p.cx;
    if (!cx) return;
    for (const poi of POIS) {
      if (cx.pois.has(poi.id) || dist(p.x, p.z, poi.x, poi.z) > poi.r) continue;
      cx.pois.add(poi.id);
      try { this.db.addPlace(p.n, poi.id); } catch { /* best effort */ }
      this.setCounter(p, "poi", cx.pois.size);
      w.sysTo(p, `Discovered: ${poi.name} (+${poi.xp} XP). ${poi.lore}`);
      this.toast(p, "poi", poi.name, poi.lore);
      grantXp(w, p, poi.xp, "quest");
      this.evalKey(w, p, "poi", false);
      this.questTouched(w, p, `Discovered ${poi.name}`);
      this.sendProg(p);
    }
    if (this.setCounter(p, "lv", Math.max(this.count(p, "lv"), p.lv))) this.evalKey(w, p, "lv");
    if (cx.dirty) { cx.dirty = false; this.sendSq(p); }
  }

  // ---------------------------------------------------------------- gameplay hooks
  onKill(w: World, p: Player, m: Mob) {
    if (!p.cx) return;
    if (m.def.rare && this.announced.get(m) !== m.deadAt) { this.announced.set(m, m.deadAt); w.sysAll(`${m.def.name} has been defeated!`); }
    this.bump(w, p, "kills");
    this.bump(w, p, `kill:${m.def.type}`);
    // 0.5.0 bestiary: persisted per-type kill count; refresh the client whenever the entry changes.
    const best = `best:${m.def.type}`;
    if (this.setCounter(p, best, this.count(p, best) + 1)) this.sendBest(p);
    // 0.6.0 merit seals: `bestTypes`/`bosses` are DERIVED counters refreshed here from the counters just bumped
    // (in-memory only; rebuilt by recount() at login, so no DB write/row of their own). `tideKills` is a normal
    // persisted counter, bumped only while the deterministic Lantern Tide window is active.
    this.setDerived(w, p, "bestTypes", this.bestTypesOf(p.cx));
    this.setDerived(w, p, "bosses", this.bossesOf(p.cx));
    if (lanternTideAt(w.time).active) this.bump(w, p, "tideKills");
    this.advance(w, p, (o) => o.kind === "kill" && o.target === m.def.type, 1);
  }
  private announced = new WeakMap<Mob, number>();
  onLoot(w: World, p: Player, item: string) {
    if (!p.cx) return;
    p.cx.dirty = true;
    for (const [qid, rec] of p.cx.quests) {
      const q = SIDE_QUEST_BY_ID.get(qid)!;
      if (rec.st === 1 && q.obj.some((o) => o.kind === "collect" && o.item === item)) { this.progressLine(w, p, q); }
    }
  }
  onTalk(w: World, p: Player, npc: string) {
    if (!p.cx) return;
    if (!p.cx.counters.get(`talk:${npc}`)) { this.setCounter(p, `talk:${npc}`, 1); this.recount(p.cx); this.setCounter(p, "talked", p.cx.counters.get("talked") ?? 0); this.evalKey(w, p, "talked"); }
    this.advance(w, p, (o) => o.kind === "talk" && o.npc === npc, 1, true);
  }
  onChain(w: World, p: Player) { if (p.cx && this.setCounter(p, "chain", 1)) this.evalKey(w, p, "chain"); }

  // ---------------------------------------------------------------- equipment
  private applyStats(p: Player, before: number) {
    const cx = p.cx!;
    p.gear = sumGear(cx.equipped);
    const mhp = maxHpOf(p);
    const gained = mhp - before;
    p.mhp = mhp;
    p.hp = Math.max(1, Math.min(mhp, gained > 0 && p.st !== "dead" ? p.hp + gained : p.hp)); // new max HP arrives filled; losing max HP only clamps
  }
  sendGear(p: Player) {
    const cx = p.cx;
    if (!cx) return;
    const slots: Record<string, string | null> = {};
    for (const s of GEAR_SLOTS) slots[s] = cx.equipped.get(s) ?? null;
    send(p, { t: "gear", slots, stats: p.gear });
  }
  equip(w: World, p: Player, item: unknown) {
    const cx = p.cx;
    if (!cx || !str(item)) return;
    if (p.st === "dead") return w.sysTo(p, "You cannot change gear while defeated.");
    const d = GEAR_BY_NAME.get(item);
    if (!d) return w.sysTo(p, "That cannot be equipped.");
    if (invQty(p, item) < 1) return w.sysTo(p, `You do not have ${item}.`);
    if (p.lv < d.lv) return w.sysTo(p, `${item} needs level ${d.lv}.`);
    if (d.cls && d.cls !== p.cls) return w.sysTo(p, `${item} can only be used by a ${d.cls === "sword" ? "Sword Cultivator" : d.cls === "talisman" ? "Talisman Master" : "Physician"}.`);
    const old = cx.equipped.get(d.slot);
    const before = maxHpOf(p);
    removeItem(w, p, item, 1);
    if (old) {
      if (addItem(w, p, old, "", 1) < 1) { addItem(w, p, item, "", 1); return w.sysTo(p, "Your pack is full; make room first."); }
    }
    cx.equipped.set(d.slot, item);
    try { this.db.setEquipment(p.n, d.slot, item); } catch { /* best effort */ }
    this.applyStats(p, before);
    this.recount(cx);
    this.sendGear(p);
    w.sysTo(p, `Equipped ${item}.`);
    this.setCounter(p, "equipped", cx.counters.get("equipped") ?? 0); this.setCounter(p, "rare", cx.counters.get("rare") ?? 0);
    this.evalKey(w, p, "equipped"); this.evalKey(w, p, "rare");
    this.evalGearDerived(w, p); // 0.6.0: worn-set counters + complete-set seals (derived, no DB write)
  }
  unequip(w: World, p: Player, slot: unknown) {
    const cx = p.cx;
    if (!cx || !str(slot)) return;
    if (p.st === "dead") return;
    const s = slot as GearSlot;
    const item = GEAR_SLOTS.includes(s) ? cx.equipped.get(s) : undefined;
    if (!item) return;
    const before = maxHpOf(p);
    if (addItem(w, p, item, "", 1) < 1) return w.sysTo(p, "Your pack is full; make room first.");
    cx.equipped.delete(s);
    try { this.db.setEquipment(p.n, s, null); } catch { /* best effort */ }
    this.applyStats(p, before);
    this.recount(cx);
    this.setCounter(p, "equipped", cx.counters.get("equipped") ?? 0); this.setCounter(p, "rare", cx.counters.get("rare") ?? 0);
    this.sendGear(p);
    w.sysTo(p, `Removed ${item}.`);
  }
  use(w: World, p: Player, item: unknown) {
    if (!str(item)) return;
    const c = CONSUMABLE_BY_NAME.get(item);
    if (!c) return w.sysTo(p, "That cannot be used.");
    if (p.st === "dead") return w.sysTo(p, "You cannot use items while defeated.");
    if (invQty(p, item) < 1) return w.sysTo(p, `You do not have ${item}.`);
    if (w.time < p.potionReady) return w.sysTo(p, `Potions are on cooldown (${Math.ceil(p.potionReady - w.time)} s).`);
    const poisoned = p.poisonUntil > 0;
    const wantHeal = c.healPct > 0 && (p.hp < p.mhp || (c.cure && poisoned));
    const wantQi = !!c.qiRestore && p.qi < p.mqi;
    if (!wantHeal && !wantQi) return w.sysTo(p, c.qiRestore ? "Your Qi is already full." : "You are already at full health.");
    removeItem(w, p, item, 1);
    p.potionReady = w.time + POTION_CD;
    if (c.cure && poisoned) { p.poisonUntil = 0; w.sysTo(p, "The poison is gone."); }
    if (c.healPct > 0) {
      const real = Math.min(Math.round(p.mhp * c.healPct), p.mhp - p.hp);
      if (real > 0) { p.hp += real; w.emitNear(p.x, p.z, { k: "heal", src: p.id, dst: p.id, amount: real }); }
    }
    if (c.qiRestore) { p.qi = Math.min(p.mqi, p.qi + c.qiRestore); }
    w.sysTo(p, `You used ${item}.`);
  }

  // ---------------------------------------------------------------- side quests
  private svcNpc(key: string) { return NPC_SVC.find((n) => n.key === key); }
  private near(p: Player, key: string): boolean {
    const s = this.svcNpc(key), n = s && NPCS.find((x) => x.name === s.name);
    return !!s && !!n && dist(p.x, p.z, n.x, n.z) <= s.range + 2;
  }
  private available(p: Player, q: SideQuestDef) {
    const cx = p.cx!;
    return p.lv >= q.minLv && (q.requires ?? []).every((r) => cx.quests.get(r)?.st === 2);
  }
  private objViews(p: Player, q: SideQuestDef, rec?: { p: [number, number, number] }): QuestObjView[] {
    const cx = p.cx!;
    return q.obj.map((o, i) => {
      if (o.kind === "kill") return { text: o.text, have: Math.min(o.count, rec?.p[i] ?? 0), need: o.count };
      if (o.kind === "collect") return { text: o.item, have: Math.min(o.count, invQty(p, o.item)), need: o.count };
      if (o.kind === "poi") return { text: o.text, have: Math.min(o.count, cx.pois.size), need: o.count };
      return { text: o.text, have: Math.min(1, rec?.p[i] ?? 0), need: 1 };
    });
  }
  private objDone(p: Player, q: SideQuestDef, rec: { p: [number, number, number] }) { return this.objViews(p, q, rec).every((o) => o.have >= o.need); }
  private rewardStrings(p: Player, q: SideQuestDef): string[] {
    const r = [`${q.rewardXp} XP`];
    if (q.rewardCoin) r.push(`${q.rewardCoin} coin`);
    if (q.rewardJade) r.push(`${q.rewardJade} jade`);
    for (const it of q.rewardItems ?? []) r.push(it.qty > 1 ? `${it.item} x${it.qty}` : it.item);
    if (q.rewardByClass?.[p.cls]) r.push(q.rewardByClass[p.cls]!);
    if (q.rewardTitle) r.push(`Title: ${q.rewardTitle}`);
    return r;
  }
  private qView(p: Player, q: SideQuestDef): SideQuestView | null {
    const rec = p.cx!.quests.get(q.id);
    const base = { id: q.id, title: q.title, npc: q.npc, rewards: this.rewardStrings(p, q) };
    if (!rec) return this.available(p, q) ? { ...base, st: "offer", text: q.intro, obj: this.objViews(p, q) } : null;
    if (rec.st === 2) return { ...base, st: "done", text: "", obj: [] };
    const ready = this.objDone(p, q, rec);
    return { ...base, st: ready ? "ready" : "active", text: ready ? q.done : q.reminder, obj: this.objViews(p, q, rec) };
  }
  sendSq(p: Player) {
    if (!p.cx) return;
    const quests: SideQuestView[] = [];
    for (const q of SIDE_QUESTS) { if (!p.cx.quests.has(q.id)) continue; const v = this.qView(p, q); if (v) quests.push(v); }
    send(p, { t: "sq", quests });
  }
  private saveQuest(p: Player, qid: string) {
    const rec = p.cx!.quests.get(qid)!;
    try { this.db.saveQuest(p.n, { qid, state: rec.st, p0: rec.p[0], p1: rec.p[1], p2: rec.p[2] }); } catch { /* best effort */ }
  }
  private progressLine(w: World, p: Player, q: SideQuestDef) {
    const rec = p.cx!.quests.get(q.id)!;
    if (this.objDone(p, q, rec)) w.sysTo(p, `Side quest ready: ${q.title}. Return to ${this.svcNpc(q.npc)!.name}.`);
    else { const o = this.objViews(p, q, rec).find((x) => x.have < x.need); if (o) w.sysTo(p, `Side quest: ${q.title} - ${o.text} ${o.have}/${o.need}`); }
    this.sendSq(p);
  }
  private questTouched(w: World, p: Player, _why: string) {
    for (const [qid, rec] of p.cx!.quests) { const q = SIDE_QUEST_BY_ID.get(qid)!; if (rec.st === 1 && q.obj.some((o) => o.kind === "poi")) this.progressLine(w, p, q); }
  }
  /** Advance matching counted objectives of every active quest. */
  private advance(w: World, p: Player, match: (o: SideQuestDef["obj"][number]) => boolean, by: number, once = false) {
    const cx = p.cx!;
    for (const [qid, rec] of cx.quests) {
      if (rec.st !== 1) continue;
      const q = SIDE_QUEST_BY_ID.get(qid)!;
      let hit = false;
      q.obj.forEach((o, i) => {
        if (!match(o)) return;
        const need = o.kind === "kill" ? o.count : 1;
        if (rec.p[i] >= need) return;
        rec.p[i] = once ? 1 : Math.min(need, rec.p[i] + by);
        hit = true;
      });
      if (hit) { this.saveQuest(p, qid); this.progressLine(w, p, q); }
    }
  }
  /** Client `npc`: talk (opens the dialog and counts as speaking), accept, turnin. */
  npc(w: World, p: Player, msg: Extract<ClientMsg, { t: "npc" }>) {
    if (!p.cx || !str(msg.npc, 16)) return;
    const svc = this.svcNpc(msg.npc);
    if (!svc) return;
    if (p.st === "dead") return w.sysTo(p, "You cannot speak while defeated.");
    if (!this.near(p, svc.key)) return w.sysTo(p, `${svc.name} is too far away.`);
    if (msg.a === "talk") { this.onTalk(w, p, svc.key); return this.sendDialog(w, p, svc.key, true); }
    const q = str(msg.q, 32) ? SIDE_QUEST_BY_ID.get(msg.q) : undefined;
    if (!q || q.npc !== svc.key) return;
    if (msg.a === "accept") this.accept(w, p, q);
    else if (msg.a === "turnin") this.turnIn(w, p, q);
    this.sendDialog(w, p, svc.key, false);
  }
  private accept(w: World, p: Player, q: SideQuestDef) {
    const cx = p.cx!;
    if (cx.quests.has(q.id)) return;
    if (!this.available(p, q)) return w.sysTo(p, "That task is not available to you yet.");
    let active = 0; for (const r of cx.quests.values()) if (r.st === 1) active++;
    if (active >= MAX_ACTIVE_QUESTS) return w.sysTo(p, "Your journal is full; finish a task first.");
    cx.quests.set(q.id, { st: 1, p: [0, 0, 0] });
    this.saveQuest(p, q.id);
    w.sysTo(p, `Side quest accepted: ${q.title}`);
    this.toast(p, "quest", q.title, "Side quest accepted");
    this.sendSq(p);
    if (this.objDone(p, q, cx.quests.get(q.id)!)) this.progressLine(w, p, q);
  }
  private turnIn(w: World, p: Player, q: SideQuestDef) {
    const cx = p.cx!, rec = cx.quests.get(q.id);
    if (!rec || rec.st !== 1) return;
    if (!this.objDone(p, q, rec)) return w.sysTo(p, "That task is not finished yet.");
    const rewards: Array<{ item: string; qty: number }> = [...(q.rewardItems ?? [])];
    const byClass = q.rewardByClass?.[p.cls];
    if (byClass) rewards.push({ item: byClass, qty: 1 });
    // pack space is checked as if the consumed items were already gone
    const probe = new Map(p.inv);
    for (const o of q.obj) if (o.kind === "collect" && o.consume) { const s = probe.get(o.item); if (s) { if (s.qty <= o.count) probe.delete(o.item); else probe.set(o.item, { ...s, qty: s.qty - o.count }); } }
    if (!canHold(probe, rewards)) return w.sysTo(p, "Your pack is too full for the rewards; make room first.");
    for (const o of q.obj) if (o.kind === "collect" && o.consume) removeItem(w, p, o.item, o.count);
    rec.st = 2; this.saveQuest(p, q.id);
    for (const r of rewards) { const n = addItem(w, p, r.item, "", r.qty); if (n > 0) w.emitTo(p, { k: "loot", item: r.item, itemZh: "", qty: n }); }
    if (q.rewardCoin) ecoAddCoin(w, p, q.rewardCoin);
    if (q.rewardJade) ecoAddJade(w, p, q.rewardJade);
    w.sysTo(p, `Side quest complete: ${q.title} (+${q.rewardXp} XP)`);
    this.toast(p, "quest", q.title, "Side quest complete");
    if (q.rewardTitle) this.addTitle(w, p, q.rewardTitle);
    let done = 0; for (const r of cx.quests.values()) if (r.st === 2) done++;
    this.setCounter(p, "quest", done);
    grantXp(w, p, q.rewardXp, "quest");
    this.evalKey(w, p, "quest");
    this.sendSq(p); this.sendProg(p);
  }

  // ---------------------------------------------------------------- dialog, crafting, trade
  private craftViews(p: Player): CraftView[] {
    return RECIPES.map((r) => ({ id: r.id, out: recipeOutput(r, p.cls), qty: r.qty, mats: r.mats, coin: r.coin, jade: r.jade, lv: r.lv }));
  }
  private sellViews(w: World, p: Player): SellView[] {
    const out: SellView[] = [];
    for (const it of p.inv.values()) {
      const base = sellPrice(it.item);
      const price = base > 0 ? shopSellPrice(base, w.time) : 0;
      if (price > 0) out.push({ item: it.item, price });
    }
    return out;
  }
  sendDialog(w: World, p: Player, key: string, fresh: boolean) {
    const svc = this.svcNpc(key);
    if (!svc || !p.cx) return;
    const quests: SideQuestView[] = [];
    for (const q of SIDE_QUESTS) if (q.npc === key) { const v = this.qView(p, q); if (v) quests.push(v); }
    const n = this.count(p, `greet:${key}`);
    if (fresh) this.setCounter(p, `greet:${key}`, n + 1);
    const lines = fresh ? [svc.greet[n % svc.greet.length]] : [];
    const msg: Extract<ServerMsg, { t: "npcdlg" }> = { t: "npcdlg", npc: key, name: svc.name, role: svc.role, lines, quests };
    if (key === "tao") msg.craft = this.craftViews(p);
    if (key === "hao") { msg.buy = SHOP.map((s): BuyView => ({ item: s.item, price: shopBuyPrice(s.price, w.time) })); msg.sell = this.sellViews(w, p); }
    send(p, msg);
  }
  craft(w: World, p: Player, id: unknown) {
    if (!p.cx || !str(id, 32)) return;
    const r = RECIPE_BY_ID.get(id);
    if (!r) return;
    if (p.st === "dead") return;
    if (!this.near(p, "tao")) return w.sysTo(p, "Artisan Tao is too far away.");
    if (p.lv < r.lv) return w.sysTo(p, `That recipe needs level ${r.lv}.`);
    for (const m of r.mats) if (invQty(p, m.item) < m.qty) return w.sysTo(p, `You need ${m.qty} ${m.item}.`);
    const wal = ecoWalletOf(w, p);
    if (wal.coin < r.coin) return w.sysTo(p, `You need ${r.coin} coin.`);
    if (wal.jade < r.jade) return w.sysTo(p, `You need ${r.jade} jade.`);
    const out = recipeOutput(r, p.cls);
    const probe = new Map(p.inv);
    for (const m of r.mats) { const s = probe.get(m.item)!; if (s.qty <= m.qty) probe.delete(m.item); else probe.set(m.item, { ...s, qty: s.qty - m.qty }); }
    if (!canHold(probe, [{ item: out, qty: r.qty }])) return w.sysTo(p, "Your pack is full; make room first.");
    if (!ecoSpendCoin(w, p, r.coin)) return w.sysTo(p, `You need ${r.coin} coin.`);
    if (r.jade > 0 && !ecoSpendJade(w, p, r.jade)) { ecoAddCoin(w, p, r.coin); return w.sysTo(p, `You need ${r.jade} jade.`); }
    for (const m of r.mats) removeItem(w, p, m.item, m.qty);
    const n = addItem(w, p, out, "", r.qty);
    if (n > 0) w.emitTo(p, { k: "loot", item: out, itemZh: "", qty: n });
    w.sysTo(p, `Artisan Tao made ${r.qty > 1 ? `${r.qty} x ` : ""}${out}.`);
    this.bump(w, p, "craft");
    this.sendDialog(w, p, "tao", false);
    this.sendSq(p);
  }
  buy(w: World, p: Player, item: unknown, qty: unknown) {
    if (!p.cx || !str(item)) return;
    const s = SHOP.find((x) => x.item === item);
    if (!s || p.st === "dead") return;
    if (!this.near(p, "hao")) return w.sysTo(p, "Peddler Hao is too far away.");
    const n = typeof qty === "number" && Number.isInteger(qty) ? Math.max(1, Math.min(20, qty)) : 1;
    if (!canHold(p.inv, [{ item, qty: n }])) return w.sysTo(p, "Your pack is full; make room first.");
    const unit = shopBuyPrice(s.price, w.time); // 0.5.0 Market Day: only the transaction price shifts, SHOP itself is untouched
    const cost = unit * n;
    if (!ecoSpendCoin(w, p, cost)) return w.sysTo(p, `You need ${cost} coin.`);
    addItem(w, p, item, "", n);
    w.sysTo(p, `Bought ${n > 1 ? `${n} x ` : ""}${item} for ${cost} coin.`);
    this.sendDialog(w, p, "hao", false);
  }
  sell(w: World, p: Player, item: unknown, qty: unknown) {
    if (!p.cx || !str(item)) return;
    const base = sellPrice(item);
    if (base <= 0 || p.st === "dead") return w.sysTo(p, "Peddler Hao will not buy that.");
    if (!this.near(p, "hao")) return w.sysTo(p, "Peddler Hao is too far away.");
    const have = invQty(p, item);
    const n = typeof qty === "number" && Number.isInteger(qty) ? Math.max(1, Math.min(99, qty)) : 1;
    if (have < 1) return;
    const k = Math.min(n, have);
    const unit = shopSellPrice(base, w.time); // 0.5.0 Market Day: the vendor pays more only while the market is open
    const payout = unit * k;
    removeItem(w, p, item, k);
    ecoAddCoin(w, p, payout);
    w.sysTo(p, `Sold ${k > 1 ? `${k} x ` : ""}${item} for ${payout} coin.`);
    this.sendDialog(w, p, "hao", false);
    this.sendSq(p);
  }

  /** Dispatcher for the client messages of this module. */
  handle(w: World, p: Player, msg: ClientMsg) {
    try {
      switch (msg.t) {
        case "equip": return this.equip(w, p, msg.item);
        case "unequip": return this.unequip(w, p, msg.slot);
        case "use": return this.use(w, p, msg.item);
        case "npc": return this.npc(w, p, msg);
        case "craft": return this.craft(w, p, msg.id);
        case "buy": return this.buy(w, p, msg.item, msg.qty);
        case "sell": return this.sell(w, p, msg.item, msg.qty);
        case "title": return this.setTitle(w, p, typeof msg.id === "string" ? msg.id.slice(0, 40) : "");
      }
    } catch (e) { console.log(new Date().toISOString(), "content error", e); }
  }
}

// ---------------------------------------------------------------- module singleton (no-ops until initContent ran, like the economy)
let current: Content | undefined;
export function initContent(dbPath: string): Content {
  current = new Content(new ContentDb(dbPath));
  contentHooks.kill = (w, p, m) => current?.onKill(w, p, m);
  contentHooks.loot = (w, p, item) => current?.onLoot(w, p, item);
  contentHooks.talk = (w, p, npc) => current?.onTalk(w, p, npc);
  contentHooks.chain = (w, p) => current?.onChain(w, p);
  return current;
}
export const content = () => current;
export const contentLogin = (w: World, p: Player) => current?.login(w, p);
export const contentTick = (w: World, p: Player) => current?.tick(w, p);
export const contentHandle = (w: World, p: Player, m: ClientMsg) => current?.handle(w, p, m);
export const NPC_KEYS = NPC_KEY_BY_NAME;
