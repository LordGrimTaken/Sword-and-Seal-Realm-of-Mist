// Real-server boss check: starts the server with TEST_MODE=1 and a Vite dev server, teleports a high-level player next to the
// Stone Guardian and verifies the boss bar, the telegraph warning/danger ring, the bag (real `inv` messages) and screenshots both resolutions.
//   node scripts/boss-test.mjs        (ports from JZ_SERVER_PORT / JZ_CLIENT_PORT, default 8981 / 8982; screenshots -> docs/shots/boss_*.png)
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

let browser, server, pageRef;
try {
  server = run(path.join(ROOT, "server/node_modules/.bin/tsx"), ["src/server.ts"], path.join(ROOT, "server"), { PORT: String(SP), TEST_MODE: "1", DB_PATH: path.join(mkdtempSync(path.join(tmpdir(), "jz-boss-")), "b.db") });
  run(path.join(ROOT, "client/node_modules/.bin/vite"), ["--config", "scripts/vite.uitest.config.mjs", "--port", String(CP), "--strictPort", "--host", "127.0.0.1"], path.join(ROOT, "client"));
  await waitHttp(`http://127.0.0.1:${SP}/health`); await waitHttp(`http://localhost:${CP}/`);
  browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  pageRef = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/GL Driver/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${CP}/?auto=1&debug=1&name=BossTester&cls=sword&server=ws://localhost:${SP}`);
  await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
  const st = () => page.evaluate(() => window.__jz.state);
  const say = (t) => page.evaluate((x) => window.__jz.say(x), t);
  await sleep(1500);
  await say("/testlevel 14"); await sleep(600);
  await say("/testgive Jade_Scale 2"); await sleep(600);
  await say("/testgive Healing_Tonic 3");
  const gotInv = await until(async () => { const q = await st(); return q.inv.some((i) => i.item === "Jade Scale" && i.qty === 2) && q.inv.some((i) => i.item === "Healing Tonic" && i.qty === 3); }, 30000);
  check("real inv messages fill the bag", gotInv, JSON.stringify((await st()).inv));
  await page.keyboard.press("i"); await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, "boss_bag.png"), timeout: 150000 });
  await page.keyboard.press("i");

  await say("/testtp 0 66");
  check("boss bar appears within 40 units of the Stone Guardian", await until(async () => (await st()).bossBar, 60000));
  await say("/testtp 0 76"); // inside the boss's 12-unit aggro radius
  let healed = 0;
  const seenWarn = await until(async () => {
    const q = await st();
    if (q.hp > 0 && q.hp < 200 && healed++ < 50) await say("/testheal");
    return q.dangers > 0;
  }, 120000, 600);
  check("telegraph event registers a danger ring", seenWarn);
  if (seenWarn) {
    await sleep(300);
    check("warning banner names the Stone Guardian", await page.evaluate(() => /Stone Guardian winds up/i.test(document.getElementById("warn").innerText)));
    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      await page.setViewportSize({ width: w, height: h });
      await sleep(900);
      await page.screenshot({ path: path.join(SHOTS, `boss_fight_${w}x${h}.png`), timeout: 150000 });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    check("danger ring resolves", await until(async () => (await st()).dangers === 0, 30000));
  }
  const bad = errors.filter((e) => !/favicon/i.test(e));
  check("zero console errors", bad.length === 0, bad.slice(0, 3).join(" | "));
} catch (e) {
  check("boss test completed", false, String((e && e.stack) || e));
  if (pageRef) console.log("  [page state]", JSON.stringify(await pageRef.evaluate(() => ({ ...window.__jz?.state, ents: undefined })).catch(() => null)));
  if (server) console.log("  [server log tail]", server.log.slice(-500));
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of procs) { try { process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ } }
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `FAIL (${failed} of ${results.length})` : `PASS (${results.length} checks)`);
process.exit(failed ? 1 : 0);
