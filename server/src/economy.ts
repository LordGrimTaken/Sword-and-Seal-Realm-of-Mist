// Two-tier currency (coin, jade) and the daily quest board. See docs/MESSAGE_FORMATS.md for the exact wire/chat shapes.
//
//   coin  soft currency: dropped by mobs (small amounts, scale with mob level).
//   jade  rare currency: boss kills, finishing Elder Lin's chain, daily rewards.
//   daily 3 tasks per UTC day, picked deterministically from DAILY_POOL by the date; progress and "claimed" are stored per character per day.
//
// Persistence uses its own tables (`wallet`, `daily`) through its own connection to the same sqlite file (db.ts is not touched).
// All state changes happen synchronously on the single game thread, so a claim can neither be applied twice nor interleave with another one;
// the database flip `claimed 0 -> 1` plus the wallet write are one transaction, and only a changed row counts as a successful claim.
// The clock is injectable (Economy constructor) so day rollover is testable; TEST_MODE servers can also shift it with `/testclock`.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DailyTask, ServerMsg } from "../../shared/protocol.ts";
import { COIN, DAILY_COUNT, DAILY_POOL, JADE, xpLevelMult, type DailyDef } from "./data.ts";
import { grantXp } from "./game/combat.ts";
import type { Mob, Player } from "./game/types.ts";
import { mulberry32, rand } from "./game/util.ts";
import type { World } from "./game/world.ts";

// ---------------- pure helpers (exported for tests) ----------------
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10); // UTC date, "YYYY-MM-DD"
/** Whole seconds until the next 00:00 UTC (1..86400). */
export function secondsToReset(ms: number): number {
  const d = new Date(ms);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - ms) / 1000));
}
/** The ids on the board for a UTC day: a seeded shuffle (FNV-1a of the date string -> mulberry32) of the pool, first DAILY_COUNT. Same date => same board, always. */
export function dailyIdsFor(day: string): string[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) { h ^= day.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const rng = mulberry32(h);
  const ids = DAILY_POOL.map((d) => d.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, Math.min(DAILY_COUNT, ids.length));
}
/** Daily rows older than this many days are dropped (a week of history is kept). */
const pruneBefore = (ms: number) => dayKey(ms - 7 * 86_400_000);
const DEFS = new Map(DAILY_POOL.map((d) => [d.id, d] as const));
export const fmtReset = (secs: number) => { const m = Math.max(1, Math.ceil(secs / 60)); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`; };

/** TEST_MODE only: `/testclock <hours>` shifts the server clock this much (0 = real time). Never non-zero in production. */
export const testClock = { offsetMs: 0 };
export const serverNow = () => Date.now() + testClock.offsetMs;

// ---------------- persistence ----------------
interface TaskRow { have: number; claimed: boolean }
export class EconomyDb {
  private db: DatabaseSync;
  private qWLoad; private qWSave; private qDLoad; private qDSave; private qDEnsure; private qDClaim; private qDPrune;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS wallet (
        name TEXT PRIMARY KEY COLLATE NOCASE, coin INTEGER NOT NULL DEFAULT 0, jade INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily (
        name TEXT NOT NULL COLLATE NOCASE, day TEXT NOT NULL, id TEXT NOT NULL, have INTEGER NOT NULL DEFAULT 0, claimed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (name, day, id)
      );`);
    this.qWLoad = this.db.prepare("SELECT coin, jade FROM wallet WHERE name = ?");
    this.qWSave = this.db.prepare("INSERT INTO wallet (name, coin, jade, updated_at) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET coin=excluded.coin, jade=excluded.jade, updated_at=excluded.updated_at");
    this.qDLoad = this.db.prepare("SELECT id, have, claimed FROM daily WHERE name = ? AND day = ?");
    this.qDSave = this.db.prepare("INSERT INTO daily (name, day, id, have, claimed) VALUES (?,?,?,?,0) ON CONFLICT(name, day, id) DO UPDATE SET have = MAX(have, excluded.have)");
    this.qDEnsure = this.db.prepare("INSERT OR IGNORE INTO daily (name, day, id, have, claimed) VALUES (?,?,?,?,0)");
    this.qDClaim = this.db.prepare("UPDATE daily SET claimed = 1 WHERE name = ? AND day = ? AND id = ? AND claimed = 0");
    this.qDPrune = this.db.prepare("DELETE FROM daily WHERE name = ? AND day < ?");
  }
  loadWallet(name: string): { coin: number; jade: number } {
    const r = this.qWLoad.get(name) as unknown as { coin: number; jade: number } | undefined;
    return r ? { coin: r.coin, jade: r.jade } : { coin: 0, jade: 0 };
  }
  saveWallet(name: string, coin: number, jade: number) { this.qWSave.run(name, coin, jade, Date.now()); }
  loadDaily(name: string, day: string): Map<string, TaskRow> {
    const out = new Map<string, TaskRow>();
    for (const r of this.qDLoad.all(name, day) as unknown as Array<{ id: string; have: number; claimed: number }>) out.set(r.id, { have: r.have, claimed: r.claimed === 1 });
    return out;
  }
  saveProgress(name: string, day: string, id: string, have: number) { this.qDSave.run(name, day, id, have); }
  prune(name: string, today: string) { this.qDPrune.run(name, today); }
  /** Atomically marks the task claimed and stores the new wallet. Returns false (and changes nothing) when it was already claimed. */
  claim(name: string, day: string, id: string, have: number, coin: number, jade: number): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.qDEnsure.run(name, day, id, have);
      const changed = Number(this.qDClaim.run(name, day, id).changes);
      if (changed !== 1) { this.db.exec("ROLLBACK"); return false; }
      this.qWSave.run(name, coin, jade, Date.now());
      this.db.exec("COMMIT");
      return true;
    } catch (e) { try { this.db.exec("ROLLBACK"); } catch { /* not in a transaction */ } throw e; }
  }
  close() { this.db.close(); }
}

