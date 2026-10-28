// Headless updater: node launcher/scripts/cli.mjs install|verify|status [--dir <installDir>] [--release <url>] [--file-source <dir>]
import path from "node:path";
import os from "node:os";
import { Updater } from "../src/updater.js";
import { loadConfig } from "../src/config.js";
import { fmtBytes, fmtEta } from "../src/util.js";
import fs from "node:fs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
if (!["install", "verify", "status"].includes(cmd)) {
  console.error("Usage: cli.mjs install|verify|status [--dir <installDir>] [--release <url>] [--file-source <releaseDir>]");
  process.exit(2);
}
const env = { ...process.env };
if (opt("release")) env.LAUNCHER_RELEASE_URL = opt("release");
if (opt("file-source")) env.LAUNCHER_FILE_SOURCE = opt("file-source");
const config = loadConfig(env);
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const installDir = path.resolve(opt("dir") || path.join(os.homedir(), "SwordAndSeal"));
const u = new Updater({ installDir, releaseBaseUrl: config.releaseBaseUrl, launcherVersion: pkg.version });

let last = "";
u.on("progress", (p) => {
  if (p.phase === "downloading") {
    const line = `${(p.pct * 100).toFixed(0).padStart(3)}%  ${fmtBytes(p.bytesDone)}/${fmtBytes(p.bytesTotal)}  ${fmtBytes(p.speed)}/s  ETA ${fmtEta(p.etaSec)}  ${p.filesDone}/${p.filesTotal}  ${p.file}`;
    if (line !== last && process.stdout.isTTY) process.stdout.write("\r" + line.slice(0, 118).padEnd(118)); last = line;
  } else if (p.phase !== last) { last = p.phase; console.log(`\n[${p.phase}]`); }
});
u.on("retry", (r) => console.log(`\nretry ${r.attempt}: ${r.file}: ${r.error}`));
process.on("SIGINT", () => u.cancel());

try {
  if (cmd === "status") {
    const c = await u.check();
    delete c.manifest;
    console.log(JSON.stringify(c, null, 2));
  } else {
    const m = await u.fetchManifest();
    const r = cmd === "verify" ? await u.verify(m) : await u.install(m);
    console.log("\n" + JSON.stringify(r));
  }
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(e.cancelled ? 130 : 1);
}
