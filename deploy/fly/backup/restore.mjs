#!/usr/bin/env node
// Download a backup, verify it, and write it as a SQLite file.
//   node restore.mjs --out /tmp/restored.db [--key backups/daily/2026-10-28.db.gz] [--force]
// Without --key the newest daily is used. The download is checked against the stored sha256, then PRAGMA integrity_check,
// then the expected tables are probed. It refuses to overwrite an existing --out unless --force. It never touches /data/game.db by itself:
// to really restore, stop the app (see docs/DEPLOY_FLY.md), restore to a temp file, verify, then move it into place.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { S3 } from "./s3.mjs";

export async function restore({ s3, out, key, force = false }) {
  if (fs.existsSync(out) && !force) throw new Error(`${out} exists (use --force)`);
  if (!key) {
    const all = (await s3.list("backups/daily/")).map((o) => o.key).filter((k) => k.endsWith(".db.gz")).sort();
    if (!all.length) throw new Error("no daily backups found");
    key = all[all.length - 1];
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
  try {
    const gz = path.join(tmp, "dl.gz");
    const headers = await s3.getToFile(key, gz, fs);
    const want = headers["x-amz-meta-sha256"];
    const got = crypto.createHash("sha256").update(fs.readFileSync(gz)).digest("hex");
    if (want && want !== got) throw new Error(`sha256 mismatch for ${key}: stored ${want}, downloaded ${got}`);
    const raw = path.join(tmp, "db");
    await pipeline(fs.createReadStream(gz), zlib.createGunzip(), fs.createWriteStream(raw));
    const db = new DatabaseSync(raw, { readOnly: true });
    let tables;
    try {
      const r = db.prepare("PRAGMA integrity_check").get();
      if (r.integrity_check !== "ok") throw new Error("integrity_check: " + r.integrity_check);
      tables = Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => [t.name, db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n]));
    } finally { db.close(); }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.copyFileSync(raw, out);
    return { key, out, sha256: got, tables };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const out = arg("--out");
  if (!out) { console.error("usage: restore.mjs --out FILE [--key KEY] [--force]"); process.exit(2); }
  try {
    const r = await restore({ s3: S3.fromEnv(), out, key: arg("--key"), force: a.includes("--force") });
    console.log(`restored ${r.key} -> ${r.out}\nsha256 ${r.sha256}\nintegrity_check: ok\nrow counts: ${JSON.stringify(r.tables)}`);
  } catch (e) { console.error("RESTORE FAILED:", e.message); process.exit(1); }
}
