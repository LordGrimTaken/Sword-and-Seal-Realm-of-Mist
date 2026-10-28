// Tiny static host for a release folder (HTTP Range supported), optionally with a mock account API.
// Usage: node launcher/scripts/dev-host.mjs <releaseDir> [port=8815] [--mock-api]
//   --mock-api  also serves POST /api/auth/register|login and GET /health per docs/LAUNCHER.md (in-memory accounts)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export function startDevHost({ dir, port = 8815, mockApi = false, host = "127.0.0.1", log = () => {} }) {
  const root = path.resolve(dir);
  const accounts = new Map();
  const secret = crypto.randomBytes(16);
  const MIME = { ".json": "application/json", ".html": "text/html", ".js": "text/javascript", ".gz": "application/octet-stream" };
  const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (mockApi) {
      if (url.pathname === "/health") return json(res, 200, { ok: true, players: accounts.size, version: "mock" });
      if (req.method === "POST" && url.pathname.startsWith("/api/auth/")) {
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
        req.on("end", () => {
          let j; try { j = JSON.parse(body); } catch { return json(res, 400, { ok: false, error: "Bad request." }); }
          const name = String(j.name ?? "").trim(), pw = String(j.pw ?? "");
          if (!/^[A-Za-z0-9_ -]{3,16}$/.test(name)) return json(res, 200, { ok: false, error: "Name must be 3 to 16 letters or digits." });
          if (pw.length < 4 || pw.length > 64) return json(res, 200, { ok: false, error: "Password must be 4 to 64 characters." });
          const kind = url.pathname.split("/").pop();
          if (kind === "register") {
            if (accounts.has(name.toLowerCase())) return json(res, 200, { ok: false, error: "That name is already taken." });
            accounts.set(name.toLowerCase(), pw);
          } else if (kind === "login") {
            if (accounts.get(name.toLowerCase()) !== pw) return json(res, 200, { ok: false, error: "Wrong name or password." });
          } else return json(res, 404, { ok: false, error: "Not found." });
          const exp = Date.now() + 300000, nonce = crypto.randomBytes(6).toString("hex");
          const payload = `${name}|${exp}|${nonce}`;
          const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex").slice(0, 24);
          json(res, 200, { ok: true, token: Buffer.from(payload).toString("base64url") + "." + sig, name, expiresIn: 300 });
        });
        return;
      }
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    let rel; try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
    const file = path.join(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end("not found"); return; }
      const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
      if (m) {
        const start = Number(m[1]), end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
        if (start >= st.size) { res.writeHead(416, { "content-range": `bytes */${st.size}` }).end(); return; }
        res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
        log(`206 ${url.pathname} ${start}-${end}`);
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": st.size });
        log(`200 ${url.pathname}`);
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(file).pipe(res);
      }
    });
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => resolve(server)); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dir = args[0], port = Number(args[1]) || 8815;
  if (!dir) { console.error("Usage: node launcher/scripts/dev-host.mjs <releaseDir> [port] [--mock-api]"); process.exit(1); }
  const mockApi = process.argv.includes("--mock-api");
  startDevHost({ dir, port, mockApi, log: process.env.VERBOSE ? console.log : () => {} }).then(() => {
    console.log(`Serving ${path.resolve(dir)} on http://127.0.0.1:${port}/${mockApi ? "  (mock account API enabled)" : ""}`);
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
