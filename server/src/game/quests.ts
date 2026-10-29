// Elder Lin quest chain. All dialog travels as `chat` events with sys:true (no protocol changes).
import { FEN_NPC, MEI_NPC, MEI_QUEST, NPCS, QUESTS, QUEST_ALL_DONE, QUEST_HINT_RANGE, QUEST_NPC, QUEST_TALK_RANGE } from "../data.ts";
import { grantXp } from "./combat.ts";
import { ecoBoard, ecoChainComplete, ecoTalk } from "../economy.ts";
import { addItem, invQty, removeItem } from "./inventory.ts";
import type { Player } from "./types.ts";
import type { World } from "./world.ts";
import { dist } from "./util.ts";

const elder = NPCS.find((n) => n.name.includes(QUEST_NPC))!;
const mei = NPCS.find((n) => n.name.includes(MEI_NPC))!;
const fen = NPCS.find((n) => n.name === FEN_NPC)!;
const fenSay = (w: World, p: Player, text: string) => w.sysTo(p, `${FEN_NPC}: ${text}`);
const say = (w: World, p: Player, text: string) => w.sysTo(p, `Elder Lin: ${text}`);
const meiSay = (w: World, p: Player, text: string) => w.sysTo(p, `Lantern Keeper Mei: ${text}`);
const meiTask = (p: Player) => `${MEI_QUEST.title}: ${Math.min(invQty(p, MEI_QUEST.item), MEI_QUEST.count)}/${MEI_QUEST.count} ${MEI_QUEST.item}`;

/** Mei's errand. Lines: `Task accepted: ...`, `Task: ...` (progress), `Task complete: ... (+N XP)`; speech is `Lantern Keeper Mei: ...`.
 *  They deliberately avoid the `[Quest n/N]` / `Quest ...:` formats so the clients' tracker for Elder Lin's chain ignores them. */
function talkMei(w: World, p: Player) {
  const m = MEI_QUEST, q = p.quest;
  ecoTalk(w, p, "mei"); // counts for the "Speak to Lantern Keeper Mei" daily whatever the errand state
  if (q.mei === 2) return meiSay(w, p, m.already);
  if (q.mei === 0) {
    q.mei = 1; save(w, p);
    meiSay(w, p, m.intro);
    return info(w, p, `Task accepted: ${meiTask(p)}`);
  }
  if (invQty(p, m.item) < m.count) {
    meiSay(w, p, m.reminder);
    return info(w, p, `Task: ${meiTask(p)}`);
  }
  meiSay(w, p, m.done);
  info(w, p, `Task complete: ${m.title}  (+${m.rewardXp} XP)`);
  removeItem(w, p, m.item, m.count);
  for (const r of m.rewardItems) {
    const n = addItem(w, p, r.item, "", r.qty);
    if (n > 0) w.emitTo(p, { k: "loot", item: r.item, itemZh: "", qty: n });
    else info(w, p, `Your pack is full; ${r.item} was lost.`);
  }
  q.mei = 2; save(w, p);
  grantXp(w, p, m.rewardXp);
}
/** Notice Board Keeper Fen: one greeting line, then the daily board (same lines as /daily). Claiming is `{t:"claim"}` from the client. */
function talkFen(w: World, p: Player) {
  ecoTalk(w, p, "fen");
  fenSay(w, p, "Fresh notices go up at midnight, UTC. Finish a task, then claim your reward at the board.");
  ecoBoard(w, p);
}
const info = (w: World, p: Player, text: string) => w.sysTo(p, text);
const save = (w: World, p: Player) => w.onQuestChange?.(p);

const GOAL_LABEL: Record<string, string> = { jade_serpent: "Jade Serpents", "Jade Scale": "Jade Scales" };

/** `[Quest N/T] Title: cur/max`. Two-objective quests show the combined count, then a parenthesised breakdown
 *  (the tail never contains the word "complete" until the objective is done, so clients keep treating it as in progress). */
export function progressLine(p: Player) {
  const q = QUESTS[p.quest.stage];
  const a = Math.min(p.quest.progress, q.goal.count);
  const head = `[Quest ${p.quest.stage + 1}/${QUESTS.length}] ${q.title}: `;
  if (!q.goal2) return `${head}${a}/${q.goal.count}`;
  const b = Math.min(p.quest.progress2, q.goal2.count);
  return `${head}${a + b}/${q.goal.count + q.goal2.count} (${GOAL_LABEL[String(q.goal.target)] ?? q.goal.target} ${a}/${q.goal.count}, ${GOAL_LABEL[q.goal2.target] ?? q.goal2.target} ${b}/${q.goal2.count})`;
}
const objectiveDone = (p: Player) => {
  const q = QUESTS[p.quest.stage];
  return p.quest.progress >= q.goal.count && (!q.goal2 || p.quest.progress2 >= q.goal2.count);
};

function accept(w: World, p: Player) {
  const q = QUESTS[p.quest.stage];
  p.quest.status = 1; p.quest.progress = 0; p.quest.progress2 = 0;
  say(w, p, q.intro);
  info(w, p, `Quest accepted: ${progressLine(p)}`);
  save(w, p);
}

