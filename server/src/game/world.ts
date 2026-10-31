import { INTEREST_RADIUS, PLAYER_SPEED, SNAPSHOT_RATE, TICK_RATE, WORLD_SIZE } from "../../../shared/protocol.ts";
import type { ClassId, GameEvent, InvItem, ServerMsg } from "../../../shared/protocol.ts";
import { LANTERN_TIDE, MARKET_DAY, MIST_SURGE, NPCS, QI, TUNING, ZONE, lanternTideAt, marketDayAt, maxHpFor, mistSurgeAt } from "../data.ts";
import { handleCommand, questProximity } from "./quests.ts";
import { contentTick } from "./content.ts";
import { emptyGear } from "./gear.ts";
import { testCommand } from "./testmode.ts";
import { dashTick, dodgeCooldownLeft, handleDodge, qiTick } from "./dodge.ts";
import { handleCast, killPlayer, poisonTick, xpEvent } from "./combat.ts";
import { SpatialGrid } from "./grid.ts";
import { spawnMobs, updateMob } from "./mobs.ts";
import { PartyManager } from "./party.ts";
import { ChestManager } from "./chests.ts";
import { TradeManager } from "./trade.ts";
import { TrialManager } from "./trial.ts";
import type { Entity, Mob, Npc, Player, QuestState } from "./types.ts";
import { TokenBucket, clamp, dist, isNum, rand, round2 } from "./util.ts";

const DT = 1 / TICK_RATE;
/** 0.5.0 spirit-sword mount: a fast travel toggle. While `Player.mounted`, the authoritative step and the anti-cheat
 *  ceilings both scale by this multiplier, so a mounted player moves faster without tripping the movement accounting
 *  (unmounted players keep exactly PLAYER_SPEED). Handle with care: the mount is the only speed buff in the build. */
export const MOUNT = { speedMult: 1.6 };
/** Movement accounting: real per-tick displacement may not exceed PLAYER_SPEED*speedMult*dt*(1+tol), and the sum over a
 *  1 s sliding window may not exceed PLAYER_SPEED*speedMult*(1+tol). speedMult() supplies the one sanctioned speed buff
 *  (the spirit-sword mount); everything else must stay at 1. */
const MOVE_TOL = 0.25, MOVE_WINDOW_TICKS = TICK_RATE, MOVE_EPS = 0.02;
const MOVE_KICK_COUNT = 20, MOVE_KICK_SECS = 10;
const speedMult = (p: Player) => (p.mounted ? MOUNT.speedMult : 1);
interface MoveAcct { lx: number; lz: number; win: number[]; viol: number[]; total: number }
const SNAP_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);

// 0.5.0 Mist Surge announcements (system chat, `sys:true`). The client banner keys off the first line, so keep the wording stable.
const SURGE_PCT = Math.round((MIST_SURGE.mobDamageMult - 1) * 100);
const surgeStartLine = (secs: number) => `The mist surges! Mobs deal +${SURGE_PCT}% damage for ${secs} s.`;
const SURGE_END_LINE = "The mist recedes. Mobs deal normal damage again.";

// 0.5.0 Lantern Tide announcements (same pattern; the gold client banner keys off these exact lines).
const TIDE_COIN_PCT = Math.round((LANTERN_TIDE.coinMult - 1) * 100);
const TIDE_XP_PCT = Math.round((LANTERN_TIDE.xpMult - 1) * 100);
const tideStartLine = (secs: number) => `The lantern tide rises! Slain mobs give +${TIDE_COIN_PCT}% coin and +${TIDE_XP_PCT}% XP for ${secs} s.`;
const TIDE_END_LINE = "The lantern tide ebbs. Kill rewards return to normal.";

