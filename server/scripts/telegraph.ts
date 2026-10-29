// Telegraph shapes test (v3.1): regular-mob cone/line telegraphs (Fox Spirit bite, Bamboo Spirit smash), the shared hit-test helper, and the
// Stone Guardian's phase-3 rotating rune beam. Spawns its own TEST_MODE server on TELE_PORT (default 8991) with a temp DB.
//   npx tsx scripts/telegraph.ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { PLAYER_SPEED, PROTOCOL_VERSION, telegraphContains } from "../../shared/protocol.ts";
import type { ClassId, EntityState, GameEvent, ServerMsg } from "../../shared/protocol.ts";
import { MOBS } from "../src/data.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.TELE_PORT) || 8991;
const URL = `ws://127.0.0.1:${PORT}`;
const SUFFIX = String(Date.now() % 100000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = "") { results.push({ name, ok }); console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); }
async function until(cond: () => boolean, ms: number, step = 50) { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await sleep(step); } return cond(); }

type Tele = Extract<GameEvent, { k: "telegraph" }>;
class Bot {
  ws!: WebSocket; id = 0; ents = new Map<number, EntityState>(); seq = 0;
  teles: Array<{ e: Tele; t: number }> = []; dmg: Array<{ t: number; src: number; amount: number }> = []; chats: string[] = [];
  constructor(public name: string, public cls: ClassId) {}
  get me() { return this.ents.get(this.id)!; }
  async login() {
    this.ws = new WebSocket(URL);
    await new Promise<void>((res, rej) => { this.ws.on("open", () => res()); this.ws.on("error", rej); });
    this.ws.on("message", (d) => this.onMsg(JSON.parse(d.toString())));
    this.ws.send(JSON.stringify({ t: "login", name: this.name, cls: this.cls, v: PROTOCOL_VERSION, pw: "botpass-1234" }));
    await until(() => this.id !== 0 && this.ents.has(this.id), 4000);
  }
  private onMsg(m: ServerMsg) {
    if (m.t === "welcome") this.id = m.id;
    else if (m.t === "snap") { for (const g of m.gone) this.ents.delete(g); for (const e of m.ents) this.ents.set(e.id, e); }
    else if (m.t === "ev") {
      const e = m.e, t = Date.now();
      if (e.k === "telegraph") this.teles.push({ e, t });
      else if (e.k === "damage" && e.dst === this.id) this.dmg.push({ t, src: e.src, amount: e.amount });
      else if (e.k === "chat") this.chats.push(e.text);
    }
  }
  say(text: string) { this.ws.send(JSON.stringify({ t: "chat", text })); }
  move(dx: number, dz: number) { this.ws.send(JSON.stringify({ t: "input", seq: ++this.seq, dx, dz })); }
  /** hold a direction for `ms` (the server drops stale inputs after a fraction of a second, so keep re-sending), then stop */
  async run(dx: number, dz: number, ms: number) { const end = Date.now() + ms; while (Date.now() < end) { this.move(dx, dz); await sleep(80); } this.move(0, 0); }
  close() { this.ws.close(); }
}

let child: ChildProcess | undefined, tmp = "";
async function startServer() {
  tmp = mkdtempSync(join(tmpdir(), "jiuzhou-tele-"));
  child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmp, "t.db"), NODE_NO_WARNINGS: "1", TEST_MODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr!.on("data", (d) => process.stderr.write(`[server!] ${d}`));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* not up */ } await sleep(100); }
  throw new Error("server did not start");
}

