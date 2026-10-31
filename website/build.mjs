#!/usr/bin/env node
// Sword & Seal website build. Node built-ins only.
//   node website/build.mjs          -> website/dist/ (static files) + website/dist-worker/worker.mjs
// Stitches website/src/pages/*.html into src/partials/layout.html, content-hashes css/js/fonts/img,
// generates the mountain SVG, news seed (from CHANGELOG.md), sitemap.xml and the Cloudflare Worker module.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const WORKER_DIR = path.join(ROOT, "dist-worker");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));

const read = (p) => fs.readFileSync(p, "utf8");
const hash8 = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "assets"), { recursive: true });

// ---------- version ----------
let gameVersion = "0.3.0";
try { gameVersion = read(path.resolve(ROOT, cfg.gameVersionFile)).trim() || gameVersion; } catch { /* keep default */ }
cfg.gameVersion = gameVersion;

// ---------- hashed assets ----------
const assetMap = {}; // "css/site.css" -> "/assets/site.abcdef1234.css"
function emitAsset(rel, buf) {
  const ext = path.extname(rel);
  const base = path.basename(rel, ext);
  const name = `${base}.${hash8(buf)}${ext}`;
  fs.writeFileSync(path.join(DIST, "assets", name), buf);
  assetMap[rel] = "/assets/" + name;
}
for (const dir of ["fonts", "img"]) {
  for (const f of fs.readdirSync(path.join(SRC, dir)).sort()) emitAsset(`${dir}/${f}`, fs.readFileSync(path.join(SRC, dir, f)));
}
const resolveAssets = (text) => text.replace(/\{\{asset:([^}]+)\}\}/g, (_, p) => {
  if (!assetMap[p]) throw new Error("Unknown asset reference: " + p);
  return assetMap[p];
});

// config.js: public subset of config, as a classic script (CSP forbids inline script)
const publicCfg = {
  siteName: cfg.siteName, origin: cfg.origin, supportEmail: cfg.supportEmail, gameVersion,
  downloads: cfg.downloads, newsUrl: cfg.newsUrl, healthUrl: cfg.healthUrl,
};
emitAsset("js/config.js", Buffer.from(`window.SITE_CONFIG=${JSON.stringify(publicCfg)};\n`));
for (const f of fs.readdirSync(path.join(SRC, "css")).sort()) {
  emitAsset(`css/${f}`, Buffer.from(resolveAssets(read(path.join(SRC, "css", f)))));
}
for (const f of fs.readdirSync(path.join(SRC, "js")).sort()) emitAsset(`js/${f}`, fs.readFileSync(path.join(SRC, "js", f)));

