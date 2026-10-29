// Headless integration test: boots the real server (unless BOT_URL is set) and drives it with bot clients.
//   npm test                      -> spawns server on BOT_PORT (default 8971) with a temp DB, TEST_MODE=1 (admin hooks for the boss test)
//   BOT_URL=ws://host:8787 npm test -> test an already-running server
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { INTEREST_RADIUS, PLAYER_SPEED, PROTOCOL_VERSION, TICK_RATE, WORLD_SIZE, telegraphContains } from "../../shared/protocol.ts";
import type { ClassId, ClientMsg, EntityState, GameEvent, InvItem, MobType, ServerMsg, SkillDef, ZoneInfo } from "../../shared/protocol.ts";
import { DatabaseSync } from "node:sqlite";
import { MOBS, MOB_SPAWNS, ZONE } from "../src/data.ts";
import { CharacterDb } from "../src/db.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.BOT_PORT) || 8971;
const URL = process.env.BOT_URL || `ws://127.0.0.1:${PORT}`;
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;
const cjkFrames: string[] = []; // every raw server frame (all bots, whole run) that contains CJK
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const SUFFIX = String(Date.now() % 100000);
const GROVE = { x: -40, z: 10 };
const SLAM_MIN = 45;   // boss melee tops out at ~35 (53 enraged, never reached in tests); every telegraphed hit deals >= 52 unguarded
const BOSS = { x: 0, z: 85 };
const ELDER = { x: -4, z: -70 };
const POND_SHORE = { x: 25, z: -40 };

// ---------------- check collector ----------------
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}
async function until(cond: () => boolean, ms: number, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await sleep(step); }
  return cond();
}

// ---------------- bot client ----------------
class Bot {
  ws!: WebSocket;
  id = 0; zone?: ZoneInfo; skills: SkillDef[] = [];
  ents = new Map<number, EntityState>();
  everSeen = new Set<number>(); kinds = new Map<number, string>(); mobTypes = new Map<number, EntityState>(); goneIds = new Set<number>(); maxFromNpc = 0; npcRef?: { x: number; z: number };
  errors: string[] = []; closed = false; closeCode = 0;
  chats: Array<{ from: string; text: string; sys?: boolean; t: number }> = [];
  selfDeathAt = 0;
  evs: GameEvent[] = [];
  snaps = 0; firstSnapAt = 0; lastSnapAt = 0; lastTick = 0; ack = 0; ackBackwards = 0;
  badGone = 0; interestViolations = 0; maxSeenDist = 0; pongs: number[] = [];
  seq = 0; lastCast: Record<number, number> = {};
  lastXp?: { lv: number; xp: number; next: number }; xpGain = 0;
  wallet: { coin: number; jade: number } | null = null; dailyTasks: Array<{ id: string }> | null = null; // v3

  brain?: NodeJS.Timeout; mode: "idle" | "walk" | "fight" | "boss" = "idle";
  walkTo = { x: 0, z: 0 };
  castAttempts = 0;
  qi = 100; // own Qi from snapshots (0.4.0); bots keep a reserve for their defensive skill like a sensible player
  // v2: inventory, telegraphs, dodge
  inv: InvItem[] | null = null; invMsgs = 0; order: string[] = [];
  mobFilter?: MobType;
  tele: Array<{ x: number; z: number; radius: number; delayMs: number; at: number; landAt: number; src: number; shape?: "circle" | "cone" | "line"; dir?: number; arc?: number; len?: number; width?: number; sweep?: number; leadMs?: number; beam?: boolean }> = [];
  beamsSeen = 0;
  teleLog: Array<{ src: number; radius: number; delay: number; at: number; landAt: number; posAtLand?: { x: number; z: number }; distAtLand?: number; slamHit?: boolean; done?: boolean }> = [];
  dmgTaken: Array<{ t: number; src: number; amount: number }> = [];
  /** TEST_MODE only: in boss fights top the bot up with /testheal when low, so a stray hit does not cost it its place (and boss credit). Counted and reported, never silent. */
  safetyNet = false; netHeals = 0; private lastNet = 0;
  dodgeOn = false; dodging = false; dodgePt?: { x: number; z: number };

  pw: string | undefined = "botpass-1234";
  constructor(public name: string, public cls: ClassId) {}

  get me() { return this.ents.get(this.id); }
  sys(sub: string) { return this.chats.some((c) => c.sys && c.text.includes(sub)); }
  count(k: GameEvent["k"], pred: (e: any) => boolean = () => true) { return this.evs.filter((e) => e.k === k && pred(e)).length; }

