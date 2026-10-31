#!/usr/bin/env node
// End-to-end site test. Starts serve-dist.mjs on 8807 (own PID only), then with Playwright chromium checks, per page and at 1280 and 400 px:
// no console errors / failed requests (except the deliberately unreachable remote APIs), no horizontal scroll, English-only text, CSP headers, a11y basics;
// exercises status/download/news in offline and mocked-online states; and writes screenshots to docs/shots/site_*.png.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.resolve(ROOT, "..", "docs", "shots");
// Playwright is not a dependency of the site. Borrow an installed copy (the client suite installs one) so this test
// also runs on Windows, not only on the Linux image that used to hardcode /opt/npm-tools.
function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_DIR,
    path.join(ROOT, "node_modules"),
    path.join(ROOT, "..", "client", "node_modules"),
    path.join(ROOT, "..", "node_modules"),
    "/opt/npm-tools/node_modules",
  ].filter(Boolean);
  for (const base of candidates) {
    try { return createRequire(path.join(String(base), "noop.js"))("playwright"); } catch { /* try the next location */ }
  }
  console.error("playwright is not installed. Install it once with:\n  npm --prefix client install --no-save --no-package-lock playwright");
  process.exit(2);
}
const { chromium } = loadPlaywright();
const PORT = 8807, ORIGIN = `http://127.0.0.1:${PORT}`;
const PAGES = ["/", "/download", "/world", "/classes", "/news", "/changelog", "/roadmap", "/status", "/press", "/support", "/terms", "/privacy", "/eula", "/nope"];
const CJK = /[⺀-鿿가-힯豈-﫿＀-￯　-〿]/;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  FAIL " + m); } return c; };

const srv = spawn(process.execPath, [path.join(ROOT, "scripts", "serve-dist.mjs"), String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => { srv.stdout.once("data", res); srv.once("exit", rej); setTimeout(() => rej(new Error("server start timeout")), 8000); });
const stop = () => { try { srv.kill("SIGTERM"); } catch {} };
process.on("exit", stop);

// 1. static English check on dist
for (const f of fs.readdirSync(path.join(ROOT, "dist"), { recursive: true })) {
  const p = path.join(ROOT, "dist", f);
  if (!fs.statSync(p).isFile() || !/\.(html|css|js|json|svg|xml|txt|webmanifest)$/.test(f)) continue;
  ok(!CJK.test(fs.readFileSync(p, "utf8")), "CJK character in dist/" + f);
}
const src = ["src", "build.mjs", "config.json"];
for (const s of src) for (const f of fs.statSync(path.join(ROOT, s)).isDirectory() ? fs.readdirSync(path.join(ROOT, s), { recursive: true }) : [""]) {
  const p = path.join(ROOT, s, f); if (!fs.statSync(p).isFile() || /\.(woff2|webp|png|jpg)$/.test(f)) continue;
  ok(!CJK.test(fs.readFileSync(p, "utf8")), "CJK character in " + path.join(s, f));
}
console.log("English-only source/dist scan done");

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const CORS = { "access-control-allow-origin": "*" };

async function visit(name, ctxOpts, mock) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() !== "error") return; const t = m.text(); if (!mock && /ERR_CONNECTION_REFUSED/.test(t)) return; /* deliberately unreachable remote APIs */ if (/404 \(Not Found\)/.test(t) && page.url().endsWith("/nope")) return; errors.push(t); });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message));
  page.on("requestfailed", (r) => { if (!/swordandseal\.com/.test(r.url()) || r.url().startsWith(ORIGIN)) errors.push("requestfailed " + r.url()); });
  await page.route(/https:\/\/(dl|play)\.swordandseal\.com\//, (route) => {
    const u = route.request().url();
    if (!mock) return route.abort("connectionrefused");
    if (u.endsWith("/health")) return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ ok: true, players: 7, version: "0.3.0" }) });
    if (u.endsWith("latest.json")) return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ version: "1.0.0", releasedAt: "2026-11-01T10:00:00Z", files: { win: { url: "https://dl.swordandseal.com/launcher/1.0.0/SwordAndSeal-Launcher-Setup-1.0.0.exe", size: 85983232, sha256: "a".repeat(64) }, mac: { url: "https://dl.swordandseal.com/launcher/1.0.0/x.dmg", size: 99000000, sha256: "b".repeat(64) }, linux: { url: "https://dl.swordandseal.com/launcher/1.0.0/x.AppImage", size: 91000000, sha256: "c".repeat(64) } } }) });
    if (u.endsWith("news.json")) return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify([{ id: "a", title: "Mock news <b>", date: "2026-11-02", body: "First paragraph.\n\n- bullet one\n- bullet two" }]) });
    return route.abort();
  });
  return { ctx, page, errors };
}

