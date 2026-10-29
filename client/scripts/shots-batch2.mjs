// Screenshots for the 0.4.0 telegraph work: fox cone, bamboo line, Stone Guardian phase-3 beam (docs/shots/batch2_*.png).
//   node scripts/shots-batch2.mjs   (ports JZ_SERVER_PORT / JZ_CLIENT_PORT, default 8981 / 8982)
// The mob telegraphs are fabricated through the debug inject hook with a long wind-up (software GL cannot catch a real 0.4 s window); the beam is the real server event.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const SP = Number(process.env.JZ_SERVER_PORT) || 8981, CP = Number(process.env.JZ_CLIENT_PORT) || 8982;
const SHOTS = path.join(ROOT, "docs/shots");
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const run = (cmd, args, cwd, env = {}) => { const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true }); p.log = ""; p.stdout.on("data", (d) => (p.log += d)); p.stderr.on("data", (d) => (p.log += d)); procs.push(p); return p; };
async function waitHttp(u) { for (let i = 0; i < 100; i++) { try { const r = await fetch(u); if (r.status < 500) return; } catch { /* retry */ } await sleep(300); } throw new Error("timeout " + u); }
async function until(fn, ms, step = 300) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(step); } return false; }

let browser;
try {
  run(path.join(ROOT, "server/node_modules/.bin/tsx"), ["src/server.ts"], path.join(ROOT, "server"), { PORT: String(SP), TEST_MODE: "1", DB_PATH: path.join(mkdtempSync(path.join(tmpdir(), "jz-shots-")), "s.db") });
  run(path.join(ROOT, "client/node_modules/.bin/vite"), ["--config", "scripts/vite.uitest.config.mjs", "--port", String(CP), "--strictPort", "--host", "127.0.0.1"], path.join(ROOT, "client"));
  await waitHttp(`http://127.0.0.1:${SP}/health`); await waitHttp(`http://localhost:${CP}/`);
  browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(`http://localhost:${CP}/?auto=1&debug=1&name=Shots${Date.now() % 1000}&cls=sword&server=ws://localhost:${SP}`);
  await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
  const st = () => page.evaluate(() => window.__jz.state);
  const say = (t) => page.evaluate((x) => window.__jz.say(x), t);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `batch2_${n}.png`), timeout: 150000 });
  const look = (from, to, pitch, dist) => page.evaluate(({ from, to, pitch, dist }) => { const c = window.__jz.state.cam; c.yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z)); c.pitch = pitch; c.dist = dist; }, { from, to, pitch, dist });
  const mobNear = async (name) => { const q = await st(); return q.ents.filter((e) => new RegExp(name.split(" ")[0], "i").test(String(e.n)) && e.hp > 0 && e.k === "mob").sort((a, b) => Math.hypot(a.x - q.pos.x, a.z - q.pos.z) - Math.hypot(b.x - q.pos.x, b.z - q.pos.z))[0]; };
  await sleep(1500);
  await say("/testlevel 20");
  const heal = setInterval(() => say("/testheal").catch(() => {}), 1500);

  // ---- mob telegraphs: fabricated long wind-up aimed at the player from a real mob
  for (const [name, spot, shape, extra, file, pitch, dist] of [
    ["Fox Spirit", { x: 55, z: 5 }, "cone", { arc: 1.45, radius: 3.5 }, "fox_cone", 1.2, 22],
    ["Bamboo Spirit", { x: -40, z: 15 }, "line", { len: 3.6, width: 1.9, radius: 3.6 }, "bamboo_line", 1.2, 20],
  ]) {
    await say(`/testtp ${spot.x} ${spot.z}`); await sleep(4000);
    const m = await mobNear(name);
    if (!m) { console.log("no", name, JSON.stringify((await st()).ents.filter((e) => e.k === "mob").slice(0, 8).map((e) => e.n))); continue; }
    await say(`/testtp ${m.x + 4} ${m.z + 1}`); await sleep(900);
    const m2 = await mobNear(name), me = (await st()).pos;
    const dir = Math.atan2(me.x - m2.x, me.z - m2.z);
    await look(me, m2, pitch, dist);
    await page.evaluate(({ id, x, z, dir, shape, extra }) => window.__jz.inject({ t: "ev", e: { k: "telegraph", src: id, x, z, delay: 14, shape, dir, ...extra } }), { id: m2.id, x: m2.x, z: m2.z, dir, shape, extra });
    await sleep(2500);
    console.log(file, (await st()).dangerShapes);
    await shot(file);
    await sleep(14000);
  }

  // ---- boss phase 3: real server beam
  await say("/testtp 0 62"); await sleep(1500);
  await say("/testtp 0 74");
  await until(async () => (await st()).dangers > 0, 40000);
  const boss = (await st()).ents.find((e) => e.n === "Stone Guardian");
  await look({ x: 0, z: 74 }, boss ?? { x: 0, z: 85 }, 1.05, 26);
  const seen = await until(async () => { await say("/testbosshp 0.2"); return (await st()).dangerShapes.includes("beam"); }, 180000, 700);
  console.log("beam seen", seen);
  await sleep(1400);
  if (!seen) throw new Error("no beam seen; not overwriting screenshots");
  await shot("boss_phase3_beam");
  await sleep(900);
  await shot("boss_phase3_beam_b");
  clearInterval(heal);
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of procs) { try { process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ } }
}
