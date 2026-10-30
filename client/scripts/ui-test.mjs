// UI end-to-end test (Playwright). Starts the real server (JZ_SERVER_PORT, default 8981, temp DB) and the Vite dev server (JZ_CLIENT_PORT, default 8982),
// then checks login (v3 password flow), wallet pill, Notice Board, Fen, level cap, NPC dialog, quest tracker, help overlay, tooltips, HUD overlap at two resolutions, 20 Hz input,
// reconnect after a server restart and console cleanliness. Screenshots -> docs/shots/ui_*.png
// Run: node client/scripts/ui-test.mjs
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright"); // local devDependency: portable (the CI image's /opt/npm-tools path does not exist on Windows)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SHOTS = path.join(ROOT, "docs/shots");
mkdirSync(SHOTS, { recursive: true });
const SERVER_PORT = Number(process.env.JZ_SERVER_PORT) || 8981, CLIENT_PORT = Number(process.env.JZ_CLIENT_PORT) || 8982;
const DB = path.join(mkdtempSync(path.join(tmpdir(), "jz-uitest-")), "test.db");
const URL = `http://localhost:${CLIENT_PORT}/?auto=1&debug=1&name=UiTestSage&cls=sword&server=ws://localhost:${SERVER_PORT}`;

const procs = [];
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  // spawn the real .js entry points through this node binary: the node_modules/.bin shims are POSIX shell scripts and fail on Windows
  const p = spawn(process.execPath, [path.join(ROOT, "server/node_modules/tsx/dist/cli.mjs"), "src/server.ts"], {
    cwd: path.join(ROOT, "server"), env: { ...process.env, PORT: String(SERVER_PORT), DB_PATH: DB, TEST_MODE: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  p.log = "";
  p.stdout.on("data", (d) => (p.log += d)); p.stderr.on("data", (d) => (p.log += d));
  procs.push(p);
  return p;
}
async function waitHttp(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok || r.status < 500) return; } catch { /* retry */ } await sleep(300); }
  throw new Error("timeout waiting for " + url);
}
// POSIX process groups do not exist on Windows, so killing "-pid" there does nothing and leaves the server/vite running
// (the next suite then fails with EADDRINUSE). taskkill /T ends the process tree on Windows; POSIX keeps the group kill.
function killGroup(p, sig) {
  if (!p) return;
  if (process.platform === "win32") { try { spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } return; }
  try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch { /* gone */ } }
}
async function stopAll() {
  for (const p of procs) killGroup(p, "SIGTERM");
  await sleep(800);
  for (const p of procs) killGroup(p, "SIGKILL");
}

