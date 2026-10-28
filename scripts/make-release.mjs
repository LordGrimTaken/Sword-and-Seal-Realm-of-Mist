// Builds the release folder, laid out 1:1 like the dl.swordandseal.com bucket (see docs/RELEASING.md):
//   release/game/<version>/{manifest.json,news.json,files/**}     immutable game version
//   release/game/latest/{manifest.json,news.json}                 pointer (filesBase "../<version>/files/")
//   release/news.json                                             same as game/latest/news.json (read by the website)
//   release/launcher/<launcherVersion>/<installers, *.yml, *.blockmap, SHA256SUMS[.asc], release.json>   (with --launcher-dir)
//   release/launcher/latest.json                                  {version, releasedAt, files:{win,mac,linux:{url,size,sha256,signed}}}
//   release/launcher/feed/latest*.yml                             electron-updater generic feed (paths point to ../<version>/)
// Usage: node scripts/make-release.mjs [--gzip] [--package] [--skip-package] [--out release] [--version X.Y.Z]
//          [--launcher-dir DIR --launcher-version X.Y.Z --base-url https://dl.swordandseal.com
//           --signing-report DIR --signed win,mac,linux --launcher-checksums DIR]
//          [--min-launcher 1.0.0] [--channel stable] [--date YYYY-MM-DD]
//          [--electron-linux DIR] [--electron-win32 DIR] [--electron-darwin DIR]   (unpacked electron-builder output dirs)
//          [--electron-linux-exe name] [--electron-win32-exe name.exe] [--electron-darwin-exe rel/path]
// Input is the output of scripts/package.mjs (dist-package/jiuzhou-v<VERSION>/), laid out as game/ in the release.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const version = opt("version", fs.readFileSync(path.join(root, "VERSION"), "utf8").trim());
const outRoot = path.resolve(root, opt("out", "release"));
const gameRoot = path.join(outRoot, "game");
const relDir = path.join(gameRoot, version);
const latestDir = path.join(gameRoot, "latest");
const channel = opt("channel", "stable");
const minLauncher = opt("min-launcher", "1.0.0");
const gzip = flag("gzip");
const releasedAt = new Date().toISOString();
const pkgDir = path.join(root, "dist-package", `jiuzhou-v${fs.readFileSync(path.join(root, "VERSION"), "utf8").trim()}`);

// 1. ensure the packaged game exists
if (flag("package") || (!flag("skip-package") && !fs.existsSync(path.join(pkgDir, "client", "dist", "index.html")))) {
  console.log("Running scripts/package.mjs ...");
  const r = spawnSync(process.execPath, [path.join("scripts", "package.mjs")], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) { console.error("package.mjs failed"); process.exit(1); }
}
if (!fs.existsSync(pkgDir)) { console.error(`Missing ${pkgDir}. Run: npm run package`); process.exit(1); }

// 2. collect files
fs.rmSync(relDir, { recursive: true, force: true });
fs.rmSync(latestDir, { recursive: true, force: true });
const filesOut = path.join(relDir, "files");
fs.mkdirSync(filesOut, { recursive: true });
const entries = [];
const GZ_EXT = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".json", ".svg", ".map", ".md", ".txt", ".sh", ".bat", ".ts", ".wasm", ".pak", ".dat", ".bin", ".so"]);

function addFile(src, rel, extra = {}) {
  const buf = fs.readFileSync(src);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const e = { path: rel, size: buf.length, sha256, ...extra };
  const exec = process.platform !== "win32" && (fs.statSync(src).mode & 0o111) !== 0;
  if (exec) e.mode = "755";
  const dest = path.join(filesOut, ...rel.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (gzip && buf.length > 1024 && GZ_EXT.has(path.extname(rel).toLowerCase())) {
    const z = zlib.gzipSync(buf, { level: 9 });
    if (z.length < buf.length * 0.9) { fs.writeFileSync(dest + ".gz", z); e.gz = true; e.gzSize = z.length; entries.push(e); return; }
  }
  fs.writeFileSync(dest, buf);
  entries.push(e);
}
function walk(dir, base, fn) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, d.name);
    if (d.isSymbolicLink()) { console.warn(`skipping symlink ${abs}`); continue; }
    if (d.isDirectory()) walk(abs, base, fn); else if (d.isFile()) fn(abs, path.relative(base, abs).split(path.sep).join("/"));
  }
}

