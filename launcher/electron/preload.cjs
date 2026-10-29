// Preload: the only bridge between the UI and the main process.
const { contextBridge, ipcRenderer } = require("electron");
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const EVENTS = new Set(["state", "progress", "status", "news", "game", "launcher-update"]);
contextBridge.exposeInMainWorld("launcherApi", {
  info: () => call("info"),
  auth: (kind, name, pw) => call("auth", kind, name, pw),
  logout: () => call("logout"),
  refresh: () => call("refresh"),
  refreshStatus: () => call("refreshStatus"),
  getNews: () => call("getNews"),
  startUpdate: () => call("startUpdate"),
  verify: () => call("verify"),
  cancelUpdate: () => call("cancelUpdate"),
  play: () => call("play"),
  setSettings: (p) => call("setSettings", p),
  pickFolder: () => call("pickFolder"),
  addDefenderExclusion: () => call("addDefenderExclusion"),
  offerDefenderExclusion: () => call("offerDefenderExclusion"),
  unblockFiles: () => call("unblockFiles"),
  openLogFolder: () => call("openLogFolder"),
  restartAsAdmin: () => call("restartAsAdmin"),
  detectInstallDir: () => call("detectInstallDir"),
  checkLauncherUpdate: () => call("checkLauncherUpdate"),
  installLauncherUpdate: () => call("installLauncherUpdate"),
  openExternal: (u) => call("openExternal", u),
  minimize: () => call("minimize"),
  close: () => call("close"),
  on(ev, cb) {
    if (!EVENTS.has(ev)) return () => {};
    const f = (_e, d) => cb(d);
    ipcRenderer.on("ev:" + ev, f);
    return () => ipcRenderer.removeListener("ev:" + ev, f);
  },
});
