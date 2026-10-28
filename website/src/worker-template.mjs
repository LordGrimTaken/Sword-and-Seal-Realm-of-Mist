// Sword & Seal website: single-module Cloudflare Worker. GENERATED from src/worker-template.mjs by website/build.mjs; do not edit dist-worker/worker.mjs.
// All site assets are embedded (text as strings, binary as base64). Cloudflare applies gzip/brotli on the way out.

const FILES = /*__FILES__*/{};
const CONFIG = __CONFIG__;

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://dl.swordandseal.com https://play.swordandseal.com",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const bytesCache = new Map();
function bodyOf(key) {
  const f = FILES[key];
  if (f.s !== undefined) return f.s;
  let b = bytesCache.get(key);
  if (!b) {
    const bin = atob(f.b);
    b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    bytesCache.set(key, b);
  }
  return b;
}

function cacheControl(key) {
  if (key.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (key.endsWith(".html")) return "public, max-age=300, must-revalidate";
  return "public, max-age=86400";
}

function serve(request, key, status = 200) {
  const f = FILES[key];
  const etag = '"' + f.e + '"';
  const headers = new Headers(SECURITY);
  headers.set("Content-Type", f.t);
  headers.set("ETag", etag);
  headers.set("Cache-Control", status === 404 ? "public, max-age=60" : cacheControl(key));
  headers.set("Vary", "Accept-Encoding");
  if (status === 200) {
    const inm = request.headers.get("If-None-Match");
    if (inm && inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
  }
  if (key.endsWith(".html")) headers.set("X-Robots-Tag", status === 404 ? "noindex" : "all");
  return new Response(request.method === "HEAD" ? null : bodyOf(key), { status, headers });
}

function redirect(location, status = 301) {
  return new Response(null, { status, headers: new Headers({ ...SECURITY, Location: location, "Cache-Control": "public, max-age=3600" }) });
}

/** Map a request path to an embedded file key, or a redirect target. */
export function route(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return { miss: true }; }
  if (p.includes("\0") || p.includes("..")) return { miss: true };
  if (p === "/") return { key: "/index.html" };
  if (p === "/index.html") return { redirect: "/" };
  if (p.length > 1 && p.endsWith("/")) return { redirect: p.replace(/\/+$/, "") || "/" };
  if (p.endsWith(".html")) return { redirect: p.slice(0, -5) };
  if (FILES[p]) return { key: p };
  if (!/\.[a-z0-9]+$/i.test(p) && FILES[p + ".html"] && p !== "/404") return { key: p + ".html" };
  return { miss: true };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === CONFIG.www) return redirect(`https://${CONFIG.apex}${url.pathname}${url.search}`);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD", ...SECURITY } });
    }
    const r = route(url.pathname);
    if (r.redirect) return redirect(r.redirect + url.search);
    if (r.key) return serve(request, r.key);
    return serve(request, "/404.html", 404);
  },
};
