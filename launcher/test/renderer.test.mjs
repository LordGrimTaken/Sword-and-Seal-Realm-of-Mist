// Static checks on the renderer: security posture, English-only text, and that every id app.js uses exists in index.html.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "renderer");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const html = read("index.html"), app = read("app.js");

test("renderer: strict CSP, no remote content, no inline scripts", () => {
  assert.match(html, /Content-Security-Policy[^>]*default-src 'self'/);
  assert.match(html, /script-src 'self'/); assert.match(html, /connect-src 'none'/);
  assert.ok(!/https?:\/\//.test(html.replace(/xmlns="[^"]*"/g, "")), "no remote URLs in index.html");
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /src="/, "scripts are external files");
  for (const f of ["app.js", "hero.js", "mock-bridge.js"]) assert.ok(!/\beval\(|new Function\(/.test(read(f)), `${f}: no eval`);
});

test("renderer: every id used by app.js exists in index.html", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
  for (const id of used) assert.ok(ids.has(id), `missing #${id}`);
});

test("renderer: English only, and the button flow states are present", () => {
  for (const f of ["index.html", "app.js", "hero.js", "mock-bridge.js", "style.css"]) assert.ok(!/[　-鿿가-힯]/.test(read(f)), `${f}: no CJK`);
  for (const label of ["Sign in", "Install", "Update", "Downloading", "Verifying", "Play", "Launching", "Resume", "Repair"]) assert.ok(app.includes(`label: "${label}"`), `button state ${label}`);
});

test("electron main: contextIsolation on, node integration off, 1100x680 window", () => {
  const main = fs.readFileSync(path.join(dir, "..", "electron", "main.cjs"), "utf8");
  assert.match(main, /contextIsolation: true/); assert.match(main, /nodeIntegration: false/); assert.match(main, /sandbox: true/);
  assert.match(main, /width: 1100, height: 680/);
});
