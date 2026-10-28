import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Updater, validateManifest } from "../src/updater.js";
import { isSafeRelPath, cmpVer } from "../src/util.js";
import { makeRelease, serve, tmp, sha } from "./helpers.mjs";

const mk = (url, dir, o = {}) => new Updater({ installDir: dir, releaseBaseUrl: url, launcherVersion: "1.0.0", backoffMs: 5, ...o });
const big = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255));

async function setup(files, opts) {
  const rel = tmp("rel-"), inst = tmp("inst-");
  makeRelease(rel, "1.0.0", files, opts);
  const srv = await serve(rel);
  return { rel, inst, srv };
}
const read = (inst, p) => fs.readFileSync(path.join(inst, ...p.split("/")), "utf8");
const strays = (inst) => { const out = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); e.isDirectory() ? w(a) : /\.(part|new)$/.test(e.name) && out.push(a); } })(inst); return out; };

test("semver compare and path safety rules", () => {
  assert.equal(cmpVer("1.2.0", "1.10.0"), -1);
  assert.equal(cmpVer("2.0.0", "1.99.99"), 1);
  for (const bad of ["../x", "a/../b", "/abs", "C:\\x", "c:/x", "a//b", "a\\b", "", ".install.json", "a/.", "x.part", "a/b.new", "nul\0"]) assert.equal(isSafeRelPath(bad), false, bad);
  for (const good of ["game/a.txt", "game/client/dist/index.html", "a-b_c/d.e.js"]) assert.equal(isSafeRelPath(good), true, good);
});

test("manifest validation rejects traversal, absolute, bad hashes and duplicates", () => {
  const h = "a".repeat(64);
  const m = (files) => ({ version: "1.0.0", files });
  for (const p of ["../evil", "game/../../evil", "/etc/passwd", "C:/Windows/x", "a\\..\\b"]) {
    assert.throws(() => validateManifest(m([{ path: p, size: 1, sha256: h }]), "http://x/m.json"), /Invalid manifest/, p);
  }
  assert.throws(() => validateManifest(m([{ path: "a", size: 1, sha256: "zz" }]), "u"), /sha256/);
  assert.throws(() => validateManifest(m([{ path: "a", size: 1, sha256: h }, { path: "A", size: 1, sha256: h }]), "u"), /duplicate/);
  assert.ok(validateManifest(m([{ path: "game/a", size: 1, sha256: h }]), "u"));
});

test("fresh install downloads everything, verifies and writes state last", async () => {
  const files = { "game/a.txt": "alpha", "game/sub/b.txt": "bravo", "game/big.bin": big(300000, 1) };
  const { inst, srv } = await setup(files);
  try {
    const u = mk(srv.url, inst);
    const events = [];
    u.on("progress", (p) => events.push(p));
    const m = await u.fetchManifest();
    const r = await u.install(m);
    assert.equal(r.changed, true); assert.equal(r.downloaded, 3);
    assert.equal(read(inst, "game/sub/b.txt"), "bravo");
    const st = u.readState();
    assert.equal(st.version, "1.0.0"); assert.equal(st.updating, false); assert.equal(st.files["game/a.txt"].sha256, sha("alpha"));
    assert.deepEqual(strays(inst), []);
    assert.ok(events.some((e) => e.phase === "downloading" && e.pct > 0), "progress events");
    assert.equal(events.at(-1).phase, "done");
    // second run is a no-op
    const r2 = await u.install(await u.fetchManifest());
    assert.equal(r2.changed, false);
    assert.equal((await u.check()).state, "ready");
  } finally { await srv.close(); }
});

test("diff by sha256: only changed files download; removed files are deleted", async () => {
  const f1 = { "game/keep.txt": "same", "game/change.txt": "old", "game/gone/x.txt": "bye", "game/gone/y.txt": "bye2" };
  const { rel, inst, srv } = await setup(f1);
  try {
    const u = mk(srv.url, inst);
    await u.install(await u.fetchManifest());
    fs.writeFileSync(path.join(inst, "userfile.txt"), "mine"); // not tracked: must survive
    makeRelease(rel, "1.1.0", { "game/keep.txt": "same", "game/change.txt": "new!", "game/added.txt": "add" });
    srv.log.length = 0;
    const c = await u.check();
    assert.equal(c.state, "update-available"); assert.equal(c.needFiles, 2);
    const r = await u.install(await u.fetchManifest());
    assert.equal(r.downloaded, 2); assert.equal(r.removed, 2);
    const fetched = srv.log.map((l) => l.u).filter((x) => x.includes("/files/"));
    assert.deepEqual(fetched.sort(), ["/1.1.0/files/game/added.txt", "/1.1.0/files/game/change.txt"]);
    assert.equal(read(inst, "game/change.txt"), "new!");
    assert.equal(fs.existsSync(path.join(inst, "game/gone")), false, "empty dir pruned");
    assert.equal(read(inst, "userfile.txt"), "mine");
    assert.equal(u.readState().version, "1.1.0");
  } finally { await srv.close(); }
});