  open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.on("open", () => res());
      this.ws.on("error", rej);
      this.ws.on("close", (c) => { this.closed = true; this.closeCode = c; });
      this.ws.on("message", (d) => { const s = d.toString(); if (CJK.test(s)) cjkFrames.push(s.slice(0, 160)); this.onMsg(JSON.parse(s)); });
    });
  }
  send(m: ClientMsg | Record<string, unknown>) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  say(text: string) { this.send({ t: "chat", text }); }
  raw(s: string | Buffer) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s); }

  async login(v = PROTOCOL_VERSION): Promise<boolean> {
    await this.open();
    this.send({ t: "login", name: this.name, cls: this.cls, v, pw: this.pw });
    return until(() => this.id !== 0 || this.errors.length > 0 || this.closed, 4000).then(() => this.id !== 0);
  }

  onMsg(m: ServerMsg) {
    if (this.order.length < 12) this.order.push(m.t);
    switch (m.t) {
      case "inv": this.inv = m.items; this.invMsgs++; break;
      case "wallet": this.wallet = { coin: m.coin, jade: m.jade }; break;
      case "daily": this.dailyTasks = m.tasks; break;
      case "welcome": this.id = m.id; this.zone = m.zone; this.skills = m.skills; break;
      case "error": this.errors.push(m.msg); break;
      case "pong": this.pongs.push(m.c); break;
      case "ev": {
        const e = m.e;
        this.evs.push(e);
        if (this.evs.length > 5000) this.evs.splice(0, 2500);
        if (e.k === "chat") this.chats.push({ from: e.from, text: e.text, sys: e.sys, t: Date.now() });
        if (e.k === "death" && e.id === this.id) this.selfDeathAt = Date.now();
        if (e.k === "damage" && e.dst === this.id) { this.dmgTaken.push({ t: Date.now(), src: e.src, amount: e.amount }); if (this.dmgTaken.length > 3000) this.dmgTaken.splice(0, 1500); }
        if (e.k === "telegraph") this.onTelegraph(e);
        if (e.k === "xp") { this.lastXp = { lv: e.lv, xp: e.xp, next: e.next }; this.xpGain += e.amount; }
        break;
      }
      case "snap": {
        this.snaps++;
        const now = Date.now();
        if (!this.firstSnapAt) this.firstSnapAt = now;
        this.lastSnapAt = now;
        if (m.ack < this.ack) this.ackBackwards++;
        this.ack = m.ack; this.lastTick = m.tick;
        if (typeof m.qi === "number") this.qi = m.qi;
        for (const id of m.gone) {
          if (!this.ents.has(id)) this.badGone++;
          this.ents.delete(id); this.goneIds.add(id);
        }
        const self = m.ents.find((e) => e.id === this.id);
        for (const e of m.ents) {
          this.ents.set(e.id, e); this.everSeen.add(e.id); this.kinds.set(e.id, e.k); if (e.k === "mob" && !this.mobTypes.has(e.id)) this.mobTypes.set(e.id, { ...e });
          if (self) {
            const d = dist(self.x, self.z, e.x, e.z);
            if (d > this.maxSeenDist) this.maxSeenDist = d;
            if (this.npcRef) this.maxFromNpc = Math.max(this.maxFromNpc, dist(self.x, self.z, this.npcRef.x, this.npcRef.z));
            if (d > INTEREST_RADIUS + 0.1) this.interestViolations++;
          }
        }
        break;
      }
    }
  }

  private onTelegraph(e: Extract<GameEvent, { k: "telegraph" }>) {
    const at = Date.now(), delayMs = e.delay * 1000;
    const rec = { x: e.x, z: e.z, radius: e.radius, delayMs, at, landAt: at + delayMs, src: e.src, shape: e.shape, dir: e.dir, arc: e.arc, len: e.len, width: e.width, sweep: e.sweep, leadMs: (e.lead ?? 0) * 1000, beam: e.beam };
    this.tele.push(rec);
    if (this.tele.length > 40) this.tele.splice(0, 20);
    if (e.beam) this.beamsSeen++;
    if (e.shape && e.shape !== "circle") return; // cones/lines/beams are not slam circles: the circle statistics below only cover those
    const log: (typeof this.teleLog)[number] = { src: e.src, radius: e.radius, delay: e.delay, at, landAt: rec.landAt };
    this.teleLog.push(log);
    // sample where we stand at landing, then (after the damage had time to arrive) whether a slam-sized hit reached us
    setTimeout(() => { const me = this.me; if (me) { log.posAtLand = { x: me.x, z: me.z }; log.distAtLand = dist(me.x, me.z, e.x, e.z) - e.radius; } }, delayMs);
    setTimeout(() => {
      log.slamHit = this.dmgTaken.some((d) => d.src === e.src && d.amount >= SLAM_MIN && d.t >= log.landAt - 250 && d.t <= log.landAt + 700);
      log.done = true;
    }, delayMs + 800);
  }

  /** Leave any active danger zone (with margin) before it lands; returns true while it is steering. */
  private dodge(me: EntityState): boolean {
    if (!this.dodgeOn) return false;
    const now = Date.now();
    const act = this.tele.filter((t) => now < t.landAt + 150 && now > t.at - 50);
    if (!act.length) { this.dodgePt = undefined; return false; }
    const beam = act.find((t) => t.beam);
    const flat = act.filter((t) => !t.beam);
    const inside = (x: number, z: number, m: number) => flat.some((t) => {
      if (!t.shape || t.shape === "circle") return dist(x, z, t.x, t.z) < t.radius + m;
      if (t.shape === "cone") return telegraphContains({ ...t, radius: t.radius + m, arc: (t.arc ?? 1.4) * 1.3 + 0.3 }, x, z);
      return telegraphContains({ ...t, len: (t.len ?? t.radius) + m, width: (t.width ?? 2) + 2 * m }, x, z);
    });
    // the rotating beam is checked along the whole path and for as long as it lasts: where it WILL be, not where it is
    const beamAt = (T: number) => { const f = Math.max(0, Math.min(1, (T - beam!.at - beam!.leadMs!) / (beam!.delayMs - beam!.leadMs!))); return (beam!.dir ?? 0) + (beam!.sweep ?? 0) * f; };
    const inBeam = (x: number, z: number, T: number, m: number) => !!beam && telegraphContains({ shape: "line", x: beam.x, z: beam.z, radius: beam.len ?? 28, len: (beam.len ?? 28) + m, width: (beam.width ?? 2.8) + 2 * m }, x, z, beamAt(T));
    const pathSafe = (px: number, pz: number, bm: number) => {
      const d = dist(me.x, me.z, px, pz), ux = d ? (px - me.x) / d : 0, uz = d ? (pz - me.z) / d : 0;
      const tEnd = Math.max(d / PLAYER_SPEED, 0) + 0.2, tBeam = beam ? Math.max(0, beam.landAt - now) / 1000 + 0.2 : 0;
      for (let t = 0; t <= Math.max(tEnd, tBeam); t += 0.1) {
        const k = Math.min(d, PLAYER_SPEED * t);
        if (inBeam(me.x + ux * k, me.z + uz * k, now + t * 1000 + 120, bm)) return false;
      }
      return true;
    };
    if (!this.dodgePt && !inside(me.x, me.z, 1.0) && !(beam && !pathSafe(me.x, me.z, 1.6))) return false;
    if (!this.dodgePt || inside(this.dodgePt.x, this.dodgePt.z, 0.8) || (beam && !pathSafe(this.dodgePt.x, this.dodgePt.z, 1.4))) {
      const tgt = this.nearestMob(this.mode === "boss");
      let best: { x: number; z: number } | undefined, bs = Infinity;
      for (let r = 2; r <= 22; r += 1.5) for (let a = 0; a < 360; a += 20) {
        const x = me.x + Math.cos((a * Math.PI) / 180) * r, z = me.z + Math.sin((a * Math.PI) / 180) * r;
        if (Math.abs(x) > 98 || Math.abs(z) > 98 || inside(x, z, 1.4)) continue;
        if (beam && !pathSafe(x, z, 1.6)) continue;
        const score = r + (tgt ? 0.15 * dist(x, z, tgt.e.x, tgt.e.z) : 0);
        if (score < bs) { bs = score; best = { x, z }; }
      }
      this.dodgePt = best;
    }
    if (!this.dodgePt) return false;
    const d = dist(me.x, me.z, this.dodgePt.x, this.dodgePt.z);
    if (d < 0.7) this.input(0, 0); else this.input((this.dodgePt.x - me.x) / d, (this.dodgePt.z - me.z) / d);
    return true;
  }

  // ---- movement helpers ----
  input(dx: number, dz: number) { this.send({ t: "input", seq: ++this.seq, dx, dz }); }
  startBrain() { this.brain = setInterval(() => this.think(), 50); }
  stop() { if (this.brain) clearInterval(this.brain); this.brain = undefined; }
  close() { this.stop(); this.ws?.close(); }

  private steer(tx: number, tz: number, stop: number) {
    if (this.dodging) return;
    const me = this.me!;
    const d = dist(me.x, me.z, tx, tz);
    if (d <= stop) return this.input(0, 0);
    this.input((tx - me.x) / d, (tz - me.z) / d);
  }

  private ready(skill: number) {
    const def = this.skills[skill - 1];
    if (!def || Date.now() - (this.lastCast[skill] ?? 0) <= def.cooldown * 1000 + 80) return false;
    const defensive = this.cls === "physician" ? skill === 2 || skill === 4 : skill === 4;
    const reserve = defensive ? 0 : this.cls === "physician" ? 22 : 15; // keep enough Qi for Qi Guard / Wind Step / Spring Rain
    return this.qi >= (def.qi ?? 0) + reserve;
  }
  private cast(skill: number, extra: Record<string, unknown>) {
    this.lastCast[skill] = Date.now(); this.castAttempts++;
    this.qi -= this.skills[skill - 1]?.qi ?? 0;
    this.send({ t: "cast", skill, ...extra });
  }

  private nearestMob(allowBoss: boolean) {
    const me = this.me!;
    let best: EntityState | undefined, bd = Infinity;
    for (const e of this.ents.values()) {
      if (e.k !== "mob" || e.st === "dead" || e.hp <= 0) continue;
      if (this.mobFilter && e.mob !== this.mobFilter) continue;
      if (!allowBoss && e.mob === "stone_guardian") continue;
      if (allowBoss && e.mob !== "stone_guardian") continue; // boss mode: ignore everything else
      const d = dist(me.x, me.z, e.x, e.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best && { e: best, d: bd };
  }

  private think() {
    const me = this.me;
    if (!me) return;
    if (me.st === "dead") return this.input(0, 0);
    if (this.safetyNet && me.hp / me.mhp < 0.4 && Date.now() - this.lastNet > 1800) { this.lastNet = Date.now(); this.netHeals++; this.send({ t: "chat", text: "/testheal" }); }
    this.dodging = this.dodge(me);
    if (this.mode === "idle") return;
    if (this.mode === "walk") return this.steer(this.walkTo.x, this.walkTo.z, 1);
    const near = this.nearestMob(this.mode === "boss");
    if (!near || near.d > 50) return this.steer(this.walkTo.x, this.walkTo.z, 3);
    const { e, d } = near;
    const melee = this.cls === "sword";
    this.steer(e.x, e.z, melee ? 2.5 : 10);
    const hpFrac = me.hp / me.mhp;
    const range = (s: number) => this.skills[s - 1].range;
    if (this.cls === "sword") {
      if (d <= range(3) && this.ready(3)) this.cast(3, { target: e.id });
      else if (d <= range(2) && d > 4 && this.ready(2)) this.cast(2, { target: e.id });
      else if (d <= range(1) && this.ready(1)) this.cast(1, { target: e.id });
      if (hpFrac < 0.4 && this.ready(4)) this.cast(4, {});
    } else if (this.cls === "talisman") {
      if (d <= range(2) && this.ready(2)) this.cast(2, { target: e.id, tx: e.x, tz: e.z });
      else if (d <= range(3) && this.ready(3)) this.cast(3, { target: e.id });
      else if (d <= range(1) && this.ready(1)) this.cast(1, { target: e.id });
    } else {
      if (hpFrac < 0.75 && this.ready(2)) this.cast(2, {});
      else if (d <= range(3) && this.ready(3)) this.cast(3, { target: e.id, tx: e.x, tz: e.z });
      else if (d <= range(1) && this.ready(1)) this.cast(1, { target: e.id });
      if (hpFrac < 0.35 && this.ready(4)) this.cast(4, {});
    }
  }
}

// ---------------- server process ----------------
let child: ChildProcess | undefined;
let tmp = "";
async function startServer() {
  if (process.env.BOT_URL) return;
  tmp = mkdtempSync(join(tmpdir(), "jiuzhou-test-"));
  child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmp, "test.db"), NODE_NO_WARNINGS: "1", TEST_MODE: "1", TEST_BOSS_RESPAWN: "20" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => process.env.BOT_VERBOSE && process.stdout.write(`[server] ${d}`));
  child.stderr!.on("data", (d) => process.stderr.write(`[server!] ${d}`));
  const ok = await until(() => false, 0).then(async () => {
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) return true; } catch { /* not up yet */ }
      await sleep(100);
    }
    return false;
  });
  if (!ok) throw new Error("server did not start");
}
async function stopServer() {
  if (!child) return;
  const exited = new Promise<number | null>((r) => child!.once("exit", (c) => r(c)));
  child.kill("SIGTERM");
  const code = await Promise.race([exited, sleep(5000).then(() => "timeout" as const)]);
  check("server shuts down cleanly on SIGTERM", code === 0, `exit=${code}`);
  if (code === "timeout") child.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
}
async function healthOk() {
  try { const r = await fetch(`http://${URL.replace(/^ws:\/\//, "")}/health`); return r.ok; } catch { return false; }
}

