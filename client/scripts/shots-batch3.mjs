// Visual-art screenshots for 0.4.0 world/VFX polish: docs/shots/batch3_<tag>_<spot>.png
//   node scripts/shots-batch3.mjs <tag> [spots,comma,separated]   (ports JZ_SERVER_PORT / JZ_CLIENT_PORT, default 8991 / 8992)
// Run under the shared browser lock: flock /tmp/browser.lock node scripts/shots-batch3.mjs before
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const SP = Number(process.env.JZ_SERVER_PORT) || 8991, CP = Number(process.env.JZ_CLIENT_PORT) || 8992;
const TAG = process.argv[2] || "after";
const TODS = (process.env.JZ_TODS || "").split(",").filter(Boolean); // extra times of day to capture (0.3 dawn, 0.74 dusk, 0 night), tag gets a suffix
const CLS = process.env.JZ_CLS || "sword";
const ONLY = (process.argv[3] || "").split(",").filter(Boolean);
const SHOTS = path.join(ROOT, "docs/shots");
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const run = (cmd, args, cwd, env = {}) => { const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true }); p.log = ""; p.stdout.on("data", (d) => (p.log += d)); p.stderr.on("data", (d) => (p.log += d)); procs.push(p); return p; };
async function waitHttp(u) { for (let i = 0; i < 100; i++) { try { const r = await fetch(u); if (r.status < 500) return; } catch { /* retry */ } await sleep(300); } throw new Error("timeout " + u); }

// [name, stand-at, look-at, pitch, dist]
const SPOTS = [
  ["plaza", [0, -74], [0, -100], 0.36, 10],
  ["pond", [-4, -16], [0, -40], 0.3, 11],
  ["bamboo", [-30, -10], [-30, -30], 0.5, 10],
  ["fox", [55, 22], [55, 36], 0.34, 11],
  ["shrine", [0, 70], [0, 85], 0.3, 14],
  ["pondtop", [-4, -16], [0, -34], 0.85, 13],
];

let browser;
try {
  run(path.join(ROOT, "server/node_modules/.bin/tsx"), ["src/server.ts"], path.join(ROOT, "server"), { PORT: String(SP), TEST_MODE: "1", DB_PATH: path.join(mkdtempSync(path.join(tmpdir(), "jz-shots3-")), "s.db") });
  run(path.join(ROOT, "client/node_modules/.bin/vite"), ["--config", "scripts/vite.uitest.config.mjs", "--port", String(CP), "--strictPort", "--host", "127.0.0.1"], path.join(ROOT, "client"));
  await waitHttp(`http://127.0.0.1:${SP}/health`); await waitHttp(`http://localhost:${CP}/`);
  browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(`http://localhost:${CP}/?auto=1&debug=1&name=Art${Date.now() % 1000}&cls=${CLS}&server=ws://localhost:${SP}${process.env.JZ_TOD ? `&tod=${process.env.JZ_TOD}` : ""}`);
  await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
  const st = () => page.evaluate(() => window.__jz.state);
  const say = (t) => page.evaluate((x) => window.__jz.say(x), t);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `batch3_${TAG}_${n}.png`), timeout: 150000 });
  const look = (from, to, pitch, dist) => page.evaluate(({ from, to, pitch, dist }) => { const c = window.__jz.state.cam; c.yaw = Math.atan2(-(to[0] - from[0]), -(to[1] - from[1])); c.pitch = pitch; c.dist = dist; }, { from, to, pitch, dist });
  const goTo = async (x, z) => { for (let tries = 0; tries < 8; tries++) { await say(`/testtp ${x} ${z}`); await sleep(2600); const q = await st(); if (Math.hypot(q.pos.x - x, q.pos.z - z) < 3) return true; await sleep(1500); } console.log("tp failed", x, z); return false; };
  await sleep(1500);
  await say("/testlevel 20"); await sleep(1500);
  const todSet = (t) => page.evaluate((x) => window.__jz.scene.userData.setTimeOfDay(x), t);
  for (const tod of (TODS.length ? TODS : [null])) {
  if (tod !== null) { await todSet(Number(tod)); await sleep(1500); }
  const sfx = tod === null ? "" : `_t${tod}`;
  for (const [name, at, to, pitch, dist] of SPOTS) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    if (name === "shrine") await goTo(0, 62);
    await goTo(at[0], at[1]);
    await say("/testkill 14"); await sleep(1500); await say("/testheal"); await sleep(600); // clear the nearest mobs so the scenery shots are clean
    await look(at, to, pitch, dist); await sleep(2200);
    await shot(name + sfx);
    console.log("shot", name + sfx, JSON.stringify((await st()).pos));
  }
  }
  if (!ONLY.length || ONLY.includes("combat")) {
    await goTo(55, 22); await say("/testheal"); await sleep(1000);
    const q = await st();
    const mob = q.ents.filter((e) => e.n === "Fox Spirit" && e.hp > 0).sort((a, b) => Math.hypot(a.x - q.pos.x, a.z - q.pos.z) - Math.hypot(b.x - q.pos.x, b.z - q.pos.z))[0];
    if (mob) {
      await goTo(Math.round((mob.x - 4) * 100) / 100, Math.round((mob.z - 4) * 100) / 100);
      const me = (await st()).pos;
      await look([me.x, me.z], [mob.x, mob.z], 0.55, 11);
      await page.keyboard.press("Tab"); await sleep(400);
      for (const k of ["1", "2", "3"]) { await page.keyboard.press(k); await sleep(250); }
      await shot("combat" + (TODS.length ? `_t${TODS[TODS.length - 1]}` : "") + (CLS === "sword" ? "" : "_" + CLS));
      await sleep(700); await page.keyboard.press("2"); await sleep(120); await shot("combat2" + (TODS.length ? `_t${TODS[TODS.length - 1]}` : "") + (CLS === "sword" ? "" : "_" + CLS));
    } else console.log("no fox found");
  }
  const fps = (await st()).fps, perf = (await st()).perf;
  console.log("fps", fps, "perf", JSON.stringify(perf), "errors", errs.slice(0, 5));
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of procs) { try { process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ } }
}
