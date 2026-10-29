import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LauncherCore } from "../src/controller.js";
import { loadNews, normalizeNews } from "../src/news.js";
import { authenticate, checkHealth } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { startDevHost } from "../scripts/dev-host.mjs";
import { makeRelease, serve, tmp } from "./helpers.mjs";

test("news: sorted newest first, normalized, cached for offline use", async () => {
  const rel = tmp("rel-"), cache = path.join(tmp("ud-"), "news.json");
  makeRelease(rel, "1.0.0", { "game/a": "x" }, { news: [
    { id: "a", title: "Old", date: "2026-01-01", body: "b" }, { id: "b", title: "New", date: "2026-10-01", body: "<b>x</b>" }, { title: "" }, "junk" ] });
  const srv = await serve(rel);
  const r1 = await loadNews({ releaseBaseUrl: srv.url, cacheFile: cache });
  assert.equal(r1.cached, false); assert.deepEqual(r1.items.map((n) => n.id), ["b", "a"]);
  await srv.close();
  const r2 = await loadNews({ releaseBaseUrl: srv.url, cacheFile: cache });
  assert.equal(r2.cached, true); assert.equal(r2.items.length, 2); assert.ok(r2.error);
  const r3 = await loadNews({ releaseBaseUrl: srv.url, cacheFile: cache + ".missing" });
  assert.deepEqual(r3.items, []);
  assert.throws(() => normalizeNews({}), /array/);
});

test("config: env overrides and file source", () => {
  const c = loadConfig({ LAUNCHER_RELEASE_URL: "http://r/", LAUNCHER_API_URL: "http://a/", LAUNCHER_SERVER_URL: "ws://s" });
  assert.equal(c.releaseBaseUrl, "http://r"); assert.equal(c.apiBaseUrl, "http://a"); assert.equal(c.gameServerUrl, "ws://s");
  assert.match(loadConfig({ LAUNCHER_FILE_SOURCE: "/tmp/x" }).releaseBaseUrl, /^file:\/\/\/tmp\/x$/);
  assert.equal(loadConfig({}).launcherUpdate.enabled, true); assert.match(loadConfig({}).launcherUpdate.url, /^https:\/\/dl\.swordandseal\.com\/launcher\/feed$/);
});

const exited = (core) => new Promise((res) => { const f = (g) => { if (!g.running) { core.off("game", f); res(g); } }; core.on("game", f); });

async function world(files = { "game/scripts/play.mjs": "", "game/a.txt": "hi" }) {
  const rel = tmp("rel-"), ud = tmp("ud-"), tmpDir = tmp("sess-");
  makeRelease(rel, "1.0.0", files, { });
  // stub game: records its argv and the session file content, then exits
  const stub = `import fs from "node:fs"; const a = process.argv.find(x=>x.startsWith("--launcher-session=")).slice(19);
fs.writeFileSync(process.env.STUB_OUT, JSON.stringify({ args: process.argv.slice(2), session: JSON.parse(fs.readFileSync(a,"utf8")), env: process.env.SWORD_AND_SEAL_LAUNCHER })); fs.rmSync(a); process.exit(Number(process.env.STUB_EXIT||0));`;
  makeRelease(rel, "1.0.0", { ...files, "game/scripts/play.mjs": stub });
  const host = await startDevHost({ dir: rel, port: 0, mockApi: true });
  const base = `http://127.0.0.1:${host.address().port}`;
  const core = new LauncherCore({
    config: { ...loadConfig({}), releaseBaseUrl: base, apiBaseUrl: base, gameServerUrl: "ws://game.test:1" },
    userData: ud, launcherVersion: "1.0.0", tmpDir,
  });
  return { core, host, rel, ud, tmpDir, base, close: () => new Promise((r) => { host.closeAllConnections?.(); host.close(r); }) };
}

test("auth against the mock API: register, duplicate, wrong password, validation, health", async () => {
  const w = await world();
  try {
    assert.equal((await authenticate(w.base, "register", "Wanderer", "secret1")).ok, true);
    assert.deepEqual(await authenticate(w.base, "register", "Wanderer", "secret1"), { ok: false, error: "That name is already taken." });
    assert.equal((await authenticate(w.base, "login", "Wanderer", "nope!!")).error, "Wrong name or password.");
    const ok = await authenticate(w.base, "login", "Wanderer", "secret1");
    assert.equal(ok.ok, true); assert.equal(ok.expiresIn, 300); assert.ok(ok.token.length > 10);
    assert.match((await authenticate(w.base, "login", "Wanderer", "abc")).error, /4 to 64/);
    assert.match((await authenticate(w.base, "login", "", "abcd")).error, /account name/);
    const h = await checkHealth(w.base);
    assert.equal(h.online, true); assert.equal(typeof h.latencyMs, "number"); assert.equal(h.players, 1);
    assert.equal((await authenticate("http://127.0.0.1:1", "login", "Wanderer", "secret1")).error, "Cannot reach the account server.");
    assert.equal((await checkHealth("http://127.0.0.1:1")).online, false);
  } finally { await w.close(); }
});