/** Handle `/talk` and `/quest`. Returns true if the text was a command (and so must not be broadcast). */
export function handleCommand(w: World, p: Player, text: string): boolean {
  const cmd = text.trim().toLowerCase();
  if (cmd[0] !== "/") return false;
  if (cmd === "/daily" || cmd === "/dailies") { if (!ecoBoard(w, p)) info(w, p, "The notice board is closed."); return true; }
  if (cmd === "/quest" || cmd === "/quests") {
    if (p.quest.stage >= QUESTS.length) info(w, p, "All of Elder Lin's quests are complete.");
    else if (p.quest.status === 0) info(w, p, "No active quest. Speak to Elder Lin at the plaza and type /talk.");
    else info(w, p, p.quest.status === 2 ? `${progressLine(p)} - complete! Return to Elder Lin and type /talk.` : progressLine(p));
    if (p.quest.mei === 1) info(w, p, `Task: ${meiTask(p)} - bring it to Lantern Keeper Mei.`);
    return true;
  }
  const [verb, who] = cmd.split(/\s+/);
  if (verb !== "/talk" || (who && who !== "mei" && who !== "elder" && who !== "fen")) { info(w, p, "Commands: /talk (speak to a nearby NPC; /talk mei, /talk elder or /talk fen to pick one), /quest (show quest progress), /daily (show the daily tasks)."); return true; }
  if (p.st === "dead") { info(w, p, "You cannot speak while defeated. Wait to be revived."); return true; }
  const dMei = dist(p.x, p.z, mei.x, mei.z), dFen = dist(p.x, p.z, fen.x, fen.z);
  const inElder = dist(p.x, p.z, elder.x, elder.z) <= QUEST_TALK_RANGE, inMei = dMei <= QUEST_TALK_RANGE, inFen = dFen <= QUEST_TALK_RANGE;
  if (who === "mei" ? !inMei : who === "elder" ? !inElder : who === "fen" ? !inFen : !inElder && !inMei && !inFen) {
    info(w, p, who === "mei" ? "Lantern Keeper Mei is too far away. She tends the lanterns beside the plaza."
      : who === "fen" ? "Notice Board Keeper Fen is too far away. The notice board stands in the plaza near the spawn point."
      : "No one is close enough to talk to. Elder Lin, Lantern Keeper Mei and Notice Board Keeper Fen stand in the plaza near the spawn point.");
    return true;
  }
  // a bare `/talk` goes to Elder Lin when she is in reach (the main chain), else to the nearer of Mei and Fen; clients name the NPC they are speaking to
  if (who === "fen" || (!who && !inElder && inFen && (!inMei || dFen < dMei))) { talkFen(w, p); return true; }
  if (who === "mei" || (!who && !inElder)) { talkMei(w, p); return true; }
  ecoTalk(w, p, "elder"); // 0.4.0: counts for "Walk the Path" and the Know Your Neighbours merit
  const q = p.quest;
  if (q.stage >= QUESTS.length) { say(w, p, QUEST_ALL_DONE); return true; }
  const def = QUESTS[q.stage];
  if (q.status === 0) accept(w, p);
  else if (q.status === 1) { say(w, p, def.reminder); info(w, p, progressLine(p)); }
  else {
    say(w, p, def.done);
    info(w, p, `Quest complete: ${def.title}  (+${def.rewardXp} XP)`);
    for (const c of def.consume ?? []) removeItem(w, p, c.item, c.qty);
    for (const r of def.rewardItems ?? []) {
      const n = addItem(w, p, r.item, "", r.qty);
      if (n > 0) w.emitTo(p, { k: "loot", item: r.item, itemZh: "", qty: n });
      else info(w, p, `Your pack is full; ${r.item} was lost.`);
    }
    q.stage++; q.status = 0; q.progress = 0; q.progress2 = 0;
    save(w, p);
    grantXp(w, p, def.rewardXp);
    if (q.stage < QUESTS.length) accept(w, p);
    else { say(w, p, QUEST_ALL_DONE); ecoChainComplete(w, p); }
  }
  return true;
}

function bump(w: World, p: Player, kind: "kill" | "loot", target: string, qty: number) {
  const q = p.quest;
  if (q.stage >= QUESTS.length || q.status !== 1) return;
  const def = QUESTS[q.stage];
  if (def.goal.kind === kind && def.goal.target === target) q.progress = Math.min(def.goal.count, q.progress + qty);
  else if (def.goal2 && def.goal2.kind === kind && def.goal2.target === target) q.progress2 = Math.min(def.goal2.count, q.progress2 + qty);
  else return;
  if (objectiveDone(p)) {
    q.status = 2;
    info(w, p, `${progressLine(p)} - objective complete! Return to Elder Lin and type /talk.`);
  } else info(w, p, progressLine(p));
  save(w, p);
}
export const questOnKill = (w: World, p: Player, mobType: string) => bump(w, p, "kill", mobType, 1);
export const questOnLoot = (w: World, p: Player, item: string, qty: number) => bump(w, p, "loot", item, qty);

/** Called periodically: one-time hint when a player walks up to Elder Lin. */
export function questProximity(w: World, p: Player) {
  const d = dist(p.x, p.z, elder.x, elder.z);
  if (d <= QUEST_HINT_RANGE) {
    if (!p.nearElder) {
      p.nearElder = true;
      if (p.quest.stage < QUESTS.length && p.quest.status !== 1)
        say(w, p, p.quest.status === 2 ? "You have done it! Come, type /talk." : "Greetings, traveller. Type /talk to speak with me.");
    }
  } else if (d > QUEST_TALK_RANGE) p.nearElder = false;
}
