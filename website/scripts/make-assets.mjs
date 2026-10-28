#!/usr/bin/env node
// One-off asset generator: PNG favicons from favicon.svg (sharp) and the 1200x630 social card (Playwright, using the bundled fonts + a real screenshot).
// Run: node website/scripts/make-assets.mjs   (outputs are committed in website/src/static)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire("/opt/npm-tools/node_modules/");
const sharp = require("sharp");
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = path.join(ROOT, "src");
const svg = fs.readFileSync(path.join(S, "static/favicon.svg"));
for (const [name, size] of [["favicon-32.png", 32], ["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(S, "static", name));
}
const shot = pathToFileURL(path.join(ROOT, "..", "docs/shots/rename_gate.png")).href;
const font = (f) => pathToFileURL(path.join(S, "fonts", f)).href;
const html = `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:MSZ;src:url(${font("ma-shan-zheng-latin-400-normal.woff2")})}
@font-face{font-family:NS;font-weight:600;src:url(${font("noto-serif-latin-600-normal.woff2")})}
@font-face{font-family:NS;font-weight:400;src:url(${font("noto-serif-latin-400-normal.woff2")})}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;position:relative;overflow:hidden;background:#1a1a1f;font-family:NS,serif;color:#f2ead8}
.bg{position:absolute;inset:0;background:url(${shot}) 62% 40%/cover;filter:saturate(.95)}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(26,26,31,.97) 0,rgba(26,26,31,.9) 42%,rgba(26,26,31,.35) 75%,rgba(26,26,31,.05) 100%),linear-gradient(0deg,rgba(26,26,31,.65),transparent 35%)}
.frame{position:absolute;inset:18px;border:2px solid rgba(242,234,216,.55);pointer-events:none}
.copy{position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;width:640px}
.seal{width:74px;height:74px;background:#b92f26;border-radius:8px;transform:rotate(-5deg);display:grid;place-items:center;margin-bottom:26px;box-shadow:0 6px 18px rgba(0,0,0,.5)}
.seal svg{width:56px;height:56px}
.kicker{letter-spacing:.5em;text-transform:uppercase;font-weight:600;font-size:20px;color:#e9a39b;margin-bottom:6px}
h1{font:400 128px/0.95 MSZ,cursive;margin:0 0 20px -4px}
h1 i{font-style:normal;color:#ef8277;font-size:.8em}
p{font-size:30px;line-height:1.4;color:#d9d1bd;max-width:560px}
.url{position:absolute;left:72px;bottom:46px;font-size:22px;letter-spacing:.12em;color:#c9a227;font-weight:600}
</style><body><div class=bg></div><div class=shade></div><div class=frame></div>
<div class=copy><div class=seal><svg viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="3" fill="none" stroke="#f2ead8" stroke-width="2.5"/><path d="M33 11 36 14 34.5 38h-3L30 14z" fill="#f2ead8"/><rect x="24" y="38" width="16" height="3.4" rx="1.2" fill="#f2ead8"/><rect x="30.6" y="41" width="2.8" height="8" fill="#f2ead8"/><circle cx="32" cy="52" r="3" fill="none" stroke="#f2ead8" stroke-width="2.2"/></svg></div>
<div class=kicker>Realm of Mist</div><h1>Sword <i>&amp;</i> Seal</h1><p>An ink-wash xianxia online world. Three classes, one misty valley, one very large stone guardian.</p></div>
<div class=url>SWORDANDSEAL.COM</div></body>`;
const tmp = path.join(ROOT, "scripts", ".og.html");
fs.writeFileSync(tmp, html);
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(tmp).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
const png = await page.screenshot({ type: "png" });
await browser.close();
fs.unlinkSync(tmp);
let q = 86, out;
do { out = await sharp(png).jpeg({ quality: q, mozjpeg: true }).toBuffer(); q -= 6; } while (out.length > 280_000 && q > 40);
fs.writeFileSync(path.join(S, "static", "og.jpg"), out);
console.log("assets written; og.jpg", (out.length / 1024).toFixed(0), "KB");
