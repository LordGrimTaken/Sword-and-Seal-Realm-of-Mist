// Starting the installed game with a one-time launch session file (docs/LAUNCHER.md section 4).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { safeJoin } from "./util.js";

export function writeSession({ name, token, serverUrl }, dir = os.tmpdir()) {
  const file = path.join(dir, `sword-and-seal-session-${crypto.randomBytes(8).toString("hex")}.json`);
  fs.writeFileSync(file, JSON.stringify({ name, token, serverUrl, createdAt: new Date().toISOString() }), { mode: 0o600 });
  return file;
}

function findOnPath(exe, env = process.env) {
  const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD").split(";") : [""];
  for (const d of (env.PATH || "").split(path.delimiter)) {
    for (const x of exts) { const p = path.join(d, exe + x); try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ } }
  }
  return null;
}

/** Decide what to spawn. Returns { command, args, cwd, env, kind } or throws a user-facing Error. */
export function resolveLaunch(state, installDir, platform, sessionFile) {
  const arg = `--launcher-session=${sessionFile}`;
  const rel = state?.launch?.[platform];
  if (rel) {
    const exe = safeJoin(installDir, rel);
    if (fs.existsSync(exe)) {
      try { if (process.platform !== "win32") fs.chmodSync(exe, 0o755); } catch { /* ignore */ }
      return { command: exe, args: [arg], cwd: path.dirname(exe), env: {}, kind: "packaged" };
    }
  }
  const fb = state?.launchFallback;
  if (fb && fb.command) {
    const cwd = safeJoin(installDir, fb.cwd || "game");
    let command = fb.command, env = {};
    if (fb.command === "node") {
      command = findOnPath("node");
      if (!command) { command = process.execPath; if (process.versions.electron) env = { ELECTRON_RUN_AS_NODE: "1" }; }
    }
    const args = [...(fb.args || []), arg];
    return { command, args, cwd, env, kind: "fallback" };
  }
  throw new Error("The game executable was not found in the install. Use Verify files to repair.");
}

/** Spawn the game; returns { child, sessionFile, kind }. onExit(code, signal) fires once. */
export function launchGame({ state, installDir, platform, session, onExit, tmpDir }) {
  const sessionFile = writeSession(session, tmpDir);
  let spec;
  try { spec = resolveLaunch(state, installDir, platform, sessionFile); }
  catch (e) { fs.rmSync(sessionFile, { force: true }); throw e; }
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd, stdio: "ignore", detached: false, windowsHide: false,
    env: { ...process.env, ...spec.env, SWORD_AND_SEAL_LAUNCHER: "1" },
  });
  let done = false;
  const cleanup = () => fs.rmSync(sessionFile, { force: true });
  const timer = setTimeout(cleanup, 60000); timer.unref?.();
  const fin = (code, signal, err) => { if (done) return; done = true; clearTimeout(timer); cleanup(); onExit?.(code, signal, err); };
  child.on("exit", (c, s) => fin(c, s));
  child.on("error", (e) => fin(null, null, e));
  return { child, sessionFile, kind: spec.kind };
}
