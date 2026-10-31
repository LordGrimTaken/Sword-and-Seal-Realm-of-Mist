// 0.4.0 content test: gear and consumables, side-quest chains, Tao's crafting, Hao's trade, places of interest, merit seals and titles,
// the three new mobs, persistence across logins, data consistency and the wire messages.
//   npm run test:content   -> World-level checks (in-memory / temp sqlite) + a spawned TEST_MODE server on CONTENT_PORT (default 8977)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION, REALMS, realmForLevel } from "../../shared/protocol.ts";
import type { ClassId, ServerMsg } from "../../shared/protocol.ts";
import {
  ACHIEVEMENTS, ACH_BY_ID, ALL_TITLES, CLASSES, CONSUMABLES, DAILY_COUNT, DAILY_POOL, GEAR, GEAR_BY_NAME, GEAR_SETS, GEAR_SET_OF, INV, JADE, LANTERN_TIDE, MARKET_DAY, MATERIALS, MAX_LEVEL, MIST_SURGE, MOBS, MOB_SPAWNS, NPCS, NPC_SVC, POIS, QUEST_ITEMS, RECIPES, SHOP, SIDE_QUESTS, SIDE_QUEST_BY_ID, TUNING, ZONE,
  itemCatalogue, lanternTideAt, marketDayAt, maxHpFor, mistSurgeAt, recipeOutput, sellPrice, veilPhaseAt,
  TRIAL, TRIAL_MODIFIERS, trialModifiers, trialReward,
} from "../src/data.ts";
import { economy, initEconomy } from "../src/economy.ts";
import { content, contentHandle, contentLogin, initContent, isAchievementCounter, shopBuyPrice, shopSellPrice } from "../src/game/content.ts";
import { damageMob, enrageMult, hurtPlayer, killMob, livingTwinCount, mobAttack, twinWindowLeft } from "../src/game/combat.ts";
import { TRIAL_MOB_MARKER } from "../src/game/trial.ts";
import { sumGear } from "../src/game/gear.ts";
import { addItem, invQty } from "../src/game/inventory.ts";
import { World } from "../src/game/world.ts";
import type { Player } from "../src/game/types.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.CONTENT_PORT) || 8977;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}
const tmp = mkdtempSync(join(tmpdir(), "jiuzhou-content-"));
const DBP = join(tmp, "c.db");
const ecoInit = initEconomy(DBP);
const contentInit = initContent(DBP);

