// In-memory stand-in for the dl.swordandseal.com Worker (infra/dl-worker/worker.mjs): same admin API, Range-capable public GET.
// Usage: node test/fake-dl.mjs [port=8822] [token=test-token]      (token also from FAKE_DL_TOKEN)
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function startFakeDl({ port = 8822, token = "test-token", host = "127.0.0.1", failPut = null } = {}) {
  const store = new Map();   // key -> {body: Buffer, type, uploaded}
  const stats = { puts: [], deletes: [], unauthorized: 0 };
  const safeKey = (k) => k && !k.includes("..") && !k.startsWith("/") && !k.includes("\\") && k.length < 512;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/_admin")) {
      const ok = req.headers.authorization === `Bearer ${token}`;
      if (!ok) { stats.unauthorized++; res.writeHead(401); return res.end("Unauthorized"); }
      const key = decodeURIComponent(url.pathname.slice("/_admin/".length));
      if (req.method === "GET" && url.pathname === "/_admin") {
        const prefix = url.searchParams.get("prefix") || "";
        const out = [...store].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, 1000).map(([k, v]) => ({ key: k, size: v.body.length, uploaded: v.uploaded }));
        res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(out));
      }
      if (!safeKey(key)) { res.writeHead(400); return res.end("Bad key"); }
      if (req.method === "PUT") {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          if (failPut && failPut(key, stats)) { res.writeHead(503); return res.end("flaky"); }
          const body = Buffer.concat(chunks);
          store.set(key, { body, type: req.headers["content-type"] || "application/octet-stream", uploaded: new Date().toISOString() });
          stats.puts.push(key);
          res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, key }));
        });
        return;
      }
      if (req.method === "DELETE") { store.delete(key); stats.deletes.push(key); res.writeHead(200, { "content-type": "application/json" }); return res.end('{"ok":true}'); }
      res.writeHead(405); return res.end();
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    let key = decodeURIComponent(url.pathname.slice(1));
    if (!safeKey(key) || !store.has(key)) { res.writeHead(404); return res.end("Not found"); }
    const { body, type } = store.get(key);
    const h = { "content-type": type, "accept-ranges": "bytes", "content-length": String(body.length) };
    if (req.method === "HEAD") { res.writeHead(200, h); return res.end(); }
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] || m[2])) {
      let s, e;
      if (m[1] === "") { s = Math.max(0, body.length - Number(m[2])); e = body.length - 1; } else { s = Number(m[1]); e = m[2] === "" ? body.length - 1 : Math.min(Number(m[2]), body.length - 1); }
      if (s > e || s >= body.length) { res.writeHead(416, { "content-range": `bytes */${body.length}` }); return res.end(); }
      res.writeHead(206, { ...h, "content-length": String(e - s + 1), "content-range": `bytes ${s}-${e}/${body.length}` });
      return res.end(body.subarray(s, e + 1));
    }
    res.writeHead(200, h); res.end(body);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, store, stats, url: `http://${host}:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8822), token = process.argv[3] || process.env.FAKE_DL_TOKEN || "test-token";
  const s = await startFakeDl({ port, token });
  console.log(`fake dl host on ${s.url} (admin token: ${token === "test-token" ? "test-token" : "(custom)"})`);
}
