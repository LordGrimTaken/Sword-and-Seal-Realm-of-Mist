// Real-server boss check: starts the server with TEST_MODE=1 and a Vite dev server, teleports a high-level player next to the
// Stone Guardian and verifies the boss bar, the telegraph warning/danger ring, the bag (real `inv` messages) and screenshots both resolutions.
//   node scripts/boss-test.mjs        (ports from JZ_SERVER_PORT / JZ_CLIENT_PORT, default 8981 / 8982; screenshots -> docs/shots/boss_*.png)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright"); // local devDependency: portable (the CI image's /opt/npm-tools path does not exist on Windows)
const ROOT = path.resolve(import.meta.dirname, "../..");
const SP = Number(process.env.JZ_SERVER_PORT) || 8981, CP = Number(process.env.JZ_CLIENT_PORT) || 8982;
const SHOTS = path.join(ROOT, "docs/shots");
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const results = [];
const check = (name, ok, extra = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
const run = (cmd, args, cwd, env = {}) => {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.log = "";
  p.stdout.on("data", (d) => (p.log += d)); p.stderr.on("data", (d) => (p.log += d));
  procs.push(p);
  return p;
};
async function waitHttp(u) { for (let i = 0; i < 100; i++) { try { const r = await fetch(u); if (r.status < 500) return; } catch { /* retry */ } await sleep(300); } throw new Error("timeout " + u); }
async function until(fn, ms, step = 400) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(step); } return false; }

// POSIX process groups do not exist on Windows, so killing "-pid" there does nothing and leaves the server/vite running
// (the next suite then fails with EADDRINUSE). taskkill /T ends the process tree on Windows; POSIX keeps the group kill.
function killTree(p) {
  if (!p) return;
  if (process.platform === "win32") { try { spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } return; }
  try { process.kill(-p.pid, "SIGKILL"); } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } }
}

