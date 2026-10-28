// Economy / progression test: XP curve + level cap, wallet (coin/jade), daily board, Notice Board Keeper Fen.
//   npm run test:economy            -> unit checks (no server) + a spawned TEST_MODE server on ECO_PORT (default 8974) with a temp DB
//   ECO_DB=/tmp/s2.db ECO_PORT=8802 npm run test:economy   -> pick the port / database file
// The unit part injects a fake clock into Economy (UTC rollover). The server part moves the server clock with the TEST_MODE hook `/testclock`.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../../shared/protocol.ts";
import type { ClassId, DailyTask, EntityState, GameEvent, ServerMsg } from "../../shared/protocol.ts";
import { CLASSES, COIN, DAILY_COUNT, DAILY_POOL, JADE, MAX_LEVEL, MOBS, NPCS, QUESTS, attackFor, killXp, maxHpFor, normalizeProgress, xpLevelMult, xpToNext } from "../src/data.ts";
import { CharacterDb } from "../src/db.ts";
import { Economy, EconomyDb, dailyIdsFor, dayKey, fmtReset, secondsToReset } from "../src/economy.ts";
import { World } from "../src/game/world.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.ECO_PORT) || 8974;
const URL = `ws://127.0.0.1:${PORT}`;
const SUFFIX = String(Date.now() % 100000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}
async function until(cond: () => boolean, ms: number, step = 50) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(step); }
  return cond();
}
const DEF = new Map(DAILY_POOL.map((d) => [d.id, d] as const));

// =====================================================================================================
// U. unit checks (no network)
// =====================================================================================================
function unitCurve() {
  console.log("\n[U1] XP curve, level cap, stat scaling");
  check("level cap constant is 20", MAX_LEVEL === 20);
  const steps = Array.from({ length: 19 }, (_, i) => xpToNext(i + 1));
  check("xpToNext = round(30 * lv^1.6): 30, 91, 174, 394, 836, 1194, 3335", [1, 2, 3, 5, 8, 10, 19].map(xpToNext).join(",") === "30,91,174,394,836,1194,3335", [1, 2, 3, 5, 8, 10, 19].map(xpToNext).join(","));
  check("curve is smooth: strictly increasing, each step 3-40 % above the last", steps.every((v, i) => i === 0 || (v > steps[i - 1] && v / steps[i - 1] < 3.1 && v / steps[i - 1] > 1.03)) && steps.slice(5).every((v, i) => v / steps[i + 4] < 1.4), steps.join(","));
  const cum = (to: number) => { let s = 0; for (let l = 1; l < to; l++) s += xpToNext(l); return s; };
  check("total XP to lv8 = 2167, to the cap = 26063", cum(8) === 2167 && cum(20) === 26063, `${cum(8)} / ${cum(20)}`);
  // pacing model: one kill cycle (fight + walk + rest) ~36 s, best same-level mob, +quest XP. Documented in data.ts; asserted loosely.
  const mobXp = (lv: number) => 11 * lv * 1.1;
  const minsTo = (target: number, extra: number) => { let xp = extra, kills = 0; for (let l = 1; l < target; l++) while (xp < cumTo(l + 1)) { xp += mobXp(l); kills++; } return (kills * 36) / 60; };
  const cumTo = (to: number) => cum(to);
  const m8 = minsTo(8, 850), m20 = minsTo(20, 850);
  check("pacing model: lv8 in ~10-16 min, cap in ~70-110 min", m8 >= 10 && m8 <= 16 && m20 >= 70 && m20 <= 110, `${m8.toFixed(1)} min / ${m20.toFixed(0)} min`);
  const n = normalizeProgress;
  const eq = (a: { lv: number; xp: number }, lv: number, xp: number) => a.lv === lv && a.xp === xp;
  check("normalizeProgress: lv30 -> cap 20, xp 0", eq(n(30, 5000), 20, 0));
  check("normalizeProgress: at the cap xp is zeroed; huge xp from low level stops at the cap", eq(n(20, 777), 20, 0) && eq(n(5, 1e9), 20, 0) && eq(n(1, 26063), 20, 0));
  check("normalizeProgress: xp over the (new) threshold is carried up; xp under it is kept", eq(n(2, 100), 3, 9) && eq(n(8, 100), 8, 100) && eq(n(1, 29), 1, 29) && eq(n(1, 30), 2, 0));
  check("normalizeProgress: garbage input -> level 1, xp 0", eq(n(0, -5), 1, 0) && eq(n(NaN, NaN), 1, 0) && eq(n(-9, 3.7), 1, 3) && eq(n(Infinity, 0), 1, 0));
  console.log("\n[U2] kill XP by level difference, boss XP, stat scaling");
  check("xp multiplier: +5 or more = 1.5, 0 = 1, -2 = 1, -3 0.8, -4 0.6, -5 0.4, -6 0.2, -7 and below 0.1",
    [10, 5, 3, 0, -2, -3, -4, -5, -6, -7, -30].map(xpLevelMult).join(",") === "1.5,1.5,1.3,1,1,0.8,0.6,0.4,0.2,0.1,0.1", [10, 5, 3, 0, -2, -3, -4, -5, -6, -7, -30].map(xpLevelMult).join(","));
  check("killXp: same level = xpPerLv*lv; red mob (+3) pays +30 %; grey mob (-10) pays 10 % but never below 1",
    killXp(10, 3, 3) === 30 && killXp(10, 6, 3) === 78 && killXp(10, 3, 13) === 3 && killXp(10, 1, 20) === 1 && killXp(10, 1, 30) === 1, `${killXp(10, 3, 3)} ${killXp(10, 6, 3)} ${killXp(10, 3, 13)} ${killXp(10, 1, 20)}`);
  const boss = MOBS.stone_guardian;
  check("boss XP is meaningful: lv8 boss pays >= 2 levels of lv8 and > 20 average mob kills", boss.xpPerLv * 8 >= 2 * xpToNext(8) && boss.xpPerLv * 8 > 20 * MOBS.fox_spirit.xpPerLv * 4, `${boss.xpPerLv * 8} xp`);
  const classes = Object.keys(CLASSES) as ClassId[];
  check("hp and attack grow every level up to the cap for all 3 classes", classes.every((c) => { for (let l = 2; l <= MAX_LEVEL; l++) if (maxHpFor(c, l) <= maxHpFor(c, l - 1) || attackFor(c, l) <= attackFor(c, l - 1)) return false; return true; }),
    classes.map((c) => `${c}: hp ${maxHpFor(c, 1)}->${maxHpFor(c, MAX_LEVEL)}, atk ${attackFor(c, 1)}->${attackFor(c, MAX_LEVEL)}`).join("; "));
  check("quest XP rewards: chain 100/220/380/1500 (rising; the boss quest is worth more than a level at lv8), Mei 150", QUESTS.map((q) => q.rewardXp).join(",") === "100,220,380,1500" && QUESTS[3].rewardXp > xpToNext(8), QUESTS.map((q) => q.rewardXp).join(","));
  check("coin/jade tuning: small coin per kill, jade only from rare sources", COIN.base + COIN.perLv * 4 < 20 && JADE.bossKill >= 1 && JADE.chainComplete >= JADE.bossKill);
}

