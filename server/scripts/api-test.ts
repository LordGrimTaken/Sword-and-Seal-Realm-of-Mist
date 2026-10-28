// Launcher HTTP API + session-token test.
//   npm run test:api             -> unit checks (TokenService with an injected clock, secret persistence) + a spawned TEST_MODE server
//   API_PORT=8806 API_DB=/tmp/s3.db npm run test:api
// The rate-limit section runs last: it blocks 127.0.0.1 on the spawned server for a minute.
import { spawn, type ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "../../shared/protocol.ts";
import { TokenService, loadTokenSecret } from "../src/auth.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.API_PORT) || 8976;
const BASE = `http://127.0.0.1:${PORT}`;
const SUFFIX = String(Date.now() % 100000);
const ORIGIN_OK = "https://launcher.example";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

interface R { status: number; json: any; headers: Headers }
async function post(path: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }): Promise<R> {
  const r = await fetch(BASE + path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  let json: any = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json, headers: r.headers };
}

/** Log in over the game socket; resolves with the first welcome/error. */
function wsLogin(name: string, extra: { tok?: string; pw?: string }): Promise<{ ok: boolean; err?: string; ws: WebSocket }> {
  return new Promise((done) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const t = setTimeout(() => done({ ok: false, err: "timeout", ws }), 5000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "login", name, cls: "sword", v: PROTOCOL_VERSION, ...extra })));
    ws.on("message", (d) => {
      let m: any; try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.t === "welcome") { clearTimeout(t); done({ ok: true, ws }); }
      else if (m.t === "error") { clearTimeout(t); done({ ok: false, err: m.msg, ws }); }
    });
    ws.on("error", () => {});
  });
}

// ------------------------------------------------------------------ unit
function unit() {
  console.log("\n[U] TokenService");
  let clock = 1_800_000_000_000;
  const svc = new TokenService(Buffer.from("unit-test-secret"), () => clock);
  const t1 = svc.issue("Alice");
  check("token shape: two base64url parts", /^[\w-]+\.[\w-]+$/.test(t1));
  const payload = JSON.parse(Buffer.from(t1.split(".")[0], "base64url").toString());
  check("payload has name, exp (now+300 s), jti", payload.name === "Alice" && payload.exp === clock / 1000 + 300 && typeof payload.jti === "string" && payload.jti.length > 8);
  check("token <= 256 chars even for a 16-letter 4-byte name (launcher contract)", svc.issue("\u{1d4d0}".repeat(16)).length <= 256, String(svc.issue("\u{1d4d0}".repeat(16)).length));
  check("valid token accepted for the name, case-insensitively", !!svc.check(t1, "aLiCe"));
  check("check does not consume; redeem consumes once", svc.redeem(t1, "alice") && !svc.redeem(t1, "alice"));
  const t2 = svc.issue("Alice");
  clock += 299_000;
  check("still valid at 299 s", !!svc.check(t2, "Alice"));
  clock += 2_000;
  check("expired after 300 s (injected clock)", !svc.check(t2, "Alice") && !svc.redeem(t2, "Alice"));
  const t3 = svc.issue("Alice");
  check("another name is rejected, and does not burn the token", !svc.redeem(t3, "Bob") && svc.redeem(t3, "Alice"));
  const t4 = svc.issue("Alice");
  const [body, sig] = t4.split(".");
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  check("tampered signature rejected", !svc.check(`${body}.${flipped}`, "Alice"));
  const evil = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), name: "Bob" })).toString("base64url");
  check("tampered payload rejected", !svc.check(`${evil}.${sig}`, "Bob"));
  check("token signed with another secret rejected", !new TokenService(Buffer.from("other-secret"), () => clock).check(t4, "Alice"));
  check("garbage rejected (empty, no dot, non-string, huge)", ["", "abc", "a.b.c", 5, null, undefined, "x".repeat(2000)].every((g) => !svc.check(g, "Alice")));
  const old = svc.issue("Zed"); svc.redeem(old, "Zed"); clock += 400_000;
  svc.redeem(svc.issue("Zed"), "Zed");
  check("used-jti set is pruned after expiry", (svc as any).used.size === 1);

  console.log("\n[U] secret persistence");
  const dir = mkdtempSync(join(tmpdir(), "jz-secret-"));
  const saved = process.env.TOKEN_SECRET; delete process.env.TOKEN_SECRET;
  const warns: string[] = [];
  const a = loadTokenSecret(join(dir, "x.db"), (m) => warns.push(m)), b = loadTokenSecret(join(dir, "x.db"), (m) => warns.push(m));
  check("generated secret is persisted next to the DB and reused after a restart", a.length === 32 && a.equals(b));
  check("warns when TOKEN_SECRET is not set", warns.length === 2 && warns.every((w) => w.includes("TOKEN_SECRET")));
  process.env.TOKEN_SECRET = "from-env-secret"; check("TOKEN_SECRET env wins", loadTokenSecret(join(dir, "x.db"), () => {}).toString() === "from-env-secret");
  if (saved === undefined) delete process.env.TOKEN_SECRET; else process.env.TOKEN_SECRET = saved;
  rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------------------ server