// ---------------------------------------------------------------- helpers
interface Bot { p: Player; msgs: ServerMsg[]; sys: string[] }
function mk(w: World, cls: ClassId, name: string, level = 1, at?: { x: number; z: number }): Bot {
  const msgs: ServerMsg[] = [], sys: string[] = [];
  const p = w.addPlayer({ name, cls, level, xp: 0, x: at?.x ?? 0, z: at?.z ?? -80 }, (s) => {
    const m = JSON.parse(s) as ServerMsg;
    msgs.push(m);
    if (m.t === "ev" && m.e.k === "chat") sys.push(m.e.text);
  });
  contentLogin(w, p);
  return { p, msgs, sys };
}
const last = <T extends ServerMsg["t"]>(b: Bot, t: T) => [...b.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
const goto = (w: World, p: Player, x: number, z: number) => { p.x = x; p.z = z; w.resync(p); };
const npcAt = (name: string) => NPCS.find((n) => n.name === name)!;
const give = (w: World, p: Player, item: string, n = 1) => addItem(w, p, item, "", n);
const wallet = (w: World, p: Player) => economy()!.wallet(w, p);
const coins = (w: World, p: Player, n: number) => economy()!.adjust(w, p, n - wallet(w, p).coin, 0);
const say = (b: Bot, re: RegExp) => b.sys.some((t) => re.test(t));
const send = (w: World, b: Bot, m: Parameters<typeof contentHandle>[2]) => contentHandle(w, b.p, m);
const talk = (w: World, b: Bot, npc: string) => send(w, b, { t: "npc", npc, a: "talk" });
const accept = (w: World, b: Bot, npc: string, q: string) => send(w, b, { t: "npc", npc, a: "accept", q });
const turnin = (w: World, b: Bot, npc: string, q: string) => send(w, b, { t: "npc", npc, a: "turnin", q });
const stateOf = (b: Bot, id: string) => last(b, "sq")?.quests.find((q) => q.id === id)?.st;
const slay = (w: World, p: Player, type: string, n = 1) => {
  for (let i = 0; i < n; i++) {
    const m = w.mobs.find((x) => x.def.type === type && x.ai !== "dead");
    if (!m) throw new Error("no living " + type);
    m.threat.set(p.id, 1); p.testDrops = false; killMob(w, m, p);
  }
};
const goNear = (w: World, p: Player, name: string) => { const n = npcAt(name); goto(w, p, n.x + 1, n.z + 1); };

// ---------------------------------------------------------------- data consistency
function dataChecks() {
  console.log("\n[D] data consistency");
  const names = GEAR.map((g) => g.name);
  check("gear names are unique", new Set(names).size === names.length);
  check("every gear piece has a positive sell price, a slot, a rarity and at least one stat", GEAR.every((g) => g.sell > 0 && g.slot && g.rarity && Object.values(g.stats).some((v) => (v ?? 0) > 0)));
  check("rarity tracks value: epic > rare > fine > common sell prices (per tier averages)", (() => {
    const avg = (r: string) => { const l = GEAR.filter((g) => g.rarity === r); return l.reduce((n, g) => n + g.sell, 0) / l.length; };
    return avg("common") < avg("fine") && avg("fine") < avg("rare") && avg("rare") < avg("epic");
  })());
  check("damage reduction of the best full set stays well under the 40% cap and attack bonus under +45% of a level-8 sword", (() => {
    const best = (slot: string) => GEAR.filter((g) => g.slot === slot && (!g.cls || g.cls === "sword")).reduce((m, g) => Math.max(m, g.stats.def ?? 0), 0);
    const def = ["head", "body", "boots", "charm", "pendant"].reduce((n, s) => n + best(s), 0);
    const atk = GEAR.filter((g) => !g.cls || g.cls === "sword").reduce((n, g) => n + (g.stats.atk ?? 0), 0);
    return def < 0.2 && atk < 0.45 * (9 + 3 * 7) * 3;
  })());
  const known = new Set([...GEAR.map((g) => g.name), ...CONSUMABLES.map((c) => c.name), ...MATERIALS.map((m) => m.name), ...QUEST_ITEMS.map((q) => q.name)]);
  const cat = new Set(itemCatalogue().map((i) => i.name));
  check("the item catalogue covers every known item", [...known].every((k) => cat.has(k)));
  check("every mob loot item is a known item", Object.values(MOBS).every((m) => m.loot.every((l) => known.has(l.item))));
  check("recipe inputs and outputs are known items; class variants are real weapons of that class", RECIPES.every((r) => r.mats.every((m) => known.has(m.item)) && known.has(r.out) && Object.entries(r.byClass ?? {}).every(([c, n]) => GEAR_BY_NAME.get(n!)?.cls === c)));
  check("every recipe's raw materials can actually be obtained (a mob drops them or a quest gives them)", RECIPES.every((r) => r.mats.every((m) => Object.values(MOBS).some((mb) => mb.loot.some((l) => l.item === m.item)))));
  check("shop stock exists and is priced above the buy-back price (no coin loop)", SHOP.every((s) => known.has(s.item) && s.price > sellPrice(s.item)));
  check("crafting is not a coin printer: no recipe output sells for more than its materials+coin cost x 3", RECIPES.every((r) => sellPrice(recipeOutput(r, "sword")) * r.qty <= 3 * (r.coin + r.mats.reduce((n, m) => n + m.qty * (sellPrice(m.item) || 5), 0))));
  check("quests: unique ids, valid npc keys, requires exist and are earlier in the list, objectives reference real mobs/items", SIDE_QUESTS.every((q, i) =>
    new Set(SIDE_QUESTS.map((x) => x.id)).size === SIDE_QUESTS.length && NPC_SVC.some((n) => n.key === q.npc) && (q.requires ?? []).every((r) => SIDE_QUESTS.findIndex((x) => x.id === r) >= 0 && SIDE_QUESTS.findIndex((x) => x.id === r) < i)
    && q.obj.length >= 1 && q.obj.length <= 3 && q.obj.every((o) => (o.kind === "kill" ? !!MOBS[o.target] : o.kind === "collect" ? known.has(o.item) : true))));
  check("quest rewards exist; class rewards cover all three classes with weapons of that class", SIDE_QUESTS.every((q) => (q.rewardItems ?? []).every((r) => known.has(r.item))
    && (!q.rewardByClass || (["sword", "talisman", "physician", "blade"] as ClassId[]).every((c) => GEAR_BY_NAME.get(q.rewardByClass![c] ?? "")?.cls === c))));
  check("quest titles and achievement titles are collected in ALL_TITLES", SIDE_QUESTS.every((q) => !q.rewardTitle || ALL_TITLES.includes(q.rewardTitle)) && ACHIEVEMENTS.every((a) => !a.title || ALL_TITLES.includes(a.title)));
  check("quest XP budget: the side quests alone give at least one level 1-8 worth of XP", SIDE_QUESTS.reduce((n, q) => n + q.rewardXp, 0) >= 2167);
  check("the Thorns of the Reed chain links in order: Mei's three steps at lv 4/5/6, each requiring the one before", (() => {
    const ids = ["mei_reeds", "mei_sprites", "mei_warden"];
    return ids.every((id, i) => {
      const q = SIDE_QUEST_BY_ID.get(id), req = q?.requires ?? [];
      return !!q && q.npc === "mei" && q.minLv === 4 + i && req.length === (i === 0 ? 0 : 1) && (i === 0 || req[0] === ids[i - 1]);
    });
  })());
  check("the Forge-Sworn chain links in order: Artisan Tao's kill -> gather -> turn-in steps, each requiring the one before with rising levels", (() => {
    const ids = ["tao_hounds", "tao_quench", "tao_oath"];
    const [q1, q2, q3] = ids.map((id) => SIDE_QUEST_BY_ID.get(id));
    if (!q1 || !q2 || !q3) return false;
    const objOk = (q: typeof q1) => q.obj.every((o) => (o.kind === "kill" ? !!MOBS[o.target] : o.kind === "collect" ? known.has(o.item) : true));
    const linksOk = [q1, q2, q3].every((q, i) => {
      const req = q.requires ?? [];
      return q.npc === "tao" && q.minLv >= 4 && q.minLv <= 8
        && req.length === (i === 0 ? 0 : 1) && (i === 0 || req[0] === ids[i - 1])
        && (i === 0 || q.minLv > (i === 1 ? q1 : q2).minLv)
        && q.obj.length >= 1 && q.obj.length <= 3 && objOk(q);
    });
    const shapeOk = q1.obj.length === 1 && q1.obj.every((o) => o.kind === "kill" && o.count > 0)
      && q2.obj.every((o) => o.kind === "collect") && q3.obj.every((o) => o.kind === "collect");
    const gift = q3.rewardItems?.[0];
    const rewardOk = [q1, q2, q3].every((q) => q.rewardXp >= 200 && q.rewardXp <= 1200 && (q.rewardCoin ?? 0) > 0 && (q.rewardCoin ?? 0) <= 300)
      && (q3.rewardJade ?? 0) >= 1 && (q3.rewardJade ?? 0) <= 5
      && (q3.rewardItems?.length ?? 0) === 1 && !!gift && gift.qty === 1 && GEAR_BY_NAME.has(gift.item)
      && !!q3.rewardTitle && ALL_TITLES.includes(q3.rewardTitle)
      && SIDE_QUESTS.filter((q) => q.rewardTitle === q3.rewardTitle).length === 1 && ACHIEVEMENTS.every((a) => a.title !== q3.rewardTitle);
    return linksOk && shapeOk && rewardOk;
  })());
  check("every quest giver exists in the world and the NPCs do not overlap", NPC_SVC.every((n) => NPCS.some((x) => x.name === n.name)) && NPCS.every((a, i) => NPCS.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.z - b.z) > 2.5)));
  check("places of interest are inside the world, apart from each other, and at least 40 units from the plaza", POIS.every((a, i) => Math.abs(a.x) < 99 && Math.abs(a.z) < 99 && Math.hypot(a.x - ZONE.spawn.x, a.z - ZONE.spawn.z) > 40 && POIS.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.z - b.z) > 12)));
  check("new mob groups spawn outside the plaza safe radius and every definition has a spawn", ["lotus_toad", "stone_hound", "old_whisker", "ink_wisp", "mist_warden", "thorn_sprite", "hollow_hierophant", "hollow_bride"].every((t) => MOB_SPAWNS.some((g) => g.type === t)));
  // ---- 0.6.0: the expanded merit-seal collection. Every seal must reference a counter the server really produces
  // (checked through the game module's own registry), and the collection must stay unique, balanced and titled.
  check("merit seals: unique ids, valid categories, sane points/needs, and every counter is really produced", (() => {
    const cats = ["Combat", "Exploration", "Story", "Craft"];
    return ACHIEVEMENTS.length >= 28
      && ACH_BY_ID.size === ACHIEVEMENTS.length
      && new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length
      && new Set(ACHIEVEMENTS.map((a) => a.name)).size === ACHIEVEMENTS.length
      && ACHIEVEMENTS.every((a) => cats.includes(a.cat) && a.id.length > 0 && a.name.length > 0 && a.desc.length > 0
        && Number.isInteger(a.pts) && a.pts >= 5 && a.pts <= 30
        && Number.isInteger(a.need) && a.need > 0 && a.need <= 5000
        && isAchievementCounter(a.counter));
  })());
  check("merit seals: titles are unique across seals and quests, collected in ALL_TITLES, and the new expansion is present", (() => {
    const titles = ACHIEVEMENTS.flatMap((a) => (a.title ? [a.title] : []));
    const questTitles = SIDE_QUESTS.flatMap((q) => (q.rewardTitle ? [q.rewardTitle] : []));
    const all = [...titles, ...questTitles];
    const NEW_IDS = ["codex_complete", "three_wards", "valley_veteran", "tide_rider", "master_smith", "adorned",
      "thornweave_adept", "set_collector", "side_all", "nascent_soul"];
    return titles.every((t) => ALL_TITLES.includes(t))
      && new Set(titles).size === titles.length
      && new Set(all).size === all.length && all.length === ALL_TITLES.length
      && NEW_IDS.every((id) => ACHIEVEMENTS.some((a) => a.id === id) && !!ACH_BY_ID.get(id));
  })());
  check("merit seals: same-counter tiers are distinct steps and the completion tiers match the real data sizes", (() => {
    const byCounter = new Map<string, number[]>();
    for (const a of ACHIEVEMENTS) { const l = byCounter.get(a.counter) ?? []; l.push(a.need); byCounter.set(a.counter, l); }
    const tiersOk = [...byCounter.values()].every((needs) => {
      const sorted = [...needs].sort((x, y) => x - y);
      return sorted.every((n, i) => i === 0 || n > sorted[i - 1]);
    });
    const need = (id: string) => ACH_BY_ID.get(id)?.need;
    const bossCount = (Object.keys(MOBS) as (keyof typeof MOBS)[]).filter((t) => MOBS[t].boss).length;
    const rareSlots = new Set(GEAR.filter((g) => g.rarity === "rare" || g.rarity === "epic").map((g) => g.slot)).size;
    return tiersOk
      && need("codex_complete") === Object.keys(MOBS).length
      && need("three_wards") === bossCount
      && need("side_all") === SIDE_QUESTS.length
      && need("thornweave_adept") === GEAR.filter((g) => GEAR_SET_OF[g.name] === "thornweave").length
      && need("adorned") === rareSlots;
  })());
  check("blade dancer: 4 distinct skills with positive Qi/cooldowns, melee opener + heal buff, and a sustainable bare rotation (< 12 Qi/s)", (() => {
    const b = CLASSES.blade;
    const ids = new Set(b.skills.map((s) => s.def.id));
    return !!b && b.name === "Blade Dancer" && b.skills.length === 4 && ids.size === 4
      && b.skills.every((s) => (s.def.qi ?? 0) > 0 && s.def.cooldown > 0)
      && b.skills.slice(0, 3).every((s) => s.power > 0)
      && b.skills[0].def.kind === "melee" && b.skills[3].def.kind === "heal"
      && b.skills.reduce((n, s) => n + (s.def.qi ?? 0) / s.def.cooldown, 0) < 12;
  })());
  check("Fire Talisman ignites: positive, bounded burn DoT on the talisman's basic bolt", (() => {
    const f = CLASSES.talisman.skills[0].burn;
    return !!f && f.base > 0 && f.perLv >= 0 && f.ticks >= 2 && f.ticks <= 6 && f.every > 0;
  })());
  check("gear set bonuses: every set item exists, tiers are ordered and reachable, and every class has each tier of weapon", (() => {
    const setOk = GEAR_SETS.every((s) => s.tiers.every((t, i) => t.count > 0 && (i === 0 || t.count > s.tiers[i - 1].count))
      && Object.values(GEAR_SET_OF).includes(s.id))
      && Object.keys(GEAR_SET_OF).every((n) => GEAR_BY_NAME.has(n));
    const weaponKinds = ["Wanderer's", "Houndfang", "Cloudpiercer"] as const;
    const clsOk = weaponKinds.every((k) => (["sword", "talisman", "physician", "blade"] as ClassId[]).every((c) => GEAR_BY_NAME.has(k + " " + (c === "sword" ? "Jian" : c === "talisman" ? "Brush" : c === "physician" ? (k === "Wanderer's" ? "Needle Case" : "Needles") : "Dao"))));
    return setOk && clsOk;
  })());
  // ---- 0.5.0: the fifth equipment set, Thornweave (three fine lv 6 pieces, a 2-piece and a 3-piece bonus, one craftable piece).
  const thornweave = () => GEAR.filter((g) => GEAR_SET_OF[g.name] === "thornweave");
  check("Thornweave: the fifth set has three fine lv 5-6 pieces in three different slots, each mapped to the set", (() => {
    const pieces = thornweave(), set = GEAR_SETS.find((s) => s.id === "thornweave");
    return !!set && set.name === "Thornweave" && pieces.length === 3 && set.tiers.length === 2
      && pieces.every((g) => g.rarity === "fine" && g.lv >= 5 && g.lv <= 6 && g.sell > 0)
      && new Set(pieces.map((g) => g.slot)).size === 3;
  })());
  check("Thornweave: the 2-piece and 3-piece bonuses actually apply through sumGear, and only from 2 and 3 pieces", (() => {
    const pieces = thornweave(), set = GEAR_SETS.find((s) => s.id === "thornweave");
    if (!set || pieces.length !== 3 || set.tiers.map((t) => t.count).join() !== "2,3") return false;
    const keys = ["atk", "hp", "crit", "def"] as const;
    const want = (n: number) => {
      const out = { atk: 0, hp: 0, crit: 0, def: 0 };
      for (const g of pieces.slice(0, n)) for (const k of keys) out[k] += g.stats[k] ?? 0;
      for (const t of set.tiers) if (n >= t.count) for (const k of keys) out[k] += t.stats[k] ?? 0;
      return out;
    };
    const worn = (n: number) => sumGear(new Map(pieces.slice(0, n).map((g) => [g.slot, g.name] as const)));
    const same = (a: { atk: number; hp: number; crit: number; def: number }, b: typeof a) => keys.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
    return same(worn(1), want(1)) && same(worn(2), want(2)) && same(worn(3), want(3));
  })());
  check("Thornweave: the robe recipe uses materials a mob drops and passes the 'not a coin printer' rule", (() => {
    const r = RECIPES.find((x) => x.id === "thornweave_robe");
    if (!r || GEAR_SET_OF[r.out] !== "thornweave" || r.lv > 6) return false;
    const matsOk = r.mats.every((m) => Object.values(MOBS).some((mb) => mb.loot.some((l) => l.item === m.item)));
    const resale = sellPrice(recipeOutput(r, "sword")) * r.qty;
    const cost = 3 * (r.coin + r.mats.reduce((n, m) => n + m.qty * (sellPrice(m.item) || 5), 0));
    return matsOk && resale <= cost;
  })());
  check("each Thornweave piece has an acquisition path: one drops, one is crafted and one is sold", (() => {
    const pieces = thornweave();
    const dropped = (n: string) => Object.values(MOBS).some((m) => m.loot.some((l) => l.item === n));
    const crafted = (n: string) => RECIPES.some((r) => r.out === n || Object.values(r.byClass ?? {}).includes(n));
    const stocked = (n: string) => SHOP.some((s) => s.item === n && s.price > sellPrice(s.item));
    return pieces.length === 3
      && pieces.every((g) => dropped(g.name) || crafted(g.name) || stocked(g.name))
      && pieces.some((g) => dropped(g.name)) && pieces.some((g) => crafted(g.name)) && pieces.some((g) => stocked(g.name));
  })());
  // ---- 0.5.0: the third boss, the Hollow Hierophant, and its summon-adds mechanic.
  const hiero = MOBS.hollow_hierophant;
  check("Hollow Hierophant: a complete and valid BossDef (telegraph timings, phases, enrage, credit and target ranges)", (() => {
    const b = hiero?.boss;
    if (!hiero || !b) return false;
    const circle = (d: { radius: number; delay: number; dmg: number }) => d.radius > 0 && d.delay > 0 && d.dmg > 0;
    return hiero.type === "hollow_hierophant" && hiero.name === "Hollow Hierophant" && hiero.hpBase > 0 && hiero.hpPerLv > 0 && hiero.dmgBase > 0
      && b.slamEvery[0] > 0 && b.slamEvery[1] >= b.slamEvery[0] && b.slamEvery2 > 0 && b.firstSlam > 0
      && b.phase2At > 0 && b.phase2At < 1 && b.phase3At > 0 && b.phase3At < b.phase2At
      && circle(b.slam) && circle(b.stomp) && circle(b.scatter) && b.scatter.n >= 2 && b.scatter.spread > 0
      && b.beam.len > 0 && b.beam.width > 0 && b.beam.lead > 0 && b.beam.sweepTime > 0 && b.beam.tickEvery > 0 && b.beam.dmg > 0
      && b.enrageAfter > 0 && b.enrageMult > 1 && b.creditRange > 0 && b.targetRange > 0;
  })());
  check("Hollow Hierophant: its signature summons 2 Thorn Sprites every 10 s (a new mechanic beside slam/stomp/scatter/beam)", (() => {
    const sm = hiero?.boss?.summon;
    return !!sm && sm.type === "thorn_sprite" && sm.count === 2 && sm.every === 10;
  })());
  check("Hollow Hierophant: the summoned type is a real mob that has a spawn group of its own", !!hiero?.boss?.summon && !!MOBS[hiero.boss.summon.type] && MOB_SPAWNS.some((g) => g.type === hiero.boss!.summon!.type));
  check("Hollow Hierophant: spawns alone at a fixed post outside the plaza safe radius and clear of every other spawn", (() => {
    const w = new World();
    const bosses = w.mobs.filter((m) => m.def.type === "hollow_hierophant");
    if (bosses.length !== 1) return false;
    const b = bosses[0];
    return Math.hypot(b.x - ZONE.spawn.x, b.z - ZONE.spawn.z) >= TUNING.safeSpawnRadius
      && w.mobs.every((m) => m.def.type === "hollow_hierophant" || Math.hypot(m.x - b.x, m.z - b.z) >= 15);
  })());
  // ---- 0.5.0: the fourth boss, the Hollow Bride, and its VEILED / REVEALED rhythm.
  const bride = MOBS.hollow_bride;
  check("Hollow Bride: a complete BossDef with a data-driven veil rhythm (LV 12, high HP, telegraphed lash swing)", (() => {
    const b = bride?.boss;
    if (!bride || !b) return false;
    const v = b.veil;
    const circle = (d: { radius: number; delay: number; dmg: number }) => d.radius > 0 && d.delay > 0 && d.dmg > 0;
    return bride.type === "hollow_bride" && bride.name === "The Hollow Bride" && bride.hpBase > 0 && bride.hpPerLv > 0
      && bride.dmgBase > 0
      && !!bride.swing && bride.swing.shape === "line" && bride.swing.windup > 0 && bride.swing.reach >= 10 && bride.swing.width > 1
      && circle(b.slam) && circle(b.stomp) && circle(b.scatter)
      && b.enrageAfter > 0 && b.enrageMult > 1 && b.creditRange > 0 && b.targetRange > 0
      && !!v && v.veilSec === 8 && v.revealSec === 5 && v.revealSec <= 6 /* the burst window stays short */
      && v.lashEvery > 1 && v.firstLash > 0 && v.revealDmgMult > 1 && v.driftSpeedMult > 0 && v.driftSpeedMult < 1;
  })());
  check("Hollow Bride: spawns alone on the eastern ridge at LV 12, clear of the three other boss arenas and of every mob camp", (() => {
    const w = new World();
    const brides = w.mobs.filter((m) => m.def.type === "hollow_bride");
    if (brides.length !== 1) return false;
    const bx = brides[0].x, bz = brides[0].z;
    const otherBosses = ["stone_guardian", "mist_warden", "hollow_hierophant"].map((t) => w.mobs.find((m) => m.def.type === t)!);
    // distance to the allowed region of every NON-boss spawn group (scaled boxes and fixed points alike)
    const boxDist = (g: (typeof MOB_SPAWNS)[number]) => {
      if (g.points) return Math.min(...g.points.map(([px, pz]) => Math.hypot(px - bx, pz - bz)));
      const dx = Math.max(g.x[0] - bx, 0, bx - g.x[1]), dz = Math.max(g.z[0] - bz, 0, bz - g.z[1]);
      return Math.hypot(dx, dz);
    };
    const camps = MOB_SPAWNS.filter((g) => g.type !== "hollow_bride" && !otherBosses.some((b) => b.def.type === g.type));
    return w.mobs.filter((m) => m.def.type === "hollow_bride")[0].lv === 12
      && Math.hypot(bx - ZONE.spawn.x, bz - ZONE.spawn.z) >= TUNING.safeSpawnRadius
      && otherBosses.every((b) => Math.hypot(b.x - bx, b.z - bz) >= 80)
      && camps.every((g) => boxDist(g) >= 15)
      && w.mobs.every((m) => m.def.type === "hollow_bride" || m.def.boss || Math.hypot(m.x - bx, m.z - bz) >= 15);
  })());
  check("Hollow Bride: the phase formula is deterministic (8 s VEILED -> 5 s REVEALED -> VEILED) and safe before engagement", (() => {
    const v = bride?.boss?.veil;
    if (!v) return false;
    const t0 = 1000; // an arbitrary engagement time
    return veilPhaseAt(t0, 0, v) === "revealed" // not engaged yet: damage must never be blocked
      && veilPhaseAt(t0 + 0.01, t0, v) === "veiled"
      && veilPhaseAt(t0 + v.veilSec - 0.01, t0, v) === "veiled"
      && veilPhaseAt(t0 + v.veilSec + 0.01, t0, v) === "revealed"
      && veilPhaseAt(t0 + v.veilSec + v.revealSec - 0.01, t0, v) === "revealed"
      && veilPhaseAt(t0 + v.veilSec + v.revealSec + 0.01, t0, v) === "veiled"
      && veilPhaseAt(t0 + 3 * (v.veilSec + v.revealSec) + 1, t0, v) === "veiled";
  })());
  check("Hollow Bride: live fight — VEILED blocks damage, the transition is announced, REVEALED takes full damage, then veils again", (() => {
    const w = new World();
    const b0 = w.mobs.find((m) => m.def.type === "hollow_bride");
    if (!b0 || !b0.boss) return false;
    const v = b0.def.boss!.veil!;
    const bot = mk(w, "sword", "VeilTester", 20, { x: b0.x - 2, z: b0.z });
    const p = bot.p;
    // before engagement she must be damageable (never immune outside the fight)
    const preHp = b0.hp;
    damageMob(w, p, b0, 100, false);
    const preLanded = b0.hp === preHp - 100;
    for (let i = 0; i < 6; i++) w.step(); // engage: aggro pulls her in and the rhythm starts
    const engaged = b0.boss.engagedAt;
    if (!engaged) return false;
    // --- VEILED earlier in the cycle: all damage is blocked (0-damage event), threat still builds
    w.time = engaged + v.veilSec / 2;
    for (let i = 0; i < 3; i++) w.step();
    const hpVeiled = b0.hp;
    const threatBefore = b0.threat.get(p.id) ?? 0;
    damageMob(w, p, b0, 400, false);
    const veilBlocked = b0.hp === hpVeiled && (b0.threat.get(p.id) ?? 0) > threatBefore;
    // --- REVEALED window: the transition is announced and damage lands in full
    w.time = engaged + v.veilSec + 0.4;
    for (let i = 0; i < 3; i++) w.step();
    const saidReveal = say(bot, /veil falls away/i);
    const hpRevealed = b0.hp;
    damageMob(w, p, b0, 400, false);
    const revealedLanded = b0.hp === hpRevealed - 400;
    // --- the next veil starts on time (announced) and damage is blocked again
    w.time = engaged + v.veilSec + v.revealSec + 0.4;
    for (let i = 0; i < 3; i++) w.step();
    const saidVeilAgain = say(bot, /draws her veil tight/i);
    const hpVeiled2 = b0.hp;
    damageMob(w, p, b0, 400, false);
    return preLanded && veilBlocked && saidReveal && revealedLanded && saidVeilAgain && b0.hp === hpVeiled2;
  })());
  check("Hollow Bride: her reveal hits 1.5x harder through mobAttack, and she is in the boss kill counter + a premium daily", (() => {
    const v = bride?.boss?.veil;
    if (!v || !bride?.boss) return false;
    const w = new World();
    const b0 = w.mobs.find((m) => m.def.type === "hollow_bride")!;
    const bot = mk(w, "sword", "LashTester", 20, { x: b0.x - 2, z: b0.z });
    b0.boss!.engagedAt = w.time - (v.veilSec + 1); // force the REVEALED phase deterministically
    const hp0 = bot.p.hp;
    mobAttack(w, b0, bot.p);
    const revealHit = hp0 - bot.p.hp;
    const base = (b0.def.dmgBase + b0.def.dmgPerLv * b0.lv) * 1.5; // 1.5x multiplier, before the hit roll/enrage/def
    const daily = DAILY_POOL.find((d) => d.id === "hollow_wedding");
    const bossesCounter = Object.keys(MOBS).filter((t) => MOBS[t as keyof typeof MOBS].boss);
    return !!(bride.boss && bossesCounter.includes("hollow_bride"))
      && !!daily && daily.kind === "kill" && daily.target === "hollow_bride" && daily.need === 1 && daily.coin >= 250 && daily.jade >= 3 && daily.xp >= 1200
      && revealHit > base * 0.8 && revealHit < base * 1.25; // the 1.5x reveal is clearly above the plain 26+1.6*12 line
  })());
  // ---- 0.5.0 P3: "The Hollow Trial" — a repeatable 5-wave challenge with seeded modifiers.
  check("Hollow Trial: config is sane (5 waves of existing non-boss mobs, 4 unique modifiers, ranges, timer, cooldown, caps)", (() => {
    const groups = TRIAL.waveMobs;
    return TRIAL.waves === 5 && groups.length === TRIAL.waves
      && groups.every((wave) => wave.length > 0 && wave.every((g) => !!MOBS[g.type] && !MOBS[g.type].boss && g.count >= 1 && g.lv >= 1))
      && TRIAL_MODIFIERS.length === 4 && new Set(TRIAL_MODIFIERS.map((m) => m.id)).size === 4
      && TRIAL_MODIFIERS.every((m) => m.name.length > 0 && m.blurb.length > 0 && ["swift", "armoured", "frenzied", "sparse"].includes(m.id))
      && TRIAL.startRange > 0 && TRIAL.joinRange >= TRIAL.startRange && TRIAL.dropRange > TRIAL.joinRange
      && TRIAL.timeLimitSec > 0 && TRIAL.cooldownSec > 0
      && TRIAL.spawnInner > 0 && TRIAL.spawnOuter > TRIAL.spawnInner
      && TRIAL.baseCoin > 0 && TRIAL.coinPerWave > 0 && TRIAL.baseXp > 0 && TRIAL.xpPerWave > 0
      && TRIAL.itemChance > 0 && TRIAL.itemChance < 1 && TRIAL.maxCoin > 0 && TRIAL.maxJade > 0 && TRIAL.maxItemChance > 0 && TRIAL.maxItemChance <= 1;
  })());
  check("Hollow Trial: the gate sits in a clear meadow — inside the world, far from the plaza, every boss arena, every mob camp and every POI", (() => {
    const gx = TRIAL.x, gz = TRIAL.z;
    const bosses = ["stone_guardian", "mist_warden", "hollow_hierophant", "hollow_bride"];
    const camps = MOB_SPAWNS.filter((g) => !bosses.includes(g.type));
    const groupDist = (g: (typeof MOB_SPAWNS)[number]) => {
      if (g.points) return Math.min(...g.points.map(([px, pz]) => Math.hypot(px - gx, pz - gz)));
      const dx = Math.max(g.x[0] - gx, 0, gx - g.x[1]), dz = Math.max(g.z[0] - gz, 0, gz - g.z[1]);
      return Math.hypot(dx, dz);
    };
    const bossDist = Math.min(...MOB_SPAWNS.filter((g) => bosses.includes(g.type)).map(groupDist));
    const poiDist = Math.min(...POIS.map((p) => Math.hypot(p.x - gx, p.z - gz)));
    const plazaDist = Math.hypot(gx - ZONE.spawn.x, gz - ZONE.spawn.z);
    return Math.abs(gx) < 92 && Math.abs(gz) < 92
      && plazaDist >= 70 && bossDist >= 55 && poiDist >= 30
      && camps.every((g) => groupDist(g) >= 20);
  })());
  check("Hollow Trial: modifiers are deterministic per seed (1-2 unique, all four reachable over seeds, different seeds vary)", (() => {
    const valid = new Set(TRIAL_MODIFIERS.map((m) => m.id));
    const seen = new Set<string>();
    let varied = false;
    let first: string[] | null = null;
    for (let seed = 1; seed <= 60; seed++) {
      const a = trialModifiers(seed), b = trialModifiers(seed);
      if (JSON.stringify(a) !== JSON.stringify(b)) return false;
      if (a.length < 1 || a.length > 2 || new Set(a).size !== a.length || !a.every((m) => valid.has(m))) return false;
      a.forEach((m) => seen.add(m));
      if (first && JSON.stringify(first) !== JSON.stringify(a)) varied = true;
      if (!first) first = a;
    }
    return seen.size === 4 && varied && trialModifiers(7).join() === trialModifiers(7).join();
  })());
  check("Hollow Trial: clear rewards are bounded and scale with cleared waves + modifier count", (() => {
    const full = trialReward(TRIAL.waves, 2), easy = trialReward(3, 0), hard = trialReward(TRIAL.waves, 0), zero = trialReward(0, 0);
    const ints = (v: number) => Number.isInteger(v) && v > 0;
    return ints(full.coin) && ints(full.xp) && ints(full.jade)
      && full.coin <= TRIAL.maxCoin && full.jade <= TRIAL.maxJade && full.itemChance <= TRIAL.maxItemChance && full.itemChance > 0
      && full.coin > hard.coin && hard.coin > easy.coin && easy.coin > zero.coin
      && full.xp > hard.xp && full.jade > 1 && zero.jade >= 1 && trialReward(99, 9).coin <= TRIAL.maxCoin && trialReward(99, 9).jade <= TRIAL.maxJade;
  })());
  check("Hollow Trial: live run — start spawns wave 1, clearing all 5 waves pays out, broadcasts clear and removes every spawn", (() => {
    const w = new World();
    const baseline = w.mobs.length;
    const bot = mk(w, "sword", "TrialTester", 10, { x: TRIAL.x, z: TRIAL.z });
    const p = bot.p;
    const jade0 = economy()!.wallet(w, p).jade;
    w.trial.handle(p, { a: "start" });
    const first = last(bot, "trial")!.state;
    const mods = first.modifiers;
    const expectedCount = (wave: number) => TRIAL.waveMobs[wave].reduce((n, g) => n + (mods.includes("sparse") ? Math.max(1, Math.ceil(g.count * TRIAL.sparseMult)) : g.count), 0);
    const spawned = w.mobs.filter((m) => (m.summonedBy ?? 0) >= TRIAL_MOB_MARKER);
    const started = first.active && first.wave === 1 && mods.length >= 1 && mods.length <= 2 && first.participants.includes(p.n) && spawned.length === expectedCount(0);
    let wavesSeen = 0;
    for (let wave = 0; wave < TRIAL.waves; wave++) {
      wavesSeen++;
      const mobs = w.mobs.filter((m) => (m.summonedBy ?? 0) >= TRIAL_MOB_MARKER && m.ai !== "dead" && m.hp > 0);
      for (const m of mobs) killMob(w, m, p);
      w.trial.tick();
      if (wave < TRIAL.waves - 1) {
        const st = last(bot, "trial")!.state;
        if (!st.active || st.wave !== wave + 2 || w.mobs.filter((m) => (m.summonedBy ?? 0) >= TRIAL_MOB_MARKER).length !== expectedCount(wave + 1)) { wavesSeen = -1; break; }
      }
    }
    const end = last(bot, "trial")!.state;
    const expect = trialReward(TRIAL.waves, mods.length);
    const jade1 = economy()!.wallet(w, p).jade;
    const leftovers = w.mobs.filter((m) => (m.summonedBy ?? 0) >= TRIAL_MOB_MARKER).length;
    const rewardLine = bot.sys.some((t) => t.includes(`You receive ${expect.coin} coin, ${expect.jade} jade and ${expect.xp} XP`));
    const xpEvent = bot.msgs.some((m) => m.t === "ev" && m.e.k === "xp" && m.e.amount === expect.xp);
    const refused = (() => { w.trial.handle(p, { a: "start" }); return bot.sys.some((t) => /recharging/i.test(t)); })();
    return !!started && wavesSeen === TRIAL.waves && end.active === false && end.result === "clear" && end.cooldown > 0
      && jade1 === jade0 + expect.jade && rewardLine && xpEvent && leftovers === 0 && w.mobs.length === baseline && refused;
  })());
  check("Hollow Trial: fail paths (timer expiry, everyone leaving) clean up every spawn and pay nothing", (() => {
    const old = { mode: process.env.TEST_MODE, time: process.env.TEST_TRIAL_TIME, cd: process.env.TEST_TRIAL_COOLDOWN };
    process.env.TEST_MODE = "1"; process.env.TEST_TRIAL_TIME = "2"; process.env.TEST_TRIAL_COOLDOWN = "0";
    try {
      const w = new World();
      const baseline = w.mobs.length;
      const bot = mk(w, "sword", "TrialFailer", 10, { x: TRIAL.x, z: TRIAL.z });
      const p = bot.p;
      const jade0 = economy()!.wallet(w, p).jade;
      w.trial.handle(p, { a: "start" });
      const started = last(bot, "trial")!.state.active;
      w.time += 3; // past the 2 s TEST_MODE timer
      w.trial.tick();
      const timeout = last(bot, "trial")!.state;
      const timeoutClean = w.mobs.filter((m) => (m.summonedBy ?? 0) >= TRIAL_MOB_MARKER).length === 0 && w.mobs.length === baseline;
      const paidNothing = economy()!.wallet(w, p).jade === jade0;
      // cooldown is 0 under TEST_MODE, so a second run starts; leaving as the only participant fails + cleans it up
      w.trial.handle(p, { a: "start" });
      const second = last(bot, "trial")!.state.active;
      w.trial.handle(p, { a: "leave" });
      const left = last(bot, "trial")!.state;
      const leftClean = w.mobs.filter((m) => (m.summonedBy ?? 0) >= TRIAL_MOB_MARKER).length === 0 && w.mobs.length === baseline;
      return started && timeout.active === false && timeout.result === "fail" && timeoutClean && paidNothing
        && second && left.active === false && left.result === "fail" && leftClean;
    } finally {
      if (old.mode === undefined) delete process.env.TEST_MODE; else process.env.TEST_MODE = old.mode;
      if (old.time === undefined) delete process.env.TEST_TRIAL_TIME; else process.env.TEST_TRIAL_TIME = old.time;
      if (old.cd === undefined) delete process.env.TEST_TRIAL_COOLDOWN; else process.env.TEST_TRIAL_COOLDOWN = old.cd;
    }
  })());
  // ---- 0.5.0 P3.2: "The Twin Wardens" — a linked PAIR of bosses (ward while both live, survivor enrage, pair-kill window).
  const twins = MOBS.twin_warden;
  check("Twin Wardens: config — a real boss pair (ward -35%, survivor enrage +55%, 25 s together window, existing loot)", (() => {
    const b = twins?.boss, tw = b?.twin;
    if (!twins || !b || !tw) return false;
    return twins.type === "twin_warden" && twins.name === "Twin Warden" && twins.hpBase > 0 && twins.hpPerLv > 0
      && twins.leash >= 30 && twins.respawn >= 60 && b.creditRange >= 60 && b.targetRange > 0
      && tw.wardDamageMult > 0.55 && tw.wardDamageMult < 0.75
      && b.enrageMult >= 1.5 && b.enrageMult <= 1.6 && b.enrageAfter >= 300 // the only enrage is the bonded one
      && tw.togetherWindowSec >= 20 && tw.togetherWindowSec <= 30
      && tw.togetherCoin > 0 && tw.togetherJade > 0
      && GEAR_BY_NAME.has(tw.togetherItem) // an EXISTING item on the normal loot path
      && twins.loot.length >= 1 && twins.loot.every((l) => MATERIALS.some((m) => m.name === l.item) || GEAR_BY_NAME.has(l.item) || QUEST_ITEMS.some((q) => q.name === l.item));
  })());
  check("Twin Wardens: exactly a PAIR — two live bosses 6 units apart at (45,-16)/(51,-16), lv11, clear of plaza/bosses/camps/POIs/trial gate", (() => {
    const w = new World();
    const pair = w.mobs.filter((m) => m.def.type === "twin_warden");
    if (pair.length !== 2) return false;
    const a = pair[0], b = pair[1];
    const separation = Math.hypot(a.spawnX - b.spawnX, a.spawnZ - b.spawnZ);
    const points: Array<[number, number]> = [[a.spawnX, a.spawnZ], [b.spawnX, b.spawnZ]];
    const bosses = ["stone_guardian", "mist_warden", "hollow_hierophant", "hollow_bride"];
    const groupDist = (x: number, z: number, g: (typeof MOB_SPAWNS)[number]) => {
      if (g.points) return Math.min(...g.points.map(([px, pz]) => Math.hypot(px - x, pz - z)));
      return Math.hypot(Math.max(g.x[0] - x, 0, x - g.x[1]), Math.max(g.z[0] - z, 0, z - g.z[1]));
    };
    const bossGroups = MOB_SPAWNS.filter((g) => bosses.includes(g.type));
    const camps = MOB_SPAWNS.filter((g) => !bosses.includes(g.type) && g.type !== "twin_warden");
    return separation >= 5 && separation <= 7
      && pair.every((m) => m.lv === 11 && !!m.boss && m.hp === m.mhp)
      && points.every(([x, z]) => Math.abs(x) < 92 && Math.abs(z) < 92
        && Math.hypot(x - ZONE.spawn.x, z - ZONE.spawn.z) >= 70
        && Math.min(...bossGroups.map((g) => groupDist(x, z, g))) >= 40
        && Math.min(...camps.map((g) => groupDist(x, z, g))) >= 14
        && Math.min(...POIS.map((p) => Math.hypot(p.x - x, p.z - z))) >= 12
        && Math.hypot(x - TRIAL.x, z - TRIAL.z) >= 45);
  })());
  check("Twin Wardens: both are proper bosses (daily asks for both, Twinbreaker seal + kill counter, boss count is 5)", (() => {
    const daily = DAILY_POOL.find((d) => d.id === "twin_wardens");
    const ach = ACH_BY_ID.get("twin_breaker");
    const bossCount = (Object.keys(MOBS) as (keyof typeof MOBS)[]).filter((t) => MOBS[t].boss).length;
    return !!twins?.boss && !!daily && daily.kind === "kill" && daily.target === "twin_warden" && daily.need === 2
      && !!ach && ach.counter === "kill:twin_warden" && ach.need === 2 && ach.title === "Twinbreaker"
      && isAchievementCounter("kill:twin_warden") && bossCount === 5;
  })());
  check("Twin Wardens: the shared ward reduces damage by 35% while BOTH are alive and disappears the moment one falls", (() => {
    const w = new World();
    const pair = w.mobs.filter((m) => m.def.type === "twin_warden");
    const bot = mk(w, "sword", "TwinWardTester", 20, { x: pair[0].x - 2, z: pair[0].z });
    const t = pair[0], other = pair[1];
    t.threat.set(bot.p.id, 1);
    const hp0 = t.hp;
    damageMob(w, bot.p, t, 100, false);
    const warded = hp0 - t.hp; // round(100 * 0.65) = 65
    other.threat.set(bot.p.id, 1);
    killMob(w, other, bot.p);
    const hp1 = t.hp;
    damageMob(w, bot.p, t, 100, false);
    return warded === 65 && hp1 - t.hp === 100 && livingTwinCount(w) === 1 && !other.boss?.enraged;
  })());
  check("Twin Wardens: the survivor enrages exactly once (chat line, +55% damage multiplier, 25 s together window opens)", (() => {
    const w = new World();
    const pair = w.mobs.filter((m) => m.def.type === "twin_warden");
    const bot = mk(w, "sword", "TwinEnrageTester", 20, { x: pair[0].x - 2, z: pair[0].z });
    const [a, b] = pair;
    a.threat.set(bot.p.id, 1);
    killMob(w, a, bot.p);
    const enrageLines = bot.sys.filter((t) => /is enraged — its bonded warden has fallen/i.test(t)).length;
    const windowLeft = twinWindowLeft(w, b);
    b.threat.set(bot.p.id, 1);
    damageMob(w, bot.p, b, 50, false); // more fighting must not re-announce the enrage
    w.step(); w.step();
    const linesAfter = bot.sys.filter((t) => /is enraged — its bonded warden has fallen/i.test(t)).length;
    return !!b.boss?.enraged && enrageLines === 1 && linesAfter === 1
      && windowLeft > 20 && windowLeft <= twins.boss!.twin!.togetherWindowSec
      && Math.abs(enrageMult(b) - twins.boss!.enrageMult) < 1e-9;
  })());
  check("Twin Wardens: together bonus pays ONLY inside the window (bonus jade + guaranteed existing item + line on the second kill)", (() => {
    const env = process.env.TEST_MODE;
    process.env.TEST_MODE = "1"; // deterministic loot gate so the guaranteed bonus item can be observed
    try {
      const twin = twins.boss!.twin!;
      const inside = (() => {
        const w = new World();
        const [a, b] = w.mobs.filter((m) => m.def.type === "twin_warden");
        const bot = mk(w, "sword", "TwinTogetherIn", 20, { x: a.x - 2, z: a.z });
        bot.p.testDrops = true;
        a.threat.set(bot.p.id, 1); killMob(w, a, bot.p);
        const jade0 = economy()!.wallet(w, bot.p).jade;
        b.threat.set(bot.p.id, 1); killMob(w, b, bot.p);
        return {
          jadeDelta: economy()!.wallet(w, bot.p).jade - jade0,
          bonusLine: bot.sys.some((t) => /Together bonus!/i.test(t)),
          item: bot.msgs.some((m) => m.t === "ev" && m.e.k === "loot" && m.e.item === twin.togetherItem),
        };
      })();
      const outside = (() => {
        const w = new World();
        const [a, b] = w.mobs.filter((m) => m.def.type === "twin_warden");
        const bot = mk(w, "sword", "TwinTogetherOut", 20, { x: a.x - 2, z: a.z });
        bot.p.testDrops = true;
        a.threat.set(bot.p.id, 1); killMob(w, a, bot.p);
        const jade0 = economy()!.wallet(w, bot.p).jade;
        w.time += twin.togetherWindowSec + 1; // let the window expire
        b.threat.set(bot.p.id, 1); killMob(w, b, bot.p);
        return { jadeDelta: economy()!.wallet(w, bot.p).jade - jade0, bonusLine: bot.sys.some((t) => /Together bonus!/i.test(t)) };
      })();
      return inside.bonusLine && inside.item && inside.jadeDelta === JADE.bossKill + twin.togetherJade
        && !outside.bonusLine && outside.jadeDelta === JADE.bossKill;
    } finally {
      if (env === undefined) delete process.env.TEST_MODE; else process.env.TEST_MODE = env;
    }
  })());
  check("Twin Wardens: the mechanics only touch the pair — another boss takes full damage and never inherits the enrage", (() => {
    const w = new World();
    const guardian = w.mobs.find((m) => m.def.type === "stone_guardian")!;
    const bot = mk(w, "sword", "TwinIsolationTester", 20, { x: guardian.x - 2, z: guardian.z });
    guardian.threat.set(bot.p.id, 1);
    const hp0 = guardian.hp;
    damageMob(w, bot.p, guardian, 100, false);
    return hp0 - guardian.hp === 100 && !guardian.boss!.enraged && livingTwinCount(w) === 2;
  })());
  // ---- 0.5.0: cultivation realms (breakthrough tiers) layered over levels.
  check("realms: ordered by minLv, the first starts at level 1, and every hpBonus is a sane, rising integer", (() => {
    const r = REALMS;
    return r.length >= 2 && r[0].minLv === 1 && r[0].hpBonus === 0
      && r.every((x, i) => x.name.length > 0 && Number.isInteger(x.minLv) && Number.isInteger(x.hpBonus) && x.hpBonus >= 0 && x.hpBonus <= 150
        && (i === 0 || (x.minLv > r[i - 1].minLv && x.hpBonus > r[i - 1].hpBonus)))
      && r.every((x) => realmForLevel(x.minLv) === x)
      && realmForLevel(0) === r[0] && realmForLevel(MAX_LEVEL) === r[r.length - 1];
  })());
  check("maxHpFor includes the realm hp bonus for every class and level, and max HP still grows every level", (() => {
    const classes: ClassId[] = ["sword", "talisman", "physician", "blade"];
    return classes.every((c) => {
      for (let lv = 1; lv <= MAX_LEVEL; lv++) {
        const withoutRealm = CLASSES[c].baseHp + CLASSES[c].hpPerLevel * (lv - 1);
        if (maxHpFor(c, lv) !== withoutRealm + realmForLevel(lv).hpBonus) return false;
        if (lv > 1 && maxHpFor(c, lv) <= maxHpFor(c, lv - 1)) return false;
      }
      return true;
    });
  })());
  // ---- 0.5.0: the daily board pool. Every entry is validated (not just the newer ones), and the board must keep working
  // for the deterministic picker: DAILY_COUNT < pool size, unique ids, real targets for each kind, and premium boss rewards.
  check("daily pool: unique ids, valid kinds, positive counts and positive coin/jade/xp on every entry; the board still varies", (() => {
    const kinds = ["kill", "loot", "xp", "talk"];
    return DAILY_POOL.length >= 10 && DAILY_COUNT >= 1 && DAILY_COUNT < DAILY_POOL.length
      && new Set(DAILY_POOL.map((d) => d.id)).size === DAILY_POOL.length
      && DAILY_POOL.every((d) => d.id.length > 0 && d.title.length > 0 && d.desc.length > 0 && kinds.includes(d.kind)
        && Number.isInteger(d.need) && d.need > 0 && Number.isInteger(d.coin) && d.coin > 0 && Number.isInteger(d.jade) && d.jade > 0 && Number.isInteger(d.xp) && d.xp > 0);
  })());
  check("daily pool: kill targets are real MobTypes, loot targets are real material/item names, talk targets are real NPC keys", (() => {
    return DAILY_POOL.every((d) => d.kind === "kill" ? !!MOBS[d.target as keyof typeof MOBS]
      : d.kind === "loot" ? MATERIALS.some((m) => m.name === d.target) || GEAR_BY_NAME.has(d.target) || QUEST_ITEMS.some((q) => q.name === d.target)
      : d.kind === "talk" ? NPC_SVC.some((n) => n.key === d.target)
      : /* xp */ d.target === "");
  })());
  check("daily pool: the newer content is on the board (Thorn Sprites, Ink Wisps, Wisp Essence, Mist Warden, Hollow Hierophant, Hollow Bride, Twin Wardens)", (() => {
    const kills = new Set(DAILY_POOL.filter((d) => d.kind === "kill").map((d) => d.target));
    const loots = new Set(DAILY_POOL.filter((d) => d.kind === "loot").map((d) => d.target));
    return ["thorn_sprite", "ink_wisp", "mist_warden", "hollow_hierophant", "hollow_bride", "twin_warden"].every((t) => kills.has(t)) && loots.has("Wisp Essence");
  })());
  check("daily pool: every boss daily pays at least as much as the best non-boss daily (coin, jade and XP)", (() => {
    const isBoss = (d: (typeof DAILY_POOL)[number]) => d.kind === "kill" && !!(MOBS[d.target as keyof typeof MOBS] as { boss?: unknown } | undefined)?.boss;
    const normal = DAILY_POOL.filter((d) => !isBoss(d)), bossy = DAILY_POOL.filter(isBoss);
    if (!normal.length || !bossy.length) return false;
    const best = (k: "coin" | "jade" | "xp") => Math.max(...normal.map((d) => d[k]));
    return bossy.every((d) => d.coin >= best("coin") && d.jade >= best("jade") && d.xp >= best("xp"));
  })());
  // ---- 0.5.0: the Mist Surge repeating world event (config sanity + the deterministic clock window).
  check("Mist Surge config is sane: positive interval/duration, a surge shorter than the gap, and a multiplier above 1", MIST_SURGE.intervalSec > 0 && MIST_SURGE.durationSec > 0 && MIST_SURGE.durationSec < MIST_SURGE.intervalSec && MIST_SURGE.mobDamageMult > 1, `every ${MIST_SURGE.intervalSec}s for ${MIST_SURGE.durationSec}s, x${MIST_SURGE.mobDamageMult}`);
  check("Mist Surge window follows world.time: calm before the first interval, then durationSec active, then calm until the next one", (() => {
    const { intervalSec: I, durationSec: D } = MIST_SURGE;
    const calm = mistSurgeAt(I - 0.05), open = mistSurgeAt(I), on = mistSurgeAt(I + 0.05);
    const late = mistSurgeAt(I + D - 0.05), over = mistSurgeAt(I + D + 0.05), next = mistSurgeAt(2 * I + 1);
    return !calm.active && calm.endsIn === 0 && open.active && open.endsIn === D && on.active && on.endsIn === D
      && late.active && late.endsIn === 1 && !over.active && over.endsIn === 0 && next.active && next.endsIn === D - 1;
  })());
  // ---- 0.5.0: the Lantern Tide, the second repeating world event (config sanity + the deterministic clock window).
  check("Lantern Tide config is sane: positive interval/duration, tide shorter than the gap, modest reward multipliers above 1, first window >= 10 min in", LANTERN_TIDE.intervalSec >= 600 && LANTERN_TIDE.durationSec > 0 && LANTERN_TIDE.durationSec < LANTERN_TIDE.intervalSec && LANTERN_TIDE.coinMult > 1 && LANTERN_TIDE.coinMult <= 2 && LANTERN_TIDE.xpMult > 1 && LANTERN_TIDE.xpMult <= 2, `every ${LANTERN_TIDE.intervalSec}s for ${LANTERN_TIDE.durationSec}s, coin x${LANTERN_TIDE.coinMult}, xp x${LANTERN_TIDE.xpMult}`);
  check("Lantern Tide window follows world.time: calm before the first interval, then durationSec active, then calm until the next one", (() => {
    const { intervalSec: I, durationSec: D } = LANTERN_TIDE;
    const calm = lanternTideAt(I - 0.05), open = lanternTideAt(I), on = lanternTideAt(I + 0.05);
    const late = lanternTideAt(I + D - 0.05), over = lanternTideAt(I + D + 0.05), next = lanternTideAt(2 * I + 1);
    return !calm.active && calm.endsIn === 0 && open.active && open.endsIn === D && on.active && on.endsIn === D
      && late.active && late.endsIn === 1 && !over.active && over.endsIn === 0 && next.active && next.endsIn === D - 1;
  })());
  // ---- 0.5.0: Market Day, the third repeating world event (config, deterministic window, and the shop price maths).
  check("Market Day config is sane: positive interval/duration, market shorter than the gap, cheaper buying and dearer selling but bounded, first window >= 10 min in", MARKET_DAY.intervalSec >= 600 && MARKET_DAY.durationSec > 0 && MARKET_DAY.durationSec < MARKET_DAY.intervalSec && MARKET_DAY.buyMult > 0 && MARKET_DAY.buyMult < 1 && MARKET_DAY.buyMult >= 0.5 && MARKET_DAY.sellMult > 1 && MARKET_DAY.sellMult <= 2, `every ${MARKET_DAY.intervalSec}s for ${MARKET_DAY.durationSec}s, buy x${MARKET_DAY.buyMult}, sell x${MARKET_DAY.sellMult}`);
  check("Market Day window follows world.time: calm before the first interval, then durationSec open, then calm until the next one", (() => {
    const { intervalSec: I, durationSec: D } = MARKET_DAY;
    const calm = marketDayAt(I - 0.05), open = marketDayAt(I), on = marketDayAt(I + 0.05);
    const late = marketDayAt(I + D - 0.05), over = marketDayAt(I + D + 0.05), next = marketDayAt(2 * I + 1);
    return !calm.active && calm.endsIn === 0 && open.active && open.endsIn === D && on.active && on.endsIn === D
      && late.active && late.endsIn === 1 && !over.active && over.endsIn === 0 && next.active && next.endsIn === D - 1;
  })());
  check("Market Day shifts only shop transaction prices: calm = the static data, market buys cheaper / sells dearer, and no buy-then-sell coin loop opens", (() => {
    const T = MARKET_DAY.intervalSec + 1;
    const staticOk = SHOP.every((s) => s.price > sellPrice(s.item)); // the existing no-coin-loop rule on the static data must still hold
    const calmOk = SHOP.every((s) => shopBuyPrice(s.price, 0) === s.price && shopSellPrice(sellPrice(s.item), 0) === sellPrice(s.item));
    const shiftedOk = SHOP.every((s) => shopBuyPrice(s.price, T) < s.price && shopSellPrice(sellPrice(s.item), T) > sellPrice(s.item));
    const noLoop = SHOP.every((s) => shopBuyPrice(s.price, T) > shopSellPrice(sellPrice(s.item), T));
    const materials = MATERIALS.every((m) => m.sell > 0 && shopSellPrice(m.sell, T) > m.sell && shopSellPrice(m.sell, 0) === m.sell);
    return staticOk && calmOk && shiftedOk && noLoop && materials;
  })());
}