function unitDaily() {
  console.log("\n[U3] daily board: deterministic selection, UTC day maths");
  const ids = DAILY_POOL.map((d) => d.id);
  check("pool has the 6 required kinds (15 bamboo, 6 fox tails, 5 serpents, boss, Mei, XP)",
    DAILY_POOL.length >= 6 && DEF.get("bamboo_purge")!.need === 15 && DEF.get("fox_tails")!.need === 6 && DEF.get("pond_patrol")!.need === 5 && DEF.get("shrine_duty")!.target === "stone_guardian" && DEF.get("word_with_mei")!.kind === "talk" && DEF.get("steady_cultivation")!.kind === "xp");
  check("every daily has coin/jade/xp rewards in data", DAILY_POOL.every((d) => d.coin > 0 && d.jade > 0 && d.xp > 0 && d.need > 0 && d.title && d.desc));
  const a = dailyIdsFor("2026-10-28"), b = dailyIdsFor("2026-10-28");
  check("same date -> same board; DAILY_COUNT unique ids from the pool", JSON.stringify(a) === JSON.stringify(b) && a.length === DAILY_COUNT && new Set(a).size === a.length && a.every((i) => ids.includes(i)), a.join(","));
  const boards = new Set<string>(), seen = new Set<string>();
  for (let d = 0; d < 60; d++) { const day = dayKey(Date.UTC(2026, 9, 1 + d)); const x = dailyIdsFor(day); boards.add(x.join(",")); x.forEach((i) => seen.add(i)); }
  check("boards vary across 60 days and every pool entry shows up", boards.size >= 15 && seen.size === ids.length, `${boards.size} distinct boards`);
  check("dayKey is the UTC date", dayKey(Date.UTC(2026, 9, 28, 23, 59, 59, 999)) === "2026-10-28" && dayKey(Date.UTC(2026, 9, 29, 0, 0, 0)) === "2026-10-29" && dayKey(Date.UTC(2026, 11, 31, 23, 0)) === "2026-12-31");
  check("secondsToReset: 30 s before midnight = 30; at 00:00:00 = 86400; noon = 43200; month/year end ok",
    secondsToReset(Date.UTC(2026, 9, 28, 23, 59, 30)) === 30 && secondsToReset(Date.UTC(2026, 9, 29, 0, 0, 0)) === 86400 && secondsToReset(Date.UTC(2026, 9, 28, 12)) === 43200 && secondsToReset(Date.UTC(2026, 11, 31, 23, 59, 59, 500)) === 1 && secondsToReset(Date.UTC(2026, 9, 31, 23, 0)) === 3600);
  check("reset text: 5h 12m / 42m / 1m", fmtReset(5 * 3600 + 12 * 60) === "5h 12m" && fmtReset(42 * 60) === "42m" && fmtReset(5) === "1m" && fmtReset(3600) === "1h 00m");
}

