// End-to-end test of scripts/publish-release.mjs against test/fake-dl.mjs (port 8822 by default; override FAKE_DL_PORT).
// Run: node --test test/publish-release.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startFakeDl } from "./fake-dl.mjs";
import { contentType, planUploads } from "../scripts/publish-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "publish-release.mjs");
const PORT = Number(process.env.FAKE_DL_PORT || 8822);
const TOKEN = "t0k3n-for-tests";

function buildRelease(dir, gameV, launcherV) {
  const w = (k, c) => { const f = path.join(dir, k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  const files = [{ path: "game/a.js", body: `alert(${gameV})` }, { path: "game/b.bin", body: crypto.randomBytes(5000) }];
  for (const f of files) w(`game/${gameV}/files/${f.path}`, f.body);
  const manifest = { version: gameV, files: files.map((f) => ({ path: f.path, size: Buffer.from(f.body).length, sha256: "x" })) };
  w(`game/${gameV}/manifest.json`, JSON.stringify(manifest)); w(`game/${gameV}/news.json`, "[]");
  w("game/latest/manifest.json", JSON.stringify({ ...manifest, filesBase: `../${gameV}/files/` })); w("game/latest/news.json", "[]"); w("news.json", "[]");
  const inst = { win: `SwordAndSeal-Launcher-Setup-${launcherV}.exe`, mac: `SwordAndSeal-Launcher-${launcherV}.dmg`, linux: `SwordAndSeal-Launcher-${launcherV}.AppImage` };
  const rel = { version: launcherV, releasedAt: "2026-01-01T00:00:00Z", files: {} };
  for (const [p, n] of Object.entries(inst)) { const b = crypto.randomBytes(3000); w(`launcher/${launcherV}/${n}`, b); w(`launcher/latest/${{ win: "SwordAndSeal-Launcher-Setup.exe", mac: "SwordAndSeal-Launcher.dmg", linux: "SwordAndSeal-Launcher.AppImage" }[p]}`, b); rel.files[p] = { url: `x/${n}`, size: b.length, sha256: "x", signed: false, name: n }; }
  w(`launcher/${launcherV}/release.json`, JSON.stringify(rel)); w("launcher/latest.json", JSON.stringify(rel));
  w(`launcher/${launcherV}/latest.yml`, `version: ${launcherV}\nfiles:\n  - url: ${inst.win}\npath: ${inst.win}\n`); w("launcher/feed/latest.yml", `version: ${launcherV}\nfiles:\n  - url: ../${launcherV}/${inst.win}\n`);
  return manifest;
}
const run = (args, env = {}) => new Promise((resolve) => {   // async: the fake host lives in this process, so never block the event loop
  const c = spawn(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env } });
  let stdout = "", stderr = "";
  c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
  c.on("close", (status) => resolve({ status, stdout, stderr }));
});

test("content types and phase planning", () => {
  assert.equal(contentType("a/b.json"), "application/json");
  assert.equal(contentType("x/Setup.exe"), "application/vnd.microsoft.portable-executable");
  assert.equal(contentType("x/a.dmg"), "application/x-apple-diskimage");
  assert.equal(contentType("x/a.AppImage"), "application/octet-stream");
  assert.equal(contentType("game/1/files/a.js.gz"), "application/gzip");
  assert.equal(contentType("launcher/1/SHA256SUMS"), "text/plain");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-plan-")); buildRelease(tmp, "1.0.0", "2.0.0");
  const p = planUploads(tmp);
  assert.ok(p.versioned.every((x) => !/^(game\/latest\/|launcher\/latest|launcher\/feed\/)/.test(x.key)));
  assert.deepEqual(p.pointers.map((x) => x.key).slice(-2), ["launcher/latest.json", "news.json"]);
  assert.equal(p.stable.length, 3);
});

