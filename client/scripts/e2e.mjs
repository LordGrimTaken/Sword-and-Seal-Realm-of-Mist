// End-to-end test: real server + built client + 2 headless Chromium pages (+ WebSocket bots for class coverage).
//   node scripts/e2e.mjs            (from client/; ports from JZ_SERVER_PORT / JZ_CLIENT_PORT, default 8981 / 8982; SOAK_S=180 soak seconds)
// Prints PASS/FAIL per check and exits non-zero on failure. Screenshots go to docs/shots/e2e_*.png.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const HERE = import.meta.dirname;
const CLIENT = resolve(HERE, "..");
const ROOT = resolve(CLIENT, "..");
const SERVER = join(ROOT, "server");
const SHOTS = join(ROOT, "docs", "shots");
const SP = Number(process.env.JZ_SERVER_PORT) || 8981, WP = Number(process.env.JZ_CLIENT_PORT) || 8982;
const SOAK_S = Number(process.env.SOAK_S) || 180;
const DIST = process.env.E2E_DIST || join(tmpdir(), "jz-e2e-dist"); // private build dir: portable and cleaned up, unlike the old /tmp path on Windows
const req = createRequire(import.meta.url);
const { chromium } = req("playwright"); // local devDependency: portable (the CI image's /opt/npm-tools path does not exist on Windows)
const WebSocket = createRequire(join(SERVER, "package.json"))("ws");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };

function start(cmd, args, opts) {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  p.out = "";
  p.stdout.on("data", (d) => (p.out += d));
  p.stderr.on("data", (d) => (p.out += d));
  procs.push(p);
  return p;
}
// POSIX process groups do not exist on Windows, so killing "-pid" there does nothing and leaves children running.
// taskkill /T ends the process tree on Windows; POSIX keeps the group kill.
function killTree(p) {
  if (!p) return;
  if (process.platform === "win32") { try { spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } return; }
  try { process.kill(-p.pid, "SIGTERM"); } catch { try { p.kill("SIGTERM"); } catch { /* gone */ } }
}
async function waitHttp(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await sleep(300); }
  throw new Error("timeout waiting for " + url);
}

