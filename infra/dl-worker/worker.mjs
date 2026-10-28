// dl.swordandseal.com: public, read-only game and launcher downloads from R2, with Range support.
// Writes (release publishing) need ADMIN_TOKEN: PUT /_admin/<key>, DELETE /_admin/<key>, GET /_admin?prefix=
const SHORT = /(^|\/)(latest\.json|manifest\.json|news\.json|releases\.json)$|^launcher\/latest\/|^game\/latest\//;
const TYPES = { json: "application/json", gz: "application/gzip", zip: "application/zip", exe: "application/vnd.microsoft.portable-executable", dmg: "application/x-apple-diskimage", appimage: "application/octet-stream", yml: "text/yaml", txt: "text/plain", blockmap: "application/octet-stream" };
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "range, if-none-match", "access-control-expose-headers": "content-length, content-range, etag, accept-ranges", "x-content-type-options": "nosniff" };
const safeKey = (k) => k && !k.includes("..") && !k.startsWith("/") && !k.includes("\\") && k.length < 512;
const ctype = (k) => TYPES[k.split(".").pop().toLowerCase()] || "application/octet-stream";

function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  return start <= end && start < size ? { offset: start, length: end - start + 1 } : "bad";
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/_admin")) return admin(req, env, url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: cors });
    let key = decodeURIComponent(url.pathname.slice(1));
    if (key === "" || key.endsWith("/")) key += "index.html";
    if (!safeKey(key)) return new Response("Not found", { status: 404, headers: cors });
    const head = await env.BUCKET.head(key);
    if (!head) return new Response("Not found", { status: 404, headers: { ...cors, "cache-control": "public, max-age=30" } });
    const h = new Headers(cors);
    h.set("content-type", head.httpMetadata?.contentType || ctype(key));
    h.set("etag", head.httpEtag); h.set("accept-ranges", "bytes");
    h.set("cache-control", SHORT.test(key) ? "public, max-age=60, must-revalidate" : "public, max-age=31536000, immutable");
    if (/\.(exe|dmg|appimage|zip)$/i.test(key)) h.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);
    if (req.headers.get("if-none-match") === head.httpEtag) return new Response(null, { status: 304, headers: h });
    const r = parseRange(req.headers.get("range"), head.size);
    if (r === "bad") { h.set("content-range", `bytes */${head.size}`); return new Response(null, { status: 416, headers: h }); }
    if (req.method === "HEAD") { h.set("content-length", String(head.size)); return new Response(null, { status: 200, headers: h }); }
    if (r) {
      const o = await env.BUCKET.get(key, { range: r });
      h.set("content-range", `bytes ${r.offset}-${r.offset + r.length - 1}/${head.size}`); h.set("content-length", String(r.length));
      return new Response(o.body, { status: 206, headers: h });
    }
    const o = await env.BUCKET.get(key);
    h.set("content-length", String(head.size));
    return new Response(o.body, { status: 200, headers: h });
  },
};

async function admin(req, env, url) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const enc = new TextEncoder();
  const a = enc.encode(tok), b = enc.encode(env.ADMIN_TOKEN || "");
  if (!env.ADMIN_TOKEN || a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
  const key = decodeURIComponent(url.pathname.slice("/_admin/".length));
  if (req.method === "GET" && url.pathname === "/_admin") {
    const l = await env.BUCKET.list({ prefix: url.searchParams.get("prefix") || "", limit: 1000 });
    return Response.json(l.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })));
  }
  if (!safeKey(key)) return new Response("Bad key", { status: 400 });
  // multipart upload for objects above the Worker request body limit: POST ?mpu=create, PUT ?mpu=part&id=..&n=.., POST ?mpu=complete&id=.. (JSON [{partNumber,etag}]), DELETE ?mpu=abort&id=..
  const mpu = url.searchParams.get("mpu");
  if (mpu) {
    const ct = req.headers.get("content-type") || ctype(key);
    if (mpu === "create" && req.method === "POST") { const m = await env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType: ct } }); return Response.json({ id: m.uploadId }); }
    const m = env.BUCKET.resumeMultipartUpload(key, url.searchParams.get("id") || "");
    if (mpu === "part" && req.method === "PUT") { const part = await m.uploadPart(Number(url.searchParams.get("n")), req.body); return Response.json({ partNumber: part.partNumber, etag: part.etag }); }
    if (mpu === "complete" && req.method === "POST") { const o = await m.complete(await req.json()); return Response.json({ ok: true, key, size: o.size }); }
    if (mpu === "abort") { await m.abort(); return Response.json({ ok: true }); }
    return new Response("Bad request", { status: 400 });
  }
  if (req.method === "PUT") { await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: req.headers.get("content-type") || ctype(key) } }); return Response.json({ ok: true, key }); }
  if (req.method === "DELETE") { await env.BUCKET.delete(key); return Response.json({ ok: true }); }
  return new Response("Method not allowed", { status: 405 });
}
