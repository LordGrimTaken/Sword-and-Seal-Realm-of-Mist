// swordandseal.com: serves the built website from R2 (prefix site/). Source of truth: website/ (node website/build.mjs, then infra/publish-site.sh).
const APEX = "swordandseal.com", WWW = "www.swordandseal.com";
const CSP = ["default-src 'none'","script-src 'self'","style-src 'self'","img-src 'self' data:","font-src 'self'","connect-src 'self' https://dl.swordandseal.com https://play.swordandseal.com","manifest-src 'self'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'","object-src 'none'","upgrade-insecure-requests"].join("; ");
const SECURITY = {
  "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains", "Cross-Origin-Opener-Policy": "same-origin",
};
const redirect = (loc) => new Response(null, { status: 301, headers: { ...SECURITY, Location: loc, "Cache-Control": "public, max-age=3600" } });
const cache = (k) => k.startsWith("assets/") ? "public, max-age=31536000, immutable" : k.endsWith(".html") ? "public, max-age=300, must-revalidate" : "public, max-age=86400";

async function serve(req, env, key, status = 200) {
  const o = await env.BUCKET.get("site/" + key);
  if (!o) return null;
  const h = new Headers(SECURITY);
  h.set("Content-Type", o.httpMetadata?.contentType || "application/octet-stream");
  h.set("ETag", o.httpEtag); h.set("Vary", "Accept-Encoding");
  h.set("Cache-Control", status === 404 ? "public, max-age=60" : cache(key));
  if (key.endsWith(".html")) h.set("X-Robots-Tag", status === 404 ? "noindex" : "all");
  if (status === 200 && req.headers.get("If-None-Match") === o.httpEtag) return new Response(null, { status: 304, headers: h });
  return new Response(req.method === "HEAD" ? null : o.body, { status, headers: h });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname === WWW) return redirect(`https://${APEX}${url.pathname}${url.search}`);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD", ...SECURITY } });
    let p; try { p = decodeURIComponent(url.pathname); } catch { p = "\0"; }
    if (!p.includes("\0") && !p.includes("..")) {
      if (p === "/") { const r = await serve(req, env, "index.html"); if (r) return r; }
      else if (p === "/index.html") return redirect("/" + url.search);
      else if (p.length > 1 && p.endsWith("/")) return redirect(p.replace(/\/+$/, "") + url.search);
      else if (p.endsWith(".html")) return redirect(p.slice(0, -5) + url.search);
      else {
        const key = p.slice(1);
        const hasExt = /\.[a-z0-9]+$/i.test(key);
        const r = await serve(req, env, hasExt ? key : key + ".html");
        if (r && key !== "404") return r;
      }
    }
    return (await serve(req, env, "404.html", 404)) || new Response("Not found", { status: 404, headers: SECURITY });
  },
};
