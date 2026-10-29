import { INTEREST_RADIUS, PLAYER_SPEED, SNAPSHOT_RATE, TICK_RATE, WORLD_SIZE } from "../../../shared/protocol.ts";
import type { ClassId, GameEvent, InvItem, ServerMsg } from "../../../shared/protocol.ts";
import { NPCS, QI, TUNING, ZONE, maxHpFor } from "../data.ts";
import { handleCommand, questProximity } from "./quests.ts";
import { contentTick } from "./content.ts";
import { emptyGear } from "./gear.ts";
import { testCommand } from "./testmode.ts";
import { dashTick, dodgeCooldownLeft, handleDodge, qiTick } from "./dodge.ts";
import { handleCast, killPlayer, poisonTick, xpEvent } from "./combat.ts";
import { SpatialGrid } from "./grid.ts";
import { spawnMobs, updateMob } from "./mobs.ts";
import type { Entity, Mob, Npc, Player, QuestState } from "./types.ts";
import { TokenBucket, clamp, dist, isNum, rand, round2 } from "./util.ts";

const DT = 1 / TICK_RATE;
/** Movement accounting: real per-tick displacement may not exceed PLAYER_SPEED*dt*(1+tol), and the sum over a
 *  1 s sliding window may not exceed PLAYER_SPEED*(1+tol). No speed buffs exist in this build; if one is added,
 *  return its multiplier from speedMult(). */
const MOVE_TOL = 0.25, MOVE_WINDOW_TICKS = TICK_RATE, MOVE_EPS = 0.02;
const MOVE_KICK_COUNT = 20, MOVE_KICK_SECS = 10;
const speedMult = (_p: Player) => 1;
interface MoveAcct { lx: number; lz: number; win: number[]; viol: number[]; total: number }
const SNAP_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);

export interface JoinInfo { name: string; cls: ClassId; level: number; xp: number; x?: number; z?: number; quest?: QuestState; inv?: InvItem[] }

export class World {
  time = 0;
  tickNo = 0;
  readonly half = WORLD_SIZE / 2 - 0.5;
  readonly entities = new Map<number, Entity>();
  readonly players = new Map<number, Player>();
  readonly byName = new Map<string, Player>();
  readonly mobs: Mob[];
  readonly grid = new SpatialGrid(30);
  private nextId = 1;
  /** Set by the server to persist quest progress. */
  onQuestChange?: (p: Player) => void;
  /** Set by the server to persist one inventory stack (qty 0 = deleted). */
  /** Set by the server: called when a player exceeded the movement-violation limit (send error + disconnect). */
  onMoveKick?: (p: Player) => void;
  private readonly acct = new WeakMap<Player, MoveAcct>();
  /** Violation count for a player (diagnostics/tests). */
  moveViolations(p: Player) { return this.acct.get(p)?.total ?? 0; }
  /** Accept the player's current position as the new baseline (spawn, respawn, sanctioned teleport). */
  resync(p: Player) { const a = this.acct.get(p); if (a) { a.lx = p.x; a.lz = p.z; a.win.length = 0; } }
  onInvChange?: (p: Player, it: InvItem) => void;

  constructor() {
    for (const n of NPCS) {
      const id = this.allocId();
      const npc: Npc = { id, k: "npc", n: n.name, x: n.x, z: n.z, r: n.r, hp: 9999, mhp: 9999, lv: 60, st: "idle", visible: true,
        state: { id, k: "npc", n: n.name, x: n.x, z: n.z, r: n.r, hp: 9999, mhp: 9999, lv: 60, st: "idle" } };
      this.entities.set(id, npc);
    }
    this.mobs = spawnMobs(this);
    for (const m of this.mobs) this.entities.set(m.id, m);
    this.rebuildGrid();
  }

  allocId() { return this.nextId++; }

  // ---------- players ----------
  isNameOnline(name: string) { return this.byName.has(name.toLowerCase()); }

