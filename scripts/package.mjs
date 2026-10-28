// Builds the player release: dist-package/jiuzhou-v<VERSION>/ and .zip
// Usage: node scripts/package.mjs [--skip-client-build]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, cwd = root) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error("FAILED:", cmd, args.join(" ")); process.exit(1); }
};
const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
const name = `jiuzhou-v${version}`;
const outRoot = path.join(root, "dist-package");
const rel = path.join(outRoot, name);

if (!process.argv.includes("--skip-client-build")) run("npm", ["--prefix", "client", "run", "build"]);
run(process.execPath, [path.join("scripts", "build-server.mjs")]);

fs.rmSync(rel, { recursive: true, force: true });
fs.rmSync(rel + ".zip", { force: true });
const cp = (from, to, filter) => fs.cpSync(path.join(root, from), path.join(rel, to), { recursive: true, filter });
fs.mkdirSync(rel, { recursive: true });
cp("client/dist", "client/dist");
cp("client/electron", "client/electron");
fs.copyFileSync(path.join(root, "client/package.json"), path.join(rel, "client/package.json"));
// server: single self-contained bundle (ws is bundled in; only Node >= 22.5 is needed)
cp("server/dist/server.mjs", "server/dist/server.mjs");
cp("server/package.json", "server/package.json");
cp("server/package-lock.json", "server/package-lock.json");
cp("server/src", "server/src");   // readable source for modders (not used at runtime)
cp("shared", "shared");
cp("scripts/play.mjs", "scripts/play.mjs");
cp("launchers", "launchers");
for (const f of ["README.md", "LICENSE-NOTES.md", "VERSION"]) fs.copyFileSync(path.join(root, f), path.join(rel, f));
fs.writeFileSync(path.join(rel, "package.json"), JSON.stringify({ name: "jiuzhou", version, private: true, type: "module", scripts: { start: "node scripts/play.mjs" }, engines: { node: ">=22.5" } }, null, 2) + "\n");

// zip: prefer `zip`, fall back to python3
const zipPath = rel + ".zip";
let z = spawnSync("zip", ["-qr", zipPath, name], { cwd: outRoot });
if (z.error || z.status !== 0) {
  z = spawnSync("python3", ["-c", "import shutil,sys;shutil.make_archive(sys.argv[1],'zip',sys.argv[2],sys.argv[3])", zipPath.replace(/\.zip$/, ""), outRoot, name]);
  if (z.status !== 0) { console.error("zip failed"); process.exit(1); }
}
let count = 0; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : count++; })(rel);
console.log(`\nRelease: ${path.relative(root, rel)}  (${count} files)\nZip: ${path.relative(root, zipPath)}  (${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB)`);
