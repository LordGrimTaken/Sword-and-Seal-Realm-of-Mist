import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";

export const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
export const tmp = (p = "ss-test-") => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Write release/<version>/ + release/latest/ under root. files: { "game/a.txt": Buffer|string }. */
export function makeRelease(root, version, files, { gzip = [], extra = {}, news } = {}) {
  const vdir = path.join(root, version), ldir = path.join(root, "latest");
  fs.rmSync(vdir, { recursive: true, force: true }); fs.rmSync(ldir, { recursive: true, force: true });
  const entries = [];
  for (const [p, content] of Object.entries(files)) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const dest = path.join(vdir, "files", ...p.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const e = { path: p, size: buf.length, sha256: sha(buf) };
    if (gzip.includes(p)) { fs.writeFileSync(dest + ".gz", zlib.gzipSync(buf)); e.gz = true; } else fs.writeFileSync(dest, buf);
    entries.push(e);
  }
  const manifest = { version, channel: "stable", releasedAt: new Date().toISOString(), minLauncherVersion: "1.0.0", launch: {}, launchFallback: { command: "node", args: ["scripts/play.mjs"], cwd: "game" }, files: entries, ...extra };
  fs.mkdirSync(ldir, { recursive: true });
  fs.writeFileSync(path.join(vdir, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(ldir, "manifest.json"), JSON.stringify({ ...manifest, filesBase: `../${version}/files/` }));
  fs.writeFileSync(path.join(ldir, "news.json"), JSON.stringify(news ?? [{ id: version, title: `Release ${version}`, date: "2026-10-28", body: "Hello" }]));
  return manifest;
}

/** Static server with fault injection. faults: { truncateOnce:Set<urlPath>, corruptOnce:Set, corruptAlways:Set, noRange:boolean } */
export function serve(root, faults = {}) {
  const log = [];
  const f = { truncateOnce: new Set(), corruptOnce: new Set(), corruptAlways: new Set(), noRange: false, ...faults };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(root, u);
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { log.push({ u, status: 404 }); res.writeHead(404).end(); return; }
    let buf = fs.readFileSync(file);
    const corrupt = f.corruptAlways.has(u) || f.corruptOnce.delete(u);
    if (corrupt) { buf = Buffer.from(buf); buf[0] ^= 0xff; }
    const m = !f.noRange && /^bytes=(\d+)-/.exec(req.headers.range || "");
    const start = m ? Number(m[1]) : 0;
    log.push({ u, range: req.headers.range || null, status: m ? 206 : 200 });
    if (start >= buf.length && m) { res.writeHead(416).end(); return; }
    let body = buf.subarray(start);
    const headers = { "content-length": body.length, "accept-ranges": "bytes" };
    if (m) headers["content-range"] = `bytes ${start}-${buf.length - 1}/${buf.length}`;
    res.writeHead(m ? 206 : 200, headers);
    if (f.truncateOnce.delete(u)) { res.write(body.subarray(0, Math.floor(body.length / 2))); setTimeout(() => res.destroy(), 20); return; }
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, log, faults: f, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  })));
}