const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const phone = { viewport: { width: 400, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36" };

for (const [label, opts] of [["desktop", desktop], ["phone", phone]]) {
  console.log(`== ${label} (${opts.viewport.width}px), offline APIs`);
  for (const p of PAGES) {
    const { ctx, page, errors } = await visit(label + p, opts, false);
    const resp = await page.goto(ORIGIN + p, { waitUntil: "networkidle" });
    const want = p === "/nope" ? 404 : 200;
    ok(resp.status() === want, `${p} status ${resp.status()} (want ${want})`);
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      text: document.body.innerText, title: document.title,
      h1: document.querySelectorAll("h1").length, main: document.querySelectorAll("main").length,
      imgsNoAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).length,
      broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
      desc: !!document.querySelector('meta[name=description]'), canon: !!document.querySelector('link[rel=canonical]'),
      og: !!document.querySelector('meta[property="og:image"]'), tw: !!document.querySelector('meta[name="twitter:card"]'),
      status: document.querySelector("[data-status]")?.getAttribute("data-state"),
      ls: document.documentElement.lang,
    }));
    ok(info.sw <= info.cw, `${p}: horizontal scroll (${info.sw} > ${info.cw})`);
    ok(!CJK.test(info.text), `${p}: CJK in rendered text`);
    ok(info.h1 === 1, `${p}: h1 count ${info.h1}`);
    ok(info.main === 1 && info.ls === "en", `${p}: landmarks/lang`);
    ok(info.imgsNoAlt === 0, `${p}: images without alt`);
    ok(info.broken.length === 0, `${p}: broken images ${info.broken}`);
    ok(info.desc && info.og && info.tw && (info.canon || p === "/nope"), `${p}: SEO meta missing`);
    ok(info.status === "offline", `${p}: status badge should be offline when API unreachable (got ${info.status})`);
    ok(errors.length === 0, `${p}: console errors ${JSON.stringify(errors)}`);
    const h = resp.headers();
    ok(/script-src 'self'/.test(h["content-security-policy"] || "") && h["x-content-type-options"] === "nosniff" && h["strict-transport-security"], `${p}: security headers`);
    const name = { "/": "index", "/download": "download", "/world": "world", "/classes": "classes" }[p];
    if (name) await page.evaluate(async () => { const imgs = [...document.images]; imgs.forEach((i) => { i.loading = "eager"; }); await Promise.all(imgs.map((i) => i.decode().catch(() => {}))); window.scrollTo(0, 0); });
    if (name) await page.screenshot({ path: path.join(SHOTS, `site_${name}_${label}.png`), fullPage: true });
    if (name === "/".length && false) {}
    if (p === "/") await page.screenshot({ path: path.join(SHOTS, `site_hero_${label}.png`) });
    await ctx.close();
  }
}

