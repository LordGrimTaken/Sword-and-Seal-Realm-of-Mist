// In-browser mock of the preload bridge. Active only when the page URL has ?mock=1 and no real bridge exists.
// Scenes (?scene=): login | loginerror | register | install | downloading (mid-progress, frozen) | verifying | ready | update | offline | launching | outdated | whatsnew (update completes -> What's new card)
// Extra: &fast=1 speeds up the fake download. Clicking buttons in any scene runs the fake flows (sign in, install, play).
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get("mock") !== "1" || window.launcherApi) return;
  const scene = q.get("scene") || "login";
  const handlers = {};
  const emit = (ev, d) => (handlers[ev] || []).forEach((f) => f(d));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settings = { installDir: "/home/player/.local/share/SwordAndSeal/Game", serverUrl: "", closeOnPlay: false, remember: true, lastName: ["login", "loginerror", "register"].includes(scene) ? "Wanderer" : "" };
  const news = { cached: false, items: [
    { id: "open-for-testing", tag: "Announcement", banner: "valley", title: "Open for testing", date: "2026-10-28", body: "The doors of the Realm of Mist are open.\n\n- Create a character and pick a class.\n- Hunt in the bamboo groves.\n- Party up with other testers.", summary: "The doors of the Realm of Mist are open. Sign in, let the launcher fetch the game, and step into Cloudmist Valley." },
    { id: "combat-changes", tag: "Coming soon", banner: "blades", title: "Combat changes in 0.4", date: "2026-10-27", body: "x", summary: "Dodge rolls and a Qi pool are on the way. Every skill will cost Qi, so timing matters." },
    { id: "how-to-play", tag: "Guide", banner: "scroll", title: "How to play", date: "2026-10-26", body: "x", summary: "Move with WASD, fight with keys 1 to 4, and talk to villagers with F." },
  ] };
  // The whatsnew scene pretends an update just finished: the first state is the old install, then it flips to 0.3.0.
  if (scene === "whatsnew") {
    news.items.unshift({ id: "update-0-3", tag: "Update 0.3", banner: "lantern", date: "2026-10-30", title: "Lanterns over the valley",
      body: "The Realm of Mist grows with its biggest update yet.\n\n- Party up with up to five players.\n- Open treasure caches on the roads.\n- Meet the Hollow Bride in the eastern hills.",
      summary: "Party up, hunt for treasure caches and meet a fourth boss." });
  }
  const ver = "0.3.0";
  const st = {
    phase: "idle", error: null, offline: false, game: null,
    update: { state: "ready", installedVersion: ver, latestVersion: ver },
    status: { online: true, players: 12, latencyMs: 34, version: ver, checked: true },
  };
  let session = ["login", "loginerror", "register"].includes(scene) ? null : { name: "Wanderer" };
  let cancelled = false, running = false;
  if (scene === "install") st.update = { state: "not-installed", installedVersion: null, latestVersion: ver, needBytes: 46200000 };
  if (scene === "downloading") { st.phase = "updating"; st.update = { state: "not-installed", installedVersion: null, latestVersion: ver, needBytes: 46200000 }; }
  if (scene === "verifying") { st.phase = "updating"; st.update = { state: "not-installed", installedVersion: null, latestVersion: ver, needBytes: 46200000 }; }
  if (scene === "update") st.update = { state: "update-available", installedVersion: "0.2.0", latestVersion: ver, needBytes: 12400000 };
  if (scene === "outdated") st.update = { state: "launcher-outdated", installedVersion: ver, latestVersion: "0.4.0", minLauncherVersion: "1.2.0" };
  if (scene === "offline") { st.status = { online: false, players: 0, latencyMs: null, checked: true }; }
  if (scene === "launching") { st.phase = "playing"; st.game = { running: true }; }
  const snapshot = () => JSON.parse(JSON.stringify(st));
  const push = () => emit("state", snapshot());
  const FILES = ["game/client/dist/assets/index-CfaYlupf.js", "game/electron/linux/resources/app.asar", "game/server/dist/server.mjs", "game/client/dist/index.html"];

  async function fakeDownload() {
    const total = 46200000, fast = q.get("fast") === "1"; cancelled = false;
    st.phase = "updating"; st.error = null; push();
    emit("progress", { phase: "checking", pct: 0 }); await wait(fast ? 50 : 500);
    for (let i = 0; i <= 100; i += 2) {
      if (cancelled) { st.phase = "idle"; push(); return { ok: false, cancelled: true, error: "Cancelled." }; }
      const pct = i / 100;
      emit("progress", { phase: "downloading", pct, bytesDone: total * pct, bytesTotal: total, speed: 6.4e6, etaSec: (1 - pct) * total / 6.4e6, file: FILES[Math.min(3, Math.floor(i / 26))], filesDone: Math.floor(pct * 39), filesTotal: 39 });
      await wait(fast ? 5 : 90);
    }
    emit("progress", { phase: "finalizing", pct: 1 }); await wait(fast ? 20 : 900);
    st.phase = "idle"; st.update = { state: "ready", installedVersion: ver, latestVersion: ver }; push();
    return { ok: true };
  }

  window.launcherApi = {
    mock: true,
    async info() {
      return { launcherVersion: "1.3.0", platform: "linux", config: { website: "https://swordandseal.com", support: "https://swordandseal.com/support", gameServerUrl: "wss://play.swordandseal.com", apiBaseUrl: "https://play.swordandseal.com", releaseBaseUrl: "https://dl.swordandseal.com/game" }, settings: { ...settings }, session, snapshot: snapshot() };
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
    async startUpdate() { return fakeDownload(); },
    async verify() { return fakeDownload(); },
    cancelUpdate() { cancelled = true; return { ok: true }; },
    async play() {
      if (running) return { ok: false, error: "Busy." };
      running = true; st.phase = "playing"; st.game = { running: true }; push();
      setTimeout(() => { running = false; st.phase = "idle"; st.game = null; push(); }, 8000);
      return { ok: true, kind: "mock" };
    },
    async setSettings(p) { Object.assign(settings, p); return { ...settings }; },
    async pickFolder() { return "/mnt/games/SwordAndSeal"; },
    openExternal(u) { console.log("openExternal", u); },
    minimize() {}, close() {},
  };
  // frozen scenes for screenshots
  if (scene === "downloading") setTimeout(() => emit("progress", { phase: "downloading", pct: 0.42, bytesDone: 19404000, bytesTotal: 46200000, speed: 6.4e6, etaSec: 4.2, file: FILES[1], filesDone: 17, filesTotal: 39 }), 150);
  if (scene === "verifying") setTimeout(() => emit("progress", { phase: "verifying", pct: 0.68, filesDone: 27, filesTotal: 39, file: "game/client/dist/assets/index-CfaYlupf.js" }), 150);
})();