let browser, server, pageRef;
try {
  // spawn the real .js entry points through this node binary: the node_modules/.bin shims are POSIX shell scripts and fail on Windows
  server = run(process.execPath, [path.join(ROOT, "server/node_modules/tsx/dist/cli.mjs"), "src/server.ts"], path.join(ROOT, "server"), { PORT: String(SP), TEST_MODE: "1", DB_PATH: path.join(mkdtempSync(path.join(tmpdir(), "jz-boss-")), "b.db") });
  run(process.execPath, [path.join(ROOT, "client/node_modules/vite/bin/vite.js"), "--config", "scripts/vite.uitest.config.mjs", "--port", String(CP), "--strictPort", "--host", "127.0.0.1"], path.join(ROOT, "client"));
  await waitHttp(`http://127.0.0.1:${SP}/health`); await waitHttp(`http://localhost:${CP}/`);
  browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  pageRef = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Ignore environment artifacts only: the GL driver message, SwiftShader's software-rasterizer shader
  // validation spam, and WebGL context-lifecycle chatter on teardown. None are game defects and none appear on a
  // real GPU; real console errors still fail (same filter set as e2e.mjs).
  const ENV_NOISE = /GL Driver|THREE\.WebGLProgram: Shader Error|WebGL: INVALID_OPERATION: useProgram|Program Info Log|CONTEXT_LOST_WEBGL|loseContext|INVALID_OPERATION: delete|deleteVertexArray|object does not belong to this context/;
  page.on("console", (m) => { if (m.type() === "error" && !ENV_NOISE.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${CP}/?auto=1&debug=1&name=BossTester&cls=sword&server=ws://localhost:${SP}`);
  await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
  const st = () => page.evaluate(() => window.__jz.state);
  // The server's chat bucket refills one message per 1.5 s (burst 4): spaced sends, otherwise /testtp and /testheal are silently dropped and the player dies or never reaches the boss
  let lastSay = 0;
  const say = async (t) => { const wait = lastSay + 1600 - Date.now(); if (wait > 0) await sleep(wait); lastSay = Date.now(); return page.evaluate((x) => window.__jz.say(x), t); };
  await sleep(1500);
  await say("/testlevel 14"); await sleep(600);
  await say("/testgive Jade_Scale 2"); await sleep(600);
  await say("/testgive Healing_Tonic 3");
  const gotInv = await until(async () => { const q = await st(); return q.inv.some((i) => i.item === "Jade Scale" && i.qty === 2) && q.inv.some((i) => i.item === "Healing Tonic" && i.qty === 3); }, 30000);
  check("real inv messages fill the bag", gotInv, JSON.stringify((await st()).inv));
  await page.keyboard.press("i"); await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, "boss_bag.png"), timeout: 150000 });
  await page.keyboard.press("i");

  // in-page watcher: a banner or beam that lives ~2-4 s can come and go between two polls of a slow (software GL) test harness
  await page.evaluate(() => { window.__seen = { guardianWarn: false, beam: false, warns: [] }; setInterval(() => { const w = document.getElementById("warn"); if (w && w.innerText && !window.__seen.warns.includes(w.innerText.replace(/\s+/g, " ")) && window.__seen.warns.length < 12) window.__seen.warns.push(w.innerText.replace(/\s+/g, " ")); if (w && /Stone Guardian winds up/i.test(w.innerText)) window.__seen.guardianWarn = true; if (w && /Rune beam/i.test(w.innerText)) window.__seen.runeWarn = true; { const bb = document.getElementById("bossbar"); if (bb && /Cracked open/.test(bb.innerText) && bb.classList.contains("phase3")) window.__seen.cracked = true; } if ((window.__jz.state.dangerShapes ?? []).includes("beam")) window.__seen.beam = true; }, 40); });
  await say("/testtp 0 66");
  check("boss bar appears within 40 units of the Stone Guardian", await until(async () => (await st()).bossBar, 60000));
  await say("/testtp 0 76"); // inside the boss's 12-unit aggro radius
  // keep the player alive and next to the Guardian (a stray mob can kill a lv14 or the respawn sends them back to the plaza)
  const hold = async () => { const q = await st(); if (q.hp > 0 && q.hp < 250) await say("/testheal"); if (q.hp > 0 && Math.hypot(q.pos.x, q.pos.z - 76) > 14) await say("/testtp 0 76"); return q; };
  const seenWarn = await until(async () => { const q = await hold(); return q.dangers > 0; }, 120000, 600);
  check("telegraph event registers a danger ring", seenWarn);
  if (seenWarn) {
    await sleep(300);
    check("warning banner names the Stone Guardian", await until(async () => { await hold(); return page.evaluate(() => window.__seen.guardianWarn); }, 90000, 500), JSON.stringify(await page.evaluate(() => window.__seen.warns)));
    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(900);
      await page.screenshot({ path: path.join(SHOTS, `boss_fight_${w}x${h}.png`), timeout: 150000 });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    check("danger ring resolves", await until(async () => (await st()).dangers === 0, 30000));
  }
  // 0.4.0 phase 3: at 25% HP the Guardian cracks open and channels a rotating rune beam
  await say("/testbosshp 0.2");
  // re-send the HP hook every round and keep the player at the boss: if the player died and respawned, the Guardian leashed back to full HP and phase 3 would never come
  await until(async () => { const q = await st(); await say("/testbosshp 0.2"); if (q.hp > 0 && q.hp < 250) await say("/testheal"); if (Math.hypot(q.pos.x, q.pos.z - 76) > 14) await say("/testtp 0 76"); const sn = await page.evaluate(() => window.__seen); return sn.beam && sn.cracked; }, 120000, 300); // keep going until both the beam and the "Cracked open" bar were seen
  const sawBeam = await page.evaluate(() => window.__seen.beam);
  { const q = await st(); const b = q.ents.find((e) => e.n === "Stone Guardian"); check("phase 3: a beam telegraph registers (cracked open)", sawBeam, sawBeam ? "" : JSON.stringify({ me: q.pos, hp: q.hp, boss: b && { hp: b.hp, x: b.x, z: b.z }, dangers: q.dangerShapes, warns: await page.evaluate(() => window.__seen.warns) })); }
  if (sawBeam) {
    check("phase 3: 'Rune beam!' warning banner", await page.evaluate(() => !!window.__seen.runeWarn));
    // sampled in-page while the beam is on screen (the Guardian may regenerate above 25% again afterwards)
    check("phase 3: boss bar shows 'Cracked open'", await until(() => page.evaluate(() => window.__seen.cracked), 20000, 300), await page.evaluate(() => document.getElementById("bossbar").innerText.replace(/\s+/g, " ") + " | " + document.getElementById("bossbar").className));
    await sleep(1800);
    await page.screenshot({ path: path.join(SHOTS, "boss_phase3_beam.png"), timeout: 150000 });
    check("beam telegraph resolves", await until(async () => !(await st()).dangerShapes.includes("beam"), 30000));
  }
  const bad = errors.filter((e) => !/favicon/i.test(e));
  check("zero console errors", bad.length === 0, bad.slice(0, 3).join(" | "));
} catch (e) {
  check("boss test completed", false, String((e && e.stack) || e));
  if (pageRef) console.log("  [page state]", JSON.stringify(await pageRef.evaluate(() => ({ ...window.__jz?.state, ents: undefined })).catch(() => null)));
  if (server) console.log("  [server log tail]", server.log.slice(-500));
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of procs) killTree(p);
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `FAIL (${failed} of ${results.length})` : `PASS (${results.length} checks)`);
process.exit(failed ? 1 : 0);