console.log("== download page: offline fallback + mocked release");
{
  const { ctx, page, errors } = await visit("dl-off", desktop, false);
  await page.goto(ORIGIN + "/download", { waitUntil: "networkidle" });
  ok((await page.textContent("#release-version")).includes("coming soon"), "offline: 'coming soon' state missing");
  ok(await page.$eval('[data-dl="win"]', (a) => a.getAttribute("aria-disabled") === "true"), "offline: win button should be disabled");
  await ctx.close();
  const m = await visit("dl-on", { ...desktop, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" }, true);
  await m.page.goto(ORIGIN + "/download", { waitUntil: "networkidle" });
  ok((await m.page.textContent("#release-version")).includes("1.0.0"), "mock: version not shown");
  ok(await m.page.$eval('[data-os="win"]', (e) => e.classList.contains("is-match")), "mock: Windows card should be highlighted for a Windows UA");
  ok((await m.page.textContent('[data-meta="win-size"]')).includes("MB"), "mock: size missing");
  ok((await m.page.textContent('[data-meta="win-sha"]')).startsWith("aaaa"), "mock: sha missing");
  ok((await m.page.getAttribute('[data-dl="win"]', "href")).endsWith("Setup-1.0.0.exe"), "mock: href from latest.json");
  ok((await m.page.textContent("[data-status-text]")).includes("7 players"), "mock: status badge players");
  await m.page.screenshot({ path: path.join(SHOTS, "site_download_desktop_release.png"), fullPage: false });
  ok(m.errors.length === 0, "mock download console errors " + JSON.stringify(m.errors));
  await m.ctx.close();
  const mac = await visit("dl-mac", { ...desktop, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36" }, true);
  await mac.page.goto(ORIGIN + "/download", { waitUntil: "networkidle" });
  ok(await mac.page.$eval('[data-os="mac"]', (e) => e.classList.contains("is-match")), "mac UA should highlight macOS");
  await mac.ctx.close();
  const lin = await visit("dl-lin", { ...desktop, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36" }, true);
  await lin.page.goto(ORIGIN + "/download", { waitUntil: "networkidle" });
  ok(await lin.page.$eval('[data-os="linux"]', (e) => e.classList.contains("is-match")), "linux UA should highlight Linux");
  await lin.ctx.close();
}
console.log("== news page with mocked feed");
{
  const n = await visit("news", desktop, true);
  await n.page.goto(ORIGIN + "/news", { waitUntil: "networkidle" });
  const t = await n.page.textContent("#news-list");
  ok(t.includes("Mock news <b>") && !(await n.page.$("#news-list b")), "news: remote title rendered as text");
  ok((await n.page.$$("#news-list li")).length === 2, "news: bullets");
  await n.ctx.close();
}
console.log("== reduced motion / dark mode");
{
  const r = await visit("rm", { ...desktop, reducedMotion: "reduce", colorScheme: "dark" }, false);
  await r.page.goto(ORIGIN + "/", { waitUntil: "networkidle" });
  const an = await r.page.$eval(".mist", (e) => getComputedStyle(e).animationName);
  ok(an === "none", "reduced motion: mist animation should be none, got " + an);
  const bg = await r.page.$eval("body", (e) => getComputedStyle(e).backgroundColor);
  ok(bg === "rgb(26, 26, 31)", "dark mode background " + bg);
  await r.page.screenshot({ path: path.join(SHOTS, "site_hero_dark.png") });
  await r.page.goto(ORIGIN + "/world", { waitUntil: "networkidle" });
  await r.page.screenshot({ path: path.join(SHOTS, "site_world_dark.png"), fullPage: true });
  ok(r.errors.length === 0, "dark/rm console errors " + JSON.stringify(r.errors));
  await r.ctx.close();
}
console.log("== mobile nav");
{
  const m = await visit("nav", phone, false);
  await m.page.goto(ORIGIN + "/", { waitUntil: "networkidle" });
  ok(!(await m.page.isVisible("#site-nav")), "nav hidden before toggle on phone");
  await m.page.click(".nav-toggle");
  ok(await m.page.isVisible("#site-nav"), "nav visible after toggle");
  await m.page.screenshot({ path: path.join(SHOTS, "site_nav_phone.png") });
  await m.ctx.close();
}
await browser.close();
stop();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll site tests passed");
process.exit(fails ? 1 : 0);
