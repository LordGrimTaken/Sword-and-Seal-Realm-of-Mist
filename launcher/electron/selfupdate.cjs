// Launcher self-update via electron-updater (generic provider; feed at config.launcherUpdate.url, e.g. .../launcher/feed).
// A no-op when disabled or when the module is missing. See docs/LAUNCHER.md section 5.
function init(config, emit) {
  const cfg = config.launcherUpdate || {};
  const off = { enabled: false, install() {}, async check() { return { ok: true, status: "disabled" }; } };
  if (!cfg.enabled || !cfg.url) return off;
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return { ...off, reason: "electron-updater is not installed" }; }
  try {
    autoUpdater.setFeedURL({ provider: "generic", url: cfg.url });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-available", (i) => emit({ status: "downloading", version: i.version }));
    autoUpdater.on("download-progress", (p) => emit({ status: "downloading", pct: Math.round(p.percent || 0) }));
    autoUpdater.on("update-downloaded", (i) => emit({ status: "ready", version: i.version }));
    autoUpdater.on("update-not-available", () => emit({ status: "up-to-date" }));
    autoUpdater.on("error", (e) => emit({ status: "error", error: String(e && e.message || e) }));
    autoUpdater.checkForUpdates().catch(() => {});
  } catch { return off; }
  return {
    enabled: true,
    install() { autoUpdater.quitAndInstall(); },
    async check() {
      try {
        const r = await autoUpdater.checkForUpdates();
        const v = r && r.updateInfo && r.updateInfo.version;
        return { ok: true, status: r && r.isUpdateAvailable ? "available" : "up-to-date", version: v };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    },
  };
}
module.exports = { init };