/** Economy against a real World + sqlite file with an injected clock. */
async function unitEconomy() {
  console.log("\n[U4] Economy with an injected clock (login, progress, claim, idempotence, persistence, rollover)");
  const dir = mkdtempSync(join(tmpdir(), "jz-eco-")), dbPath = join(dir, "eco.db");
  let now = Date.UTC(2026, 9, 28, 12, 0, 0);
  const clock = () => now;
  const world = new World();
  const mkPlayer = (name: string) => {
    const log: Array<ServerMsg> = [];
    const p = world.addPlayer({ name, cls: "sword", level: 1, xp: 0 }, (s) => log.push(JSON.parse(s)));
    return { p, log };
  };
  const eco = new Economy(new EconomyDb(dbPath), clock);
  const { p, log } = mkPlayer("UnitHero");
  eco.login(world, p);
  const types = log.map((m) => m.t);
  check("login sends wallet then daily", types[0] === "wallet" && types[1] === "daily" && types.length === 2, types.join(","));
  const w0 = log[0] as Extract<ServerMsg, { t: "wallet" }>, d0 = log[1] as Extract<ServerMsg, { t: "daily" }>;
  check("new character wallet is {coin:0, jade:0}", w0.coin === 0 && w0.jade === 0);
  check("daily message shape: 3 tasks with id/title/desc/have/need/coin/jade/xp/done/claimed and resetIn = 43200", d0.tasks.length === 3 && d0.resetIn === 43200 &&
    d0.tasks.every((t) => typeof t.id === "string" && typeof t.title === "string" && typeof t.desc === "string" && t.have === 0 && t.need > 0 && t.coin > 0 && t.jade > 0 && t.xp > 0 && t.done === false && t.claimed === false), JSON.stringify(d0.tasks[0]));
  check("the board is dailyIdsFor(today)", d0.tasks.map((t) => t.id).join(",") === dailyIdsFor("2026-10-28").join(","));

  const last = <T extends ServerMsg["t"]>(t: T) => [...log].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }>;
  const sysLines = () => log.filter((m): m is Extract<ServerMsg, { t: "ev" }> => m.t === "ev").map((m) => m.e).filter((e): e is Extract<GameEvent, { k: "chat" }> => e.k === "chat" && !!e.sys).map((e) => e.text);
  const task = d0.tasks[0], def = DEF.get(task.id)!;
  const feed = (n: number) => eco.progress(world, p, def.kind, def.target, n);

  log.length = 0;
  feed(1);
  const dp = last("daily");
  check("progress change pushes `daily` (have 1)", !!dp && dp.tasks[0].have === Math.min(1, def.need) && dp.tasks[0].done === (def.need <= 1));
  const incomplete = def.need > 1;
  if (incomplete) eco.claim(world, p, task.id);
  check("claiming an unfinished task is refused: nothing granted", !incomplete || (sysLines().some((l) => /not complete/.test(l)) && eco.wallet(world, p).coin === 0 && !log.some((m) => m.t === "wallet")), sysLines()[0]);
  feed(def.need + 50); // over-feeding is capped
  const full = last("daily").tasks[0];
  check("progress is capped at `need`, task becomes done", full.have === def.need && full.done === true && full.claimed === false && sysLines().some((l) => l.startsWith("Daily complete: " + def.title)), `${full.have}/${full.need}`);
  // other tasks untouched by that kind of progress (unless the same kind/target)
  check("other tasks are not advanced by unrelated progress", last("daily").tasks.filter((t) => t.id !== task.id && DEF.get(t.id)!.kind === def.kind && DEF.get(t.id)!.target === def.target).length === 0 ? last("daily").tasks.filter((t) => t.id !== task.id).every((t) => t.have === 0) : true);

  log.length = 0;
  eco.claim(world, p, task.id);
  const wl = last("wallet"), dl = last("daily");
  const line = `Daily claimed: ${def.title} (+${def.coin} coin, +${def.jade} jade, +${def.xp} XP)`;
  check("claim: wallet + daily re-sent, exact sys line, claimed flag set", wl?.coin === def.coin && wl?.jade === def.jade && dl?.tasks[0].claimed === true && sysLines().includes(line), sysLines().join(" | "));
  check("claim grants the XP once (xp event amount)", log.filter((m) => m.t === "ev" && (m.e as GameEvent).k === "xp" && (m.e as { amount: number }).amount === def.xp).length === 1);
  log.length = 0;
  for (let i = 0; i < 10; i++) eco.claim(world, p, task.id);
  check("10 further claims of the same task: no wallet change, no extra reward, no extra Daily claimed line", !log.some((m) => m.t === "wallet") && sysLines().filter((l) => l.startsWith("Daily claimed")).length === 0 && sysLines().every((l) => /already claimed/.test(l)) && eco.wallet(world, p).coin === def.coin, sysLines()[0]);
  feed(5);
  check("a claimed task no longer advances and pushes nothing", !log.some((m) => m.t === "daily") || last("daily").tasks[0].claimed === true);

  log.length = 0;
  const offBoard = DAILY_POOL.map((d) => d.id).find((i) => !d0.tasks.some((t) => t.id === i))!;
  const junk: unknown[] = [undefined, null, 5, 0, NaN, true, {}, [], ["x"], "", " ", "nope", "__proto__", "constructor", "x".repeat(1000), offBoard, task.id.toUpperCase(), { id: task.id }];
  const wBefore = eco.wallet(world, p);
  for (const j of junk) eco.claim(world, p, j);
  const wAfter = eco.wallet(world, p);
  check("invalid claim ids (undefined/null/number/object/empty/huge/off-board/wrong case) never grant and never throw", wBefore.coin === wAfter.coin && wBefore.jade === wAfter.jade && !log.some((m) => m.t === "wallet") && sysLines().filter((l) => /not one of today's/.test(l)).length >= junk.length - 2, `${sysLines().length} lines`);

  // persistence: a second Economy over the same file (= server restart) and a fresh Player object (= relog)
  eco.db.close();
  const eco2 = new Economy(new EconomyDb(dbPath), clock);
  world.removePlayer(p);
  const re = mkPlayer("unithero"); // names are case-insensitive keys
  eco2.login(world, re.p);
  const rw = re.log.find((m) => m.t === "wallet") as Extract<ServerMsg, { t: "wallet" }>, rd = re.log.find((m) => m.t === "daily") as Extract<ServerMsg, { t: "daily" }>;
  check("wallet + claimed + progress persist across restart/relog (case-insensitive name)", rw.coin === def.coin && rw.jade === def.jade && rd.tasks[0].claimed === true && rd.tasks[0].have === def.need && rd.tasks[1].have === 0);
  re.log.length = 0;
  eco2.claim(world, re.p, task.id);
  check("claim after relog is still refused (claimed state is in the database)", !re.log.some((m) => m.t === "wallet") && eco2.wallet(world, re.p).coin === def.coin);

  // second task + coin/jade adders
  const t2 = rd.tasks[1], d2 = DEF.get(t2.id)!;
  eco2.progress(world, re.p, d2.kind, d2.target, d2.need);
  re.log.length = 0;
  eco2.claim(world, re.p, t2.id);
  const w2 = re.log.filter((m) => m.t === "wallet").at(-1) as Extract<ServerMsg, { t: "wallet" }>;
  check("two different tasks claim independently; wallet accumulates", w2.coin === def.coin + d2.coin && w2.jade === def.jade + d2.jade, `${w2.coin}c/${w2.jade}j`);
  eco2.addCoin(world, re.p, 7); eco2.addJade(world, re.p, 2); eco2.addCoin(world, re.p, 0); eco2.addCoin(world, re.p, -5); eco2.addJade(world, re.p, NaN);
  check("addCoin/addJade: positive integers only", eco2.wallet(world, re.p).coin === def.coin + d2.coin + 7 && eco2.wallet(world, re.p).jade === def.jade + d2.jade + 2);
  const walletNow = eco2.wallet(world, re.p);

  // UTC rollover with the injected clock
  now = Date.UTC(2026, 9, 28, 23, 59, 59, 0);
  re.log.length = 0; eco2.tick(world);
  check("23:59:59 UTC: still today's board, nothing pushed", re.log.length === 0);
  now = Date.UTC(2026, 9, 29, 0, 0, 1, 0);
  eco2.tick(world);
  const nd = re.log.find((m) => m.t === "daily") as Extract<ServerMsg, { t: "daily" }> | undefined;
  check("00:00:01 UTC next day: `daily` pushed by the tick with a fresh board (progress 0, unclaimed, resetIn 86399)",
    !!nd && nd.tasks.map((t) => t.id).join(",") === dailyIdsFor("2026-10-29").join(",") && nd.tasks.every((t) => t.have === 0 && !t.claimed && !t.done) && nd.resetIn === 86399, nd ? nd.tasks.map((t) => t.id).join(",") : "no daily");
  check("rollover keeps the wallet and says the board was refreshed", eco2.wallet(world, re.p).coin === walletNow.coin && eco2.wallet(world, re.p).jade === walletNow.jade && re.log.some((m) => m.t === "ev" && (m.e as GameEvent).k === "chat" && /refreshed/.test((m.e as { text: string }).text)));
  // claiming yesterday's id after the reset must fail unless it is also on today's board (then it is a fresh, unfinished task)
  re.log.length = 0;
  const staleBefore = eco2.wallet(world, re.p).coin;
  eco2.claim(world, re.p, task.id);
  check("yesterday's claim id after rollover grants nothing", eco2.wallet(world, re.p).coin === staleBefore && !re.log.some((m) => m.t === "wallet"));
  // today's tasks start from zero and are claimable again the next day
  const nt = nd!.tasks[0], ndef = DEF.get(nt.id)!;
  eco2.progress(world, re.p, ndef.kind, ndef.target, ndef.need);
  re.log.length = 0; eco2.claim(world, re.p, nt.id);
  check("new day: the same character can claim again (+ rewards)", eco2.wallet(world, re.p).coin === walletNow.coin + ndef.coin && eco2.wallet(world, re.p).jade === walletNow.jade + ndef.jade);
  // a login after the reset (no tick) also gets the new board; old day rows are pruned
  now = Date.UTC(2026, 9, 31, 8, 0, 0, 0);
  eco2.db.close();
  const eco3 = new Economy(new EconomyDb(dbPath), clock);
  world.removePlayer(re.p);
  const r3 = mkPlayer("UnitHero");
  eco3.login(world, r3.p);
  const d3 = r3.log.find((m) => m.t === "daily") as Extract<ServerMsg, { t: "daily" }>;
  check("login two days later: board for that date, wallet intact", d3.tasks.map((t) => t.id).join(",") === dailyIdsFor("2026-10-31").join(",") && d3.tasks.every((t) => t.have === 0 && !t.claimed) && eco3.wallet(world, r3.p).coin >= walletNow.coin + ndef.coin);
  // time going backwards (clock corrected) re-opens that day's rows: claimed flag survives only if rows were kept
  now = Date.UTC(2026, 9, 29, 9, 0, 0, 0);
  eco3.tick(world);
  const back = eco3.tasks(world, r3.p);
  check("moving the clock back to a recent day shows that day's board and its claimed flag (history is kept 7 days)", back.map((t) => t.id).join(",") === dailyIdsFor("2026-10-29").join(",") && back.find((t) => t.id === nt.id)?.claimed === true);
  eco3.db.close();
  rmSync(dir, { recursive: true, force: true });
}

// =====================================================================================================
// S. server integration
// =====================================================================================================
class Bot {
  ws!: WebSocket; id = 0; closed = false;
  order: string[] = []; errors: string[] = [];
  chats: Array<{ text: string; sys?: boolean; from: string }> = [];
  evs: GameEvent[] = [];
  wallet: { coin: number; jade: number } | null = null; walletMsgs = 0;
  daily: { tasks: DailyTask[]; resetIn: number } | null = null; dailyMsgs = 0;
  ents = new Map<number, EntityState>();
  lastXp?: { lv: number; xp: number; next: number };
  constructor(public name: string, public cls: ClassId = "sword", public pw = "eco-pass-1234") {}
  open() { return new Promise<void>((res, rej) => { this.ws = new WebSocket(URL); this.ws.on("open", () => res()); this.ws.on("error", rej); this.ws.on("close", () => { this.closed = true; });
    this.ws.on("message", (d) => this.onMsg(JSON.parse(d.toString()))); }); }
  send(m: Record<string, unknown>) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  raw(s: string) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s); }
  async login() {
    await this.open();
    this.send({ t: "login", name: this.name, cls: this.cls, v: PROTOCOL_VERSION, pw: this.pw });
    return until(() => this.id !== 0 || this.errors.length > 0 || this.closed, 4000).then(async () => { if (this.id) await until(() => this.dailyMsgs > 0, 1500); return this.id !== 0; });
  }
  onMsg(m: ServerMsg) {
    if (this.order.length < 14) this.order.push(m.t);
    switch (m.t) {
      case "welcome": this.id = m.id; break;
      case "error": this.errors.push(m.msg); break;
      case "wallet": this.wallet = { coin: m.coin, jade: m.jade }; this.walletMsgs++; break;
      case "daily": this.daily = { tasks: m.tasks, resetIn: m.resetIn }; this.dailyMsgs++; break;
      case "snap": for (const e of m.ents) this.ents.set(e.id, e); for (const g of m.gone) this.ents.delete(g); break;
      case "ev": {
        this.evs.push(m.e);
        if (m.e.k === "chat") this.chats.push({ text: m.e.text, sys: m.e.sys, from: m.e.from });
        if (m.e.k === "xp") this.lastXp = { lv: m.e.lv, xp: m.e.xp, next: m.e.next };
        break;
      }
    }
  }
  sys(sub: string) { return this.chats.some((c) => c.sys && c.text.includes(sub)); }
  sysCount(sub: string) { return this.chats.filter((c) => c.sys && c.text.includes(sub)).length; }
  xpAmounts() { return this.evs.filter((e): e is Extract<GameEvent, { k: "xp" }> => e.k === "xp" && e.amount > 0).map((e) => e.amount); }
  close() { this.ws?.close(); }
  cmd(text: string, ms = 120) { this.send({ t: "chat", text }); return sleep(ms); }
  task(id: string) { return this.daily?.tasks.find((t) => t.id === id); }
}