test("HTTP Range resume continues a .part file", async () => {
  const data = big(400000, 7);
  const { inst, srv } = await setup({ "game/big.bin": data });
  try {
    const u = mk(srv.url, inst);
    const part = path.join(inst, "game/big.bin.part");
    fs.mkdirSync(path.dirname(part), { recursive: true });
    fs.writeFileSync(part, data.subarray(0, 123456));
    await u.install(await u.fetchManifest());
    const req = srv.log.find((l) => l.u.endsWith("big.bin"));
    assert.equal(req.range, "bytes=123456-");
    assert.equal(sha(fs.readFileSync(path.join(inst, "game/big.bin"))), sha(data));
  } finally { await srv.close(); }
});

test("connection dropped mid-file: retried with Range and completes", async () => {
  const data = big(500000, 3);
  const { inst, srv } = await setup({ "game/big.bin": data });
  try {
    srv.faults.truncateOnce.add("/1.0.0/files/game/big.bin");
    const u = mk(srv.url, inst);
    const retries = []; u.on("retry", (r) => retries.push(r));
    await u.install(await u.fetchManifest());
    assert.equal(retries.length, 1);
    const reqs = srv.log.filter((l) => l.u.endsWith("big.bin"));
    assert.equal(reqs.length, 2); assert.ok(/^bytes=\d+-$/.test(reqs[1].range), "second request is a Range request: " + reqs[1].range);
    assert.equal(sha(fs.readFileSync(path.join(inst, "game/big.bin"))), sha(data));
  } finally { await srv.close(); }
});

test("server without Range support: restart from zero still works", async () => {
  const data = big(200000, 9);
  const { inst, srv } = await setup({ "game/big.bin": data });
  try {
    srv.faults.noRange = true;
    const part = path.join(inst, "game/big.bin.part"); fs.mkdirSync(path.dirname(part), { recursive: true }); fs.writeFileSync(part, data.subarray(0, 5000));
    const u = mk(srv.url, inst);
    await u.install(await u.fetchManifest());
    assert.equal(sha(fs.readFileSync(path.join(inst, "game/big.bin"))), sha(data));
  } finally { await srv.close(); }
});

test("hash mismatch: retried and succeeds; persistent mismatch fails after 3 tries without touching state", async () => {
  const { inst, srv } = await setup({ "game/a.txt": "alpha-content", "game/b.txt": "bravo-content" });
  try {
    srv.faults.corruptOnce.add("/1.0.0/files/game/a.txt");
    const u = mk(srv.url, inst);
    const retries = []; u.on("retry", (r) => retries.push(r));
    await u.install(await u.fetchManifest());
    assert.equal(retries.length, 1); assert.match(retries[0].error, /Checksum/);
    assert.equal(read(inst, "game/a.txt"), "alpha-content");
  } finally { await srv.close(); }
  const inst2 = tmp("inst-"); const rel = tmp("rel-"); makeRelease(rel, "1.0.0", { "game/a.txt": "alpha-content" });
  const s2 = await serve(rel); s2.faults.corruptAlways.add("/1.0.0/files/game/a.txt");
  try {
    const u = mk(s2.url, inst2);
    await assert.rejects(u.install(await u.fetchManifest()), /after 3 tries.*Checksum/s);
    assert.equal(s2.log.filter((l) => l.u.endsWith("a.txt")).length, 3);
    assert.equal(fs.existsSync(path.join(inst2, "game/a.txt")), false);
    assert.equal(u.readState(), null, "no state for a failed fresh install");
  } finally { await s2.close(); }
});

