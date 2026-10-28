// Optional launcher self-update via electron-updater (generic provider). Disabled by default; a no-op when the
// module is not installed or config.launcherUpdate.enabled is false. See docs/LAUNCHER.md section 5.
function init(config, emit) {
  const cfg = config.launcherUpdate || {};
  if (!cfg.enabled || !cfg.url) return { enabled: false, install() {} };
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return { enabled: false, reason: "electron-updater is not installed", install() {} }; }
  try {
    autoUpdater.setFeedURL({ provider: "generic", url: cfg.url });
    autoUpdater.autoDownload = true;
    autoUpdater.on("update-available", (i) => emit({ status: "downloading", version: i.version }));
    autoUpdater.on("update-downloaded", (i) => emit({ status: "ready", version: i.version }));
    autoUpdater.on("error", (e) => emit({ status: "error", error: String(e && e.message || e) }));
    autoUpdater.checkForUpdates().catch(() => {});
  } catch { return { enabled: false, install() {} }; }
  return { enabled: true, install() { autoUpdater.quitAndInstall(); } };
}
module.exports = { init };
