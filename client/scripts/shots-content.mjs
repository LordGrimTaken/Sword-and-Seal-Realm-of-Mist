// Screenshots for the 0.4.0 content batch -> docs/shots/batch3_content_*.png
// Run: flock /tmp/browser.lock node client/scripts/shots-content.mjs   (own server JZ_SERVER_PORT 8993 + vite JZ_CLIENT_PORT 8994, temp DB)
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
const SP = Number(process.env.JZ_SERVER_PORT) || 8993, CP = Number(process.env.JZ_CLIENT_PORT) || 8994;
const DB = path.join(mkdtempSync(path.join(tmpdir(), "jz-cx-")), "t.db");
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`http://localhost:${CP}/?auto=1&debug=1&name=ShotCx&cls=sword&server=ws://localhost:${SP}`);
  await page.waitForFunction(() => window.__jz && window.__jz.state.ready, null, { timeout: 120000 });
  const st = () => page.evaluate(() => window.__jz.state);
  const say = async (t) => { await page.evaluate((x) => window.__jz.say(x), t); await sleep(500); };
  const shot = (n, clip) => page.screenshot({ path: path.join(SHOTS, `batch3_content_${n}.png`), timeout: 150000, ...(clip ? { clip } : {}) });
  const key = async (k) => { await page.keyboard.press(k); await sleep(700); };
  const click = async (sel) => { await page.waitForSelector(sel, { timeout: 30000 }); await page.evaluate((q) => document.querySelector(q).click(), sel); await sleep(1200); };
  const cam = (dist, pitch) => page.evaluate(([d, p]) => { const c = window.__jz.state.cam; if (c) { c.dist = d; c.pitch = p; } }, [dist, pitch]);
  const tp = async (x, z) => { await say(`/testtp ${x} ${z}`); await page.waitForFunction(([a, b]) => Math.hypot(window.__jz.state.pos.x - a, window.__jz.state.pos.z - b) < 3, [x, z], { timeout: 90000 }); await sleep(2500); };
  await sleep(2500);
  await say("/testlevel 6");
  await say("/testwallet 400 6");
  for (const [i, q] of [["Bamboo_Fiber", 14], ["Fox_Tail", 6], ["Hound_Fang", 10], ["Jade_Scale", 8], ["Toad_Jelly", 4], ["Healing_Tonic", 2]]) await say(`/testgive ${i} ${q}`);
  await sleep(1000);

  // ---- Wu: story dialog + accept
  await tp(-9, -85.5);
  await cam(8, 0.35);
  await key("KeyF"); await sleep(1500);
  await shot("quest_dialog_wu");
  await click('#npcp [data-a="accept"]');
  await shot("quest_accepted_wu");
  await key("Escape");

  // ---- Tao: crafting
  await tp(-6.5, -77);
  await key("KeyF"); await sleep(1500);
  await shot("npc_tao_crafting");
  await click('#npcp [data-a="tab"][data-t="tasks"]');
  await shot("npc_tao_tasks");
  await click('#npcp [data-a="tab"][data-t="craft"]');
  await click('#npcp [data-a="craft"][data-id="bamboo_hat"]');
  await click('#npcp [data-a="craft"][data-id="bamboo_robe"]');
  await click('#npcp [data-a="craft"][data-id="fox_boots"]');
  await shot("crafted_gear");
  await key("Escape");

  // ---- Hao: shop
  await tp(12.5, -76);
  await key("KeyF"); await sleep(1500);
  await shot("npc_hao_tasks");
  await click('#npcp [data-a="tab"][data-t="buy"]');
  await shot("npc_hao_shop");
  await click('#npcp [data-a="tab"][data-t="sell"]');
  await shot("npc_hao_sell");
  await key("Escape");

  // ---- Gear panel
  await say("/testgive Hound-Fang_Charm 1");
  await key("KeyG"); await sleep(600);
  for (let i = 0; i < 5; i++) { const ok = await page.evaluate(() => { const b = document.querySelector('#gearp [data-a="equip"]:not([disabled])'); if (b) b.click(); return !!b; }); if (!ok) break; await sleep(1200); }
  await shot("gear_panel");
  await key("KeyG");

  // ---- Journal
  await key("KeyJ");
  await shot("journal_quests");
  await click('#journal [data-a="tab"][data-t="merit"]');
  await shot("journal_merit_seals");
  await click('#journal [data-a="tab"][data-t="titles"]');
  await shot("journal_titles");
  await click('#journal [data-a="tab"][data-t="atlas"]');
  await shot("journal_atlas_start");
  await key("Escape");

  // ---- New mobs
  await say("/testlevel 20");
  const findMob = async (re) => page.evaluate((src) => { const r = new RegExp(src, "i"); const e = (window.__jz.state.ents || []).find((x) => r.test(x.name || x.n || "")); return e ? { x: e.x, z: e.z } : null; }, re.source);
  const spots = { toad: [8, -30], hound: [-20, 50], whisker: [58, 22] };
  const toad = await findMob(/toad/);
  if (toad) spots.toad = [toad.x, toad.z];
  for (const [name, [x, z]] of Object.entries(spots)) {
    await tp(x - 7, z - 7);
    await cam(9, 0.4);
    await sleep(1200);
    await shot(`mob_${name}`);
  }
  console.log("mob probe", JSON.stringify(await findMob(/toad/)));

  // ---- Points of interest: marker + discovery toast
  await page.evaluate(() => { window.__jzToastMs = 60000; });
  await cam(12, 0.4);
  await tp(36, -58);
  await page.waitForSelector(".cxtoast", { timeout: 30000 });
  await shot("poi_waystone_toast");
  await page.evaluate(() => { document.querySelectorAll(".cxtoast").forEach((e) => e.remove()); });
  await say("/testtp 36 -66"); await sleep(5000);
  await shot("poi_waystone_marker");
  await key("KeyJ"); await click('#journal [data-a="tab"][data-t="atlas"]');
  await shot("journal_atlas_discovered");
  console.log("state", JSON.stringify((await st()).content));
  console.log("done");
} catch (e) { console.error(e); process.exitCode = 1; } finally { try { await browser?.close(); } catch { /* ignore */ } await killAll(); }
