// Renders every procedural sound offline and fails on SILENT or CLIPPING results.
//   node scripts/audio-selftest.mjs
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const CLIENT = resolve(import.meta.dirname, "..");
const { chromium } = createRequire(import.meta.url)("/opt/npm-tools/node_modules/playwright");
const tmp = mkdtempSync(join(tmpdir(), "jz-audio-"));
let bad = 1;
try {
  const out = join(tmp, "selftest.js");
  await build({ entryPoints: [join(CLIENT, "src/audio/selftest.ts")], bundle: true, format: "iife", outfile: out, logLevel: "silent" });
  writeFileSync(join(tmp, "page.html"), `<!doctype html><script src="selftest.js"></script>`);
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
    await page.goto("file://" + join(tmp, "page.html"));
    const rows = await page.evaluate(() => window.__audioSelfTest());
    bad = rows.filter((r) => r.status !== "ok").length;
    for (const r of rows) console.log(r.name.padEnd(22), r.peakDb.toFixed(1).padStart(7), r.rmsDb.toFixed(1).padStart(7), r.status);
    console.log(bad ? `FAIL (${bad} bad of ${rows.length})` : `PASS (${rows.length} sounds)`);
  } finally { await browser.close(); }
} finally { rmSync(tmp, { recursive: true, force: true }); }
process.exit(bad ? 1 : 0);