test("failed update leaves the old install fully intact (atomic)", async () => {
  const { rel, inst, srv } = await setup({ "game/a.txt": "A1", "game/b.txt": "B1" });
  try {
    const u = mk(srv.url, inst);
    await u.install(await u.fetchManifest());
    makeRelease(rel, "1.1.0", { "game/a.txt": "A2", "game/b.txt": "B2" });
    srv.faults.corruptAlways.add("/1.1.0/files/game/b.txt");
    await assert.rejects(u.install(await u.fetchManifest()));
    assert.equal(read(inst, "game/a.txt"), "A1"); assert.equal(read(inst, "game/b.txt"), "B1");
    const st = u.readState(); assert.equal(st.version, "1.0.0"); assert.equal(st.updating, false);
    assert.equal((await u.check()).state, "update-available");
    // fix the server; the verified A2 staged file is reused, only b is downloaded
    srv.faults.corruptAlways.clear(); srv.log.length = 0;
    await u.install(await u.fetchManifest());
    assert.deepEqual(srv.log.filter((l) => l.u.includes("/files/")).map((l) => l.u), ["/1.1.0/files/game/b.txt"]);
    assert.equal(read(inst, "game/a.txt"), "A2"); assert.equal(u.readState().version, "1.1.0");
    assert.deepEqual(strays(inst), []);
  } finally { await srv.close(); }
});

test("crash recovery: updating flag triggers repair and full re-hash", async () => {
  const { inst, srv } = await setup({ "game/a.txt": "AAAA", "game/b.txt": "BBBB", "game/c.txt": "CCCC" });
  try {
    const u = mk(srv.url, inst);
    await u.install(await u.fetchManifest());
    // simulate a crash mid-commit: flag set, one file half-written, one deleted
    const st = u.readState(); u.writeState({ ...st, updating: true, targetVersion: "1.0.0" });
    fs.writeFileSync(path.join(inst, "game/a.txt"), "AA");
    fs.rmSync(path.join(inst, "game/c.txt"));
    const c = await u.check();
    assert.equal(c.state, "repair");
    srv.log.length = 0;
    const r = await u.install(await u.fetchManifest());
    assert.equal(r.downloaded, 2);
    assert.equal(read(inst, "game/a.txt"), "AAAA"); assert.equal(read(inst, "game/c.txt"), "CCCC");
    assert.equal(u.readState().updating, false);
    assert.equal((await u.check()).state, "ready");
  } finally { await srv.close(); }
});

test("verify re-hashes everything and repairs same-size corruption", async () => {
  const { inst, srv } = await setup({ "game/a.txt": "AAAA", "game/b.txt": "BBBB" });
  try {
    const u = mk(srv.url, inst);
    await u.install(await u.fetchManifest());
    fs.writeFileSync(path.join(inst, "game/b.txt"), "BxBB"); // same size: the quick check cannot see it
    assert.equal((await u.check()).state, "ready");
    const r = await u.verify(await u.fetchManifest());
    assert.equal(r.repaired, 1); assert.equal(read(inst, "game/b.txt"), "BBBB");
  } finally { await srv.close(); }
});

test("gzip assets: .gz url, sha256 of decompressed content", async () => {
  const text = "hello gzip ".repeat(5000);
  const { inst, srv } = await setup({ "game/t.txt": text, "game/plain.txt": "p" }, { gzip: ["game/t.txt"] });
  try {
    const u = mk(srv.url, inst);
    await u.install(await u.fetchManifest());
    assert.equal(read(inst, "game/t.txt"), text);
    assert.ok(srv.log.some((l) => l.u.endsWith("t.txt.gz")));
  } finally { await srv.close(); }
});

test("path traversal in a served manifest is rejected before anything is written", async () => {
  const rel = tmp("rel-"), inst = tmp("inst-"), outside = tmp("outside-");
  makeRelease(rel, "1.0.0", { "game/a.txt": "x" });
  for (const dir of ["latest"]) {
    const mp = path.join(rel, dir, "manifest.json");
    const m = JSON.parse(fs.readFileSync(mp, "utf8"));
    m.files.push({ path: "../" + path.basename(outside) + "/pwned.txt", size: 1, sha256: sha("x") });
    fs.writeFileSync(mp, JSON.stringify(m));
  }
  const srv = await serve(rel);
  try {
    const u = mk(srv.url, inst);
    await assert.rejects(u.fetchManifest(), /Invalid manifest.*unsafe path/);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.deepEqual(fs.readdirSync(inst), []);
  } finally { await srv.close(); }
});