// ------------------------------------------------------------------ WebSocket bot (class coverage without rendering)
class Bot {
  constructor(name, cls) { this.name = name; this.cls = cls; this.ents = new Map(); this.id = 0; this.kills = 0; this.xp = 0; this.seq = 0; this.last = {}; this.skills = []; this.closed = false; this.errs = []; this.inv = null; this.wallet = null; this.daily = null; this.chat = []; }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${SP}`);
    await new Promise((res, rej) => { this.ws.on("open", res); this.ws.on("error", rej); });
    this.ws.on("close", () => (this.closed = true));
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === "welcome") { this.id = m.id; this.skills = m.skills; }
      else if (m.t === "error") this.errs.push(m.msg);
      else if (m.t === "inv") this.inv = m.items;
      else if (m.t === "wallet") this.wallet = m;
      else if (m.t === "daily") this.daily = m;
      else if (m.t === "ev" && m.e.k === "chat") this.chat.push(m.e.text);
      else if (m.t === "snap") { for (const g of m.gone) this.ents.delete(g); for (const e of m.ents) this.ents.set(e.id, e); }
      else if (m.t === "ev" && m.e.k === "xp") this.xp += m.e.amount;
      else if (m.t === "ev" && m.e.k === "death" && m.e.killer === this.id) this.kills++;
    });
    this.ws.send(JSON.stringify({ t: "login", name: this.name, cls: this.cls, v: 3, pw: "testpass1" }));
    const end = Date.now() + 5000;
    while (!this.id && Date.now() < end) await sleep(50);
    return !!this.id;
  }
  send(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  tick() {
    const me = this.ents.get(this.id);
    if (!me || me.hp <= 0) return;
    let best, bd = 1e9;
    for (const e of this.ents.values()) {
      if (e.k !== "mob" || e.hp <= 0 || e.st === "dead" || e.mob === "stone_guardian") continue;
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) { this.send({ t: "input", seq: ++this.seq, dx: -0.5, dz: 1 }); return; }
    const reach = this.cls === "sword" ? 3 : 9;
    if (bd > reach) this.send({ t: "input", seq: ++this.seq, dx: (best.x - me.x) / bd, dz: (best.z - me.z) / bd });
    else {
      this.send({ t: "input", seq: ++this.seq, dx: 0, dz: 0 });
      const now = Date.now();
      for (const sk of this.skills) {
        const data = sk.kind;
        if (now - (this.last[sk.id] ?? 0) < sk.cooldown * 1000 + 100) continue;
        if (sk.id === 4 && me.hp > me.mhp * 0.5) continue;
        if (sk.range > 0 && sk.range < bd) continue;
        this.last[sk.id] = now;
        const msg = { t: "cast", skill: sk.id };
        if (sk.range > 0) { msg.target = best.id; msg.tx = best.x; msg.tz = best.z; }
        this.send(msg);
        if (data !== "heal") break;
      }
    }
  }
  run() { this.timer = setInterval(() => this.tick(), 100); }
  close() { clearInterval(this.timer); try { this.ws.close(); } catch {} }
}

// ------------------------------------------------------------------ page helpers
const state = (p) => p.evaluate(() => { const s = window.__jz?.state; return s ? { ...s, ents: s.ents, perf: s.perf } : null; });
async function openPlayer(browser, name, cls, errors) {
  const ctx = await browser.newContext({ viewport: name === "Beta" ? { width: 480, height: 270 } : { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    const t = m.text();
    // Ignore environment artifacts: the GL driver message, SwiftShader's software-rasterizer shader validation
    // spam, and WebGL context-lifecycle chatter on teardown (the test closes/reloads pages, which makes the
    // software context get lost and then have its objects deleted). None of these are game defects and none
    // appear on a real GPU. Real JS console errors/warnings still fail the check.
    if ((m.type() === "error" || m.type() === "warning") && !/GL Driver Message|THREE\.WebGLProgram: Shader Error|WebGL: INVALID_OPERATION: useProgram|Program Info Log|CONTEXT_LOST_WEBGL|loseContext|INVALID_OPERATION: delete|deleteVertexArray|object does not belong to this context/.test(t)) errors.push(`[${name}] ${m.type()}: ${t}`);
  });
  page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(`http://localhost:${WP}/?server=ws://localhost:${SP}&name=${name}&cls=${cls}&auto=1&debug=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
  return page;
}
/** drive WASD toward (tx,tz) with the default camera (yaw = PI: W=+z, D=-x). */
async function steer(page, tx, tz, stop) {
  const s = await state(page);
  const dx = tx - s.pos.x, dz = tz - s.pos.z, d = Math.hypot(dx, dz);
  const want = { KeyW: dz / d > 0.35, KeyS: dz / d < -0.35, KeyA: dx / d > 0.35, KeyD: dx / d < -0.35 };
  if (d < stop) for (const k of Object.keys(want)) want[k] = false;
  for (const [k, on] of Object.entries(want)) await page.keyboard[on ? "down" : "up"](k);
  return d;
}
async function goTo(page, tx, tz, stop = 2.5, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const d = await steer(page, tx, tz, stop); if (d < stop) return true; await sleep(150); }
  await steer(page, 0, 0, 1e9);
  return false;
}
async function shot(page, name) { await page.screenshot({ path: join(SHOTS, `e2e_${name}.png`), timeout: 120000 }); }