let child: ChildProcess | undefined;
let tmp = "", dbFile = "";
async function startServer(first = true) {
  if (first) {
    tmp = mkdtempSync(join(tmpdir(), "jiuzhou-eco-"));
    dbFile = process.env.ECO_DB || join(tmp, "eco.db");
    // legacy characters (no account yet) seeded before the server starts: they must be clamped/carried into the new curve at login
    const cdb = new CharacterDb(dbFile);
    const seed = (name: string, level: number, xp: number) => cdb.create({ name, cls: "sword", level, xp, x: 0, z: -80 });
    seed("Legacy30" + SUFFIX, 30, 5000); seed("Legacy4" + SUFFIX, 4, 500); seed("Legacy8" + SUFFIX, 8, 100); seed("Legacy20" + SUFFIX, 20, 123);
    cdb.close();
  }
  child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: dbFile, NODE_NO_WARNINGS: "1", TEST_MODE: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (d) => process.stderr.write(`[server!] ${d}`));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* not up */ } await sleep(100); }
  throw new Error("server did not start");
}
async function stopServer(keepDb = false) {
  if (!child) return;
  const exited = new Promise<number | null>((r) => child!.once("exit", (c) => r(c)));
  child.kill("SIGTERM");
  const code = await Promise.race([exited, sleep(5000).then(() => "timeout" as const)]);
  check("server shuts down cleanly on SIGTERM", code === 0, `exit=${code}`);
  if (code === "timeout") child.kill("SIGKILL");
  if (!process.env.ECO_DB && !keepDb) rmSync(tmp, { recursive: true, force: true });
}
const healthOk = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { return false; } };
/** Move the (TEST_MODE) server clock to 12:00 UTC of `day` and wait until `bot` has been sent that day's board. */
async function setDay(bot: Bot, day: string) {
  const before = bot.dailyMsgs;
  const hours = (Date.parse(day + "T12:00:00Z") - Date.now()) / 3_600_000;
  bot.send({ t: "chat", text: `/testclock ${hours}` });
  await until(() => bot.dailyMsgs > before && bot.daily!.tasks.map((t) => t.id).join(",") === dailyIdsFor(day).join(","), 3500, 50);
}
function findDay(id: string, from = 0): string {
  for (let d = from; d < from + 120; d++) { const day = dayKey(Date.now() + d * 86_400_000); if (dailyIdsFor(day).includes(id)) return day; }
  throw new Error("no day with " + id);
}