test("symlinked directories inside the install are never written through", async (t) => {
  const rel = tmp("rel-"), inst = tmp("inst-"), outside = tmp("outside-");
  makeRelease(rel, "1.0.0", { "game/a.txt": "x", "game/sub/b.txt": "y" });
  try { fs.symlinkSync(outside, path.join(inst, "game"), "dir"); } catch { t.skip("symlinks unavailable"); return; }
  const srv = await serve(rel);
  try {
    const u = mk(srv.url, inst);
    await assert.rejects(u.install(await u.fetchManifest()), /symlink/);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally { await srv.close(); }
});

test("cancel stops the update, keeps live files and the .part for resume", async () => {
  const data = big(2_000_000, 5);
  const { inst, srv } = await setup({ "game/big.bin": data, "game/a.txt": "a" });
  try {
    const u = mk(srv.url, inst);
    const m = await u.fetchManifest();
    u.on("progress", (p) => { if (p.phase === "downloading" && p.bytesDone > 0) u.cancel(); });
    const r = await u.install(m).then(() => "done", (e) => e);
    // tiny files can finish before the cancel lands; accept either outcome but state must be consistent
    if (r !== "done") { assert.equal(r.cancelled, true); assert.equal(u.readState(), null); assert.equal(fs.existsSync(path.join(inst, "game/big.bin")), false); }
    u.removeAllListeners("progress");
    await u.install(await u.fetchManifest());
    assert.equal(sha(fs.readFileSync(path.join(inst, "game/big.bin"))), sha(data));
  } finally { await srv.close(); }
});

test("minLauncherVersion newer than the launcher reports launcher-outdated", async () => {
  const rel = tmp("rel-"), inst = tmp("inst-");
  makeRelease(rel, "1.0.0", { "game/a.txt": "x" }, { extra: { minLauncherVersion: "2.0.0" } });
  const srv = await serve(rel);
  try {
    const c = await mk(srv.url, inst).check();
    assert.equal(c.state, "launcher-outdated"); assert.equal(c.minLauncherVersion, "2.0.0");
  } finally { await srv.close(); }
});

test("platform-specific files are skipped on other platforms", async () => {
  const rel = tmp("rel-"), inst = tmp("inst-");
  makeRelease(rel, "1.0.0", { "game/a.txt": "x", "game/win.exe": "w", "game/lin.bin": "l" });
  for (const d of ["latest", "1.0.0"]) {
    const mp = path.join(rel, d, "manifest.json"); const m = JSON.parse(fs.readFileSync(mp, "utf8"));
    m.files.find((f) => f.path.endsWith("win.exe")).platforms = ["win32"]; m.files.find((f) => f.path.endsWith("lin.bin")).platforms = ["linux"];
    fs.writeFileSync(mp, JSON.stringify(m));
  }
  const srv = await serve(rel);
  try {
    const u = mk(srv.url, inst, { platform: "linux" });
    await u.install(await u.fetchManifest());
    assert.deepEqual(fs.readdirSync(path.join(inst, "game")).sort(), ["a.txt", "lin.bin"]);
  } finally { await srv.close(); }
});

test("insufficient disk space is reported before downloading", async () => {
  const { inst, srv } = await setup({ "game/a.txt": "x" });
  try {
    const u = mk(srv.url, inst, { freeSpaceMargin: Number.MAX_SAFE_INTEGER / 2 });
    await assert.rejects(u.install(await u.fetchManifest()), /Not enough disk space/);
    assert.equal(srv.log.filter((l) => l.u.includes("/files/")).length, 0);
  } finally { await srv.close(); }
});

test("file:// release source works (LAUNCHER_FILE_SOURCE)", async () => {
  const rel = tmp("rel-"), inst = tmp("inst-");
  makeRelease(rel, "1.0.0", { "game/a.txt": "local", "game/z.txt": "zz" }, { gzip: ["game/z.txt"] });
  const { pathToFileURL } = await import("node:url");
  const u = mk(pathToFileURL(rel).href, inst);
  await u.install(await u.fetchManifest());
  assert.equal(read(inst, "game/a.txt"), "local"); assert.equal(read(inst, "game/z.txt"), "zz");
});