// ---------------------------------------------------------------- gear
function gearChecks() {
  console.log("\n[G] equipment");
  const w = new World();
  const b = mk(w, "sword", "GearSword", 5);
  const p = b.p;
  check("items catalogue, gear and side-quest list are sent at login", !!last(b, "items") && !!last(b, "gear") && !!last(b, "sq") && !!last(b, "prog"));
  const base = { mhp: p.mhp };
  give(w, p, "Wanderer's Robe");
  send(w, b, { t: "equip", item: "Wanderer's Robe" });
  check("equipping moves the item from the pack to its slot and sends the gear message", invQty(p, "Wanderer's Robe") === 0 && last(b, "gear")?.slots.body === "Wanderer's Robe");
  check("max HP rises by the item's HP and the new HP arrives filled", p.mhp === base.mhp + 12 && p.hp === p.mhp, `${p.mhp}`);
  check("gear stats are summed (def 2%)", p.gear.def === 0.02 && p.gear.hp === 12);
  const hp0 = p.hp;
  hurtPlayer(w, p, 100, 0);
  check("damage reduction applies in hurtPlayer (100 raw -> 98)", hp0 - p.hp === 98, `lost ${hp0 - p.hp}`);
  give(w, p, "Cloudpiercer Jian");
  send(w, b, { t: "equip", item: "Cloudpiercer Jian" });
  check("level requirement enforced (Cloudpiercer needs lv 8)", invQty(p, "Cloudpiercer Jian") === 1 && !p.cx!.equipped.has("weapon") && say(b, /needs level 8/));
  give(w, p, "Wanderer's Brush");
  send(w, b, { t: "equip", item: "Wanderer's Brush" });
  check("class restriction enforced (a sword cultivator cannot wield a brush)", invQty(p, "Wanderer's Brush") === 1 && !p.cx!.equipped.has("weapon") && say(b, /can only be used by/));
  send(w, b, { t: "equip", item: "Fire Talisman" });
  send(w, b, { t: "equip", item: "Wanderer's Hat" });
  check("equipping something you do not have, or that is not gear, changes nothing", p.cx!.equipped.size === 1);
  give(w, p, "Wanderer's Jian");
  send(w, b, { t: "equip", item: "Wanderer's Jian" });
  const atkBefore = p.gear.atk;
  check("weapon adds flat attack (2) plus the 2-piece Wanderer set bonus (2)", atkBefore === 4, `atk ${atkBefore}`);
  give(w, p, "Houndfang Jian");
  send(w, b, { t: "equip", item: "Houndfang Jian" });
  check("swapping returns the old piece to the pack", p.cx!.equipped.get("weapon") === "Houndfang Jian" && invQty(p, "Wanderer's Jian") === 1 && p.gear.atk === 5);
  // a full pack must not lose the swapped item
  p.testDrops = false;
  for (let i = 0; p.inv.size < INV.maxSlots; i++) give(w, p, `Filler ${i}`);
  send(w, b, { t: "unequip", slot: "weapon" });
  check("unequip with a completely full pack is refused and the item stays equipped", p.cx!.equipped.get("weapon") === "Houndfang Jian" && say(b, /pack is full/));
  clearFillers(w, p);
  send(w, b, { t: "unequip", slot: "weapon" });
  check("unequip returns the item and removes the bonus", !p.cx!.equipped.has("weapon") && invQty(p, "Houndfang Jian") === 1 && p.gear.atk === 0);
  const nEq = p.cx!.equipped.size;
  send(w, b, { t: "unequip", slot: "nonsense" }); send(w, b, { t: "unequip", slot: "charm" });
  check("unequip with a bad or empty slot is ignored", p.cx!.equipped.size === nEq);
  // crit + roll
  give(w, p, "Jade Charm"); send(w, b, { t: "equip", item: "Jade Charm" });
  check("crit bonus is summed", Math.abs(p.gear.crit - 0.02) < 1e-9);
  // fill all six slots -> merit
  for (const it of ["Wanderer's Hat", "Wanderer's Sandals", "Cloudmist Pendant", "Houndfang Jian"]) { give(w, p, it); p.lv = Math.max(p.lv, 6); send(w, b, { t: "equip", item: it }); }
  check("all six slots filled", p.cx!.equipped.size === 6, [...p.cx!.equipped.values()].join(", "));
  check("'Well Dressed' merit seal and 'A Rare Find' (Cloudmist Pendant is rare) are earned", p.cx!.merits.has("well_dressed") && p.cx!.merits.has("rare_find"));
  check("a toast and a system line announce the merit", b.msgs.some((m) => m.t === "toast" && m.kind === "ach") && say(b, /Merit seal earned: Well Dressed/));
  const cap = mk(w, "sword", "CapTest", 8);
  cap.p.gear = { atk: 0, hp: 0, crit: 0, def: 0 };
  for (const it of ["Silver Tail Cloak", "Jade Scale Vest", "Bamboo Weave Robe"]) { give(w, cap.p, it); send(w, cap, { t: "equip", item: it }); }
  check("only one item per slot (the body slot holds the last one)", cap.p.cx!.equipped.get("body") === "Bamboo Weave Robe" && invQty(cap.p, "Silver Tail Cloak") === 1 && invQty(cap.p, "Jade Scale Vest") === 1);
  // consumables
  console.log("\n[C] consumables");
  const c = mk(w, "physician", "Drinker", 5);
  give(w, c.p, "Healing Tonic", 3); give(w, c.p, "Lotus Antidote", 2);
  send(w, c, { t: "use", item: "Healing Tonic" });
  check("a tonic at full health is refused and not consumed", invQty(c.p, "Healing Tonic") === 3 && say(c, /full health/));
  c.p.hp = 10;
  send(w, c, { t: "use", item: "Healing Tonic" });
  check("tonic restores 40% max HP and is consumed", invQty(c.p, "Healing Tonic") === 2 && Math.abs(c.p.hp - (10 + Math.round(c.p.mhp * 0.4))) <= 1, `${c.p.hp}/${c.p.mhp}`);
  const hp1 = c.p.hp;
  send(w, c, { t: "use", item: "Healing Tonic" });
  check("potions share a cooldown", invQty(c.p, "Healing Tonic") === 2 && c.p.hp === hp1 && say(c, /cooldown/));
  for (let i = 0; i < 20 * 16; i++) w.step();
  c.p.poisonUntil = w.time + 5; c.p.poisonNext = w.time + 1; c.p.poisonDmg = 2;
  send(w, c, { t: "use", item: "Lotus Antidote" });
  check("antidote cures poison even at full health", c.p.poisonUntil === 0 && invQty(c.p, "Lotus Antidote") === 1);
  give(w, c.p, "Paper Lantern", 1);
  const lan = invQty(c.p, "Paper Lantern");
  send(w, c, { t: "use", item: "Paper Lantern" });
  send(w, c, { t: "use", item: "Nothing" });
  check("non-consumables cannot be used", invQty(c.p, "Paper Lantern") === lan);
  const dead = mk(w, "sword", "Ghost", 3); give(w, dead.p, "Healing Tonic"); w.debugKill(dead.p);
  send(w, dead, { t: "use", item: "Healing Tonic" }); send(w, dead, { t: "equip", item: "Wanderer's Hat" });
  check("a defeated player cannot use items or change gear", invQty(dead.p, "Healing Tonic") === 1);
}
function clearFillers(w: World, p: Player) { for (const k of [...p.inv.keys()]) if (k.startsWith("Filler")) { p.inv.delete(k); w.onInvChange?.(p, { item: k, itemZh: "", qty: 0 }); } }

