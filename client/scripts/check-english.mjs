// Fails if any CJK character appears in player-facing sources or the built client.
// Usage: node scripts/check-english.mjs [--dist <dir>] [--no-dist]   (default dist: client/dist)
// Range: U+3000-303F (CJK punctuation), U+3400-4DBF (Ext A), U+4E00-9FFF (unified), U+FF00-FFEF (full-width forms).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, "..");
const root = path.resolve(client, "..");
const c = (n) => String.fromCharCode(n);
const CJK = new RegExp(`[${c(0x3000)}-${c(0x303f)}${c(0x3400)}-${c(0x4dbf)}${c(0x4e00)}-${c(0x9fff)}${c(0xff00)}-${c(0xffef)}]`);

const args = process.argv.slice(2);
const di = args.indexOf("--dist");
const distDir = di >= 0 ? path.resolve(args[di + 1]) : path.join(client, "dist");
const targets = [
  path.join(client, "src"), path.join(client, "index.html"), path.join(client, "scripts"), path.join(client, "electron"),
  path.join(client, "README.md"), path.join(root, "README.md"), path.join(root, "CHANGELOG.md"), path.join(root, "LICENSE-NOTES.md"),
  path.join(root, "VERSION"), path.join(root, "package.json"), path.join(root, "launchers"), path.join(root, "scripts"),
  path.join(root, "docs", "DESIGN.md"), path.join(client, "package.json"),
];
if (!args.includes("--no-dist")) targets.push(distDir);

const TEXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".md", ".txt", ".sh", ".bat", ".svg", ".yml", ".yaml", ""]);
const SKIP_DIRS = new Set(["node_modules", ".git", "release"]);

function* walk(p) {
  let st;
  try { st = fs.statSync(p); } catch { return; }
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(p))) return;
    for (const f of fs.readdirSync(p)) yield* walk(path.join(p, f));
  } else yield p;
}

let hits = 0, files = 0;
const byOwner = new Map();
for (const t of targets) {
  for (const f of walk(t)) {
    if (!TEXT.has(path.extname(f).toLowerCase())) continue;
    files++;
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((ln, i) => {
      if (!CJK.test(ln)) return;
      hits++;
      const rel = path.relative(root, f);
      const m = CJK.exec(ln);
      const col = m.index;
      const from = Math.max(0, col - 30);
      const ctx = ln.slice(from, col + 50).replace(/[^\x20-\x7e]/g, (ch) => `<U+${ch.codePointAt(0).toString(16).toUpperCase()}>`);
      const owner = /^client\/src\/(world|models|vfx|post)\//.test(rel) ? "art" : /^server\//.test(rel) ? "server" : "client";
      byOwner.set(owner, (byOwner.get(owner) ?? 0) + 1);
      console.log(`${rel}:${i + 1}:${col + 1}  ${ctx}`);
    });
  }
}
console.log(`\ncheck-english: scanned ${files} text files${args.includes("--no-dist") ? "" : ` (dist: ${path.relative(root, distDir) || distDir})`}; ${hits} line(s) with CJK characters.`);
if (hits) {
  console.log("By owner: " + [...byOwner].map(([k, v]) => `${k}=${v}`).join(", "));
  process.exit(1);
}
console.log("OK: no CJK characters found.");