let child: ChildProcess | undefined;
let tmp = "";
async function startServer() {
  tmp = mkdtempSync(join(tmpdir(), "jiuzhou-api-"));
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT), DB_PATH: process.env.API_DB || join(tmp, "api.db"), NODE_NO_WARNINGS: "1", TEST_MODE: "1", CORS_ORIGINS: `${ORIGIN_OK}, https://other.example`, TOKEN_SECRET: "api-test-secret-value" };
  delete env.ALLOW_NULL_ORIGIN;
  child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["src/server.ts"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr!.on("data", (d) => process.stderr.write(`[server!] ${d}`));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* not up */ } await sleep(100); }
  throw new Error("server did not start");
}
async function stopServer() {
  if (!child) return;
  const exited = new Promise<number | null>((r) => child!.once("exit", (c) => r(c)));
  child.kill("SIGTERM");
  const code = await Promise.race([exited, sleep(5000).then(() => "timeout" as const)]);
  check("server shuts down cleanly on SIGTERM", code === 0, `exit=${code}`);
  child = undefined;
}

async function main() {
  unit();
  console.log("\n[S] starting server on", PORT);
  await startServer();
  try {
    const nm = "Api" + SUFFIX;

    console.log("\n[H] /health + CORS");
    const h = await fetch(`${BASE}/health`); const hj: any = await h.json();
    check("GET /health -> {ok:true, players:number, version:string, uptime:number}", h.status === 200 && hj.ok === true && typeof hj.players === "number" && typeof hj.version === "string" && hj.version !== "unknown" && typeof hj.uptime === "number" && hj.uptime >= 0, JSON.stringify({ ...hj, rss: undefined }));
    check("health keeps the existing diagnostic fields", typeof hj.tick === "number" && typeof hj.mobs === "number" && typeof hj.rss === "number");
    const hc = await fetch(`${BASE}/health`, { headers: { origin: ORIGIN_OK } });
    check("configured origin gets Access-Control-Allow-Origin", hc.headers.get("access-control-allow-origin") === ORIGIN_OK);
    const hb = await fetch(`${BASE}/health`, { headers: { origin: "https://evil.example" } });
    check("unlisted origin gets no CORS header", hb.headers.get("access-control-allow-origin") === null);
    const hn = await fetch(`${BASE}/health`, { headers: { origin: "null" } });
    check("'null' origin refused unless ALLOW_NULL_ORIGIN=1", hn.headers.get("access-control-allow-origin") === null);
    const pf = await fetch(`${BASE}/api/auth/login`, { method: "OPTIONS", headers: { origin: ORIGIN_OK, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    check("OPTIONS preflight -> 204 with allow-origin/methods/headers", pf.status === 204 && pf.headers.get("access-control-allow-origin") === ORIGIN_OK && /POST/.test(pf.headers.get("access-control-allow-methods") ?? "") && /content-type/i.test(pf.headers.get("access-control-allow-headers") ?? ""));
    const pfb = await fetch(`${BASE}/api/auth/login`, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    check("preflight from an unlisted origin has no allow-origin", pfb.status === 204 && pfb.headers.get("access-control-allow-origin") === null);
    const pr = await post("/api/auth/login", { name: "Nobody" + SUFFIX, pw: "abcd" }, { "content-type": "application/json", origin: ORIGIN_OK });
    check("CORS header also on API responses (errors too)", pr.headers.get("access-control-allow-origin") === ORIGIN_OK);

    console.log("\n[A] register / login");
    const reg = await post("/api/auth/register", { name: nm, pw: "secret1" });
    check("register -> 200 {ok, token, name, expiresIn:300}", reg.status === 200 && reg.json.ok === true && typeof reg.json.token === "string" && reg.json.name === nm && reg.json.expiresIn === 300, JSON.stringify(reg.json).slice(0, 60));
    check("responses are no-store JSON", reg.headers.get("cache-control") === "no-store" && /application\/json/.test(reg.headers.get("content-type") ?? ""));
    const dup = await post("/api/auth/register", { name: nm.toUpperCase(), pw: "other-pw" });
    check("duplicate register (any case) -> 409 'That name is already taken.'", dup.status === 409 && dup.json.ok === false && dup.json.error === "That name is already taken.", dup.json?.error);
    const lg = await post("/api/auth/login", { name: nm, pw: "secret1" });
    check("login -> 200 with a fresh token", lg.status === 200 && lg.json.ok && lg.json.token && lg.json.token !== reg.json.token && lg.json.expiresIn === 300);
    const nspace = await post("/api/auth/login", { name: "  " + nm.toLowerCase() + " ", pw: "secret1" });
    check("login name is trimmed and case-insensitive", nspace.status === 200 && nspace.json.name === nm.toLowerCase());
    const bad = await post("/api/auth/login", { name: nm, pw: "wrong-pw" });
    check("wrong password -> 401 'Wrong password for that name.'", bad.status === 401 && bad.json.error === "Wrong password for that name.", bad.json?.error);
    const unk = await post("/api/auth/login", { name: "Nobody" + SUFFIX, pw: "abcd" });
    check("unknown name -> 404 'No account with that name. Register first.'", unk.status === 404 && unk.json.error === "No account with that name. Register first.", unk.json?.error);
    const inv = await post("/api/auth/register", { name: "x", pw: "abcd" });
    check("invalid name -> 400 with the in-game text", inv.status === 400 && inv.json.error === "Invalid name (2-16 letters, digits, space, _ or -)", inv.json?.error);
    const shortPw = await post("/api/auth/register", { name: "Short" + SUFFIX, pw: "abc" });
    const longPw = await post("/api/auth/register", { name: "Long" + SUFFIX, pw: "a".repeat(65) });
    check("password must be 4-64 chars", shortPw.status === 400 && longPw.status === 400 && /4-64/.test(shortPw.json.error));
    const okPw64 = await post("/api/auth/register", { name: "Max" + SUFFIX, pw: "a".repeat(64) });
    check("64-char password accepted", okPw64.status === 200);
    const nonStr = await post("/api/auth/login", { name: nm, pw: 12345678 });
    check("non-string pw rejected", nonStr.status === 401 || nonStr.status === 400);

    console.log("\n[E] malformed requests");
    const big = await post("/api/auth/login", { name: nm, pw: "x".repeat(3000) });
    check("oversize body (>2 KB) -> 413", big.status === 413 && big.json?.ok === false, String(big.status));
    const big2 = await new Promise<number>((done) => {
      const rq = httpRequest({ host: "127.0.0.1", port: PORT, path: "/api/auth/login", method: "POST", headers: { "content-type": "application/json" } }, (rs) => { rs.resume(); done(rs.statusCode ?? 0); });
      rq.on("error", () => done(-1));
      rq.write('{"a":"'); for (let i = 0; i < 6; i++) rq.write("x".repeat(500)); rq.end('"}');
    });
    check("oversize chunked body (no content-length) -> 413", big2 === 413, String(big2));
    const bj = await post("/api/auth/login", "{not json");
    check("bad JSON -> 400", bj.status === 400 && bj.json.ok === false && bj.json.error === "Invalid JSON.");
    const arr = await post("/api/auth/login", "[1,2]");
    check("JSON array body -> 400", arr.status === 400);
    const ct = await post("/api/auth/login", JSON.stringify({ name: nm, pw: "secret1" }), { "content-type": "text/plain" });
    check("wrong content-type -> 415", ct.status === 415 && ct.json.ok === false);
    const noct = await fetch(`${BASE}/api/auth/login`, { method: "POST", body: JSON.stringify({ name: nm, pw: "secret1" }), headers: {} });
    check("charset suffix on content-type is fine", (await post("/api/auth/login", { name: nm, pw: "secret1" }, { "content-type": "application/json; charset=utf-8" })).status === 200 && noct.status === 415);
    const g = await fetch(`${BASE}/api/auth/login`);
    check("GET on an API path -> 405 with Allow: POST", g.status === 405 && /POST/.test(g.headers.get("allow") ?? ""));
    const d = await fetch(`${BASE}/health`, { method: "DELETE" });
    check("DELETE /health -> 405", d.status === 405);
    const n1 = await fetch(`${BASE}/api/auth/nope`, { method: "POST" }), n2 = await fetch(`${BASE}/`);
    check("unknown paths -> 404", n1.status === 404 && n2.status === 404);

    console.log("\n[T] tokens over the game socket");
    const tk = (await post("/api/auth/login", { name: nm, pw: "secret1" })).json.token as string;
    const w1 = await wsLogin(nm, { tok: tk });
    check("WebSocket login with tok (no pw) -> welcome", w1.ok, w1.err);
    w1.ws.close(); await sleep(400);
    const w2 = await wsLogin(nm, { tok: tk });
    check("same tok again -> 'Session expired. Sign in again from the launcher.'", !w2.ok && w2.err === "Session expired. Sign in again from the launcher.", w2.err);
    w2.ws.close();
    const other = "Oth" + SUFFIX;
    await post("/api/auth/register", { name: other, pw: "secret2" });
    const tkOther = (await post("/api/auth/login", { name: other, pw: "secret2" })).json.token as string;
    const w3 = await wsLogin(nm, { tok: tkOther });
    check("token issued for another name is rejected", !w3.ok && w3.err === "Session expired. Sign in again from the launcher.", w3.err);
    w3.ws.close();
    const w3b = await wsLogin(other, { tok: tkOther });
    check("...and was not burned by the wrong-name attempt", w3b.ok, w3b.err);
    w3b.ws.close(); await sleep(300);
    const tk3 = (await post("/api/auth/login", { name: nm, pw: "secret1" })).json.token as string;
    const tampered = tk3.slice(0, -44) + (tk3.slice(-43)[0] === "A" ? "B" : "A") + tk3.slice(-43 + 1);
    const w4 = await wsLogin(nm, { tok: tampered });
    check("tampered token rejected over WebSocket", !w4.ok && w4.err === "Session expired. Sign in again from the launcher.", w4.err);
    w4.ws.close();
    const w5 = await wsLogin(nm, { tok: tk3 });
    check("untampered token still works afterwards (valid case-insensitive name)", w5.ok, w5.err);
    w5.ws.close(); await sleep(300);
    const tk4 = (await post("/api/auth/login", { name: nm, pw: "secret1" })).json.token as string;
    const w6 = await wsLogin(nm.toUpperCase(), { tok: tk4 });
    check("token name match is case-insensitive", w6.ok, w6.err);
    w6.ws.close(); await sleep(300);
    const w7 = await wsLogin(nm, { pw: "secret1" });
    check("password login over WebSocket is unchanged", w7.ok, w7.err);
    const tk5 = (await post("/api/auth/login", { name: nm, pw: "secret1" })).json.token as string;
    const w8 = await wsLogin(nm, { tok: tk5 });
    check("duplicate-online handling unchanged ('already in use') and does not burn the token", !w8.ok && w8.err === "That name is already in use", w8.err);
    w8.ws.close(); w7.ws.close(); await sleep(400);
    const w9 = await wsLogin(nm, { tok: tk5 });
    check("token survives an 'already in use' refusal", w9.ok, w9.err);
    w9.ws.close(); await sleep(300);
    const w10 = await wsLogin("Ghost" + SUFFIX, { tok: tk5 });
    check("token for a name without an account rejected", !w10.ok && w10.err === "Session expired. Sign in again from the launcher.");
    w10.ws.close();
    const h2: any = await (await fetch(`${BASE}/health`)).json();
    check("/health players count returns to 0 after logouts", h2.players === 0, String(h2.players));

    console.log("\n[L] rate limit (last: blocks this IP for a minute)");
    const lim = "Lim" + SUFFIX;
    await post("/api/auth/register", { name: lim, pw: "secret3" });
    const outcomes: string[] = [];
    for (let i = 0; i < 6; i++) { const r = await post("/api/auth/login", { name: lim, pw: "bad-guess-" + i }); outcomes.push(`${r.status}:${r.json.error}`); }
    const first = outcomes.findIndex((o) => o === "429:Too many attempts. Wait a minute.");
    check("repeated failures -> 429 'Too many attempts. Wait a minute.' (shared limiter, 5 failures/60 s)", first >= 1 && first <= 5 && outcomes.slice(first).every((o) => o === "429:Too many attempts. Wait a minute."), outcomes.join(" | "));
    const good = await post("/api/auth/login", { name: lim, pw: "secret3" });
    check("blocked even with the correct pw while rate-limited", good.status === 429);
    const wl = await wsLogin(lim, { pw: "secret3" });
    check("the in-game login shares the same limiter", !wl.ok && wl.err === "Too many attempts. Wait a minute.", wl.err);
    wl.ws.close();
    const regLim = await post("/api/auth/register", { name: "NewGuy" + SUFFIX, pw: "abcd1234" });
    check("register is blocked too while limited", regLim.status === 429);
  } finally {
    await stopServer();
    rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nAPI TEST: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log("FAILED:\n" + failed.map((f) => " - " + f.name).join("\n")); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error(e); child?.kill("SIGKILL"); process.exit(1); });
