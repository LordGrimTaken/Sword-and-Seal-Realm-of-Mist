// Preload (sandboxed, contextIsolation on, no node integration in the renderer). Exposes a tiny read-only bridge:
//   window.jzLauncher.info()       -> { name, serverUrl } | { rejected: "reason" } | null   (no secret)
//   window.jzLauncher.takeToken()  -> the one-use login token, ONCE (the main process forgets it on the first call)
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("jzLauncher", Object.freeze({
  info: () => ipcRenderer.invoke("jz-launcher:info"),
  takeToken: () => ipcRenderer.invoke("jz-launcher:take-token"),
}));
