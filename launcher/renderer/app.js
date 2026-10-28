// Launcher UI. Talks to the main process only through window.launcherApi (preload bridge, or mock-bridge.js with ?mock=1).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const api = window.launcherApi;
  let info = null, snap = null, mode = "login", busyAuth = false, loggedIn = null, lastProgress = null;

  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const fmtBytes = (n) => { if (!Number.isFinite(n)) return "?"; const u = ["B", "KB", "MB", "GB"]; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };
  const fmtEta = (s) => { if (!Number.isFinite(s) || s == null) return ""; if (s < 60) return `${Math.max(1, Math.ceil(s))}s left`; const m = Math.floor(s / 60); return m < 60 ? `${m}m ${Math.ceil(s % 60)}s left` : `${Math.floor(m / 60)}h ${m % 60}m left`; };
  const fmtDate = (d) => { const t = Date.parse(d); if (Number.isNaN(t)) return d || ""; return new Date(t).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); };

  function show(el, on) { el.hidden = !on; }
  function setError(el, msg) { el.textContent = msg || ""; show(el, !!msg); }

  // ---------- account ----------
  function setMode(m) {
    mode = m;
    $("tab-login").classList.toggle("on", m === "login"); $("tab-register").classList.toggle("on", m === "register");
    $("tab-login").setAttribute("aria-selected", m === "login"); $("tab-register").setAttribute("aria-selected", m === "register");
    $("auth-submit").textContent = m === "login" ? "Sign in" : "Create account";
    $("in-pw").autocomplete = m === "login" ? "current-password" : "new-password";
    $("auth-hint").textContent = m === "login" ? "New here? Choose Register to create an account." : "Pick a name and a password of 4 to 64 characters.";
    setError($("auth-error"), "");
  }
  function renderAccount() {
    show($("login-view"), !loggedIn); show($("user-view"), !!loggedIn);
    if (loggedIn) { $("user-name").textContent = loggedIn; $("user-initial").textContent = loggedIn.trim().charAt(0).toUpperCase(); }
  }
  async function submitAuth(ev) {
    ev.preventDefault();
    if (busyAuth) return;
    const name = $("in-name").value.trim(), pw = $("in-pw").value;
    busyAuth = true; $("auth-submit").disabled = true; setError($("auth-error"), "");
    try {
      try { await api.setSettings({ remember: $("in-remember").checked }); } catch { /* busy */ }
      const r = await api.auth(mode, name, pw);
      if (r.ok) { loggedIn = r.name; $("in-pw").value = ""; renderAccount(); render(); }
      else setError($("auth-error"), r.error || "Could not sign in.");
    } catch { setError($("auth-error"), "Something went wrong. Please try again."); }
    busyAuth = false; $("auth-submit").disabled = false;
  }

  // ---------- news ----------
  function renderNews(n) {
    const list = $("news-list"); list.textContent = "";
    show($("news-badge"), !!(n && n.cached));
    const items = n?.items || [];
    if (!items.length) {
      const e = h("div", "empty"); e.append(h("b", "", "No notices yet"), document.createTextNode(n?.error ? "The news feed could not be loaded. It will appear here when you are online." : "Check back soon for patch notes and events."));
      list.append(e); return;
    }
    for (const it of items) {
      const c = h("article", "card");
      if (it.date) c.append(h("div", "date", fmtDate(it.date)));
      c.append(h("h3", "", it.title));
      let ul = null;
      for (const line of String(it.body || "").split("\n")) {
        const t = line.trim();
        if (!t) { ul = null; continue; }
        if (t.startsWith("- ") || t.startsWith("* ")) { if (!ul) { ul = h("ul"); c.append(ul); } ul.append(h("li", "", t.slice(2))); }
        else { ul = null; c.append(h("p", "", t)); }
      }
      list.append(c);
    }
  }

  // ---------- status ----------
  function renderStatus(s) {
    const pill = $("status-pill");
    pill.className = "pill " + (!s || !s.checked ? "checking" : s.online ? "online" : "offline");
    $("status-text").textContent = !s || !s.checked ? "Checking server" : s.online ? "Server online" : "Server offline";
    $("status-detail").textContent = s && s.checked && s.online ? `${s.players} ${s.players === 1 ? "player" : "players"} online  |  ${s.latencyMs} ms` : s && s.checked ? "The realm cannot be reached right now." : " ";
  }

  // ---------- play / update button ----------
  function render() {
    if (!snap) return;
    const u = snap.update || {};
    const btn = $("btn-play"), label = $("play-label");
    btn.className = "play"; let text = "Checking", enabled = false, note = "";
    const updating = snap.phase === "updating", playing = snap.phase === "playing" || !!snap.game;
    $("ver-installed").textContent = u.installedVersion ? `v${u.installedVersion}` : "Not installed";
    $("ver-latest").textContent = u.latestVersion ? `v${u.latestVersion}` : "--";
    if (updating) { text = "Updating"; note = ""; }
    else if (playing) { text = "Game running"; btn.classList.add("running"); note = "Enjoy your journey."; }
    else if (snap.phase === "checking" && (!u.state || u.state === "unknown")) { text = "Checking"; }
    else {
      switch (u.state) {
        case "launcher-outdated": text = "Update launcher"; enabled = true; btn.classList.add("warn"); note = `Launcher update required (v${u.minLauncherVersion} or newer).`; break;
        case "not-installed": text = u.offline ? "Offline" : "Install"; enabled = !u.offline; note = u.needBytes ? `Download size ${fmtBytes(u.needBytes)}` : ""; break;
        case "repair": text = "Repair"; enabled = !u.offline; note = "The last update did not finish. Repair it to continue."; break;
        case "update-available": text = "Update"; enabled = true; note = u.needBytes ? `Download size ${fmtBytes(u.needBytes)}` : "A new version is available."; break;
        case "ready": text = "Play"; enabled = !!loggedIn; note = loggedIn ? (u.offline ? "Update server unreachable. Playing the installed version." : "Up to date.") : "Sign in to play."; break;
        default: text = "Checking";
      }
    }
    label.textContent = text; btn.disabled = !enabled;
    if (text.length > 9) btn.classList.add("long");
    $("play-note").textContent = note;
    $("btn-settings").disabled = updating || playing;
    show($("progress"), updating);
    if (!updating) lastProgress = null;
    setError($("side-error"), snap.error);
    renderStatus(snap.status);
  }

  function renderProgress(p) {
    lastProgress = p;
    const bar = $("bar-fill");
    const indet = p.phase === "checking" || p.phase === "finalizing";
    bar.classList.toggle("indet", indet);
    if (!indet) bar.style.width = `${Math.round((p.pct || 0) * 100)}%`; else bar.style.width = "";
    $("p-pct").textContent = indet ? "" : `${Math.round((p.pct || 0) * 100)}%`;
    if (p.phase === "downloading") {
      $("p-speed").textContent = p.speed > 0 ? `${fmtBytes(p.speed)}/s` : ""; $("p-eta").textContent = fmtEta(p.etaSec);
      $("p-file").textContent = p.file ? `${p.filesDone}/${p.filesTotal}  ${p.file}` : "";
    } else {
      $("p-speed").textContent = { checking: "Checking files", verifying: "Verifying files", finalizing: "Finishing up", done: "Done" }[p.phase] || "";
      $("p-eta").textContent = p.phase === "verifying" ? `${p.filesDone}/${p.filesTotal}` : "";
      $("p-file").textContent = p.phase === "verifying" ? p.file || "" : "";
    }
  }

  async function onPlayClick() {
    const u = snap?.update || {};
    setError($("side-error"), "");
    if (u.state === "launcher-outdated") return api.openExternal(info.config.website);
    if (u.state === "ready") {
      $("btn-play").disabled = true;
      const r = await api.play();
      if (!r.ok) setError($("side-error"), r.error);
      return;
    }
    if (["not-installed", "update-available", "repair"].includes(u.state)) {
      renderProgress({ phase: "checking", pct: 0 }); show($("progress"), true);
      const r = await api.startUpdate();
      if (!r.ok && !r.cancelled) setError($("side-error"), r.error);
    }
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
      show($("settings"), false);
    } catch (e) { setError($("set-error"), e.message || "Could not save settings."); }
  }

  // ---------- init ----------
  async function init() {
    if (!api) { document.body.textContent = "Launcher bridge missing."; return; }
    info = await api.info();
    $("foot-ver").textContent = `Launcher v${info.launcherVersion}`;
    $("link-site").addEventListener("click", (e) => { e.preventDefault(); api.openExternal(info.config.website); });
    $("link-support").addEventListener("click", (e) => { e.preventDefault(); api.openExternal(info.config.support); });
    $("btn-min").addEventListener("click", () => api.minimize());
    $("btn-close").addEventListener("click", () => api.close());
    $("tab-login").addEventListener("click", () => setMode("login"));
    $("tab-register").addEventListener("click", () => setMode("register"));
    $("auth-form").addEventListener("submit", submitAuth);
    $("btn-logout").addEventListener("click", async () => { await api.logout(); loggedIn = null; renderAccount(); render(); $("in-pw").focus(); });
    $("btn-play").addEventListener("click", onPlayClick);
    $("btn-cancel").addEventListener("click", () => api.cancelUpdate());
    $("btn-settings").addEventListener("click", openSettings);
    $("btn-set-cancel").addEventListener("click", () => show($("settings"), false));
    $("btn-set-save").addEventListener("click", saveSettings);
    $("btn-browse").addEventListener("click", async () => { const p = await api.pickFolder(); if (p) $("set-dir").value = p; });
    $("btn-verify").addEventListener("click", async () => { show($("settings"), false); renderProgress({ phase: "verifying", pct: 0, filesDone: 0, filesTotal: 0 }); show($("progress"), true); const r = await api.verify(); if (!r.ok && !r.cancelled) setError($("side-error"), r.error); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") show($("settings"), false); });

    api.on("state", (s) => { snap = s; render(); });
    api.on("progress", renderProgress);
    api.on("status", (s) => { if (snap) { snap.status = s; renderStatus(s); } });
    api.on("news", renderNews);

    if (info.settings.remember && info.settings.lastName) $("in-name").value = info.settings.lastName;
    $("in-remember").checked = info.settings.remember !== false;
    loggedIn = info.session ? info.session.name : null;
    snap = info.snapshot; setMode("login"); renderAccount(); renderStatus(snap.status); render();
    api.getNews().then(renderNews);
    api.refresh();
    api.refreshStatus();
    (loggedIn ? $("btn-play") : $("in-name").value ? $("in-pw") : $("in-name")).focus();
    document.documentElement.dataset.ready = "1";
  }
  init();
})();
