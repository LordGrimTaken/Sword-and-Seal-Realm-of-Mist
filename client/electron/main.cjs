// Electron main process.
//  - Server URL given (env JZ_SERVER_URL or --server=ws://host:port): connect to it, start nothing.
//  - JZ_DEV_URL: load the Vite dev server instead of the built client (no local server is started unless you start it).
//  - --launcher-session=<file>: launcher handoff (docs/LAUNCHER.md): remote server, one-use token, no local server.
//  - Packaged build without any of the above: connect to wss://play.swordandseal.com.
//  - Otherwise (run from source): start the bundled game server on a free loopback port, with its save file in the per-user app data
//    folder, load the client pointed at it, and stop the server when the app quits.
const { app, BrowserWindow, Menu, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { startServer } = require("./server-process.cjs");
const { sessionPathFromArgv, consumeSessionFile } = require("./launcher-session.cjs");

const { ipcMain } = require("electron");
const REMOTE_SERVER = "wss://play.swordandseal.com";

// Launcher handoff: read + delete the session file before anything else. The token lives only in this variable until the
// renderer takes it (once) over IPC; it is never put in argv, URLs, env, files or logs.
let launcherSession = null; // { name, token, serverUrl } | null
let launcherRejected = "";
{
  const p = sessionPathFromArgv(process.argv);
  if (p) {
    const r = consumeSessionFile(p);
    if (r.ok) launcherSession = r.session;
    else { launcherRejected = r.reason; console.warn("[launcher]", r.reason); }
  }
}
ipcMain.handle("jz-launcher:info", () => launcherSession ? { name: launcherSession.name, serverUrl: launcherSession.serverUrl } : launcherRejected ? { rejected: launcherRejected } : null);
ipcMain.handle("jz-launcher:take-token", () => { const t = launcherSession ? launcherSession.token : null; if (launcherSession) launcherSession.token = ""; return t || null; });

let local = null; // { port, stop }
let quitting = false;

const argServer = (process.argv.find((a) => a.startsWith("--server=")) || "").slice(9);
const serverUrl = process.env.JZ_SERVER_URL || argServer || "";

/** Where server.mjs lives: packaged -> <resources>/server/server.mjs (electron-builder extraResources); from source -> ../../server/dist/server.mjs. */
function bundlePath() {
  const cands = [
    path.join(process.resourcesPath || "", "server", "server.mjs"),
    path.join(__dirname, "..", "..", "server", "dist", "server.mjs"),
    path.join(__dirname, "..", "server", "dist", "server.mjs"),
  ];
  return cands.find((p) => fs.existsSync(p)) || null;
}

/** Electron >= 37 embeds Node 22.16+, which has node:sqlite, so its own binary can run the bundle (ELECTRON_RUN_AS_NODE).
 *  If that fails, fall back to a system `node` (>= 22.5) on PATH. */
async function startLocalServer() {
  const bundle = bundlePath();
  if (!bundle) throw new Error("The bundled game server (server.mjs) is missing from this install.");
  const dbPath = path.join(app.getPath("userData"), "jiuzhou.db");
  const log = (s) => { if (s) console.log("[server]", s); };
  const attempts = [
    { runtime: process.execPath, runtimeEnv: { ELECTRON_RUN_AS_NODE: "1" }, label: "Electron's built-in Node" },
    { runtime: process.platform === "win32" ? "node.exe" : "node", runtimeEnv: {}, label: "system Node" },
  ];
  const errors = [];
  for (const a of attempts) {
    try { return await startServer({ ...a, bundle, dbPath, log }); }
    catch (e) { errors.push(`${a.label}: ${e.message}`); }
  }
  throw new Error(errors.join("\n"));
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#1a1a1f",
    title: "Sword and Seal: Realm of Mist",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.key === "F11" && input.type === "keyDown") win.setFullScreen(!win.isFullScreen());
    if (input.key === "F12" && input.type === "keyDown") win.webContents.toggleDevTools();
  });

  let server = launcherSession ? launcherSession.serverUrl : serverUrl;
  // Packaged builds talk to the live server by default. The bundled local server starts only when running from source
  // (electron .) or when asked for with --local-server / JZ_LOCAL_SERVER=1, and NEVER in launcher mode.
  const wantLocal = !app.isPackaged || process.argv.includes("--local-server") || process.env.JZ_LOCAL_SERVER === "1";
  if (!server && !process.env.JZ_DEV_URL && !wantLocal) server = REMOTE_SERVER;
  if (!server && !process.env.JZ_DEV_URL && !launcherSession) {
    try {
      local = await startLocalServer();
      server = `ws://127.0.0.1:${local.port}`;
    } catch (e) {
      dialog.showErrorBox("Sword and Seal - local server failed",
        `${e.message}\n\nYou can still connect to a friend's server: start the app with --server=ws://HOST:8787, or type the address on the login screen.`);
    }
  }
  const dev = process.env.JZ_DEV_URL;
  if (dev) win.loadURL(server ? `${dev}${dev.includes("?") ? "&" : "?"}server=${encodeURIComponent(server)}` : dev);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"), server ? { query: { server } } : undefined);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("before-quit", (e) => {
  if (quitting || !local) return;
  e.preventDefault();
  quitting = true;
  const l = local; local = null;
  l.stop().finally(() => app.quit());
});
process.on("exit", () => { try { local && local.child.kill(); } catch { /* ignore */ } });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
