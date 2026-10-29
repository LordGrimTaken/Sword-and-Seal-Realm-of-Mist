// Launcher UI. Talks to the main process only through window.launcherApi (preload bridge, or mock-bridge.js with ?mock=1).
// Primary button flow: Sign in -> Install / Update / Repair -> Downloading (pause/resume) -> Verifying -> PLAY -> Launching -> In game.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const api = window.launcherApi;
  let info = null, snap = null, mode = "login", busyAuth = false, loggedIn = null;
  let prog = null;            // last progress event of the current/paused task
  let paused = false;         // the download was paused by the player (partial files are kept on disk)
  let launchingUntil = 0;     // PLAY clicked: show "Launching" until this time
  let newsItems = [];

  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const fmtBytes = (n) => { if (!Number.isFinite(n)) return "?"; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };
  const fmtEta = (s) => { if (!Number.isFinite(s) || s == null) return ""; if (s < 60) return `${Math.max(1, Math.ceil(s))}s left`; const m = Math.floor(s / 60); return m < 60 ? `${m}m ${Math.ceil(s % 60)}s left` : `${Math.floor(m / 60)}h ${m % 60}m left`; };
  const fmtDate = (d) => { const t = Date.parse(d); if (Number.isNaN(t)) return d || ""; return new Date(t).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };
  const show = (el, on) => { el.hidden = !on; };
  const setError = (el, msg) => { el.textContent = msg || ""; show(el, !!msg); };
  const pct = (p) => Math.round(Math.max(0, Math.min(1, (p && p.pct) || 0)) * 100);

  // ---------- account ----------
  function setMode(m) {
    mode = m;
    const login = m === "login";
    $("auth-eyebrow").textContent = login ? "Sign in" : "New account";
    $("auth-title").textContent = login ? "Welcome, traveler" : "Join the realm";
    $("auth-sub").textContent = login ? "Sign in to enter the Realm of Mist." : "Pick a name and a password of 4 to 64 characters.";
    $("auth-submit").textContent = login ? "Sign in" : "Create account";
    $("switch-lead").textContent = login ? "New to the realm?" : "Already have an account?";
    $("link-switch").textContent = login ? "Create an account" : "Sign in";
    $("in-pw").autocomplete = login ? "current-password" : "new-password";
    setError($("auth-error"), "");
    render();
  }
  function renderAccount() {
    show($("login-view"), !loggedIn); show($("user-view"), !!loggedIn);
    $("app").dataset.view = loggedIn ? "user" : "login";
    if (loggedIn) {
      $("user-name").textContent = loggedIn; $("user-initial").textContent = loggedIn.trim().charAt(0).toUpperCase();
      const dir = info?.settings?.installDir || ""; const seg = dir.split(/[\\/]+/).filter(Boolean); $("user-dir").textContent = seg.length > 2 ? `.../${seg.slice(-2).join("/")}` : dir; $("user-dir").title = dir;
    }
  }
  async function submitAuth(ev) {
    if (ev) ev.preventDefault();
    if (busyAuth) return;
    const name = $("in-name").value.trim(), pw = $("in-pw").value;
    busyAuth = true; $("auth-submit").disabled = true; setError($("auth-error"), "");
    try {
      try { await api.setSettings({ remember: $("in-remember").checked }); } catch { /* busy */ }
      const r = await api.auth(mode, name, pw);
      if (r.ok) { loggedIn = r.name; $("in-pw").value = ""; renderAccount(); }
      else { setError($("auth-error"), r.error || "Could not sign in."); $("in-pw").focus(); }
    } catch { setError($("auth-error"), "Something went wrong. Please try again."); }
    busyAuth = false; $("auth-submit").disabled = false; render();
  }

  // ---------- news ----------
  const BANNERS = ["valley", "blades", "scroll", "lantern"];
  function summaryOf(it) {
    if (it.summary) return it.summary;
    const para = String(it.body || "").split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("- ")) || "";
    const t = para.replace(/\s+/g, " ");
    return t.length > 150 ? t.slice(0, 147).replace(/\s+\S*$/, "") + "..." : t;
  }
  function art(it, i) { const a = h("span", "art"); a.innerHTML = window.Hero.banner(BANNERS.includes(it.banner) ? it.banner : BANNERS[i % BANNERS.length]); return a; }
  function renderNews(n) {
    const list = $("news-list"); list.textContent = "";
    show($("news-badge"), !!(n && n.cached));
    newsItems = (n?.items || []).slice(0, 4);
    if (!newsItems.length) {
      const e = h("div", "news-empty card"); e.append(h("b", "", "No news yet"), document.createTextNode(n?.error ? "The news could not be loaded. It will appear here when you are online." : "Check back soon for events and updates."));
      list.append(e); return;
    }
    newsItems.forEach((it, i) => {
      const feat = i === 0;
      const c = h("button", "ncard " + (feat ? "feat" : "cmp")); c.type = "button";
      const tag = it.tag ? h("span", "tag", it.tag) : null;
      const a = art(it, i); if (feat && tag) a.append(tag);
      const txt = h("span", "txt"); const meta = h("span", "meta");
      if (!feat && tag) meta.append(tag);
      if (it.date) meta.append(h("span", "date", fmtDate(it.date)));
      txt.append(meta, h("h3", "", it.title), h("p", "", summaryOf(it)));
      c.append(a, txt);
      c.addEventListener("click", () => openReader(it, i));
      list.append(c);
    });
  }
  function openReader(it, i) {
    const b = $("reader-banner"); b.innerHTML = window.Hero.banner(BANNERS.includes(it.banner) ? it.banner : BANNERS[i % BANNERS.length]);
    $("reader-tag").textContent = it.tag || ""; show($("reader-tag"), !!it.tag);
    $("reader-date").textContent = fmtDate(it.date); $("reader-title").textContent = it.title;
    const body = $("reader-body"); body.textContent = ""; let ul = null;
    for (const line of String(it.body || "").split("\n")) {
      const t = line.trim();
      if (!t) { ul = null; continue; }
      if (t.startsWith("- ") || t.startsWith("* ")) { if (!ul) { ul = h("ul"); body.append(ul); } ul.append(h("li", "", t.slice(2))); }
      else { ul = null; body.append(h("p", "", t)); }
    }
    body.scrollTop = 0; show($("reader"), true); $("btn-reader-close").focus();
  }

  // ---------- status ----------
  function renderStatus(s) {
    const line = $("status-line");
    line.className = "st-line " + (!s || !s.checked ? "checking" : s.online ? "online" : "offline");
    $("status-text").textContent = !s || !s.checked ? "Checking server" : s.online ? "Server online" : "Server offline";
    $("status-detail").textContent = s && s.checked && s.online ? `${s.players} ${s.players === 1 ? "player" : "players"} | ${s.latencyMs} ms` : s && s.checked ? "cannot be reached" : "";
  }

  // ---------- the state machine behind the bar and the big button ----------
  // Returns { label, enabled, cls, text, right, bar: idle|pct|indet|ready|paused, value, stats:bool, pause:null|"Pause"|"Resume" }
  function model() {
    const u = snap.update || {}, p = prog;
    const updating = snap.phase === "updating", playing = snap.phase === "playing" || !!snap.game;
    const size = u.needBytes ? fmtBytes(u.needBytes) : "";
    const m = { label: "Checking", enabled: false, cls: "", text: "Checking for updates", right: "", bar: "idle", value: 0, stats: false, pause: null };
    if (playing) {
      if (Date.now() < launchingUntil) return { ...m, label: "Launching", text: "Opening the Realm of Mist", bar: "indet", cls: "long" };
      return { ...m, label: "In game", text: "The game is running. Enjoy your journey.", bar: "ready", value: 100, cls: "jade" };
    }
    if (updating) {
      const ph = p?.phase || "checking";
      if (ph === "downloading") return { ...m, label: "Downloading", cls: "long", text: u.state === "update-available" ? "Downloading update" : "Downloading game files", bar: "pct", value: pct(p), stats: true, pause: "Pause" };
      if (ph === "verifying") return { ...m, label: "Verifying", cls: "long", text: "Verifying files", bar: p.filesTotal ? "pct" : "indet", value: pct(p), stats: true };
      if (ph === "finalizing" || ph === "done") return { ...m, label: "Verifying", cls: "long", text: "Verifying and installing files", bar: "indet" };
      return { ...m, label: "Preparing", cls: "long", text: "Preparing download", bar: "indet" };
    }
    if (paused && ["not-installed", "update-available", "repair"].includes(u.state)) {
      return { ...m, label: "Resume", enabled: true, text: `Download paused at ${pct(p)}%`, bar: "paused", value: pct(p), pause: "Resume", cls: "gold" };
    }
    if (snap.phase === "checking" && (!u.state || u.state === "unknown")) return m;
    const sizeTxt = size ? ` (${size})` : "";
    const needsLogin = !loggedIn;
    switch (u.state) {
      case "launcher-outdated": return { ...m, label: "Get launcher", cls: "long gold", enabled: true, text: `A newer launcher is required (v${u.minLauncherVersion} or later).`, bar: "idle" };
      case "not-installed":
        if (u.offline) return { ...m, label: "Offline", text: "Cannot reach the update server. Check your connection.", bar: "idle" };
        return needsLogin ? { ...m, label: "Sign in", enabled: true, text: `Sign in, then install the game${sizeTxt}.` }
          : { ...m, label: "Install", enabled: true, cls: "pulse", text: `Ready to install${sizeTxt}. Pick Install to begin.` };
      case "repair":
        if (u.offline) return { ...m, label: "Offline", text: "Cannot reach the update server. Check your connection.", bar: "idle" };
        return needsLogin ? { ...m, label: "Sign in", enabled: true, text: "Sign in to finish the interrupted update." } : { ...m, label: "Repair", enabled: true, cls: "pulse", text: "The last update did not finish. Repair it to continue." };
      case "update-available":
        return needsLogin ? { ...m, label: "Sign in", enabled: true, text: `Update available${sizeTxt}. Sign in to continue.` }
          : { ...m, label: "Update", enabled: true, cls: "pulse", text: `Update available: v${u.latestVersion}${sizeTxt}.` };
      case "ready": {
        const warn = u.offline ? "Update server unreachable. Playing the installed version." : (snap.status?.checked && !snap.status.online) ? "The realm looks offline. You can still try." : "Game is up to date. Ready to play.";
        return needsLogin ? { ...m, label: "Sign in", enabled: true, text: "Sign in to play.", bar: "idle" }
          : { ...m, label: "Play", enabled: true, cls: "pulse", text: warn, bar: "ready", value: 100 };
      }
      default: return m;
    }
  }

  function render() {
    if (!snap) return;
    const u = snap.update || {}, m = model();
    const updating = snap.phase === "updating", playing = snap.phase === "playing" || !!snap.game;
    if (!updating && !paused) prog = null;
    // left status block
    $("ver-installed").textContent = u.installedVersion ? `v${u.installedVersion}` : "Not installed";
    const outdated = u.latestVersion && u.installedVersion !== u.latestVersion;
    show($("ver-arrow"), !!outdated); show($("ver-latest"), !!outdated); show($("ver-chip"), !!outdated);
    if (outdated) { $("ver-latest").textContent = `v${u.latestVersion}`; $("ver-chip").textContent = u.installedVersion ? "Update" : "Latest"; }
    $("user-game").textContent = u.installedVersion ? `v${u.installedVersion}${outdated ? " (update available)" : ""}` : "Not installed";
    // button
    const btn = $("btn-play");
    btn.className = "play " + m.cls; btn.disabled = !m.enabled; $("play-label").textContent = m.label;
    if (m.label.length > 8 && !btn.classList.contains("long")) btn.classList.add("long");
    // center
    $("bc-state").textContent = m.text;
    const bar = $("track"), fill = $("track-fill");
    bar.className = "track " + (m.bar === "ready" ? "ready" : m.bar === "indet" ? "indet" : m.bar === "paused" ? "paused" : m.bar === "idle" ? "idle" : "");
    fill.style.width = m.bar === "pct" || m.bar === "paused" || m.bar === "ready" ? `${m.value}%` : "0%";
    show($("btn-pause"), !!m.pause); if (m.pause) $("btn-pause").textContent = m.pause;
    fillStats(m);
    const err = snap.error && !updating ? snap.error : "";
    setError($("side-error"), err); $("bc-right").textContent = "";
    document.querySelector(".bar-center").classList.toggle("has-error", !!err);
    $("btn-settings").disabled = updating || playing;
    renderStatus(snap.status);
  }

  function fillStats(m) {
    const p = prog, on = m.stats || m.bar === "paused";
    const set = (id, v) => { $(id).textContent = on && v ? v : ""; };
    if (!on || !p) { set("p-pct", ""); set("p-speed", ""); set("p-bytes", ""); set("p-files", ""); set("p-eta", ""); $("p-file").textContent = ""; $("p-pct").textContent = m.bar === "paused" ? `${m.value}%` : ""; return; }
    $("p-pct").textContent = `${pct(p)}%`;
    if (p.phase === "downloading") {
      set("p-speed", p.speed > 0 && snap.phase === "updating" ? `${fmtBytes(p.speed)}/s` : "");
      set("p-bytes", Number.isFinite(p.bytesTotal) ? `${fmtBytes(p.bytesDone)} / ${fmtBytes(p.bytesTotal)}` : "");
      set("p-files", p.filesTotal ? `${p.filesDone} / ${p.filesTotal} files` : "");
      set("p-eta", snap.phase === "updating" ? fmtEta(p.etaSec) : "");
      $("p-file").textContent = snap.phase === "updating" && p.file ? p.file : "";
    } else if (p.phase === "verifying") {
      set("p-speed", ""); set("p-bytes", ""); set("p-files", p.filesTotal ? `${p.filesDone} / ${p.filesTotal} files` : ""); set("p-eta", "");
      $("p-file").textContent = p.file || "";
    } else { set("p-speed", ""); set("p-bytes", ""); set("p-files", ""); set("p-eta", ""); $("p-file").textContent = ""; }
  }

  function onProgress(p) { prog = p; if (snap) render(); }

  async function startInstall() {
    const resumePct = paused && prog ? prog.pct : 0;
    paused = false; setError($("side-error"), "");
    try { await api.offerDefenderExclusion(); } catch { /* optional step */ }
    prog = { phase: "checking", pct: resumePct };
    snap.phase = "updating"; render();
    const r = await api.startUpdate();
    if (r && r.cancelled) { paused = true; }
    else if (r && !r.ok) { paused = false; setError($("side-error"), r.error); document.querySelector(".bar-center").classList.add("has-error"); }
    else paused = false;
    render();
  }

  async function onPlayClick() {
    const u = snap?.update || {};
    setError($("side-error"), "");
    if (u.state === "launcher-outdated") return api.openExternal(info.config.website);
    if (paused && !loggedIn) { paused = false; }
    if (!loggedIn) {
      const form = $("auth-form");
      if ($("in-name").value.trim() && $("in-pw").value) return submitAuth();
      return ($("in-name").value.trim() ? $("in-pw") : $("in-name")).focus(), form.scrollIntoView?.();
    }
    if (u.state === "ready") {
      $("btn-play").disabled = true; launchingUntil = Date.now() + 3500; snap.phase = "playing"; render();
      setTimeout(() => { if (snap) render(); }, 3600);
      const r = await api.play();
      if (!r.ok) { launchingUntil = 0; snap.phase = "idle"; setError($("side-error"), r.error); render(); }
      return;
    }
    if (["not-installed", "update-available", "repair"].includes(u.state)) await startInstall();
  }

  // ---------- settings ----------
  function openSettings() {
    const s = info.settings;
    $("set-dir").value = s.installDir; $("set-server").value = s.serverUrl || ""; $("set-close").checked = !!s.closeOnPlay;
    $("set-server").placeholder = `Default: ${info.config.gameServerUrl}`;
    setError($("set-error"), ""); show($("settings"), true);
  }
  async function saveSettings() {
    try {
      const url = $("set-server").value.trim();
      if (url && !/^wss?:\/\/[^\s]+$/i.test(url)) return setError($("set-error"), "The server address must start with ws:// or wss://");
      info.settings = await api.setSettings({ installDir: $("set-dir").value, serverUrl: url, closeOnPlay: $("set-close").checked });
      show($("settings"), false); renderAccount();
    } catch (e) { setError($("set-error"), e.message || "Could not save settings."); }
  }
  async function detectDir() {
    const note = $("detect-note"); note.hidden = false; note.textContent = "Looking...";
    const r = await api.detectInstallDir();
    if (!r || !r.ok) { note.textContent = (r && r.error) || "Could not detect a folder."; return; }
    $("set-dir").value = r.dir; note.textContent = r.reason + " Press Save to use it.";
  }
  async function checkLauncherUpdate() {
    const n = $("launcher-update-note"); n.textContent = "Checking...";
    const r = await api.checkLauncherUpdate();
    if (!r || !r.ok) n.textContent = "Could not check: " + ((r && r.error) || "no answer") ;
    else if (r.status === "disabled") n.textContent = "Launcher updates are turned off in this build.";
    else if (r.status === "available") n.textContent = `Version ${r.version} found. Downloading it now; you will be asked to restart.`;
    else n.textContent = "You have the latest launcher.";
  }
  const closeModals = () => { show($("settings"), false); show($("reader"), false); };

  // ---------- init ----------
  function onLauncherUpdate(d) {
    const n = $("launcher-update-note"); if (!n || !d) return;
    if (d.status === "downloading") n.textContent = d.pct != null ? `Downloading launcher update... ${d.pct}%` : `Downloading launcher ${d.version || ""}...`;
    else if (d.status === "ready") {
      n.textContent = `Launcher ${d.version || ""} is ready. `;
      const b = document.createElement("a"); b.href = "#"; b.textContent = "Restart now"; b.addEventListener("click", (e) => { e.preventDefault(); api.installLauncherUpdate(); });
      n.append(b);
    } else if (d.status === "error") n.textContent = "Launcher update problem: " + d.error;
  }
  async function init() {
    if (!api) { document.body.textContent = "Launcher bridge missing."; return; }
    window.Hero.mount($("scene"), $("fx"));
    info = await api.info();
    $("foot-ver").textContent = `Launcher v${info.launcherVersion}`;
    $("link-site").addEventListener("click", (e) => { e.preventDefault(); api.openExternal(info.config.website); });
    $("link-support").addEventListener("click", (e) => { e.preventDefault(); api.openExternal(info.config.support); });
    $("btn-detect").addEventListener("click", detectDir);
    $("btn-defender").addEventListener("click", async () => { const n = $("defender-note"); n.textContent = "Waiting for Windows..."; const r = await api.addDefenderExclusion(); n.textContent = r && r.ok ? (r.skipped ? "Not needed on this system." : "Done. Defender will skip the game folder.") : "Could not add it: " + ((r && r.error) || "unknown error"); });
    $("btn-unblock").addEventListener("click", async () => { const n = $("unblock-note"); n.textContent = "Working..."; const r = await api.unblockFiles(); n.textContent = r && r.ok ? (r.note || "Done. Files are unblocked.") : "Could not unblock: " + ((r && r.error) || "unknown error"); });
    $("btn-admin").addEventListener("click", async () => { const r = await api.restartAsAdmin(); if (r && !r.ok) setError($("set-error"), r.error); });
    $("btn-log").addEventListener("click", () => api.openLogFolder());
    $("btn-launcher-update").addEventListener("click", checkLauncherUpdate);
    api.on("launcher-update", onLauncherUpdate);
    $("btn-min").addEventListener("click", () => api.minimize());
    $("btn-close").addEventListener("click", () => api.close());
    $("link-switch").addEventListener("click", (e) => { e.preventDefault(); setMode(mode === "login" ? "register" : "login"); });
    $("auth-form").addEventListener("submit", submitAuth);
    $("btn-eye").addEventListener("click", () => { const on = $("in-pw").type === "password"; $("in-pw").type = on ? "text" : "password"; $("btn-eye").classList.toggle("on", on); $("btn-eye").setAttribute("aria-label", on ? "Hide password" : "Show password"); });
    for (const id of ["in-name", "in-pw"]) $(id).addEventListener("input", () => { if (!$("auth-error").hidden) setError($("auth-error"), ""); });
    $("btn-logout").addEventListener("click", async () => { await api.logout(); loggedIn = null; renderAccount(); render(); $("in-pw").focus(); });
    $("btn-play").addEventListener("click", onPlayClick);
    $("btn-pause").addEventListener("click", async () => { if (paused) return startInstall(); paused = true; await api.cancelUpdate(); });
    $("btn-settings").addEventListener("click", openSettings);
    $("btn-set-cancel").addEventListener("click", () => show($("settings"), false));
    $("btn-reader-close").addEventListener("click", () => show($("reader"), false));
    for (const id of ["settings", "reader"]) $(id).addEventListener("mousedown", (e) => { if (e.target === $(id)) show($(id), false); });
    $("btn-set-save").addEventListener("click", saveSettings);
    $("btn-browse").addEventListener("click", async () => { const p = await api.pickFolder(); if (p) $("set-dir").value = p; });
    $("btn-verify").addEventListener("click", async () => {
      show($("settings"), false); paused = false; prog = { phase: "verifying", pct: 0, filesDone: 0, filesTotal: 0 }; snap.phase = "updating"; render();
      const r = await api.verify(); if (!r.ok && !r.cancelled) setError($("side-error"), r.error);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });

    api.on("state", (s) => { snap = s; render(); });
    api.on("progress", onProgress);
    api.on("status", (s) => { if (snap) { snap.status = s; renderStatus(s); if (snap.update?.state === "ready") render(); } });
    api.on("news", renderNews);

    if (info.settings.remember && info.settings.lastName) $("in-name").value = info.settings.lastName;
    $("in-remember").checked = info.settings.remember !== false;
    loggedIn = info.session ? info.session.name : null;
    snap = info.snapshot; setMode("login"); renderAccount(); renderStatus(snap.status); render();
    api.getNews().then(renderNews);
    api.refresh();
    api.refreshStatus();
    if (!loggedIn) ($("in-name").value ? $("in-pw") : $("in-name")).focus();
    document.documentElement.dataset.ready = "1";
  }
  init();
})();
