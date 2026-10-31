// Pre-deploy gate: exercise the built Worker directly (no wrangler, no network, no auth).
//
// The site ships as one module Worker with every page and asset inlined, so it can
// be imported and called here exactly as Cloudflare will call it. This catches the
// mistakes that only show up after deploy: a page missing from the build, a broken
// route, a lost security header, a stale version in the footer.
//
//   node website/scripts/probe-worker.mjs
//
// Exit 0 = the bundle is shippable, 1 = something is wrong.

import worker from "../dist-worker/worker.mjs";

const ORIGIN = "https://swordandseal.com";
const VERSION = (await import("node:fs")).readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();

const pages = [
  ["/", (body) => body.includes("<h1")],
  ["/roadmap", (body) => body.includes(VERSION) && body.includes("Shipped")],
  ["/changelog", (body) => body.includes(`Version ${VERSION}`) && body.includes(`id="${anchor(VERSION)}"`)],
  ["/status", (body) => body.includes('id="status-card"')],
  ["/press", (body) => body.includes("Fact sheet")],
  ["/devlog", (body) => (body.match(/class="post-article/g) || []).length >= 3],
  ["/news", (body) => body.includes("News")],
  ["/support", (body) => body.includes("Your first hour")],
  ["/download", (body) => body.includes("Download")],
  ["/classes", (body) => body.includes("Classes")],
  ["/world", (body) => body.includes("Cloudmist")],
  ["/terms", (body) => body.includes("Terms")],
  ["/privacy", (body) => body.includes("Privacy")],
  ["/eula", (body) => body.includes("EULA")],
];

function anchor(version) {
  return "v" + version.replace(/\./g, "-");
}

let failures = 0;
function fail(message) {
  failures += 1;
  console.log("FAIL " + message);
}

console.log(`probe-worker: version ${VERSION}, ${pages.length} pages`);

for (const [route, check] of pages) {
  const res = await worker.fetch(new Request(ORIGIN + route), {}, {});
  const body = await res.text();
  if (res.status !== 200) { fail(`${route} -> HTTP ${res.status}`); continue; }
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("text/html")) fail(`${route} -> content-type ${type}`);
  if (!check(body)) fail(`${route} -> expected content missing`);
  if (/[\u4e00-\u9fff]/.test(body)) fail(`${route} -> contains CJK characters (English-only site)`);
}

const missing = await worker.fetch(new Request(ORIGIN + "/definitely-not-a-page"), {}, {});
if (missing.status !== 404) fail(`unknown route -> HTTP ${missing.status} (expected 404)`);

const home = await worker.fetch(new Request(ORIGIN + "/"), {}, {});
for (const header of ["content-security-policy", "strict-transport-security", "x-content-type-options"]) {
  if (!home.headers.get(header)) fail(`missing security header: ${header}`);
}
if (!/no-store|max-age|s-maxage/.test(home.headers.get("cache-control") || "")) fail("missing cache-control");

const sitemap = await worker.fetch(new Request(ORIGIN + "/sitemap.xml"), {}, {});
const sitemapBody = await sitemap.text();
if (sitemap.status !== 200) fail(`sitemap -> HTTP ${sitemap.status}`);
for (const route of ["/roadmap", "/changelog", "/status", "/press", "/devlog"]) {
  if (!sitemapBody.includes(route)) fail(`sitemap is missing ${route}`);
}

const www = await worker.fetch(new Request("https://www.swordandseal.com/roadmap"), {}, {});
if (www.status !== 301 && www.status !== 308) fail(`www redirect -> HTTP ${www.status}`);
if (!String(www.headers.get("location") || "").includes("swordandseal.com/roadmap")) fail("www redirect target looks wrong");

// The stylesheet the built pages point at must exist in the bundle.
const homeHtml = await home.text();
const cssHref = (homeHtml.match(/\/assets\/site\.[a-f0-9]+\.css/) || [])[0];
if (!cssHref) {
  fail("home page references no site stylesheet");
} else {
  const css = await worker.fetch(new Request(ORIGIN + cssHref), {}, {});
  if (css.status !== 200) fail(`${cssHref} -> HTTP ${css.status}`);
}

console.log(failures === 0 ? "probe-worker: PASS" : `probe-worker: ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