// ---------- generated fragments ----------
function prng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** One ridge line as a smooth closed path across the 1600 x 520 viewBox. */
function ridge(seed, base, amp, step, jag) {
  const r = prng(seed);
  const pts = [];
  for (let x = -40; x <= 1640; x += step) {
    const wave = Math.sin(x / 210 + seed) * 0.5 + Math.sin(x / 97 + seed * 2) * 0.28 + Math.sin(x / 41) * 0.1;
    const spike = r() < jag ? r() * 0.9 : r() * 0.25;
    pts.push([x, base - amp * (0.55 + wave * 0.5 + spike * 0.55)]);
  }
  let d = `M${pts[0][0]} 520 L${pts[0][0]} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last[0]} ${last[1].toFixed(1)} L${last[0]} 520 Z`;
  return d;
}
function pine(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0 L0 -26" stroke-width="2.2" stroke="currentColor"/><path d="M-11 -10 Q0 -22 11 -10 Q0 -14 -11 -10Z M-8 -20 Q0 -32 8 -20 Q0 -24 -8 -20Z M-5 -30 Q0 -42 5 -30 Q0 -33 -5 -30Z" fill="currentColor"/></g>`;
}
function pagoda(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="currentColor"><rect x="-2" y="-92" width="4" height="14"/><path d="M-9 -78 L9 -78 L4 -86 L-4 -86Z"/><path d="M-16 -64 Q0 -78 16 -64 L12 -60 L-12 -60Z"/><rect x="-9" y="-60" width="18" height="12"/><path d="M-22 -44 Q0 -60 22 -44 L17 -40 L-17 -40Z"/><rect x="-13" y="-40" width="26" height="12"/><path d="M-30 -22 Q0 -42 30 -22 L24 -17 L-24 -17Z"/><rect x="-18" y="-17" width="36" height="17"/></g>`;
}
const layerSvg = (n, inner) => `<svg class="mtn-layer l${n}" viewBox="0 0 1600 520" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">${inner}</svg>`;
const mountains = `<div class="mtn" aria-hidden="true">
<svg class="defs-only" width="0" height="0" aria-hidden="true" focusable="false"><defs>
  <filter id="ink" x="-2%" y="-5%" width="104%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.018 0.03" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9"/></filter>
  ${[1, 2, 3, 4].map((i) => `<linearGradient id="fade${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a${i}"/><stop offset="${0.8 + i * 0.03}" class="stop-b"/></linearGradient>`).join("")}
</defs></svg>
${layerSvg(1, `<path filter="url(#ink)" d="${ridge(3, 330, 230, 60, 0.25)}" fill="url(#fade1)"/>`)}
${layerSvg(2, `<path filter="url(#ink)" d="${ridge(11, 385, 215, 52, 0.3)}" fill="url(#fade2)"/><g class="deco2">${pagoda(1180, 258, 0.9)}</g>`)}
${layerSvg(3, `<path filter="url(#ink)" d="${ridge(23, 440, 195, 46, 0.3)}" fill="url(#fade3)"/><g class="deco3">${pine(930, 292, 1.5)}${pine(958, 300, 1.1)}${pine(1400, 300, 1.4)}${pine(1428, 308, 1)}</g>`)}
${layerSvg(4, `<path filter="url(#ink)" d="${ridge(37, 478, 150, 40, 0.35)}" fill="url(#fade4)"/><g class="deco4">${pine(40, 392, 2.1)}${pine(880, 404, 1.3)}${pine(1010, 398, 1.8)}${pine(1530, 380, 2.2)}</g>`)}
${layerSvg(5, `<path d="${ridge(53, 512, 125, 36, 0.4)}" class="front"/><g class="deco5">${[60, 92, 1330, 1368, 1402].map((x, i) => `<path d="M${x} 520 Q${x - 3 + (i % 2) * 6} 440 ${x + 2} 330" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M${x + 1} 470 l16 -10 M${x} 420 l-15 -9 M${x + 2} 370 l14 -9" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>`).join("")}</g>`)}
</div>`;

// ---------- release notes: one parse feeds the news seed and the /changelog page ----------
import { parseChangelog, versionAnchor } from "../scripts/release-notes.mjs";

let releases = [];
try { releases = parseChangelog(read(path.resolve(ROOT, "..", "CHANGELOG.md")), { filterDev: true }); } catch { releases = []; }
const truncate = (s, n) => (s.length > n ? s.slice(0, s.lastIndexOf(" ", n - 3)) + "..." : s);

const newsSeedHtml = releases.map((r) => {
  const bullets = r.groups.flatMap((g) => g.bullets).slice(0, 5).map((b) => truncate(b, 230));
  return `
      <article class="post" id="${versionAnchor(r.version)}">
        <header><p class="eyebrow">Version ${esc(r.version)}${r.date ? ` &middot; <time datetime="${r.date}">${esc(r.date)}</time>` : ""}</p>
        <h2>${esc(r.title)}</h2></header>
        ${r.intro ? `<p>${esc(truncate(r.intro, 300))}</p>` : ""}
        ${bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      </article>`;
}).join("\n");

const changelogHtml = releases.map((r) => `
  <article class="release" id="${versionAnchor(r.version)}">
    <header class="release-head">
      <p class="eyebrow">Version ${esc(r.version)}${r.date ? ` &middot; <time datetime="${r.date}">${esc(r.date)}</time>` : ""}</p>
      <h2>${esc(r.title)}</h2>
    </header>
    ${r.intro ? `<p class="release-intro">${esc(r.intro)}</p>` : ""}
    ${r.groups.map((g) => `<section class="release-group">
      <h3>${esc(g.heading)}</h3>
      <ul>${g.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
    </section>`).join("\n    ")}
  </article>`).join("\n");

// ---------- templating ----------
const getPath = (obj, p) => p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
const partialCache = {};
const partial = (name) => (partialCache[name] ??= read(path.join(SRC, "partials", name + ".html")));
const gen = { mountains, news_seed: newsSeedHtml, changelog: changelogHtml, version: gameVersion, year: new Date().getFullYear(), updated: cfg.lastUpdated };

function render(text, vars) {
  for (let pass = 0; pass < 4; pass++) {
    text = text.replace(/\{\{include:([\w-]+)\}\}/g, (_, n) => partial(n));
  }
  text = text.replace(/\{\{cfg\.([\w.]+)\}\}/g, (_, p) => { const v = getPath(cfg, p); if (v === undefined) throw new Error("Missing config " + p); return esc(v); });
  text = text.replace(/\{\{asset:([^}]+)\}\}/g, (_, p) => { if (!assetMap[p]) throw new Error("Unknown asset " + p); return assetMap[p]; });
  text = text.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (k in vars) return vars[k];
    if (k in gen) return gen[k];
    throw new Error("Unresolved placeholder " + m);
  });
  return text;
}

