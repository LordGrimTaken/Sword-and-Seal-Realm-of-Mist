// Builds the player release: dist-package/jiuzhou-v<VERSION>/ and .zip
// Usage: node scripts/package.mjs [--skip-client-build]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// On Windows npm/npx are .cmd shims and need a shell, but a direct executable path (process.execPath) must NOT go
// through cmd.exe: its path usually contains spaces ("C:\Program Files\nodejs\node.exe") and would be split there.
const needsShell = (cmd) => process.platform === "win32" && !path.isAbsolute(cmd) && !/\.exe$/i.test(cmd);
const run = (cmd, args, cwd = root) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: needsShell(cmd) });
  if (r.error) { console.error("FAILED:", cmd, args.join(" "), "-", r.error.message); process.exit(1); }
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

// ---- portable zip writer -------------------------------------------------------------------------------------------
// `zip` and `python3` are both optional and absent on a plain Windows box (there is no `zip` command, and the
// `python3` app-execution alias only opens the Microsoft Store), so the release archive must not depend on them.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Write `srcDir` as a .zip at `zipPath`; every entry is prefixed with `entryRoot/` (like `zip -qr out.zip entryRoot`). */
function writeZip(srcDir, zipPath, entryRoot) {
  const files = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, e.name), rp = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, rp);
      else if (e.isFile()) files.push({ name: `${entryRoot}/${rp}`, data: fs.readFileSync(abs) });
    }
  })(srcDir, "");
  if (files.length > 0xffff) throw new Error(`too many files for a non-Zip64 archive: ${files.length}`);
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const deflated = zlib.deflateRawSync(f.data, { level: 9 });
    const method = deflated.length < f.data.length ? 8 : 0;
    const payload = method === 8 ? deflated : f.data;
    if (offset > 0xffffffff || payload.length > 0xffffffff || f.data.length > 0xffffffff) throw new Error(`too large for a non-Zip64 archive: ${f.name}`);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(method, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(payload.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, payload);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(payload.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + payload.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  fs.writeFileSync(zipPath, Buffer.concat([...local, cdBuf, eocd]));
}

// zip: prefer a system `zip`, then `python3`, then the built-in writer (both tools are optional).
const zipPath = rel + ".zip";
let zipped = false;
let z = spawnSync("zip", ["-qr", zipPath, name], { cwd: outRoot });
if (!z.error && z.status === 0) zipped = true;
else if (z.error) console.log(`zip: ${z.error.code ?? z.error.message}`);
if (!zipped) {
  z = spawnSync("python3", ["-c", "import shutil,sys;shutil.make_archive(sys.argv[1],'zip',sys.argv[2],sys.argv[3])", zipPath.replace(/\.zip$/, ""), outRoot, name]);
  if (!z.error && z.status === 0) zipped = true;
  else if (z.error) console.log(`python3: ${z.error.code ?? z.error.message}`);
}
if (!zipped) {
  console.log("zip/python3 unavailable - writing the archive with the built-in zip writer.");
  writeZip(rel, zipPath, name);
}
let count = 0; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : count++; })(rel);
console.log(`\nRelease: ${path.relative(root, rel)}  (${count} files)\nZip: ${path.relative(root, zipPath)}  (${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB)`);
