// Starts / stops the bundled game server for the desktop app. Pure Node (no Electron imports) so it can be tested with plain `node`.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

/** Ask the OS for a free TCP port on loopback (listen on 0, read it back, close). */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function healthOk(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 800 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(res.statusCode === 200 && JSON.parse(body).ok === true); } catch { resolve(false); } });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/**
 * Spawn `runtime bundle` with PORT/DB_PATH set and wait until /health answers.
 * opts: { runtime, runtimeEnv, bundle, dbPath, timeoutMs, log }
 *   runtime    - executable (Electron's own binary with ELECTRON_RUN_AS_NODE=1, or a system `node`)
 *   runtimeEnv - extra env for the child (e.g. { ELECTRON_RUN_AS_NODE: "1" })
 * Resolves { port, child, stop() }; rejects with an Error (message includes the last server output) if it dies or times out.
 */
async function startServer(opts) {
  const { runtime, runtimeEnv = {}, bundle, dbPath, timeoutMs = 15000, log = () => {} } = opts;
  if (!fs.existsSync(bundle)) throw new Error(`server bundle not found: ${bundle}`);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const port = await freePort();
  const child = spawn(runtime, ["--no-warnings", bundle], {
    env: { ...process.env, ...runtimeEnv, PORT: String(port), DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let tail = "";
  const keep = (b) => { tail = (tail + b.toString()).slice(-2000); log(b.toString().trimEnd()); };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  let exited = null;
  child.once("exit", (code, sig) => { exited = { code, sig }; });
  child.once("error", (e) => { exited = { code: -1, sig: String(e.message) }; });

  const stop = () => new Promise((resolve) => {
    if (exited || child.exitCode !== null) return resolve();
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, 3000);
    child.once("exit", () => { clearTimeout(t); resolve(); });
    try { child.kill("SIGTERM"); } catch { resolve(); }
  });

  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (exited) throw new Error(`server exited early (code ${exited.code}, ${exited.sig}). ${tail.trim().split("\n").slice(-3).join(" | ")}`);
    if (await healthOk(port)) return { port, child, stop };
    await new Promise((r) => setTimeout(r, 120));
  }
  await stop();
  throw new Error(`server did not answer /health within ${timeoutMs} ms. ${tail.trim().split("\n").slice(-3).join(" | ")}`);
}

module.exports = { freePort, healthOk, startServer };
