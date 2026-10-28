// Patch/update engine. See docs/LAUNCHER.md for the manifest and install-state formats.
//  - diff by sha256, 3 parallel downloads, .part files with HTTP Range resume, 3 tries with backoff
//  - every file is verified, staged as <file>.new, then all staged files are renamed into place (commit)
//  - .install.json is written only on success; "updating": true marks an unfinished update (repaired next start)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { EventEmitter } from "node:events";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { openStream, fetchText } from "./source.js";
import { cmpVer, isSafeRelPath, safeJoin, ensureDirSafe, sleep, CancelError } from "./util.js";

export const STATE_FILE = ".install.json";
const SHA_RE = /^[0-9a-f]{64}$/;

export function validateManifest(m, manifestUrl) {
  const bad = (msg) => { throw new Error(`Invalid manifest: ${msg}`); };
  if (!m || typeof m !== "object") bad("not an object");
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+/.test(m.version)) bad("missing version");
  if (!Array.isArray(m.files)) bad("files must be an array");
  const seen = new Set();
  for (const f of m.files) {
    if (!f || typeof f !== "object") bad("file entry is not an object");
    if (!isSafeRelPath(f.path)) bad(`unsafe path ${JSON.stringify(f.path)}`);
    if (!Number.isInteger(f.size) || f.size < 0) bad(`bad size for ${f.path}`);
    if (typeof f.sha256 !== "string" || !SHA_RE.test(f.sha256)) bad(`bad sha256 for ${f.path}`);
    if (f.url != null && typeof f.url !== "string") bad(`bad url for ${f.path}`);
    const k = f.path.toLowerCase();
    if (seen.has(k)) bad(`duplicate path ${f.path}`);
    seen.add(k);
  }
  m._url = manifestUrl;
  return m;
}

export function entryUrl(m, e) {
  const base = m._url;
  let u;
  if (e.url) u = new URL(e.url, base).href;
  else {
    const fb = new URL(m.filesBase || "files/", base).href;
    u = fb + e.path.split("/").map(encodeURIComponent).join("/") + (e.gz ? ".gz" : "");
  }
  const proto = new URL(u).protocol;
  if (proto !== "http:" && proto !== "https:" && !(proto === "file:" && base.startsWith("file:"))) throw new Error(`Unsupported download URL scheme: ${proto}`);
  return u;
}

const isGz = (u) => new URL(u).pathname.toLowerCase().endsWith(".gz");

export async function hashFile(file, signal) {
  const h = crypto.createHash("sha256");
  const rs = fs.createReadStream(file);
  const onAbort = () => rs.destroy(new CancelError());
  signal?.addEventListener("abort", onAbort, { once: true });
  try { for await (const chunk of rs) h.update(chunk); } finally { signal?.removeEventListener("abort", onAbort); }
  return h.digest("hex");
}

const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

export class Updater extends EventEmitter {
  constructor(opts) {
    super();
    this.installDir = path.resolve(opts.installDir);
    this.releaseBaseUrl = opts.releaseBaseUrl.replace(/\/+$/, "");
    this.launcherVersion = opts.launcherVersion || "1.0.0";
    this.platform = opts.platform || process.platform;
    this.parallel = opts.parallel ?? 3;
    this.retries = opts.retries ?? 3;
    this.backoffMs = opts.backoffMs ?? 600;
    this.stallMs = opts.stallMs ?? 30000;
    this.freeSpaceMargin = opts.freeSpaceMargin ?? 32 * 1024 * 1024;
    this._ac = null;
    this.busy = false;
  }

  manifestUrl() { return `${this.releaseBaseUrl}/latest/manifest.json`; }
  statePath() { return path.join(this.installDir, STATE_FILE); }