  addPlayer(info: JoinInfo, send: (s: string) => void): Player {
    const id = this.allocId();
    const mhp = maxHpFor(info.cls, info.level);
    const x = isNum(info.x) ? clamp(info.x, -this.half, this.half) : ZONE.spawn.x + rand(-4, 4);
    const z = isNum(info.z) ? clamp(info.z, -this.half, this.half) : ZONE.spawn.z + rand(-4, 4);
    const p: Player = {
      id, k: "player", n: info.name, x, z, r: 0, hp: mhp, mhp, lv: info.level, st: "idle", visible: true,
      state: { id, k: "player", n: info.name, x, z, r: 0, hp: mhp, mhp, lv: info.level, cls: info.cls, st: "idle" },
      cls: info.cls, xp: info.xp, inDx: 0, inDz: 0, inTime: -99, ack: 0,
      cdReady: [0, 0, 0, 0, 0], gcdReady: 0, lastHurt: -99, attackUntil: 0, respawnAt: 0, guardUntil: 0, guardMult: 1,
      send, known: new Set(), chatBucket: new TokenBucket(4, 1 / 1.5),
      quest: info.quest ? { ...info.quest } : { stage: 0, status: 0, progress: 0, progress2: 0, mei: 0 }, nearElder: false,
      inv: new Map((info.inv ?? []).map((i) => [i.item, { ...i }])),
      poisonUntil: 0, poisonNext: 0, poisonDmg: 0, poisonSrc: 0,
      qi: QI.max, mqi: QI.max, qiResumeAt: 0, qiMsgAt: -99,
      dodgeReady: 0, dashUntil: 0, dashLeft: 0, dashDx: 0, dashDz: 0, invulnUntil: 0,
      gear: emptyGear(), potionReady: 0, // 0.4.0 content: equipment bonuses start empty until contentLogin loads the character's gear
    };
    this.entities.set(id, p);
    this.players.set(id, p);
    this.acct.set(p, { lx: x, lz: z, win: [], viol: [], total: 0 });
    this.byName.set(info.name.toLowerCase(), p);
    return p;
  }

  removePlayer(p: Player) {
    this.entities.delete(p.id);
    this.players.delete(p.id);
    this.byName.delete(p.n.toLowerCase());
    for (const m of this.mobs) { m.threat.delete(p.id); if (m.target === p.id) m.target = 0; }
  }

  /** Called by the network layer on a validated `input` message. */
  applyInput(p: Player, seq: number, dx: number, dz: number) {
    if (seq < p.ack) return; // stale / out-of-order input: never applied, ack never moves backwards
    p.ack = seq;
    const mag = Math.hypot(dx, dz);
    if (mag > 1) { dx /= mag; dz /= mag; } // normalize: can never exceed PLAYER_SPEED
    p.inDx = dx; p.inDz = dz; p.inTime = this.time;
  }

  cast(p: Player, msg: { skill: unknown; target?: unknown; tx?: unknown; tz?: unknown }) { handleCast(this, p, msg); }
  dodge(p: Player, msg: { dx?: unknown; dz?: unknown }) { handleDodge(this, p, msg); }

