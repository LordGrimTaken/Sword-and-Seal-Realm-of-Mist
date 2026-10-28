// Launcher handoff (docs/LAUNCHER.md). Three ways to get a session, all ending in the same LauncherCtx:
//  1. Electron: the preload bridge window.jzLauncher (token taken once over IPC).
//  2. scripts/play.mjs --launcher-session: the page is opened with ?launcher=1 and fetches /__launcher/session ONCE
//     (loopback only, one-use); the token is never in a URL.
//  3. Testing only: ?server=...&name=...&tok=... . The tok parameter is removed from the address bar immediately.
// The token is held in a closure until takeToken() hands it out once. It is never logged or stored.

export interface LauncherInfo { name: string; serverUrl: string }
interface Bridge { info(): Promise<(LauncherInfo & { rejected?: undefined }) | { rejected: string } | null>; takeToken(): Promise<string | null> }
declare global { interface Window { jzLauncher?: Bridge } }

export interface LauncherCtx extends LauncherInfo {
  /** The one-use login token; resolves null once it has been handed out. */
  takeToken(): Promise<string | null>;
}
export interface LauncherDetect { ctx: LauncherCtx | null; rejected: string }

export async function detectLauncher(params: URLSearchParams): Promise<LauncherDetect> {
  const bridge = window.jzLauncher;
  if (bridge) {
    try {
      const i = await bridge.info();
      if (i && "rejected" in i && i.rejected) return { ctx: null, rejected: i.rejected };
      if (i && "name" in i && i.name) return { ctx: { name: i.name, serverUrl: i.serverUrl, takeToken: () => bridge.takeToken() }, rejected: "" };
    } catch { /* no launcher */ }
    return { ctx: null, rejected: "" };
  }
  if (params.get("launcher") === "1") {
    try {
      const r = await fetch("/__launcher/session", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { name?: string; token?: string; serverUrl?: string };
        if (j.name && j.token && j.serverUrl) {
          let tok: string | null = j.token;
          return { ctx: { name: j.name, serverUrl: j.serverUrl, takeToken: async () => { const t = tok; tok = null; return t; } }, rejected: "" };
        }
      }
    } catch { /* fall through */ }
    return { ctx: null, rejected: "The launcher session is missing or already used. Start the game again from the launcher." };
  }
  const q = params.get("tok");
  if (q) {
    const name = params.get("name") || "";
    const serverUrl = params.get("server") || "";
    let tok: string | null = q;
    try { // scrub the token from the address bar / history entry right away
      const u = new URL(location.href);
      u.searchParams.delete("tok");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    } catch { /* ignore */ }
    if (name && serverUrl) return { ctx: { name, serverUrl, takeToken: async () => { const t = tok; tok = null; return t; } }, rejected: "" };
  }
  return { ctx: null, rejected: "" };
}

/** Names that already have a character on this machine's last successful logins (not secret; lets us skip the class picker). */
const KNOWN_KEY = "jz.known";
export function isKnownCharacter(name: string): boolean {
  try { return (JSON.parse(localStorage.getItem(KNOWN_KEY) || "[]") as string[]).includes(name.toLowerCase()); } catch { return false; }
}
export function rememberCharacter(name: string): void {
  try {
    const l = (JSON.parse(localStorage.getItem(KNOWN_KEY) || "[]") as string[]).filter((n) => n !== name.toLowerCase());
    l.push(name.toLowerCase());
    localStorage.setItem(KNOWN_KEY, JSON.stringify(l.slice(-20)));
  } catch { /* ignore */ }
}
