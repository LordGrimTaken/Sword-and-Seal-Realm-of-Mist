// Screenshots for the 0.4.0 Audio and UI/UX batch -> docs/shots/batch3_ui_*.png
// Run: flock /tmp/browser.lock node client/scripts/batch3-shots.mjs   (own server JZ_SERVER_PORT 8995 + vite JZ_CLIENT_PORT 8996, temp DB)
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
const SP = Number(process.env.JZ_SERVER_PORT) || 8995, CP = Number(process.env.JZ_CLIENT_PORT) || 8996;
const TAG = process.env.SHOT_TAG || "";
const DB = path.join(mkdtempSync(path.join(tmpdir(), "jz-b3-")), "t.db");
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
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await page.goto(`http://localhost:${CP}/?auto=1&debug=1&name=ShotSage&cls=sword&server=ws://localhost:${SP}`);
  await page.waitForFunction(() => window.__jz && window.__jz.state.ready, null, { timeout: 120000 });
  const jclick = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const jcheck = (sel, on = true) => page.evaluate(([s, o]) => { const e = document.querySelector(s); if (e.checked !== o) e.click(); }, [sel, on]);
  const jsel = (sel, val) => page.evaluate(([s, v]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, val]);
  const jhover = (sel) => page.evaluate((s) => document.querySelector(s).dispatchEvent(new PointerEvent("pointerover", { bubbles: true })), sel);
  const say = (t) => page.evaluate((x) => window.__jz.say(x), t);
  const shot = (n, clip) => page.screenshot({ path: path.join(SHOTS, `batch3_ui_${n}${TAG}.png`), timeout: 150000, ...(clip ? { clip } : {}) });
  await sleep(2500);
  await say("/testlevel 20"); await sleep(300);
  // a lived-in bag and chat
  for (const [it, n] of [["Healing_Tonic", 2], ["Fox_Tail", 3], ["Jade_Scale", 4], ["Bamboo_Fiber", 9], ["Cloudmist_Pendant", 1], ["Serpent_Gall", 1], ["Paper_Lantern", 1]]) { await say(`/testgive ${it} ${n}`); await sleep(120); }
  await page.evaluate(() => {
    const j = window.__jz;
    j.inject({ t: "ev", e: { k: "chat", from: "Mei", text: "The lanterns are lit, traveller.", sys: false } });
    j.inject({ t: "ev", e: { k: "chat", from: "Wanderer", text: "Anyone fighting the guardian tonight?", sys: false } });
    j.inject({ t: "ev", e: { k: "chat", from: "System", text: "Quest updated: Bamboo for the Elder.", sys: true } });
  });
  // explore: walk the valley so the map has fog to lift
  for (const [x, z] of [[0, -80], [0, -34], [-40, 10], [55, 30], [0, 60], [0, -76]]) { await say("/testheal"); await say(`/testtp ${x} ${z}`); await sleep(1100); }
  await say("/testheal");
  await sleep(1500);
  await shot("hud_overview");
  await jclick('#chattabs [data-ct="sys"]'); await sleep(200);
  await shot("chat_tabs_system", { x: 0, y: 420, width: 460, height: 300 });
  await jclick('#chattabs [data-ct="chat"]'); await sleep(200);
  await shot("chat_tabs_chat", { x: 0, y: 420, width: 460, height: 300 });
  await jclick('#chattabs [data-ct="all"]'); await sleep(100);
  // bag
  await page.keyboard.press("i"); await sleep(500);
  await jhover('#bag .bi[data-item="Cloudmist Pendant"]'); await sleep(300);
  await shot("bag_tooltip");
  await page.mouse.move(5, 5);
  await page.fill("#bag .bsearch", "j"); await sleep(200);
  await jclick('#bag [data-sort="name"]'); await sleep(200);
  await shot("bag_search_sort");
  await page.fill("#bag .bsearch", ""); await page.keyboard.press("Escape"); await page.keyboard.press("i"); await sleep(300);
  // map
  await page.keyboard.press("n"); await sleep(700);
  await shot("world_map");
  await page.keyboard.press("n"); await sleep(300);
  // settings tabs
  await page.keyboard.press("F1"); await sleep(500);
  await shot("settings_controls");
  for (const t of ["sound", "display", "access"]) { await jclick(`#help [data-tab="${t}"]`); await sleep(300); await shot(`settings_${t}`); }
  // text size 150%
  await jclick('#help [data-tab="display"]'); await jclick('#help [data-ts="1.5"]'); await sleep(400);
  await shot("settings_text150");
  await jclick('#help [data-ts="1"]');
  await page.keyboard.press("Escape"); await sleep(300);
  // accessibility looks on the live HUD
  const apply = async (patch) => { await page.evaluate((p) => { const cur = JSON.parse(localStorage.getItem("jz.settings.v1") || "{}"); localStorage.setItem("jz.settings.v1", JSON.stringify({ ...cur, ...p })); }, patch); };
  await page.keyboard.press("F1"); await sleep(300); await jclick('#help [data-tab="access"]');
  await jsel("#s-cb", "deutan"); await jcheck("#s-contrast"); await sleep(300);
  await page.keyboard.press("Escape"); await sleep(300);
  await page.evaluate(() => { const me = window.__jz.state.myId; window.__jz.inject({ t: "ev", e: { k: "heal", src: me, dst: me, amount: 12, skill: 2 } }); });
  await shot("hud_colourblind_contrast");
  await shot("hud_colourblind_closeup", { x: 0, y: 0, width: 700, height: 260 });
  await page.keyboard.press("F1"); await sleep(300); await jclick('#help [data-tab="access"]'); await jclick("#s-reset"); await page.keyboard.press("Escape");
  void apply;
  // action bar: pressed slot
  await page.keyboard.down("Digit1"); await sleep(150);
  await shot("hotbar_pressed", { x: 330, y: 560, width: 620, height: 160 });
  await page.keyboard.up("Digit1");
  await page.evaluate(() => document.querySelectorAll("#hotbar .slot")[2].dispatchEvent(new PointerEvent("pointerenter"))); await sleep(250);
  await shot("skill_tooltip", { x: 300, y: 380, width: 700, height: 340 });
  console.log("done");
} catch (e) { console.error(e); process.exitCode = 1; } finally { try { await browser?.close(); } catch { /* ignore */ } await killAll(); }
