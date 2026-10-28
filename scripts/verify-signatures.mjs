#!/usr/bin/env node
// Verifies code signatures of the installers produced in CI and writes signing-<os>.json = {os, files:{<name>:{signed:boolean, detail}}}.
// make-release.mjs reads these (--signing-report) to set "signed" in launcher/latest.json. Never fails the build: unsigned is a valid result
// unless --require is given (CI passes it when REQUIRE_SIGNING=1).
// Usage: node scripts/verify-signatures.mjs --os win|mac|linux --dir <folder with installers> --out signing-win.json [--require]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const osName = opt("os"), dir = path.resolve(opt("dir", ".")), out = opt("out", `signing-${osName}.json`), require_ = argv.includes("--require");
if (!["win", "mac", "linux"].includes(osName)) { console.error("--os win|mac|linux"); process.exit(2); }
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : [];
const result = {};

if (osName === "win") {
  for (const f of files.filter((x) => /\.exe$/i.test(x))) {
    const r = sh("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$s = Get-AuthenticodeSignature -LiteralPath '${path.join(dir, f).replace(/'/g, "''")}'; Write-Output ($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)`]);
    const line = (r.stdout || "").trim();
    result[f] = { signed: line.startsWith("Valid|"), detail: line || (r.stderr || "").trim().slice(0, 200) };
  }
} else if (osName === "mac") {
  for (const f of files.filter((x) => /\.dmg$/i.test(x))) {
    const mnt = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || "/tmp", "dmgv-"));
    const att = sh("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mnt, path.join(dir, f)]);
    let detail = "mount failed", signed = false;
    if (att.status === 0) {
      const app = fs.readdirSync(mnt).find((x) => x.endsWith(".app"));
      if (app) {
        const ap = path.join(mnt, app);
        const cs = sh("codesign", ["--verify", "--deep", "--strict", ap]);
        const sp = sh("spctl", ["--assess", "--type", "execute", "--verbose=2", ap]);   // accepts only Developer ID + notarized
        const st = sh("xcrun", ["stapler", "validate", ap]);
        signed = cs.status === 0 && sp.status === 0;
        detail = `codesign=${cs.status} spctl=${sp.status} stapler=${st.status}`;
      }
      sh("hdiutil", ["detach", mnt, "-force"]);
    }
    result[f] = { signed, detail };
    const zip = f.replace(/\.dmg$/i, "-mac.zip");   // same app inside the zip: same verdict
    if (files.includes(zip)) result[zip] = { signed, detail: "same app as " + f };
  }
} else {
  const sums = path.join(dir, "SHA256SUMS"), asc = path.join(dir, "SHA256SUMS.asc");
  let ok = false, detail = "no SHA256SUMS.asc";
  if (fs.existsSync(sums) && fs.existsSync(asc)) { const r = sh("gpg", ["--verify", asc, sums]); ok = r.status === 0; detail = ok ? "gpg verify ok" : "gpg verify failed"; }
  for (const f of files.filter((x) => /\.AppImage$/.test(x))) result[f] = { signed: ok, detail };
}

fs.writeFileSync(out, JSON.stringify({ os: osName, checkedAt: new Date().toISOString(), files: result }, null, 2) + "\n");
for (const [n, v] of Object.entries(result)) console.log(`${v.signed ? "SIGNED  " : "unsigned"} ${n}  (${v.detail})`);
if (!Object.keys(result).length) console.log(`no ${osName} installers found in ${dir}`);
if (require_ && (!Object.keys(result).length || Object.values(result).some((v) => !v.signed))) { console.error("REQUIRE_SIGNING: at least one artifact is not validly signed."); process.exit(1); }
