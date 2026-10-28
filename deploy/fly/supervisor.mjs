// PID 1 inside the container (runs as root only to chown the volume, see below). Starts the game server as a child, forwards SIGTERM/SIGINT to it (the server saves all
// players and closes sockets), and runs the nightly backup check when R2 credentials are configured.
// If the server exits, so does the supervisor with the same code, and Fly restarts the machine.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const log = (...a) => console.log(new Date().toISOString(), "[supervisor]", ...a);
// Fly mounts volumes root-owned. If we start as root: fix ownership of the data dir, then run EVERYTHING we spawn (server, backups) as the unprivileged
// `node` user (uid/gid 1000). Started as non-root (local runs), nothing changes.
const dropTo = process.getuid?.() === 0 ? { uid: 1000, gid: 1000 } : {};
if (dropTo.uid !== undefined) {
  const dataDir = path.dirname(process.env.DB_PATH || "/data/game.db");
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const walk = (d) => { fs.chownSync(d, 1000, 1000); for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory() && e.name !== "lost+found") walk(f); else if (!e.isSymbolicLink()) fs.chownSync(f, 1000, 1000); } };
    walk(dataDir);
  } catch (e) { log("WARN could not chown", dataDir, e.message); }
}
// Restore hook: a verified backup placed at <data dir>/restore.db is swapped in at boot (the old DB is kept as game.db.pre-restore-<time>).
{
  const dbPath = process.env.DB_PATH || "/data/game.db", staged = path.join(path.dirname(dbPath), "restore.db");
  if (fs.existsSync(staged)) {
    const keep = `${dbPath}.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      if (fs.existsSync(dbPath)) fs.renameSync(dbPath, keep);
      for (const ext of ["-wal", "-shm"]) if (fs.existsSync(dbPath + ext)) fs.renameSync(dbPath + ext, keep + ext);
      fs.renameSync(staged, dbPath);
      if (dropTo.uid !== undefined) fs.chownSync(dbPath, 1000, 1000);
      log(`RESTORED ${staged} -> ${dbPath} (previous database kept as ${keep})`);
    } catch (e) { log("restore swap FAILED, starting with the existing database:", e.message); }
  }
}
const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", process.env.SERVER_BUNDLE || path.join(here, "server/dist/server.mjs")], { stdio: "inherit", ...dropTo });
let stopping = false;
const stop = (sig) => {
  if (stopping) return; stopping = true; log(`${sig}: forwarding to server, waiting for its save+close`);
  try { server.kill("SIGTERM"); } catch { /* gone */ }
  clearInterval(timer);
  setTimeout(() => { log("server did not exit in 12s, killing"); try { server.kill("SIGKILL"); } catch { /* gone */ } }, 12_000).unref();
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
server.on("exit", (code, sig) => { log(`server exited code=${code} signal=${sig}`); process.exit(code ?? (stopping ? 0 : 1)); });

// Backups: hourly check, `--due` makes it a no-op unless today's backup is missing and it is past 03:30 UTC.
const haveR2 = !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && (process.env.R2_ACCOUNT_ID || process.env.S3_ENDPOINT));
let running = false;
const runBackup = () => {
  if (running || stopping) return; running = true;
  const c = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(here, "backup/backup.mjs"), "run", "--due"], { stdio: "inherit", ...dropTo });
  c.on("exit", () => { running = false; });
};
let timer;
if (haveR2) { log("backups enabled (daily, bucket " + (process.env.BACKUP_BUCKET || "sword-and-seal-backups") + ")"); setTimeout(runBackup, 90_000).unref(); timer = setInterval(runBackup, 3_600_000); timer.unref(); }
else log("WARNING: R2_* secrets not set, backups are DISABLED");
