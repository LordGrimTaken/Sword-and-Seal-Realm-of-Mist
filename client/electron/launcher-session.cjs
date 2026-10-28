// Reads the launch session file written by the launcher (docs/LAUNCHER.md section 4). Pure Node, no Electron imports (tested with plain node).
// The file is deleted IMMEDIATELY after reading, whether or not it turns out to be valid. The token is never logged.
const fs = require("node:fs");

const MAX_AGE_MS = 2 * 60 * 1000;
const MAX_FILE = 4096;

/** Value of --launcher-session=<path> in argv, or "". */
function sessionPathFromArgv(argv) {
  const a = argv.find((x) => typeof x === "string" && x.startsWith("--launcher-session="));
  return a ? a.slice("--launcher-session=".length) : "";
}

/**
 * Returns { ok:true, session:{name,token,serverUrl} } or { ok:false, reason } (reason is safe to show and log).
 * `now` is injectable for tests.
 */
function consumeSessionFile(file, now = Date.now()) {
  let raw;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE) { try { fs.unlinkSync(file); } catch { /* ignore */ } return { ok: false, reason: "The launcher session file is not valid." }; }
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { ok: false, reason: "The launcher session file could not be read." };
  }
  try { fs.unlinkSync(file); } catch { /* best effort; the token is one-use and short-lived anyway */ }
  let j;
  try { j = JSON.parse(raw); } catch { return { ok: false, reason: "The launcher session file is malformed." }; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, reason: "The launcher session file is malformed." };
  const { name, token, serverUrl, createdAt } = j;
  if (typeof name !== "string" || !name.trim() || name.length > 32) return { ok: false, reason: "The launcher session file is malformed." };
  if (typeof token !== "string" || !token || token.length > 256) return { ok: false, reason: "The launcher session file is malformed." };
  if (typeof serverUrl !== "string" || !/^wss?:\/\/[^\s/]+(\/\S*)?$/i.test(serverUrl) || serverUrl.length > 300) return { ok: false, reason: "The launcher session file is malformed." };
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(t)) return { ok: false, reason: "The launcher session file is malformed." };
  if (now - t > MAX_AGE_MS || t - now > 60 * 1000) return { ok: false, reason: "The launcher session has expired. Start the game again from the launcher." };
  return { ok: true, session: { name: name.trim(), token, serverUrl } };
}

module.exports = { MAX_AGE_MS, sessionPathFromArgv, consumeSessionFile };