walk(pkgDir, pkgDir, (abs, rel) => addFile(abs, `game/${rel}`));

const launch = {};
for (const plat of ["linux", "win32", "darwin"]) {
  const dir = opt(`electron-${plat}`);
  if (!dir) continue;
  const exeDefault = { linux: "jiuzhou-client", win32: "Sword and Seal.exe", darwin: "Sword and Seal.app/Contents/MacOS/Sword and Seal" }[plat];
  const exe = opt(`electron-${plat}-exe`, exeDefault);
  const src = path.resolve(dir);
  if (!fs.existsSync(path.join(src, ...exe.split("/")))) { console.error(`--electron-${plat}: ${exe} not found in ${src}`); process.exit(1); }
  const links = []; (function f(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isSymbolicLink()) links.push(a); else if (e.isDirectory()) f(a); } })(src);
  if (links.length) { console.error(`--electron-${plat}: ${links.length} symlink(s) found (e.g. ${links[0]}). The launcher manifest format has no symlinks, so this directory would install broken (typical for macOS .app bundles). Ship it as a dmg/zip instead and omit --electron-${plat}.`); process.exit(1); }
  walk(src, src, (abs, rel) => addFile(abs, `game/electron/${plat}/${rel}`, { platforms: [plat] }));
  launch[plat] = `game/electron/${plat}/${exe}`;
}
entries.sort((a, b) => (a.path < b.path ? -1 : 1));

