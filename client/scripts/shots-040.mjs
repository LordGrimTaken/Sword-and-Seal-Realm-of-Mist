// Release screenshots for 0.4.0 -> docs/shots/0.4.0_*.png
// Run: node client/scripts/shots-040.mjs [name ...]   (own server JZ_SERVER_PORT 8995 + vite JZ_CLIENT_PORT 8996, temp DB, TEST_MODE)
// Teleports are verified (retry until the player really stands there) and a shot is skipped with a message if the spot was not reached.
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
const ONLY = process.argv.slice(2);
const want = (n) => !ONLY.length || ONLY.includes(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
const run = (cmd, args, cwd, env = {}) => { const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true }); p.stdout.on("data", () => {}); p.stderr.on("data", () => {}); procs.push(p); return p; };
async function waitHttp(u) { for (let i = 0; i < 100; i++) { try { const r = await fetch(u); if (r.status < 500) return; } catch { /* retry */ } await sleep(300); } throw new Error("timeout " + u); }

let browser;
try {
  run(path.join(ROOT, "server/node_modules/.bin/tsx"), ["src/server.ts"], path.join(ROOT, "server"), { PORT: String(SP), TEST_MODE: "1", DB_PATH: path.join(mkdtempSync(path.join(tmpdir(), "jz-shots040-")), "s.db") });
  run(path.join(ROOT, "client/node_modules/.bin/vite"), ["--config", "scripts/vite.uitest.config.mjs", "--port", String(CP), "--strictPort", "--host", "127.0.0.1"], path.join(ROOT, "client"));
  await waitHttp(`http://127.0.0.1:${SP}/health`); await waitHttp(`http://localhost:${CP}/`);
  browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`http://localhost:${CP}/?auto=1&debug=1&name=Rel${Date.now() % 1000}&cls=talisman&server=ws://localhost:${SP}`);
  await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
  const st = () => page.evaluate(() => window.__jz.state);
  // Chat commands share the server's chat token bucket (4 burst, 1 per 1.5 s): everything (including the heal timer) goes through one queue spaced 1.7 s apart, otherwise /testtp is silently dropped
  let chain = Promise.resolve(), queued = 0;
  const say = (t) => { queued++; const r = chain.then(async () => { await sleep(1700); await page.evaluate((x) => window.__jz.say(x), t); queued--; }); chain = r.catch(() => { queued--; }); return r; };
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `0.4.0_${n}.png`), timeout: 150000 });
  const key = async (k) => { await page.keyboard.press(k); await sleep(700); };
  const click = async (sel) => { await page.waitForSelector(sel, { timeout: 30000 }); await page.evaluate((q) => document.querySelector(q).click(), sel); await sleep(900); };
  const tod = async (t) => { await page.evaluate((x) => window.__jz.scene.userData.setTimeOfDay(x), t); await sleep(1500); };
  const look = (from, to, pitch, dist) => page.evaluate(({ from, to, pitch, dist }) => { const c = window.__jz.state.cam; c.yaw = Math.atan2(-(to[0] - from[0]), -(to[1] - from[1])); c.pitch = pitch; c.dist = dist; }, { from, to, pitch, dist });
  // The host renders at ~10 fps and the page's view of the server lags by seconds (ping 2-8 s), so wait for the teleport to show up instead of resending
  const goTo = async (x, z) => { for (let t = 0; t < 3; t++) { await say(`/testtp ${x} ${z}`); const end = Date.now() + 30000; while (Date.now() < end) { const q = await st(); if (q.hp > 0 && Math.hypot(q.pos.x - x, q.pos.z - z) < 3) { await sleep(1200); return true; } await sleep(400); } } const q = await st(); console.log("TELEPORT FAILED", x, z, "now at", q.pos.x.toFixed(1), q.pos.z.toFixed(1), "hp", q.hp); return false; };
  const clear = async () => { await say("/testkill 20"); await say("/testkill 20"); await say("/testheal"); };
  const mobNear = async (name) => { const q = await st(); return q.ents.filter((e) => new RegExp(name.split(" ")[0], "i").test(String(e.n)) && e.hp > 0 && e.k === "mob").sort((a, b) => Math.hypot(a.x - q.pos.x, a.z - q.pos.z) - Math.hypot(b.x - q.pos.x, b.z - q.pos.z))[0]; };
  await sleep(1500);
  await say("/testlevel 20");
  const heal = setInterval(() => { if (queued < 1) say("/testheal").catch(() => {}); }, 2500);
  await sleep(1000);

  // ---- HUD overview, day and night (plaza)
  if (want("hud_day") || want("hud_night")) {
    if (await goTo(0, -72)) {
      await look([0, -72], [0, -100], 0.3, 10);
      await tod(0.5); await sleep(1500); if (want("hud_day")) await shot("hud_day");
      await tod(0.0); await sleep(2500); if (want("hud_night")) await shot("hud_night");
    }
  }
  // ---- combat: hit splats and the bagua ring. A passive Lotus Toad by the pond is the target: it cannot kill the player while the slow link delays healing
  if (want("combat")) {
    await tod(0.5);
    await goTo(16.5, -27); await sleep(1500);
    const toad = await mobNear("Lotus Toad");
    if (toad && await goTo(Math.round((toad.x - 5) * 100) / 100, Math.round(toad.z * 100) / 100)) {
      const me = (await st()).pos, t2 = (await mobNear("Lotus Toad")) ?? toad;
      await look([me.x, me.z], [t2.x, t2.z], 0.5, 9);
      await page.keyboard.press("Tab"); await sleep(600);
      await page.keyboard.press("1"); await sleep(350); await shot("combat_bagua");
      await sleep(1600); await page.keyboard.press("2");
      await sleep(4500); await shot("combat_splats");
    } else console.log("no toad");
  }
  // ---- mob telegraphs (long wind-up so slow rendering can catch them)
  for (const [name, spot, shape, extra, file, pitch, dist, wantShot] of [
    ["Fox Spirit", { x: 55, z: 5 }, "cone", { arc: 1.45, radius: 3.5 }, "fox_cone", 1.2, 22, want("fox_cone")],
    ["Bamboo Spirit", { x: -40, z: 15 }, "line", { len: 3.6, width: 1.9, radius: 3.6 }, "bamboo_line", 1.4, 17, want("bamboo_line")],
  ]) {
    if (!wantShot) continue;
    await tod(0.5);
    await goTo(spot.x, spot.z); await sleep(3000);
    const m = await mobNear(name);
    if (!m) { console.log("no", name); continue; }
    await goTo(Math.round((m.x + 4) * 100) / 100, Math.round((m.z + 1) * 100) / 100); await sleep(500);
    const m2 = (await mobNear(name)) ?? m, me = (await st()).pos;
    const dir = Math.atan2(me.x - m2.x, me.z - m2.z);
    await look([me.x, me.z], [m2.x, m2.z], pitch, dist);
    await page.evaluate(({ id, x, z, dir, shape, extra }) => window.__jz.inject({ t: "ev", e: { k: "telegraph", src: id, x, z, delay: 20, shape, dir, ...extra } }), { id: m2.id, x: m2.x, z: m2.z, dir, shape, extra });
    await sleep(2500);
    console.log(file, (await st()).dangerShapes);
    // the grove is too dense to see a ground strip from any camera: hide the stalks for this one frame (spirits and the telegraph stay)
    if (shape === "line") await page.evaluate(() => { const b = window.__jz.scene.getObjectByName("bamboo"); if (b) b.visible = false; });
    await sleep(1500);
    await shot(file);
    if (shape === "line") await page.evaluate(() => { const b = window.__jz.scene.getObjectByName("bamboo"); if (b) b.visible = true; });
    await sleep(1000);
  }
  // ---- koi pond and shore foam: the avatar is hidden (its root group) so the low camera looks straight across the water (pond centre 0,-34, radius 15.5)
  if (want("koi_pond") || want("shore_foam")) {
    await tod(0.45);
    const hideMe = (on) => page.evaluate((hide) => { const j = window.__jz, p = j.state.pos; j.scene.children.forEach((o) => { if (o.isGroup && Math.hypot(o.position.x - p.x, o.position.z - p.z) < 0.8 && o.getObjectByName("baked")) o.visible = !hide; }); }, on);
    const lookAt = (from, to, pitch, dist) => page.evaluate(({ from, to, pitch, dist }) => { const c = window.__jz.state.cam; c.yaw = Math.atan2(-(to[0] - from[0]), -(to[1] - from[1])); c.pitch = pitch; c.dist = dist; }, { from, to, pitch, dist });
    for (const [at, to, pitch, dist, name] of [
      [[13.8, -29], [0, -37], 0.1, 4.5, "koi_pond"],
      [[-13.6, -38], [4, -30], 0.08, 5, "koi_pond_b"],
      [[14.2, -34], [-2, -34], 0.05, 3.2, "shore_foam"],
      [[-14.4, -34], [2, -36], 0.05, 3.2, "shore_foam_b"],
    ]) {
      if (!want(name.replace(/_b$/, ""))) continue;
      if (await goTo(at[0], at[1])) {
        await clear();
        await hideMe(true); await lookAt(at, to, pitch, dist); await sleep(5000);
        await hideMe(true); await shot(name);
        await hideMe(false);
      }
    }
  }
  // ---- shrine at dusk
  if (want("shrine_dusk")) {
    await tod(0.74);
    if (await goTo(0, 62) && await goTo(0, 71)) {
      await clear();
      await look([0, 71], [0, 85], 0.3, 13); await sleep(3000);
      const p = (await st()).pos; console.log("shrine shot at", p.x.toFixed(1), p.z.toFixed(1));
      await shot("shrine_dusk");
    }
  }
  // ---- boss phase 3 beam (real server beam). The queue's spacing is too slow to keep a player alive next to the Guardian on this laggy link,
  // so this block heals directly, once per chat-bucket refill (1.6 s), and does not touch the queue.
  if (want("boss_beam")) {
    await tod(0.5);
    await goTo(0, 62);
    const direct = (t) => page.evaluate((x) => window.__jz.say(x), t).catch(() => {});
    const fast = setInterval(() => direct("/testheal"), 1600);
    let ok = false;
    for (let round = 0; round < 4 && !ok; round++) {
      await direct("/testtp 0 74");
      await page.waitForFunction(() => Math.hypot(window.__jz.state.pos.x, window.__jz.state.pos.z - 74) < 3, null, { polling: 200, timeout: 30000 }).catch(() => {});
      const boss = (await st()).ents.find((e) => e.n === "Stone Guardian");
      await look([0, 74], [boss?.x ?? 0, boss?.z ?? 85], 1.15, 32);
      await sleep(1700); await direct("/testbosshp 0.2");
      const seen = await page.waitForFunction(() => window.__jz.state.dangerShapes.includes("beam") && window.__jz.state.pos.z > 50, null, { polling: 100, timeout: 40000 }).then(() => true, () => false);
      console.log("beam seen", seen, "round", round);
      if (!seen) continue;
      await sleep(1100);
      const q = await st();
      if (q.pos.z > 50 && q.hp > 0 && q.dangerShapes.includes("beam")) { await shot("boss_phase3_beam"); ok = true; }
    }
    if (!ok) console.log("NO BEAM, boss_beam not written");
    await direct("/testbosshp 1");
    clearInterval(fast);
  }
  clearInterval(heal);
  await goTo(0, -72); await tod(0.5);
  await page.evaluate(() => { const c = window.__jz.state.cam; if (c) { c.dist = 9; c.pitch = 0.4; } });
  await sleep(800);
  // ---- panels: gear, journal, settings 150%, world map
  if (want("gear_panel")) {
    for (const [i, q] of [["Bamboo_Fiber", 14], ["Fox_Tail", 6], ["Hound_Fang", 10], ["Jade_Scale", 8], ["Toad_Jelly", 4], ["Healing_Tonic", 2]]) await say(`/testgive ${i} ${q}`);
    await say("/testwallet 400 6");
    for (const it of ["Cloudpiercer_Brush", "Bamboo_Weave_Hat", "Jade_Scale_Vest", "Fox-Fur_Boots", "Warden's_Seal_Charm", "Guardian's_Heart", "Silver_Tail_Cloak", "Hound-Fang_Charm"]) await say(`/testgive ${it} 1`);
    await key("KeyG"); await sleep(600);
    for (let i = 0; i < 5; i++) { const ok = await page.evaluate(() => { const b = document.querySelector('#gearp [data-a="equip"]:not([disabled])'); if (b) b.click(); return !!b; }); if (!ok) break; await sleep(1200); }
    await shot("gear_panel"); await key("KeyG");
  }
  if (want("journal")) {
    // take Gate Warden Wu's side quests first so the journal has something to show
    if (await goTo(-9, -85.5)) {
      await page.evaluate(() => { const c = window.__jz.state.cam; if (c) { c.dist = 9; c.pitch = 0.4; } });
      await page.keyboard.press("KeyF");
      await click('#npcp [data-a="accept"]'); await sleep(4000);
      await key("Escape"); await sleep(1500);
    }
    await goTo(0, -72);
    await page.evaluate(() => { const c = window.__jz.state.cam; if (c) { c.dist = 9; c.pitch = 0.4; } });
    await sleep(6000); await key("KeyJ"); await sleep(3000); await shot("journal"); await key("KeyJ");
  }
  if (want("settings_150")) {
    await key("F1"); await click('#help [data-tab="display"]'); await click('#help [data-ts="1.5"]'); await sleep(500);
    await shot("settings_150"); await click('#help [data-ts="1"]'); await key("Escape");
  }
  if (want("world_map")) {
    for (const [x, z] of [[0, -34], [-40, 10], [55, 30], [0, 62], [0, -72]]) { await goTo(x, z); await sleep(600); }
    await key("n"); await sleep(900); await shot("world_map"); await key("n");
  }
  console.log("done");
} catch (e) { console.error(e); process.exitCode = 1; } finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of procs) { try { process.kill(-p.pid, "SIGKILL"); } catch { /* gone */ } }
}