// 0.5.0 Market Day announcements (same pattern; the paper-red client banner keys off these exact lines).
const MARKET_SELL_PCT = Math.round((MARKET_DAY.sellMult - 1) * 100);
const MARKET_BUY_PCT = Math.round((1 - MARKET_DAY.buyMult) * 100);
const marketStartLine = (secs: number) => `The market day opens! Peddler Hao pays +${MARKET_SELL_PCT}% for goods and sells at -${MARKET_BUY_PCT}% for ${secs} s.`;
const MARKET_END_LINE = "The market day closes. Peddler Hao's prices return to normal.";

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
  /** 0.5.0 session-only party (group) state: members, invites, leader migration, login sync and disconnect cleanup. */
  readonly party: PartyManager;
  /** 0.5.0 session-only treasure caches: fixed spots + open/respawn state, pushed via its own `chests` message. */
  readonly chests: ChestManager;
  /** 0.5.0 session-only player-to-player trading: requests, two-sided offers, ready flags and the atomic swap. */
  readonly trade: TradeManager;
  /** 0.5.0 P3 "The Hollow Trial": the repeatable wave challenge at its gate (spawns, waves, modifiers, rewards, cleanup). */
  readonly trial: TrialManager;
  private nextId = 1;
  /** 0.5.0 Mist Surge: the last window state published to players (start/end are announced only on transitions). */
  private surgeActive = false;
  /** 0.5.0 Mist Surge: players that already got the login-time state (sent with their first snapshot, i.e. after `welcome`). */
  private readonly surgeKnown = new WeakSet<Player>();
  /** 0.5.0 Lantern Tide: the last window state published to players (start/end are announced only on transitions). */
  private tideActive = false;
  /** 0.5.0 Lantern Tide: players that already got the login-time state (sent with their first snapshot). */
  private readonly tideKnown = new WeakSet<Player>();
  /** 0.5.0 Market Day: the last window state published to players (start/end are announced only on transitions). */
  private marketActive = false;
  /** 0.5.0 Market Day: players that already got the login-time state (sent with their first snapshot). */
  private readonly marketKnown = new WeakSet<Player>();
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
    this.party = new PartyManager(this);
    this.chests = new ChestManager(this);
    this.trade = new TradeManager(this);
    this.trial = new TrialManager(this);
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
      state: { id, k: "player", n: info.name, x, z, r: 0, hp: mhp, mhp, lv: info.level, cls: info.cls, st: "idle", mounted: false },
      cls: info.cls, xp: info.xp, inDx: 0, inDz: 0, inTime: -99, ack: 0,
      cdReady: [0, 0, 0, 0, 0], gcdReady: 0, lastHurt: -99, attackUntil: 0, respawnAt: 0, guardUntil: 0, guardMult: 1,
      send, known: new Set(), chatBucket: new TokenBucket(4, 1 / 1.5),
      quest: info.quest ? { ...info.quest } : { stage: 0, status: 0, progress: 0, progress2: 0, mei: 0 }, nearElder: false,
      inv: new Map((info.inv ?? []).map((i) => [i.item, { ...i }])),
      poisonUntil: 0, poisonNext: 0, poisonDmg: 0, poisonSrc: 0,
      qi: QI.max, mqi: QI.max, qiResumeAt: 0, qiMsgAt: -99,
      dodgeReady: 0, dashUntil: 0, dashLeft: 0, dashDx: 0, dashDz: 0, invulnUntil: 0, mounted: false,
      gear: emptyGear(), potionReady: 0, // 0.4.0 content: equipment bonuses start empty until contentLogin loads the character's gear
    };
    this.entities.set(id, p);
    this.players.set(id, p);
    this.acct.set(p, { lx: x, lz: z, win: [], viol: [], total: 0 });
    this.byName.set(info.name.toLowerCase(), p);
    return p;
  }

  removePlayer(p: Player) {
    this.party.onPlayerLeft(p); // 0.5.0: drop party membership / pending invites before the player leaves the world
    this.trade.onPlayerLeft(p); // 0.5.0: end any trade session (references only - nothing was moved) + pending requests
    this.trial.onPlayerLeft(p); // 0.5.0 P3: drop trial participation (fails + cleans the run if nobody is left)
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

  cast(p: Player, msg: { skill: unknown; target?: unknown; tx?: unknown; tz?: unknown }) { if (p.mounted) this.dismount(p); handleCast(this, p, msg); }
  dodge(p: Player, msg: { dx?: unknown; dz?: unknown }) { handleDodge(this, p, msg); }

  // ---------- spirit-sword mount (0.5.0) ----------
  /** Toggle the spirit-sword mount. Server-authoritative: the client only asks; the movement step and the anti-cheat
   *  ceilings read `Player.mounted` (the only sanctioned speed buff), and snapshots echo the flag for the jian model. */
  toggleMount(p: Player) {
    if (p.st === "dead") { this.sysTo(p, "You cannot ride a spirit jian while fallen."); return; }
    p.mounted = !p.mounted;
    this.resync(p); // the speed change starts a fresh movement baseline: never straddle the average window across it
    this.sysTo(p, p.mounted ? "You step onto your spirit jian and rise. (R to dismount)" : "You step down from your spirit jian.");
  }
  /** Force-dismount (casting must be grounded): no chat line, but reset the movement baseline like a manual dismount. */
  private dismount(p: Player) {
    if (!p.mounted) return;
    p.mounted = false;
    this.resync(p);
  }

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
    // 0.5.0 party chat commands: /invite <name>, /accept, /decline, /leave (+ /party resync) — the same actions the
    // `{t:"party"}` message carries, wired here so typed commands work with the standard chat path.
    if (this.party.chatCommand(p, text)) return;
    // 0.5.0 trading chat commands: /trade <name>, /trade accept, /trade decline, /trade cancel (the same actions the
    // `{t:"trade"}` message carries). This sits after the party commands so "/trade" cannot shadow anything else.
    if (this.trade.chatCommand(p, text)) return;
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

  // ---------- Mist Surge (0.5.0 repeating world event) ----------
  /** Publish a surge start/end transition: the structured `surge` state plus a system announcement for everyone. */
  private publishSurge() {
    const s = mistSurgeAt(this.time);
    if (s.active === this.surgeActive) return;
    this.surgeActive = s.active;
    const json = JSON.stringify({ t: "surge", active: s.active, endsIn: s.endsIn } satisfies ServerMsg);
    for (const p of this.players.values()) p.send(json);
    this.sysAll(s.active ? surgeStartLine(s.endsIn) : SURGE_END_LINE);
  }

  /** Login state of the event: sent once per connection with the first snapshot (so it lands after `welcome`). */
  private sendSurgeLogin(p: Player) {
    const s = mistSurgeAt(this.time);
    p.send(JSON.stringify({ t: "surge", active: s.active, endsIn: s.endsIn } satisfies ServerMsg));
    if (s.active) this.sysTo(p, surgeStartLine(s.endsIn)); // the banner also needs the remaining time on a mid-surge login
  }

  // ---------- Lantern Tide (0.5.0 repeating world event #2) ----------
  /** Publish a tide start/end transition: the structured `tide` state plus a system announcement for everyone. */
  private publishTide() {
    const s = lanternTideAt(this.time);
    if (s.active === this.tideActive) return;
    this.tideActive = s.active;
    const json = JSON.stringify({ t: "tide", active: s.active, endsIn: s.endsIn } satisfies ServerMsg);
    for (const p of this.players.values()) p.send(json);
    this.sysAll(s.active ? tideStartLine(s.endsIn) : TIDE_END_LINE);
  }

  /** Login state of the tide: sent once per connection with the first snapshot, with the remaining seconds when active. */
  private sendTideLogin(p: Player) {
    const s = lanternTideAt(this.time);
    p.send(JSON.stringify({ t: "tide", active: s.active, endsIn: s.endsIn } satisfies ServerMsg));
    if (s.active) this.sysTo(p, tideStartLine(s.endsIn));
  }

  // ---------- Market Day (0.5.0 repeating world event #3) ----------
  /** Publish a market start/end transition: the structured `market` state plus a system announcement for everyone. */
  private publishMarket() {
    const s = marketDayAt(this.time);
    if (s.active === this.marketActive) return;
    this.marketActive = s.active;
    const json = JSON.stringify({ t: "market", active: s.active, endsIn: s.endsIn } satisfies ServerMsg);
    for (const p of this.players.values()) p.send(json);
    this.sysAll(s.active ? marketStartLine(s.endsIn) : MARKET_END_LINE);
  }

  /** Login state of the market: sent once per connection with the first snapshot, with the remaining seconds when active. */
  private sendMarketLogin(p: Player) {
    const s = marketDayAt(this.time);
    p.send(JSON.stringify({ t: "market", active: s.active, endsIn: s.endsIn } satisfies ServerMsg));
    if (s.active) this.sysTo(p, marketStartLine(s.endsIn));
  }

  // ---------- simulation ----------
  step() {
    this.tickNo++;
    this.time += DT;
    this.publishSurge(); // 0.5.0: derive the Mist Surge window from the clock and announce only when it changes
    this.publishTide();  // 0.5.0: ...and the Lantern Tide window the same way
    this.publishMarket(); // 0.5.0: ...and the Market Day window
    for (const p of this.players.values()) this.updatePlayer(p);
    if (this.tickNo % 10 === 0) for (const p of this.players.values()) if (p.st !== "dead") { questProximity(this, p); contentTick(this, p); }
    if (this.tickNo % 10 === 0) this.party.tick(); // 0.5.0: expire invites + resync member hp/level on the 0.5 s beat
    if (this.tickNo % 10 === 0) this.chests.tick(); // 0.5.0: refill opened treasure caches + push the state when one comes back
    if (this.tickNo % 10 === 0) this.trade.tick(); // 0.5.0: expire trade requests + re-validate live trade sessions (range/items/coin)
    if (this.tickNo % 10 === 0) this.trial.tick(); // 0.5.0 P3: Hollow Trial waves, timer, participant checks and cleanup
    for (const m of this.mobs) updateMob(this, m, DT);
    this.rebuildGrid();
    if (this.tickNo % SNAP_EVERY === 0) this.sendSnapshots();
  }

  private updatePlayer(p: Player) {
    if (p.mounted && p.st === "dead") this.dismount(p); // 0.5.0 sanity: a fallen rider leaves the jian
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
      const step = PLAYER_SPEED * speedMult(p) * DT * Math.min(mag, 1); // 0.5.0: mounted riders move MOUNT.speedMult faster
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
      // 0.4.0 additive burn flag: mobs only (players never take burn damage), mutated on the reused state object so it costs nothing
      if (e.k === "mob") s.burning = e.burnUntil > 0;
      else if (e.k === "player") s.mounted = e.mounted; // 0.5.0: the client draws the jian + trail from this flag
    }
    for (const p of this.players.values()) {
      const ents: Entity["state"][] = [];
      const cur = new Set<number>();
      this.grid.query(p.x, p.z, INTEREST_RADIUS, (e) => { ents.push(e.state); cur.add(e.id); });
      const gone: number[] = [];
      for (const id of p.known) if (!cur.has(id)) gone.push(id);
      p.known = cur;
      p.send(JSON.stringify({ t: "snap", tick: this.tickNo, ack: p.ack, ents, gone, qi: Math.round(p.qi * 10) / 10, mqi: p.mqi, dcd: round2(dodgeCooldownLeft(this, p)) } satisfies ServerMsg));
      if (!this.surgeKnown.has(p)) { this.surgeKnown.add(p); this.sendSurgeLogin(p); } // 0.5.0: current event state, once per connection
      if (!this.tideKnown.has(p)) { this.tideKnown.add(p); this.sendTideLogin(p); }    // 0.5.0: ...and the second world event
      if (!this.marketKnown.has(p)) { this.marketKnown.add(p); this.sendMarketLogin(p); } // 0.5.0: ...and the third (Market Day)
      this.party.onLogin(p); // 0.5.0: party state once per connection (guarded internally; usually a solo `members:null`)
      this.chests.onLogin(p); // 0.5.0: the fixed treasure-cache list once per connection
      this.trade.onLogin(p); // 0.5.0: trade state once per connection (usually `state:null`)
      this.trial.onLogin(p); // 0.5.0 P3: Hollow Trial state once per connection (idle + gate + cooldown, or the live run)
    }
  }

  /** Force-kill helper used by shutdown paths/tests; not exposed over the wire. */
  debugKill(p: Player) { killPlayer(this, p); }
}