// ---------------- service ----------------
interface EcoState { coin: number; jade: number; day: string; ids: string[]; tasks: Map<string, TaskRow> }

export class Economy {
  private st = new WeakMap<Player, EcoState>();
  constructor(readonly db: EconomyDb, readonly clock: () => number = serverNow) {}

  private build(name: string, wallet: { coin: number; jade: number }): EcoState {
    const day = dayKey(this.clock());
    const ids = dailyIdsFor(day);
    const rows = this.db.loadDaily(name, day);
    const tasks = new Map<string, TaskRow>();
    for (const id of ids) tasks.set(id, rows.get(id) ?? { have: 0, claimed: false });
    return { coin: wallet.coin, jade: wallet.jade, day, ids, tasks };
  }
  /** State for a player, created lazily; rolls the board over when the UTC day changed. Returns [state, rolledOver]. */
  private get(p: Player): [EcoState, boolean] {
    let s = this.st.get(p);
    if (!s) { s = this.build(p.n, this.db.loadWallet(p.n)); this.st.set(p, s); this.db.prune(p.n, pruneBefore(this.clock())); return [s, false]; }
    if (s.day !== dayKey(this.clock())) {
      const fresh = this.build(p.n, { coin: s.coin, jade: s.jade });
      this.st.set(p, fresh); this.db.prune(p.n, pruneBefore(this.clock()));
      return [fresh, true];
    }
    return [s, false];
  }
  private state(w: World, p: Player): EcoState {
    const [s, rolled] = this.get(p);
    if (rolled) { this.sendDaily(w, p); this.sys(w, p, "The notice board has been refreshed: new daily tasks are up."); }
    return s;
  }
  private sys(w: World, p: Player, text: string) { w.sysTo(p, text); }

  // ---- reads ----
  wallet(w: World, p: Player) { const s = this.state(w, p); return { coin: s.coin, jade: s.jade }; }
  tasks(w: World, p: Player): DailyTask[] {
    const s = this.state(w, p);
    return s.ids.map((id) => {
      const d = DEFS.get(id)!, t = s.tasks.get(id)!, have = Math.min(t.have, d.need);
      return { id, title: d.title, desc: d.desc, have, need: d.need, coin: d.coin, jade: d.jade, xp: d.xp, done: have >= d.need, claimed: t.claimed };
    });
  }
  resetIn() { return secondsToReset(this.clock()); }

