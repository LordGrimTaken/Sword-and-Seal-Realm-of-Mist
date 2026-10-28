// Byte source abstraction: http(s):// via fetch, file:// via fs. Supports start offsets (HTTP Range).
import fs from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { CancelError } from "./util.js";

/**
 * Open a stream starting at byte `start`.
 * Returns { status: 200|206|416, stream: Readable|null, totalSize: number|null, close() }.
 * status 200 means the full body (server ignored/was not asked for Range).
 */
export async function openStream(url, { start = 0, signal } = {}) {
  if (signal?.aborted) throw new CancelError();
  if (url.startsWith("file:")) {
    const p = fileURLToPath(url);
    const st = await fs.promises.stat(p);
    if (start > 0 && start >= st.size) return { status: 416, stream: null, totalSize: st.size, close() {} };
    const stream = fs.createReadStream(p, { start });
    return { status: start > 0 ? 206 : 200, stream, totalSize: st.size, close() { stream.destroy(); } };
  }
  const headers = { "accept-encoding": "identity", "user-agent": "SwordAndSealLauncher/1" };
  if (start > 0) headers.range = `bytes=${start}-`;
  const res = await fetch(url, { headers, signal, redirect: "follow" });
  if (res.status === 416) { await res.body?.cancel().catch(() => {}); return { status: 416, stream: null, totalSize: null, close() {} }; }
  if (res.status !== 200 && res.status !== 206) {
    await res.body?.cancel().catch(() => {});
    const e = new Error(`HTTP ${res.status} for ${url}`); e.httpStatus = res.status; throw e;
  }
  const stream = Readable.fromWeb(res.body);
  let total = null;
  const cr = /\/(\d+)$/.exec(res.headers.get("content-range") || "");
  if (cr) total = Number(cr[1]); else if (res.status === 200 && res.headers.get("content-length")) total = Number(res.headers.get("content-length"));
  return { status: res.status, stream, totalSize: total, close() { stream.destroy(); } };
}

/** Fetch a small body (JSON etc.) as text with a timeout. */
export async function fetchText(url, { signal, timeoutMs = 15000 } = {}) {
  if (url.startsWith("file:")) return fs.promises.readFile(fileURLToPath(url), "utf8");
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { "cache-control": "no-cache", "user-agent": "SwordAndSealLauncher/1" } });
    if (!res.ok) { const e = new Error(`HTTP ${res.status} for ${url}`); e.httpStatus = res.status; throw e; }
    return await res.text();
  } finally { clearTimeout(t); signal?.removeEventListener("abort", onAbort); }
}
