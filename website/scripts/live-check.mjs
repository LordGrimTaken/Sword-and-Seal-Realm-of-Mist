// Check the live site: are the published pages actually reachable and current?
//
//   node website/scripts/live-check.mjs
//
// Fetches each page from swordandseal.com over the network, retrying briefly so a
// deploy that is still propagating does not report a false failure. Exit 0 = live
// and current, 1 = something is wrong.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = "https://swordandseal.com";
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

const checks = [
  ["/", (html) => html.includes(VERSION)],
  ["/roadmap", (html) => html.includes("Shipped") && html.includes(VERSION)],
  ["/changelog", (html) => html.includes(`Version ${VERSION}`)],
  ["/status", (html) => html.includes('id="status-card"')],
  ["/press", (html) => html.includes("Fact sheet")],
  ["/devlog", (html) => html.includes("Devlog")],
  ["/sitemap.xml", (xml) => xml.includes("/roadmap")],
];

const ATTEMPTS = 6;
const DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "cache-control": "no-cache" } });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`live-check: ${ORIGIN} should be serving version ${VERSION}`);

let pending = checks.map(([route, check]) => ({ route, check, ok: false }));
for (let attempt = 1; attempt <= ATTEMPTS && pending.length; attempt++) {
  const failed = [];
  for (const item of pending) {
    try {
      const { status, body } = await fetchOnce(ORIGIN + item.route);
      if (status === 200 && item.check(body)) {
        item.ok = true;
        console.log(`ok   ${item.route}`);
      } else {
        failed.push(item);
        console.log(`wait ${item.route} -> HTTP ${status}${status === 200 ? " (stale content)" : ""}`);
      }
    } catch (error) {
      failed.push(item);
      console.log(`wait ${item.route} -> ${error.name === "AbortError" ? "timeout" : error.message}`);
    }
  }
  pending = failed;
  if (pending.length && attempt < ATTEMPTS) await sleep(DELAY_MS);
}

if (pending.length) {
  console.error(`\nlive-check: FAILED — ${pending.map((item) => item.route).join(", ")}`);
  console.error("The deploy may not have completed, or the route/DNS is not pointing at this Worker.");
  process.exit(1);
}
console.log(`\nlive-check: PASS — the live site is serving ${VERSION}.`);
