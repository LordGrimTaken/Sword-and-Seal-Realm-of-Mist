#!/usr/bin/env node
// Post-deploy smoke test: GET /health, then a real WebSocket login (registers a throwaway character) and waits for snapshots.
//   node deploy/fly/smoke.mjs https://play.swordandseal.com      (ws/wss URL derived from it)
// Needs Node >= 22.4 (global WebSocket). Leaves one character "smoke-xxxx" in the DB; delete it later if you care.
import crypto from "node:crypto";
const base = (process.argv[2] || process.env.SMOKE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const wsUrl = base.replace(/^http/, "ws");
const fail = (m) => { console.error("SMOKE FAIL:", m); process.exit(1); };
const t0 = Date.now();
const h = await fetch(base + "/health").then((r) => r.json()).catch((e) => fail("/health: " + e.message));
if (!h.ok) fail("/health not ok: " + JSON.stringify(h));
console.log(`/health ok: version ${h.version}, players ${h.players}, uptime ${h.uptime}s, rss ${(h.rss / 1048576).toFixed(0)} MB (${Date.now() - t0} ms)`);
const name = "smoke-" + crypto.randomBytes(2).toString("hex"), pw = crypto.randomBytes(9).toString("base64url");
await new Promise((resolve) => {
  const ws = new WebSocket(wsUrl); let welcome = false, snaps = 0;
  const timer = setTimeout(() => fail(`timeout (welcome=${welcome}, snaps=${snaps})`), 15000);
  ws.onerror = () => fail("websocket error connecting to " + wsUrl);
  ws.onopen = () => ws.send(JSON.stringify({ t: "login", name, cls: "sword", v: 3, pw }));
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "error") fail("server said: " + m.msg);
    if (m.t === "welcome") { welcome = true; console.log(`login ok as ${name}, tick rate ${m.tickRate}`); }
    if (m.t === "snap" && ++snaps >= 5) { clearTimeout(timer); console.log("received 5 snapshots; websocket path works"); ws.close(); resolve(); }
  };
});
console.log("SMOKE PASS");