// ---------------- the test ----------------
async function main() {
  console.log(`JIUZHOU bot test -> ${URL}`);
  await startServer();

  // ===== A. protocol & robustness =====
  console.log("\n[A] protocol & robustness");
  {
    const b = new Bot("BadVer" + SUFFIX, "sword");
    await b.login(PROTOCOL_VERSION + 99);
    await until(() => b.closed, 2000);
    check("bad protocol version -> error + close", b.errors.some((e) => /version/i.test(e)) && b.closed, b.errors[0]);
  }
  {
    const b = new Bot("x", "sword");
    await b.login();
    check("invalid name rejected", b.id === 0 && b.errors.length > 0, b.errors[0]);
    b.send({ t: "login", name: "ValidName" + SUFFIX, cls: "wizard", v: PROTOCOL_VERSION });
    await until(() => b.errors.length > 1, 1500);
    check("invalid class rejected", b.id === 0 && b.errors.length > 1, b.errors[1]);
    b.close();
  }
  {
    const a = new Bot("Dupe" + SUFFIX, "sword");
    const okA = await a.login();
    const b = new Bot(("dupe" + SUFFIX).toUpperCase(), "talisman");
    const okB = await b.login();
    check("duplicate name (case-insensitive) rejected", okA && !okB && b.errors.some((e) => /in use/i.test(e)), b.errors[0]);
    a.close(); b.close();
    await sleep(300);
  }
  {
    const b = new Bot("Fuzz" + SUFFIX, "physician");
    await b.open();
    for (const junk of ["not json", "{", "null", "[]", '"str"', '{"t":5}', '{"t":"input"}', '{"t":"cast","skill":{}}',
      '{"t":"chat","text":{"a":1}}', '{"t":"nope"}', '{"t":"input","seq":1,"dx":1e999,"dz":0}'])
      b.raw(junk);
    b.raw(Buffer.from([1, 2, 3, 4]));
    await sleep(200);
    const b2 = new Bot("Fuzz2" + SUFFIX, "sword");
    await b2.login();
    b2.send({ t: "ping", c: 42 });
    await until(() => b2.pongs.includes(42), 1500);
    check("server survives malformed/abusive frames and still answers ping", b2.pongs.includes(42) && (await healthOk()));
    b2.raw("A".repeat(5000)); // over maxPayload -> server drops that socket only
    await until(() => b2.closed, 1500);
    check("oversize frame closes only that connection", b2.closed && (await healthOk()));
    b.close();
  }

  // ===== B. main scenario =====
  console.log("\n[B] gameplay scenario");
  const sword = new Bot("Jian" + SUFFIX, "sword");
  const talis = new Bot("Fu" + SUFFIX, "talisman");
  const phys = new Bot("Yi" + SUFFIX, "physician");
  const hacker = new Bot("Hax" + SUFFIX, "talisman");
  const doomed = new Bot("Doomed" + SUFFIX, "talisman");
  const fighters = [sword, talis, phys];
  const all = [sword, talis, phys, hacker, doomed];

  const logins = await Promise.all([sword, talis, phys].map((b) => b.login()));
  check("3 bots of different classes logged in", logins.every(Boolean) && new Set(fighters.map((b) => b.cls)).size === 3);
  await hacker.login(); await doomed.login();
  check("welcome has zone + 4 skills per class",
    fighters.every((b) => b.skills.length === 4 && b.zone?.id === "cloudmist_valley" && b.zone.nameZh === ""),
    fighters.map((b) => b.skills[0]?.nameZh).join("/"));
  check("class skills match DESIGN.md",
    sword.skills[0].name === "Flowing Slash" && talis.skills[1].kind === "aoe" && phys.skills[1].kind === "heal" && sword.skills.every((s) => s.nameZh === ""));

  await sleep(600);
  const TM0 = !process.env.BOT_URL;
  const elder = [...sword.ents.values()].find((e) => e.k === "npc" && e.n === "Elder Lin");
  if (elder) sword.npcRef = { x: elder.x, z: elder.z };
  check("NPC Elder Lin visible at spawn", !!elder, elder?.n);
  check("boss NOT in interest at spawn (distance > radius)", ![...sword.ents.values()].some((e) => e.mob === "stone_guardian"));

  // start fighters walking to the grove and fighting; doomed heads to the boss
  if (TM0) for (const b of fighters) b.send({ t: "chat", text: "/testdrops" }); // loot rolls are random (70%); make the drop checks deterministic
  for (const b of fighters) { b.mode = "fight"; b.mobFilter = "bamboo_spirit"; b.walkTo = { ...GROVE }; b.startBrain(); }
  doomed.mode = "boss"; doomed.walkTo = { x: 0, z: 76 }; doomed.startBrain();

  // --- pond bot (runs in parallel with everything below; checked in section [G]) ---
  const TM = !process.env.BOT_URL; // sections G/H need the TEST_MODE hooks of a server we spawned ourselves
  let pond: Bot | undefined;
  if (TM) {
    pond = new Bot("Pond" + SUFFIX, "sword");
    await pond.login();
    pond.send({ t: "chat", text: "/testlevel 5" }); pond.send({ t: "chat", text: "/testquest 2" }); pond.send({ t: "chat", text: `/testtp ${POND_SHORE.x} ${POND_SHORE.z + 3}` });
    pond.mobFilter = "jade_serpent"; pond.mode = "fight"; pond.walkTo = { ...POND_SHORE }; pond.dodgeOn = false; pond.startBrain();
  }

  // --- hacker: movement authority / speed hack / bounds / cooldown / range ---
  const H = hacker;
  const sample = () => ({ x: H.me!.x, z: H.me!.z, tick: H.lastTick });
  async function drive(dx: number, dz: number, ms: number, extra: Record<string, unknown> = {}) {
    const end = Date.now() + ms;
    while (Date.now() < end) { H.send({ t: "input", seq: ++H.seq, dx, dz, ...extra }); await sleep(50); }
  }
  H.input(0, 0); await sleep(300);
  let s0 = sample();
  await drive(1, 0, 1000); H.input(0, 0); await sleep(250);
  let s1 = sample();
  const moved = s1.x - s0.x;
  check("movement is server-integrated (1s of +x ~= PLAYER_SPEED)", moved > PLAYER_SPEED * 0.6 && moved <= PLAYER_SPEED * 1.1 && Math.abs(s1.z - s0.z) < 0.2, `moved ${moved.toFixed(2)}u`);
  check("snapshot ack tracks input seq", H.ack >= H.seq - 3 && H.ackBackwards === 0, `ack ${H.ack} / seq ${H.seq}`);

  s0 = sample();
  await drive(50, 50, 2000, { x: 0, z: 0, speed: 999 }); // oversize magnitude + extra fields
  await drive(1e5, 0, 500); // out-of-range values: ignored
  H.raw('{"t":"input","seq":99999,"dx":1e999,"dz":0}'); H.raw('{"t":"input","seq":99999,"dx":null,"dz":"x"}');
  await sleep(300);
  s1 = sample();
  const cap = ((s1.tick - s0.tick) / TICK_RATE) * PLAYER_SPEED + 0.5;
  const trav = dist(s0.x, s0.z, s1.x, s1.z);
  check("speed-hack input is clamped to PLAYER_SPEED", trav <= cap, `travelled ${trav.toFixed(1)}u, ceiling ${cap.toFixed(1)}u over ${s1.tick - s0.tick} ticks`);

  // world bounds: run -z for a long time
  await drive(0, -1, 5500); H.input(0, 0); await sleep(250);
  check("world bounds enforced", H.me!.z >= -WORLD_SIZE / 2 && H.me!.z > -100 && H.me!.z < -98.5, `z=${H.me!.z.toFixed(2)}`);
  await drive(0, 1, 800); H.input(0, 0);

  // cooldown validation: spam self-cast skill 4 (Wind Step cd 12s) -> only one cast event
  for (let i = 0; i < 8; i++) { H.send({ t: "cast", skill: 4 }); await sleep(30); }
  await sleep(300);
  check("server-side cooldown enforced (8 spammed casts -> 1 cast event)", H.count("cast", (e) => e.src === H.id) === 1, `${H.count("cast", (e) => e.src === H.id)} casts`);
  H.send({ t: "cast", skill: 1, target: elder?.id ?? 1 });
  H.send({ t: "cast", skill: 7, target: 1 }); H.send({ t: "cast", skill: 1, target: 123456 });
  await sleep(300);
  check("cast on non-mob / bad skill / bad target rejected", H.count("cast", (e) => e.src === H.id) === 1);

  // --- wait for the fight ---
  const isMobDeath = (b: Bot, e: any) => e.k === "death" && b.kinds.get(e.id) === "mob";
  const done = await until(() =>
    fighters.every((b) => b.xpGain > 0) && sword.count("death", (e) => isMobDeath(sword, e)) >= 3 && fighters.every((b) => b.count("damage", (e) => e.src === b.id) > 0),
    120_000, 250);
  console.log(`  (fight phase ${done ? "reached goals" : "TIMED OUT"})`);

  // range validation with a real mob id the hacker cannot reach
  const farMob = [...sword.ents.values()].find((e) => e.k === "mob" && e.mob !== "stone_guardian");
  if (farMob) {
    const before = H.count("cast", (e) => e.src === H.id);
    H.chats.length = 0;
    H.send({ t: "cast", skill: 1, target: farMob.id });
    await sleep(400);
    check("range validation: out-of-range cast on a real mob rejected", H.count("cast", (e) => e.src === H.id) === before && H.chats.some((c) => /range|target/i.test(c.text)), H.chats[0]?.text);
  }

  // movement authority sanity for the fighters: grove reached
  const nearGrove = fighters.map((b) => Math.round(dist(b.me!.x, b.me!.z, GROVE.x, GROVE.z)));
  check("bots walked to the bamboo grove", nearGrove.every((d) => d < 45), `distances ${nearGrove.join(",")}`);
  check("damage dealt by every class", fighters.every((b) => b.count("damage", (e) => e.src === b.id) > 0),
    fighters.map((b) => `${b.cls}:${b.count("damage", (e) => e.src === b.id)}`).join(" "));
  check("mobs killed (death events)", sword.count("death", (e) => isMobDeath(sword, e)) >= 3, `${sword.count("death", (e) => isMobDeath(sword, e))} kills seen`);
  check("XP gained by every bot", fighters.every((b) => b.xpGain > 0), fighters.map((b) => `${b.cls}:+${b.xpGain}`).join(" "));
  check("loot events received", fighters.some((b) => b.count("loot") > 0), `${fighters.reduce((n, b) => n + b.count("loot"), 0)} drops`);
  const lvl = fighters.map((b) => b.count("levelup"));
  console.log(`  info: level-ups ${lvl.join(",")}; final lv ${fighters.map((b) => b.me?.lv).join(",")}`);
  check("cast VFX events flow", fighters.every((b) => b.count("cast", (e) => e.src === b.id) > 0));
  console.log(`  info: heal events seen ${fighters.reduce((n, b) => n + b.count("heal"), 0)}, crits ${fighters.reduce((n, b) => n + b.count("damage", (e) => e.crit), 0)}`);

  // --- interest management ---
  const rate = sword.snaps / ((sword.lastSnapAt - sword.firstSnapAt) / 1000);
  check("snapshots arrive at ~SNAPSHOT_RATE (10Hz)", rate > 8 && rate < 12, `${rate.toFixed(1)}/s`);
  check("no entity beyond INTEREST_RADIUS ever sent", all.every((b) => b.interestViolations === 0), `max seen ${Math.max(...all.map((b) => b.maxSeenDist)).toFixed(1)}u (limit ${INTEREST_RADIUS})`);
  check("`gone` only lists previously-known ids", all.every((b) => b.badGone === 0));
  {
    // Deterministic: the fighting bot's path depends on its brain (it may die/respawn at the plaza), so use the
    // hacker, who is parked next to Elder Lin: teleport it out of the interest radius and require a `gone` for her.
    const hSawElder = !!elder && H.ents.has(elder.id);
    if (TM && elder && hSawElder) { const hx = H.me!.x, hz = H.me!.z; H.send({ t: "chat", text: "/testtp 90 90" }); await until(() => H.goneIds.has(elder.id), 3000, 100); H.send({ t: "chat", text: `/testtp ${hx} ${hz}` }); await sleep(200); }
    check("NPC left interest after walking away (gone sent)", !!elder && (TM ? H.goneIds.has(elder.id) : sword.goneIds.has(elder.id)), `hacker saw her: ${hSawElder}`);
  }
  check("boss never sent to fighters in the grove", fighters.every((b) => ![...b.everSeen].some((id) => id > 0 && b.ents.get(id)?.mob === "stone_guardian")));
  const hSeesMobs = [...H.ents.values()].filter((e) => e.k === "mob" && (e.mob === "bamboo_spirit" || e.mob === "fox_spirit")).length;
  check("far-away player (spawn) receives no grove/fox mobs (pond serpents may be in range)", hSeesMobs === 0, `${hSeesMobs} mobs`);

  // --- chat ---
  console.log("\n[C] chat");
  sword.send({ t: "chat", text: "Greetings, valley!" });
  await sleep(400);
  check("chat broadcast reaches other players", [talis, phys, H].every((b) => b.chats.some((c) => c.from === sword.name && c.text === "Greetings, valley!")));
  talis.send({ t: "chat", text: "x".repeat(300) });
  await sleep(400);
  const longMsg = phys.chats.find((c) => c.from === talis.name && c.text.startsWith("xxx"));
  check("chat trimmed to 120 chars", !!longMsg && longMsg.text.length === 120, `len ${longMsg?.text.length}`);
  phys.chats.length = 0;
  await sleep(6000); // refill bucket
  for (let i = 0; i < 25; i++) sword.send({ t: "chat", text: "spam " + i });
  await sleep(600);
  const got = phys.chats.filter((c) => c.from === sword.name).length;
  check("chat rate limit drops spam", got >= 1 && got <= 8, `${got}/25 delivered`);
  check("system messages on join", sword.sys(`${talis.name} has entered`) || talis.sys(`${phys.name} has entered`) || sword.sys("has entered"));
  check("level-up system message (informational if none yet)", lvl.every((n) => n === 0) || fighters.some((b) => b.chats.some((c) => c.sys && /reached level/.test(c.text))));

  // --- death & respawn ---
  console.log("\n[D] death & respawn");
  const diedAt = await until(() => doomed.count("death", (e) => e.id === doomed.id) > 0, 60_000, 250);
  check("player killed by boss -> death event + system message", diedAt && doomed.sys("fallen"));
  if (diedAt) {
    // Timing is measured from two server events (death -> "You return to the plaza" system line), not from snapshot polling,
    // so snapshot lag / timer rounding cannot produce a bogus 0.0 s. The server's respawn is tick-based (exactly 5.0 s of sim time).
    const gotMsg = await until(() => doomed.chats.some((c) => c.sys && c.text.includes("You return to the plaza") && c.t >= doomed.selfDeathAt), 12_000, 50);
    const msg = doomed.chats.find((c) => c.sys && c.text.includes("You return to the plaza") && c.t >= doomed.selfDeathAt);
    const secs = msg ? (msg.t - doomed.selfDeathAt) / 1000 : -1;
    const back = await until(() => doomed.me!.st !== "dead" && doomed.me!.hp > 0, 3000, 50);
    check("respawn at spawn after ~5s", gotMsg && back && secs >= 4.5 && secs <= 6.0 && dist(doomed.me!.x, doomed.me!.z, 0, -80) < 8, `${secs.toFixed(2)}s, pos ${doomed.me!.x.toFixed(0)},${doomed.me!.z.toFixed(0)}`);
    doomed.stop();
  }

  // --- persistence ---
  console.log("\n[E] persistence & lifecycle");
  const snapLv = sword.lastXp!, nm = sword.name;
  sword.close();
  await until(() => sword.closed, 1000);
  await sleep(400);
  const again = new Bot(nm.toLowerCase(), "physician");
  await again.login();
  await until(() => !!again.lastXp, 1500);
  check("character persisted (level/xp restored, saved class kept)",
    again.id !== 0 && again.lastXp?.lv === snapLv.lv && again.lastXp?.xp === snapLv.xp && again.skills[0]?.name === "Flowing Slash",
    `lv${again.lastXp?.lv} xp${again.lastXp?.xp} vs lv${snapLv.lv} xp${snapLv.xp}`);
  check("leave message broadcast", talis.sys(`${nm} has left`));
  again.close();

  // --- quest chain (Elder Lin) ---
  console.log("\n[F] quest chain");
  {
    const q = new Bot("Quest" + SUFFIX, "sword");
    await q.login();
    await sleep(300);
    q.send({ t: "chat", text: "/quest" }); await sleep(300);
    check("/quest before talking points to Elder Lin", q.sys("Elder Lin"));
    q.send({ t: "chat", text: "/talk" });
    await until(() => q.sys("Quest accepted"), 1500);
    check("/talk near Elder Lin accepts quest 1 (Clear 5 Bamboo Spirits)", q.sys("Quest accepted") && q.sys("0/5"), q.chats.at(-1)?.text);
    check("/talk is not broadcast as player chat", !q.chats.some((c) => !c.sys && c.text.startsWith("/")));
    q.close(); await sleep(400);
    const q2 = new Bot("QUEST" + SUFFIX, "sword");
    await q2.login(); await sleep(300);
    q2.send({ t: "chat", text: "/quest" }); await sleep(300);
    check("quest progress persisted across relog", q2.sys("Quest 1/4") && q2.sys("0/5"), q2.chats.at(-1)?.text);
    q2.close(); await sleep(200);
  }


  // ===== F2. Lantern Keeper Mei: fetch errand =====
  console.log("\n[F2] Lantern Keeper Mei errand");
  if (!TM) console.log("  (skipped: needs a self-spawned TEST_MODE server)");
  else {
    const MEI = { x: 7, z: -74 };
    const inv = (b: Bot, n: string) => b.inv?.find((i) => i.item === n)?.qty ?? 0;
    const m = new Bot("Mei" + SUFFIX, "talisman");
    await m.login(); await sleep(300);
    m.send({ t: "chat", text: `/testtp ${ELDER.x + 3} ${ELDER.z}` }); await sleep(300);
    m.send({ t: "chat", text: "/talk" });
    await until(() => m.sys("Quest accepted"), 1500);
    check("standing at Elder Lin, bare /talk talks to Elder Lin (not Mei)", m.sys("Elder Lin:") && !m.sys("Lantern Keeper Mei:") && !m.sys("Task accepted"));
    m.send({ t: "chat", text: `/testtp ${MEI.x + 2} ${MEI.z}` }); await sleep(300);
    m.send({ t: "chat", text: "/talk mei" });
    await until(() => m.sys("Task accepted"), 1500);
    check("/talk next to Mei accepts the errand (speech + `Task accepted:` line)", m.sys("Lantern Keeper Mei: ") && m.sys("Task accepted: Wicks for the Lanterns: 0/5 Bamboo Fiber"), m.chats.at(-1)?.text);
    check("Mei's lines do not use the Elder Lin quest-tracker formats", !m.chats.some((c) => c.sys && c.text.includes("Mei") && /\[Quest|^Quest /.test(c.text)));
    const nb = m.chats.length;
    m.send({ t: "chat", text: "/talk" }); await until(() => m.chats.length > nb, 1500);
    check("bare /talk within reach of both NPCs goes to Elder Lin (main chain stays first)", m.chats.slice(nb).some((c) => c.sys && c.text.startsWith("Elder Lin:")) && !m.chats.slice(nb).some((c) => c.text.startsWith("Lantern Keeper Mei")));
    const n0 = m.chats.length;
    m.send({ t: "chat", text: "/talk mei" });
    await until(() => m.chats.length >= n0 + 2, 1500);
    check("/talk again without the items: reminder + 0/5, nothing consumed", m.sys("Task: Wicks for the Lanterns: 0/5 Bamboo Fiber") && !m.sys("Task complete"));
    await sleep(3500); // chat token bucket refill (4 burst, 1 per 1.5 s)
    m.send({ t: "chat", text: "/testgive Bamboo_Fiber 3" }); await sleep(400);
    m.send({ t: "chat", text: "/talk mei" });
    await until(() => m.sys("3/5 Bamboo Fiber"), 1500);
    check("3 of 5 fibres: progress 3/5, still not complete", m.sys("Task: Wicks for the Lanterns: 3/5 Bamboo Fiber") && !m.sys("Task complete") && inv(m, "Bamboo Fiber") === 3);
    await sleep(2500); // chat token bucket (4 burst, 1 per 1.5 s): let it refill after the /talk burst
    m.send({ t: "chat", text: "/quest" }); await sleep(300);
    check("/quest also lists the open Mei task", m.sys("Task: Wicks for the Lanterns: 3/5 Bamboo Fiber - bring it to Lantern Keeper Mei"));
    // relog: accepted state persists
    const mn = m.name; m.close(); await until(() => m.closed, 1000); await sleep(500);
    const m2 = new Bot(mn, "talisman");
    await m2.login(); await sleep(500);
    m2.send({ t: "chat", text: `/testtp ${MEI.x + 2} ${MEI.z}` }); await sleep(300);
    m2.send({ t: "chat", text: "/testgive Bamboo_Fiber 4" }); await sleep(400);
    check("fibres persisted (3 + 4 = 7 in the pack)", inv(m2, "Bamboo Fiber") === 7, String(inv(m2, "Bamboo Fiber")));
    const xp0 = m2.xpGain;
    m2.send({ t: "chat", text: "/talk mei" });
    await until(() => m2.sys("Task complete"), 1500); await sleep(400);
    check("accepted state persisted across relog: turn-in works (no second intro)", m2.sys("Task complete: Wicks for the Lanterns  (+150 XP)") && !m2.sys("Task accepted"), m2.chats.at(-1)?.text);
    check("turn-in: +150 XP, 5 fibres taken, Paper Lantern + Healing Tonic in `inv`, loot events", m2.xpGain - xp0 >= 150 && inv(m2, "Bamboo Fiber") === 2 && inv(m2, "Paper Lantern") === 1 && inv(m2, "Healing Tonic") >= 1 && m2.count("loot", (e) => e.item === "Paper Lantern") === 1, `+${m2.xpGain - xp0} xp, fibre ${inv(m2, "Bamboo Fiber")}`);
    m2.send({ t: "chat", text: "/testgive Bamboo_Fiber 5" }); await sleep(300);
    m2.send({ t: "chat", text: "/talk mei" }); await sleep(600);
    check("errand is one-time: talking again gives no second reward", m2.sys("May no traveller lose their way") && inv(m2, "Paper Lantern") === 1 && m2.chats.filter((c) => c.sys && c.text.includes("Task complete")).length === 1 && inv(m2, "Bamboo Fiber") === 7);
    m2.send({ t: "chat", text: "/testtp 0 40" }); await sleep(300);
    const n1 = m2.chats.length;
    m2.send({ t: "chat", text: "/talk" }); await until(() => m2.chats.length > n1, 1500);
    check("far from both NPCs: 'No one is close enough' (names both)", m2.chats.slice(n1).some((c) => c.sys && c.text.includes("No one is close enough") && c.text.includes("Mei")));
    const mn2 = m2.name; m2.close(); await until(() => m2.closed, 1000); await sleep(500);
    const m3 = new Bot(mn2, "talisman");
    await m3.login(); await sleep(400);
    m3.send({ t: "chat", text: `/testtp ${MEI.x + 2} ${MEI.z}` }); await sleep(300);
    m3.send({ t: "chat", text: "/talk mei" }); await sleep(700);
    check("completed state persisted across relog", m3.sys("May no traveller lose their way") && !m3.sys("Task accepted"));
    m3.close();
    // old databases (quests table without the `mei` column) are migrated, existing progress kept
    {
      const { DatabaseSync } = await import("node:sqlite");
      const dir = mkdtempSync(join(tmpdir(), "jz-mig-"));
      const path = join(dir, "old.db");
      const old = new DatabaseSync(path);
      old.exec("CREATE TABLE quests (name TEXT PRIMARY KEY COLLATE NOCASE, stage INTEGER NOT NULL, status INTEGER NOT NULL, progress INTEGER NOT NULL, updated_at INTEGER NOT NULL, progress2 INTEGER NOT NULL DEFAULT 0)");
      old.prepare("INSERT INTO quests VALUES (?,?,?,?,?,?)").run("Oldie", 3, 1, 0, 1, 0);
      old.close();
      const { CharacterDb } = await import("../src/db.ts");
      const cdb = new CharacterDb(path);
      const q0 = cdb.loadQuest("Oldie");
      cdb.saveQuest("Oldie", { ...q0, mei: 1 });
      const q1 = cdb.loadQuest("Oldie");
      check("db migration: old quests table gains `mei`, stage kept, mei round-trips", q0.stage === 3 && q0.mei === 0 && q1.mei === 1 && q1.stage === 3);
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ===== G. jade serpents, Cleanse the Pond, inventory =====
  console.log("\n[G] jade serpents, Cleanse the Pond, inventory");
  if (!TM || !pond) console.log("  (skipped: needs a self-spawned TEST_MODE server)");
  else {
    const spawnPts = MOB_SPAWNS.find((g) => g.type === "jade_serpent")!.points!;
    const dSpawn = spawnPts.map(([x, z]) => dist(x, z, ZONE.spawn.x, ZONE.spawn.z));
    let minGap = Infinity;
    for (let i = 0; i < spawnPts.length; i++) for (let j = i + 1; j < spawnPts.length; j++) minGap = Math.min(minGap, dist(spawnPts[i][0], spawnPts[i][1], spawnPts[j][0], spawnPts[j][1]));
    check("serpent spawn points: >= 35 from plaza, >= 10 apart (no chain pulls), around the pond", Math.min(...dSpawn) >= 35 && minGap >= 10 && spawnPts.every(([x, z]) => dist(x, z, 0, -34) >= 20), `nearest plaza ${Math.min(...dSpawn).toFixed(0)}u, min spacing ${minGap.toFixed(0)}u`);
    const sers = [...pond.mobTypes.values()].filter((e) => e.mob === "jade_serpent");
    check("Jade Serpents visible near the pond, lv 2-4", sers.length >= 3 && sers.every((e) => e.n === "Jade Serpent" && e.lv >= 2 && e.lv <= 4), `${sers.length} seen, lv ${[...new Set(sers.map((e) => e.lv))].join("/")}`);
    check("`inv` is sent right after welcome (before the first snapshot)", pond.order.indexOf("inv") > pond.order.indexOf("welcome") && pond.order.indexOf("inv") < pond.order.indexOf("snap"), pond.order.slice(0, 5).join(","));
    check("/testquest hook: quest 3 line shows combined count + breakdown", pond.chats.some((c) => c.sys && /\[Quest 3\/4\] Cleanse the Pond: \d+\/6 \(Jade Serpents \d\/4, Jade Scales \d\/2\)/.test(c.text)), pond.chats.find((c) => c.sys && c.text.includes("Cleanse"))?.text);
    const doneP = await until(() => pond!.sys("objective complete"), 170_000, 500);
    pond.stop(); pond.input(0, 0);
    const kills = pond.count("death", (e) => pond!.mobTypes.get(e.id)?.mob === "jade_serpent" && e.killer === pond!.id);
    check("pond quest objective completes: 4 serpents + 2 Jade Scales", doneP && kills >= 4, `${kills} serpents killed`);
    const prog = pond.chats.filter((c) => c.sys && /\[Quest 3\/4\]/.test(c.text)).map((c) => c.text);
    check("progress lines advance (Jade Serpents n/4 then complete)", prog.some((t) => /Jade Serpents [1-3]\/4/.test(t)) && prog.some((t) => /6\/6 .*objective complete/.test(t)), prog.at(-1));
    const sdmg = pond.dmgTaken.filter((d) => pond!.mobTypes.get(d.src)?.mob === "jade_serpent");
    let tickPairs = 0;
    for (let i = 1; i < sdmg.length; i++) { const g = sdmg[i].t - sdmg[i - 1].t; if (g > 800 && g < 1300 && sdmg[i].src === sdmg[i - 1].src) tickPairs++; }
    check("serpent poison: periodic damage events ~1 s apart after a bite", sdmg.length >= 4 && tickPairs >= 2, `${sdmg.length} serpent damage events, ${tickPairs} poison-tick pairs`);
    const scaleBefore = pond.inv?.find((i) => i.item === "Jade Scale")?.qty ?? 0;
    check("inventory: Jade Scale x>=2 in `inv` (loot persists as items)", scaleBefore >= 2 && pond.invMsgs >= 3 && pond.inv!.some((i) => i.item === "Jade Scale"), `scales ${scaleBefore}, inv msgs ${pond.invMsgs}, items ${pond.inv!.map((i) => i.item + "x" + i.qty).join(",")}`);

    // turn in
    // the bot may still be poisoned or even dead (a dead player cannot /talk): wait until it is alive, heal, then teleport
    await until(() => pond!.me?.st !== "dead", 8000, 100);
    pond.send({ t: "chat", text: "/testheal" }); await sleep(300);
    pond.send({ t: "chat", text: `/testtp ${ELDER.x + 3} ${ELDER.z}` }); await sleep(500);
    const xpBefore = pond.xpGain;
    for (let attempt = 0; attempt < 3 && !pond.sys("Quest complete: Cleanse the Pond"); attempt++) {
      pond.send({ t: "chat", text: "/talk" });
      await until(() => pond!.sys("Quest complete: Cleanse the Pond"), 2000);
    }
    await sleep(500);
    const inv1 = pond.inv ?? [];
    const q = (n: string) => inv1.find((i) => i.item === n)?.qty ?? 0;
    check("pond quest turn-in: text pattern + XP + items to inventory", pond.sys("Quest complete: Cleanse the Pond  (+380 XP)") && pond.xpGain - xpBefore >= 380 && q("Lotus Charm") === 1 && q("Lotus Antidote") === 2, `+${pond.xpGain - xpBefore} xp; ${inv1.map((i) => i.item + "x" + i.qty).join(",")}`);
    check("quest items consumed on turn-in (Jade Scale -2)", q("Jade Scale") === scaleBefore - 2, `${scaleBefore} -> ${q("Jade Scale")}`);
    check("turn-in auto-accepts the boss quest (Quest 4/4)", pond.sys("Quest accepted: [Quest 4/4] Defeat the Stone Guardian: 0/1"));
    pond.send({ t: "chat", text: "/testgive Bamboo_Fiber 150" }); await sleep(400);
    check("stack cap enforced (150 Bamboo Fiber -> max 99)", (pond.inv?.find((i) => i.item === "Bamboo Fiber")?.qty ?? 0) === 99);
    const snapInv = JSON.stringify([...(pond.inv ?? [])].sort((a, b) => a.item.localeCompare(b.item)));
    const pn = pond.name;
    pond.close(); await until(() => pond!.closed, 1000); await sleep(500);
    const back = new Bot(pn, "sword");
    await back.login(); await sleep(600);
    const relogInv = JSON.stringify([...(back.inv ?? [])].sort((a, b) => a.item.localeCompare(b.item)));
    check("inventory persisted across relog (sqlite items) and sent as `inv` after welcome", back.inv !== null && relogInv === snapInv && back.order.indexOf("inv") < back.order.indexOf("snap"), `${back.inv?.length} stacks`);
    back.send({ t: "chat", text: "/quest" }); await sleep(300);
    check("quest stage persisted across relog (Quest 4/4 active)", back.sys("[Quest 4/4] Defeat the Stone Guardian: 0/1"));
    back.close();
  }

  // ===== H. Stone Guardian: telegraphs, dodging, kill, quest credit, respawn, leash =====
  console.log("\n[H] Stone Guardian boss fight");
  if (!TM) console.log("  (skipped: needs a self-spawned TEST_MODE server)");
  else {
    const mk = async (name: string, cls: ClassId, lv: number, stage = 3) => {
      const b = new Bot(name + SUFFIX, cls);
      await b.login();
      b.send({ t: "chat", text: `/testlevel ${lv}` }); b.send({ t: "chat", text: `/testquest ${stage}` });
      return b;
    };
    // --- H1: standing in a circle hurts; leaving it does not ---
    const st = await mk("Stand", "sword", 15);
    st.send({ t: "chat", text: `/testtp ${BOSS.x} ${BOSS.z - 9}` });
    st.mode = "idle"; st.startBrain();
    const heal = setInterval(() => st.send({ t: "chat", text: "/testheal" }), 2500);
    await until(() => st.teleLog.length >= 1 && st.teleLog[0].done === true, 20_000, 100);
    const t1 = st.teleLog[0];
    check("boss emits a `telegraph` (circle radius 6-9, delay 1.5-2.0 s) soon after engaging", !!t1 && t1.radius >= 6 && t1.radius <= 9 && t1.delay >= 1.5 && t1.delay <= 2.0, t1 ? `r=${t1.radius} delay=${t1.delay}s src=${t1.src}` : "none");
    check("standing in the circle takes slam damage", !!t1 && (t1.distAtLand ?? 99) < 0 && t1.slamHit === true, `${t1?.distAtLand?.toFixed(1)}u inside, hit=${t1?.slamHit}`);
    st.dodgeOn = true;
    await until(() => st.teleLog.length >= 4 && st.teleLog.slice(0, 4).every((t) => t.done), 45_000, 200);
    const later = st.teleLog.slice(1, 4).filter((t) => t.done);
    const stDmgSlam = later.filter((t) => t.slamHit).length;
    check("leaving the circle before it lands takes no slam damage (3 telegraphs dodged)", later.length >= 3 && later.every((t) => (t.distAtLand ?? -1) > 0) && stDmgSlam === 0, later.map((t) => `${t.distAtLand?.toFixed(1)}u/${t.slamHit ? "HIT" : "ok"}`).join(" "));
    const gaps = st.teleLog.slice(1, 4).map((t, i) => (t.at - st.teleLog[i].at) / 1000);
    check("telegraphs every ~8-10 s, alternating patterns (circle on player / circle on boss)", gaps.length >= 3 && gaps.every((g) => g >= 7.5 && g <= 10.5) && st.teleLog[0].radius !== st.teleLog[1].radius, `gaps ${gaps.map((g) => g.toFixed(1)).join(",")}s radii ${st.teleLog.slice(0, 3).map((t) => t.radius).join("/")}`);
    clearInterval(heal);
    st.send({ t: "chat", text: "/testtp 0 -80" }); st.close(); await sleep(300);

    // --- H2: lv6 trio kills the boss ---
    await sleep(6000); // let the boss reset (leash) after the stand-in left
    const trio = [await mk("BSword", "sword", 6), await mk("BTali", "talisman", 6), await mk("BMed", "physician", 6)];
    const watcher = trio[0];
    // Spectator for H3: parked outside the boss's reach (aggro 12, beam 28) but inside interest radius 60, so it sees the death
    // and the respawn at the real time, whatever the fighters do afterwards (turn-in teleports them away).
    const spec = await mk("BSpec", "sword", 15);
    spec.send({ t: "chat", text: `/testtp ${BOSS.x} ${BOSS.z - 38}` });
    trio[0].send({ t: "chat", text: `/testtp ${BOSS.x} ${BOSS.z - 18}` });
    trio[1].send({ t: "chat", text: `/testtp ${BOSS.x - 4} ${BOSS.z - 24}` });
    trio[2].send({ t: "chat", text: `/testtp ${BOSS.x + 4} ${BOSS.z - 24}` });
    await sleep(800);
    const bossEnt = () => [...watcher.ents.values()].find((e) => e.mob === "stone_guardian");
    check("boss visible at the shrine, lv8, 2000 HP", !!bossEnt() && bossEnt()!.lv === 8 && bossEnt()!.mhp === 2000, `lv${bossEnt()?.lv} hp ${bossEnt()?.hp}/${bossEnt()?.mhp}`);
    const bossId = bossEnt()?.id ?? -1;
    for (const b of trio) { b.mode = "boss"; b.mobFilter = "stone_guardian"; b.dodgeOn = true; b.safetyNet = true; b.walkTo = { x: BOSS.x, z: BOSS.z - 14 }; b.startBrain(); }
    const tFight = Date.now();
    let firstHit = 0;
    const killed = await until(() => { if (!firstHit && trio.some((b) => b.count("damage", (e) => e.src === b.id && e.dst === bossId) > 0)) firstHit = Date.now(); return trio.some((b) => b.count("death", (e) => e.id === bossId) > 0); }, 170_000, 200);
    const tKill = Date.now();
    // the spectator timestamps the respawn the moment it happens (the fighters spend ~30 s on the turn-in meanwhile)
    let respawnAt = 0;
    const respawnPoll = setInterval(() => { const e = spec.ents.get(bossId); if (!respawnAt && Date.now() - tKill > 3000 && e && e.st !== "dead" && e.hp === e.mhp) respawnAt = Date.now(); }, 50);
    const ttk = (tKill - (firstHit || tFight)) / 1000;
    const bossPos = bossEnt() ?? { x: BOSS.x, z: BOSS.z };
    const near = trio.map((b) => b.me ? dist(b.me.x, b.me.z, bossPos.x, bossPos.z) : 999);
    for (const b of trio) b.input(0, 0);
    const dmgByCls = trio.map((b) => `${b.cls}:${b.count("damage", (e) => e.src === b.id && e.dst === bossId) > 0 ? Math.round(b.evs.filter((e) => e.k === "damage" && e.src === b.id && e.dst === bossId).reduce((n, e: any) => n + e.amount, 0)) : 0}`).join(" ");
    const teles = trio.flatMap((b) => b.teleLog);
    console.log(`  info: boss TTK ${ttk.toFixed(1)}s; damage dealt ${dmgByCls}; bot deaths ${trio.map((b) => b.count("death", (e) => e.id === b.id)).join("/")}; safety-net heals ${trio.map((b) => b.netHeals).join("/")}; telegraphs seen ${trio[0].teleLog.length}`);
    check("lv6 sword+talisman+physician kill the Stone Guardian", killed, `${ttk.toFixed(1)}s from first hit`);
    await sleep(1000);
    const evalT = teles.filter((t) => t.done && t.distAtLand !== undefined);
    const dodgedOk = evalT.filter((t) => t.distAtLand! > 1.5);
    const hitDespiteOutside = dodgedOk.filter((t) => t.slamHit).length;
    check("bots that dodged (clearly outside at landing) never took slam damage", evalT.length >= 6 && hitDespiteOutside === 0, `${dodgedOk.length}/${evalT.length} bot-telegraph samples outside, ${hitDespiteOutside} hit`);
    const sizes = new Set(trio[0].teleLog.map((t) => t.radius));
    const scatter = trio[0].teleLog.filter((t, i, a) => a.some((u, j) => j !== i && Math.abs(u.at - t.at) < 60 && u.radius === t.radius && t.radius < 6)).length;
    check("phase 2 (<50% HP): ring of 3 smaller telegraphs appears", scatter >= 3 && trio[0].sys("runes blaze"), `radii seen ${[...sizes].join("/")}, scatter circles ${scatter}`);

    const beamEv = trio.flatMap((b) => b.evs.filter((e): e is Extract<GameEvent, { k: "telegraph" }> => e.k === "telegraph" && !!e.beam));
    check("phase 3 (<25% HP): 'cracks open' message + a rotating line beam telegraph (3 s sweep, ~90 degrees)", trio[0].sys("cracks open") && beamEv.length >= 1 && beamEv.every((e) => e.shape === "line" && Math.abs(Math.abs(e.sweep ?? 0) - Math.PI / 2) < 0.02 && (e.delay - (e.lead ?? 0)) === 3 && (e.width ?? 0) > 0 && (e.len ?? 0) > 10), `${new Set(beamEv.map((e) => `${e.x},${e.z},${e.dir}`)).size} beams, delay ${beamEv[0]?.delay} lead ${beamEv[0]?.lead} sweep ${beamEv[0]?.sweep}`);

    // quest credit: everyone near the boss at death was credited
    const credited = trio.map((b) => b.sys("[Quest 4/4] Defeat the Stone Guardian: 1/1 - objective complete"));
    const nearOk = trio.map((b, i) => near[i] <= 70);
    check("boss quest credits every participant within range", killed && trio.every((b, i) => !nearOk[i] || credited[i]) && credited.filter(Boolean).length >= 2, `credited ${credited.join("/")} in-range ${nearOk.join("/")}`);
    check("boss kill gives XP to participants", trio.filter((b) => b.xpGain >= 1000).length >= 2, trio.map((b) => b.xpGain).join("/"));

    // turn-in with the final reward items
    const done = trio.filter((_, i) => credited[i]);
    for (const b of done) { b.send({ t: "chat", text: `/testtp ${ELDER.x + 3} ${ELDER.z}` }); }
    await sleep(600);
    for (const b of done) b.send({ t: "chat", text: "/talk" });
    await sleep(1200);
    const has = (b: Bot, n: string) => b.inv?.find((i) => i.item === n)?.qty ?? 0;
    check("boss turn-in: Quest complete text (+1500 XP), Guardian's Seal + Cloudmist Pendant + Guardian Core in `inv`",
      done.length >= 2 && done.every((b) => b.sys("Quest complete: Defeat the Stone Guardian  (+1500 XP)") && has(b, "Guardian's Seal") === 1 && has(b, "Cloudmist Pendant") === 1 && has(b, "Guardian Core") === 1 && b.sys("All my tasks") === false),
      done.map((b) => b.inv?.map((i) => i.item).join("+")).join(" | "));
    check("final turn-in says all tasks complete", done.every((b) => b.sys("completed all my tasks")));
    check("economy: boss kill paid jade + coin to credited players; finishing Elder Lin's chain paid the chain jade (3 + 10)",
      credited.every((c, i) => !c || (trio[i].wallet?.jade ?? 0) >= 3) && done.every((b) => (b.wallet?.jade ?? 0) >= 13 && b.sys("You received 10 jade.") && b.sys("You received 3 jade.") && (b.wallet?.coin ?? 0) > 50),
      trio.map((b) => JSON.stringify(b.wallet)).join(" "));

    // --- H3: respawn timing + leash (TEST_BOSS_RESPAWN=20 s in test mode) ---
    for (const t of trio) { t.stop(); t.input(0, 0); } // brains off: the observer must stay where the test puts it
    const obs = spec;
    const sawDeath = !!obs.evs.find((e) => e.k === "death" && e.id === bossId);
    const back = sawDeath && await until(() => respawnAt > 0, 40_000, 100);
    clearInterval(respawnPoll);
    const rs = (respawnAt - tKill) / 1000;
    check("boss respawns at full HP (test-mode 20 s timer; production 120 s)", back && rs >= 19 && rs <= 26, `${rs.toFixed(1)}s after death`);
    // leash: pull the respawned boss, then leave -> it returns to full HP
    obs.send({ t: "chat", text: `/testtp ${BOSS.x} ${BOSS.z - 12}` }); await sleep(400);
    obs.send({ t: "cast", skill: 2, target: bossId }); await sleep(1200);
    obs.send({ t: "cast", skill: 1, target: bossId }); await sleep(800);
    const hurt = obs.ents.get(bossId)!;
    const hpHurt = hurt.hp;
    obs.send({ t: "chat", text: `/testtp ${BOSS.x} ${BOSS.z - 45}` });
    const reset = await until(() => { const e = obs.ents.get(bossId); return !!e && e.hp === e.mhp && Math.abs(e.z - BOSS.z) < 2; }, 15_000, 200);
    check("boss leashes: puller leaves -> boss returns to its post and heals to full", hpHurt < hurt.mhp && reset, `hp after hit ${hpHurt}/${hurt.mhp}, reset=${reset}`);
    for (const b of trio) b.close();
    spec.close();
  }

  // ===== I. localization: scripted session scanned for CJK, plus DB migration =====
  console.log("\n[I] English-only text + legacy item migration");
  if (TM) {
    const s = new Bot("Scan" + SUFFIX, "sword");
    await s.login();
    const say = async (text: string, ms = 350) => { s.send({ t: "chat", text }); await sleep(ms); };
    await say("/talk"); // out of reach of everyone
    await say(`/testtp ${ELDER.x + 1} ${ELDER.z + 1}`, 500);
    await say("/talk elder"); await say("/talk elder"); await say("/quest");
    for (const st of [0, 1, 2, 3]) {
      for (const status of [1, 2]) { await say(`/testquest ${st} ${status}`); await say("/talk elder"); await say("/quest"); }
    }
    await say("/testquest 4"); await say("/talk elder");
    for (const it of ["Bamboo_Fiber", "Fox_Tail", "Jade_Scale", "Serpent_Gall", "Guardian_Core", "Healing_Tonic", "Jade_Charm", "Lotus_Antidote", "Lotus_Charm", "Guardian's_Seal", "Cloudmist_Pendant", "Paper_Lantern"]) await say(`/testgive ${it} 99`, 60);
    await say("/testgive Jade_Scale 99");
    await say("/testtp 7 -72", 500);
    await say("/talk mei"); await say("/talk mei"); await say("/talk mei"); await say("/talk mei"); await say("/quest"); await say("/talk"); await say("/wat");
    await say("/testtp 100 100", 500); await say("/talk elder"); await say("/talk mei");
    s.send({ t: "cast", skill: 2, target: 999999 }); await sleep(300);
    await say("hello world");
    await say("/testtp 7 -72", 900);
    const sysTexts = s.chats.filter((c) => c.sys).map((c) => c.text);
    check("scripted session produced quest dialog for both NPCs", sysTexts.some((x) => x.startsWith("Elder Lin: ")) && sysTexts.some((x) => x.startsWith("Lantern Keeper Mei: ")) && sysTexts.some((x) => /^\[Quest \d\/4\] /.test(x)), `${sysTexts.length} sys lines`);
    check("welcome/zone/skills/classes/entities/inventory: all deprecated *Zh fields are empty strings",
      s.zone?.nameZh === "" && s.skills.every((k) => k.nameZh === "") && (s.inv ?? []).length >= 10 && s.inv!.every((i) => i.itemZh === "") && s.evs.filter((e) => e.k === "loot").every((e: any) => e.itemZh === ""));
    check("entity names are plain English (NPCs, mobs)", [...s.ents.values()].filter((e) => e.k !== "player").every((e) => !CJK.test(e.n)) && [...s.ents.values()].some((e) => e.n === "Lantern Keeper Mei"));
    s.close();
    await sleep(200);
  }
  check("NO CJK in any server frame received during the entire run", cjkFrames.length === 0, cjkFrames[0] ?? `${cjkFrames.length} frames`);
  {
    // legacy DB: items stored with hanzi names (as \u escapes here so the source stays CJK-free)
    const dir = mkdtempSync(join(tmpdir(), "jiuzhou-mig-")), path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE items (name TEXT NOT NULL COLLATE NOCASE, item TEXT NOT NULL, item_zh TEXT NOT NULL, qty INTEGER NOT NULL, PRIMARY KEY (name, item));`);
    const ins = old.prepare("INSERT INTO items VALUES (?,?,?,?)");
    ins.run("Old", "\u72d0\u5c3e", "\u72d0\u5c3e", 3);                         // hanzi only
    ins.run("Old", "Fox Tail", "\u72d0\u5c3e", 4);                              // English already present -> merge
    ins.run("Old", "Jade Scale", "\u7389\u9cde", 2);                            // English with hanzi item_zh
    ins.run("Old", "Paper Lantern \u7eb8\u706f\u7b3c", "", 1);                // English + hanzi suffix
    ins.run("Old", "\u672a\u77e5\u7269", "\u672a\u77e5\u7269", 5);                 // unknown hanzi -> dropped
    old.close();
    let items: InvItem[] = [];
    try {
      const mdb = new CharacterDb(path);
      items = mdb.loadInv("Old");
      mdb.close();
      const again = new CharacterDb(path); const items2 = again.loadInv("Old"); again.close(); // second open: idempotent
      const q = (n: string) => items.find((i) => i.item === n)?.qty;
      check("migration: hanzi item names rewritten to English, merged, unknown dropped",
        q("Fox Tail") === 7 && q("Jade Scale") === 2 && q("Paper Lantern") === 1 && items.length === 3 && items.every((i) => !CJK.test(i.item) && i.itemZh === ""), JSON.stringify(items));
      check("migration is idempotent and loading stays tolerant", JSON.stringify(items2) === JSON.stringify(items));
      const raw = new DatabaseSync(path); const rows = raw.prepare("SELECT item, item_zh FROM items").all() as any[]; raw.close();
      check("migration rewrote the stored rows (no CJK left in sqlite)", rows.every((r) => !CJK.test(r.item) && r.item_zh === ""), JSON.stringify(rows));
    } catch (e) { check("migration runs", false, String(e)); }
    rmSync(dir, { recursive: true, force: true });
  }

  // ===== I. accounts (v3 passwords) =====
  console.log("\n[L] accounts & passwords");
  {
    const nm = "Acct" + SUFFIX;
    const mk = (name: string, pw: string | undefined) => { const b = new Bot(name, "sword"); b.pw = pw; return b; };
    const nopw = mk(nm, undefined);
    await nopw.login();
    check("unknown name without pw -> 'Choose a password' error", nopw.id === 0 && nopw.errors.some((e) => e === "Choose a password (4-64 characters) to create this character."), nopw.errors[0]);
    nopw.close();
    const shortPw = mk(nm, "abc");
    await shortPw.login();
    check("unknown name with too-short pw rejected, nothing created", shortPw.id === 0 && shortPw.errors.length > 0, shortPw.errors[0]);
    shortPw.close();
    const reg = mk(nm, "secret-pw-1");
    const regOk = await reg.login();
    check("unknown name + valid pw registers and logs in", regOk);
    reg.close(); await until(() => reg.closed, 1500); await sleep(200);
    const wrong = mk(nm, "not-the-pw");
    await wrong.login();
    check("known name + wrong pw -> 'Wrong password for that name.'", wrong.id === 0 && wrong.errors[0] === "Wrong password for that name.", wrong.errors[0]);
    wrong.close();
    const none = mk(nm, undefined);
    await none.login();
    check("known name without pw -> 'This name is protected. Enter its password.'", none.id === 0 && none.errors[0] === "This name is protected. Enter its password.", none.errors[0]);
    none.close();
    const again = mk(nm.toUpperCase(), "secret-pw-1");
    const againOk = await again.login();
    check("correct pw logs in (name match is case-insensitive)", againOk);
    const dupe = mk(nm, "secret-pw-1");
    await dupe.login();
    check("duplicate-online still rejected with the right pw", dupe.id === 0 && dupe.errors.some((e) => /in use/i.test(e)), dupe.errors[0]);
    dupe.close(); again.close(); await sleep(300);
    if (TM) {
      const raw = new DatabaseSync(join(tmp, "test.db"));
      const acc = raw.prepare("SELECT salt, hash FROM accounts WHERE name = ?").get(nm) as any;
      const dump = JSON.stringify(raw.prepare("SELECT * FROM accounts").all().map((r: any) => [Buffer.from(r.salt).toString("latin1"), Buffer.from(r.hash).toString("latin1")]));
      check("accounts row holds a 16-byte salt + scrypt hash, no plaintext password", !!acc && acc.salt.length === 16 && acc.hash.length >= 32 && !dump.includes("secret-pw-1"));
      // legacy character without an account row: first login with a pw claims it
      const legacy = "Legacy" + SUFFIX;
      raw.prepare("INSERT INTO characters (name, cls, level, xp, x, z, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(legacy, "physician", 5, 0, 0, -70, Date.now(), Date.now());
      raw.close();
      const l0 = mk(legacy, undefined); await l0.login();
      check("legacy character without pw -> protected error", l0.id === 0 && l0.errors[0] === "This name is protected. Enter its password.", l0.errors[0]);
      l0.close();
      const l1 = mk(legacy, "claim-it-1"); const l1ok = await l1.login();
      check("legacy character is claimed by first login with a pw (keeps level 5)", l1ok && l1.me?.lv === 5, `lv ${l1.me?.lv}`);
      l1.close(); await until(() => l1.closed, 1500); await sleep(200);
      const l2 = mk(legacy, "someone-else"); await l2.login();
      check("claimed legacy name rejects other passwords", l2.id === 0 && l2.errors[0] === "Wrong password for that name.", l2.errors[0]);
      l2.close();
    }
  }

  // ===== J. movement accounting =====
  console.log("\n[M] movement accounting");
  {
    const mk = async (name: string) => { const b = new Bot(name + SUFFIX, "sword"); await b.login(); b.input(0, 0); await sleep(300); return b; };
    // normal movement passes
    const n = await mk("Walker");
    const a0 = { x: n.me!.x, z: n.me!.z };
    const end = Date.now() + 3000;
    while (Date.now() < end) { n.send({ t: "input", seq: ++n.seq, dx: 1, dz: 0 }); await sleep(50); }
    n.input(0, 0); await sleep(250);
    const walked = dist(a0.x, a0.z, n.me!.x, n.me!.z);
    check("normal movement is not rejected (3 s of walking)", !n.closed && !n.errors.includes("Movement rejected.") && walked > PLAYER_SPEED * 3 * 0.7 && walked <= PLAYER_SPEED * 3.4, `walked ${walked.toFixed(1)}u`);
    n.close();
    // oversized dx,dz + out-of-order seq
    const o = await mk("Speeder");
    const s0 = { x: o.me!.x, z: o.me!.z, tick: o.lastTick };
    const t0 = Date.now();
    let seqv = 1_000_000;
    while (Date.now() - t0 < 2500) {
      o.send({ t: "input", seq: (seqv -= 7), dx: 80, dz: -80 });          // oversized, seq going backwards
      o.send({ t: "input", seq: Math.floor(Math.random() * 1e6), dx: 3, dz: 0 }); // random order
      await sleep(10);
    }
    o.input(0, 0); await sleep(250);
    const ticks = o.lastTick - s0.tick;
    const cap = (ticks / TICK_RATE) * PLAYER_SPEED + 0.5;
    const trav = dist(s0.x, s0.z, o.me!.x, o.me!.z);
    check("oversized dx,dz + out-of-order seq cannot exceed PLAYER_SPEED", trav <= cap && trav > 1, `travelled ${trav.toFixed(1)}u, ceiling ${cap.toFixed(1)}u`);
    check("acks never move backwards under out-of-order seq", o.ackBackwards === 0, `backwards ${o.ackBackwards}`);
    o.close();
    if (TM) {
      const w = await mk("Warper");
      const p0 = { x: w.me!.x, z: w.me!.z };
      w.say("/testwarp 40 -20"); await sleep(400);
      check("unsanctioned jump is snapped back", dist(p0.x, p0.z, w.me!.x, w.me!.z) < 1 && !w.closed, `at ${w.me!.x.toFixed(1)},${w.me!.z.toFixed(1)}`);
      w.send({ t: "input", seq: ++w.seq, dx: 1, dz: 0 }); await sleep(500); w.input(0, 0);
      check("normal movement still works after a snap-back", w.me!.x - p0.x > 1.5);
      for (let i = 0; i < 25 && !w.closed; i++) { w.say(`/testwarp ${i % 2 ? 30 : -30} 10`); await sleep(65); }
      await until(() => w.closed, 1500);
      check("repeated violations -> 'Movement rejected.' + disconnect", w.closed && w.errors.includes("Movement rejected."), w.errors.join("|"));
      const t = await mk("TpOk");
      t.say("/testtp 10 -50"); await sleep(300); t.say("/testtp -20 -60"); await sleep(300);
      check("sanctioned test teleport is not a violation", !t.closed && Math.abs(t.me!.x + 20) < 1.5, `x=${t.me!.x.toFixed(1)}`);
      t.close();
    }
  }

  // ===== K. login rate limit (last: it blocks this IP for a minute) =====
  console.log("\n[N] login rate limit");
  {
    const nm = "Lim" + SUFFIX;
    const reg = new Bot(nm, "sword"); await reg.login(); reg.close(); await sleep(300);
    const outcomes: string[] = [];
    for (let i = 0; i < 6; i++) { const b = new Bot(nm, "sword"); b.pw = "bad-guess-" + i; await b.login(); outcomes.push(b.errors[0] ?? ""); b.close(); }
    const firstBlock = outcomes.findIndex((e) => e === "Too many attempts. Wait a minute.");
    // earlier sections already burned two failures from this IP, so the block may arrive before our 5th guess (never after it)
    check("repeated wrong passwords -> 'Too many attempts. Wait a minute.' (limit 5 failures/60 s)", firstBlock >= 3 && firstBlock <= 5 && outcomes.slice(0, firstBlock).every((e) => e === "Wrong password for that name.") && outcomes.slice(firstBlock).every((e) => e === "Too many attempts. Wait a minute."), outcomes.join(" | "));
    const good = new Bot(nm, "sword"); const goodOk = await good.login();
    check("blocked even with the correct pw while rate-limited", !goodOk && good.errors[0] === "Too many attempts. Wait a minute.", good.errors[0]);
    good.close();
  }

  for (const b of all) b.close();
  await sleep(300);
  check("server healthy after all bots left", await healthOk());
  await stopServer();
}

main()
  .catch((e) => { console.error("test crashed:", e); check("test harness ran to completion", false, String(e)); })
  .finally(async () => {
    if (child && !child.killed && child.exitCode === null) child.kill("SIGKILL");
    const failed = results.filter((r) => !r.ok);
    console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
    for (const f of failed) console.log(`  FAILED: ${f.name} ${f.detail}`);
    console.log(failed.length ? "RESULT: FAIL" : "RESULT: PASS");
    process.exit(failed.length ? 1 : 0);
  });
