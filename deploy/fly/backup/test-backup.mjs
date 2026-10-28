#!/usr/bin/env node
// Local test of signing + backup + retention + restore against a fake S3 server (in-memory, verifies SigV4) and a real WAL sqlite db.
//   node deploy/fly/backup/test-backup.mjs
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { S3, signRequest } from "./s3.mjs";
import { runBackup, snapshot, isoWeek } from "./backup.mjs";
import { restore } from "./restore.mjs";

let pass = 0; const ok = (n) => { pass++; console.log("PASS", n); };

// 1. SigV4 against the worked example in the AWS S3 docs (GET with Range)
{
  const r = signRequest({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { range: "bytes=0-9" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", amzDate: "20130524T000000Z" });
  assert.equal(r.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  ok("sigv4 matches the AWS documentation example signature");
}

// 2. fake S3 that verifies signatures with its own copy of the secret
const KEY = "AKIATESTKEY", SECRET = "testsecret/abc+123";
const store = new Map(); let badSig = 0, reqs = 0;
const server = http.createServer((req, res) => {
  reqs++;
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const u = new URL(req.url, "http://x");
    const auth = req.headers.authorization || "";
    const signedHeaders = (auth.match(/SignedHeaders=([^,]+)/) || [])[1]?.split(";") || [];
    const hdrs = {}; for (const h of signedHeaders) if (h !== "host" && h !== "x-amz-content-sha256" && h !== "x-amz-date") hdrs[h] = req.headers[h];
    const q = {}; for (const [k, v] of u.searchParams) q[k] = v;
    const expectHash = req.headers["x-amz-content-sha256"];
    const actualHash = crypto.createHash("sha256").update(body).digest("hex");
    const exp = signRequest({ method: req.method, host: req.headers.host, path: decodeURIComponent(u.pathname), query: q, headers: hdrs, payloadHash: expectHash, accessKeyId: KEY, secretAccessKey: SECRET, region: "auto", amzDate: req.headers["x-amz-date"] });
    if (exp.headers.authorization !== auth || expectHash !== actualHash) { badSig++; res.writeHead(403); return res.end("<Error><Code>SignatureDoesNotMatch</Code></Error>"); }
    const p = decodeURIComponent(u.pathname).replace(/^\/sword-and-seal-backups\/?/, "");
    if (req.method === "PUT") { const meta = {}; for (const [k, v] of Object.entries(req.headers)) if (k.startsWith("x-amz-meta-")) meta[k] = v; store.set(p, { body, meta, at: new Date().toISOString() }); res.writeHead(200); return res.end(); }
    if (req.method === "DELETE") { store.delete(p); res.writeHead(204); return res.end(); }
    if (req.method === "HEAD") { res.writeHead(store.has(p) ? 200 : 404); return res.end(); }
    if (req.method === "GET" && p === "") {
      const prefix = q.prefix || ""; const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = q["continuation-token"] ? keys.indexOf(q["continuation-token"]) : 0; const page = keys.slice(start, start + 3); // tiny pages to exercise pagination
      const more = start + 3 < keys.length;
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${keys[start + 3]}</NextContinuationToken>` : ""}${page.map((k) => `<Contents><Key>${k}</Key><Size>${store.get(k).body.length}</Size><LastModified>${store.get(k).at}</LastModified></Contents>`).join("")}</ListBucketResult>`);
    }
    if (req.method === "GET") { const o = store.get(p); if (!o) { res.writeHead(404); return res.end("<Error><Code>NoSuchKey</Code></Error>"); } res.writeHead(200, Object.fromEntries(Object.entries(o.meta))); return res.end(o.body); }
    res.writeHead(400); res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const s3 = new S3({ endpoint, bucket: "sword-and-seal-backups", accessKeyId: KEY, secretAccessKey: SECRET });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bk-test-"));

try {
  // 3. real WAL db with data, kept open + written during the snapshot (like the live server)
  const dbPath = path.join(tmp, "game.db");
  const live = new DatabaseSync(dbPath);
  live.exec("PRAGMA journal_mode=WAL; CREATE TABLE characters(name TEXT PRIMARY KEY, level INT); CREATE TABLE items(name TEXT, item TEXT, qty INT);");
  const ins = live.prepare("INSERT INTO characters VALUES(?,?)");
  for (let i = 0; i < 500; i++) ins.run("hero" + i, i % 20);
  live.exec("INSERT INTO items VALUES('hero1','Fox Tail',3)");
  assert.ok(fs.existsSync(dbPath + "-wal"), "db is in WAL mode with an uncheckpointed wal");
  ok("test db created in WAL mode with live connection open");

  const snapFile = path.join(tmp, "s.db"); snapshot(dbPath, snapFile);
  assert.equal(new DatabaseSync(snapFile, { readOnly: true }).prepare("SELECT COUNT(*) n FROM characters").get().n, 500);
  ok("VACUUM INTO snapshot contains WAL-resident rows (consistent copy while server holds the db open)");

  // 4. 20 days of daily backups, Sundays create weeklies -> retention 14 daily + 8 weekly
  const day0 = Date.UTC(2026, 8, 1, 4, 0, 0); // 2026-09-01 04:00 UTC
  for (let i = 0; i < 80; i++) {
    live.exec(`UPDATE characters SET level = level + 1 WHERE name = 'hero${i % 500}'`);
    const r = await runBackup({ s3, dbPath, now: new Date(day0 + i * 86400000), tmpDir: tmp });
    assert.ok(r.uploaded.length >= 1);
  }
  const daily = [...store.keys()].filter((k) => k.startsWith("backups/daily/")).sort();
  const weekly = [...store.keys()].filter((k) => k.startsWith("backups/weekly/")).sort();
  assert.equal(daily.length, 14); assert.equal(weekly.length, 8);
  assert.equal(daily.at(-1), "backups/daily/2026-11-19.db.gz"); // day0 + 79 days
  assert.equal(daily[0], "backups/daily/2026-11-06.db.gz");
  ok(`retention: 80 daily runs leave exactly 14 daily (${daily[0].slice(-13, -6)}..) and 8 weekly (${weekly[0].slice(-12, -6)}..${weekly.at(-1).slice(-12, -6)})`);
  assert.equal(isoWeek(new Date(Date.UTC(2026, 0, 1))), "2026-W01"); assert.equal(isoWeek(new Date(Date.UTC(2026, 11, 31))), "2026-W53");
  ok("iso week naming");

  // 5. --due logic
  const fresh = new S3({ endpoint, bucket: "sword-and-seal-backups", accessKeyId: KEY, secretAccessKey: SECRET });
  const d1 = await runBackup({ s3: fresh, dbPath, due: true, now: new Date(Date.UTC(2026, 11, 1, 5, 0)), tmpDir: tmp });
  assert.ok(d1.uploaded);
  const d2 = await runBackup({ s3: fresh, dbPath, due: true, now: new Date(Date.UTC(2026, 11, 1, 9, 0)), tmpDir: tmp });
  assert.ok(d2.skipped);
  const d3 = await runBackup({ s3: fresh, dbPath, due: true, now: new Date(Date.UTC(2026, 11, 2, 1, 0)), tmpDir: tmp });
  assert.ok(d3.skipped, "before 03:30 UTC skipped");
  ok("--due: runs once per UTC day, not before 03:30 UTC when backups exist");

  // 6. restore latest + verify content; corrupted object detected
  const out = path.join(tmp, "restored.db");
  const r = await restore({ s3, out });
  assert.equal(r.key, "backups/daily/2026-12-01.db.gz");
  const rdb = new DatabaseSync(out, { readOnly: true });
  assert.equal(rdb.prepare("SELECT COUNT(*) n FROM characters").get().n, 500);
  assert.equal(rdb.prepare("SELECT qty FROM items").get().qty, 3);
  assert.deepEqual(r.tables, { characters: 500, items: 1 });
  rdb.close();
  ok("restore downloads newest daily, sha256 + PRAGMA integrity_check ok, data identical");
  await assert.rejects(restore({ s3, out }), /exists/); ok("restore refuses to overwrite without --force");
  const o = store.get("backups/daily/2026-12-01.db.gz"); o.body = Buffer.concat([o.body.subarray(0, 100), Buffer.from("CORRUPT"), o.body.subarray(107)]);
  await assert.rejects(restore({ s3, out: path.join(tmp, "bad.db") }), /sha256 mismatch/); ok("corrupted backup rejected (sha256 mismatch)");
  const wrong = new S3({ endpoint, bucket: "sword-and-seal-backups", accessKeyId: KEY, secretAccessKey: "wrong" });
  await assert.rejects(wrong.list("backups/"), /403/); ok("bad credentials rejected by signature check");
  assert.equal(badSig, 1, "only the deliberate wrong-secret request failed signature checking");
  ok(`all ${reqs} signed requests accepted by the verifying fake server`);
  live.close();
} finally { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} checks passed`);
