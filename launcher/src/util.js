// Small shared helpers: semver compare, safe paths, formatting.
import fs from "node:fs";
import path from "node:path";

export function parseVer(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
/** -1, 0, 1 */
export function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** True when a manifest path is a safe, relative, forward-slash path inside the install dir. */
export function isSafeRelPath(p) {
  if (typeof p !== "string" || !p || p.length > 400) return false;
  if (p.includes("\0") || p.includes("\\")) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  const segs = p.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === "..") return false;
    if (/[<>:"|?*\u0000-\u001f]/.test(s)) return false;
    if (/[. ]$/.test(s)) return false; // windows trailing dot/space tricks
  }
  if (segs[0].toLowerCase() === ".install.json" || segs[0].toLowerCase().startsWith(".install")) return false;
  if (/\.(part|new)$/i.test(p)) return false;
  return true;
}

/** Resolve rel inside root, throwing if it escapes or is unsafe. */
export function safeJoin(root, rel) {
  if (!isSafeRelPath(rel)) throw new Error(`Unsafe path in manifest: ${JSON.stringify(rel)}`);
  const abs = path.resolve(root, ...rel.split("/"));
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) throw new Error(`Path escapes install folder: ${rel}`);
  return abs;
}

/** Create parent directories of abs under root, refusing to traverse symlinks. */
export function ensureDirSafe(root, abs) {
  const r = path.resolve(root);
  fs.mkdirSync(r, { recursive: true });
  const rel = path.relative(r, abs);
  const parts = rel.split(path.sep);
  parts.pop(); // file name
  let cur = r;
  for (const part of parts) {
    cur = path.join(cur, part);
    let st = null;
    try { st = fs.lstatSync(cur); } catch { /* missing */ }
    if (st && st.isSymbolicLink()) throw new Error(`Refusing to write through a symlink: ${path.relative(r, cur)}`);
    if (st && !st.isDirectory()) throw new Error(`Not a folder: ${path.relative(r, cur)}`);
    if (!st) fs.mkdirSync(cur);
  }
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "?";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
export function fmtEta(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "--";
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60), s = Math.ceil(sec % 60);
  return m < 60 ? `${m}m ${s}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
export const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(new CancelError()); }, { once: true });
});
export class CancelError extends Error { constructor() { super("Cancelled"); this.name = "CancelError"; this.cancelled = true; } }