/** Regular-mob swing: stand still (hit lands after the wind-up), then dodge (hit misses). */
async function mobCase(label: string, type: "fox_spirit" | "bamboo_spirit", at: { x: number; z: number }, expect: { shape: "cone" | "line"; delay: number }) {
  console.log(`\n[${label}]`);
  const sw = MOBS[type].swing!;
  const b = new Bot(`${label.replace(/\W/g, "").slice(0, 8)}${SUFFIX}`, "sword");
  await b.login();
  b.say("/testlevel 20");
  b.say(`/testtp ${at.x} ${at.z - 40}`); // look from a distance first so nothing aggros before the test starts
  await sleep(1200);
  const mobs = () => [...b.ents.values()].filter((e) => e.k === "mob" && e.mob === type && e.hp > 0);
  const nearest = () => mobs().sort((p, q) => dist(p.x, p.z, b.me.x, b.me.z) - dist(q.x, q.z, b.me.x, b.me.z))[0];
  const m0 = nearest();
  check(`a ${type} is in view`, !!m0);
  if (!m0) { b.close(); return; }
  // stand 6 units from it, then let it come: first swing, no dodge
  b.teles.length = 0; b.dmg.length = 0;
  b.say(`/testtp ${m0.x + 6} ${m0.z}`);
  const got = await until(() => b.teles.some((x) => x.e.src === m0.id), 12000);
  check(`${type} emits a telegraph before attacking`, got);
  const first = b.teles.find((x) => x.e.src === m0.id);
  if (!first) { b.close(); return; }
  const e = first.e;
  check(`telegraph is a ${expect.shape} with delay ${expect.delay} s`, e.shape === expect.shape && Math.abs(e.delay - expect.delay) < 1e-9, `shape=${e.shape} delay=${e.delay}`);
  check("telegraph keeps the old circle fields (x, z, radius = reach) for old clients", Number.isFinite(e.x) && Number.isFinite(e.z) && e.radius === sw.reach);
  if (expect.shape === "cone") check("cone carries arc + dir", Math.abs((e.arc ?? 0) - sw.arc) < 1e-9 && typeof e.dir === "number");
  else check("line carries len, width + dir", e.len === sw.reach && e.width === sw.width && typeof e.dir === "number");
  const mob = b.ents.get(m0.id)!;
  const aim = Math.atan2(b.me.x - e.x, b.me.z - e.z);
  let dd = Math.abs(((e.dir ?? 0) - aim) % (Math.PI * 2)); if (dd > Math.PI) dd = Math.PI * 2 - dd;
  check("shape is aimed at the player", dd < 0.35, `off by ${(dd * 57.3).toFixed(0)} deg`);
  check("player is inside the shape when it was cast", telegraphContains(e, b.me.x, b.me.z));
  const gotHit = await until(() => b.dmg.some((d) => d.src === m0.id && d.t >= first.t), 2500);
  const hit = b.dmg.find((d) => d.src === m0.id && d.t >= first.t);
  const lag = hit ? (hit.t - first.t) / 1000 : -1;
  check(`standing in it: the hit lands after the wind-up (>= ${expect.delay - 0.1} s, < ${expect.delay + 0.45} s)`, gotHit && lag >= expect.delay - 0.1 && lag <= expect.delay + 0.45, `${lag.toFixed(2)} s`);
  check("the mob is frozen during the wind-up (stays at the telegraph origin)", dist(mob.x, mob.z, e.x, e.z) < 0.6, `${dist(mob.x, mob.z, e.x, e.z).toFixed(2)}u`);
  // second swing: dodge out of the shape as soon as the telegraph arrives (retreat straight back / strafe sideways)
  b.say("/testheal");
  await sleep(300);
  const n0 = b.teles.length, d0 = b.dmg.length;
  const second = await until(() => b.teles.length > n0, 8000);
  check("a second telegraph follows (attack cooldown)", second);
  if (second) {
    const t2 = b.teles[n0], e2 = t2.e;
    const perp = expect.shape === "line" ? [Math.cos(e2.dir ?? 0), -Math.sin(e2.dir ?? 0)] : [-Math.sin(e2.dir ?? 0), -Math.cos(e2.dir ?? 0)]; // strafe sideways for a line, back off for a cone
    await b.run(perp[0], perp[1], 420);
    await sleep(900);
    const outside = !telegraphContains(e2, b.me.x, b.me.z);
    const hurt = b.dmg.slice(d0).filter((d) => d.src === m0.id && d.t >= t2.t && d.t <= t2.t + 1200);
    check("dodging out of the shape before it lands avoids the hit", outside && hurt.length === 0, `outside=${outside} hits=${hurt.length}`);
  }
  b.close();
  await sleep(300);
}