  chat(p: Player, raw: string) {
    const text = Array.from(raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").trim()).slice(0, TUNING.chatMax).join("");
    if (!text) return;
    if (text.startsWith("/testwarp ") && process.env.TEST_MODE === "1") { // TEST_MODE only: unsanctioned jump, exercises movement accounting
      const [x, z] = text.split(/\s+/).slice(1).map(Number);
      if (isNum(x) && isNum(z)) { p.x = clamp(x, -this.half, this.half); p.z = clamp(z, -this.half, this.half); }
      return;
    }
    if (text.startsWith("/test") && testCommand(this, p, text)) { this.resync(p); return; } // TEST_MODE=1 only; bypasses the chat rate limit
    if (!p.chatBucket.take(this.time)) return this.sysTo(p, "You are speaking too quickly.");
    if (handleCommand(this, p, text)) return;
    this.broadcast({ k: "chat", from: p.n, text });
  }

  // ---------- events ----------
  private evJson(e: GameEvent) { return JSON.stringify({ t: "ev", e } satisfies ServerMsg); }
  emitTo(p: Player, e: GameEvent) { p.send(this.evJson(e)); }
  broadcast(e: GameEvent) { const s = this.evJson(e); for (const p of this.players.values()) p.send(s); }
  emitNear(x: number, z: number, e: GameEvent) {
    const s = this.evJson(e);
    for (const p of this.players.values()) if (dist(p.x, p.z, x, z) <= INTEREST_RADIUS + 5) p.send(s);
  }
  sysTo(p: Player, text: string) { this.emitTo(p, { k: "chat", from: "System", text, sys: true }); }
  sysAll(text: string) { this.broadcast({ k: "chat", from: "System", text, sys: true }); }
  sendXp(p: Player) { this.emitTo(p, xpEvent(p, 0)); }

  // ---------- simulation ----------
  step() {
    this.tickNo++;
    this.time += DT;
    for (const p of this.players.values()) this.updatePlayer(p);
    if (this.tickNo % 10 === 0) for (const p of this.players.values()) if (p.st !== "dead") { questProximity(this, p); contentTick(this, p); }
    for (const m of this.mobs) updateMob(this, m, DT);
    this.rebuildGrid();
    if (this.tickNo % SNAP_EVERY === 0) this.sendSnapshots();
  }

  private updatePlayer(p: Player) {
    if (p.st === "dead") {
      if (this.time >= p.respawnAt) {
        p.x = ZONE.spawn.x + rand(-4, 4); p.z = ZONE.spawn.z + rand(-4, 4);
        p.hp = p.mhp; p.st = "idle"; p.lastHurt = -99; p.inDx = p.inDz = 0; p.poisonUntil = 0; p.qi = p.mqi; p.dashLeft = 0; p.invulnUntil = 0; p.dodgeReady = 0; this.resync(p);
        this.sysTo(p, "You return to the plaza, renewed.");
      }
      return;
    }
    poisonTick(this, p);
    if ((p.st as string) === "dead") return;
    qiTick(this, p, DT);
    if (dashTick(this, p, DT, this.half)) { // dodge roll: server-driven displacement, exempt from the walking-speed accounting
      this.resync(p);
      p.st = "move";
      return;
    }
    const fresh = this.time - p.inTime <= TUNING.inputStale;
    const mag = fresh ? Math.hypot(p.inDx, p.inDz) : 0;
    if (mag > 1e-3) {
      const step = PLAYER_SPEED * DT * Math.min(mag, 1);
      p.x = clamp(p.x + (p.inDx / mag) * step, -this.half, this.half);
      p.z = clamp(p.z + (p.inDz / mag) * step, -this.half, this.half);
      p.r = Math.atan2(p.inDx, p.inDz);
    }
    if (p.hp < p.mhp && this.time - p.lastHurt > TUNING.outOfCombat)
      p.hp = Math.min(p.mhp, p.hp + p.mhp * TUNING.regenPctPerSec * DT);
    this.checkMovement(p);
    p.st = this.time < p.attackUntil ? "attack" : mag > 1e-3 ? "move" : "idle";
  }

  private checkMovement(p: Player) {
    const a = this.acct.get(p);
    if (!a) return;
    const maxStep = PLAYER_SPEED * speedMult(p) * DT * (1 + MOVE_TOL) + MOVE_EPS;
    let d = Math.hypot(p.x - a.lx, p.z - a.lz);
    let bad = d > maxStep;
    if (!bad) {
      a.win.push(d);
      if (a.win.length > MOVE_WINDOW_TICKS) a.win.shift();
      let sum = 0; for (const v of a.win) sum += v;
      bad = sum > PLAYER_SPEED * speedMult(p) * (a.win.length * DT) * (1 + MOVE_TOL) + MOVE_EPS;
    }
    if (!bad) { a.lx = p.x; a.lz = p.z; return; }
    p.x = a.lx; p.z = a.lz; d = 0; // snap back to the last valid position
    a.win.length = 0;
    a.total++;
    a.viol.push(this.time);
    while (a.viol.length && this.time - a.viol[0] > MOVE_KICK_SECS) a.viol.shift();
    if (a.viol.length >= MOVE_KICK_COUNT) { a.viol.length = 0; this.onMoveKick?.(p); }
  }

  private rebuildGrid() {
    this.grid.clear();
    for (const e of this.entities.values()) if (e.visible) this.grid.insert(e);
  }

  private sendSnapshots() {
    for (const e of this.entities.values()) {
      const s = e.state;
      s.x = round2(e.x); s.z = round2(e.z); s.r = round2(e.r);
      s.hp = Math.round(e.hp); s.mhp = e.mhp; s.lv = e.lv; s.st = e.st;
    }
    for (const p of this.players.values()) {
      const ents: Entity["state"][] = [];
      const cur = new Set<number>();
      this.grid.query(p.x, p.z, INTEREST_RADIUS, (e) => { ents.push(e.state); cur.add(e.id); });
      const gone: number[] = [];
      for (const id of p.known) if (!cur.has(id)) gone.push(id);
      p.known = cur;
      p.send(JSON.stringify({ t: "snap", tick: this.tickNo, ack: p.ack, ents, gone, qi: Math.round(p.qi * 10) / 10, mqi: p.mqi, dcd: round2(dodgeCooldownLeft(this, p)) } satisfies ServerMsg));
    }
  }

  /** Force-kill helper used by shutdown paths/tests; not exposed over the wire. */
  debugKill(p: Player) { killPlayer(this, p); }
}
