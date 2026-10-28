// One command: node scripts/play.mjs
// Starts the game server, serves the built client over HTTP, prints the URL, opens the browser.
// --launcher-session=<file>: launcher handoff (docs/LAUNCHER.md). The JSON {name, token, serverUrl, createdAt} is read and deleted at once;
//   no local server is started (the live server is remote); the browser opens http://localhost:WEB_PORT/?launcher=1 and the page
//   fetches the session ONCE from /__launcher/session (loopback only). The token is never put in a URL and never printed.
// Env: PORT (game server, 8787), WEB_PORT (client, 8080), NO_OPEN=1, DB_PATH, NO_SERVER=1 (client only).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 5)) {
  console.error(`Sword and Seal needs Node.js 22.5 or newer (you have ${process.versions.node}).\nDownload it from https://nodejs.org/ and run this again.`);
  process.exit(1);
}
// ---- launcher session (read + delete before anything else)
let launcherSession = null;
{
  const arg = process.argv.find((a) => a.startsWith("--launcher-session="));
  if (arg) {
    const f = arg.slice("--launcher-session=".length);
    let reason = "";
    try {
      const raw = fs.statSync(f).size <= 4096 ? fs.readFileSync(f, "utf8") : "";
      try { fs.unlinkSync(f); } catch { /* best effort */ }
      const j = JSON.parse(raw);
      const t = Date.parse(j && j.createdAt);
      if (!j || typeof j.name !== "string" || !j.name.trim() || j.name.length > 32 || typeof j.token !== "string" || !j.token || j.token.length > 256
        || typeof j.serverUrl !== "string" || !/^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(j.serverUrl) || !Number.isFinite(t)) reason = "malformed";
      else if (Date.now() - t > 2 * 60 * 1000 || t - Date.now() > 60 * 1000) reason = "expired";
      else launcherSession = { name: j.name.trim(), token: j.token, serverUrl: j.serverUrl };
    } catch { reason = reason || "unreadable or malformed"; }
    if (reason) console.warn(`Launcher session ignored (${reason}). Start the game again from the launcher. Continuing with the normal login screen.`);
  }
}
const PORT = Number(process.env.PORT) || 8787;
const WEB_PORT = Number(process.env.WEB_PORT) || 8080;
const clientDir = path.join(root, "client", "dist");
const bundle = path.join(root, "server", "dist", "server.mjs");
if (!fs.existsSync(path.join(clientDir, "index.html"))) {
  console.error("client/dist not found. Developers: run `npm --prefix client run build` first.");
  process.exit(1);
}
if (!fs.existsSync(bundle)) {
  const b = path.join(root, "scripts", "build-server.mjs");
  if (!fs.existsSync(b)) { console.error("server/dist/server.mjs missing."); process.exit(1); }
  console.log("Building server bundle...");
  if (spawnSync(process.execPath, [b], { stdio: "inherit" }).status !== 0) process.exit(1);
}

const children = [];
if (!process.env.NO_SERVER && !launcherSession) {
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const srv = spawn(process.execPath, ["--no-warnings", bundle], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(PORT), DB_PATH: process.env.DB_PATH || path.join(dataDir, "jiuzhou.db") },
  });
  children.push(srv);
  srv.on("exit", (c) => { console.error(`Game server exited (code ${c}).` + (c ? " Is port " + PORT + " already in use?" : "")); shutdown(c || 0); });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".glb": "model/gltf-binary", ".ico": "image/x-icon", ".map": "application/json" };
const web = http.createServer((req, res) => {
  if (req.url && req.url.split("?")[0] === "/__launcher/session") {
    const host = String(req.headers.host || "");
    const okHost = host === `localhost:${WEB_PORT}` || host === `127.0.0.1:${WEB_PORT}`;
    const site = req.headers["sec-fetch-site"];
    if (!launcherSession || !okHost || (site && site !== "same-origin") || req.method !== "GET") { res.writeHead(404, { "Cache-Control": "no-store" }).end(); return; }
    const body = JSON.stringify(launcherSession);
    launcherSession = null; // one use
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(body);
    return;
  }
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
  let f = path.join(clientDir, p);
  if (!f.startsWith(clientDir)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" }).end(data);
  });
});
web.on("error", (e) => { console.error(`Cannot serve client on port ${WEB_PORT}: ${e.message}. Set WEB_PORT=<other>.`); shutdown(1); });
web.listen(WEB_PORT, () => {
  const local = `http://localhost:${WEB_PORT}/`;
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  if (launcherSession) console.log(`\n  Sword and Seal (launcher session for ${launcherSession.name}).\n  Play:  ${local}?launcher=1\n  Server: ${launcherSession.serverUrl}`);
  else console.log(`\n  Sword and Seal is running.\n  Play:  ${local}\n  Server: ws://localhost:${PORT}`);
  if (lan && !launcherSession) console.log(`  Friends on your network: http://${lan}:${WEB_PORT}/?server=ws://${lan}:${PORT}`);
  console.log("  Press Ctrl+C to stop.\n");
  if (!process.env.NO_OPEN) openBrowser(launcherSession ? local + "?launcher=1" : local);
});

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { const c = spawn(cmd, args, { stdio: "ignore", detached: true }); c.on("error", () => console.log("Open this address in your browser:", url)); c.unref(); }
  catch { console.log("Open this address in your browser:", url); }
}
let closing = false;
function shutdown(code = 0) {
  if (closing) return; closing = true;
  for (const c of children) try { c.kill("SIGTERM"); } catch {}
  web.close(); setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown()); process.on("SIGTERM", () => shutdown());