const layout = read(path.join(SRC, "partials", "layout.html"));
const pages = [];
for (const f of fs.readdirSync(path.join(SRC, "pages")).sort()) {
  if (!f.endsWith(".html")) continue;
  const raw = read(path.join(SRC, "pages", f));
  const m = raw.match(/^<!--meta\s*([\s\S]*?)-->\s*/);
  if (!m) throw new Error(f + ": missing <!--meta {...}--> header");
  const meta = JSON.parse(m[1]);
  const body = raw.slice(m[0].length);
  const name = f.replace(/\.html$/, "");
  const urlPath = name === "index" ? "/" : "/" + name;
  const scripts = (meta.scripts || []).map((s) => `<script src="${assetMap["js/" + s + ".js"]}" defer></script>`).join("\n  ");
  const vars = {
    title: esc(meta.title), description: esc(meta.description),
    canonical: meta.noindex ? "" : `<link rel="canonical" href="${cfg.origin}${urlPath === "/" ? "/" : urlPath}">`,
    robots: meta.noindex ? `<meta name="robots" content="noindex">` : "",
    ogTitle: esc(meta.ogTitle || meta.title), url: cfg.origin + (urlPath === "/" ? "/" : urlPath),
    page: name, scripts, navCurrent: meta.nav || name, bodyClass: meta.bodyClass || "",
    content: render(body, {}),
  };
  const html = render(layout, vars);
  // mark current nav link
  const final = html.replace(new RegExp(`(<a class="nav-link"[^>]*href="${vars.navCurrent === "index" ? "/" : "/" + vars.navCurrent}")`), '$1 aria-current="page"');
  fs.writeFileSync(path.join(DIST, name + ".html"), final);
  pages.push({ name, urlPath, noindex: !!meta.noindex, priority: meta.priority ?? 0.5 });
}

// ---------- static files ----------
for (const f of fs.readdirSync(path.join(SRC, "static")).sort()) {
  fs.copyFileSync(path.join(SRC, "static", f), path.join(DIST, f));
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages.filter((p) => !p.noindex).map((p) => `  <url><loc>${cfg.origin}${p.urlPath}</loc><lastmod>${cfg.lastUpdated}</lastmod><priority>${p.priority}</priority></url>`).join("\n") + `\n</urlset>\n`;
fs.writeFileSync(path.join(DIST, "sitemap.xml"), sitemap);

// ---------- worker ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
const TEXT = new Set([".html", ".css", ".js", ".json", ".svg", ".txt", ".xml", ".webmanifest"]);
const files = {};
let total = 0;
function walk(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name), r = rel + "/" + e.name;
    if (e.isDirectory()) { walk(p, r); continue; }
    const buf = fs.readFileSync(p);
    const ext = path.extname(e.name);
    if (!TYPES[ext]) throw new Error("No content type for " + r);
    total += buf.length;
    files[r] = { t: TYPES[ext], e: hash8(buf), ...(TEXT.has(ext) ? { s: buf.toString("utf8") } : { b: buf.toString("base64") }) };
  }
}
walk(DIST);
fs.mkdirSync(WORKER_DIR, { recursive: true });
const tpl = read(path.join(ROOT, "src", "worker-template.mjs"));
const out = tpl.replace("/*__FILES__*/{}", () => JSON.stringify(files)).replace("__CONFIG__", () => JSON.stringify({ apex: new URL(cfg.origin).host, www: cfg.wwwHost }));
fs.writeFileSync(path.join(WORKER_DIR, "worker.mjs"), out);
console.log(`Built ${pages.length} pages, ${Object.keys(files).length} files, ${(total / 1024).toFixed(0)} KB raw; worker ${(out.length / 1024).toFixed(0)} KB (limit 8192 KB).`);
if (out.length > 8 * 1024 * 1024) { console.error("Worker exceeds 8 MB"); process.exit(1); }
