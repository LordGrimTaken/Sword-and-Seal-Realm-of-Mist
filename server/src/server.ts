import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { PROTOCOL_VERSION, TICK_RATE } from "../../shared/protocol.ts";
import type { ClassId, ClientMsg, ServerMsg } from "../../shared/protocol.ts";
import { CLASSES, TUNING, ZONE, normalizeProgress } from "./data.ts";
import { ecoClaim, ecoLogin, ecoTick, initEconomy } from "./economy.ts";
import { contentHandle, contentLogin, initContent } from "./game/content.ts";
import { CharacterDb, type CharRow } from "./db.ts";
import { sendInv } from "./game/inventory.ts";
import { World } from "./game/world.ts";
import type { Player } from "./game/types.ts";
import { TokenBucket, isNum } from "./game/util.ts";
import { FailLimiter, TokenService, hashPw, loadTokenSecret, validPw, verifyPw } from "./auth.ts";

const PORT = Number(process.env.PORT) || 8787;
const DB_PATH = process.env.DB_PATH || resolve(import.meta.dirname, "../data/jiuzhou.db");
const NAME_RE = /^[\p{L}\p{N}_ -]{2,16}$/u;
const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
// Send-buffer policy: a backed-up socket only gets its snapshots skipped (the next one is a full state anyway).
// Events keep flowing until the buffer is enormous; only then is the client considered dead.
const SNAP_DROP_BUFFERED = TUNING.snapDropBuffered;
const KILL_BUFFERED = TUNING.killBuffered;

const db = new CharacterDb(DB_PATH);
const world = new World();
initEconomy(DB_PATH); // wallet + daily tables (own tables, own connection to the same sqlite file)
initContent(DB_PATH); // 0.4.0: equipment, side quests, merit seals, places, titles (own tables, additive)
world.onQuestChange = (p) => { try { db.saveQuest(p.n, p.quest); } catch (e) { log("quest save failed", e); } };
world.onMoveKick = (p) => {
  for (const s of sessions) if (s.player === p) { sendMsg(s.ws, { t: "error", msg: "Movement rejected." }); log(`movement kick ${p.n}`); s.ws.close(1008, "movement rejected"); }
};
world.onInvChange = (p, it) => { try { db.saveItem(p.n, it); } catch (e) { log("inventory save failed", e); } };

interface Session {
  ip: string; ws: WebSocket; player?: Player; alive: boolean;
  missed: number; bucket: TokenBucket; strikes: number; loginTimer?: NodeJS.Timeout; loginBusy: boolean;
}
const sessions = new Set<Session>();
const failIp = new FailLimiter(5, 60_000), failName = new FailLimiter(5, 60_000);
const regIp = new FailLimiter(10, 60_000); // account creations per IP (scrypt is CPU heavy)
const CORS_ORIGINS = new Set((process.env.CORS_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean));
const ALLOW_NULL_ORIGIN = process.env.ALLOW_NULL_ORIGIN === "1";
// Behind Fly's proxy the socket peer is the proxy. Fly sets Fly-Client-IP (overwriting any client-supplied value); only trust it when explicitly enabled.
const TRUST_FLY_CLIENT_IP = process.env.TRUST_FLY_CLIENT_IP === "1";
const clientIp = (req: IncomingMessage): string => {
  const h = TRUST_FLY_CLIENT_IP ? req.headers["fly-client-ip"] : undefined;
  return (typeof h === "string" && h.length <= 64 ? h : req.socket.remoteAddress) ?? "?";
};
const VERSION = (() => {
  for (const f of ["../../VERSION", "../VERSION", "../package.json"]) {
    try { const t = readFileSync(resolve(import.meta.dirname, f), "utf8").trim(); if (f.endsWith("json")) return String(JSON.parse(t).version); if (t) return t; } catch { /* next */ }
  }
  return "unknown";
})();
let droppedSnaps = 0;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const tokens = new TokenService(loadTokenSecret(DB_PATH, (m) => log("WARN", m)));
const sendRaw = (ws: WebSocket, s: string) => {
  if (ws.readyState !== WebSocket.OPEN) return;
  const buffered = ws.bufferedAmount;
  if (buffered > KILL_BUFFERED) { log("terminating client: send buffer", buffered); ws.terminate(); return; } // truly hopeless
  if (buffered > SNAP_DROP_BUFFERED && s.startsWith('{"t":"snap"')) { droppedSnaps++; return; } // skip, keep events
  ws.send(s);
};
const sendMsg = (ws: WebSocket, m: ServerMsg) => sendRaw(ws, JSON.stringify(m));