  // ---- sends ----
  sendWallet(w: World, p: Player) { const s = this.state(w, p); p.send(JSON.stringify({ t: "wallet", coin: s.coin, jade: s.jade } satisfies ServerMsg)); }
  sendDaily(w: World, p: Player) { p.send(JSON.stringify({ t: "daily", tasks: this.tasks(w, p), resetIn: this.resetIn() } satisfies ServerMsg)); }

  /** After `welcome`: loads the persisted wallet + today's progress and sends both. */
  login(w: World, p: Player) { this.st.delete(p); this.state(w, p); this.sendWallet(w, p); this.sendDaily(w, p); }

  /** Once a second from the server loop: players online across 00:00 UTC get the fresh board without doing anything. */
  tick(w: World) { for (const p of w.players.values()) this.state(w, p); }

  // ---- currency ----
  addCoin(w: World, p: Player, n: number) {
    n = Math.floor(n); if (!(n > 0)) return;
    const s = this.state(w, p); s.coin += n;
    this.db.saveWallet(p.n, s.coin, s.jade); this.sendWallet(w, p);
  }
  addJade(w: World, p: Player, n: number) {
    n = Math.floor(n); if (!(n > 0)) return;
    const s = this.state(w, p); s.jade += n;
    this.db.saveWallet(p.n, s.coin, s.jade); this.sendWallet(w, p);
  }
  /** TEST_MODE: relative wallet change (never below 0). */
  adjust(w: World, p: Player, dCoin: number, dJade: number) {
    const s = this.state(w, p);
    s.coin = Math.max(0, s.coin + Math.trunc(dCoin)); s.jade = Math.max(0, s.jade + Math.trunc(dJade));
    this.db.saveWallet(p.n, s.coin, s.jade); this.sendWallet(w, p);
  }

  // ---- gameplay hooks ----
  /** A credited kill: coin drop, boss jade, daily kill progress. `lvBefore` = the player's level before the kill's XP was granted. */
  onKill(w: World, p: Player, m: Mob, lvBefore: number) {
    const boss = !!m.def.boss;
    const drop = boss || (p.testDrops && process.env.TEST_MODE === "1") || Math.random() < COIN.dropChance;
    if (drop) {
      const grey = Math.max(COIN.minGreyMult, Math.min(1, xpLevelMult(m.lv - lvBefore)));
      const coin = Math.max(1, Math.round((COIN.base + COIN.perLv * m.lv) * rand(COIN.spread[0], COIN.spread[1]) * grey * (boss ? COIN.bossMult : 1)));
      this.addCoin(w, p, coin);
      this.sys(w, p, `You found ${coin} coin.`);
    }
    if (boss) { this.addJade(w, p, JADE.bossKill); this.sys(w, p, `You received ${JADE.bossKill} jade.`); }
    this.progress(w, p, "kill", m.def.type, 1);
  }
  /** Elder Lin's whole chain finished. */
  onChainComplete(w: World, p: Player) { this.addJade(w, p, JADE.chainComplete); this.sys(w, p, `You received ${JADE.chainComplete} jade.`); }
  onLoot(w: World, p: Player, item: string, qty: number) { this.progress(w, p, "loot", item, qty); }
  onXp(w: World, p: Player, amount: number) { this.progress(w, p, "xp", "", amount); }
  onTalk(w: World, p: Player, npc: string) { this.progress(w, p, "talk", npc, 1); }

  /** Advance every matching, unfinished task of today's board; send `daily` once if anything changed. */
  progress(w: World, p: Player, kind: DailyDef["kind"], target: string, qty: number) {
    qty = Math.floor(qty); if (!(qty > 0)) return;
    const s = this.state(w, p);
    const finished: DailyDef[] = [];
    let changed = false;
    for (const id of s.ids) {
      const d = DEFS.get(id)!, t = s.tasks.get(id)!;
      if (d.kind !== kind || (kind !== "xp" && d.target !== target) || t.claimed || t.have >= d.need) continue;
      t.have = Math.min(d.need, t.have + qty); changed = true;
      this.db.saveProgress(p.n, s.day, id, t.have);
      if (t.have >= d.need) finished.push(d);
    }
    if (!changed) return;
    this.sendDaily(w, p);
    for (const d of finished) this.sys(w, p, `Daily complete: ${d.title}. Claim it from the notice board.`);
  }
  /** TEST_MODE: complete task number `n` (1-based) or all tasks when `n` is 0. */
  completeAll(w: World, p: Player, n = 0) {
    const s = this.state(w, p);
    s.ids.forEach((id, i) => {
      if (n && i + 1 !== n) return;
      const d = DEFS.get(id)!, t = s.tasks.get(id)!;
      if (t.claimed) return;
      t.have = d.need; this.db.saveProgress(p.n, s.day, id, t.have);
    });
    this.sendDaily(w, p);
  }