let server = startServer();
const vite = spawn(process.execPath, [path.join(ROOT, "client/node_modules/vite/bin/vite.js"), "--config", "scripts/vite.uitest.config.mjs", "--port", String(CLIENT_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: path.join(ROOT, "client"), stdio: ["ignore", "pipe", "pipe"], detached: true });
vite.log = ""; vite.stdout.on("data", (d) => (vite.log += d)); vite.stderr.on("data", (d) => (vite.log += d));
procs.push(vite);

const errors = [];      // console errors outside the planned outage
const outageErrors = [];
const infos = [];
let outage = false;
let browser;
try {
  await waitHttp(`http://localhost:${SERVER_PORT}/health`);
  await waitHttp(`http://localhost:${CLIENT_PORT}/`);
  browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (process.env.DBG) console.log("  [console]", m.type(), t.slice(0,200));
    if (m.type() === "error") (outage ? outageErrors : errors).push(t);
    if (m.type() === "info") infos.push(t);
  });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log("  [nav]", f.url().slice(0, 90)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("crash", () => console.log("  [page crashed]"));
  browser.on("disconnected", () => console.log("  [browser disconnected]"));

  const retry = async (fn) => { for (let i = 0; i < 6; i++) { try { return await fn(); } catch (e) { if (!/context was destroyed|navigation/i.test(String(e))) throw e; await sleep(2500); } } return fn(); };
  const st = () => retry(() => page.evaluate(() => window.__jz.state));
  const say = (t) => retry(() => page.evaluate((x) => window.__jz.say(x), t));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `ui_${n}.png`), timeout: 150000 });
  const rects = () => page.evaluate(() => {
    const ids = ["pframe", "tframe", "hotbar", "chat", "minimap", "zonelabel", "audioctl", "quest", "dialog", "loot", "buffs", "perf", "bagbtn", "boardbtn", "board", "wallet", "bag", "bossbar", "warn"];
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.1) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      out[id] = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }
    return out;
  });
  const overlaps = (R) => {
    const ks = Object.keys(R), bad = [];
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = R[ks[i]], b = R[ks[j]];
      if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) bad.push(`${ks[i]}x${ks[j]}`);
    }
    return bad;
  };
  const offscreen = (R, W, H) => Object.entries(R).filter(([, r]) => r.l < -1 || r.t < -1 || r.r > W + 1 || r.b > H + 1).map(([k]) => k);

  // ---- 0. v3 login screen: password field, inline errors, retry, remembered name
  {
    const base = `http://localhost:${CLIENT_PORT}/?debug=1&server=ws://localhost:${SERVER_PORT}`;
    const lp = await ctx.newPage();
    lp.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await lp.goto(base);
    await lp.waitForSelector("#login.show #jz-pw", { timeout: 60000 });
    await sleep(1500); // let the scroll-unroll animation finish so clicks land on a settled button
    const f = await lp.evaluate(() => { const i = document.getElementById("jz-pw"); const l = document.querySelector('label[for="jz-pw"]'); return { type: i.type, min: i.minLength, max: i.maxLength, label: l?.textContent, help: document.getElementById("jz-pwhelp")?.textContent, toggle: !!document.getElementById("jz-pwtoggle") }; });
    check("login: Password field (type=password, 4-64 chars) with label and helper text", f.type === "password" && f.min === 4 && f.max === 64 && f.label === "Password" && f.help === "New name? This password creates your character. Existing name? Enter its password." && f.toggle, JSON.stringify(f));
    await lp.fill("#jz-pw", "abc");
    await lp.fill("#jz-name", "UiPwTester");
    await lp.click("#jz-go");
    await sleep(300);
    check("login: too-short password shows an inline error and stays on login", /4 to 64/.test(await lp.textContent("#jz-err")) && (await lp.evaluate(() => window.__jz.screen)) === "login");
    await lp.fill("#jz-pw", "goodpass1");
    await lp.click("#jz-pwtoggle");
    check("login: show/hide toggle reveals the password", (await lp.evaluate(() => document.getElementById("jz-pw").type)) === "text");
    await lp.click("#jz-pwtoggle");
    check("login: toggle hides it again", (await lp.evaluate(() => document.getElementById("jz-pw").type)) === "password");
    await lp.click("#jz-go");
    await lp.waitForFunction(() => window.__jz.state.ready, null, { timeout: 120000 });
    check("login: new name + password registers and enters the world", true);
    await lp.close();
    await sleep(1500);
    const lp2 = await ctx.newPage();
    lp2.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    if (process.env.DBG) lp2.on("console", (m) => console.log("  [lp2 console]", m.type(), m.text().slice(0, 200)));
    await lp2.goto(base);
    await lp2.waitForSelector("#login.show #jz-pw", { timeout: 60000 });
    await sleep(1500);
    check("login: last character name is remembered, password is not", (await lp2.inputValue("#jz-name")) === "UiPwTester" && (await lp2.inputValue("#jz-pw")) === "");
    for (let attempt = 0; attempt < 3; attempt++) { // a cold Vite dev server may reload the page once while it optimises dependencies: retry the submit
      try {
        await lp2.fill("#jz-pw", "wrongpass9");
        await lp2.click("#jz-go");
        await lp2.waitForFunction(() => document.getElementById("jz-err").textContent.length > 0 && !document.getElementById("jz-go").disabled, null, { timeout: 20000 });
        break;
      } catch (e) { if (attempt === 2) throw e; await sleep(1500); }
    }
    const errTxt = await lp2.textContent("#jz-err");
    const errCol = await lp2.evaluate(() => getComputedStyle(document.getElementById("jz-err")).color);
    check("login: wrong password shows the server error inline in vermilion", errTxt === "Wrong password for that name." && errCol === "rgb(200, 55, 45)" && (await lp2.evaluate(() => window.__jz.screen)) === "login", `${errTxt} ${errCol}`);
    await lp2.screenshot({ path: path.join(SHOTS, "ui_login_pw_error.png"), timeout: 150000 });
    await lp2.fill("#jz-pw", "goodpass1");
    await lp2.click("#jz-go");
    await lp2.waitForFunction(() => window.__jz.state.ready, null, { timeout: 120000 });
    check("login: retry with the right password enters the world", true);
    await lp2.close();
    await sleep(1500);
  }

  if (process.env.ONLY_LOGIN) throw new Error("ONLY_LOGIN: stopped after the login-screen checks");

  // ---- 1. login
  await page.goto(URL);
  await page.waitForFunction(() => window.__jz.state.ready, null, { timeout: 90000 });
  let s = await st();
  check("login: entered the world (?auto=1 defaults the password)", s.ready && s.myId > 0, `id=${s.myId} zone=${s.zone}`);
  check("XP bar uses the v3 level curve (lv1 needs 30 XP)", s.xpBar.text === "Lv 1 · 0 / 30 XP", s.xpBar.text);
  check("server sent wallet + a 3-task daily board after welcome", s.wallet.coin >= 0 && s.daily.tasks.length === 3 && s.daily.resetIn > 0, JSON.stringify({ w: s.wallet, n: s.daily.tasks.length, r: s.daily.resetIn }));
  await page.waitForFunction(() => window.__jz.state.entityCount > 3, null, { timeout: 30000 });
  await sleep(2500);
  s = await st();
  check("tracker initial state is 'Speak to Elder Lin' (after silent /quest)", s.quest.status === "none", JSON.stringify(s.quest));
  const npcs = s.ents.filter((e) => e.k === "npc");
  check("NPCs visible near spawn", npcs.length >= 1, npcs.map((n) => n.n).join(" | "));
  const elder = npcs.find((n) => /Elder Lin/.test(n.n));
  check("Elder Lin present", !!elder);
  check("Notice Board Keeper Fen present (4 NPCs)", npcs.some((n) => /Notice Board Keeper Fen/.test(n.n)) && npcs.length >= 4, npcs.map((n) => n.n).join(" | "));
  check("chat hint line mentions B for the notice board", (await page.evaluate(() => document.getElementById("chatlog").innerText)).includes("B notice board"));
  await sleep(1500);
  { // the spawn point is jittered; the prompt only shows within 12 units of an NPC
    const nearest = Math.min(...npcs.map((n) => Math.hypot(n.x - s.pos.x, n.z - s.pos.z)));
    const shown = await retry(() => page.evaluate(() => getComputedStyle(document.getElementById("prompt")).display !== "none"));
    check("interact prompt visible when an NPC is within 12 units", nearest > 11.5 || shown, `nearest NPC ${nearest.toFixed(1)}, shown=${shown}`);
  }
  await shot("prompt");

  // ---- 1b. walk next to Elder Lin (the spawn point is jittered; F speaks to the NEAREST npc)
  let approachKey = "w";
  async function walkNear(target, radius, maxMs = 40000) {
    const t0 = Date.now();
    const dist = async () => { const q = await st(); return Math.hypot(target.x - q.pos.x, target.z - q.pos.z); };
    let d = await dist();
    while (d > radius && Date.now() - t0 < maxMs) {
      let best = null;
      for (const k of ["w", "d", "s", "a"]) {
        const d0 = await dist();
        await page.keyboard.down(k); await sleep(700); await page.keyboard.up(k); await sleep(250);
        const d1 = await dist();
        if (d1 < d0 - 0.3 && (!best || d1 < best.d1)) { best = { k, d1 }; break; }
      }
      if (!best) continue;
      approachKey = best.k;
      await page.keyboard.down(best.k);
      let prev = await dist(), stalls = 0;
      while (Date.now() - t0 < maxMs) {
        await sleep(500);
        const n = await dist();
        if (n <= radius) break;
        stalls = n > prev - 0.05 ? stalls + 1 : 0; // software GL has multi-second frame stalls: only give up after 4 flat samples in a row
        prev = n;
        if (stalls >= 4) break;
      }
      await page.keyboard.up(best.k);
      d = await dist();
    }
    return d;
  }
  let dEl = await walkNear(elder, 3.5, 25000);
  if (dEl > 10) { // keyboard walking is time-boxed: under software GL a stalled frame run can eat the whole budget. Fall back to the server's TEST_MODE teleport so the UI checks below still run.
    console.log(`  (walk fell short at d=${dEl.toFixed(1)}; using /testtp)`);
    await page.evaluate((e) => window.__jz.say(`/testtp ${e.x} ${e.z + 3}`), elder);
    for (let i = 0; i < 60 && dEl > 10; i++) { await sleep(500); const q = await st(); dEl = Math.hypot(elder.x - q.pos.x, elder.z - q.pos.z); } // the page lags the server by several seconds under software GL
  }
  check("walked next to Elder Lin", dEl <= 10, `d=${dEl.toFixed(1)}`);
  await sleep(600);
  check("interact prompt visible next to Elder Lin", await retry(() => page.evaluate(() => getComputedStyle(document.getElementById("prompt")).display !== "none")));
  await sleep(800);

  // ---- 2. dialog
  await page.keyboard.press("f");
  for (let i = 0; i < 20 && !(await st()).dialog.open; i++) await sleep(500);
  { const q = await st(); console.log("  [dbg] after F:", JSON.stringify({ dialog: q.dialog, pos: q.pos, ents: q.ents.filter((e) => e.k === "npc").map((e) => [e.id, e.n, e.x, e.z]) })); }
  check("F opens a dialog", (await st()).dialog.open);
  await page.waitForFunction(() => /Elder Lin|bamboo/i.test(document.querySelector("#dialog .dsp")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
  await sleep(1200);
  const dtext = await page.evaluate(() => document.getElementById("dialog").innerText);
  check("dialog shows Elder Lin's reply (quest text)", /bamboo spirits/i.test(dtext), JSON.stringify(dtext.slice(0, 120)));
  check("dialog has brush title (English only)", /Elder Lin/.test(dtext) && !/[\u3400-\u9fff]/.test(dtext));
  s = await st();
  check("quest tracker is active 0/5 after accept", s.quest.status === "active" && s.quest.max === 5, JSON.stringify(s.quest));
  await shot("dialog");
  let R = await rects();
  check("1280x720 dialog open: no HUD overlap", overlaps(R).length === 0, overlaps(R).join(","));
  await page.keyboard.press("Escape");
  await sleep(300);
  check("Escape closes the dialog", !(await st()).dialog.open);

  // ---- 3. tooltip + buff + tracker HUD shot
  await page.keyboard.press("4");
  let buffSeen = false;
  for (let i = 0; i < 10 && !buffSeen; i++) { buffSeen = (await page.locator("#buffs .buff").count()) >= 1; if (!buffSeen) await sleep(150); }
  await page.mouse.move(640, 640);
  const box = await page.evaluate(() => { const r = document.querySelectorAll("#hotbar .slot")[1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await sleep(400);
  const tip = await page.evaluate(() => { const t = document.getElementById("tip"); return { shown: getComputedStyle(t).display !== "none", text: t.innerText }; });
  check("skill tooltip on hover (name, cooldown, range, description)", tip.shown && /Sword Qi Wave/.test(tip.text) && !/[\u3400-\u9fff]/.test(tip.text) && /Cooldown/.test(tip.text) && /Range/.test(tip.text), JSON.stringify(tip.text.slice(0, 80)));
  check("buff indicator after Qi Guard", buffSeen);
  await shot("tooltip_buff");
  await page.mouse.move(640, 300);
  await sleep(300);
  R = await rects();
  check("1280x720 HUD: no overlap", overlaps(R).length === 0, overlaps(R).join(","));
  check("1280x720 HUD: nothing off-screen", offscreen(R, 1280, 720).length === 0, offscreen(R, 1280, 720).join(","));
  await shot("hud_1280x720");

  // ---- 3a2. 0.4.0 Qi pool + dodge roll
  {
    let q = (await st()).qi;
    check("Qi bar shows the server pool (Qi n / 100, jade fill)", !!q && /^Qi \d+ \/ 100$/.test(q.text) && q.max === 100 && q.fill > 0.5, q && q.text);
    const costs = await page.evaluate(() => [...document.querySelectorAll("#hotbar .slot .qc")].map((e) => e.textContent));
    check("hotbar slots show Qi costs (4 skills + dodge)", costs.length === 5 && costs.every((c) => /^\d+$/.test(c)), costs.join(","));
    const tip2 = await page.evaluate(async () => { const el = document.querySelectorAll("#hotbar .slot")[0]; el.dispatchEvent(new PointerEvent("pointerenter")); await new Promise((r) => setTimeout(r, 100)); return document.getElementById("tip").innerText; });
    check("skill tooltip lists the Qi cost", /\d+ Qi/.test(tip2), JSON.stringify(tip2.slice(0, 70)));
    await page.mouse.move(640, 300);
    await say("/testqi 0 90"); // held 90 s: a loaded host can take far longer than the default 6 s between here and the Space press
    for (let i = 0; i < 40 && (await st()).qi.qi > 1; i++) await sleep(250);
    q = (await st()).qi;
    check("Qi bar empties; every costed slot greys out", q.qi < 6 && q.fill < 0.08 && q.low && q.slots.every((x) => x.short), JSON.stringify(q.slots.map((x) => +x.short)));
    const r0 = (await st()).dodge.rolls;
    const focus = await page.evaluate(() => { const a = document.activeElement; const t = a ? a.tagName + "#" + a.id : "none"; if (a && a !== document.body && a.blur) a.blur(); return t; });
    await page.keyboard.press("Space");
    for (let i = 0; i < 20 && !(await st()).lastRefusal; i++) await sleep(100);
    const refusal = (await st()).lastRefusal;
    check("dodge refused with no Qi: no roll, clear message", (await st()).dodge.rolls === r0 && /Not enough Qi/.test(refusal), JSON.stringify(refusal) + " focus " + focus + " qi " + (await st()).qi.qi);
    await say("/testqi 100");
    for (let i = 0; i < 40 && (await st()).qi.qi < 99; i++) await sleep(250);
    await sleep(1600);
    const before = await st();
    await page.keyboard.down("KeyW");
    await sleep(250);
    // press Space twice inside one page task so frame stalls on a loaded host cannot let the cooldown expire in between
    const two = await page.evaluate(() => {
      const press = () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
      const s0 = window.__jz.state.dodge.rolls; press(); const s1 = window.__jz.state.dodge; press(); const s2 = window.__jz.state.dodge;
      return { s0, s1, s2 };
    });
    await page.keyboard.up("KeyW");
    let minQi = 100;
    for (let i = 0; i < 40; i++) { minQi = Math.min(minQi, (await st()).qi.qi); await sleep(50); } // Qi regenerates 10/s, so catch the dip right after the roll
    await sleep(500);
    const after = await st();
    check("Space rolls once (prediction counter)", two.s1.rolls === two.s0 + 1 && after.dodge.rolls === before.dodge.rolls + 1);
    check("second Space inside the cooldown does nothing", two.s2.rolls === two.s1.rolls);
    check("roll covered ~6 units (predicted dash steps)", after.dodge.lastDist > 5.4 && after.dodge.lastDist < 6.6, `${after.dodge.lastDist}u`);
    check("dodge costs Qi on the HUD (about 15 less than a full pool)", minQi < 95 && minQi > 70, `lowest qi after the roll ${minQi}`);
    check("dodge cooldown shown on the dodge slot right after the press", two.s1.cooldownMs > 1000 && two.s1.cooldownMs <= 1500, `${two.s1.cooldownMs} ms left`);
    // Idle roll: wait for the cooldown to run out, then for the player to be genuinely still, so a multi-second
    // software-GL frame stall cannot leave the sampled baseline mid-reconcile. After the key press, wait for the
    // roll to register and the dash to land before measuring the displacement.
    await page.waitForFunction(() => window.__jz.state.dodge.cooldownMs === 0, null, { timeout: 30000, polling: 200 });
    const stillPos = async () => {
      let prev = null;
      for (let i = 0; i < 80; i++) {
        const q = await st();
        if (q.hp > 0 && prev && Math.abs(q.pos.x - prev.x) < 0.02 && Math.abs(q.pos.z - prev.z) < 0.02) return q;
        prev = q.pos;
        await sleep(150);
      }
      return st();
    };
    const pos0 = (await stillPos()).pos;
    await page.keyboard.press("Space");
    // the key press can queue behind a stalled frame: wait for the roll counter, then for the dash to finish and the
    // prediction to reconcile before taking the settled position.
    await page.waitForFunction((r0) => window.__jz.state.dodge.rolls === r0 + 1, after.dodge.rolls, { timeout: 30000, polling: 200 }).catch(() => {});
    let stN = await st();
    let moved = Math.hypot(stN.pos.x - pos0.x, stN.pos.z - pos0.z);
    for (let i = 0; i < 100 && !(stN.dodge.rolls === after.dodge.rolls + 1 && !stN.dodge.rolling && moved > 4.5 && stN.predErr < 1.5); i++) {
      await sleep(200);
      stN = await st();
      moved = Math.hypot(stN.pos.x - pos0.x, stN.pos.z - pos0.z);
    }
    check("idle roll goes along the facing; server and prediction agree afterwards (no snap)", stN.dodge.rolls === after.dodge.rolls + 1 && moved > 4.5 && stN.predErr < 1.5, `moved ${moved.toFixed(1)}u predErr ${stN.predErr}`);
    // "Dodged!" feedback comes from the server when i-frames negate a hit
    await page.evaluate(() => window.__jz.inject({ t: "ev", e: { k: "dodged", id: window.__jz.state.myId } }));
    await sleep(250);
    check("a `dodged` event shows 'Dodged!' and counts", (await st()).dodge.dodged === 1 && (await page.locator(".fl", { hasText: "Dodged!" }).count()) >= 1);
    await sleep(2500);
  }

  // ---- 3b. bag (inv message), loot toast, boss telegraph warning (fabricated through the debug inject hook)
  check("bag button visible in the HUD", await page.evaluate(() => { const b = document.getElementById("bagbtn"); return !!b && b.getBoundingClientRect().width > 20; }));
  s = await st();
  check("server sent an inventory after welcome (bag state exists)", Array.isArray(s.inv), JSON.stringify(s.inv));
  await page.evaluate(() => {
    window.__jz.inject({ t: "inv", items: [{ item: "Healing Tonic", itemZh: "", qty: 2 }, { item: "Fox Tail", itemZh: "", qty: 3 }] });
    window.__jz.inject({ t: "inv", items: [{ item: "Healing Tonic", itemZh: "", qty: 2 }, { item: "Fox Tail", itemZh: "", qty: 3 }, { item: "Jade Scale", itemZh: "", qty: 1 }] });
    window.__jz.inject({ t: "ev", e: { k: "loot", item: "Jade Scale", itemZh: "", qty: 1 } });
  });
  await sleep(500);
  check("loot toast shows an item pictogram", await page.evaluate(() => !!document.querySelector("#loot .ll.item .lseal svg.ico")));
  check("bag button shows the 'new' dot", await page.evaluate(() => document.getElementById("bagbtn").classList.contains("fresh")));
  await page.keyboard.press("i");
  await sleep(400);
  const bagTxt = await page.evaluate(() => document.getElementById("bag").innerText);
  check("I opens the bag with English names, pictograms and quantities", (await st()).bagOpen && /Jade Scale/.test(bagTxt) && !/[\u3400-\u9fff]/.test(bagTxt) && /×3/.test(bagTxt), JSON.stringify(bagTxt.replace(/\n/g, " ").slice(0, 90)));
  check("new item is highlighted in the bag", (await page.locator("#bag .bi.new").count()) >= 1);
  await shot("bag");
  R = await rects();
  check("1280x720 bag open: no HUD overlap", overlaps(R).length === 0, overlaps(R).join(","));
  await page.keyboard.press("i");
  await sleep(200);
  check("I closes the bag", !(await st()).bagOpen);
  s = await st();
  await page.evaluate(({ x, z }) => window.__jz.inject({ t: "ev", e: { k: "telegraph", src: 99999, x: x + 3, z, radius: 5, delay: 6 } }), s.pos); // long wind-up: on a slow software-GL first run the 2 s ring could expire before the checks ran
  await sleep(500);
  check("telegraph shows the on-screen warning", await page.evaluate(() => /Stone Guardian winds up/i.test(document.getElementById("warn").innerText)));
  check("telegraph registers a danger ring", (await st()).dangers >= 1);
  await shot("telegraph");
  await sleep(7500);
  check("telegraph resolves and clears", (await st()).dangers === 0);
  // 0.4.0 shaped telegraphs (cone / line / sweeping beam): additive `telegraph` fields, same red ink style
  {
    const inj = (extra, delay) => page.evaluate(({ x, z, extra, delay }) => window.__jz.inject({ t: "ev", e: { k: "telegraph", src: 99999, x, z, radius: 4, delay, ...extra } }), { ...s.pos, extra, delay });
    // Long wind-ups (10 s) and one evaluate for both: at ~5-10 fps on software GL a page.evaluate can take seconds, so short
    // telegraphs used to expire (and be removed) before the check ran, which looked like a missing cone.
    await inj({ shape: "cone", dir: 0, arc: 1.45 }, 10);
    await inj({ shape: "line", dir: 1.2, len: 4, width: 1.9 }, 10);
    let shapes = [];
    for (let i = 0; i < 20 && !(shapes.includes("cone") && shapes.includes("line")); i++) { await sleep(150); shapes = (await st()).dangerShapes; }
    check("cone and line telegraphs register as shaped danger zones", shapes.includes("cone") && shapes.includes("line"), JSON.stringify(shapes));
    for (let i = 0; i < 80 && (await st()).dangers > 0; i++) await sleep(250);
    check("shaped telegraphs resolve and clear", (await st()).dangers === 0);
    await inj({ shape: "line", dir: 0.3, len: 28, width: 2.8, sweep: 1.5708, lead: 0.9, beam: true }, 10.9);
    let beamOk = false;
    for (let i = 0; i < 20 && !beamOk; i++) { await sleep(150); beamOk = await page.evaluate(() => /Rune beam/i.test(document.getElementById("warn").innerText)) && (await st()).dangerShapes.includes("beam"); }
    check("beam telegraph shows the 'Rune beam!' warning and registers a beam", beamOk);
    for (let i = 0; i < 80 && (await st()).dangers > 0; i++) await sleep(250);
    check("beam telegraph clears after its sweep", (await st()).dangers === 0);
  }

  // ---- 3c. wallet pill
  R = await rects();
  check("wallet pill is visible in the top-right area", !!R.wallet && R.wallet.t < 60 && R.wallet.r > 800, JSON.stringify(R.wallet));
  check("wallet pill has coin and jade tooltips", await page.evaluate(() => document.querySelector("#wallet .wc.coin")?.title === "Coin" && document.querySelector("#wallet .wc.jade")?.title === "Jade - rare currency" && !!document.querySelector("#wallet .wc.coin svg.ico") && !!document.querySelector("#wallet .wc.jade svg.ico")));
  const w0 = (await st()).wallet;
  await page.evaluate(() => { window.__wf = { float: "", pulse: false }; new MutationObserver(() => { const f = document.querySelector("#wallet .wc.coin .wfloat"); if (f) window.__wf.float = f.textContent; if (document.querySelector("#wallet .wc.coin.pulse")) window.__wf.pulse = true; }).observe(document.getElementById("wallet"), { subtree: true, childList: true, attributes: true, characterData: true }); }); // slow software GL can delay the test past the 1.4 s animation
  await say("/testwallet 120 3");
  await page.waitForFunction((w) => window.__jz.state.wallet.coin >= w.coin + 120 && window.__jz.state.wallet.jade >= w.jade + 3, w0, { timeout: 60000 });
  check("wallet message updates the pill state", true, JSON.stringify((await st()).wallet));
  check("gain shows a floating +120 and a pulse", await page.evaluate(() => /\+120/.test(window.__wf.float) && window.__wf.pulse), JSON.stringify(await page.evaluate(() => window.__wf)));
  await page.waitForFunction(() => document.querySelector("#wallet .wc.coin .wn").textContent.replace(/,/g, "") === String(window.__jz.state.wallet.coin), null, { timeout: 40000 });
  check("number ticks up to the new balance", true, await page.textContent("#wallet .wc.coin .wn"));
  await shot("wallet");
  R = await rects();
  check("1280x720 wallet: no HUD overlap", overlaps(R).length === 0, overlaps(R).join(","));

  // ---- 3d. daily board: one claimable, one claimed, one in progress
  const first = (await st()).daily.tasks;
  check("board starts with no claimable task and no notification dot", (await st()).daily.claimable === 0 && !(await page.evaluate(() => document.getElementById("boardbtn").classList.contains("claimable"))));
  await say("/testdaily 1");
  await page.waitForFunction(() => window.__jz.state.daily.claimable === 1, null, { timeout: 60000 });
  check("finished task lights the notification dot on the Board button", await page.evaluate(() => document.getElementById("boardbtn").classList.contains("claimable") && getComputedStyle(document.querySelector("#boardbtn .dot")).display !== "none"));
  await page.keyboard.press("b");
  await sleep(500);
  check("B opens the Notice Board (and not the bag)", (await st()).daily.open && !(await st()).bagOpen);
  let bd = await page.evaluate(() => ({ rows: document.querySelectorAll("#board .bdt").length, head: document.querySelector("#board .bdh").innerText, claim: document.querySelectorAll("#board .bdclaim:not([disabled])").length, prog: document.querySelectorAll("#board .bdprog").length, txt: document.getElementById("board").innerText }));
  check("board shows 3 tasks, a Claim button, and 'In progress' for the others", bd.rows === 3 && bd.claim === 1 && bd.prog === 2, JSON.stringify({ rows: bd.rows, claim: bd.claim, prog: bd.prog }));
  check("board header shows the reset countdown (Resets in Hh MMm)", /Notice Board/i.test(bd.head) && /Resets in (\d+h \d\d?m|\d+m|under a minute)/i.test(bd.head), JSON.stringify(bd.head));
  const r0 = (await st()).daily.resetIn;
  await sleep(2500);
  check("reset countdown runs locally", (await st()).daily.resetIn <= r0 - 2, `${r0} -> ${(await st()).daily.resetIn}`);
  check("task rows show title, description, have/need and coin / jade / XP rewards", await page.evaluate(() => [...document.querySelectorAll("#board .bdt")].every((r) => r.querySelector(".bdtt")?.textContent && r.querySelector(".bddesc")?.textContent && /\d+ \/ \d+/.test(r.querySelector(".bdbar span")?.textContent || "") && r.querySelectorAll(".bdrw svg.ico").length === 3)));
  const wBefore = (await st()).wallet;
  await page.click("#board .bdclaim:not([disabled])", { noWaitAfter: true, timeout: 90000 });
  await page.waitForFunction(() => window.__jz.state.daily.tasks.some((t) => t.claimed), null, { timeout: 60000 });
  await page.waitForFunction((w) => window.__jz.state.wallet.coin > w.coin, wBefore, { timeout: 30000 });
  check("Claim grants the reward once: wallet grew, stamp shown, button gone", await page.evaluate(() => !!document.querySelector("#board .bdt.claimed .bdstamp") && document.querySelectorAll("#board .bdclaim").length === 0), JSON.stringify((await st()).wallet));
  await say("/testdaily 2");
  await page.waitForFunction(() => window.__jz.state.daily.claimable === 1 && window.__jz.state.daily.tasks.filter((t) => t.claimed).length === 1, null, { timeout: 60000 });
  await sleep(800);
  bd = await page.evaluate(() => ({ claimed: document.querySelectorAll("#board .bdt.claimed").length, ready: document.querySelectorAll("#board .bdt.ready").length, active: document.querySelectorAll("#board .bdt.active").length }));
  check("mixed states render: 1 claimed, 1 ready, 1 in progress", bd.claimed === 1 && bd.ready === 1 && bd.active === 1, JSON.stringify(bd));
  await shot("board");
  R = await rects();
  check("1280x720 board open: no HUD overlap", overlaps(R).length === 0, overlaps(R).join(","));
  await page.keyboard.press("Escape");
  await sleep(300);
  check("Escape closes the board", !(await st()).daily.open);
  await page.keyboard.press("b"); await sleep(300);
  const reopened = (await st()).daily.open;
  await page.keyboard.press("b"); await sleep(300);
  check("B toggles the board", reopened && !(await st()).daily.open);
  check("dot stays while a reward is waiting", await page.evaluate(() => document.getElementById("boardbtn").classList.contains("claimable")));

  // ---- 3e. Notice Board Keeper Fen: F next to him opens the board
  const fen = (await st()).ents.find((e) => /Notice Board Keeper Fen/.test(e.n));
  await say(`/testtp ${fen.x + 1.5} ${fen.z + 2}`);
  await page.waitForFunction((f) => { const q = window.__jz.state; return Math.hypot(q.pos.x - f.x, q.pos.z - f.z) < 4; }, fen, { timeout: 90000 });
  await sleep(1500);
  // the page lags the server by seconds under software GL and the camera eases after a teleport, so give the plate time to project on screen
  const fenPlate = await page.waitForFunction(() => [...document.querySelectorAll(".np.npc")].some((n) => /Notice Board Keeper Fen/.test(n.textContent || "") && n.style.display !== "none"), null, { timeout: 30000 }).then(() => true, () => false);
  check("Fen has a nameplate", fenPlate);
  await page.keyboard.press("f");
  await page.waitForFunction(() => window.__jz.state.daily.open, null, { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector("#board .bdspeech")?.textContent, null, { timeout: 30000 }).catch(() => {}); // the reply travels through the lagging page too
  await sleep(500);
  const fenTxt = await page.evaluate(() => ({ dialog: getComputedStyle(document.getElementById("dialog")).display, speech: document.querySelector("#board .bdspeech")?.textContent || "" }));
  check("talking to Fen opens the board (no dialog scroll) with his line", fenTxt.dialog === "none" && /Fresh notices go up at midnight/i.test(fenTxt.speech), JSON.stringify(fenTxt));
  await sleep(1500);
  check("the /daily dump is not echoed into chat after talking to Fen", !(await page.evaluate(() => document.getElementById("chatlog").innerText)).includes("Daily tasks (resets in"));
  await shot("fen");
  await page.keyboard.press("Escape");
  await sleep(300);

  // ---- 3f. level cap 20: full gold bar, MAX label, no NaN
  await say("/testlevel 20");
  await page.waitForFunction(() => window.__jz.state.xpBar.max, null, { timeout: 60000 });
  await say("/testxp 500");
  await sleep(1500);
  s = await st();
  check("level 20: XP bar shows MAX with a full bar", s.xpBar.max && s.xpBar.fill === 1 && /Lv 20 · MAX/.test(s.xpBar.text) && !/NaN|Infinity|undefined/.test(s.xpBar.text), JSON.stringify(s.xpBar));
  await page.evaluate(() => window.__jz.inject({ t: "ev", e: { k: "xp", amount: 0, lv: 20, xp: 0, next: 0 } }));
  await sleep(200);
  check("xp event {lv:20, xp:0, next:0} does not divide by zero", !/NaN|Infinity/.test((await st()).xpBar.text) && (await st()).xpBar.fill === 1);
  await page.evaluate(() => { window.__jz.inject({ t: "ev", e: { k: "chat", from: "System", text: "You found 7 coin.", sys: true } }); window.__jz.inject({ t: "ev", e: { k: "chat", from: "System", text: "You received 3 jade.", sys: true } }); });
  await sleep(300);
  check("coin / jade sys lines render as normal system chat lines", await page.evaluate(() => { const l = [...document.querySelectorAll("#chatlog .ln.sys")].map((x) => x.textContent); return l.includes("You found 7 coin.") && l.includes("You received 3 jade."); }));
  await shot("xp_max");

  // ---- 4. quest log + help
  await page.keyboard.press("l");
  await sleep(300);
  await shot("questlog");
  check("quest log opens with L", await page.evaluate(() => document.getElementById("qlog").classList.contains("show")));
  await page.keyboard.press("l");
  await page.keyboard.press("F1");
  await sleep(300);
  check("help overlay opens with F1", (await st()).helpOpen);
  check("help lists B for the Notice Board", await page.evaluate(() => /Notice Board/i.test(document.getElementById("help").innerText)));
  await shot("help");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+Slash");
  await sleep(200);
  check("help overlay opens with ?", (await st()).helpOpen);
  await page.keyboard.press("Escape");

  // ---- 4b. 0.4.0 batch 3: settings window, mixer, accessibility, chat tabs, bag tools, world map, action bar polish
  const SHOT3 = (n, clip) => page.screenshot({ path: path.join(SHOTS, `batch3_ui_test_${n}.png`), timeout: 150000, ...(clip ? { clip } : {}) });
  const jclick = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const jcheck = (sel, on = true) => page.evaluate(([s, o]) => { const e = document.querySelector(s); if (e.checked !== o) e.click(); }, [sel, on]);
  const jsel = (sel, val) => page.evaluate(([s, v]) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); }, [sel, val]);
  const jhover = (sel) => page.evaluate((s) => document.querySelector(s).dispatchEvent(new PointerEvent("pointerover", { bubbles: true })), sel);
  await page.evaluate(() => { try { localStorage.removeItem("jz.settings.v1"); } catch { /* ignore */ } });
  await page.keyboard.press("F1");
  await sleep(450);
  const tabs = await page.evaluate(() => [...document.querySelectorAll("#help .jz-tab")].map((b) => b.textContent));
  check("F1 opens the settings window on Controls with four tabs", (await st()).helpOpen && tabs.join(",") === "Controls,Sound,Display,Access" && (await page.evaluate(() => /Dodge roll/.test(document.getElementById("help").innerText))), tabs.join(","));
  check("controls tab lists the new map key N", await page.evaluate(() => /World map/.test(document.getElementById("help").innerText)));
  await SHOT3("settings_controls");
  await jclick('#help [data-tab="sound"]');
  await sleep(200);
  const sl = await page.evaluate(() => [...document.querySelectorAll('#help [data-pane="sound"] input[type=range]')].filter((e) => e.offsetParent).map((e) => e.id));
  check("sound tab has five mixer sliders (master, music, ambience, effects, interface)", sl.join(",") === "s-master,s-music,s-amb,s-sfx,s-ui", sl.join(","));
  await page.evaluate(() => { const e = document.getElementById("s-music"); e.value = "30"; e.dispatchEvent(new Event("input", { bubbles: true })); const m = document.getElementById("s-ui"); m.value = "0"; m.dispatchEvent(new Event("input", { bubbles: true })); });
  await sleep(150);
  const lv = await page.evaluate(() => ({ a: window.__jz.audio, saved: JSON.parse(localStorage.getItem("jz.settings.v1") || "{}") }));
  check("mixer sliders reach the audio buses and persist (versioned)", Math.abs(lv.a.music - 0.3) < 0.01 && lv.a.ui === 0 && lv.saved.v === 1 && Math.abs(lv.saved.vol.music - 0.3) < 0.01, JSON.stringify(lv.a));
  check("music readout shows a percentage", (await page.textContent('#help output[data-for="s-music"]')) === "30%");
  await page.evaluate(() => { const m = document.getElementById("s-ui"); m.value = "100"; m.dispatchEvent(new Event("input", { bubbles: true })); const e = document.getElementById("s-music"); e.value = "100"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await SHOT3("settings_sound");
  await jclick('#help [data-tab="display"]');
  await sleep(200);
  await SHOT3("settings_display");
  await jclick('#help [data-ts="1.5"]');
  await sleep(200);
  check("text size 150% scales the reading windows", (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tz").trim())) === "1.5" && (await page.evaluate(() => { const r = document.querySelector("#help .hp").getBoundingClientRect(); return r.width <= window.innerWidth && r.height <= window.innerHeight; })));
  await SHOT3("settings_text150");
  await jclick('#help [data-ts="1"]');
  await jclick('#help [data-tab="access"]');
  await sleep(200);
  await jsel("#s-cb", "deutan");
  await jcheck("#s-contrast");
  await jcheck("#s-motion");
  await sleep(250);
  const acc = await page.evaluate(() => ({ cb: document.documentElement.dataset.cb, cues: document.documentElement.dataset.cues, hc: document.documentElement.dataset.contrast, mo: document.documentElement.dataset.motion, filter: !!document.getElementById("jz-cb-deutan"), css: getComputedStyle(document.getElementById("hud")).filter }));
  check("colour assist installs an SVG filter, turns on pattern cues and filters the HUD", acc.cb === "deutan" && acc.cues === "1" && acc.filter && /jz-cb-deutan/.test(acc.css), JSON.stringify(acc));
  check("high contrast and reduce-motion set their document flags", acc.hc === "high" && acc.mo === "reduced");
  check("Qi bar carries a hatch pattern when cues are on (not colour alone)", await page.evaluate(() => /repeating-linear-gradient/.test(getComputedStyle(document.querySelector("#pframe .bar.qi > i")).backgroundImage)));
  await SHOT3("settings_access");
  await page.keyboard.press("Escape");
  await sleep(300);
  await SHOT3("hud_colourblind_contrast", { x: 0, y: 0, width: 640, height: 260 });
  // export / import round trip, then reset
  await page.keyboard.press("F1");
  await sleep(300);
  await jclick('#help [data-tab="access"]');
  await jclick("#s-exp");
  const exp = await page.inputValue("#s-json");
  let expOk = false; try { const o = JSON.parse(exp); expOk = o.v === 1 && o.cb === "deutan" && o.contrast === true; } catch { /* bad */ }
  check("Export writes the settings as versioned JSON", expOk, exp.slice(0, 60).replace(/\n/g, " "));
  await jclick("#s-reset");
  await sleep(200);
  check("Reset restores the defaults", (await page.evaluate(() => document.documentElement.dataset.cb)) === "off" && (await page.evaluate(() => document.documentElement.dataset.contrast)) === "normal");
  await page.fill("#s-json", exp);
  await jclick("#s-imp");
  await sleep(200);
  check("Import restores the exported settings", (await page.evaluate(() => document.documentElement.dataset.cb)) === "deutan" && (await page.textContent("#s-msg")) === "Settings imported.");
  await page.fill("#s-json", "{nope");
  await jclick("#s-imp");
  check("Import rejects bad text without changing anything", /not valid/.test(await page.textContent("#s-msg")) && (await page.evaluate(() => document.documentElement.dataset.cb)) === "deutan");
  await jclick("#s-reset");
  await page.keyboard.press("Escape");
  await sleep(200);

  // chat tabs
  await page.evaluate(() => {
    window.__jz.inject({ t: "ev", e: { k: "chat", from: "Mei", text: "Hello valley", sys: false } });
    window.__jz.inject({ t: "ev", e: { k: "chat", from: "System", text: "The lanterns flicker.", sys: true } });
  });
  await sleep(250);
  const vis = (tab) => page.evaluate((t) => { document.querySelector(`#chattabs [data-ct="${t}"]`).click(); const l = [...document.querySelectorAll("#chatlog .ln")].filter((e) => e.offsetParent !== null); return { n: l.length, sys: l.filter((e) => e.classList.contains("sys")).length }; }, tab);
  const vAll = await vis("all"), vChat = await vis("chat"), vSys = await vis("sys");
  check("chat tabs filter: All shows both, Chat hides system lines, System shows only them", vAll.sys > 0 && vAll.n > vAll.sys && vChat.sys === 0 && vChat.n >= 1 && vSys.n === vSys.sys && vSys.n >= 1, JSON.stringify({ vAll, vChat, vSys }));
  await vis("chat");
  await page.evaluate(() => window.__jz.inject({ t: "ev", e: { k: "chat", from: "System", text: "A bell tolls.", sys: true } }));
  await sleep(150);
  check("an unseen system line lights the System tab dot while on another tab", await page.evaluate(() => !document.querySelector('#chattabs [data-ct="sys"] .ud').hidden));
  await vis("sys");
  check("opening the tab clears its dot", await page.evaluate(() => document.querySelector('#chattabs [data-ct="sys"] .ud').hidden));
  await page.evaluate(() => { document.querySelector('#chattabs [data-ct="all"]').click(); });
  await page.keyboard.press("F1"); await sleep(250);
  await jclick('#help [data-tab="display"]');
  await jcheck("#s-stamps");
  await page.evaluate(() => { const e = document.getElementById("s-chatsize"); e.value = "15"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await sleep(200);
  check("chat timestamps and chat text size options apply", await page.evaluate(() => { const t = document.querySelector("#chatlog .ln"); return getComputedStyle(t, "::before").content.length > 3 && getComputedStyle(document.getElementById("chatlog")).fontSize === "15px"; }));
  // floating numbers: heals on myself, toggled off and on
  const healCount = async (amount) => { await page.evaluate((a) => { const me = window.__jz.state.myId; window.__jz.inject({ t: "ev", e: { k: "heal", src: me, dst: me, amount: a, skill: 2 } }); }, amount); await sleep(200); return page.locator(".fl.heal").count(); };
  const h0 = await healCount(7);
  await jcheck("#s-d-heal", false);
  const h1 = await healCount(8);
  await jcheck("#s-d-heal", true);
  const h2 = await healCount(9);
  check("floating-number toggles: healing numbers can be switched off and on", h0 >= 1 && h1 === h0 && h2 > h1, `${h0} ${h1} ${h2}`);
  await jclick("#s-reset");
  await page.keyboard.press("Escape");
  await sleep(200);

  // bag tools
  await page.evaluate(() => window.__jz.inject({ t: "inv", items: [{ item: "Healing Tonic", itemZh: "", qty: 2 }, { item: "Fox Tail", itemZh: "", qty: 3 }, { item: "Jade Scale", itemZh: "", qty: 1 }, { item: "Bamboo Fiber", itemZh: "", qty: 9 }, { item: "Cloudmist Pendant", itemZh: "", qty: 1 }] }));
  await page.keyboard.press("i");
  await sleep(350);
  const bagView = () => page.evaluate(() => [...document.querySelectorAll("#bag .bi")].map((e) => e.dataset.item));
  const allRows = await bagView();
  await page.fill("#bag .bsearch", "fox");
  const foxRows = await bagView();
  await page.fill("#bag .bsearch", "");
  await jclick('#bag [data-sort="qty"]');
  const byQty = await bagView();
  await jclick('#bag [data-sort="name"]');
  const byName = await bagView();
  await jclick('#bag [data-filter="Consumable"]');
  const remedies = await bagView();
  await jclick('#bag [data-filter="all"]');
  await jclick('#bag [data-sort="rarity"]');
  const byRar = await bagView();
  check("bag search narrows the list", allRows.length >= 5 && foxRows.length === 1 && foxRows[0] === "Fox Tail", JSON.stringify(foxRows));
  check("bag sorts by amount, name and rarity", byQty[0] === "Bamboo Fiber" && byName.join() === [...byName].sort((a, b) => a.localeCompare(b)).join() && byRar[0] === "Cloudmist Pendant", `${byQty[0]} / ${byName[0]} / ${byRar[0]}`);
  check("bag filter chips show only remedies", remedies.length === 1 && remedies[0] === "Healing Tonic", JSON.stringify(remedies));
  await jclick('#bag [data-sort="recent"]');
  await jhover('#bag .bi[data-item="Cloudmist Pendant"]');
  await sleep(250);
  const itip = await page.evaluate(() => { const t = document.getElementById("itip"); return { shown: getComputedStyle(t).display !== "none", text: t.innerText }; });
  check("hovering an item shows a tooltip with rarity and type", itip.shown && /Epic/.test(itip.text) && /Charm/.test(itip.text) && /Cloudmist Pendant/.test(itip.text), JSON.stringify(itip.text.replace(/\n/g, " | ")));
  await SHOT3("bag_tooltip");
  await page.mouse.move(5, 5);
  await page.focus('#bag .bi[data-item="Fox Tail"]');
  await sleep(200);
  check("keyboard focus shows the same item tooltip", await page.evaluate(() => /Fox Tail/.test(document.getElementById("itip").innerText) && document.getElementById("itip").classList.contains("show")));
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("i");
  await sleep(250);

  // world map
  const exp0 = await page.evaluate(() => document.querySelector("#wmap .wmp").textContent);
  await page.keyboard.press("n");
  await sleep(500);
  const wm = await page.evaluate(() => { const w = document.getElementById("wmap"), c = w.querySelector("canvas"); return { shown: w.classList.contains("show"), w: c.width, pct: w.querySelector(".wmp").textContent, legend: w.querySelector(".wml").innerText }; });
  check("N opens the world map with a legend and an explored percentage", wm.shown && wm.w >= 240 && /\d+% explored/.test(wm.pct) && /Boss/.test(wm.legend) && /Serpent/.test(wm.legend), JSON.stringify(wm));
  check("walking has revealed part of the valley (fog of war)", parseInt(wm.pct, 10) >= 1, wm.pct);
  await SHOT3("world_map");
  await page.keyboard.press("Escape");
  await sleep(250);
  check("Esc closes the map", !(await page.evaluate(() => document.getElementById("wmap").classList.contains("show"))));
  await jclick("#minimap");
  await sleep(300);
  check("clicking the minimap opens the map and N closes it", (await page.evaluate(() => document.getElementById("wmap").classList.contains("show"))) && (await page.keyboard.press("n"), await sleep(250), !(await page.evaluate(() => document.getElementById("wmap").classList.contains("show")))));
  void exp0;

  // action bar polish: press feedback, keyboard focus, live cooldown in the tooltip
  await page.keyboard.down("Digit2");
  await sleep(120);
  const pressed = await page.evaluate(() => document.querySelectorAll("#hotbar .slot")[1].classList.contains("press"));
  await page.keyboard.up("Digit2");
  await sleep(120);
  check("hotbar slot depresses while its key is held and releases after", pressed && !(await page.evaluate(() => document.querySelectorAll("#hotbar .slot")[1].classList.contains("press"))));
  check("hotbar slots are keyboard-focusable buttons with descriptive labels", await page.evaluate(() => { const s = document.querySelectorAll("#hotbar .slot")[0]; return s.tabIndex === 0 && s.getAttribute("role") === "button" && /key 1/.test(s.getAttribute("aria-label")); }));
  await page.evaluate(() => document.querySelectorAll("#hotbar .slot")[2].dispatchEvent(new PointerEvent("pointerenter")));
  await sleep(150);
  check("skill tooltip shows a live cooldown line and a Qi glossary entry", await page.evaluate(() => { const t = document.getElementById("tip"); return /Ready|cooldown/i.test(t.querySelector(".tcd")?.textContent || "") && /Jade energy/.test(t.innerText); }));
  await page.evaluate(() => document.querySelectorAll("#hotbar .slot")[2].dispatchEvent(new PointerEvent("pointerleave")));
  check("chat and loot regions announce to screen readers", await page.evaluate(() => document.getElementById("chatlog").getAttribute("aria-live") === "polite" && document.getElementById("loot").getAttribute("role") === "status" && document.getElementById("warn").getAttribute("role") === "alert"));
  await SHOT3("hud_overview");
  R = await rects();
  check("1280x720 with chat tabs: no HUD overlap", overlaps(R).length === 0, overlaps(R).join(","));

  // ---- 5. 20 Hz input under slow frames
  const clk = () => retry(() => page.evaluate(() => ({ n: window.__jz.state.inputsSent, t: performance.now(), p: window.__jz.state.pos })));
  const before = await clk();
  await page.keyboard.down("w");
  await sleep(4000);
  const after = await clk();
  await page.keyboard.up("w");
  const mid = await st();
  const rate = (after.n - before.n) / ((after.t - before.t) / 1000); // page clock: immune to a starved test host
  const moved = Math.hypot(after.p.x - before.p.x, after.p.z - before.p.z), expectSteps = moved / 0.3, sent = after.n - before.n;
  // On a starved host (swiftshader + other agents) frames can be seconds apart, so compare against the distance actually simulated:
  // every 1/20 s predictor step (0.3 u) must have produced exactly one input message, i.e. a true 20 Hz stream while moving.
  check("every simulated 50 ms step is sent (20 Hz stream)", moved > 1 && Math.abs(sent - expectSteps) / expectSteps < 0.3, `sent=${sent} expected~${expectSteps.toFixed(0)}; page rate ${rate.toFixed(1)} Hz at ${mid.fps} fps`);

  // ---- 6. far mode -> "Walk closer"
  // "Walk closer" is the dialog's far mode: it opens when the NPC F targets is beyond TALK_RANGE (14) and stays open
  // until TALK_RANGE+8 (22); F only targets an NPC within 40 units. The old keyboard walk-away sampled stale positions
  // (this host's software-GL frames stall for seconds) and could overshoot the 40-unit talk radius, in which case F did
  // nothing and the previous dialog's text stayed in the DOM. Position deterministically with the TEST_MODE teleport
  // (already used elsewhere in this suite) and wait for settled state before pressing F.
  const npcDistance = (q) => Math.min(...q.ents.filter((e) => e.k === "npc").map((e) => Math.hypot(e.x - q.pos.x, e.z - q.pos.z)));
  const farSpot = async () => {
    const q = await st();
    const npcs = q.ents.filter((e) => e.k === "npc");
    // Elder Lin (and Keeper Fen) use the paper dialog; the other four NPCs open their own content windows instead.
    const anchor = npcs.find((e) => /Elder Lin/i.test(e.n)) ?? npcs.find((e) => /Fen/i.test(e.n));
    if (!anchor) return null;
    const others = npcs.filter((e) => e !== anchor);
    let best = null;
    for (let r = 16; r <= 20; r += 0.5) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = anchor.x + Math.cos(a) * r, z = anchor.z + Math.sin(a) * r;
      if (Math.abs(x) > 95 || Math.abs(z) > 95) continue;
      const d = Math.hypot(anchor.x - x, anchor.z - z);
      const otherMin = Math.min(...others.map((e) => Math.hypot(e.x - x, e.z - z)));
      const margin = otherMin - d; // F targets the nearest NPC: the anchor must win
      if (otherMin > d + 1.5 && (!best || margin > best.margin)) best = { x: +x.toFixed(1), z: +z.toFixed(1), margin };
    }
    return best;
  };
  let farD = 0, farOk = false;
  const spot = await farSpot();
  if (spot) {
    await say(`/testtp ${spot.x} ${spot.z}`);
    let prev = null;
    for (let i = 0; i < 120; i++) { // wait for the teleport snapshot and for the player to stand still
      const q = await st();
      farD = npcDistance(q);
      if (q.hp > 0 && prev && Math.abs(q.pos.x - prev.x) < 0.05 && Math.abs(q.pos.z - prev.z) < 0.05 && farD > 14 && farD <= 21.5) { farOk = true; break; }
      prev = q.pos;
      await sleep(250);
    }
  }
  if (!farOk) {
    check("out of range shows 'Walk closer' (could not position out of talk range)", false, `d=${farD.toFixed(1)} spot=${JSON.stringify(spot)}`);
  } else {
    // F must not merely close an already-open window: close anything left open first
    for (let i = 0; i < 4; i++) { const q = await st(); if (!q.dialog.open && !q.content?.npcOpen) break; await page.keyboard.press("Escape"); await sleep(200); }
    await page.keyboard.press("f");
    const shownFar = await page.waitForFunction(() => {
      const d = document.getElementById("dialog");
      const t = d?.innerText ?? "";
      return d?.classList.contains("show") && /Walk closer/i.test(t) && /units away/.test(t);
    }, null, { timeout: 30000, polling: 200 }).then(() => true, () => false);
    const far = await page.evaluate(() => document.getElementById("dialog").innerText);
    check("out of range shows 'Walk closer' with distance", shownFar && /Walk closer/i.test(far) && /units away/.test(far), JSON.stringify(far.replace(/\n/g, " ").slice(0, 90)) + ` d=${farD.toFixed(1)}`);
    await shot("walk_closer");
    await page.keyboard.press("Escape");
  }

  // ---- 7. 1920x1080 layout
  await page.setViewportSize({ width: 1920, height: 1080 });
  await sleep(1500);
  R = await rects();
  check("1920x1080 HUD: no overlap", overlaps(R).length === 0, overlaps(R).join(","));
  check("1920x1080 HUD: nothing off-screen", offscreen(R, 1920, 1080).length === 0);
  await shot("hud_1920x1080");
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(1000);

  // ---- 8. reconnect after the server dies and returns
  const oldId = (await st()).myId;
  outage = true;
  killGroup(server, "SIGKILL");
  await page.waitForFunction(() => document.getElementById("conn")?.classList.contains("show"), null, { timeout: 60000 });
  await sleep(1500);
  const overlayText = await page.evaluate(() => document.getElementById("conn").innerText);
  check("reconnect overlay shown", /Connection lost/i.test(overlayText) && /econnect/i.test(overlayText), JSON.stringify(overlayText.replace(/\n/g, " ").slice(0, 100)));
  await shot("reconnect_overlay");
  await sleep(2500);
  server = startServer();
  await waitHttp(`http://localhost:${SERVER_PORT}/health`);
  await page.waitForFunction(() => window.__jz.state.ready && !document.getElementById("conn").classList.contains("show"), null, { timeout: 60000 });
  outage = false;
  s = await st();
  check("auto-reconnect restored the session", s.ready, `id ${oldId} -> ${s.myId}`);
  await sleep(2500);
  s = await st();
  check("no stale entities after reconnect (count sane, single self)", s.ents.filter((e) => e.id === s.myId).length === 1 && s.entityCount < 120, `ents=${s.entityCount}`);
  for (let i = 0; i < 40 && s.quest.status !== "active"; i++) { await sleep(500); s = await st(); }
  check("quest state restored from server after reconnect", s.quest.status === "active", JSON.stringify(s.quest));
  check("disconnect logged with close code/reason", infos.some((t) => /\[net\] socket closed: code=\d+ reason=/.test(t)), infos.find((t) => /socket closed/.test(t)) || "");
  await shot("reconnected");

  // ---- 9. fail path: server gone for good -> back to login
  outage = true;
  killGroup(server, "SIGKILL");
  await page.waitForFunction(() => document.getElementById("conn")?.classList.contains("show"), null, { timeout: 60000 });
  await page.evaluate(() => document.getElementById("connbtn").click());
  await page.waitForFunction(() => window.__jz.screen === "login", null, { timeout: 10000 });
  check("'Back to login' returns to the login screen", true);
  await shot("login_after_loss");

  const bad = errors.filter((e) => !/favicon/i.test(e));
  check("zero console errors (outside the planned outage)", bad.length === 0, bad.slice(0, 3).join(" || "));
  console.log(`(planned-outage console errors ignored: ${outageErrors.length})`);
} catch (e) {
  check("test run completed without exception", false, String(e && e.stack || e));
  console.log("  [net infos]", infos.filter((t) => /\[net\]/.test(t)).slice(-12).join("\n   "));
  console.log("  [server log tail]", (server.log || "").slice(-600));
} finally {
  if (process.env.VITE_LOG) console.log(vite.log.slice(-1500));
  if (browser) await browser.close().catch(() => {});
  await stopAll();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