// ------------------------------------------------------------------ main
async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "jz-e2e-"));
  console.log("JIUZHOU e2e (server :" + SP + ", client :" + WP + ")");

  // server: spawn the real .js entry point through this node binary (the node_modules/.bin shims are POSIX shell scripts and fail on Windows)
  const srv = start(process.execPath, [join(SERVER, "node_modules/tsx/dist/cli.mjs"), "src/server.ts"], { cwd: SERVER, env: { ...process.env, PORT: String(SP), DB_PATH: join(tmp, "e2e.db") } });
  await waitHttp(`http://127.0.0.1:${SP}/health`);
  // client: production build into a private dir, served by vite preview
  if (!process.env.E2E_SKIP_BUILD) {
    const b = spawnSync(process.execPath, [join(CLIENT, "node_modules/vite/bin/vite.js"), "build", "--outDir", DIST, "--emptyOutDir"], { cwd: CLIENT, encoding: "utf8" });
    check("client builds", b.status === 0, b.status === 0 ? "" : b.stderr.slice(-300));
    if (b.status !== 0) throw new Error("build failed");
  }
  start(process.execPath, [join(CLIENT, "node_modules/vite/bin/vite.js"), "preview", "--port", String(WP), "--strictPort", "--outDir", DIST], { cwd: CLIENT });
  await waitHttp(`http://localhost:${WP}/`);

  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const errors = [];
  try {
    const A = await openPlayer(browser, "Alpha", "talisman", errors);
    const B = await openPlayer(browser, "Beta", "talisman", errors);
    // mutual visibility
    const seen = async (p, n) => { const end = Date.now() + 120000; while (Date.now() < end) { const s = await state(p); if (s.ents.some((e) => e.k === "player" && e.n.startsWith(n))) return true; await sleep(300); } return false; };
    check("A sees B", await seen(A, "Beta"));
    check("B sees A", await seen(B, "Alpha"));
    await B.close(); // two software-rendered pages stall each other; the rest is verified with A alone + a lightweight observer bot
    const watcher = new Bot("Watcher", "physician");
    await watcher.connect();
    await sleep(1500);
    const a0 = (await state(A)).pos;
    const w0 = [...watcher.ents.values()].find((e) => e.n.startsWith("Alpha"));
    await A.keyboard.down("KeyW"); await sleep(4000); await A.keyboard.up("KeyW");
    await sleep(2500);
    const a1 = (await state(A)).pos;
    check("A moves with WASD", Math.hypot(a1.x - a0.x, a1.z - a0.z) > 1.5, `${a0.z} -> ${a1.z}`);
    const w1 = [...watcher.ents.values()].find((e) => e.n.startsWith("Alpha"));
    check("other client sees A move (server-confirmed)", !!w0 && !!w1 && Math.hypot(w1.x - w0.x, w1.z - w0.z) > 0.8, w1 ? `${w0?.z} -> ${w1.z}` : "missing");
    watcher.close();
    await shot(A, "gate_spawn");

    // camera tour: gate, bridge, pagoda
    await goTo(A, 0, -66, 2);
    await A.keyboard.down("KeyW"); await sleep(400); await A.keyboard.up("KeyW");
    await shot(A, "gate");
    await goTo(A, 0, -34, 2);
    await sleep(1200); await shot(A, "bridge");
    await goTo(A, 0, -66, 2.5);
    await goTo(A, -22, -72, 2.5, 40000);
    await sleep(1200); await shot(A, "pagoda");
    const camOk = (await state(A)).connected;
    check("camera tour completed", camOk);

    // A (sword, real client) hunts alone first so a kill is attributable to the browser client
    const geo = [];
    const sample = async (t) => { const s = await state(A); geo.push({ t, g: s.perf.geometries, tex: s.perf.textures, calls: s.perf.calls, tri: s.perf.triangles, prog: s.perf.programs }); };
    let shotCombat = false, drops = 0;
    const hunt = async (ms, until, onTick) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const s = await state(A);
        if (!s.connected) { // the client auto-reconnects with backoff; give it a minute
          drops++;
          const ok = await A.waitForFunction(() => window.__jz?.state?.connected && window.__jz.state.ready, null, { timeout: 90000 }).then(() => true, () => false);
          if (!ok) { check("A reconnects after a drop", false, "lastError=" + s.lastError + " | server: " + srv.out.split("\n").filter(Boolean).slice(-4).join(" / ")); return false; }
          continue;
        }
        if (until && until(s)) return true;
        if (onTick) await onTick((Date.now() - t0) / 1000, s);
        let best, bd = 1e9;
        for (const m of s.ents) { if (m.k !== "mob" || m.hp <= 0 || m.n.includes("Guardian")) continue; const d = Math.hypot(m.x - s.pos.x, m.z - s.pos.z); if (d < bd) { bd = d; best = m; } }
        if (s.hp <= 0) { await steer(A, 0, 0, 1e9); await sleep(1000); continue; }
        if (best) {
          const d = await steer(A, best.x, best.z, 2.4);
          if (d < 5) {
            await A.keyboard.press("Tab");
            for (const k of ["Digit1", "Digit3", "Digit2"]) await A.keyboard.press(k);
            const me = s.ents.find((x) => x.id === s.myId);
            if (me && me.hp < me.mhp * 0.4) await A.keyboard.press("Digit4");
            if (!shotCombat && s.kills >= 0) { shotCombat = true; await sleep(300); await shot(A, "combat"); }
          }
        } else await steer(A, -35, 5, 3);
        await sleep(200);
      }
      return until ? until(await state(A)) : true;
    };
    await goTo(A, -35, 5, 3, 150000);
    await hunt(240000, (s) => s.kills >= 1);
    await steer(A, 0, 0, 1e9);
    const fin = await state(A);
    console.log(`  INFO  browser client kills=${fin.kills} lv=${fin.level} (software-rendered page lags 10+ s behind the server, so this is informational; kills are verified through the protocol by the class bots below)`);

    // class coverage bots: each class kills a mob (server decides damage/xp); A keeps fighting for the soak
    const bots = ["sword", "talisman", "physician"].map((c) => new Bot("Bot" + c, c));
    for (const b of bots) check(`bot ${b.cls} login`, await b.connect());
    bots.forEach((b) => b.run());
    let sampled = -1;
    await sample(0);
    await hunt(SOAK_S * 1000, null, async (e) => { if (Math.floor(e / 15) !== sampled) { sampled = Math.floor(e / 15); await sample(Math.round(e)); } });
    await steer(A, 0, 0, 1e9);
    await sample(SOAK_S);
    console.log(`  INFO  browser client connection drops (auto-recovered): ${drops}`);
    for (const b of bots) check(`${b.cls} received an inv message`, Array.isArray(b.inv), JSON.stringify(b.inv));
    for (const b of bots) check(`${b.cls} got v3 wallet + a 3-task daily board`, !!b.wallet && Number.isInteger(b.wallet.coin) && !!b.daily && b.daily.tasks.length === 3 && b.daily.resetIn > 0 && b.daily.resetIn <= 86400, JSON.stringify(b.wallet) + " tasks=" + (b.daily?.tasks.map((t) => t.id).join(",") ?? "-"));
    { // an unfinished task can never be claimed (server refuses, grants nothing)
      const b = bots[0];
      const before = JSON.stringify(b.wallet), id = b.daily?.tasks.find((t) => !t.done)?.id;
      if (id) { b.send({ t: "claim", id }); await sleep(1200); }
      check("claim of an unfinished daily is refused and grants nothing", !!id && JSON.stringify(b.wallet) === before && b.chat.some((c) => /not complete yet/i.test(c)), `chat=${b.chat.slice(-2).join(" | ")}`);
    }
    for (const b of bots) check(`${b.cls} kill + xp`, b.kills >= 1 && b.xp > 0, `kills=${b.kills} xp=${b.xp} errs=${b.errs.length}`);
    bots.forEach((b) => b.close());
    console.log("  resources over time (t, geometries, textures, draw calls, triangles):");
    for (const g of geo) console.log(`    t=${String(g.t).padStart(3)}s  geo=${g.g}  tex=${g.tex}  calls=${g.calls}  tris=${g.tri}  programs=${g.prog}`);
    if (geo.length >= 4) {
      const half = geo.slice(Math.floor(geo.length * 0.6)); // lazily created VFX textures settle during warm-up
      const maxG = Math.max(...half.map((x) => x.g)), minG = Math.min(...half.map((x) => x.g));
      const maxT = Math.max(...half.map((x) => x.tex)), minT = Math.min(...half.map((x) => x.tex));
      check("geometry count plateaus (last 40% spread <= 25)", maxG - minG <= 25, `${minG}..${maxG}`);
      // textures: VFX glyph textures are created lazily once per distinct skill glyph (bounded, ~16); per-avatar textures are disposed
      // Absolute cap + a settled-tail growth check. The absolute grew with the 0.4/0.5 content (VFX pools, more
      // mob families, landmarks, four players on screen), so the old flat <110 no longer describes the game; a
      // real per-entity leak would still blow past 260 or keep climbing through the settled tail.
      const texTail = geo.slice(Math.floor(geo.length * 0.6));
      const texMax = Math.max(...geo.map((x) => x.tex)), texMin = Math.min(...geo.map((x) => x.tex));
      const texSpread = Math.max(...texTail.map((x) => x.tex)) - Math.min(...texTail.map((x) => x.tex));
      check("texture count bounded (< 260, no runaway growth)", texMax < 260 && texSpread <= 40, `${texMin}..${texMax} (settled spread ${texSpread})`);
      const cs = geo.map((x) => x.calls).sort((a, b) => a - b);
      check("draw calls < 150 (median of samples)", cs[Math.floor(cs.length / 2)] < 150, `median ${cs[Math.floor(cs.length / 2)]}, peak ${cs[cs.length - 1]} with 4 players + a mob crowd in view`);
    }

    // boss view
    await goTo(A, 0, 55, 3, 90000);
    await sleep(800);
    await goTo(A, 0, 68, 3, 40000);
    await sleep(1000); await shot(A, "boss");
    { // slow software rendering (and respawns during the soak) can stop the walk short; scripts/boss-test.mjs covers the boss bar deterministically
      const q = await state(A);
      if (Math.hypot(q.pos.x, q.pos.z - 85) <= 38) check("boss health bar shows near the Stone Guardian", q.bossBar === true, `pos ${q.pos.x},${q.pos.z}`);
      else console.log(`  INFO  boss bar not checked: walk ended at ${q.pos.x},${q.pos.z} (more than 38 from the shrine)`);
    }
    await goTo(A, -9, 78, 3, 30000);
    await sleep(800); await shot(A, "shrine");

    check("zero console errors/warnings", errors.length === 0, errors.slice(0, 3).join(" | "));
    check("server log has no errors", !/error|exception|unhandled/i.test(srv.out), "");
  } finally {
    await browser.close();
    if (errors.length) console.log("  console:\n    " + errors.slice(0, 10).join("\n    "));
  }
  // Windows: the game server still holds the SQLite file when the try-block ends, so a bare rmSync fails
  // with EPERM. Kill the child trees first, then retry the removal so the run reports its real result.
  for (const p of procs) killTree(p);
  let removed = false;
  for (let i = 0; i < 12 && !removed; i++) { try { rmSync(tmp, { recursive: true, force: true }); removed = true; } catch { await sleep(250); } }
  if (!removed) console.log(`  INFO  temp dir left behind (busy): ${tmp}`);
}

let code = 0;
try { await main(); } catch (e) { console.log("  FAIL  e2e aborted: " + (e?.stack || e)); results.push(false); }
finally {
  for (const p of procs) killTree(p);
  if (!process.env.E2E_DIST) rmSync(DIST, { recursive: true, force: true }); // remove only the private dir we created
}
const fails = results.filter((x) => !x).length;
console.log(fails ? `FAIL (${fails} of ${results.length} checks failed)` : `PASS (${results.length} checks)`);
process.exit(fails ? 1 : code);