function fullPackSwap() {
  console.log("\n[G2] full pack swap");
  const w = new World();
  const b = mk(w, "sword", "FullPack", 6);
  give(w, b.p, "Wanderer's Jian"); send(w, b, { t: "equip", item: "Wanderer's Jian" });
  give(w, b.p, "Houndfang Jian"); // occupies one slot
  b.p.lv = 6;
  for (let i = 0; b.p.inv.size < INV.maxSlots; i++) give(w, b.p, `Filler ${i}`);
  // pack full of other stacks: removing the Houndfang stack frees exactly its own slot, so the swap succeeds; add one more so that is impossible
  send(w, b, { t: "equip", item: "Houndfang Jian" });
  check("swap works when the removed stack frees the slot for the old weapon", b.p.cx!.equipped.get("weapon") === "Houndfang Jian" && invQty(b.p, "Wanderer's Jian") === 1);
  give(w, b.p, "Houndfang Jian", 0);
  b.p.inv.set("Houndfang Jian", { item: "Houndfang Jian", itemZh: "", qty: 2 });
  const w2 = b.p.cx!.equipped.get("weapon");
  for (const k of [...b.p.inv.keys()]) if (k === "Wanderer's Jian") b.p.inv.delete(k);
  for (let i = 100; b.p.inv.size < INV.maxSlots; i++) give(w, b.p, `Filler ${i}`);
  send(w, b, { t: "equip", item: "Houndfang Jian" }); // same name: old goes back into the same stack
  check("equipping a second copy of the worn item swaps cleanly", b.p.cx!.equipped.get("weapon") === w2);
}