async function bossCase() {
  console.log("\n[Stone Guardian phase 3 beam]");
  const BOSS = { x: 0, z: 85 };
  const A = new Bot("BeamA" + SUFFIX, "sword"), B = new Bot("BeamB" + SUFFIX, "sword");
  await A.login(); await B.login();
  for (const b of [A, B]) { b.say("/testlevel 20"); b.say(`/testtp ${BOSS.x} ${BOSS.z - 9}`); }
  const heal = setInterval(() => { A.say("/testheal"); B.say("/testheal"); }, 600);
  const boss = () => [...A.ents.values()].find((e) => e.mob === "stone_guardian")!;
  await until(() => !!boss(), 3000);
  await sleep(5000); // engaged: first slam telegraph is a circle (3 s after engage)
  // only the Guardian's own telegraphs: ordinary mobs wandering near the shrine now draw cones and lines (their own 0.4.0 feature)
  const bossTeles = () => A.teles.filter((x) => x.e.src === boss().id);
  check("phase 1/2 telegraphs stay circles (no shape field)", bossTeles().length >= 1 && bossTeles().every((x) => !x.e.shape && !x.e.beam));
  check("no beam before 25% HP", !bossTeles().some((x) => x.e.beam));
  A.say("/testbosshp 0.2"); await sleep(300);
  const sawBeam = await until(() => A.teles.some((x) => x.e.beam) && B.teles.some((x) => x.e.beam), 9000);
  check("at 25% HP: 'cracks open' system message", A.chats.some((c) => /cracks open/.test(c)));
  check("rotating beam telegraph arrives (line, beam flag)", sawBeam);
  const bt = A.teles.find((x) => x.e.beam);
  if (!bt) { clearInterval(heal); A.close(); B.close(); return; }
  const e = bt.e;
  check("beam geometry: line 28 long, 2.8 wide, from the boss", e.shape === "line" && e.len === 28 && e.width === 2.8 && e.radius === 28 && dist(e.x, e.z, boss().x, boss().z) < 6, `len=${e.len} width=${e.width}`);
  check("beam sweeps ~90 degrees over 3 s after a 0.9 s warning (delay = lead + 3)", Math.abs(Math.abs(e.sweep ?? 0) - Math.PI / 2) < 0.01 && e.lead === 0.9 && Math.abs(e.delay - 3.9) < 1e-9, `sweep=${e.sweep} lead=${e.lead} delay=${e.delay}`);
  // A stands still on the sweep line; B runs along the tangent in the direction of the sweep and stays ahead of the beam
  const sgn = Math.sign(e.sweep ?? 1);
  const rad = Math.atan2(A.me.x - e.x, A.me.z - e.z);
  const tx = Math.cos(rad) * sgn, tz = -Math.sin(rad) * sgn; // d/dangle of (sin a, cos a) is (cos a, -sin a): tangent that increases the angle
  const bossAtStart = { x: boss().x, z: boss().z };
  const runB = B.run(tx, tz, 4200);
  await sleep(1200);
  const mid = { x: boss().x, z: boss().z };
  await runB;
  const beamEnd = bt.t + e.delay * 1000;
  const aTicks = A.dmg.filter((d) => d.src === boss().id && d.t >= bt.t + 850 && d.t <= beamEnd + 500 && d.amount >= 20 && d.amount <= 31);
  const aEarly = A.dmg.filter((d) => d.src === boss().id && d.t < bt.t + 850 && d.t >= bt.t && d.amount <= 31);
  check("standing in the sweep: damage ticks along the beam (>= 2 hits)", aTicks.length >= 2, `${aTicks.length} ticks of ${aTicks.map((d) => d.amount).join("/")}`);
  check("no beam damage during the 0.9 s warning", aEarly.length === 0, `${aEarly.length}`);
  const bTicks = B.dmg.filter((d) => d.src === boss().id && d.t >= bt.t + 850 && d.t <= beamEnd + 500 && d.amount >= 20 && d.amount <= 31);
  check("running around the beam takes no beam damage", bTicks.length === 0, `${bTicks.length} ticks, B moved ${dist(A.me.x, A.me.z, B.me.x, B.me.z).toFixed(1)}u from A`);
  check("the Guardian stays rooted while it channels", dist(bossAtStart.x, bossAtStart.z, mid.x, mid.z) < 0.5, `moved ${dist(bossAtStart.x, bossAtStart.z, mid.x, mid.z).toFixed(2)}u`);
  await sleep(800);
  const late = A.dmg.filter((d) => d.src === boss().id && d.t > beamEnd + 600 && d.amount <= 28); // the Guardian only: wandering mobs may bite A meanwhile
  check("beam damage stops after the sweep", late.length === 0, `${late.length} late ticks ${late.map((d) => `${d.amount}@${d.t - beamEnd}ms src${d.src}`).join(" ")}`);
  // later patterns still come: another telegraph (circle or beam) follows
  const n = A.teles.length;
  const more = await until(() => A.teles.length > n, 12000);
  check("pattern cycle continues in phase 3 (further telegraphs)", more);
  clearInterval(heal);
  A.close(); B.close();
}

