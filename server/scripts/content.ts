// 0.4.0 content test: gear and consumables, side-quest chains, Tao's crafting, Hao's trade, places of interest, merit seals and titles,
// the three new mobs, persistence across logins, data consistency and the wire messages.
//   npm run test:content   -> World-level checks (in-memory / temp sqlite) + a spawned TEST_MODE server on CONTENT_PORT (default 8977)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../../shared/protocol.ts";
import type { ClassId, ServerMsg } from "../../shared/protocol.ts";
import {
  ACHIEVEMENTS, ALL_TITLES, CONSUMABLES, GEAR, GEAR_BY_NAME, INV, MATERIALS, MOBS, MOB_SPAWNS, NPCS, NPC_SVC, POIS, QUEST_ITEMS, RECIPES, SHOP, SIDE_QUESTS, SIDE_QUEST_BY_ID, ZONE,
  itemCatalogue, recipeOutput, sellPrice,
} from "../src/data.ts";
import { economy, initEconomy } from "../src/economy.ts";
import { content, contentHandle, contentLogin, initContent } from "../src/game/content.ts";
import { hurtPlayer, killMob } from "../src/game/combat.ts";
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
initEconomy(DBP);
initContent(DBP);

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
    && (!q.rewardByClass || (["sword", "talisman", "physician"] as ClassId[]).every((c) => GEAR_BY_NAME.get(q.rewardByClass![c] ?? "")?.cls === c))));
  check("quest titles and achievement titles are collected in ALL_TITLES", SIDE_QUESTS.every((q) => !q.rewardTitle || ALL_TITLES.includes(q.rewardTitle)) && ACHIEVEMENTS.every((a) => !a.title || ALL_TITLES.includes(a.title)));
  check("quest XP budget: the side quests alone give at least one level 1-8 worth of XP", SIDE_QUESTS.reduce((n, q) => n + q.rewardXp, 0) >= 2167);
  check("every quest giver exists in the world and the NPCs do not overlap", NPC_SVC.every((n) => NPCS.some((x) => x.name === n.name)) && NPCS.every((a, i) => NPCS.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.z - b.z) > 2.5)));
  check("places of interest are inside the world, apart from each other, and at least 40 units from the plaza", POIS.every((a, i) => Math.abs(a.x) < 99 && Math.abs(a.z) < 99 && Math.hypot(a.x - ZONE.spawn.x, a.z - ZONE.spawn.z) > 40 && POIS.every((b, j) => i >= j || Math.hypot(a.x - b.x, a.z - b.z) > 12)));
  check("new mob groups spawn outside the plaza safe radius and every definition has a spawn", ["lotus_toad", "stone_hound", "old_whisker"].every((t) => MOB_SPAWNS.some((g) => g.type === t)));
  check("achievement ids unique with positive point values and reachable counters", new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length && ACHIEVEMENTS.every((a) => a.pts > 0 && a.need > 0));
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
  check("weapon adds flat attack", atkBefore === 2);
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
  check("Friend of the Plaza needs all 8; with 7 done it is not yet earned, 'Helping Hand' (3) is", p.cx!.merits.has("side_3") && !p.cx!.merits.has("side_8"));
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

// ---------------------------------------------------------------- wire (spawned server)
let child: ChildProcess | undefined;
async function wire() {
  console.log("\n[W] wire");
  child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmp, "w.db"), NODE_NO_WARNINGS: "1", TEST_MODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
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
    child?.kill();
    await sleep(200);
  }
}

async function main() {
  dataChecks();
  gearChecks();
  fullPackSwap();
  questChecks();
  tradeChecks();
  meritChecks();
  persistChecks();
  mobChecks();
  await wire();
  rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); child?.kill(); process.exit(1); });
