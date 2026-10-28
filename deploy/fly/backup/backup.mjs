#!/usr/bin/env node
// SQLite-safe backup of the game DB to a private S3-compatible bucket (Cloudflare R2).
//   node backup.mjs run  [--due]      one backup now (--due: only if today's daily is missing and it is past 03:30 UTC, or no backup exists)
//   node backup.mjs prune             apply retention only
//   node backup.mjs list
// Env: DB_PATH (default /data/game.db), R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, BACKUP_BUCKET (sword-and-seal-backups),
//      S3_ENDPOINT (tests/other S3), KEEP_DAILY (14), KEEP_WEEKLY (8). Never prints secrets.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { S3 } from "./s3.mjs";

const log = (...a) => console.log(new Date().toISOString(), "[backup]", ...a);
export const dailyKey = (d) => `backups/daily/${d.toISOString().slice(0, 10)}.db.gz`;
export function isoWeek(d) { // ISO-8601 week, e.g. 2026-W44
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y = t.getUTCFullYear(); const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
export const weeklyKey = (d) => `backups/weekly/${isoWeek(d)}.db.gz`;

/** Consistent snapshot of a live (WAL) database: VACUUM INTO writes a fresh, defragmented, single-file copy inside a read transaction. */
export function snapshot(dbPath, outFile) {
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { db.exec("PRAGMA busy_timeout = 5000"); db.exec(`VACUUM INTO '${outFile.replace(/'/g, "''")}'`); } finally { db.close(); }
  const chk = new DatabaseSync(outFile, { readOnly: true });
  try { const r = chk.prepare("PRAGMA integrity_check").get(); if (r.integrity_check !== "ok") throw new Error("snapshot failed integrity_check: " + r.integrity_check); } finally { chk.close(); }
}

/** Retention: keep newest `keepDaily` daily and `keepWeekly` weekly objects (names sort chronologically). Returns deleted keys. */
export async function prune(s3, keepDaily = 14, keepWeekly = 8) {
  const del = [];
  for (const [prefix, keep] of [["backups/daily/", keepDaily], ["backups/weekly/", keepWeekly]]) {
    const keys = (await s3.list(prefix)).map((o) => o.key).filter((k) => k.endsWith(".db.gz")).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - keep))) { await s3.delete(k); del.push(k); }
  }
  return del;
}

export async function runBackup({ s3, dbPath, now = new Date(), due = false, keepDaily = 14, keepWeekly = 8, tmpDir = os.tmpdir() }) {
  const key = dailyKey(now);
  if (due) {
    const existing = await s3.list("backups/daily/");
    if (existing.some((o) => o.key === key)) return { skipped: "today's backup exists" };
    const past = now.getUTCHours() * 60 + now.getUTCMinutes() >= 3 * 60 + 30;
    if (existing.length > 0 && !past) return { skipped: "before 03:30 UTC" };
  }
  const tmp = fs.mkdtempSync(path.join(tmpDir, "bk-"));
  try {
    const snap = path.join(tmp, "snap.db"), gz = path.join(tmp, "snap.db.gz");
    snapshot(dbPath, snap);
    await pipeline(fs.createReadStream(snap), zlib.createGzip({ level: 6 }), fs.createWriteStream(gz));
    const meta = { "source-bytes": fs.statSync(snap).size, "created": now.toISOString() };
    const up = await s3.putFile(key, gz, fs, meta);
    const keys = [key];
    if (now.getUTCDay() === 0) { await s3.putFile(weeklyKey(now), gz, fs, meta); keys.push(weeklyKey(now)); } // Sundays also become the weekly
    const deleted = await prune(s3, keepDaily, keepWeekly);
    return { uploaded: keys, bytes: up.size, sha256: up.sha256, pruned: deleted };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = "run", ...flags] = process.argv.slice(2);
  const dbPath = process.env.DB_PATH || "/data/game.db";
  try {
    const s3 = S3.fromEnv();
    const kd = Number(process.env.KEEP_DAILY) || 14, kw = Number(process.env.KEEP_WEEKLY) || 8;
    if (cmd === "run") log(JSON.stringify(await runBackup({ s3, dbPath, due: flags.includes("--due"), keepDaily: kd, keepWeekly: kw })));
    else if (cmd === "prune") log("deleted", JSON.stringify(await prune(s3, kd, kw)));
    else if (cmd === "list") for (const o of await s3.list("backups/")) console.log(o.lastModified, String(o.size).padStart(10), o.key);
    else { console.error("usage: backup.mjs run [--due] | prune | list"); process.exit(2); }
  } catch (e) { console.error(new Date().toISOString(), "[backup] FAILED:", e.message); process.exit(1); }
}
