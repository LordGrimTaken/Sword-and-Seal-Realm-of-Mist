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
      installDir: path.join(this.userData, "Game"), serverUrl: "", closeOnPlay: false, remember: true, lastName: "",
    });
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
    } catch (err) { return fail(err.message); }
  }
}
