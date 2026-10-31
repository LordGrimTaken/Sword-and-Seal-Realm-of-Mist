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
  ipcMain.handle("detectInstallDir", guard(() => core.detectInstallDir()));
  ipcMain.handle("checkLauncherUpdate", guard(() => selfUpdate.check ? selfUpdate.check() : { ok: true, status: "disabled" }));
  ipcMain.handle("installLauncherUpdate", () => { try { selfUpdate.install(); } catch { /* ignore */ } });
  ipcMain.handle("unblockFiles", guard(async () => {
    if (process.platform !== "win32") return { ok: true, note: "Not needed on this system." };
    const dir = core.settings.get().installDir;
    const { execFile } = require("child_process");
    await new Promise((res, rej) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-ChildItem -LiteralPath $env:SS_DIR -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue"], { env: { ...process.env, SS_DIR: dir }, timeout: 120000, windowsHide: true }, (e) => e ? rej(e) : res()));
    core.log(`unblocked files in ${dir}`);
    return { ok: true };
  }));
  // Windows Defender exclusion for the game folder only. Always asks first; Windows then shows its own admin prompt.
  async function addDefenderExclusion() {
    if (process.platform !== "win32") return { ok: true, skipped: true };
    const dir = path.resolve(core.settings.get().installDir);
    const bad = !path.isAbsolute(dir) || path.dirname(dir) === dir || /^[a-z]:\\(windows|program files|program files \(x86\)|users)?\\?$/i.test(dir) || /[\r\n"]/.test(dir);
    if (bad) return { ok: false, error: "That folder is too broad to exclude. Choose a dedicated game folder in Settings." };
    const { execFile } = require("child_process");
    const inner = `Add-MpPreference -ExclusionPath '${dir.replace(/'/g, "''")}'`;
    const outer = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-Command','${inner.replace(/'/g, "''")}'`;
    return new Promise((res) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", outer], { timeout: 120000, windowsHide: true }, (e) => {
      core.log(e ? `defender exclusion failed: ${e.message}` : `defender exclusion requested for ${dir}`);
      res(e ? { ok: false, error: "Windows did not allow it (the admin prompt was cancelled or blocked)." } : { ok: true });
    }));
  }
  ipcMain.handle("addDefenderExclusion", guard(() => addDefenderExclusion()));
  ipcMain.handle("offerDefenderExclusion", guard(async () => {
    if (process.platform !== "win32" || core.settings.get().defenderAsked) return { ok: true, skipped: true };
    const dir = core.settings.get().installDir;
    const r = await dialog.showMessageBox(win, {
      type: "question", buttons: ["Add exclusion", "Not now"], defaultId: 0, cancelId: 1, title: "Windows Defender",
      message: "Allow Windows Defender to skip the game folder?",
      detail: `Windows Security sometimes removes files from new, unsigned games while they install, which makes installs fail or repeat.\n\nThis adds only this folder to Defender's exclusion list:\n${dir}\n\nWindows will ask for administrator approval. You can remove it any time in Windows Security > Virus & threat protection > Exclusions.`,
    });
    core.setSettings({ defenderAsked: true });
    if (r.response !== 0) return { ok: true, declined: true };
    return addDefenderExclusion();
  }));
  ipcMain.handle("openLogFolder", () => { shell.showItemInFolder(path.join(app.getPath("userData"), "launcher.log")); });
  ipcMain.handle("restartAsAdmin", guard(async () => {
    if (process.platform !== "win32") return { ok: false, error: "Only available on Windows." };
    const { spawn } = require("child_process");
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Process -FilePath $env:SS_EXE -Verb RunAs"], { env: { ...process.env, SS_EXE: exe }, detached: true, stdio: "ignore", windowsHide: true }).unref();
    setTimeout(() => app.quit(), 800);
    return { ok: true };
  }));
  ipcMain.handle("openExternal", (_e, u) => { try { const p = new URL(String(u)); if (p.protocol === "https:" || p.protocol === "http:") shell.openExternal(p.href); } catch { /* ignore */ } });
  ipcMain.handle("minimize", () => win?.minimize());
  ipcMain.handle("close", () => app.quit());

  statusTimer = setInterval(() => core.refreshStatus(), 15000);
  checkTimer = setInterval(() => { if (core.phase === "idle") core.refresh(); }, 10 * 60 * 1000);
  createWindow();
}

function createWindow() {
  Menu.setApplicationMenu(null);
  // LAUNCHER_HIDDEN=1: build the window but never show it, so automated checks can drive the real renderer over
  // the DevTools protocol without putting a window on the user's desktop. Rendering still happens; only show() is skipped.
  const hidden = process.env.LAUNCHER_HIDDEN === "1";
  win = new BrowserWindow({
    width: 1100, height: 680, useContentSize: true, resizable: false, maximizable: false, frame: false, show: false,
    backgroundColor: "#12161c", title: "Sword and Seal Launcher",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.once("ready-to-show", () => { if (!hidden) win.show(); });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  if (process.env.LAUNCHER_DEVTOOLS === "1") win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(boot).catch((e) => { dialog.showErrorBox("Sword and Seal Launcher", String(e && e.stack || e)); app.quit(); });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { clearInterval(statusTimer); clearInterval(checkTimer); try { core?.cancelUpdate(); } catch { /* ignore */ } });