async function serverTests() {
  console.log("\n[S1] login: wallet + daily after welcome, shapes");
  const today = dayKey(Date.now());
  const A = new Bot("EcoA" + SUFFIX, "sword");
  const okA = await A.login();
  const ord = A.order;
  check("logged in (password account)", okA, A.errors[0]);
  check("order: welcome, inv, wallet, daily all before the first snapshot", ord.indexOf("welcome") < ord.indexOf("wallet") && ord.indexOf("wallet") < ord.indexOf("daily") && ord.indexOf("inv") < ord.indexOf("wallet") && (ord.indexOf("snap") === -1 || ord.indexOf("daily") < ord.indexOf("snap")), ord.slice(0, 8).join(","));
  check("first wallet is {coin:0,jade:0}; exactly one wallet and one daily message at login", A.wallet?.coin === 0 && A.wallet?.jade === 0 && A.walletMsgs === 1 && A.dailyMsgs === 1);
  const d = A.daily!;
  check("daily: 3 tasks, ids = dailyIdsFor(UTC today), all fields typed, resetIn in 1..86400", d.tasks.length === 3 && d.tasks.map((t) => t.id).join(",") === dailyIdsFor(today).join(",") && d.resetIn >= 1 && d.resetIn <= 86400 &&
    d.tasks.every((t) => t.title && t.desc && t.have === 0 && t.need > 0 && t.coin > 0 && t.jade > 0 && t.xp > 0 && t.done === false && t.claimed === false), JSON.stringify(d.tasks[0]));
  check("resetIn matches seconds to 00:00 UTC", Math.abs(d.resetIn - secondsToReset(Date.now())) <= 3, `${d.resetIn} vs ${secondsToReset(Date.now())}`);

  console.log("\n[S2] coin drops, system line, no jade from normal mobs");
  await A.cmd("/testdrops");
  const c0 = A.walletMsgs;
  await A.cmd("/testkill bamboo_spirit 4", 600);
  const found = A.chats.filter((c) => c.sys && /^You found \d+ coin\.$/.test(c.text)).map((c) => Number(c.text.match(/\d+/)![0]));
  check("each kill: `You found N coin.` (N >= 1) and a wallet message", found.length === 4 && found.every((n) => n >= 1 && n <= 40) && A.walletMsgs - c0 >= 4, `${found.join("+")}`);
  check("wallet.coin equals the sum of the found lines; jade stays 0 (normal mobs give no jade)", A.wallet?.coin === found.reduce((a, b) => a + b, 0) && A.wallet?.jade === 0, JSON.stringify(A.wallet));
  check("loot events unchanged: no `Coin` loot item is sent", !A.evs.some((e) => e.k === "loot" && /coin|jade/i.test(e.item)));
  await A.cmd("/testkill fox_spirit 3", 500);
  const foxCoin = A.chats.filter((c) => c.sys && /^You found \d+ coin\.$/.test(c.text)).map((c) => Number(c.text.match(/\d+/)![0])).slice(4);
  check("higher-level mobs drop more on average (lv3-4 fox >= lv1-3 bamboo average)", foxCoin.length === 3 && foxCoin.reduce((a, b) => a + b, 0) / 3 >= found.reduce((a, b) => a + b, 0) / 4 - 1, `fox ${foxCoin.join("+")} vs bamboo ${found.join("+")}`);

  console.log("\n[S3] XP by level difference in the live server");
  {
    const G = new Bot("EcoGrey" + SUFFIX, "sword");
    await G.login(); await G.cmd("/testlevel 15"); await G.cmd("/testdrops"); await G.cmd("/testtp -40 10", 300);
    G.evs.length = 0;
    await G.cmd("/testkill bamboo_spirit 3", 500);
    const am = G.xpAmounts();
    check("lv15 killing lv1-3 bamboo gets grey XP (1-3 each, never 0)", am.length === 3 && am.every((a) => a >= 1 && a <= 3), am.join(","));
    G.close();
    const F = new Bot("EcoFresh" + SUFFIX, "sword");
    await F.login(); await F.cmd("/testdrops"); await F.cmd("/testtp -40 10", 300); F.evs.length = 0;
    await F.cmd("/testkill bamboo_spirit 1", 400);
    const fa = F.xpAmounts();
    check("lv1 killing a bamboo spirit: XP = xpPerLv x mob level x level-difference bonus (12..36)", fa.length >= 1 && fa[0] >= 12 && fa[0] <= 36, fa.join(","));
    F.close();
  }

  console.log("\n[S4] daily progress by kills, /daily, claim, double-claim, invalid ids");
  const dayB = findDay("bamboo_purge");
  await setDay(A, dayB);
  const bam = A.task("bamboo_purge")!;
  check(`clock shifted to ${dayB}: board contains Bamboo Purge, rows fresh (0/15)`, !!bam && bam.have === 0 && bam.need === 15, bam ? `${bam.have}/${bam.need}` : "missing");
  A.chats.length = 0;
  await A.cmd("/testtp -40 10", 300);
  await A.cmd("/testkill bamboo_spirit 8", 800);
  check("8 bamboo kills -> Bamboo Purge 8/15", A.task("bamboo_purge")!.have === 8 && !A.task("bamboo_purge")!.done, `${A.task("bamboo_purge")!.have}`);
  const dm = A.dailyMsgs;
  await A.cmd("/testkill fox_spirit 1", 300);
  check("kill of another mob type does not touch Bamboo Purge", A.task("bamboo_purge")!.have === 8);
  await A.cmd("/testkill bamboo_spirit 7", 800);
  check("15 bamboo kills -> done, sys `Daily complete: Bamboo Purge. Claim it from the notice board.`", A.task("bamboo_purge")!.have === 15 && A.task("bamboo_purge")!.done && A.sys("Daily complete: Bamboo Purge. Claim it from the notice board."));
  check("every change pushed a `daily` message", A.dailyMsgs - dm >= 8, `${A.dailyMsgs - dm} msgs`);
  await sleep(1300);
  A.chats.length = 0;
  await A.cmd("/daily", 500);
  const dl = A.chats.filter((c) => c.sys).map((c) => c.text);
  check("/daily prints header, one line per task, wallet", /^Daily tasks \(resets in (\d+h \d\dm|\d+m)\):$/.test(dl[0] ?? "") && dl.filter((l) => l.startsWith("- ")).length === 3 && dl.some((l) => /^Wallet: \d+ coin, \d+ jade$/.test(l)), dl.join(" | "));
  check("/daily line format: `- Title: have/need (+C coin, +J jade, +X XP) [state]`", dl.includes("- Bamboo Purge: 15/15 (+60 coin, +1 jade, +250 XP) [ready to claim]"), dl[1]);
  check("/daily is not broadcast as chat", !A.chats.some((c) => !c.sys && c.text.startsWith("/")));

  const w0 = { ...A.wallet! };
  const xp0 = A.xpAmounts().length;
  A.chats.length = 0;
  // invalid claims first
  for (const raw of ['{"t":"claim"}', '{"t":"claim","id":5}', '{"t":"claim","id":null}', '{"t":"claim","id":{"a":1}}', '{"t":"claim","id":"nope"}', `{"t":"claim","id":"${"x".repeat(300)}"}`, '{"t":"claim","id":"__proto__"}', '{"t":"claim","id":""}', '{"t":"claim","id":["bamboo_purge"]}'])
    A.raw(raw);
  const offBoard = DAILY_POOL.map((x) => x.id).find((i) => !A.daily!.tasks.some((t) => t.id === i))!;
  A.send({ t: "claim", id: offBoard });
  const other = A.daily!.tasks.find((t) => t.id !== "bamboo_purge" && !t.done);
  if (other) A.send({ t: "claim", id: other.id });
  await sleep(500);
  check("invalid claim ids and an unfinished task: wallet unchanged, no XP, server alive", A.wallet!.coin === w0.coin && A.wallet!.jade === w0.jade && A.xpAmounts().length === xp0 && A.sysCount("Daily claimed") === 0 && (await healthOk()));
  check("unfinished task answers `That task is not complete yet.`; off-board id answers `not one of today's daily tasks`", (!other || A.sys("That task is not complete yet.")) && A.sysCount("That is not one of today's daily tasks.") >= 10, `${A.sysCount("That is not one of today's daily tasks.")}`);
  // the real claim, sent 6 times back to back
  A.chats.length = 0;
  for (let i = 0; i < 6; i++) A.send({ t: "claim", id: "bamboo_purge" });
  await sleep(700);
  const bd = DEF.get("bamboo_purge")!;
  check("claim x6 back-to-back: exactly ONE grant (+coin, +jade), wallet msg shows it", A.wallet!.coin === w0.coin + bd.coin && A.wallet!.jade === w0.jade + bd.jade, JSON.stringify(A.wallet));
  check("exact chat line `Daily claimed: Bamboo Purge (+60 coin, +1 jade, +250 XP)` once; XP event +250 once; the other 5 say already claimed",
    A.sysCount("Daily claimed: Bamboo Purge (+60 coin, +1 jade, +250 XP)") === 1 && A.xpAmounts().slice(xp0).filter((a) => a === bd.xp).length === 1 && A.sysCount("already claimed") === 5, `${A.sysCount("already claimed")} refusals`);
  check("daily shows claimed:true, done:true", A.task("bamboo_purge")!.claimed && A.task("bamboo_purge")!.done);
  await A.cmd("/testkill bamboo_spirit 2", 400);
  check("claimed task does not advance further (still 15/15)", A.task("bamboo_purge")!.have === 15);
  const walletBeforeRelog = { ...A.wallet! }, boardBefore = JSON.stringify(A.daily!.tasks);

  console.log("\n[S5] persistence across relog, rollover while online, previous day kept");
  A.close(); await until(() => A.closed, 1000); await sleep(500);
  const A2 = new Bot("EcoA" + SUFFIX, "sword"); // same name, same password
  await A2.login();
  check("relog (clock still on the shifted day): wallet restored exactly", A2.wallet?.coin === walletBeforeRelog.coin && A2.wallet?.jade === walletBeforeRelog.jade, JSON.stringify(A2.wallet));
  check("relog: daily progress and claimed flags restored", JSON.stringify(A2.daily!.tasks) === boardBefore, A2.daily!.tasks.map((t) => `${t.id}:${t.have}/${t.need}${t.claimed ? "C" : ""}`).join(" "));
  A2.send({ t: "claim", id: "bamboo_purge" }); await sleep(300);
  check("relog: claiming again is refused", A2.wallet?.coin === walletBeforeRelog.coin && A2.sysCount("Daily claimed") === 0);
  // finish and claim the other two with the test hook, check totals
  A2.chats.length = 0;
  await A2.cmd("/testdaily", 300);
  check("/testdaily completes unclaimed tasks", A2.daily!.tasks.every((t) => t.done));
  const rest = A2.daily!.tasks.filter((t) => !t.claimed);
  const wPre = { ...A2.wallet! };
  for (const t of rest) A2.send({ t: "claim", id: t.id });
  await sleep(500);
  check("the other tasks claim for the sum of their rewards", A2.wallet!.coin === wPre.coin + rest.reduce((n, t) => n + t.coin, 0) && A2.wallet!.jade === wPre.jade + rest.reduce((n, t) => n + t.jade, 0) && A2.daily!.tasks.every((t) => t.claimed) && A2.sysCount("Daily claimed:") === rest.length, JSON.stringify(A2.wallet));
  const walletDay1 = { ...A2.wallet! };
  // rollover while connected
  const nextDay = dayKey(Date.parse(dayB + "T12:00:00Z") + 86_400_000);
  const dm2 = A2.dailyMsgs;
  A2.chats.length = 0;
  const hoursToNext = (Date.parse(nextDay + "T00:00:30Z") - Date.now()) / 3_600_000; // 30 s after midnight UTC
  A2.send({ t: "chat", text: `/testclock ${hoursToNext}` });
  const rolled = await until(() => A2.dailyMsgs > dm2 && A2.daily!.tasks.map((t) => t.id).join(",") === dailyIdsFor(nextDay).join(","), 3500);
  check("00:00 UTC rollover while online: server pushes a new `daily` by itself (new ids, 0 progress, unclaimed, resetIn ~86370)", rolled && A2.daily!.tasks.every((t) => t.have === 0 && !t.claimed) && Math.abs(A2.daily!.resetIn - 86370) <= 5, `${A2.daily!.resetIn}`);
  check("rollover keeps the wallet and announces the refresh", A2.wallet!.coin === walletDay1.coin && A2.wallet!.jade === walletDay1.jade && A2.sys("notice board has been refreshed"));
  const staleCoin = A2.wallet!.coin;
  A2.send({ t: "claim", id: "bamboo_purge" }); await sleep(300);
  check("claiming a task from the previous day's board after the reset grants nothing", nextDay !== dayB && A2.wallet!.coin === staleCoin);
  // back to the previous day: its claims are still remembered (rows are per day); then to today
  await setDay(A2, dayB);
  check("moving back to the previous day shows its board with everything still claimed", A2.daily!.tasks.every((t) => t.claimed));
  await setDay(A2, today);
  check("back on today's date: today's board, none of the shifted days' claims leaked into it", A2.daily!.tasks.map((t) => t.id).join(",") === dailyIdsFor(today).join(",") && A2.daily!.tasks.every((t) => !t.claimed));
  A2.cmd("/testclock reset"); await sleep(1300);

  console.log("\n[S6] other daily kinds in the live server: loot, talk, XP, serpents");
  {
    const dFox = findDay("fox_tails");
    const B = new Bot("EcoB" + SUFFIX, "talisman");
    await B.login(); await B.cmd("/testdrops");
    await setDay(B, dFox);
    await B.cmd("/testkill fox_spirit 8", 900);
    const ft = B.task("fox_tails")!;
    check(`${dFox}: Gather 6 Fox Tails advances from Fox Tail loot (drops forced), capped at 6`, !!ft && ft.have === 6 && ft.done, `${ft?.have}/${ft?.need}`);
    B.close();
    const dMei = findDay("word_with_mei");
    const M = new Bot("EcoM" + SUFFIX, "sword");
    await M.login();
    await setDay(M, dMei);
    await M.cmd("/testtp 8 -72", 400);
    check("Speak to Mei starts at 0/1", M.task("word_with_mei")!.have === 0);
    await M.cmd("/talk mei", 500);
    check("/talk mei completes `A Word with Mei`", M.task("word_with_mei")!.have === 1 && M.task("word_with_mei")!.done && M.sys("Daily complete: A Word with Mei"));
    M.close();
    const dXp = findDay("steady_cultivation");
    const X = new Bot("EcoX" + SUFFIX, "physician");
    await X.login();
    await setDay(X, dXp);
    await X.cmd("/testxp 600", 300);
    check("Earn 1500 XP counts XP gained (600/1500)", X.task("steady_cultivation")!.have === 600);
    await X.cmd("/testxp 900", 300);
    check("...and completes at 1500", X.task("steady_cultivation")!.done);
    const lvX = X.lastXp!.lv;
    X.send({ t: "claim", id: "steady_cultivation" }); await sleep(400);
    const sc = DEF.get("steady_cultivation")!;
    check("claiming Earn-XP gives its XP reward but that XP does not count towards the task itself", X.sys(`Daily claimed: ${sc.title} (+${sc.coin} coin, +${sc.jade} jade, +${sc.xp} XP)`) && X.task("steady_cultivation")!.have === 1500 && X.task("steady_cultivation")!.claimed && X.lastXp!.lv >= lvX);
    X.close();
    const dSer = findDay("pond_patrol");
    const S = new Bot("EcoS" + SUFFIX, "sword");
    await S.login();
    await setDay(S, dSer);
    await S.cmd("/testkill jade_serpent 3", 600);
    check("Jade Serpent kills advance Pond Patrol (3/5)", S.task("pond_patrol")!.have === 3);
    S.close();
    const dBoss = findDay("shrine_duty");
    const Q = new Bot("EcoQ" + SUFFIX, "sword");
    await Q.login();
    await setDay(Q, dBoss);
    check("Stone Guardian daily is on the board with need 1 (boss kill itself is exercised in npm test [H])", Q.task("shrine_duty")!.need === 1 && Q.task("shrine_duty")!.xp >= 1000);
    await Q.cmd("/testclock reset", 1300);
    Q.close();
  }

  console.log("\n[S7] Notice Board Keeper Fen");
  {
    const F = new Bot("EcoF" + SUFFIX, "sword");
    await F.login();
    await sleep(600);
    const fen = [...F.ents.values()].find((e) => e.k === "npc" && e.n === "Notice Board Keeper Fen");
    const fenDef = NPCS.find((n) => n.name === "Notice Board Keeper Fen")!;
    check("Fen is an NPC entity at her data position, visible from the spawn plaza", !!fen && Math.abs(fen.x - fenDef.x) < 0.1 && Math.abs(fen.z - fenDef.z) < 0.1, fen ? `${fen.x},${fen.z}` : "not seen");
    const others = NPCS.filter((n) => n.name !== fenDef.name);
    const gaps = others.map((o) => Math.hypot(o.x - fenDef.x, o.z - fenDef.z));
    check("Fen keeps >= 8 units from every other NPC and out of the plaza's lantern/flag ring (r 11-13 around 0,-80)", Math.min(...gaps) >= 8 && Math.hypot(fenDef.x, fenDef.z + 80) < 10, `nearest NPC ${Math.min(...gaps).toFixed(1)}, ring radius ${Math.hypot(fenDef.x, fenDef.z + 80).toFixed(1)}`);
    await F.cmd(`/testtp ${fenDef.x + 1.5} ${fenDef.z}`, 300);
    F.chats.length = 0;
    await F.cmd("/talk fen", 600);
    const lines = F.chats.filter((c) => c.sys).map((c) => c.text);
    check("/talk fen: `Notice Board Keeper Fen: ...` then the board lines", lines[0]?.startsWith("Notice Board Keeper Fen: ") && lines.some((l) => l.startsWith("Daily tasks (resets in ")) && lines.filter((l) => l.startsWith("- ")).length === 3, lines[0]);
    await sleep(2500);
    F.chats.length = 0;
    await F.cmd("/talk", 600);
    check("bare /talk next to Fen (Elder out of reach, Mei farther) goes to Fen", F.sys("Notice Board Keeper Fen: ") && !F.sys("Lantern Keeper Mei:") && !F.sys("Elder Lin:"));
    await F.cmd("/testtp 8 -71", 300);
    F.chats.length = 0;
    await F.cmd("/talk", 600);
    check("bare /talk with Elder Lin in reach still goes to Elder Lin (main chain first)", F.sys("Elder Lin:") && !F.sys("Notice Board Keeper Fen:"));
    await sleep(2000);
    await F.cmd("/testtp 13 -72", 300); // 6 from Mei (7,-74); Elder Lin is 17 away
    F.chats.length = 0;
    await F.cmd("/talk", 600);
    check("bare /talk beside Mei (Elder out of reach) goes to Mei", F.sys("Lantern Keeper Mei:") && !F.sys("Notice Board Keeper Fen:"), F.chats.at(-1)?.text);
    await sleep(2500);
    await F.cmd("/testtp 0 40", 300);
    F.chats.length = 0;
    await F.cmd("/talk fen", 500);
    check("/talk fen from far away: `too far away`", F.sys("Notice Board Keeper Fen is too far away"));
    await F.cmd("/talk", 500);
    check("bare /talk far from everyone names all three NPCs", F.sys("No one is close enough") && F.sys("Notice Board Keeper Fen"));
    await sleep(2500);
    F.chats.length = 0;
    await F.cmd("/wat", 400);
    check("unknown command help mentions /talk fen and /daily", F.sys("/talk fen") && F.sys("/daily"));
    F.close();
  }

  console.log("\n[S8] level cap and legacy characters");
  {
    const L = new Bot("Legacy30" + SUFFIX, "sword", "legacy-pass-1");
    await L.login(); await until(() => !!L.lastXp, 1000);
    check("legacy lv30 character logs in as lv20, xp 0, next 0 (no overflow)", L.lastXp?.lv === 20 && L.lastXp.xp === 0 && L.lastXp.next === 0, JSON.stringify(L.lastXp));
    L.close();
    const L4 = new Bot("Legacy4" + SUFFIX, "sword", "legacy-pass-1");
    await L4.login(); await until(() => !!L4.lastXp, 1000);
    const exp4 = normalizeProgress(4, 500);
    check("legacy lv4 xp500 (over the new threshold) carries up to the proper level", L4.lastXp?.lv === exp4.lv && L4.lastXp.xp === exp4.xp && exp4.lv === 5 && L4.lastXp.next === xpToNext(5), JSON.stringify(L4.lastXp));
    L4.close();
    const L8 = new Bot("Legacy8" + SUFFIX, "sword", "legacy-pass-1");
    await L8.login(); await until(() => !!L8.lastXp, 1000);
    check("legacy lv8 xp100 keeps its level and xp; next = 836", L8.lastXp?.lv === 8 && L8.lastXp.xp === 100 && L8.lastXp.next === xpToNext(8), JSON.stringify(L8.lastXp));
    L8.close();
    const L20 = new Bot("Legacy20" + SUFFIX, "sword", "legacy-pass-1");
    await L20.login(); await until(() => !!L20.lastXp, 1000);
    check("legacy lv20 with stray xp is normalised to xp 0", L20.lastXp?.lv === 20 && L20.lastXp.xp === 0);
    await L20.cmd("/testdrops"); L20.evs.length = 0;
    await L20.cmd("/testxp 5000", 300);
    check("XP at the cap: no level above 20, no stored xp", !L20.evs.some((e) => e.k === "levelup") && L20.lastXp?.lv === 20 && L20.lastXp.xp === 0);
    await L20.cmd("/testkill bamboo_spirit 2", 400);
    check("kills at the cap keep lv20 / xp 0 and still pay coin", L20.lastXp?.lv === 20 && L20.lastXp.xp === 0 && (L20.wallet?.coin ?? 0) > 0);
    L20.close();
    const P = new Bot("Cap" + SUFFIX, "talisman");
    await P.login();
    await P.cmd("/testlevel 19"); await P.cmd("/testxp 999999", 400);
    check("level 19 + huge XP: stops at 20 with xp 0, exactly one level-up event for lv20", P.lastXp?.lv === 20 && P.lastXp.xp === 0 && P.lastXp.next === 0 && P.evs.filter((e) => e.k === "levelup" && e.lv === 20).length === 1);
    await P.cmd("/testlevel 99", 300);
    check("/testlevel clamps to the cap (20)", P.lastXp?.lv === 20);
    P.close(); await sleep(400);
    const P2 = new Bot("Cap" + SUFFIX, "talisman");
    await P2.login(); await until(() => !!P2.lastXp, 1000);
    check("cap level persisted across relog", P2.lastXp?.lv === 20 && P2.lastXp.xp === 0);
    const N = new Bot("Multi" + SUFFIX, "physician");
    await N.login(); await N.cmd("/testxp 2167", 400);
    check("2167 XP from level 1 lands exactly on level 8 (curve sum) with 0 xp", N.lastXp?.lv === 8 && N.lastXp.xp === 0 && N.lastXp.next === xpToNext(8), JSON.stringify(N.lastXp));
    await N.cmd("/testxp 100", 300);
    check("XP event reports xp/next on the new curve", N.lastXp?.xp === 100 && N.lastXp.next === xpToNext(8));
    P2.close(); N.close();
  }

  console.log("\n[S9] wallet persistence, adjust hook, DB tables");
  {
    const W = new Bot("EcoW" + SUFFIX, "sword");
    await W.login();
    await W.cmd("/testwallet 250 7", 300);
    check("/testwallet adds and sends `wallet`", W.wallet?.coin === 250 && W.wallet?.jade === 7);
    await W.cmd("/testwallet -1000 -1000", 300);
    check("wallet never goes below 0", W.wallet?.coin === 0 && W.wallet?.jade === 0);
    await W.cmd("/testwallet 123 4", 300);
    W.close(); await until(() => W.closed, 1000); await sleep(500);
    const W2 = new Bot("EcoW" + SUFFIX, "sword");
    await W2.login();
    check("wallet persisted across relog (123 coin, 4 jade)", W2.wallet?.coin === 123 && W2.wallet?.jade === 4, JSON.stringify(W2.wallet));
    W2.close();
  }
  check("server healthy after the economy run", await healthOk());
}