  readState() {
    try {
      const s = JSON.parse(fs.readFileSync(this.statePath(), "utf8"));
      if (s && typeof s === "object" && s.files && typeof s.files === "object") return s;
    } catch { /* none or corrupt */ }
    return null;
  }
  writeState(s) {
    fs.mkdirSync(this.installDir, { recursive: true });
    const tmp = this.statePath() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, this.statePath());
  }

  async fetchManifest({ signal } = {}) {
    const url = this.manifestUrl();
    const txt = await fetchText(url, { signal });
    let m;
    try { m = JSON.parse(txt); } catch { throw new Error("Invalid manifest: not JSON"); }
    validateManifest(m, url);
    // optional per-file platform filter, e.g. packaged Electron builds per OS
    m.files = m.files.filter((f) => !Array.isArray(f.platforms) || f.platforms.includes(this.platform));
    return m;
  }

  /** Decide what the launcher should offer: install / update / repair / play. */
  async check({ signal } = {}) {
    const manifest = await this.fetchManifest({ signal });
    const state = this.readState();
    const out = { manifest, latestVersion: manifest.version, installedVersion: state?.version ?? null, releasedAt: manifest.releasedAt ?? null };
    if (manifest.minLauncherVersion && cmpVer(manifest.minLauncherVersion, this.launcherVersion) > 0) {
      return { ...out, state: "launcher-outdated", minLauncherVersion: manifest.minLauncherVersion };
    }
    const plan = await this.plan(manifest, { full: false, signal });
    out.needFiles = plan.need.length; out.needBytes = plan.needBytes; out.totalBytes = plan.totalBytes;
    if (!state || !state.version) out.state = "not-installed";
    else if (state.updating) out.state = "repair";
    else if (plan.need.length || plan.removed.length || state.version !== manifest.version) out.state = "update-available";
    else out.state = "ready";
    return out;
  }

  /** Work out which files must be downloaded. full=true re-hashes everything on disk. */
  async plan(manifest, { full = false, signal, onHashProgress } = {}) {
    const state = this.readState();
    const trust = !full && state && !state.updating;
    const need = []; let needBytes = 0, totalBytes = 0, i = 0;
    for (const e of manifest.files) {
      totalBytes += e.size;
      if (signal?.aborted) throw new CancelError();
      const dest = safeJoin(this.installDir, e.path);
      let ok = false;
      let st = null; try { st = fs.lstatSync(dest); } catch { /* missing */ }
      if (st && st.isFile() && st.size === e.size) {
        if (trust) ok = state.files[e.path]?.sha256 === e.sha256;
        else ok = (await hashFile(dest, signal)) === e.sha256;
      }
      i++; onHashProgress?.(i, manifest.files.length, e.path);
      if (ok) continue;
      let staged = false;
      const nw = dest + ".new";
      try { const ns = fs.lstatSync(nw); if (ns.isFile() && ns.size === e.size) staged = (await hashFile(nw, signal)) === e.sha256; } catch { /* none */ }
      need.push({ entry: e, staged });
      if (!staged) needBytes += e.size;
    }
    const keep = new Set(manifest.files.map((f) => f.path));
    const removed = state ? Object.keys(state.files).filter((p) => !keep.has(p) && isSafeRelPath(p)) : [];
    return { need, removed, needBytes, totalBytes };
  }

  cancel() { this._ac?.abort(); }

  /** Verify all files (re-hash) and re-download mismatches. */
  verify(manifest, opts = {}) { return this.install(manifest, { ...opts, full: true }); }

  async install(manifest, { full = false, signal } = {}) {
    if (this.busy) throw new Error("An update is already running.");
    this.busy = true;
    const ac = new AbortController();
    this._ac = ac;
    signal?.addEventListener("abort", () => ac.abort(), { once: true });
    const sig = ac.signal;
    const prev = this.readState();
    let committing = false;
    const t0 = Date.now();
    try {
      fs.mkdirSync(this.installDir, { recursive: true });
      this.emit("progress", { phase: full ? "verifying" : "checking", pct: 0, filesDone: 0, filesTotal: manifest.files.length, file: "" });
      const plan = await this.plan(manifest, {
        full, signal: sig,
        onHashProgress: (i, n, f) => { if (full) this._emit({ phase: "verifying", pct: i / n, filesDone: i, filesTotal: n, file: f }); },
      });
      const { need, removed, needBytes } = plan;
      if (!need.length && !removed.length && prev && !prev.updating && prev.version === manifest.version) {
        this.emit("progress", { phase: "done", pct: 1, filesDone: manifest.files.length, filesTotal: manifest.files.length, file: "" });
        return { changed: false, downloaded: 0, repaired: 0, version: manifest.version };
      }
      await this._checkDisk(needBytes);
      this.writeState({ ...(prev || { schema: 1, files: {} }), schema: 1, updating: true, targetVersion: manifest.version });

      // ---- download phase (live files untouched) ----
      const toGet = need.filter((n) => !n.staged);
      const ctx = { bytes: new Map(), sizes: new Map(), total: needBytes, start: Date.now(), samples: [], filesDone: need.length - toGet.length, filesTotal: need.length, current: "", lastEmit: 0 };
      for (const n of toGet) { ctx.bytes.set(n.entry.path, 0); ctx.sizes.set(n.entry.path, n.entry.size); }
      let idx = 0;
      const worker = async () => {
        while (idx < toGet.length) {
          const n = toGet[idx++];
          ctx.current = n.entry.path;
          await this._download(manifest, n.entry, ctx, sig);
          ctx.bytes.set(n.entry.path, n.entry.size);
          ctx.filesDone++;
          this._progress(ctx, true);
        }
      };
      const workers = Array.from({ length: Math.min(this.parallel, toGet.length) }, () => worker().catch((e) => { ac.abort(); throw e; }));
      const results = await Promise.allSettled(workers);
      const realErr = results.filter((r) => r.status === "rejected").map((r) => r.reason).find((e) => e && !e.cancelled);
      if (realErr) throw realErr;
      if (results.some((r) => r.status === "rejected")) throw new CancelError();
      if (sig.aborted) throw new CancelError();

      // ---- commit phase: rename staged files into place ----
      this.emit("progress", { phase: "finalizing", pct: 1, filesDone: ctx.filesTotal, filesTotal: ctx.filesTotal, file: "" });
      committing = true;
      for (const n of need) {
        const dest = safeJoin(this.installDir, n.entry.path);
        ensureDirSafe(this.installDir, dest);
        try { if (fs.lstatSync(dest).isSymbolicLink()) fs.unlinkSync(dest); } catch { /* absent */ }
        fs.renameSync(dest + ".new", dest);
        if (n.entry.mode && process.platform !== "win32") { try { fs.chmodSync(dest, parseInt(n.entry.mode, 8)); } catch { /* best effort */ } }
      }
      for (const rel of removed) {
        let abs; try { abs = safeJoin(this.installDir, rel); } catch { continue; }
        try { fs.unlinkSync(abs); } catch { /* already gone */ }
        this._prune(path.dirname(abs));
      }
      const files = {};
      for (const e of manifest.files) files[e.path] = { size: e.size, sha256: e.sha256 };
      this.writeState({
        schema: 1, version: manifest.version, updating: false, targetVersion: null,
        installedAt: new Date().toISOString(), releasedAt: manifest.releasedAt ?? null, channel: manifest.channel ?? "stable",
        launch: manifest.launch ?? null, launchFallback: manifest.launchFallback ?? null, files,
      });
      this.emit("progress", { phase: "done", pct: 1, filesDone: ctx.filesTotal, filesTotal: ctx.filesTotal, file: "" });
      return { changed: true, downloaded: toGet.length, repaired: full ? need.length : 0, removed: removed.length, bytes: needBytes, ms: Date.now() - t0, version: manifest.version };
    } catch (err) {
      if (!committing) {
        // nothing live was changed: restore the previous state (or none for a fresh install)
        try { if (prev) this.writeState(prev); else fs.rmSync(this.statePath(), { force: true }); } catch { /* best effort */ }
      }
      throw err;
    } finally { this.busy = false; this._ac = null; }
  }

  async _checkDisk(needBytes) {
    if (typeof fs.promises.statfs !== "function") return;
    try {
      const s = await fs.promises.statfs(this.installDir);
      const free = Number(s.bavail) * Number(s.bsize);
      const need = needBytes + this.freeSpaceMargin;
      if (free < need) {
        const mb = (n) => Math.ceil(n / 1048576);
        const e = new Error(`Not enough disk space: ${mb(need)} MB needed, ${mb(free)} MB free.`); e.code = "ENOSPC_PRECHECK"; throw e;
      }
    } catch (e) { if (e.code === "ENOSPC_PRECHECK") throw e; }
  }

  _prune(dir) {
    while (dir.startsWith(this.installDir + path.sep)) {
      try { fs.rmdirSync(dir); } catch { return; }
      dir = path.dirname(dir);
    }
  }

  _emit(p) { this.emit("progress", p); }

  _progress(ctx, force = false) {
    const now = Date.now();
    if (!force && now - ctx.lastEmit < 100) return;
    ctx.lastEmit = now;
    let done = 0; for (const [p, b] of ctx.bytes) done += Math.min(b, ctx.sizes.get(p));
    ctx.samples.push([now, done]);
    while (ctx.samples.length > 2 && now - ctx.samples[0][0] > 4000) ctx.samples.shift();
    const [t0, b0] = ctx.samples[0];
    const speed = now > t0 ? ((done - b0) / (now - t0)) * 1000 : 0;
    const remaining = ctx.total - done;
    this.emit("progress", {
      phase: "downloading", pct: ctx.total ? Math.min(1, done / ctx.total) : 1, bytesDone: done, bytesTotal: ctx.total,
      speed, etaSec: speed > 1 ? remaining / speed : null, file: ctx.current, filesDone: ctx.filesDone, filesTotal: ctx.filesTotal,
    });
  }

  async _download(manifest, e, ctx, sig) {
    const dest = safeJoin(this.installDir, e.path);
    ensureDirSafe(this.installDir, dest);
    try { if (fs.lstatSync(dest + ".part").isSymbolicLink()) fs.unlinkSync(dest + ".part"); } catch { /* none */ }
    const url = entryUrl(manifest, e);
    let lastErr;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try { await this._attempt(url, e, dest, ctx, sig); return; }
      catch (err) {
        if (err.cancelled || sig.aborted) throw new CancelError();
        lastErr = err;
        if (err.hashMismatch) { fs.rmSync(dest + ".part", { force: true }); ctx.bytes.set(e.path, 0); }
        this.emit("retry", { file: e.path, attempt, error: err.message });
        if (attempt < this.retries) await sleep(this.backoffMs * 2 ** (attempt - 1), sig);
      }
    }
    throw new Error(`Download failed for ${e.path} after ${this.retries} tries: ${lastErr.message}`);
  }

  async _attempt(url, e, dest, ctx, sig) {
    const part = dest + ".part";
    const gz = !!e.gz || isGz(url);
    let start = 0;
    try { const st = fs.lstatSync(part); if (st.isFile()) start = st.size; } catch { /* fresh */ }
    if (!gz && start > e.size) { fs.rmSync(part, { force: true }); start = 0; }
    ctx.bytes.set(e.path, gz ? 0 : start);

    if (gz || start < e.size) {
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      sig.addEventListener("abort", onAbort, { once: true });
      let idle;
      try {
        const src = await openStream(url, { start, signal: ac.signal });
        if (src.status === 416) {
          if (start === 0) throw new Error("Server refused the request (416)");
          // partial file already complete (gz) or bogus: fall through to verification
        } else {
          let mode = "a";
          if (src.status === 200 && start > 0) { mode = "w"; ctx.bytes.set(e.path, 0); } // server ignored Range
          const kick = () => { clearTimeout(idle); idle = setTimeout(() => src.stream.destroy(new Error("Download stalled")), this.stallMs); };
          kick();
          const counter = new Transform({
            transform: (chunk, _enc, cb) => {
              kick();
              if (!gz) ctx.bytes.set(e.path, (ctx.bytes.get(e.path) || 0) + chunk.length);
              else ctx.bytes.set(e.path, Math.min(e.size, (ctx.bytes.get(e.path) || 0) + chunk.length * (e.size / Math.max(1, e.gzSize || e.size))));
              this._progress(ctx);
              cb(null, chunk);
            },
          });
          await pipeline(src.stream, counter, fs.createWriteStream(part, { flags: mode }), { signal: ac.signal });
        }
      } catch (err) {
        if (sig.aborted) throw new CancelError();
        throw err;
      } finally { clearTimeout(idle); sig.removeEventListener("abort", onAbort); }
    }

    // verify and stage
    const staged = dest + ".new";
    let hash;
    if (gz) {
      const tmp = dest + ".gunzip.part";
      const h = crypto.createHash("sha256");
      const hasher = new Transform({ transform(c, _e, cb) { h.update(c); cb(null, c); } });
      try {
        await pipeline(fs.createReadStream(part), zlib.createGunzip(), hasher, fs.createWriteStream(tmp), { signal: sig });
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        if (sig.aborted) throw new CancelError();
        const x = new Error(`Corrupt compressed download (${err.message})`); x.hashMismatch = true; throw x;
      }
      hash = h.digest("hex");
      if (hash === e.sha256 && fs.statSync(tmp).size === e.size) { fs.renameSync(tmp, staged); fs.rmSync(part, { force: true }); return; }
      fs.rmSync(tmp, { force: true });
    } else {
      hash = await hashFile(part, sig);
      if (hash === e.sha256 && fs.statSync(part).size === e.size) { fs.renameSync(part, staged); return; }
    }
    const x = new Error(`Checksum mismatch for ${e.path}`); x.hashMismatch = true; throw x;
  }
}

export { exists };
