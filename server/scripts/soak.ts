// 3-minute soak test: boots the real server (port SOAK_PORT, default 8911) with a temp DB and drives 3 bots
// (sword / talisman / physician) through a quest-flavoured route: /talk to Elder Lin, hunt bamboo spirits,
// return to turn in, hunt fox spirits, chat, loot, die to the Stone Guardian once and respawn.
//   npm run soak                    full run (SOAK_SECONDS=180)
//   SOAK_SECONDS=60 npm run soak    shorter run (handy for tuning; also prints time-to-kill tables)
//   SOAK_URL=ws://host:port         soak an already running server (server log / RSS checks then use /health only)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../../shared/protocol.ts";
import type { ClassId, EntityState, GameEvent, ServerMsg, SkillDef } from "../../shared/protocol.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.SOAK_PORT) || 8972;
const DURATION = (Number(process.env.SOAK_SECONDS) || 180) * 1000;
const URL = process.env.SOAK_URL || `ws://127.0.0.1:${PORT}`;
const HTTP = URL.replace(/^ws/, "http");
const SUFFIX = String(Date.now() % 100000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

const ELDER = { x: -4, z: -68 };
const BOSS = { x: 0, z: 80 };
const PATROL = {
  bamboo_spirit: [[-45, 0], [-30, 25], [-50, 30], [-35, -10]],
  fox_spirit: [[45, 20], [65, 40], [40, 45], [60, 10]],
  jade_serpent: [[25, -40], [-25, -38], [26, -30], [14, -18], [-12, -15], [-25, -31]],
} as Record<string, number[][]>;

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

type Phase = "talk" | "hunt" | "return" | "suicide" | "dead";
interface Kill { cls: ClassId; mob: string; mobLv: number; myLv: number; secs: number }

class Bot {
  ws!: WebSocket; id = 0; skills: SkillDef[] = [];
  ents = new Map<number, EntityState>();
  errors: string[] = []; closedUnexpectedly = false; closing = false;
  snaps = 0; windowSnaps: number[] = []; maxEnts = 0; lastEntCount = 0;
  seq = 0; lastCast: Record<number, number> = {};
  xpGain = 0; level = 1; deaths = 0; respawns = 0; kills = 0; loots = 0; casts = 0; damageDealt = 0; chatsHeard = 0; healed = 0;
  invMsgs = 0; invItems: Array<{ item: string; qty: number }> = [];
  questStage = 0; questsCompleted = 0; sysSeen: string[] = [];
  phase: Phase = "talk"; target = 0; patrolIdx = 0; talkedAt = 0; lastChatAt = 0; suicideDone = false;
  engaged = new Map<number, number>(); // mob id -> engagement start (ms)
  killLog: Kill[] = []; engagedLv = new Map<number, number>();
  brain?: NodeJS.Timeout; wasDead = false;

  constructor(public name: string, public cls: ClassId) {}
  get me() { return this.ents.get(this.id); }

  async login() {
    await new Promise<void>((res, rej) => {
      this.ws = new WebSocket(URL);
      this.ws.on("open", () => res());
      this.ws.on("error", rej);
      this.ws.on("close", () => { if (!this.closing) { this.closedUnexpectedly = true; this.errors.push("connection closed unexpectedly"); } });
      this.ws.on("message", (d) => this.onMsg(JSON.parse(d.toString())));
    });
    this.send({ t: "login", name: this.name, cls: this.cls, v: PROTOCOL_VERSION, pw: "botpass-1234" });
    for (let i = 0; i < 60 && !this.id; i++) await sleep(100);
    if (!this.id) throw new Error(`${this.name} login failed: ${this.errors.join(";")}`);
  }
  send(m: Record<string, unknown>) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  input(dx: number, dz: number) { this.send({ t: "input", seq: ++this.seq, dx, dz }); }
  say(text: string) { this.send({ t: "chat", text }); }

  onMsg(m: ServerMsg) {
    if (m.t === "welcome") { this.id = m.id; this.skills = m.skills; }
    else if (m.t === "error") this.errors.push(m.msg);
    else if (m.t === "inv") { this.invMsgs++; this.invItems = m.items; }
    else if (m.t === "snap") {
      this.snaps++;
      for (const id of m.gone) this.ents.delete(id);
      for (const e of m.ents) this.ents.set(e.id, e);
      this.lastEntCount = m.ents.length; this.maxEnts = Math.max(this.maxEnts, m.ents.length);
    } else if (m.t === "ev") this.onEvent(m.e);
  }

  onEvent(e: GameEvent) {
    switch (e.k) {
      case "xp": this.xpGain += e.amount; this.level = e.lv; break;
      case "loot": this.loots++; break;
      case "heal": if (e.dst === this.id) this.healed += e.amount; break;
      case "cast": if (e.src === this.id) this.casts++; break;
      case "damage":
        if (e.src === this.id) {
          this.damageDealt += e.amount;
          if (!this.engaged.has(e.dst)) { this.engaged.set(e.dst, Date.now()); this.engagedLv.set(e.dst, this.level); }
        }
        break;
      case "death":
        if (e.id === this.id) { this.deaths++; this.engaged.clear(); const k = this.ents.get(e.killer ?? -1); this.deathLog.push(`${k?.mob ?? "?"} lv${k?.lv ?? "?"} at myLv${this.level} @${Math.round(this.me?.x ?? 0)},${Math.round(this.me?.z ?? 0)} phase ${this.phase}`); }
        else if (e.killer === this.id) {
          this.kills++;
          const t0 = this.engaged.get(e.id), mob = this.ents.get(e.id);
          if (t0 && mob) this.killLog.push({ cls: this.cls, mob: mob.mob ?? "?", mobLv: mob.lv, myLv: this.engagedLv.get(e.id) ?? 0, secs: (Date.now() - t0) / 1000 });
          this.engaged.delete(e.id);
        }
        break;
      case "chat":
        if (e.sys) {
          if (this.sysSeen.length < 200) this.sysSeen.push(e.text);
          const q = /\[Quest (\d)\/4\]/.exec(e.text);
          if (q) this.questStage = Number(q[1]) - 1;
          if (/objective complete/.test(e.text) && this.phase === "hunt") this.phase = "return";
          if (/Quest complete:/.test(e.text)) this.questsCompleted++;
        } else if (e.from !== this.name) this.chatsHeard++;
        break;
    }
  }

  start() { this.brain = setInterval(() => this.think(), 50); }
  stop() { if (this.brain) clearInterval(this.brain); this.brain = undefined; }
  close() { this.closing = true; this.stop(); this.ws?.close(); }

  private steer(tx: number, tz: number, stop: number) {
    const me = this.me!, d = dist(me.x, me.z, tx, tz);
    if (d <= stop) { this.input(0, 0); return true; }
    this.input((tx - me.x) / d, (tz - me.z) / d);
    return false;
  }
  private ready(s: number) {
    const def = this.skills[s - 1];
    return !!def && Date.now() - (this.lastCast[s] ?? 0) > def.cooldown * 1000 + 100;
  }
  private cast(skill: number, extra: Record<string, unknown> = {}) {
    this.lastCast[skill] = Date.now();
    this.send({ t: "cast", skill, ...extra });
  }

  private huntType() {
    if (this.questStage === 1 && this.phase !== "talk") return "fox_spirit";
    if (this.questStage === 2 && this.phase !== "talk") return "jade_serpent";
    if (this.questStage >= 3) return "fox_spirit";
    return this.level >= 4 ? "fox_spirit" : "bamboo_spirit";
  }

  private threatsNear(me: EntityState, r: number) {
    let n = 0;
    for (const e of this.ents.values()) if (e.k === "mob" && e.st !== "dead" && e.hp > 0 && dist(me.x, me.z, e.x, e.z) < r && e.mob !== "stone_guardian") n++;
    return n;
  }

  private think() {
    const me = this.me;
    if (!me) return;
    const now = Date.now();
    if (me.st === "dead") {
      this.wasDead = true; this.input(0, 0);
      return;
    }
    if (this.wasDead) { this.wasDead = false; this.respawns++; if (this.phase === "suicide") this.suicideDone = true; this.phase = "hunt"; this.target = 0; this.engaged.clear(); }

    // chat now and then
    if (now - this.lastChatAt > 25_000) { this.lastChatAt = now; this.say(`${this.cls} reporting, lv${this.level}`); }

    // scripted one-time boss run to exercise death + respawn
    if (this.cls === "sword" && !this.suicideDone && this.phase === "hunt" && now - this.startedAt > DURATION * 0.5) { this.phase = "suicide"; this.suicideStart = now; }
    if (this.phase === "suicide") {
      const d = dist(me.x, me.z, BOSS.x, BOSS.z);
      if (d > 3.5) this.steer(BOSS.x, BOSS.z, 3);
      else this.input(0, 0); // stand next to the guardian and do nothing: it should kill us
      if (now - this.suicideStart > 90_000) { this.suicideDone = true; this.phase = "hunt"; }
      return;
    }
    if (this.phase === "talk" || this.phase === "return") {
      if (this.steer(ELDER.x, ELDER.z, 3.5)) {
        if (now - this.talkedAt > 1500) {
          this.talkedAt = now; this.say("/talk");
          if (this.phase === "talk") this.phase = "hunt";
          else this.phase = "hunt"; // after turn-in the server auto-accepts the next quest; if not ready, hunt again
        }
      }
      return;
    }

    // ---- hunt ----
    const type = this.huntType();
    let tgt = this.target ? this.ents.get(this.target) : undefined;
    if (!tgt || tgt.st === "dead" || tgt.hp <= 0 || dist(me.x, me.z, tgt.x, tgt.z) > 55) {
      tgt = undefined; this.target = 0;
      let bd = 45;
      for (const e of this.ents.values()) {
        if (e.k !== "mob" || e.mob !== type || e.st === "dead" || e.hp <= 0) continue;
        if (e.lv > this.level + 3) continue; // v3: the valley now has lv5-20 tiers of the same mob types; a sane player does not pull mobs 4+ levels above
        const d = dist(me.x, me.z, e.x, e.z);
        if (d < bd) { bd = d; tgt = e; }
      }
      if (tgt) this.target = tgt.id;
    }
    const hpFrac = me.hp / me.mhp;
    if (!tgt) {
      // rest if hurt, otherwise patrol the hunting ground
      if (hpFrac < 0.7 && this.threatsNear(me, 14) === 0) {
        this.input(0, 0);
        if (this.cls === "physician" && this.ready(2)) this.cast(2);
        return;
      }
      const route = PATROL[type];
      const [px, pz] = route[this.patrolIdx % route.length];
      if (this.steer(px, pz, 3)) this.patrolIdx++;
      return;
    }
    // don't pull more while badly hurt and calm
    if (hpFrac < 0.5 && this.threatsNear(me, 14) === 0 && !this.engaged.size) { this.input(0, 0); if (this.cls === "physician" && this.ready(4)) this.cast(4); return; }

    const d = dist(me.x, me.z, tgt.x, tgt.z);
    const r = (s: number) => this.skills[s - 1].range;
    const crowd = this.threatsNear(me, 8);
    if (this.cls === "sword") {
      this.steer(tgt.x, tgt.z, 2.5);
      if (d <= r(3) && this.ready(3)) this.cast(3, { target: tgt.id });
      else if (d > 4 && d <= r(2) && this.ready(2)) this.cast(2, { target: tgt.id });
      else if (d <= r(1) && this.ready(1)) this.cast(1, { target: tgt.id });
      if ((hpFrac < 0.5 || crowd >= 2 && hpFrac < 0.8) && this.ready(4)) this.cast(4);
    } else if (this.cls === "talisman") {
      this.steer(tgt.x, tgt.z, 11);
      if (crowd >= 2 && d <= r(2) && this.ready(2)) this.cast(2, { target: tgt.id, tx: tgt.x, tz: tgt.z });
      else if (d <= r(3) && this.ready(3) && (d < 8 || crowd >= 2)) this.cast(3, { target: tgt.id });
      else if (d <= r(1) && this.ready(1)) this.cast(1, { target: tgt.id });
      else if (d <= r(2) && this.ready(2)) this.cast(2, { target: tgt.id, tx: tgt.x, tz: tgt.z });
      if ((hpFrac < 0.6 || d < 5 && hpFrac < 0.85) && this.ready(4)) this.cast(4);
    } else {
      this.steer(tgt.x, tgt.z, 10);
      if (hpFrac < 0.3 && this.ready(4)) this.cast(4);
      else if (hpFrac < 0.7 && this.ready(2)) this.cast(2);
      else if (d <= r(3) && this.ready(3)) this.cast(3, { target: tgt.id, tx: tgt.x, tz: tgt.z });
      else if (d <= r(1) && this.ready(1)) this.cast(1, { target: tgt.id });
    }
  }
  deathLog: string[] = [];
  startedAt = Date.now(); suicideStart = Date.now();
}

// ---------------- server process ----------------
let child: ChildProcess | undefined;
let tmp = "";
const serverLog: string[] = [];
async function startServer() {
  if (process.env.SOAK_URL) return;
  tmp = mkdtempSync(join(tmpdir(), "jiuzhou-soak-"));
  child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmp, "soak.db"), NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => serverLog.push(...String(d).split("\n").filter(Boolean)));
  child.stderr!.on("data", (d) => serverLog.push(...String(d).split("\n").filter(Boolean).map((l) => "[stderr] " + l)));
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${HTTP}/health`)).ok) return; } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error("server did not start");
}
async function health(): Promise<any> { try { return await (await fetch(`${HTTP}/health`)).json(); } catch { return null; } }

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

async function main() {
  console.log(`JIUZHOU soak: ${DURATION / 1000}s against ${URL}`);
  await startServer();
  // SOAK_CLASSES=physician runs a single class alone (clean time-to-kill numbers: bots otherwise share mobs)
  const only = (process.env.SOAK_CLASSES || "sword,talisman,physician").split(",") as ClassId[];
  const bots = only.map((c, i) => new Bot(`Soak${["Sword", "Tali", "Med"][["sword", "talisman", "physician"].indexOf(c)]}${SUFFIX}`, c));
  for (const b of bots) await b.login();
  await sleep(300);
  const t0 = Date.now();
  for (const b of bots) { b.startedAt = t0; b.start(); }

  const samples: Array<{ t: number; rss: number; entities: number; players: number; dropped: number }> = [];
  const winStart: number[] = bots.map(() => 0);
  let nextWindow = t0 + 10_000;
  while (Date.now() - t0 < DURATION) {
    await sleep(1000);
    const now = Date.now();
    const h = await health();
    if (h) samples.push({ t: (now - t0) / 1000, rss: h.rss, entities: h.entities, players: h.players, dropped: h.droppedSnaps ?? 0 });
    if (now >= nextWindow) {
      bots.forEach((b, i) => { b.windowSnaps.push((b.snaps - winStart[i]) / 10); winStart[i] = b.snaps; });
      nextWindow += 10_000;
      const line = bots.map((b) => `${b.cls}[lv${b.level} xp+${b.xpGain} k${b.kills} d${b.deaths} q${b.questStage}${b.phase[0]} ${b.windowSnaps.at(-1)!.toFixed(1)}snap/s]`).join(" ");
      console.log(`  t=${Math.round((now - t0) / 1000)}s rss=${h ? (h.rss / 1048576).toFixed(0) : "?"}MB ents=${h?.entities} ${line}`);
    }
  }
  for (const b of bots) b.stop();
  const final = await health();
  const lastChats = bots.map((b) => b.chatsHeard);
  for (const b of bots) b.close();
  await sleep(500);

  // ---------------- assertions ----------------
  console.log("\n[results]");
  const errLines = serverLog.filter((l) => /tick error|handler error|uncaught|unhandled|save failed|autosave failed|heartbeat timeout|terminating client|\[stderr\]|\bError\b/i.test(l));
  check("zero server errors in log", errLines.length === 0, errLines.slice(0, 3).join(" | ") || `${serverLog.length} log lines`);
  check("server alive at end (/health ok)", !!final?.ok, `tick ${final?.tick}`);
  check("no bot connection dropped", bots.every((b) => !b.closedUnexpectedly), bots.flatMap((b) => b.errors).join(";") || "all 3 connected throughout");
  check("every class gained XP", bots.every((b) => b.xpGain > 0), bots.map((b) => `${b.cls}:+${b.xpGain}xp lv${b.level} kills ${b.kills}`).join(" "));
  check("every class dealt damage and cast skills", bots.every((b) => b.damageDealt > 0 && b.casts > 5), bots.map((b) => `${b.cls}:${b.casts} casts`).join(" "));
  check("inventory (`inv`) messages received; stacks within caps", bots.every((b) => b.invMsgs >= 2 && b.invItems.every((i) => i.qty >= 1 && i.qty <= 99)), bots.map((b) => `${b.cls}:${b.invMsgs} msgs, ${b.invItems.length} stacks`).join(" "));
  check("loot received", bots.every((b) => b.loots > 0) || bots.some((b) => b.loots > 2), bots.map((b) => `${b.cls}:${b.loots}`).join(" "));
  check("chat delivered between bots", lastChats.every((n) => n > 0), lastChats.join("/"));
  check("quest dialog flowed (sys chat)", bots.every((b) => b.sysSeen.some((t) => /Elder Lin/.test(t))) && bots.some((b) => b.questsCompleted > 0), `completed turn-ins ${bots.map((b) => b.questsCompleted).join("/")}`);
  const sw = bots.find((b) => b.cls === "sword") ?? bots[0];
  if (DURATION >= 120_000) check("death + respawn works (scripted sword boss run)", sw.deaths >= 1 && sw.respawns >= 1 && sw.kills > 0, `deaths ${bots.map((b) => b.deaths).join("/")} respawns ${bots.map((b) => b.respawns).join("/")}`);
  else console.log(`  info  deaths ${bots.map((b) => b.deaths).join("/")} respawns ${bots.map((b) => b.respawns).join("/")}`);
  const base = samples.find((s) => s.t >= 20) ?? samples[0], end = samples.at(-1);
  if (base && end) {
    const growth = (end.rss - base.rss) / base.rss;
    check("server RSS growth < 30%", growth < 0.3, `${(base.rss / 1048576).toFixed(0)}MB @${base.t.toFixed(0)}s -> ${(end.rss / 1048576).toFixed(0)}MB (${(growth * 100).toFixed(1)}%)`);
  } else check("server RSS growth < 30%", false, "no /health samples");
  const maxEnt = Math.max(...samples.map((s) => s.entities)), minEnt = Math.min(...samples.map((s) => s.entities));
  check("server entity count bounded (constant)", maxEnt - minEnt <= 3 && maxEnt <= 120, /* v3: ~71 (4 NPCs + 64 mobs + players); was <= 40 before the higher-level tiers */ `${minEnt}..${maxEnt}`);
  check("client-visible entities bounded", bots.every((b) => b.maxEnts <= 40 && b.ents.size <= 40), `max ${bots.map((b) => b.maxEnts).join("/")}`);
  const win = bots.map((b) => b.windowSnaps.slice(1));
  const allWin = win.flat();
  check("snapshot rate stable (8-12/s every 10 s window)", allWin.length > 0 && allWin.every((r) => r >= 8 && r <= 12), `min ${Math.min(...allWin).toFixed(1)} max ${Math.max(...allWin).toFixed(1)}`);
  check("no snapshots dropped for slow sockets", (end?.dropped ?? 0) === 0, `${end?.dropped ?? "?"} dropped`);

  // time-to-kill table
  console.log("\n[time to kill, seconds from first own hit to kill]");
  for (const b of bots) {
    for (const mob of ["bamboo_spirit", "fox_spirit", "jade_serpent"]) {
      const ks = b.killLog.filter((k) => k.mob === mob);
      const lv1 = ks.filter((k) => k.myLv <= 2);
      if (!ks.length) continue;
      const fmt = (a: Kill[]) => a.length ? `median ${median(a.map((k) => k.secs)).toFixed(1)}s min ${Math.min(...a.map((k) => k.secs)).toFixed(1)} max ${Math.max(...a.map((k) => k.secs)).toFixed(1)} n=${a.length}` : "n=0";
      console.log(`  ${b.cls.padEnd(9)} ${mob.padEnd(14)} all: ${fmt(ks)} | player lv<=2: ${fmt(lv1)}`);
    }
  }
  for (const b of bots) if (b.deathLog.length) console.log(`  deaths ${b.cls}: ${b.deathLog.join(" | ")}`);
  if (process.env.SOAK_DUMP_KILLS) for (const b of bots) for (const k of b.killLog) console.log(`  kill ${k.cls} ${k.mob} mobLv${k.mobLv} myLv${k.myLv} ${k.secs.toFixed(1)}s`);
}

async function stopServer() {
  if (!child) return;
  const exited = new Promise<number | null>((r) => child!.once("exit", (c) => r(c)));
  child.kill("SIGTERM");
  const code = await Promise.race([exited, sleep(5000).then(() => "timeout" as const)]);
  if (code === "timeout") child.kill("SIGKILL");
  check("server shut down cleanly", code === 0, `exit=${code}`);
  rmSync(tmp, { recursive: true, force: true });
}

main()
  .catch((e) => { console.error("soak crashed:", e); check("soak harness ran to completion", false, String(e)); })
  .finally(async () => {
    await stopServer();
    if (child && child.exitCode === null) child.kill("SIGKILL");
    const failed = results.filter((r) => !r.ok);
    console.log(`\n==== soak: ${results.length - failed.length}/${results.length} checks passed ====`);
    for (const f of failed) console.log(`  FAILED: ${f.name} ${f.detail}`);
    console.log(failed.length ? "RESULT: FAIL" : "RESULT: PASS");
    process.exit(failed.length ? 1 : 0);
  });
