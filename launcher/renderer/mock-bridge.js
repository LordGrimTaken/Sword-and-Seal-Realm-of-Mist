// In-browser mock of the preload bridge. Active only when the page URL has ?mock=1 and no real bridge exists.
// Scenes (?scene=): login | ready | updating | error | outdated | install   Extra: &fast=1 speeds up the fake download, &paused=1 freezes at 42%.
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get("mock") !== "1" || window.launcherApi) return;
  const scene = q.get("scene") || "login";
  const handlers = {};
  const emit = (ev, d) => (handlers[ev] || []).forEach((f) => f(d));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settings = { installDir: "/home/player/.local/share/SwordAndSeal/Game", serverUrl: "", closeOnPlay: false, remember: true, lastName: scene === "login" ? "Wanderer" : "" };
  const news = { cached: false, items: [
    { id: "0.3.0", title: "English localization", date: "2026-10-28", body: "All player-facing text is now English; the Chinese identity is carried by aesthetics only: ink wash, vermilion seals, brush lettering, paper scrolls.\n\n- New fonts: Ma Shan Zheng for display and Noto Serif for body text.\n- Hand-drawn brush pictograms replace the old seal icons.\n- Crits are an ink splash; quest completion stamps a vermilion seal." },
    { id: "0.2.0", title: "Desktop delivery", date: "2026-10-12", body: "The desktop app now starts its own server on a free local port and stops it when you quit.\n\n- Lantern Keeper Mei has a real errand: bring five Bamboo Fiber for a Paper Lantern.\n- Windows, macOS and Linux installers are built by the release workflow." },
    { id: "0.1.0", title: "First playable", date: "2026-09-30", body: "Three classes, four skills each, a telegraphed Stone Guardian and Elder Lin's quest chain in Cloudmist Valley." },
  ] };
  const st = {
    phase: "idle", error: null, offline: false, game: null,
    update: { state: "ready", installedVersion: "0.3.0", latestVersion: "0.3.0" },
    status: { online: true, players: 12, latencyMs: 34, version: "0.3.0", checked: true },
  };
  let session = null, cancelled = false, running = false;
  if (scene !== "login" && scene !== "error") session = { name: "Wanderer" };
  if (scene === "install") st.update = { state: "not-installed", installedVersion: null, latestVersion: "0.3.0", needBytes: 1300863 };
  if (scene === "updating") { st.phase = "updating"; st.update = { state: "update-available", installedVersion: "0.2.0", latestVersion: "0.3.0", needBytes: 48400000 }; }
  if (scene === "outdated") st.update = { state: "launcher-outdated", installedVersion: "0.3.0", latestVersion: "0.4.0", minLauncherVersion: "1.2.0" };
  if (scene === "error") { st.offline = true; st.error = "Cannot reach the update server. You can still play the installed version."; st.status = { online: false, players: 0, latencyMs: null, checked: true }; st.update = { state: "ready", installedVersion: "0.3.0", latestVersion: "0.3.0", offline: true }; news.cached = true; }
  const snapshot = () => JSON.parse(JSON.stringify(st));
  const push = () => emit("state", snapshot());

  async function fakeDownload() {
    const total = 48400000; const fast = q.get("fast") === "1"; cancelled = false;
    st.phase = "updating"; st.error = null; push();
    emit("progress", { phase: "checking", pct: 0 }); await wait(fast ? 50 : 500);
    const files = ["game/client/dist/assets/index-CfaYlupf.js", "game/server/dist/server.mjs", "game/shared/protocol.ts", "game/client/dist/index.html"];
    for (let i = 0; i <= 100; i += 2) {
      if (cancelled) { st.phase = "idle"; push(); return { ok: false, cancelled: true, error: "Cancelled." }; }
      const pct = i / 100;
      emit("progress", { phase: "downloading", pct, bytesDone: total * pct, bytesTotal: total, speed: 6.4e6, etaSec: (1 - pct) * total / 6.4e6, file: files[Math.floor(i / 26)], filesDone: Math.floor(i / 26), filesTotal: 4 });
      await wait(fast ? 5 : 60);
    }
    emit("progress", { phase: "finalizing", pct: 1 }); await wait(fast ? 20 : 600);
    st.phase = "idle"; st.update = { state: "ready", installedVersion: "0.3.0", latestVersion: "0.3.0" }; push();
    return { ok: true };
  }

  window.launcherApi = {
    mock: true,
    async info() {
      return { launcherVersion: "1.0.0", platform: "linux", config: { website: "https://swordandseal.com", support: "https://swordandseal.com/support", gameServerUrl: "wss://play.swordandseal.com", apiBaseUrl: "https://play.swordandseal.com", releaseBaseUrl: "https://dl.swordandseal.com/game" }, settings: { ...settings }, session, snapshot: snapshot() };
    },
    on(ev, f) { (handlers[ev] ||= []).push(f); return () => { handlers[ev] = handlers[ev].filter((x) => x !== f); }; },
    async auth(kind, name, pw) {
      await wait(250);
      if (name.toLowerCase() === "taken" && kind === "register") return { ok: false, error: "That name is already taken." };
      if (pw === "wrongpw") return { ok: false, error: "Wrong name or password." };
      session = { name }; return { ok: true, name };
    },
    async logout() { session = null; return { ok: true }; },
    async refresh() { push(); return st.update; },
    async refreshStatus() { emit("status", st.status); return st.status; },
    async getNews() { return news; },
    async startUpdate() { if (q.get("paused") === "1") return { ok: true }; return fakeDownload(); },
    async verify() { return fakeDownload(); },
    cancelUpdate() { cancelled = true; return { ok: true }; },
    async play() {
      if (running) return { ok: false, error: "Busy." };
      running = true; st.phase = "playing"; st.game = { running: true }; push();
      setTimeout(() => { running = false; st.phase = "idle"; st.game = null; push(); }, 4000);
      return { ok: true, kind: "mock" };
    },
    async setSettings(p) { Object.assign(settings, p); return { ...settings }; },
    async pickFolder() { return "/mnt/games/SwordAndSeal"; },
    openExternal(u) { console.log("openExternal", u); },
    minimize() {}, close() {},
  };
  if (scene === "updating") {
    // hold the progress UI at 42% for screenshots
    setTimeout(() => emit("progress", { phase: "downloading", pct: 0.42, bytesDone: 20328000, bytesTotal: 48400000, speed: 6.4e6, etaSec: 4.4, file: "game/client/dist/assets/index-CfaYlupf.js", filesDone: 17, filesTotal: 39 }), 100);
  }
})();
