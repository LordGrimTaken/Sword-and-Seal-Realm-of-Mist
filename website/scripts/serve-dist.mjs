#!/usr/bin/env node
// Local server for the built Cloudflare Worker: adapts node:http to worker.mjs's fetch handler, so routing, headers and 404s match production.
// Usage: node website/scripts/serve-dist.mjs [port=8807] [--host=name]   (default port 8807)
// Optional mock API for tests: --mock serves /__mock/health, /__mock/latest.json, /__mock/news.json on the same origin.
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const worker = (await import(pathToFileURL(path.join(ROOT, "dist-worker", "worker.mjs")).href)).default;
const port = Number(process.argv.find((a) => /^\d+$/.test(a)) || 8807);
const hostArg = (process.argv.find((a) => a.startsWith("--host=")) || "").slice(7);

const server = http.createServer(async (req, res) => {
  try {
    const host = hostArg || req.headers.host || "localhost";
    const url = `http://${host}${req.url}`;
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers }));
    const headers = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    res.writeHead(r.status, headers);
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(e && e.stack || e));
  }
});
server.listen(port, "127.0.0.1", () => console.log(`serving dist-worker/worker.mjs on http://127.0.0.1:${port} (pid ${process.pid})`));
