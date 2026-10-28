// Launcher handoff test (docs/LAUNCHER.md section 4). Real server bundle + real scripts/play.mjs (--launcher-session) + built client.
//   node scripts/launcher-handoff.mjs      (ports JZ_SERVER_PORT / JZ_CLIENT_PORT, default 8821 / 8831; builds nothing: needs server/dist/server.mjs and client/dist)
// Proves: the session file is deleted at once; the token logs in exactly once; a second use fails; the token is never in the URL, storage,
// cookies or console output; launcher mode hides the password and server fields (never a password prompt); the class picker shows only for
// a new character; a rejected token shows the server error + "Close and sign in again from the launcher."; a dropped connection shows
// "Connection lost. Please restart from the launcher." without any reconnect attempt; the Electron preload bridge contract (simulated) and
// the pure session-file reader (electron/launcher-session.cjs) behave. Screenshots -> docs/shots/launcher_handoff_*.png
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { chromium } = req("/opt/npm-tools/node_modules/playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const WebSocket = createRequire(path.join(ROOT, "server", "package.json"))("ws");
const { consumeSessionFile, sessionPathFromArgv } = req("../electron/launcher-session.cjs");
const SP = Number(process.env.JZ_SERVER_PORT) || 8821, WP = Number(process.env.JZ_CLIENT_PORT) || 8831;
const SHOTS = path.join(ROOT, "docs/shots");
mkdirSync(SHOTS, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), "jz-launcher-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
const procs = [];
const run = (cmd, args, env = {}, cwd = ROOT) => {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.log = ""; p.stdout.on("data", (d) => (p.log += d)); p.stderr.on("data", (d) => (p.log += d));
  procs.push(p); return p;
};
async function waitHttp(u, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(u); if (r.status < 500) return; } catch { /* retry */ } await sleep(250); } throw new Error("timeout " + u); }
async function api(kind, name, pw) {
  const r = await fetch(`http://127.0.0.1:${SP}/api/auth/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, pw }) });
  return r.json();
}
/** Raw protocol login with a token; resolves "welcome" or the error text. */
function wsLogin(name, tok) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${SP}`);
    const t = setTimeout(() => { ws.close(); res("timeout"); }, 6000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "login", name, cls: "sword", v: 3, tok })));
    ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.t === "welcome" || m.t === "error") { clearTimeout(t); ws.close(); res(m.t === "welcome" ? "welcome" : m.msg); } });
  });
}
/** Log in a second account by password and report the class other players see for `target`. */
function observeCls(target) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${SP}`);
    const t = setTimeout(() => { ws.close(); res("timeout"); }, 8000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "login", name: "Observer", cls: "sword", v: 3, pw: PW })));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === "snap") { const e = m.ents.find((x) => x.n === target); if (e) { clearTimeout(t); ws.close(); res(e.cls); } }
    });
  });
}
const sessionFile = (name, token, serverUrl = `ws://127.0.0.1:${SP}`, createdAt = new Date().toISOString()) => {
  const f = path.join(tmp, `sword-and-seal-session-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify({ name, token, serverUrl, createdAt }), { mode: 0o600 });
  return f;
};
const ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const PW = "launchpass1";

let browser;
try {
  // ---------- pure session-file reader (what Electron main uses)
  {
    const ok = sessionFile("Wanderer", "tokA");
    const r1 = consumeSessionFile(ok);
    check("electron reader: valid file accepted and DELETED immediately", r1.ok && r1.session.name === "Wanderer" && r1.session.token === "tokA" && !existsSync(ok));
    const old = sessionFile("Wanderer", "tokB", "ws://x:1", new Date(Date.now() - 121_000).toISOString());
    const r2 = consumeSessionFile(old);
    check("electron reader: older than 2 minutes rejected (file still deleted)", !r2.ok && /expired/i.test(r2.reason) && !existsSync(old));
    const bad = path.join(tmp, "bad.json"); writeFileSync(bad, "{not json");
    const r3 = consumeSessionFile(bad);
    check("electron reader: malformed JSON rejected and deleted", !r3.ok && !existsSync(bad));
    const miss = sessionFile("Wanderer", "", "ws://x:1");
    check("electron reader: missing token rejected", !consumeSessionFile(miss).ok);
    const badUrl = sessionFile("Wanderer", "t", "http://example.com");
    check("electron reader: non-ws serverUrl rejected", !consumeSessionFile(badUrl).ok);
    check("electron reader: missing file rejected, argv parsing", !consumeSessionFile(path.join(tmp, "nope.json")).ok && sessionPathFromArgv(["x", "--launcher-session=/a b/c.json"]) === "/a b/c.json" && sessionPathFromArgv(["x"]) === "");
  }

  // ---------- server + clients
  run(process.execPath, ["--no-warnings", path.join(ROOT, "server/dist/server.mjs")], { PORT: String(SP), TEST_MODE: "1", DB_PATH: path.join(tmp, "l.db") });
  await waitHttp(`http://127.0.0.1:${SP}/health`);
  browser = await chromium.launch({ args: ARGS });

  const watch = (page, sink) => {
    page.on("console", (m) => sink.push(m.text()));
    page.on("pageerror", (e) => sink.push("pageerror: " + e.message));
    page.on("request", (r) => sink.push("request: " + r.url()));
  };
  const leaks = async (page, secret) => page.evaluate((s) => {
    const dump = [location.href, document.referrer, document.cookie, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.documentElement.outerHTML].join("\n");
    return dump.includes(s);
  }, secret);

  // ===== A: play.mjs fallback, brand new character -> class picker only
  {
    const name = "Wanderer";
    check("api register", (await api("register", name, PW)).ok === true);
    const tok = (await api("login", name, PW)).token;
    const file = sessionFile(name, tok);
    const play = run(process.execPath, [path.join(ROOT, "scripts/play.mjs"), `--launcher-session=${file}`], { NO_OPEN: "1", WEB_PORT: String(WP), PORT: "1" });
    await waitHttp(`http://localhost:${WP}/`);
    check("play.mjs deleted the session file at once", !existsSync(file));
    check("play.mjs did not print the token and started no local server", !play.log.includes(tok) && /launcher session/.test(play.log) && !/Game server/.test(play.log) && !/ws:\/\/localhost:1\b/.test(play.log), play.log.replace(tok, "<tok>").trim().split("\n").slice(0, 3).join(" | "));
    const sink = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    watch(page, sink);
    await page.goto(`http://localhost:${WP}/?launcher=1&debug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#login.show #jz-go", { timeout: 60000 });
    await sleep(1200);
    const ui = await page.evaluate(() => {
      const vis = (sel) => { const e = document.querySelector(sel); return !!e && e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden"; };
      return { pw: vis("#jz-pw"), server: vis("#jz-server"), classes: vis(".classes"), go: vis("#jz-go"), nameRO: document.getElementById("jz-name").readOnly, name: document.getElementById("jz-name").value, goText: document.getElementById("jz-go").textContent, launcher: window.__jz.launcher, url: location.href };
    });
    check("launcher login: class picker only (no password, no server field, name locked)", ui.classes && ui.go && !ui.pw && !ui.server && ui.nameRO && ui.name === name && ui.launcher, JSON.stringify(ui));
    check("token is not in the page URL", !ui.url.includes(tok));
    await page.screenshot({ path: path.join(SHOTS, "launcher_handoff_picker.png") });
    await page.click('.cc[data-cls="talisman"]');
    await page.click("#jz-go");
    await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
    const st = await page.evaluate(() => window.__jz.state);
    const seenCls = await observeCls(name);
    check("token logged in once with the chosen class (talisman) and the game is running", st.connected && seenCls === "talisman", `cls=${seenCls}`);
    await sleep(4000);
    await page.screenshot({ path: path.join(SHOTS, "launcher_handoff_ingame.png"), timeout: 120000 });
    check("token absent from URL, storage, cookies, DOM", !(await leaks(page, tok)));
    check("token absent from console output and request URLs", !sink.some((l) => l.includes(tok)), `${sink.length} lines`);
    check("login screen hidden after auto-login, no password prompt appeared", await page.evaluate(() => !document.getElementById("login").classList.contains("show")));
    const again = await page.evaluate(async () => (await fetch("/__launcher/session")).status);
    check("play.mjs session endpoint is one-use (second fetch 404)", again === 404);
    check("after the game, a remembered character skips the picker next time", await page.evaluate(() => JSON.parse(localStorage.getItem("jz.known") || "[]").includes("wanderer")));
    check("no password key/value stored", !(await page.evaluate((pw) => JSON.stringify({ ...localStorage }).includes(pw), PW)));
    await ctx.close();
    play.kill("SIGTERM");
    await sleep(1500); // let the server release the name, otherwise "name in use" would mask the token check
    const r2 = await wsLogin(name, tok);
    check("same token a second time is refused by the server", /session expired/i.test(r2), r2);
  }

  // ===== B: query-param test path, existing character (known via ?cls) -> auto login; then connection loss
  {
    const name = "Wanderer";
    const tok = (await api("login", name, PW)).token;
    const sink = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    watch(page, sink);
    run(process.execPath, [path.join(ROOT, "scripts/play.mjs")], { NO_OPEN: "1", NO_SERVER: "1", WEB_PORT: String(WP + 1) });
    await waitHttp(`http://localhost:${WP + 1}/`);
    await page.goto(`http://localhost:${WP + 1}/?server=ws://127.0.0.1:${SP}&name=${name}&cls=sword&tok=${encodeURIComponent(tok)}&debug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
    const url = await page.evaluate(() => location.href);
    check("query path: auto login with tok, no picker", (await page.evaluate(() => window.__jz.state.connected)));
    check("query path: tok scrubbed from the address bar", !url.includes("tok=") && !url.includes(tok), url);
    check("query path: token not in storage/DOM/console", !(await leaks(page, tok)) && !sink.some((l) => l.includes(tok) && !l.startsWith("request: ")), "");
    await ctx.close();
    await sleep(1500);
    const r2 = await wsLogin(name, tok);
    check("query path: second use of the same token fails", /session expired/i.test(r2), r2);
  }
  { // connection loss in launcher mode
    const name = "Wanderer";
    const tok = (await api("login", name, PW)).token;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${WP + 1}/?server=ws://127.0.0.1:${SP}&name=${name}&cls=sword&tok=${encodeURIComponent(tok)}&debug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__jz?.state?.ready, null, { timeout: 180000 });
    // connection lost: stop the server
    procs[0].kill("SIGTERM");
    await page.waitForFunction(() => document.querySelector("#conn.show, .conn.show") || !window.__jz.state.connected, null, { timeout: 60000 });
    await sleep(2500);
    const lost = await page.evaluate(() => {
      const t = document.body.innerText;
      const btn = document.getElementById("connbtn");
      return { text: /Connection lost\. Please restart from the launcher\./.test(t), reconnecting: /Reconnecting/.test(t), btnShown: !!btn && getComputedStyle(btn).display !== "none" };
    });
    check("connection lost in launcher mode: asks to restart from the launcher, no reconnect, no button", lost.text && !lost.reconnecting && !lost.btnShown, JSON.stringify(lost));
    await page.screenshot({ path: path.join(SHOTS, "launcher_handoff_connection_lost.png"), timeout: 120000 });
    await ctx.close();
    // restart the server for the remaining cases
    run(process.execPath, ["--no-warnings", path.join(ROOT, "server/dist/server.mjs")], { PORT: String(SP), TEST_MODE: "1", DB_PATH: path.join(tmp, "l.db") });
    await waitHttp(`http://127.0.0.1:${SP}/health`);
  }

  // ===== C: simulated Electron preload bridge + rejected (used) token
  {
    const name = "Wanderer";
    const used = (await api("login", name, PW)).token;
    check("setup: token consumed once on the wire", (await wsLogin(name, used)) === "welcome");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const sink = [];
    watch(page, sink);
    // same contract as client/electron/preload.cjs: info() has no secret, takeToken() answers once
    await page.addInitScript(({ name, serverUrl, tok }) => {
      let t = tok;
      window.jzLauncher = Object.freeze({ info: async () => ({ name, serverUrl }), takeToken: async () => { const x = t; t = null; return x; } });
    }, { name, serverUrl: `ws://127.0.0.1:${SP}`, tok: used });
    const staticSrv = run(process.execPath, [path.join(ROOT, "scripts/play.mjs")], { NO_OPEN: "1", NO_SERVER: "1", WEB_PORT: String(WP + 2) });
    await waitHttp(`http://localhost:${WP + 2}/`);
    await page.goto(`http://localhost:${WP + 2}/?cls=sword&debug=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#login .err .fatal"), null, { timeout: 60000 });
    await sleep(500);
    const dead = await page.evaluate(() => {
      const vis = (sel) => { const e = document.querySelector(sel); return !!e && e.offsetParent !== null; };
      return { err: document.getElementById("jz-err").innerText, pw: vis("#jz-pw"), go: vis("#jz-go"), classes: vis(".classes") };
    });
    check("rejected token: server error + 'Close and sign in again from the launcher.', no password prompt, no retry button", /Session expired/i.test(dead.err) && /Close and sign in again from the launcher\./.test(dead.err) && !dead.pw && !dead.go, JSON.stringify(dead));
    await page.screenshot({ path: path.join(SHOTS, "launcher_handoff_rejected.png") });
    check("rejected token not leaked", !(await leaks(page, used)) && !sink.some((l) => l.includes(used)));
    await ctx.close();
    staticSrv.kill("SIGTERM");
  }

  // ===== D: play.mjs with an expired session file -> ignored, normal login screen
  {
    const file = sessionFile("Wanderer", "zzz", `ws://127.0.0.1:${SP}`, new Date(Date.now() - 300_000).toISOString());
    const play = run(process.execPath, [path.join(ROOT, "scripts/play.mjs"), `--launcher-session=${file}`], { NO_OPEN: "1", WEB_PORT: String(WP + 3), PORT: String(SP + 100), DB_PATH: path.join(tmp, "p.db") });
    await waitHttp(`http://localhost:${WP + 3}/`);
    check("play.mjs: expired session file is deleted and ignored", !existsSync(file) && /ignored \(expired\)/.test(play.log));
    const r = await fetch(`http://localhost:${WP + 3}/__launcher/session`);
    check("play.mjs: no session is served after rejection", r.status === 404);
    play.kill("SIGTERM");
  }
} catch (e) {
  console.log("FAIL  launcher test aborted: " + (e?.stack || e));
  results.push(false);
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  for (const p of procs) { try { p.kill("SIGTERM"); } catch { /* gone */ } }
  await sleep(500);
  rmSync(tmp, { recursive: true, force: true });
}
const fails = results.filter((x) => !x).length;
console.log(fails ? `FAIL (${fails} of ${results.length} checks failed)` : `PASS (${results.length} checks)`);
process.exit(fails ? 1 : 0);