async function main() {
  console.log("JIUZHOU economy / progression test");
  unitCurve(); unitDaily(); await unitEconomy();
  console.log("\n--- server integration ---");
  await startServer();
  await serverTests();
  // wallet/daily tables survive a server restart (SIGTERM, then start again on the same file)
  console.log("\n[S10] server restart keeps wallet and daily claims");
  {
    const R = new Bot("EcoR" + SUFFIX, "sword");
    await R.login();
    await R.cmd("/testwallet 55 3", 300);
    await R.cmd("/testdaily", 300);
    const first = R.daily!.tasks[0];
    R.send({ t: "claim", id: first.id }); await sleep(400);
    const snap = { w: { ...R.wallet! }, board: JSON.stringify(R.daily!.tasks) };
    R.close(); await sleep(400);
    await stopServer(true); child = undefined;
    await startServer(false);
    const R2 = new Bot("EcoR" + SUFFIX, "sword");
    await R2.login();
    check("after a full server restart: wallet and daily board (claimed flag, progress) identical", R2.wallet?.coin === snap.w.coin && R2.wallet?.jade === snap.w.jade && JSON.stringify(R2.daily!.tasks) === snap.board, JSON.stringify(R2.wallet));
    R2.send({ t: "claim", id: first.id }); await sleep(300);
    check("...and the already-claimed task cannot be claimed again", R2.wallet?.coin === snap.w.coin && R2.wallet?.jade === snap.w.jade);
    R2.close();
  }
  await stopServer();
}

main()
  .catch((e) => { console.error("test crashed:", e); check("test harness ran to completion", false, String(e)); })
  .finally(() => {
    if (child && !child.killed && child.exitCode === null) child.kill("SIGKILL");
    const failed = results.filter((r) => !r.ok);
    console.log(`\n==== ${results.length - failed.length}/${results.length} economy checks passed ====`);
    for (const f of failed) console.log(`  FAILED: ${f.name} ${f.detail}`);
    console.log(failed.length ? "RESULT: FAIL" : "RESULT: PASS");
    process.exit(failed.length ? 1 : 0);
  });
