// Screenshots for the 0.4.0 Qi bar + dodge roll -> docs/shots/batch2_*.png
// Run: node client/scripts/batch2-shots.mjs   (own server JZ_SERVER_PORT 8991 + vite JZ_CLIENT_PORT 8992, temp DB)
// The mid-roll shots use debug=1&rollslow=24 which stretches only the cosmetic flip/streak (the real roll lasts 0.25 s), so a slow software-GL screenshot can catch it.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SHOTS = path.join(ROOT, "docs/shots");
mkdirSync(SHOTS, { recursive: true });
const SP = Number(process.env.JZ_SERVER_PORT) || 8991, CP = Number(process.env.JZ_CLIENT_PORT) || 8992;
const DB = path.join(mkdtempSync(path.join(tmpdir(), "jz-b2-")), "t.db");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const run = (cmd, args, cwd, env = {}) => { const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true }); p.stdout.on("data", () => {}); p.stderr.on("data", () => {}); procs.push(p); return p; };
const waitHttp = async (url) => { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* retry */ } await sleep(300); } throw new Error("timeout " + url); };
const killAll = async () => { for (const p of procs) { try { process.kill(-p.pid, "SIGTERM"); } catch { /* gone */ } } await sleep(600); for (const p of procs) { try { process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ } } };

run(path.join(ROOT, "server/node_modules/.bin/tsx"), ["src/server.ts"], path.join(ROOT, "server"), { PORT: String(SP), DB_PATH: DB, TEST_MODE: "1" });
run(path.join(ROOT, "client/node_modules/.bin/vite"), ["--config", "scripts/vite.uitest.config.mjs", "--port", String(CP), "--strictPort", "--host", "127.0.0.1"], path.join(ROOT, "client"));
let browser;
try {
  await waitHttp(`http://localhost:${SP}/health`);
  await waitHttp(`http://localhost:${CP}/`);
  browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  for (const cls of ["sword", "talisman"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${CP}/?auto=1&debug=1&rollslow=24&name=Shot${cls}&cls=${cls}&server=ws://localhost:${SP}`);
    await page.waitForFunction(() => window.__jz && window.__jz.state.ready, null, { timeout: 120000 });
    const st = () => page.evaluate(() => window.__jz.state);
    const say = (t) => page.evaluate((x) => window.__jz.say(x), t);
    const shot = (n, clip) => page.screenshot({ path: path.join(SHOTS, `batch2_${n}.png`), timeout: 150000, ...(clip ? { clip } : {}) });
    await sleep(2500);
    if (cls === "sword") {
      await shot("qi_bar_full");
      const hold = setInterval(() => { say("/testqi 17").catch(() => {}); }, 2000); // the hook holds a low value for 6 s; re-send while the (slow) screenshots are taken
      await say("/testqi 17");
      for (let i = 0; i < 120 && (await st()).qi.qi > 20; i++) await sleep(250);
      await shot("qi_bar_low");
      await shot("qi_bar_low_closeup", { x: 0, y: 0, width: 420, height: 130 });
      await shot("hotbar_qi_costs", { x: 300, y: 560, width: 680, height: 160 });
      clearInterval(hold);
      await say("/testqi 100");
      for (let i = 0; i < 120 && (await st()).qi.qi < 99; i++) await sleep(250);
    }
    // frame the player a bit closer for the roll shots
    await page.evaluate(() => { const c = window.__jz.state.cam; if (c) { c.dist = 9; c.pitch = 0.5; } });
    await sleep(1200);
    await page.keyboard.down("KeyD"); await sleep(400);
    await page.keyboard.press("Space");
    await page.keyboard.up("KeyD");
    await sleep(2600); // ~40% through the stretched (6 s) flip: the avatar is mid-somersault and the streak is at full strength
    const rolling = (await st()).dodge.rolling;
    await shot(`dodge_roll_${cls}`);
    console.log(cls, "rolling at capture:", rolling, JSON.stringify((await st()).dodge));
    await sleep(5000);
    if (cls === "sword") {
      await page.evaluate(() => window.__jz.inject({ t: "ev", e: { k: "dodged", id: window.__jz.state.myId } }));
      await shot("dodged_feedback");
      await sleep(6000);
      await shot("hud_after_dodge_cooldown");
    }
    await ctx.close();
  }
  console.log("done");
} catch (e) { console.error(e); process.exitCode = 1; } finally { try { await browser?.close(); } catch { /* ignore */ } await killAll(); }
