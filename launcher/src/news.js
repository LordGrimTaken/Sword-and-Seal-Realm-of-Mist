// News feed: GET {releaseBaseUrl}/latest/news.json, cached on disk for offline use.
import fs from "node:fs";
import path from "node:path";
import { fetchText } from "./source.js";

export function normalizeNews(raw) {
  if (!Array.isArray(raw)) throw new Error("news.json must be an array");
  const str = (v, max) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
  const items = raw.filter((n) => n && typeof n === "object").slice(0, 100).map((n, i) => ({
    id: str(n.id ?? i, 80), title: str(n.title, 160), date: str(n.date, 40), body: str(n.body, 8000),
    tag: str(n.tag, 24), banner: str(n.banner, 24), summary: str(n.summary, 300),   // optional: label chip, painted banner key (valley|blades|scroll|lantern), card blurb
  })).filter((n) => n.title);
  const t = (d) => { const x = Date.parse(d); return Number.isNaN(x) ? 0 : x; };
  items.sort((a, b) => t(b.date) - t(a.date));
  return items;
}

/** Returns { items, cached, error? }. Never throws. */
export async function loadNews({ releaseBaseUrl, cacheFile, signal }) {
  const url = `${releaseBaseUrl.replace(/\/+$/, "")}/latest/news.json`;
  try {
    const items = normalizeNews(JSON.parse(await fetchText(url, { signal })));
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ savedAt: new Date().toISOString(), items })); } catch { /* cache is optional */ }
    return { items, cached: false };
  } catch (err) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      return { items: normalizeNews(c.items), cached: true, savedAt: c.savedAt, error: err.message };
    } catch { return { items: [], cached: false, error: err.message }; }
  }
}