function geometryCases() {
  console.log("\n[telegraphContains]");
  const cone = { shape: "cone" as const, x: 0, z: 0, radius: 3.5, arc: 1.45, dir: 0 };
  check("cone: ahead inside, behind outside, beyond reach outside, edge of arc", telegraphContains(cone, 0, 2) && !telegraphContains(cone, 0, -2) && !telegraphContains(cone, 0, 4) && telegraphContains(cone, Math.sin(0.7) * 2, Math.cos(0.7) * 2) && !telegraphContains(cone, Math.sin(0.8) * 2, Math.cos(0.8) * 2));
  check("cone: facing wraps around +-PI", telegraphContains({ ...cone, dir: Math.PI }, 0, -2) && telegraphContains({ ...cone, dir: -Math.PI + 0.1 }, 0.2, -2) );
  const line = { shape: "line" as const, x: 0, z: 0, radius: 3.6, len: 3.6, width: 1.9, dir: Math.PI / 2 };
  check("line: along +x strip", telegraphContains(line, 3, 0.5) && !telegraphContains(line, 3, 1.2) && !telegraphContains(line, 4, 0) && !telegraphContains(line, -2, 0));
  check("circle (default) unchanged", telegraphContains({ x: 1, z: 1, radius: 2 }, 2, 2) && !telegraphContains({ x: 1, z: 1, radius: 2 }, 4, 1));
  check("beam dir override rotates the line", telegraphContains({ ...line, dir: 0, len: 28, width: 2.8 }, 0, 20, Math.PI / 2) === false && telegraphContains({ ...line, dir: 0, len: 28, width: 2.8 }, 20, 0, Math.PI / 2));
  void PLAYER_SPEED;
}

async function main() {
  console.log(`telegraph test -> ${URL}`);
  await startServer();
  geometryCases();
  await mobCase("Fox bite cone", "fox_spirit", { x: 55, z: 30 }, { shape: "cone", delay: 0.4 });
  await mobCase("Bamboo smash line", "bamboo_spirit", { x: -40, z: 10 }, { shape: "line", delay: 0.5 });
  await bossCase();
}

main()
  .catch((e) => { console.error("test crashed:", e); check("harness ran to completion", false, String(e)); })
  .finally(() => {
    child?.kill("SIGTERM");
    if (tmp) setTimeout(() => rmSync(tmp, { recursive: true, force: true }), 800);
    const failed = results.filter((r) => !r.ok);
    console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
    for (const f of failed) console.log(`  FAILED: ${f.name}`);
    console.log(failed.length ? "RESULT: FAIL" : "RESULT: PASS");
    setTimeout(() => process.exit(failed.length ? 1 : 0), 900);
  });
