// Launcher main process. All logic lives in ../src (ESM, testable without Electron); this file wires windows and IPC.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

if (process.env.LAUNCHER_HOME) app.setPath("userData", path.resolve(process.env.LAUNCHER_HOME));
if (process.env.LAUNCHER_NO_SANDBOX === "1") app.commandLine.appendSwitch("no-sandbox");
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null, core = null, statusTimer = null, checkTimer = null, selfUpdate = null;
const send = (ev, data) => { if (win && !win.isDestroyed()) win.webContents.send("ev:" + ev, data); };

async function boot() {
  const { loadConfig } = await import("../src/config.js");
  const { LauncherCore } = await import("../src/controller.js");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const config = loadConfig(process.env);
  core = new LauncherCore({ config, userData: app.getPath("userData"), launcherVersion: pkg.version });
  for (const ev of ["state", "progress", "status", "news", "game"]) core.on(ev, (d) => send(ev, d));
  selfUpdate = require("./selfupdate.cjs").init(config, (d) => send("launcher-update", d));

  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { return { ok: false, error: e.message || String(e) }; } };
  ipcMain.handle("info", () => core.info());
  ipcMain.handle("auth", guard((_e, kind, name, pw) => core.auth(kind === "register" ? "register" : "login", String(name), String(pw))));
  ipcMain.handle("logout", () => core.logout());
  ipcMain.handle("refresh", guard(() => core.refresh().then(() => core.snapshot())));
  ipcMain.handle("refreshStatus", () => core.refreshStatus());
  ipcMain.handle("getNews", () => core.getNews());
  ipcMain.handle("startUpdate", guard(() => core.startUpdate()));
  ipcMain.handle("verify", guard(() => core.startUpdate({ verify: true })));
  ipcMain.handle("cancelUpdate", () => core.cancelUpdate());
  ipcMain.handle("play", guard(async () => {
    const r = await core.play();
    if (r.ok && r.closeLauncher) setTimeout(() => app.quit(), 1500);
    return r;
  }));
  ipcMain.handle("setSettings", (_e, p) => core.setSettings(p && typeof p === "object" ? p : {}));
  ipcMain.handle("pickFolder", async () => {
    const r = await dialog.showOpenDialog(win, { title: "Choose install folder", properties: ["openDirectory", "createDirectory"] });
    return r.canceled || !r.filePaths[0] ? null : path.join(r.filePaths[0], /Game$/i.test(r.filePaths[0]) ? "" : "SwordAndSeal");
  });
  ipcMain.handle("openExternal", (_e, u) => { try { const p = new URL(String(u)); if (p.protocol === "https:" || p.protocol === "http:") shell.openExternal(p.href); } catch { /* ignore */ } });
  ipcMain.handle("minimize", () => win?.minimize());
  ipcMain.handle("close", () => app.quit());

  statusTimer = setInterval(() => core.refreshStatus(), 15000);
  checkTimer = setInterval(() => { if (core.phase === "idle") core.refresh(); }, 10 * 60 * 1000);
  createWindow();
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 960, height: 600, useContentSize: true, resizable: false, maximizable: false, frame: false, show: false,
    backgroundColor: "#1a1a1f", title: "Sword and Seal Launcher",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  if (process.env.LAUNCHER_DEVTOOLS === "1") win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(boot).catch((e) => { dialog.showErrorBox("Sword and Seal Launcher", String(e && e.stack || e)); app.quit(); });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { clearInterval(statusTimer); clearInterval(checkTimer); try { core?.cancelUpdate(); } catch { /* ignore */ } });
