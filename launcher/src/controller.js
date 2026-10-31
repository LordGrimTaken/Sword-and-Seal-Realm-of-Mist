// LauncherCore: everything the UI needs, with no Electron dependency (testable headlessly).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Updater } from "./updater.js";
import { loadNews } from "./news.js";
import { authenticate, checkHealth } from "./auth.js";
import { launchGame } from "./game.js";
import { Settings } from "./settings.js";

/** Default game folder: Windows uses %LOCALAPPDATA% (not the roaming profile), others keep <userData>/Game. */
export function defaultInstallDir(userData, platform = process.platform) {
  if (platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Sword and Seal", "Game");
  return path.join(userData, "Game");
}

export class LauncherCore extends EventEmitter {
  /** opts: { config, userData, launcherVersion, platform?, tmpDir? } */
  constructor(opts) {
    super();
    this.config = opts.config;
    this.userData = opts.userData;
    this.launcherVersion = opts.launcherVersion;
    this.platform = opts.platform || process.platform;
    this.tmpDir = opts.tmpDir || os.tmpdir();
    fs.mkdirSync(this.userData, { recursive: true });
    this.settings = new Settings(path.join(this.userData, "settings.json"), {
      installDir: defaultInstallDir(this.userData, this.platform), serverUrl: "", closeOnPlay: false, remember: true, lastName: "",
    });
    this._migrateLegacyInstallDir();
    this.session = null; // { name, token, expiresAt } (memory only)
    this._pw = null;     // memory only; used to mint a fresh one-use token at PLAY
    this.phase = "idle"; // idle | checking | updating | playing
    this.update = { state: "unknown" };
    this.error = null;
    this.offline = false;
    this.game = null;
    this.status = { online: false, players: 0, version: null, latencyMs: null, checked: false };
    this._mkUpdater();
  }

  /** Windows: the game used to default to %APPDATA% (roaming profile). Move an unfinished or empty legacy default to the local folder. */
  _migrateLegacyInstallDir() {
    try {
      if (this.platform !== "win32") return;
      const legacy = path.join(this.userData, "Game");
      const cur = this.settings.get().installDir;
      if (path.resolve(cur) !== path.resolve(legacy)) return;
      let st = null;
      try { st = JSON.parse(fs.readFileSync(path.join(legacy, ".install.json"), "utf8")); } catch { /* none */ }
      if (st && st.version && !st.updating) return; // a working install stays where it is
      const next = defaultInstallDir(this.userData, this.platform);
      if (next !== legacy) { this.settings.set({ installDir: next }); this.log(`install folder moved to ${next}`); }
    } catch { /* keep the old folder */ }
  }

  /** Find where the game is (or should be) installed. Looks for an existing install first, otherwise recommends a folder with enough free space. */
  async detectInstallDir() {
    const NEED = 2 * 1024 ** 3; // game plus working room
    const name = "Sword and Seal";
    const home = os.homedir();
    const cands = [this.settings.get().installDir, path.join(this.userData, "Game")];
    if (this.platform === "win32") {
      if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, name, "Game"));
      for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ":\\"; if (fs.existsSync(d)) cands.push(path.join(d, "Games", name), path.join(d, name)); }
    } else {
      cands.push(path.join(home, "Games", name), path.join(home, ".local", "share", name, "Game"), path.join(home, "Applications", name));
    }
    const seen = new Set(); let found = null;
    for (const c of cands) {
      const dir = path.resolve(c); if (seen.has(dir)) continue; seen.add(dir);
      try {
        const st = JSON.parse(fs.readFileSync(path.join(dir, ".install.json"), "utf8"));
        if (st && st.version) { found = { dir, version: st.version, updating: !!st.updating }; break; }
      } catch { /* not here */ }
    }
    const free = async (d) => { try { let p = path.resolve(d); while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p); const s = await fs.promises.statfs(p); return Number(s.bavail) * Number(s.bsize); } catch { return null; } };
    if (found) {
      const f = await free(found.dir);
      return { ok: true, dir: found.dir, existing: true, reason: `Found an existing install (v${found.version}${found.updating ? ", unfinished" : ""}).`, freeBytes: f };
    }
    let best = { dir: defaultInstallDir(this.userData, this.platform) }; best.free = await free(best.dir);
    if (best.free !== null && best.free < NEED) {
      let alt = null;
      if (this.platform === "win32") for (let c = 67; c <= 90; c++) {
        const d = String.fromCharCode(c) + ":\\"; if (!fs.existsSync(d)) continue;
        const f = await free(d); if (f !== null && f >= NEED && (!alt || f > alt.free)) alt = { dir: path.join(d, "Games", name), free: f };
      }
      if (alt) best = alt;
    }
    const gb = (n) => n == null ? "unknown" : `${(n / 1024 ** 3).toFixed(1)} GB`;
    return { ok: true, dir: best.dir, existing: false, freeBytes: best.free, reason: `No existing install found. Recommended folder has ${gb(best.free)} free.` };
  }

  _mkUpdater() {
    this.updater = new Updater({ installDir: this.settings.get().installDir, releaseBaseUrl: this.config.releaseBaseUrl, launcherVersion: this.launcherVersion, platform: this.platform });
    this.updater.on("progress", (p) => this.emit("progress", p));
  }

  serverUrl() { return this.settings.get().serverUrl || this.config.gameServerUrl; }

  info() {
    return {
      launcherVersion: this.launcherVersion, platform: this.platform,
      config: { website: this.config.website, support: this.config.support, apiBaseUrl: this.config.apiBaseUrl, gameServerUrl: this.config.gameServerUrl, releaseBaseUrl: this.config.releaseBaseUrl },
      settings: this.settings.get(), session: this.session ? { name: this.session.name } : null, snapshot: this.snapshot(),
    };
  }
  snapshot() {
    return { phase: this.phase, update: this.update, error: this.error, offline: this.offline, game: this.game ? { running: true } : null, status: this.status };
  }
  _emitState() { this.emit("state", this.snapshot()); }

  // ---- settings ----
  setSettings(patch) {
    const before = this.settings.get().installDir;
    if (this.phase === "updating" || this.phase === "playing") throw new Error("Wait for the current task to finish.");
    const s = this.settings.set(patch);
    if (s.installDir !== before) { this._mkUpdater(); this.update = { state: "unknown" }; this.refresh(); }
    this._emitState();
    return s;
  }

  // ---- auth ----
  async auth(kind, name, pw) {
    const r = await authenticate(this.config.apiBaseUrl, kind, name, pw);
    if (!r.ok) return { ok: false, error: r.error };
    this.session = { name: r.name, token: r.token, expiresAt: Date.now() + r.expiresIn * 1000 };
    this._pw = pw;
    const s = this.settings.get();
    this.settings.set({ lastName: s.remember ? r.name : "" });
    return { ok: true, name: r.name };
  }
  logout() { this.session = null; this._pw = null; this._emitState(); return { ok: true }; }

  // ---- status / news ----
  async refreshStatus() {
    const h = await checkHealth(this.config.apiBaseUrl);
    this.status = { ...h, checked: true };
    this.emit("status", this.status);
    return this.status;
  }
  async getNews() {
    const n = await loadNews({ releaseBaseUrl: this.config.releaseBaseUrl, cacheFile: path.join(this.userData, "news-cache.json") });
    this.emit("news", n);
    return n;
  }

  /** Append to <userData>/launcher.log (no secrets) so problems can be diagnosed. */
  log(msg) {
    try {
      const f = path.join(this.userData, "launcher.log");
      try { if (fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + ".old"); } catch { /* none */ }
      fs.mkdirSync(this.userData, { recursive: true });
      fs.appendFileSync(f, `${new Date().toISOString()} [${this.platform}] ${msg}\n`);
    } catch { /* logging must never break the launcher */ }
  }

  /**
   * Build a plain-text problem report in <userData>/report-<timestamp>.txt and return { ok, path, mailto }.
   * extra.rendererError: the last error the renderer recorded (optional). A missing/unreadable launcher.log is fine —
   * the report says so instead of failing. The renderer only ever asks for this through the preload bridge; it never
   * touches the filesystem itself.
   */
  createReport(extra = {}) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const file = path.join(this.userData, `report-${stamp}.txt`);
    const st = this.settings.get();
    const u = this.update || {};
    const installed = u.installedVersion || null;
    const logFile = path.join(this.userData, "launcher.log");
    let log = "";
    try {
      const lines = fs.readFileSync(logFile, "utf8").split(/\r?\n/);
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); // ignore the trailing newline
      log = lines.slice(-200).join("\n");
    } catch { /* no log yet: the report notes it below */ }
    const rendererError = typeof extra.rendererError === "string" ? extra.rendererError.trim().slice(0, 4000) : "";
    const env = process.versions || {};
    const text = [
      "Sword and Seal Launcher problem report",
      "======================================",
      "",
      `Generated: ${now.toISOString()} (local ${now.toString()})`,
      `Launcher: ${this.launcherVersion}`,
      `Platform: ${this.platform} (${os.type()} ${os.release()} ${os.arch()})`,
      `Runtime: Electron ${env.electron || "n/a"} | Chromium ${env.chrome || "n/a"} | Node ${env.node || "n/a"}`,
      `User data folder: ${this.userData}`,
      `Install folder: ${st.installDir}`,
      `Game version: ${installed || "not installed"}`,
      `Update state: ${u.state || "unknown"}${u.latestVersion ? ` (installed ${installed || "none"}, latest ${u.latestVersion})` : ""}`,
      `Launcher phase: ${this.phase}`,
      `Last launcher error: ${this.error || "none"}`,
      `Renderer last error: ${rendererError || "none recorded"}`,
      `Report file: ${file}`,
      "",
      log ? `Recent launcher.log (last 200 lines):` : `Recent launcher.log:`,
      "--------------------------------------",
      log || "(launcher.log does not exist yet - nothing has been logged)",
      "",
    ].join("\n");
    try {
      fs.mkdirSync(this.userData, { recursive: true });
      fs.writeFileSync(file, text, "utf8");
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
    this.log(`wrote problem report ${file}`);
    const subject = `Sword and Seal problem report (launcher v${this.launcherVersion}${installed ? `, game v${installed}` : ""})`;
    const body = `Hello support,\n\nI hit a problem in the launcher.\n\nReport file: ${file}\nPlease attach that file to this email.\n\nWhat I was doing:\n\n`;
    return { ok: true, path: file, mailto: `mailto:support@swordandseal.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
  }

  // ---- update check ----
  async refresh() {
    if (this.phase === "updating" || this.phase === "playing") return this.update;
    this.phase = "checking"; this.error = null; this._emitState();
    try {
      this.update = await this.updater.check();
      this.offline = false;
      delete this.update.manifest; // keep the snapshot small; re-fetched at install time
    } catch (err) {
      const st = this.updater.readState();
      this.offline = true;
      if (st?.version && !st.updating) this.update = { state: "ready", installedVersion: st.version, latestVersion: st.version, offline: true };
      else if (st?.version) this.update = { state: "repair", installedVersion: st.version, offline: true };
      else this.update = { state: "not-installed", offline: true };
      this.error = `Cannot reach the update server. ${st?.version && !st.updating ? "You can still play the installed version." : ""}`.trim();
    }
    this.phase = "idle"; this._emitState();
    return this.update;
  }

  // ---- install / update / verify ----
  async startUpdate({ verify = false } = {}) {
    if (this.phase === "updating" || this.phase === "playing") return { ok: false, error: "Busy." };
    this.phase = "updating"; this.error = null; this._emitState();
    try {
      const manifest = await this.updater.fetchManifest();
      const r = verify ? await this.updater.verify(manifest) : await this.updater.install(manifest);
      this.phase = "idle";
      await this.refresh();
      return { ok: true, ...r };
    } catch (err) {
      this.phase = "idle";
      if (!err.cancelled) this.log(`update failed: ${err.code || ""} ${err.stack || err.message}`);
      this.error = err.cancelled ? null : (err.message || "Update failed.");
      await this.refresh();
      if (!err.cancelled) this.error = err.message || "Update failed.";
      this._emitState();
      return { ok: false, cancelled: !!err.cancelled, error: err.cancelled ? "Cancelled." : this.error };
    }
  }
  cancelUpdate() { this.updater.cancel(); return { ok: true }; }

  // ---- play ----
  async play() {
    if (this.phase !== "idle") return { ok: false, error: "Busy." };
    if (!this.session || !this._pw) return { ok: false, error: "Sign in first." };
    const st = this.updater.readState();
    if (!st?.version || st.updating) return { ok: false, error: "The game needs to be installed or repaired first." };
    if (this.update.state === "launcher-outdated") return { ok: false, error: "Launcher update required." };
    this.phase = "playing"; this.error = null; this._emitState();
    const fail = (error) => { this.phase = "idle"; this.error = error; this._emitState(); return { ok: false, error }; };
    // fresh one-use token (the sign-in token lives only 5 minutes)
    const a = await authenticate(this.config.apiBaseUrl, "login", this.session.name, this._pw);
    if (!a.ok) {
      if (/reach/i.test(a.error)) return fail(a.error);
      this.session = null; this._pw = null; return fail(`${a.error} Please sign in again.`);
    }
    try {
      const { kind } = launchGame({
        state: st, installDir: this.settings.get().installDir, platform: this.platform, tmpDir: this.tmpDir,
        session: { name: a.name, token: a.token, serverUrl: this.serverUrl() },
        onExit: (code, _sig, err) => {
          this.game = null; this.phase = "idle";
          if (err) this.error = `The game could not start: ${err.message}`;
          else if (code) this.error = `The game closed unexpectedly (code ${code}).`;
          this.emit("game", { running: false, code });
          this._emitState();
        },
      });
      this.game = { running: true, kind };
      this.emit("game", { running: true, kind });
      this._emitState();
      return { ok: true, kind, closeLauncher: this.settings.get().closeOnPlay };
    } catch (err) { this.log(`launch failed: ${err.stack || err.message}`); return fail(err.message); }
  }
}