  /** Client `{t:"claim", id}`. Validates, grants exactly once, answers with wallet + daily + a system line. Never throws. */
  claim(w: World, p: Player, id: unknown) {
    try {
      const s = this.state(w, p);
      if (typeof id !== "string" || id.length === 0 || id.length > 64 || !s.ids.includes(id)) { this.sys(w, p, "That is not one of today's daily tasks."); this.sendDaily(w, p); return; }
      const d = DEFS.get(id)!, t = s.tasks.get(id)!;
      if (t.claimed) { this.sys(w, p, "You already claimed that reward today."); this.sendDaily(w, p); return; }
      if (t.have < d.need) { this.sys(w, p, "That task is not complete yet."); this.sendDaily(w, p); return; }
      t.claimed = true;                                  // flipped before anything else: a re-entrant/duplicate claim sees it
      let ok: boolean;
      try { ok = this.db.claim(p.n, s.day, id, t.have, s.coin + d.coin, s.jade + d.jade); }
      catch (e) { t.claimed = false; console.log(new Date().toISOString(), "claim failed", e); this.sys(w, p, "The notice board is busy; try again."); return; }
      if (!ok) { this.sys(w, p, "You already claimed that reward today."); this.sendDaily(w, p); return; } // db says it was claimed: stay claimed, grant nothing
      s.coin += d.coin; s.jade += d.jade;
      this.sendWallet(w, p); this.sendDaily(w, p);
      this.sys(w, p, `Daily claimed: ${d.title} (+${d.coin} coin, +${d.jade} jade, +${d.xp} XP)`);
      if (d.xp > 0) grantXp(w, p, d.xp, "daily");
    } catch (e) { console.log(new Date().toISOString(), "claim error", e); }
  }

  /** `/daily` (and Fen): the board as system lines. */
  printBoard(w: World, p: Player) {
    const ts = this.tasks(w, p), s = this.state(w, p);
    this.sys(w, p, `Daily tasks (resets in ${fmtReset(this.resetIn())}):`);
    for (const t of ts) this.sys(w, p, `- ${t.title}: ${t.have}/${t.need} (+${t.coin} coin, +${t.jade} jade, +${t.xp} XP) [${t.claimed ? "claimed" : t.done ? "ready to claim" : "in progress"}]`);
    this.sys(w, p, `Wallet: ${s.coin} coin, ${s.jade} jade`);
  }
}

// ---------------- module singleton used by the game code (no-ops until initEconomy ran, e.g. in unit tests of World) ----------------
let current: Economy | undefined;
export function initEconomy(dbPath: string, clock?: () => number): Economy { current = new Economy(new EconomyDb(dbPath), clock); return current; }
export const economy = () => current;
export const ecoLogin = (w: World, p: Player) => current?.login(w, p);
export const ecoTick = (w: World) => current?.tick(w);
export const ecoKill = (w: World, p: Player, m: Mob, lvBefore: number) => current?.onKill(w, p, m, lvBefore);
export const ecoLoot = (w: World, p: Player, item: string, qty: number) => current?.onLoot(w, p, item, qty);
export const ecoXp = (w: World, p: Player, amount: number) => current?.onXp(w, p, amount);
export const ecoTalk = (w: World, p: Player, npc: string) => current?.onTalk(w, p, npc);
export const ecoChainComplete = (w: World, p: Player) => current?.onChainComplete(w, p);
export const ecoClaim = (w: World, p: Player, id: unknown) => current?.claim(w, p, id);
export const ecoBoard = (w: World, p: Player) => (current ? (current.printBoard(w, p), true) : false);