// 3. manifest
const manifest = {
  version, channel, releasedAt, minLauncherVersion: minLauncher, notesUrl: "news.json",
  launch,
  launchFallback: { command: "node", args: ["scripts/play.mjs"], cwd: "game" },
  files: entries,
};
fs.writeFileSync(path.join(relDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// 4. news.json from CHANGELOG.md (latest entries)
function newsFromChangelog(md, releaseDate, limit = 5) {
  const parts = md.split(/^## /m).slice(1).slice(0, limit);
  return parts.map((blk, i) => {
    const [head, ...rest] = blk.split("\n");
    const hm = /^(v?\d+\.\d+\.\d+)\s*(?:[-—–:(]+\s*)?(.*?)\)?\s*$/.exec(head.trim());
    const id = hm ? hm[1].replace(/^v/, "") : `entry-${i}`;
    const title = (hm && hm[2] ? hm[2] : head).replace(/^\(|\)$/g, "").trim() || `Version ${id}`;
    const dm = /(\d{4}-\d{2}-\d{2})/.exec(head);
    const body = rest.map((l) => l.replace(/^#{3,}\s*/, "").replace(/\*\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trimEnd())
      .filter((l, j, a) => !(l === "" && (j === 0 || a[j - 1] === "")));
    let acc = "", lines = [];
    for (const l of body) { if ((acc + l).length > 900 && lines.length) break; lines.push(l); acc += l + "\n"; }
    return { id, title, date: dm ? dm[1] : i === 0 ? releaseDate : "", body: lines.join("\n").trim() };
  });
}
let news = [];
try { news = newsFromChangelog(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), opt("date", releasedAt.slice(0, 10))); } catch { /* no changelog */ }
// hand-written entries (news.extra.json at the repo root, same format) win over generated ones with the same id
try {
  const extraNews = JSON.parse(fs.readFileSync(path.join(root, "news.extra.json"), "utf8"));
  if (Array.isArray(extraNews)) { const ids = new Set(extraNews.map((n) => n.id)); news = [...extraNews, ...news.filter((n) => !ids.has(n.id))]; }
} catch { /* none */ }
news = news.map((n, i) => ({ ...n, _i: i })).sort((a, b) => (b.date || "").localeCompare(a.date || "") || a._i - b._i).map(({ _i, ...n }) => n);
if (!news.length) news = [{ id: version, title: `Version ${version}`, date: releasedAt.slice(0, 10), body: "Sword and Seal: Realm of Mist." }];
fs.writeFileSync(path.join(relDir, "news.json"), JSON.stringify(news, null, 2) + "\n");

// 5. latest pointer: same manifest, files resolved relative to the versioned folder
fs.mkdirSync(latestDir, { recursive: true });
fs.writeFileSync(path.join(latestDir, "manifest.json"), JSON.stringify({ ...manifest, filesBase: `../${version}/files/` }, null, 2) + "\n");
fs.copyFileSync(path.join(relDir, "news.json"), path.join(latestDir, "news.json"));
fs.copyFileSync(path.join(relDir, "news.json"), path.join(outRoot, "news.json"));

// 6. launcher installers -> launcher/<version>/ + launcher/latest.json (+ electron-updater feed)
const launcherDir = opt("launcher-dir");
let launcherInfo = null;
if (launcherDir) {
  const lver = opt("launcher-version", JSON.parse(fs.readFileSync(path.join(root, "launcher", "package.json"), "utf8")).version);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(lver)) { console.error(`Bad launcher version: ${lver}`); process.exit(1); }
  const baseUrl = opt("base-url", "https://dl.swordandseal.com").replace(/\/+$/, "");
  const lroot = path.join(outRoot, "launcher");
  const ldir = path.join(lroot, lver);
  const feedDir = path.join(lroot, "feed");
  fs.rmSync(ldir, { recursive: true, force: true });
  fs.rmSync(feedDir, { recursive: true, force: true });
  fs.mkdirSync(ldir, { recursive: true });

  // signing evidence: --signing-report DIR (signing-*.json written by scripts/verify-signatures.mjs) and/or --signed win,mac
  const signedByName = new Map();
  const reportDir = opt("signing-report");
  if (reportDir) {
    const rd = path.resolve(reportDir);
    const reports = [];
    (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) w(a); else if (/^signing-.*\.json$/.test(e.name)) reports.push(a); } })(rd);
    for (const r of reports) { const j = JSON.parse(fs.readFileSync(r, "utf8")); for (const [n, v] of Object.entries(j.files || {})) signedByName.set(n, v === true || (v && v.signed === true)); }
  }
  const signedPlat = new Set((opt("signed", "") || "").split(",").map((x) => x.trim()).filter(Boolean));
  const sumsDir = opt("launcher-checksums");
  const sumsSigned = !!(sumsDir && fs.existsSync(path.join(sumsDir, "SHA256SUMS.asc")));

  const found = [];
  (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isSymbolicLink()) continue; if (e.isDirectory()) w(a); else if (e.isFile()) found.push(a); } })(path.resolve(launcherDir));
  const kinds = [
    { re: /^SwordAndSeal-Launcher-Setup-.+\.exe$/, plat: "win", kind: "installer" },
    { re: /^SwordAndSeal-Launcher-Portable-.+\.exe$/, plat: "win", kind: "portable" },
    { re: /^SwordAndSeal-Launcher-.+-arm64\.dmg$/, plat: "mac_arm64", kind: "installer" },
    { re: /^SwordAndSeal-Launcher-.+-x64\.dmg$/, plat: "mac_x64", kind: "installer" },
    { re: /^SwordAndSeal-Launcher-.+\.dmg$/, plat: "mac", kind: "installer" },
    { re: /^SwordAndSeal-Launcher-.+-mac\.zip$/, plat: "mac", kind: "zip" },
    { re: /^SwordAndSeal-Launcher-.+\.AppImage$/, plat: "linux", kind: "installer" },
  ];
  const hashFile = (f) => { const h = crypto.createHash("sha256"); const fd = fs.openSync(f, "r"); const b = Buffer.alloc(1 << 20); let n; while ((n = fs.readSync(fd, b, 0, b.length, null)) > 0) h.update(b.subarray(0, n)); fs.closeSync(fd); return h.digest("hex"); };
  const lfiles = {}, extra = [];
  for (const f of found.sort()) {
    const name = path.basename(f);
    const k = kinds.find((x) => x.re.test(name));
    const isYml = /^latest(-mac|-linux)?\.yml$/.test(name), isMap = name.endsWith(".blockmap");
    if (!k && !isYml && !isMap) continue;
    if (k && !name.includes(lver)) { console.error(`${name} does not contain launcher version ${lver}`); process.exit(1); }
    if (isYml) {   // electron-updater feed: rewrite file references to the versioned folder
      fs.mkdirSync(feedDir, { recursive: true });
      const txt = fs.readFileSync(f, "utf8").replace(/^(\s*(?:-\s+)?(?:url|path):\s*)(?!https?:|\.\.\/)(\S.*)$/gm, (_m, a, b) => `${a}../${lver}/${b.trim()}`);
      fs.writeFileSync(path.join(feedDir, name), txt);
      fs.copyFileSync(f, path.join(ldir, name));
      continue;
    }
    const dest = path.join(ldir, name);
    fs.copyFileSync(f, dest);
    if (!k) continue;
    const size = fs.statSync(dest).size, sha256 = hashFile(dest);
    const osOf = k.plat.startsWith("mac") ? "mac" : k.plat;
    const signed = signedByName.has(name) ? signedByName.get(name) : osOf === "linux" ? sumsSigned : signedPlat.has(osOf);
    const entry = { url: `${baseUrl}/launcher/${lver}/${encodeURIComponent(name)}`, size, sha256, signed, name };
    if (k.kind === "installer") lfiles[k.plat] = entry; else extra.push({ platform: k.plat, kind: k.kind, ...entry });
  }
  // STABLE-NAMED copies (the website links to these): launcher/latest/<fixed name>
  const STABLE = { win: "SwordAndSeal-Launcher-Setup.exe", mac: "SwordAndSeal-Launcher.dmg", linux: "SwordAndSeal-Launcher.AppImage" };
  const stableDir = path.join(lroot, "latest");
  fs.rmSync(stableDir, { recursive: true, force: true });
  const stable = {};
  for (const [p, fixed] of Object.entries(STABLE)) {
    if (!lfiles[p]) continue;
    fs.mkdirSync(stableDir, { recursive: true });
    fs.copyFileSync(path.join(ldir, lfiles[p].name), path.join(stableDir, fixed));
    stable[p] = `${baseUrl}/launcher/latest/${fixed}`;
  }
  for (const p of ["win", "mac", "linux"]) if (!lfiles[p]) console.warn(`WARNING: no ${p} launcher installer found in ${launcherDir}`);
  if (!Object.keys(lfiles).length) { console.error(`No launcher installers found in ${launcherDir}`); process.exit(1); }
  const latestJson = { version: lver, releasedAt, files: lfiles, stable };
  if (extra.length) latestJson.extra = extra;
  if (sumsDir) {
    for (const n of ["SHA256SUMS", "SHA256SUMS.asc"]) if (fs.existsSync(path.join(sumsDir, n))) fs.copyFileSync(path.join(sumsDir, n), path.join(ldir, n));
    if (fs.existsSync(path.join(ldir, "SHA256SUMS"))) latestJson.checksums = { url: `${baseUrl}/launcher/${lver}/SHA256SUMS`, ...(sumsSigned ? { signature: `${baseUrl}/launcher/${lver}/SHA256SUMS.asc` } : {}) };
  }
  const body = JSON.stringify(latestJson, null, 2) + "\n";
  fs.writeFileSync(path.join(ldir, "release.json"), body);   // per-version copy: used by publish-release --rollback
  fs.writeFileSync(path.join(lroot, "latest.json"), body);
  launcherInfo = { version: lver, dir: path.relative(root, ldir), signed: Object.fromEntries(Object.entries(lfiles).map(([k, v]) => [k, v.signed])) };
}

const total = entries.reduce((s, e) => s + e.size, 0);
console.log(`Release ${version}: ${entries.length} files, ${(total / 1048576).toFixed(1)} MB${gzip ? " (gzip assets)" : ""}`);
console.log(`  ${path.relative(root, relDir)}/   and   ${path.relative(root, latestDir)}/   and   ${path.relative(root, path.join(outRoot, "news.json"))}`);
if (launcherInfo) console.log(`Launcher ${launcherInfo.version}: ${launcherInfo.dir}/  signed=${JSON.stringify(launcherInfo.signed)}`);
console.log(`Publish with: DL_ADMIN_TOKEN=... node scripts/publish-release.mjs --dir ${path.relative(root, outRoot) || "."}   (add --dry-run first)`);