test("publish, verify, retry, dry-run, keep, rollback", async (t) => {
  let flaky = 0, blockKey = null;
  const fake = await startFakeDl({ port: PORT, token: TOKEN, failPut: (key) => (blockKey && key.startsWith(blockKey)) || (key.endsWith("game/1.0.0/files/game/a.js") && flaky++ < 2) });
  t.after(() => fake.close());
  const env = { DL_ADMIN_TOKEN: TOKEN, DL_HOST: fake.url };

  // unauthenticated admin access is rejected
  assert.equal((await fetch(`${fake.url}/_admin`)).status, 401);
  // no token -> refuses (not dry-run); token as argument -> refuses
  assert.notEqual((await run(["--dir", "x"], { DL_HOST: fake.url })).status, 0);
  assert.notEqual((await run(["--token", TOKEN], env)).status, 0);

  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), "pr-r1-")); buildRelease(d1, "1.0.0", "1.0.0");
  const dry = await run(["--dir", d1, "--dry-run"], { DL_HOST: fake.url });
  assert.equal(dry.status, 0, dry.stderr); assert.equal(fake.store.size, 0); assert.match(dry.stdout, /game\/latest\/manifest.json/);

  const r1 = await run(["--dir", d1], env);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.ok(!r1.stdout.includes(TOKEN) && !r1.stderr.includes(TOKEN), "token leaked to output");
  assert.match(r1.stdout, /retry/);   // the two 503s were retried
  assert.equal(fake.store.get("game/latest/manifest.json").type, "application/json");
  assert.equal(fake.store.get("launcher/latest/SwordAndSeal-Launcher-Setup.exe").type, "application/vnd.microsoft.portable-executable");
  // pointers written after every versioned file
  const order = fake.stats.puts, lastVersioned = Math.max(...order.map((k, i) => (/^game\/1\.0\.0\/|^launcher\/1\.0\.0\//.test(k) ? i : -1)));
  assert.ok(order.indexOf("game/latest/manifest.json") > lastVersioned);
  assert.ok(order.indexOf("launcher/latest.json") > order.indexOf("game/latest/manifest.json"));
  assert.equal(order[order.length - 1], "releases.json");

  // second and third versions, then --keep 2
  for (const v of ["1.1.0", "1.2.0"]) { const d = fs.mkdtempSync(path.join(os.tmpdir(), "pr-r-")); buildRelease(d, v, v); const r = await run(["--dir", d, ...(v === "1.2.0" ? ["--keep", "2"] : [])], env); assert.equal(r.status, 0, r.stdout + r.stderr); }
  assert.ok(![...fake.store.keys()].some((k) => k.startsWith("game/1.0.0/") || k.startsWith("launcher/1.0.0/")), "1.0.0 pruned");
  assert.ok(fake.store.has("game/1.1.0/manifest.json") && fake.store.has("game/1.2.0/manifest.json"));
  assert.deepEqual(JSON.parse(fake.store.get("releases.json").body).game, ["1.1.0", "1.2.0"]);

  // rollback game + launcher to 1.1.0
  const rb = await run(["--rollback", "1.1.0", "--rollback-launcher", "1.1.0"], env);
  assert.equal(rb.status, 0, rb.stdout + rb.stderr);
  const m = JSON.parse(fake.store.get("game/latest/manifest.json").body);
  assert.equal(m.version, "1.1.0"); assert.equal(m.filesBase, "../1.1.0/files/");
  assert.equal(JSON.parse(fake.store.get("launcher/latest.json").body).version, "1.1.0");
  assert.match(fake.store.get("launcher/feed/latest.yml").body.toString(), /\.\.\/1\.1\.0\//);
  // rollback to a pruned version is refused and changes nothing
  const before = fake.store.get("game/latest/manifest.json").body.toString();
  assert.notEqual((await run(["--rollback", "1.0.0"], env)).status, 0);
  assert.equal(fake.store.get("game/latest/manifest.json").body.toString(), before);

  // a permanently failing upload leaves the pointers untouched
  const d4 = fs.mkdtempSync(path.join(os.tmpdir(), "pr-r4-")); buildRelease(d4, "1.3.0", "1.3.0");
  blockKey = "game/1.3.0/files/game/b.bin";
  const pointerBefore = fake.store.get("game/latest/manifest.json").body.toString();
  const bad = await run(["--dir", d4, "--retries", "1"], env);
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /NOT updated/);
  assert.equal(fake.store.get("game/latest/manifest.json").body.toString(), pointerBefore);
  // wrong token is fatal without retries piling up
  const wrong = await run(["--dir", d4], { DL_ADMIN_TOKEN: "wrong", DL_HOST: fake.url });
  assert.notEqual(wrong.status, 0); assert.ok(!(wrong.stdout + wrong.stderr).includes("wrong-secret"));
});