const rowOf = (p: Player): CharRow => ({
  name: p.n, cls: p.cls, level: p.lv, xp: p.xp,
  x: p.st === "dead" ? ZONE.spawn.x : p.x, z: p.st === "dead" ? ZONE.spawn.z : p.z,
});

// ---------------- HTTP (health + launcher auth API) + WebSocket ----------------
const MAX_BODY = 2048;
function corsHeaders(req: IncomingMessage): Record<string, string> {
  const o = req.headers.origin;
  if (typeof o !== "string") return {};
  const ok = o === "null" ? ALLOW_NULL_ORIGIN : CORS_ORIGINS.has(o) || CORS_ORIGINS.has("*");
  return ok ? { "access-control-allow-origin": o, vary: "Origin" } : { vary: "Origin" };
}
function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(s), ...corsHeaders(req), ...extra });
  res.end(s);
}
const apiErr = (req: IncomingMessage, res: ServerResponse, status: number, error: string, extra: Record<string, string> = {}) => sendJson(req, res, status, { ok: false, error }, extra);

function readBody(req: IncomingMessage): Promise<string | "too_big"> {
  return new Promise((done, fail) => {
    const len = Number(req.headers["content-length"]);
    if (Number.isFinite(len) && len > MAX_BODY) { req.resume(); return done("too_big"); }
    let n = 0; const chunks: Buffer[] = []; let over = false;
    req.on("data", (c: Buffer) => { n += c.length; if (n > MAX_BODY) over = true; else chunks.push(c); });
    req.on("end", () => done(over ? "too_big" : Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, kind: "register" | "login") {
  const ip = clientIp(req);
  const ct = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!ct.startsWith("application/json")) { req.resume(); return apiErr(req, res, 415, "Content-Type must be application/json."); }
  const raw = await readBody(req);
  if (raw === "too_big") return apiErr(req, res, 413, "Request too large.", { connection: "close" });
  let body: { name?: unknown; pw?: unknown };
  try { body = JSON.parse(raw); } catch { return apiErr(req, res, 400, "Invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiErr(req, res, 400, "Invalid JSON.");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!NAME_RE.test(name)) return apiErr(req, res, 400, "Invalid name (2-16 letters, digits, space, _ or -)");
  const key = name.toLowerCase();
  if (failIp.blocked(ip) || failName.blocked(key) || (kind === "register" && regIp.blocked(ip))) return apiErr(req, res, 429, "Too many attempts. Wait a minute.");
  const pw = validPw(body.pw) ? body.pw : undefined;
  const acct = db.getAccount(name);
  if (kind === "register") {
    if (!pw) return apiErr(req, res, 400, "Choose a password (4-64 characters) to create this character.");
    if (acct) return apiErr(req, res, 409, "That name is already taken.");
    if (world.isNameOnline(name)) return apiErr(req, res, 409, "That name is already in use");
    try { db.createAccount(name, hashPw(pw)); } catch { return apiErr(req, res, 409, "That name is already taken."); }
    regIp.fail(ip);
    log(`api register ${name}`);
  } else {
    if (!acct) { failIp.fail(ip); return apiErr(req, res, 404, "No account with that name. Register first."); }
    if (!pw || !verifyPw(pw, acct)) {
      failIp.fail(ip); failName.fail(key);
      log(`api login failed for ${name}`);
      return apiErr(req, res, 401, "Wrong password for that name.");
    }
    failName.clear(key);
  }
  sendJson(req, res, 200, { ok: true, token: tokens.issue(name), name, expiresIn: tokens.ttl });
}

const http = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  const method = req.method ?? "GET";
  const isApi = path === "/api/auth/register" || path === "/api/auth/login";
  if (method === "OPTIONS" && (isApi || path === "/health")) {
    const ch = corsHeaders(req);
    res.writeHead(204, { ...ch, ...(ch["access-control-allow-origin"] ? { "access-control-allow-methods": isApi ? "POST, OPTIONS" : "GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } : {}), "content-length": "0" });
    return void res.end();
  }
  if (path === "/health") {
    if (method !== "GET" && method !== "HEAD") return apiErr(req, res, 405, "Method not allowed.", { allow: "GET, HEAD, OPTIONS" });
    return sendJson(req, res, 200, { ok: true, players: world.players.size, version: VERSION, uptime: Math.round(process.uptime()), tick: world.tickNo, mobs: world.mobs.length, entities: world.entities.size, droppedSnaps, rss: process.memoryUsage().rss });
  }
  if (isApi) {
    if (method !== "POST") return apiErr(req, res, 405, "Method not allowed.", { allow: "POST, OPTIONS" });
    handleAuth(req, res, path.endsWith("register") ? "register" : "login").catch((e) => { log("api error", e); if (!res.headersSent) apiErr(req, res, 500, "Server error."); });
    return;
  }
  apiErr(req, res, 404, "Not found.");
});
const wss = new WebSocketServer({ server: http, maxPayload: 2048, perMessageDeflate: false });

wss.on("connection", (ws, req) => {
  if (sessions.size >= TUNING.maxPlayers * 2) { sendMsg(ws, { t: "error", msg: "Server is full" }); ws.close(1013); return; }
  const s: Session = { ip: clientIp(req), ws, alive: true, missed: 0, bucket: new TokenBucket(100, 60), strikes: 0, loginBusy: false };
  sessions.add(s);
  s.loginTimer = setTimeout(() => { if (!s.player) ws.close(1008, "login timeout"); }, 10_000);
  ws.on("pong", () => { s.alive = true; s.missed = 0; });
  ws.on("error", () => {});
  ws.on("message", (data, isBinary) => {
    s.alive = true; s.missed = 0;
    try { onMessage(s, data, isBinary); } catch (e) { log("message handler error", e); }
  });
  ws.on("close", () => onClose(s));
});

function onMessage(s: Session, data: RawData, isBinary: boolean) {
  if (isBinary) return;
  if (!s.bucket.take(performance.now() / 1000)) {
    if (++s.strikes > 300) { s.ws.close(1008, "rate limit"); }
    return;
  }
  let msg: ClientMsg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
  const p = s.player;

  switch (msg.t) {
    case "ping":
      if (isNum(msg.c)) sendMsg(s.ws, { t: "pong", c: msg.c, s: Date.now() });
      return;
    case "login":
      return onLogin(s, msg);
    case "input": {
      if (!p || !isNum(msg.seq) || !isNum(msg.dx) || !isNum(msg.dz)) return;
      if (Math.abs(msg.dx) > 100 || Math.abs(msg.dz) > 100) return; // oversize: ignore
      world.applyInput(p, Math.floor(msg.seq), msg.dx, msg.dz);
      return;
    }
    case "cast":
      if (p) world.cast(p, msg);
      return;
    case "dodge":
      if (p) world.dodge(p, msg);
      return;
    case "mount": // 0.5.0 additive: toggle the spirit-sword mount (validated inside World.toggleMount)
      if (p) world.toggleMount(p);
      return;
    case "party": // 0.5.0 additive: session-only party commands (validated inside PartyManager)
      if (p) world.party.handle(p, msg);
      return;
    case "openchest": // 0.5.0 additive: open a treasure cache (range/readiness validated inside ChestManager)
      if (p) world.chests.open(p, msg.id);
      return;
    case "trade": // 0.5.0 additive: player-to-player trading (every field validated inside TradeManager)
      if (p) world.trade.handle(p, msg);
      return;
    case "trial": // 0.5.0 P3 additive: the Hollow Trial (range/cooldown/run uniqueness validated inside TrialManager)
      if (p) world.trial.handle(p, msg);
      return;
    case "chat":
      if (p && typeof msg.text === "string") world.chat(p, msg.text.slice(0, 400));
      return;
    case "claim":
      if (p) ecoClaim(world, p, msg.id); // validated inside (type, length, on today's board, done, not yet claimed)
      return;
    case "equip": case "unequip": case "use": case "npc": case "craft": case "buy": case "sell": case "title":
      if (p) contentHandle(world, p, msg); // 0.4.0 content messages: every field is validated inside
      return;
  }
}

function onLogin(s: Session, msg: Extract<ClientMsg, { t: "login" }>) {
  if (s.player || s.loginBusy) return;
  if (msg.v !== PROTOCOL_VERSION) {
    sendMsg(s.ws, { t: "error", msg: `Protocol version mismatch: server ${PROTOCOL_VERSION}, client ${String(msg.v)}` });
    s.ws.close(1008, "bad version");
    return;
  }
  const name = typeof msg.name === "string" ? msg.name.trim() : "";
  if (!NAME_RE.test(name)) return void sendMsg(s.ws, { t: "error", msg: "Invalid name (2-16 letters, digits, space, _ or -)" });
  if (!CLASS_IDS.includes(msg.cls)) return void sendMsg(s.ws, { t: "error", msg: "Invalid class" });
  if (world.isNameOnline(name)) return void sendMsg(s.ws, { t: "error", msg: "That name is already in use" });
  if (world.players.size >= TUNING.maxPlayers) return void sendMsg(s.ws, { t: "error", msg: "Server is full" });

  // ---- accounts ----
  const key = name.toLowerCase();
  if (!msg.tok && (failIp.blocked(s.ip) || failName.blocked(key))) return void sendMsg(s.ws, { t: "error", msg: "Too many attempts. Wait a minute." });
  const pw = validPw(msg.pw) ? msg.pw : undefined;
  const acct = db.getAccount(name);
  let row = db.load(name);
  if (msg.tok != null && msg.tok !== "") {
    // launcher session token: replaces the password, single use, must belong to this name; an unguessable HMAC, so bad tokens are not counted by the limiter
    const t = acct ? tokens.check(msg.tok, name) : undefined;
    if (!t || !tokens.consume(t)) {
      return void sendMsg(s.ws, { t: "error", msg: "Session expired. Sign in again from the launcher." });
    }
  } else if (acct) {
    if (msg.pw == null || msg.pw === "") return void sendMsg(s.ws, { t: "error", msg: "This name is protected. Enter its password." });
    if (!pw || !verifyPw(pw, acct)) {
      failIp.fail(s.ip); failName.fail(key);
      log(`login failed for ${name}`);
      return void sendMsg(s.ws, { t: "error", msg: "Wrong password for that name." });
    }
    failName.clear(key);
  } else {
    // unknown name registers; a legacy character without an account is claimed by its first login with a password
    if (!pw) return void sendMsg(s.ws, { t: "error", msg: row && (msg.pw == null || msg.pw === "") ? "This name is protected. Enter its password." : "Choose a password (4-64 characters) to create this character." });
    db.createAccount(name, hashPw(pw));
  }
  const isNew = !row;
  if (!row) { row = { name, cls: msg.cls, level: 1, xp: 0, x: ZONE.spawn.x, z: ZONE.spawn.z }; db.create(row); }
  if (world.isNameOnline(row.name)) return void sendMsg(s.ws, { t: "error", msg: "That name is already in use" });

  clearTimeout(s.loginTimer);
  const prog = normalizeProgress(row.level, row.xp); // existing characters keep level/xp, clamped to the current cap/curve
  const p = world.addPlayer(
    { name: row.name, cls: row.cls, level: prog.lv, xp: prog.xp, x: isNew ? undefined : row.x, z: isNew ? undefined : row.z, quest: db.loadQuest(row.name), inv: db.loadInv(row.name) },
    (str) => sendRaw(s.ws, str),
  );
  s.player = p;
  sendMsg(s.ws, { t: "welcome", id: p.id, zone: ZONE, skills: CLASSES[p.cls].skills.map((k) => k.def), tickRate: TICK_RATE });
  world.sendXp(p);
  sendInv(p);
  ecoLogin(world, p); // {t:"wallet"} then {t:"daily"}
  contentLogin(world, p); // {t:"items"}, {t:"gear"}, {t:"sq"}, {t:"prog"}
  if (row.cls !== msg.cls) world.sysTo(p, `Character ${row.name} is a ${CLASSES[row.cls].name}; your saved class was kept.`);
  world.sysTo(p, `Welcome to ${ZONE.name}, ${p.n}.`);
  world.sysAll(`${p.n} has entered the valley.`);
  log(`join ${p.n} (${p.cls}, lv${p.lv}) players=${world.players.size}`);
}

function onClose(s: Session) {
  clearTimeout(s.loginTimer);
  sessions.delete(s);
  const p = s.player;
  if (!p) return;
  s.player = undefined;
  try { db.save(rowOf(p)); } catch (e) { log("save failed", e); }
  world.removePlayer(p);
  world.sysAll(`${p.n} has left the valley.`);
  log(`leave ${p.n} players=${world.players.size}`);
}

// ---------------- Loops ----------------
let nextTick = performance.now();
let loopTimer: NodeJS.Timeout | undefined;
function loop() {
  const now = performance.now();
  let n = 0;
  while (now >= nextTick && n < 5) {
    try { world.step(); } catch (e) { log("tick error", e); }
    nextTick += 1000 / TICK_RATE; n++;
  }
  if (performance.now() >= nextTick) nextTick = performance.now(); // fell behind: don't spiral
  loopTimer = setTimeout(loop, Math.max(1, nextTick - performance.now()));
}

const ecoTimer = setInterval(() => { try { ecoTick(world); } catch (e) { log("economy tick failed", e); } }, 1000); // 00:00 UTC rollover for players who stay online
const saveTimer = setInterval(() => {
  try { db.saveMany([...world.players.values()].map(rowOf)); } catch (e) { log("autosave failed", e); }
}, 30_000);
const heartbeat = setInterval(() => {
  for (const s of sessions) {
    // Any frame or pong resets `missed`. A client is only dropped after several silent intervals
    // (TUNING.heartbeatMissed * TUNING.heartbeatMs), so multi-second stalls are tolerated.
    if (!s.alive) { s.missed++; if (s.missed >= TUNING.heartbeatMissed) { log("heartbeat timeout", s.player?.n ?? "(no login)"); s.ws.terminate(); continue; } }
    s.alive = false;
    try { s.ws.ping(); } catch { /* closing */ }
  }
}, TUNING.heartbeatMs);

// ---------------- Lifecycle ----------------
let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  log("shutting down");
  clearTimeout(loopTimer); clearInterval(saveTimer); clearInterval(ecoTimer); clearInterval(heartbeat);
  const force = setTimeout(() => process.exit(code || 1), 3000);
  force.unref();
  try { world.sysAll("The server is shutting down."); } catch { /* ignore */ }
  try { db.saveMany([...world.players.values()].map(rowOf)); } catch (e) { log("final save failed", e); }
  for (const s of sessions) s.ws.close(1001, "server shutdown");
  wss.close(() => http.close(() => { try { db.close(); } catch { /* ignore */ } log("bye"); process.exit(code); }));
  setTimeout(() => { for (const s of sessions) s.ws.terminate(); http.closeAllConnections(); }, 1000).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (e) => { log("uncaught", e); shutdown(1); });
process.on("unhandledRejection", (e) => log("unhandled rejection", e));

http.listen(PORT, () => {
  log(`JIUZHOU server listening on :${PORT} (ws + /health + /api/auth), db=${DB_PATH}`);
  nextTick = performance.now();
  loop();
});