test("full core flow: sign in, install, PLAY spawns the game with a launch session, game exit re-enables PLAY", async () => {
  const w = await world();
  const out = path.join(w.tmpDir, "stub-out.json");
  process.env.STUB_OUT = out; process.env.STUB_EXIT = "0";
  try {
    const { core } = w;
    assert.equal((await core.play()).error, "Sign in first.");
    assert.equal((await core.auth("register", "Wanderer", "secret1")).ok, true);
    assert.equal((await core.refresh()).state, "not-installed");
    assert.match((await core.play()).error, /installed/);
    const r = await core.startUpdate();
    assert.equal(r.ok, true);
    assert.equal(core.update.state, "ready");
    const gameExit = exited(core);
    const p = await core.play();
    assert.equal(p.ok, true); assert.equal(p.kind, "fallback");
    assert.equal(core.phase, "playing");
    assert.equal((await core.play()).ok, false);
    await gameExit;
    assert.equal(core.phase, "idle");
    const rec = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(rec.session.name, "Wanderer"); assert.equal(rec.session.serverUrl, "ws://game.test:1");
    assert.ok(rec.session.token.length > 10); assert.ok(Date.now() - Date.parse(rec.session.createdAt) < 10000);
    assert.match(rec.args[0], /^--launcher-session=.*sword-and-seal-session-.*\.json$/); assert.equal(rec.env, "1");
    assert.equal(fs.readdirSync(w.tmpDir).filter((f) => f.startsWith("sword-and-seal-session")).length, 0, "session file removed");
    // server URL override from settings
    core.setSettings({ serverUrl: "ws://override:9" });
    const ge2 = exited(core);
    await core.play(); await ge2;
    assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).session.serverUrl, "ws://override:9");
    // crash exit code is reported
    process.env.STUB_EXIT = "3";
    const ge3 = exited(core);
    await core.play(); await ge3;
    assert.match(core.error, /closed unexpectedly \(code 3\)/);
    // password never persisted
    const saved = fs.readFileSync(path.join(w.ud, "settings.json"), "utf8");
    assert.ok(!saved.includes("secret1")); assert.ok(saved.includes("Wanderer"));
  } finally { await w.close(); delete process.env.STUB_OUT; delete process.env.STUB_EXIT; }
});

test("core: offline start keeps PLAY available for an installed game, news falls back to cache", async () => {
  const w = await world();
  const { core } = w;
  await core.auth("register", "Offliner", "secret1");
  await core.startUpdate(); await core.getNews();
  await w.close();
  const u = await core.refresh();
  assert.equal(u.state, "ready"); assert.equal(core.offline, true); assert.match(core.error, /Cannot reach the update server/);
  const n = await core.getNews();
  assert.equal(n.cached, true); assert.ok(n.items.length >= 1);
});

test("core: remember-me stores only the name; logout clears the session", async () => {
  const w = await world();
  try {
    await w.core.auth("register", "Rememberer", "secret1");
    assert.equal(w.core.settings.get().lastName, "Rememberer");
    w.core.settings.set({ remember: false });
    assert.equal(w.core.settings.get().lastName, "");
    w.core.logout(); assert.equal(w.core.session, null);
    assert.equal((await w.core.play()).error, "Sign in first.");
  } finally { await w.close(); }
});

test("news: optional tag, banner and summary survive normalization and are length-capped", () => {
  const [a] = normalizeNews([{ id: "x", title: "T", date: "2026-10-28", body: "b", tag: "Guide", banner: "scroll", summary: "s".repeat(500) }]);
  assert.equal(a.tag, "Guide"); assert.equal(a.banner, "scroll"); assert.equal(a.summary.length, 300);
  const [b] = normalizeNews([{ id: "y", title: "No extras" }]);
  assert.equal(b.tag, ""); assert.equal(b.banner, ""); assert.equal(b.summary, "");
});
