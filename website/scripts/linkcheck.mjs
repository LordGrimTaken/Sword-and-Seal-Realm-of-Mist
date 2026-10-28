#!/usr/bin/env node
// Crawls the built site through the worker handler (no network): every internal href/src/srcset/manifest/sitemap URL must resolve to 200 (or an intended redirect target),
// every #fragment must exist in the target page, and html pages must not redirect to themselves. Exit code 1 on any failure.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(pathToFileURL(path.join(ROOT, "dist-worker", "worker.mjs")).href)).default;
const BASE = "https://swordandseal.com";
const get = (p, method = "GET") => worker.fetch(new Request(BASE + p, { method, redirect: "manual" }));
const seen = new Map(), bad = [], ids = new Map();
let checked = 0;

async function page(p) {
  if (seen.has(p)) return seen.get(p);
  const r = await get(p);
  const text = (r.headers.get("content-type") || "").includes("html") ? await r.text() : "";
  seen.set(p, { status: r.status, text });
  if (text) ids.set(p, new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return seen.get(p);
}
const queue = ["/", "/404"], done = new Set();
const mailOrExternal = /^(mailto:|tel:|https?:\/\/|data:|javascript:)/i;
while (queue.length) {
  const p = queue.shift();
  if (done.has(p)) continue; done.add(p);
  const r = await get(p);
  if (p === "/404") { if (r.status !== 404) bad.push(`/404 should answer 404, got ${r.status}`); }
  else if (r.status !== 200) { bad.push(`${p} -> ${r.status}`); continue; }
  const html = (r.headers.get("content-type") || "").includes("html") ? await (await get(p)).text() : "";
  if (p === "/404" ) { /* still crawl its links */ }
  const base = p;
  const refs = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
  for (const m of html.matchAll(/\scontent="((?:https:\/\/swordandseal\.com)?\/[^"]*)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) refs.push(...m[1].split(",").map((s) => s.trim().split(/\s+/)[0]));
  for (let ref of refs) {
    if (!ref || mailOrExternal.test(ref) && !ref.startsWith(BASE)) continue;
    if (!ref.startsWith("/") && !ref.startsWith("#") && !ref.startsWith(BASE)) { if (!/^[\w-]+(\.[\w-]+)+/.test(ref) || ref.includes(" ")) continue; }
    ref = ref.replace(BASE, "");
    if (ref.startsWith("#")) ref = base + ref;
    const [target, frag] = ref.split("#");
    const tpath = target || base;
    checked++;
    const tr = await get(tpath);
    if (tr.status !== 200 && !(p === "/404" && tpath === "/404")) { bad.push(`${p}: ${ref} -> ${tr.status}${tr.headers.get("location") ? " " + tr.headers.get("location") : ""}`); continue; }
    if (!done.has(tpath) && ((tr.headers.get("content-type") || "").includes("html"))) queue.push(tpath);
    if (frag) { await page(tpath); if (!ids.get(tpath)?.has(frag)) bad.push(`${p}: ${ref} -> missing #${frag}`); }
  }
}
// sitemap, robots, manifest
const sm = await (await get("/sitemap.xml")).text();
for (const m of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) { checked++; const u = m[1].replace(BASE, "") || "/"; const r = await get(u); if (r.status !== 200) bad.push(`sitemap: ${u} -> ${r.status}`); }
const man = JSON.parse(await (await get("/site.webmanifest")).text());
for (const i of man.icons) { checked++; const r = await get(i.src); if (r.status !== 200) bad.push(`manifest icon ${i.src} -> ${r.status}`); }
for (const p of ["/robots.txt", "/favicon.svg", "/favicon-32.png", "/apple-touch-icon.png", "/og.jpg"]) { checked++; const r = await get(p); if (r.status !== 200) bad.push(`${p} -> ${r.status}`); }
// clean-URL and redirect behaviour
for (const [from, to] of [["/download.html", "/download"], ["/index.html", "/"], ["/world/", "/world"]]) {
  const r = await get(from); if (r.status !== 301 || r.headers.get("location") !== to) bad.push(`redirect ${from} expected 301 ${to}, got ${r.status} ${r.headers.get("location")}`);
}
const www = await worker.fetch(new Request("https://www.swordandseal.com/download?x=1", { redirect: "manual" }));
if (www.status !== 301 || www.headers.get("location") !== "https://swordandseal.com/download?x=1") bad.push("www redirect wrong: " + www.status + " " + www.headers.get("location"));
const miss = await get("/nope"); if (miss.status !== 404) bad.push("/nope should be 404");
console.log(`link check: ${checked} references, ${done.size} pages crawled, ${bad.length} problem(s)`);
bad.forEach((b) => console.log("  FAIL " + b));
process.exit(bad.length ? 1 : 0);
