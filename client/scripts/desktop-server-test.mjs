// Tests the desktop app's local-server logic without a display or Electron: spawns the esbuild server bundle through
// electron/server-process.cjs (the same module main.cjs uses) with plain `node`, then checks a free port was chosen,
// /health answers, a real websocket login at the current protocol returns welcome + inv, the save file is written in
// the given folder, stop() ends the child, and a missing bundle / early exit are reported as errors.
// Usage: node scripts/desktop-server-test.mjs   (rebuilds server/dist/server.mjs first)
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);
const { startServer, freePort, healthOk } = require("../electron/server-process.cjs");
const bundle = path.join(root, "server", "dist", "server.mjs");
{ // always rebuild: a stale bundle would test old code
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "build-server.mjs")], { stdio: "inherit" });
  if (r.status !== 0) { console.error("could not build the server bundle"); process.exit(1); }
}
const WebSocket = require(path.join(root, "server", "node_modules", "ws"));

let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jz-desktop-"));
const dbPath = path.join(tmp, "userData", "jiuzhou.db");
let srv;
try {
  const p = await freePort();
  check("freePort returns a usable port", Number.isInteger(p) && p > 1023, String(p));

  srv = await startServer({ runtime: process.execPath, runtimeEnv: {}, bundle, dbPath, timeoutMs: 20000 });
  check("startServer resolves once /health answers", srv.port > 1023 && await healthOk(srv.port), `port ${srv.port}`);
  check("save file created inside the given user-data folder", fs.existsSync(dbPath));

  const got = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
    const seen = [];
    const t = setTimeout(() => { ws.close(); resolve(seen); }, 4000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "login", name: "DesktopTest", cls: "sword", v: 3, pw: "testpass1" })));
    ws.on("message", (d) => {
      try { const m = JSON.parse(d.toString()); seen.push(m.t); if (seen.includes("welcome") && seen.includes("inv") && seen.includes("wallet") && seen.includes("daily")) { clearTimeout(t); ws.close(); resolve(seen); } } catch { /* ignore */ }
    });
    ws.on("error", () => { clearTimeout(t); resolve(seen); });
  });
  check("websocket login receives welcome, inv, wallet and daily (v3)", got.includes("welcome") && got.includes("inv") && got.includes("wallet") && got.includes("daily"), got.slice(0, 6).join(","));

  const child = srv.child;
  await srv.stop();
  check("stop() terminates the server process", child.exitCode !== null || child.signalCode !== null);
  check("port is closed after stop()", !(await healthOk(srv.port)));

  let err = "";
  try { await startServer({ runtime: process.execPath, bundle: path.join(tmp, "nope.mjs"), dbPath, timeoutMs: 2000 }); } catch (e) { err = e.message; }
  check("missing bundle is a clear error", /not found/.test(err), err);

  err = "";
  try { await startServer({ runtime: "definitely-not-a-runtime-xyz", bundle, dbPath, timeoutMs: 3000 }); } catch (e) { err = e.message; }
  check("unlaunchable runtime is reported (so main.cjs can fall back to system node)", /exited early|did not answer/.test(err), err.slice(0, 100));
} catch (e) {
  check("no unexpected exception", false, String(e && e.stack || e));
} finally {
  if (srv) await srv.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