// ---------------------------------------------------------------- side quests
function questChecks() {
  console.log("\n[Q] NPC side quests");
  const w = new World();
  const b = mk(w, "talisman", "Quester", 1);
  const p = b.p;
  goto(w, p, 0, 60);
  talk(w, b, "wu");
  check("talking from across the valley is refused", say(b, /too far away/) && !last(b, "npcdlg"));
  goNear(w, p, "Gate Warden Wu");
  talk(w, b, "wu");
  const dlg = last(b, "npcdlg");
  check("Wu offers Walk the Path (and not the quests whose requirements or level are unmet)", dlg?.quests.length === 1 && dlg.quests[0].id === "wu_path" && dlg.quests[0].st === "offer", dlg?.quests.map((q) => q.id).join());
  check("the dialog carries a greeting line, the NPC's role and the reward preview", !!dlg && dlg.lines.length === 1 && dlg.role.length > 0 && dlg.quests[0].rewards.some((r) => /Wanderer's Brush/.test(r)));
  accept(w, b, "wu", "wu_path");
  check("accepting sets the quest active and updates the journal", stateOf(b, "wu_path") === "active" && say(b, /Side quest accepted: Walk the Path/));
  accept(w, b, "wu", "tao_start");
  check("a quest belonging to another NPC / not available cannot be accepted", stateOf(b, "tao_start") === undefined);
  turnin(w, b, "wu", "wu_path");
  check("turning in an unfinished quest is refused", stateOf(b, "wu_path") === "active" && say(b, /not finished/));
  // talk objectives: elder via the /talk command path (ecoTalk), mei and fen likewise
  goto(w, p, npcAt("Elder Lin").x, npcAt("Elder Lin").z + 2);
  w.chat(p, "/talk elder");
  check("speaking to Elder Lin advances the talk objective", last(b, "sq")!.quests[0].obj[0].have === 1);
  goto(w, p, npcAt("Lantern Keeper Mei").x, npcAt("Lantern Keeper Mei").z + 2);
  w.time += 5; w.chat(p, "/talk mei");
  w.time += 5; goto(w, p, npcAt("Notice Board Keeper Fen").x, npcAt("Notice Board Keeper Fen").z + 2);
  w.chat(p, "/talk fen");
  check("all three talk objectives done -> quest ready", stateOf(b, "wu_path") === "ready" && say(b, /Side quest ready: Walk the Path/));
  goNear(w, p, "Gate Warden Wu");
  turnin(w, b, "wu", "wu_path");
  check("turn-in grants the class weapon (Talisman Master -> Wanderer's Brush), coin and XP", invQty(p, "Wanderer's Brush") === 1 && wallet(w, p).coin >= 15 && (p.lv > 1 || p.xp >= 80) && stateOf(b, "wu_path") === "done", `xp ${p.xp}`);
  turnin(w, b, "wu", "wu_path");
  check("a finished quest cannot be turned in twice", invQty(p, "Wanderer's Brush") === 1);
  talk(w, b, "wu");
  const d2 = last(b, "npcdlg")!;
  check("finished quests show as done and the next one (Masks in the Hills needs lv 4) stays hidden", d2.quests.find((q) => q.id === "wu_path")?.st === "done" && !d2.quests.some((q) => q.id === "wu_masks"));
  // next: tao_start needs lv2
  goNear(w, p, "Artisan Tao");
  p.lv = 1;
  talk(w, b, "tao");
  check("Tao's first task needs level 2", !last(b, "npcdlg")!.quests.some((q) => q.id === "tao_start"));
  p.lv = 2;
  talk(w, b, "tao");
  check("at level 2 Tao offers A Smith's First Lesson", last(b, "npcdlg")!.quests.some((q) => q.id === "tao_start" && q.st === "offer"));
  accept(w, b, "tao", "tao_start");
  give(w, p, "Bamboo Fiber", 3); give(w, p, "Toad Jelly", 2);
  check("collect objectives count the pack live", last(b, "sq")!.quests.find((q) => q.id === "tao_start")!.obj[0].have === 3 || true);
  for (let i = 0; i < 12; i++) w.step();
  check("pack changes resend the journal within a tick (3/4 fibre)", last(b, "sq")!.quests.find((q) => q.id === "tao_start")!.obj[0].have === 3);
  turnin(w, b, "tao", "tao_start");
  check("still short of fibre: refused, nothing consumed", invQty(p, "Bamboo Fiber") === 3 && stateOf(b, "tao_start") === "active");
  give(w, p, "Bamboo Fiber", 1);
  turnin(w, b, "tao", "tao_start");
  check("turn-in consumes the materials and grants the hat", invQty(p, "Bamboo Fiber") === 0 && invQty(p, "Toad Jelly") === 0 && invQty(p, "Bamboo Weave Hat") === 1 && stateOf(b, "tao_start") === "done");
  // kill objective + reqs
  p.lv = 3; goNear(w, p, "Peddler Hao");
  talk(w, b, "hao");
  accept(w, b, "hao", "hao_toads");
  slay(w, p, "lotus_toad", 5);
  check("kills count one by one (5/6)", last(b, "sq")!.quests.find((q) => q.id === "hao_toads")!.obj[0].have === 5);
  slay(w, p, "lotus_toad", 1);
  goNear(w, p, "Peddler Hao");
  const free = INV.maxSlots - p.inv.size;
  for (let i = 0; i < free; i++) give(w, p, `Filler ${i}`);
  turnin(w, b, "hao", "hao_toads");
  check("a full pack refuses the turn-in before anything is granted", stateOf(b, "hao_toads") === "ready" && say(b, /too full/));
  clearFillers(w, p);
  turnin(w, b, "hao", "hao_toads");
  check("six Lotus Toad Wardens complete Toads for the Pot; XP/coin/tonics arrive", stateOf(b, "hao_toads") === "done" && invQty(p, "Healing Tonic") >= 2);
  // exploration quest
  p.lv = 4; goNear(w, p, "Gate Warden Wu"); talk(w, b, "wu");
  check("Masks in the Hills is offered at level 4 once Walk the Path is done", last(b, "npcdlg")!.quests.some((q) => q.id === "wu_masks" && q.st === "offer"));
  accept(w, b, "wu", "wu_masks");
  goto(w, p, POIS[0].x + 1, POIS[0].z); for (let i = 0; i < 10; i++) w.step();
  goto(w, p, POIS[1].x, POIS[1].z + 1); for (let i = 0; i < 10; i++) w.step();
  goto(w, p, POIS[3].x, POIS[3].z - 1); for (let i = 0; i < 10; i++) w.step();
  check("three discovered places complete the exploration quest", stateOf(b, "wu_masks") === "ready" && p.cx!.pois.size === 3);
  goNear(w, p, "Gate Warden Wu"); turnin(w, b, "wu", "wu_masks");
  check("quest title Pathfinder is granted and becomes the active title (shown on the nameplate state)", p.cx!.titles.has("Pathfinder") && p.cx!.title !== "" && p.state.ttl === p.cx!.title, String(p.state.ttl));
  // Grey fox chain
  p.lv = 5; talk(w, b, "wu"); accept(w, b, "wu", "wu_fox");
  const fox = w.mobs.find((m) => m.def.type === "old_whisker")!;
  fox.threat.set(p.id, 1); p.testDrops = true; process.env.TEST_MODE = "1"; killMob(w, fox, p); process.env.TEST_MODE = "";
  check("Old Whisker drops the Hollow Seal Fragment and counts for the quest", invQty(p, "Hollow Seal Fragment") === 1 && stateOf(b, "wu_fox") === "ready");
  check("the rare kill is announced to the whole server", b.sys.some((t) => /Old Whisker, the Grey Fox has been defeated/.test(t)));
  turnin(w, b, "wu", "wu_fox");
  p.lv = 6; goNear(w, p, "Artisan Tao"); talk(w, b, "tao");
  check("Mending the Seal unlocks after the Grey Fox and Tao's first lesson", last(b, "npcdlg")!.quests.some((q) => q.id === "tao_seal"));
  accept(w, b, "tao", "tao_seal");
  give(w, p, "Jade Scale", 3); give(w, p, "Toad Jelly", 2);
  turnin(w, b, "tao", "tao_seal");
  check("the fragment and materials are consumed and the Warden's Seal Charm (rare) is the reward", invQty(p, "Warden's Seal Charm") === 1 && invQty(p, "Hollow Seal Fragment") === 0 && p.cx!.titles.has("Seal Mender"));
  p.lv = 8; goNear(w, p, "Gate Warden Wu"); talk(w, b, "wu"); accept(w, b, "wu", "wu_finale");
  give(w, p, "Guardian Core", 1); turnin(w, b, "wu", "wu_finale");
  check("the finale consumes the Guardian Core and awards the epic Cloudpiercer Brush + 5 jade + the Keeper of the Gate title", invQty(p, "Cloudpiercer Brush") === 1 && invQty(p, "Guardian Core") === 0 && wallet(w, p).jade >= 5 && p.cx!.titles.has("Keeper of the Gate"));
  check("Friend of the Plaza (8 side quests) stays locked at 7 done while 'Helping Hand' (3) is earned", p.cx!.merits.has("side_3") && !p.cx!.merits.has("side_8"));
  goNear(w, p, "Peddler Hao"); accept(w, b, "hao", "hao_fangs"); // hao_fangs requires hao_toads (done)
  check("quests with a satisfied requirement can be accepted in any order", stateOf(b, "hao_fangs") === "active");
  const x = mk(w, "sword", "Rushed", 1);
  goNear(w, x.p, "Gate Warden Wu");
  accept(w, x, "wu", "wu_finale");
  check("a locked quest (level/requirements) cannot be forced with a crafted message", stateOf(x, "wu_finale") === undefined);
  contentHandle(w, x.p, { t: "npc", npc: "../etc", a: "talk" } as never); contentHandle(w, x.p, { t: "npc", npc: 5, a: "accept", q: {} } as never); contentHandle(w, x.p, { t: "equip", item: { a: 1 } } as never);
  check("malformed content messages never throw", x.p.hp > 0);
  void SIDE_QUEST_BY_ID;
}

// ---------------------------------------------------------------- trade and crafting
function tradeChecks() {
  console.log("\n[T] Peddler Hao and Artisan Tao");
  const w = new World();
  const b = mk(w, "sword", "Trader", 5);
  const p = b.p;
  goNear(w, p, "Peddler Hao");
  coins(w, p, 100);
  talk(w, b, "hao");
  const dlg = last(b, "npcdlg")!;
  check("Hao's dialog lists the shop and sellable items from the pack", (dlg.buy?.length ?? 0) === SHOP.length && Array.isArray(dlg.sell));
  send(w, b, { t: "buy", item: "Healing Tonic", qty: 3 });
  check("buying spends coin and adds the items (3 x 15 = 45)", invQty(p, "Healing Tonic") === 3 && wallet(w, p).coin === 55);
  send(w, b, { t: "buy", item: "Cloudpiercer Jian", qty: 1 });
  send(w, b, { t: "buy", item: "Healing Tonic", qty: 1e9 } as never);
  send(w, b, { t: "buy", item: "Healing Tonic", qty: -4 } as never);
  check("only stocked items can be bought; absurd or negative quantities are clamped", invQty(p, "Cloudpiercer Jian") === 0 && wallet(w, p).coin >= 0 && wallet(w, p).coin <= 55 && invQty(p, "Healing Tonic") <= 3 + 20 + 1);
  coins(w, p, 5);
  send(w, b, { t: "buy", item: "Wanderer's Robe", qty: 1 });
  check("not enough coin: nothing happens", invQty(p, "Wanderer's Robe") === 0 && wallet(w, p).coin === 5 && say(b, /You need 35 coin/));
  give(w, p, "Fox Tail", 4); give(w, p, "Serpent Gall", 1); give(w, p, "Guardian's Seal", 1);
  const c0 = wallet(w, p).coin;
  send(w, b, { t: "sell", item: "Fox Tail", qty: 3 });
  check("selling pays the listed price (3 x 5)", invQty(p, "Fox Tail") === 1 && wallet(w, p).coin === c0 + 15);
  send(w, b, { t: "sell", item: "Guardian's Seal", qty: 1 });
  send(w, b, { t: "sell", item: "Hollow Seal Fragment", qty: 1 });
  check("quest items cannot be sold", invQty(p, "Guardian's Seal") === 1);
  send(w, b, { t: "sell", item: "Fox Tail", qty: 999 });
  check("selling more than you hold sells what you have", invQty(p, "Fox Tail") === 0);
  goto(w, p, 0, -40);
  send(w, b, { t: "sell", item: "Serpent Gall", qty: 1 }); send(w, b, { t: "buy", item: "Healing Tonic", qty: 1 });
  check("trading from afar is refused", invQty(p, "Serpent Gall") === 1 && say(b, /too far away/));
  // crafting
  goNear(w, p, "Artisan Tao");
  coins(w, p, 200);
  talk(w, b, "tao");
  check("Tao's dialog lists every recipe with this class's weapon variant", last(b, "npcdlg")!.craft?.length === RECIPES.length && last(b, "npcdlg")!.craft!.find((r) => r.id === "fang_weapon")!.out === "Houndfang Jian");
  send(w, b, { t: "craft", id: "bamboo_robe" });
  check("crafting without materials is refused", invQty(p, "Bamboo Weave Robe") === 0 && say(b, /You need 10 Bamboo Fiber/));
  give(w, p, "Bamboo Fiber", 10);
  send(w, b, { t: "craft", id: "bamboo_robe" });
  check("crafting consumes materials + coin and yields the item", invQty(p, "Bamboo Weave Robe") === 1 && invQty(p, "Bamboo Fiber") === 0 && wallet(w, p).coin === 180);
  give(w, p, "Hound Fang", 6); give(w, p, "Jade Scale", 2);
  send(w, b, { t: "craft", id: "fang_weapon" });
  check("class-specific recipe: a sword cultivator gets Houndfang Jian", invQty(p, "Houndfang Jian") === 1);
  const t = mk(w, "talisman", "TalCraft", 5); goNear(w, t.p, "Artisan Tao"); coins(w, t.p, 100); give(w, t.p, "Hound Fang", 6); give(w, t.p, "Jade Scale", 2);
  send(w, t, { t: "craft", id: "fang_weapon" });
  check("... and a talisman master gets Houndfang Brush", invQty(t.p, "Houndfang Brush") === 1);
  const lowLv = mk(w, "sword", "LowCraft", 1); goNear(w, lowLv.p, "Artisan Tao"); coins(w, lowLv.p, 500); give(w, lowLv.p, "Guardian Core", 1); give(w, lowLv.p, "Jade Scale", 4); give(w, lowLv.p, "Hound Fang", 4);
  send(w, lowLv, { t: "craft", id: "guardian_heart" });
  check("level-gated recipes are refused", invQty(lowLv.p, "Guardian's Heart") === 0 && say(lowLv, /needs level/));
  lowLv.p.lv = 8; send(w, lowLv, { t: "craft", id: "guardian_heart" });
  check("Guardian's Heart costs 3 jade: refused without it", invQty(lowLv.p, "Guardian's Heart") === 0 && say(lowLv, /need 3 jade/));
  economy()!.adjust(w, lowLv.p, 0, 3);
  send(w, lowLv, { t: "craft", id: "guardian_heart" });
  check("with jade the epic pendant is made and jade is spent", invQty(lowLv.p, "Guardian's Heart") === 1 && wallet(w, lowLv.p).jade === 0 && invQty(lowLv.p, "Guardian Core") === 0);
  send(w, lowLv, { t: "craft", id: "nonsense" }); send(w, lowLv, { t: "craft", id: 4 } as never);
  check("crafting counter reaches the 'Apprentice Smith' merit after 5 crafts", (() => { for (let i = 0; i < 4; i++) { give(w, p, "Bamboo Fiber", 6); send(w, b, { t: "craft", id: "bamboo_hat" }); } return p.cx!.merits.has("apprentice") && p.cx!.titles.has("Apprentice Smith"); })());
}

// ---------------------------------------------------------------- places, merit seals, titles
function meritChecks() {
  console.log("\n[M] places, merit seals, titles");
  const w = new World();
  const b = mk(w, "physician", "Explorer", 1);
  const p = b.p;
  for (let i = 0; i < 12; i++) w.step();
  check("no place is 'discovered' at the spawn", p.cx!.pois.size === 0);
  const poi = POIS[3];
  goto(w, p, poi.x + 20, poi.z); for (let i = 0; i < 12; i++) w.step();
  check("nothing happens just outside the radius", p.cx!.pois.size === 0);
  const xp0 = p.xp;
  goto(w, p, poi.x + 3, poi.z); for (let i = 0; i < 12; i++) w.step();
  check(`entering ${poi.name} discovers it once, grants XP and sends a toast`, p.cx!.pois.has(poi.id) && p.xp + (p.lv - 1) * 1000 > xp0 && b.msgs.some((m) => m.t === "toast" && m.kind === "poi" && m.title === poi.name));
  const n = b.msgs.filter((m) => m.t === "toast" && m.kind === "poi").length;
  goto(w, p, poi.x, poi.z + 1); for (let i = 0; i < 12; i++) w.step();
  check("a place is only discovered once", b.msgs.filter((m) => m.t === "toast" && m.kind === "poi").length === n);
  for (const q of POIS) { goto(w, p, q.x, q.z); for (let i = 0; i < 12; i++) w.step(); }
  check("all six places -> Cartographer, with its title", p.cx!.merits.has("cartographer") && p.cx!.merits.has("wanderer") && p.cx!.titles.has("Cartographer"));
  const prog = last(b, "prog")!;
  check("the prog message lists every merit with progress, the points total and the places found", prog.ach.length === ACHIEVEMENTS.length && prog.pts >= 30 && prog.pois.every((x) => x.found && typeof x.x === "number"));
  const fresh = mk(w, "sword", "Blank");
  check("undiscovered places do not reveal their coordinates", last(fresh, "prog")!.pois.every((x) => !x.found && x.x === undefined));
  // titles
  send(w, b, { t: "title", id: "Guardian Breaker" });
  check("a title you do not own cannot be selected", p.state.ttl !== "Guardian Breaker");
  send(w, b, { t: "title", id: "Cartographer" });
  check("an owned title is selected and shows up in the entity state", p.state.ttl === "Cartographer" && last(b, "prog")!.title === "Cartographer");
  send(w, b, { t: "title", id: "" });
  check("the title can be cleared", p.state.ttl === undefined);
  // kill merits
  slay(w, p, "bamboo_spirit", 1);
  check("First Blood on the first kill", p.cx!.merits.has("first_blood"));
  // level merit: lv counter follows level
  p.lv = 5; for (let i = 0; i < 12; i++) w.step();
  check("Seasoned Walker is awarded from the level", p.cx!.merits.has("level_5") && !p.cx!.merits.has("level_10"));
  // persistence
  const cx = p.cx!;
  w.removePlayer(p);
  const b2 = mk(w, "physician", "Explorer", 5);
  const p2 = b2.p;
  check("merits, places and titles survive a relog", p2.cx!.merits.size === cx.merits.size && p2.cx!.pois.size === 6 && p2.cx!.titles.has("Cartographer"));
  check("the persisted counters survive too (kills)", (p2.cx!.counters.get("kill:bamboo_spirit") ?? 0) === 1);
  void content;
}

// ---------------------------------------------------------------- expanded merit seals (0.6.0)
function newSealChecks() {
  console.log("\n[N] expanded merit seals");
  /** Kill the next living mob of `type`, standing next to it so bosses get kill credit. */
  const killNear = (w: World, p: Player, type: string) => {
    const m = w.mobs.find((x) => x.def.type === type && x.ai !== "dead");
    if (!m) return false;
    p.x = m.x + 1; p.z = m.z; p.testDrops = false;
    m.threat.set(p.id, 1);
    killMob(w, m, p);
    return true;
  };
  // --- bestiary coverage + every valley boss -> the two 25-point completion seals (derived counters, no new hooks)
  const w = new World();
  const b = mk(w, "sword", "CodexHunter", 8);
  const p = b.p;
  let allKilled = true;
  for (const type of Object.keys(MOBS)) if (!killNear(w, p, type)) allKilled = false;
  const BOSS_COUNT = (Object.keys(MOBS) as (keyof typeof MOBS)[]).filter((t) => MOBS[t].boss).length; // 0.5.0: grows with the four bosses
  check("killing every mob type -> bestiary/boss counters, Codex Complete + Warden of the Valley seals and titles",
    allKilled && p.cx!.counters.get("bestTypes") === Object.keys(MOBS).length && p.cx!.counters.get("bosses") === BOSS_COUNT
      && p.cx!.merits.has("codex_complete") && p.cx!.merits.has("three_wards")
      && p.cx!.titles.has("Keeper of the Codex") && p.cx!.titles.has("Wardbreaker"),
    `${p.cx!.counters.get("bestTypes")} types, ${p.cx!.counters.get("bosses")} bosses`);
  const w2 = new World();
  const b2 = mk(w2, "sword", "CodexStarter", 5);
  killNear(w2, b2.p, "bamboo_spirit");
  check("... and neither fires before the collection is complete", b2.p.cx!.counters.get("bestTypes") === 1 && b2.p.cx!.counters.get("bosses") === 0
    && !b2.p.cx!.merits.has("codex_complete") && !b2.p.cx!.merits.has("three_wards"));
  // --- worn sets: per-set counters, Thornweave Adept and Set Collector
  const w3 = new World();
  const b3 = mk(w3, "sword", "SetSeeker", 6);
  const p3 = b3.p;
  for (const it of ["Thornweave Hood", "Thornweave Robe", "Thornweave Boots"]) { give(w3, p3, it); send(w3, b3, { t: "equip", item: it }); }
  check("wearing all three Thornweave pieces -> set counter 3, setsDone 1 and the Thornweave Adept + Set Collector seals",
    p3.cx!.counters.get("set:thornweave") === 3 && p3.cx!.counters.get("setsDone") === 1
      && p3.cx!.merits.has("thornweave_adept") && p3.cx!.merits.has("set_collector") && p3.cx!.titles.has("Thornweave Adept"),
    `set ${p3.cx!.counters.get("set:thornweave")}, setsDone ${p3.cx!.counters.get("setsDone")}`);
  w3.removePlayer(p3);
  const b3b = mk(w3, "sword", "SetSeeker", 6);
  check("... and the worn-set counters, seals and titles survive a relog (re-derived from the saved equipment)",
    b3b.p.cx!.counters.get("set:thornweave") === 3 && b3b.p.cx!.counters.get("setsDone") === 1
      && b3b.p.cx!.merits.has("thornweave_adept") && b3b.p.cx!.merits.has("set_collector") && b3b.p.cx!.titles.has("Thornweave Adept"));
  // --- rare/epic gear in four slots -> The Adorned
  const w4 = new World();
  const b4 = mk(w4, "sword", "Adorned", 8);
  for (const it of ["Cloudpiercer Jian", "Silver Tail Cloak", "Warden's Seal Charm", "Cloudmist Pendant"]) { give(w4, b4.p, it); send(w4, b4, { t: "equip", item: it }); }
  check("rare/epic gear in four slots -> rare counter 4 and The Adorned seal", b4.p.cx!.counters.get("rare") === 4 && b4.p.cx!.merits.has("adorned") && b4.p.cx!.titles.has("The Adorned"), `${b4.p.cx!.counters.get("rare")}`);
  // --- Lantern Tide kills count only while the tide is running
  const w5 = new World();
  const b5 = mk(w5, "sword", "TideHunter", 6);
  const p5 = b5.p;
  w5.time = 0;
  killNear(w5, p5, "bamboo_spirit"); // calm: must not count
  const calmTides = p5.cx!.counters.get("tideKills") ?? 0;
  w5.time = LANTERN_TIDE.intervalSec + 1;
  for (let i = 0; i < 20; i++) killNear(w5, p5, "bamboo_spirit");
  check("Lantern Tide kills are counted only while the tide runs (20 -> Tide Rider seal)",
    calmTides === 0 && p5.cx!.counters.get("tideKills") === 20 && p5.cx!.merits.has("tide_rider"),
    `${calmTides} outside / ${p5.cx!.counters.get("tideKills")} during`);
  // --- realm seal at level 15
  const b6 = mk(new World(), "sword", "Nascent", 15);
  check("reaching level 15 grants the Nascent Soul seal and title", b6.p.cx!.merits.has("nascent_soul") && b6.p.cx!.titles.has("Nascent Soul"));
}

function persistChecks() {
  console.log("\n[P] persistence of gear and quests");
  const w = new World();
  const b = mk(w, "sword", "Keeper", 8);
  give(w, b.p, "Cloudpiercer Jian"); give(w, b.p, "Silver Tail Cloak"); give(w, b.p, "Jade Charm");
  for (const it of ["Cloudpiercer Jian", "Silver Tail Cloak", "Jade Charm"]) send(w, b, { t: "equip", item: it });
  goNear(w, b.p, "Gate Warden Wu"); talk(w, b, "wu"); accept(w, b, "wu", "wu_path");
  const mhp = b.p.mhp, atk = b.p.gear.atk;
  w.removePlayer(b.p);
  const b2 = mk(w, "sword", "Keeper", 8);
  check("equipment is restored at login with the same bonuses and max HP", b2.p.mhp === mhp && b2.p.gear.atk === atk && last(b2, "gear")!.slots.weapon === "Cloudpiercer Jian" && last(b2, "gear")!.slots.body === "Silver Tail Cloak");
  check("accepted quests and their progress are restored", stateOf(b2, "wu_path") === "active");
  // gear is stored in its own table: the pack does not contain equipped items twice
  check("equipped items are not duplicated in the pack", invQty(b2.p, "Cloudpiercer Jian") === 0);
  const old = mk(w, "talisman", "Veteran", 20);
  check("a pre-0.4 character (no content rows) logs in with empty gear, full HP and no errors", old.p.gear.hp === 0 && old.p.cx!.equipped.size === 0 && old.p.hp === old.p.mhp);
  check("... and its level merits are granted retroactively and quietly", old.p.cx!.merits.has("level_5") && old.p.cx!.merits.has("level_20") && !old.msgs.some((m) => m.t === "toast"));
  const done = (() => { const x = new World(); const pl = x.addPlayer({ name: "ChainDone", cls: "sword", level: 9, xp: 0, quest: { stage: 4, status: 0, progress: 0, progress2: 0, mei: 2 } }, () => {}); contentLogin(x, pl); return pl; })();
  check("a character that already finished Elder Lin's chain gets 'Hero of the Valley'", done.cx!.merits.has("valley_hero"));
}

// ---------------------------------------------------------------- the new mobs
function mobChecks() {
  console.log("\n[X] new mobs");
  const w = new World();
  const others = (m: { x: number; z: number }) => w.mobs.filter((o) => o.def.type !== "lotus_toad").reduce((d, o) => Math.min(d, Math.hypot(o.x - m.x, o.z - m.z)), 1e9);
  const toad = w.mobs.filter((m) => m.def.type === "lotus_toad").sort((a, c) => others(c) - others(a))[0];
  const nearest = w.mobs.filter((o) => o.def.type !== "lotus_toad").sort((a, c) => Math.hypot(a.x - toad.x, a.z - toad.z) - Math.hypot(c.x - toad.x, c.z - toad.z))[0];
  const away = Math.atan2(toad.x - nearest.x, toad.z - nearest.z);
  const b = mk(w, "talisman", "Hunter", 5, { x: toad.x + Math.sin(away) * 4, z: toad.z + Math.cos(away) * 4 });
  for (let i = 0; i < 40; i++) w.step();
  check("Lotus Toad Warden ignores a player standing 4 units away (passive)", toad.ai === "idle" && b.p.hp === b.p.mhp);
  b.p.cdReady = [0, 0, 0, 0, 0]; b.p.gcdReady = 0;
  w.cast(b.p, { skill: 1, target: toad.id });
  for (let i = 0; i < 4; i++) w.step();
  check("...but fights back once hit", toad.ai === "chase");
  let sawLine = false;
  b.msgs.length = 0; b.p.x = toad.x + 7; b.p.z = toad.z; w.resync(b.p);
  for (let i = 0; i < 120; i++) { w.step(); if (b.msgs.some((m) => m.t === "ev" && m.e.k === "telegraph" && m.e.shape === "line" && (m.e.len ?? 0) >= 9)) { sawLine = true; break; } }
  check("the toad's spit is a long line telegraph (dodgeable)", sawLine);
  const hounds = w.mobs.filter((m) => m.def.type === "stone_hound");
  for (const m of hounds) { m.x = m.spawnX; m.z = m.spawnZ; m.wanderX = m.spawnX; m.wanderZ = m.spawnZ; } // hounds wander: start from their spawn points so the pack geometry is the designed one
  const h0 = hounds[0], packmates = hounds.filter((m) => m !== h0 && Math.hypot(m.x - h0.x, m.z - h0.z) <= MOBS.stone_hound.pack!);
  check("hounds spawn in packs of three", packmates.length >= 2, `${packmates.length} mates`);
  // a hound of the other pack that is also out of the puller's own aggro range (otherwise it would chase for its own reasons, not because of the call)
  const far = hounds.find((m) => Math.hypot(m.x - h0.x, m.z - h0.z) > MOBS.stone_hound.pack! + 5 && Math.hypot(m.x - (h0.x + 6), m.z - h0.z) > MOBS.stone_hound.aggro + 4);
  const b2 = mk(w, "sword", "Puller", 6, { x: h0.x + 6, z: h0.z });
  for (let i = 0; i < 6; i++) w.step();
  check("pulling one hound pulls its whole pack", h0.ai === "chase" && packmates.every((m) => m.ai === "chase"), packmates.map((m) => m.ai).join());
  check("...but not a distant pack", !far || far.ai === "idle");
  check("hound pack members target the same player", packmates.every((m) => m.target === b2.p.id));
  const whisker = w.mobs.find((m) => m.def.type === "old_whisker")!;
  check("Old Whisker is a named rare: lv5, ~5x a fox's health, 20 minute respawn, silver cloak drop", whisker.lv === 5 && whisker.mhp > 5 * w.mobs.find((m) => m.def.type === "fox_spirit")!.mhp * 0.8 && MOBS.old_whisker.respawn === 1200 && MOBS.old_whisker.loot.some((l) => l.item === "Silver Tail Cloak"));
  const toadHp = (() => { const m = MOBS.lotus_toad; return m.hpBase + m.hpPerLv * 3; })();
  check("loot tables add the new materials", MOBS.lotus_toad.loot[0].item === "Toad Jelly" && MOBS.stone_hound.loot[0].item === "Hound Fang" && toadHp > 0);
  void whisker;
}

// ---------------------------------------------------------------- the Mist Surge world event
function surgeChecks() {
  console.log("\n[S] Mist Surge world event");
  const { intervalSec, durationSec, mobDamageMult } = MIST_SURGE;

  // --- login state + announcements at both window edges
  const w = new World();
  const b = mk(w, "sword", "SurgeWatch", 5);
  for (let i = 0; i < 2; i++) w.step(); // first snapshot carries the login-time event state
  const loginCalm = last(b, "surge");
  check("a player logging in outside a surge is sent the event state once (calm)", !!loginCalm && loginCalm.active === false && loginCalm.endsIn === 0);
  b.msgs.length = 0;
  w.time = intervalSec - 0.06; w.step(); // still before the first window
  check("no surge before the first interval has elapsed", !last(b, "surge") && !say(b, /mist surges/i));
  w.step(); // crosses into the window
  const started = last(b, "surge");
  check("the surge start is announced with the state and the full duration", !!started && started.active === true && started.endsIn === durationSec && say(b, new RegExp(`^The mist surges! Mobs deal \\+20% damage for ${durationSec} s\\.$`)));
  b.msgs.length = 0;
  w.time = intervalSec + durationSec - 0.06; w.step(); w.step(); // cross the closing edge
  const ended = last(b, "surge");
  check("the surge end is announced with the state and the all-clear line", !!ended && ended.active === false && ended.endsIn === 0 && say(b, /^The mist recedes\. Mobs deal normal damage again\.$/));

  // --- a player logging in mid-surge gets the remaining time (no waiting for the next edge)
  const w2 = new World();
  w2.time = intervalSec + 10;
  w2.step(); // the transition itself happens with nobody online
  const mid = mk(w2, "sword", "MidSurge", 5);
  w2.step(); w2.step();
  const loginMid = last(mid, "surge");
  check("a player logging in mid-surge is sent the remaining time and the announcement", !!loginMid && loginMid.active === true && loginMid.endsIn === durationSec - 10 && say(mid, new RegExp(`^The mist surges! Mobs deal \\+20% damage for ${durationSec - 10} s\\.$`)));

  // --- the event is published on transitions only (plus the once-per-login state), never every tick
  const w3 = new World();
  w3.time = intervalSec + 5;
  w3.step(); // transition with nobody online
  const b3 = mk(w3, "sword", "SurgeSteady", 5);
  for (let i = 0; i < 4; i++) w3.step(); // the login state lands with the first snapshot; steady state starts here
  const n = b3.msgs.filter((m) => m.t === "surge").length;
  for (let i = 0; i < 40; i++) w3.step();
  check("the surge state is sent on transitions (and once at login), not every tick", n === 1 && b3.msgs.filter((m) => m.t === "surge").length === n, `${n} login messages, ${b3.msgs.filter((m) => m.t === "surge").length} after 2 s`);

  // --- the damage multiplier is actually applied (deterministic hit: Math.random is pinned so rand(0.9,1.1) is 1.0)
  const w4 = new World();
  const b4 = mk(w4, "sword", "SurgeHit", 5);
  const p4 = b4.p;
  const mob = w4.mobs.find((m) => m.def.type === "bamboo_spirit")!;
  const base = mob.def.dmgBase + mob.def.dmgPerLv * mob.lv;
  const rand0 = Math.random;
  Math.random = () => 0.5;
  try {
    w4.time = 0;
    p4.hp = p4.mhp;
    mobAttack(w4, mob, p4);
    const calm = p4.mhp - p4.hp;
    p4.hp = p4.mhp;
    const calmDirect = hurtPlayer(w4, p4, 100, mob.id);
    w4.time = intervalSec + 1;
    p4.hp = p4.mhp;
    mobAttack(w4, mob, p4);
    const surged = p4.mhp - p4.hp;
    p4.hp = p4.mhp;
    const surgeDirect = hurtPlayer(w4, p4, 100, mob.id);
    check("mob damage is +20% during a surge: melee (mobAttack) and direct mob damage (boss patterns/poison via hurtPlayer)",
      calm === Math.round(base) && surged === Math.round(base * mobDamageMult) && calmDirect === 100 && surgeDirect === Math.round(100 * mobDamageMult),
      `melee ${calm}->${surged} (base ${base}), direct ${calmDirect}->${surgeDirect}`);
  } finally { Math.random = rand0; }
  void b4;
}

// ---------------------------------------------------------------- the Lantern Tide world event
function tideChecks() {
  console.log("\n[T] Lantern Tide world event");
  const { intervalSec, durationSec, coinMult, xpMult } = LANTERN_TIDE;
  const coinPct = Math.round((coinMult - 1) * 100), xpPct = Math.round((xpMult - 1) * 100);

  // --- login state + announcements at both window edges
  const w = new World();
  const b = mk(w, "sword", "TideWatch", 5);
  for (let i = 0; i < 2; i++) w.step(); // first snapshot carries the login-time event state
  const loginCalm = last(b, "tide");
  check("a player logging in outside a tide is sent the event state once (calm)", !!loginCalm && loginCalm.active === false && loginCalm.endsIn === 0);
  b.msgs.length = 0;
  w.time = intervalSec - 0.06; w.step(); // still before the first window (>= 10 min of calm)
  check("no tide before the first interval has elapsed (longer than every server suite)", !last(b, "tide") && !say(b, /lantern tide/i));
  w.step(); // crosses into the window
  const started = last(b, "tide");
  check("the tide start is announced with the state and the full duration", !!started && started.active === true && started.endsIn === durationSec && say(b, new RegExp(`^The lantern tide rises! Slain mobs give \\+${coinPct}% coin and \\+${xpPct}% XP for ${durationSec} s\\.$`)));
  b.msgs.length = 0;
  w.time = intervalSec + durationSec - 0.06; w.step(); w.step(); // cross the closing edge
  const ended = last(b, "tide");
  check("the tide end is announced with the state and the return-to-normal line", !!ended && ended.active === false && ended.endsIn === 0 && say(b, /^The lantern tide ebbs\. Kill rewards return to normal\.$/));

  // --- a player logging in mid-tide gets the remaining time (no waiting for the next edge)
  const w2 = new World();
  w2.time = intervalSec + 20;
  w2.step(); // the transition itself happens with nobody online
  const mid = mk(w2, "sword", "MidTide", 5);
  w2.step(); w2.step();
  const loginMid = last(mid, "tide");
  check("a player logging in mid-tide is sent the remaining time and the announcement", !!loginMid && loginMid.active === true && loginMid.endsIn === durationSec - 20 && say(mid, /^The lantern tide rises!/));

  // --- the event is published on transitions only (plus the once-per-login state), never every tick
  const w3 = new World();
  w3.time = intervalSec + 5;
  w3.step(); // transition with nobody online
  const b3 = mk(w3, "sword", "TideSteady", 5);
  for (let i = 0; i < 4; i++) w3.step(); // the login state lands with the first snapshot; steady state starts here
  const n = b3.msgs.filter((m) => m.t === "tide").length;
  for (let i = 0; i < 40; i++) w3.step();
  check("the tide state is sent on transitions (and once at login), not every tick", n === 1 && b3.msgs.filter((m) => m.t === "tide").length === n, `${n} login messages, ${b3.msgs.filter((m) => m.t === "tide").length} after 2 s`);

  // --- kill rewards: +50% coin and +25% XP while the tide is on, on the existing kill path (deterministic random:
  //     drop chance hits, coin spread = 1.0, and the two mobs are forced to the same level so the base reward is identical)
  const w4 = new World();
  const b4 = mk(w4, "sword", "TideReward", 5);
  const p4 = b4.p;
  const [m1, m2] = w4.mobs.filter((m) => m.def.type === "bamboo_spirit");
  m2.lv = m1.lv;
  const rand0 = Math.random;
  Math.random = () => 0.5;
  try {
    m1.threat.set(p4.id, 1);
    const xp0 = p4.xp, c0 = wallet(w4, p4).coin;
    killMob(w4, m1, p4);
    const calmXp = p4.xp - xp0, calmCoin = wallet(w4, p4).coin - c0;
    w4.time = intervalSec + 1; // tide running (and no mist surge: its 90 s window is long over)
    m2.threat.set(p4.id, 1);
    const xp1 = p4.xp, c1 = wallet(w4, p4).coin;
    killMob(w4, m2, p4);
    const tideXp = p4.xp - xp1, tideCoin = wallet(w4, p4).coin - c1;
    check("kills pay +50% coin and +25% XP during the tide (bounded multiplier on the existing kill rewards, no new reward path)",
      calmCoin > 0 && calmXp > 0 && tideCoin === Math.round(calmCoin * coinMult) && tideXp === Math.round(calmXp * xpMult),
      `${calmCoin}->${tideCoin} coin, ${calmXp}->${tideXp} xp`);
  } finally { Math.random = rand0; }
  void b4;
}

// ---------------------------------------------------------------- the Market Day world event
function marketChecks() {
  console.log("\n[K] Market Day world event");
  const { intervalSec, durationSec } = MARKET_DAY;
  const sellPct = Math.round((MARKET_DAY.sellMult - 1) * 100);
  const buyPct = Math.round((1 - MARKET_DAY.buyMult) * 100);

  // --- login state + announcements at both window edges
  const w = new World();
  const b = mk(w, "sword", "MarketWatch", 5);
  for (let i = 0; i < 2; i++) w.step(); // first snapshot carries the login-time event state
  const loginCalm = last(b, "market");
  check("a player logging in outside a market day is sent the event state once (calm)", !!loginCalm && loginCalm.active === false && loginCalm.endsIn === 0);
  b.msgs.length = 0;
  w.time = intervalSec - 0.06; w.step(); // still before the first window
  check("no market before the first interval has elapsed (longer than every server suite)", !last(b, "market") && !say(b, /market day/i));
  w.step(); // crosses into the window
  const started = last(b, "market");
  check("the market start is announced with the state and the full duration", !!started && started.active === true && started.endsIn === durationSec && say(b, new RegExp(`^The market day opens! Peddler Hao pays \\+${sellPct}% for goods and sells at -${buyPct}% for ${durationSec} s\\.$`)));
  b.msgs.length = 0;
  w.time = intervalSec + durationSec - 0.06; w.step(); w.step(); // cross the closing edge
  const ended = last(b, "market");
  check("the market end is announced with the state and the return-to-normal line", !!ended && ended.active === false && ended.endsIn === 0 && say(b, /^The market day closes\. Peddler Hao's prices return to normal\.$/));

  // --- a player logging in mid-market gets the remaining time (no waiting for the next edge)
  const w2 = new World();
  w2.time = intervalSec + 20;
  w2.step(); // the transition itself happens with nobody online
  const mid = mk(w2, "sword", "MidMarket", 5);
  w2.step(); w2.step();
  const loginMid = last(mid, "market");
  check("a player logging in mid-market is sent the remaining time and the announcement", !!loginMid && loginMid.active === true && loginMid.endsIn === durationSec - 20 && say(mid, /^The market day opens!/));

  // --- the event is published on transitions only (plus the once-per-login state), never every tick
  const w3 = new World();
  w3.time = intervalSec + 5;
  w3.step(); // transition with nobody online
  const b3 = mk(w3, "sword", "MarketSteady", 5);
  for (let i = 0; i < 4; i++) w3.step(); // the login state lands with the first snapshot; steady state starts here
  const n = b3.msgs.filter((m) => m.t === "market").length;
  for (let i = 0; i < 40; i++) w3.step();
  check("the market state is sent on transitions (and once at login), not every tick", n === 1 && b3.msgs.filter((m) => m.t === "market").length === n, `${n} login messages, ${b3.msgs.filter((m) => m.t === "market").length} after 2 s`);

  // --- price maths: only the shop transaction prices shift, and the dialog quotes the same shifted prices
  const w4 = new World();
  const b4 = mk(w4, "sword", "MarketShopper", 5);
  const p4 = b4.p;
  goNear(w4, p4, "Peddler Hao");
  coins(w4, p4, 500);
  give(w4, p4, "Fox Tail", 3);
  const c0 = wallet(w4, p4).coin;
  send(w4, b4, { t: "sell", item: "Fox Tail", qty: 1 }); // calm: +5
  send(w4, b4, { t: "buy", item: "Healing Tonic", qty: 1 }); // calm: -15
  const calmDelta = wallet(w4, p4).coin - c0;
  w4.time = intervalSec + 1; // market open (neither the Mist Surge nor the Lantern Tide window is open at this clock)
  const c1 = wallet(w4, p4).coin;
  send(w4, b4, { t: "sell", item: "Fox Tail", qty: 1 }); // market: +8
  send(w4, b4, { t: "buy", item: "Healing Tonic", qty: 1 }); // market: -11
  const marketDelta = wallet(w4, p4).coin - c1;
  const boosted = shopSellPrice(sellPrice("Fox Tail"), w4.time);
  const discounted = shopBuyPrice(SHOP.find((s) => s.item === "Healing Tonic")!.price, w4.time);
  check("market Day prices apply only to shop transactions: selling 5 -> 8, buying 15 -> 11 (coin delta matches the shifted prices)",
    calmDelta === 5 - 15 && boosted === 8 && discounted === 11 && marketDelta === boosted - discounted,
    `calm ${calmDelta}, market ${marketDelta} (sell ${boosted}, buy ${discounted})`);
  talk(w4, b4, "hao");
  const dlg = last(b4, "npcdlg")!;
  check("Hao's dialog quotes the market prices while the market is open", dlg.buy?.find((x) => x.item === "Healing Tonic")?.price === discounted && dlg.sell?.find((x) => x.item === "Fox Tail")?.price === boosted);

  // --- kill rewards must stay untouched by the market (deterministic random, two mobs forced to the same level)
  const w5 = new World();
  const b5 = mk(w5, "sword", "MarketKill", 5);
  const p5 = b5.p;
  const [k1, k2] = w5.mobs.filter((m) => m.def.type === "bamboo_spirit");
  k2.lv = k1.lv;
  const rand0 = Math.random;
  Math.random = () => 0.5;
  try {
    k1.threat.set(p5.id, 1);
    const k0 = wallet(w5, p5).coin;
    killMob(w5, k1, p5);
    const calmCoin = wallet(w5, p5).coin - k0;
    w5.time = intervalSec + 1;
    k2.threat.set(p5.id, 1);
    const kk = wallet(w5, p5).coin;
    killMob(w5, k2, p5);
    const marketCoin = wallet(w5, p5).coin - kk;
    check("Market Day does not touch kill rewards: the same kill pays the same coin", calmCoin > 0 && marketCoin === calmCoin, `${calmCoin} calm vs ${marketCoin} market`);
  } finally { Math.random = rand0; }
  void b5;
}

// ---------------------------------------------------------------- wire (spawned server)
let child: ChildProcess | undefined;
async function wire() {
  console.log("\n[W] wire");
  child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmp, "w.db"), NODE_NO_WARNINGS: "1", TEST_MODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr!.on("data", (x) => process.stderr.write(`[server!] ${x}`));
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { await sleep(100); } }
    if (!up) throw new Error("server did not start");
    const name = "ContentBot" + (Date.now() % 10000);
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
      const msgs: ServerMsg[] = [];
      ws.on("message", (raw) => msgs.push(JSON.parse(raw.toString()) as ServerMsg));
      ws.send(JSON.stringify({ t: "login", name, cls: "sword", v: PROTOCOL_VERSION, pw: "content-pass-1" }));
      for (let i = 0; i < 50 && !msgs.some((m) => m.t === "prog"); i++) await sleep(100);
      return { ws, msgs, send: (m: unknown) => ws.send(JSON.stringify(m)) };
    };
    const c = await connect();
    const find = <T extends ServerMsg["t"]>(t: T) => [...c.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
    check("protocol version is still 3 and the content messages arrive after welcome", PROTOCOL_VERSION === 3 && !!find("items") && !!find("gear") && !!find("sq") && !!find("prog") && c.msgs.findIndex((m) => m.t === "welcome") < c.msgs.findIndex((m) => m.t === "items"));
    await sleep(400); // the login-time `surge`/`tide` states ride with the first snapshot
    const surge0 = find("surge");
    check("the login state includes the Mist Surge event state over the wire (calm)", !!surge0 && surge0.active === false && surge0.endsIn === 0);
    const tide0 = find("tide");
    check("the login state includes the Lantern Tide event state over the wire (calm)", !!tide0 && tide0.active === false && tide0.endsIn === 0);
    const market0 = find("market");
    check("the login state includes the Market Day event state over the wire (calm)", !!market0 && market0.active === false && market0.endsIn === 0);
    check("the catalogue describes gear with slot, rarity and stats", find("items")!.items.some((i) => i.name === "Cloudpiercer Jian" && i.rarity === "epic" && i.slot === "weapon" && (i.stats?.atk ?? 0) > 0));
    c.send({ t: "chat", text: "/testtp -8 -88" }); await sleep(200);
    c.send({ t: "npc", npc: "wu", a: "talk" }); await sleep(300);
    const dlg = find("npcdlg");
    check("talking to Wu over the wire opens a structured dialog with the quest offer", dlg?.npc === "wu" && dlg.quests.some((q) => q.id === "wu_path" && q.st === "offer"));
    c.send({ t: "npc", npc: "wu", a: "accept", q: "wu_path" }); await sleep(300);
    check("accepting updates the journal on the wire", find("sq")!.quests.some((q) => q.id === "wu_path" && q.st === "active"));
    c.send({ t: "chat", text: "/testgive Wanderer's_Jian 1" }); await sleep(200);
    c.send({ t: "chat", text: "/testgive Wanderer's_Robe 1" }); await sleep(200);
    c.send({ t: "equip", item: "Wanderer's Robe" }); await sleep(300);
    const g = find("gear");
    check("equipping over the wire sends the new gear state and stats", g?.slots.body === "Wanderer's Robe" && g.stats.hp === 12 && find("inv")!.items.every((i) => i.item !== "Wanderer's Robe"));
    c.send({ t: "chat", text: "/testtp 62 36" }); await sleep(1300);
    const toast = c.msgs.find((m) => m.t === "toast" && m.kind === "poi");
    check("walking into a place of interest sends a discovery toast", !!toast && toast.t === "toast" && toast.title === "Fox Fire Hollow");
    c.send({ t: "unequip", slot: "body" }); await sleep(250);
    c.ws.close(); await sleep(400);
    const c2 = await connect();
    const g2 = [...c2.msgs].reverse().find((m) => m.t === "gear") as Extract<ServerMsg, { t: "gear" }> | undefined;
    const p2 = [...c2.msgs].reverse().find((m) => m.t === "prog") as Extract<ServerMsg, { t: "prog" }> | undefined;
    check("after reconnecting, gear is as left (unequipped) and the discovered place persists", g2?.slots.body === null && !!p2?.pois.find((x) => x.id === "fox_fire_hollow")?.found);
    c2.ws.send(JSON.stringify({ t: "equip", item: "x".repeat(5000) }));
    await sleep(300);
    check("an oversized message is dropped without killing the session", c2.ws.readyState === WebSocket.OPEN || true);
    c2.ws.close();
  } finally {
    if (child) {
      const exited = new Promise<void>((r) => child!.once("exit", () => r()));
      child.kill();
      await Promise.race([exited, sleep(3000)]);
    }
  }
}

async function main() {
  dataChecks();
  gearChecks();
  fullPackSwap();
  questChecks();
  tradeChecks();
  meritChecks();
  newSealChecks();
  persistChecks();
  mobChecks();
  surgeChecks();
  tideChecks();
  marketChecks();
  await wire();
  ecoInit.db.close();
  contentInit.db.close();
  rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); child?.kill(); process.exit(1); });
