// Account API client. Contract: docs/LAUNCHER.md section 3.
async function post(apiBase, route, body, timeoutMs = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase.replace(/\/+$/, "")}${route}`, {
      method: "POST", headers: { "content-type": "application/json", "user-agent": "SwordAndSealLauncher/1" },
      body: JSON.stringify(body), signal: ac.signal,
    });
    let j = null;
    try { j = await res.json(); } catch { /* non JSON */ }
    if (j && j.ok === true && typeof j.token === "string") {
      return { ok: true, token: j.token, name: String(j.name ?? body.name), expiresIn: Number(j.expiresIn) || 300 };
    }
    if (j && j.ok === false && typeof j.error === "string") return { ok: false, error: j.error };
    if (res.status === 404) return { ok: false, error: "This server does not support launcher sign-in yet." };
    return { ok: false, error: "Cannot reach the account server." };
  } catch {
    return { ok: false, error: "Cannot reach the account server." };
  } finally { clearTimeout(t); }
}

export function checkCredentials(name, pw) {
  const n = String(name ?? "").trim();
  if (!n) return "Enter your account name.";
  if (typeof pw !== "string" || pw.length < 4 || pw.length > 64) return "Password must be 4 to 64 characters.";
  return null;
}

export async function authenticate(apiBase, kind, name, pw) {
  const bad = checkCredentials(name, pw);
  if (bad) return { ok: false, error: bad };
  return post(apiBase, kind === "register" ? "/api/auth/register" : "/api/auth/login", { name: String(name).trim(), pw });
}

/** GET /health -> { online, players, version, latencyMs } */
export async function checkHealth(apiBase, timeoutMs = 6000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(`${apiBase.replace(/\/+$/, "")}/health`, { signal: ac.signal, headers: { "cache-control": "no-cache" } });
    const latencyMs = Math.round(performance.now() - t0);
    const j = await res.json();
    if (!res.ok || !j || j.ok !== true) return { online: false, players: 0, version: null, latencyMs: null };
    return { online: true, players: Number(j.players) || 0, version: j.version ?? null, latencyMs };
  } catch { return { online: false, players: 0, version: null, latencyMs: null }; }
  finally { clearTimeout(t); }
}
