// Launcher configuration: config.json defaults overridden by environment variables.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env = process.env, file = path.join(here, "..", "config.json")) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* use built-in defaults */ }
  const c = {
    releaseBaseUrl: "https://dl.swordandseal.com/game",
    apiBaseUrl: "https://play.swordandseal.com",
    gameServerUrl: "wss://play.swordandseal.com",
    website: "https://swordandseal.com",
    support: "https://swordandseal.com/support",
    channel: "stable",
    launcherUpdate: { enabled: false, url: "" },
    ...cfg,
  };
  if (env.LAUNCHER_RELEASE_URL) c.releaseBaseUrl = env.LAUNCHER_RELEASE_URL;
  if (env.LAUNCHER_API_URL) c.apiBaseUrl = env.LAUNCHER_API_URL;
  if (env.LAUNCHER_SERVER_URL) c.gameServerUrl = env.LAUNCHER_SERVER_URL;
  if (env.LAUNCHER_FILE_SOURCE) c.releaseBaseUrl = pathToFileURL(path.resolve(env.LAUNCHER_FILE_SOURCE)).href;
  c.releaseBaseUrl = c.releaseBaseUrl.replace(/\/+$/, "");
  c.apiBaseUrl = c.apiBaseUrl.replace(/\/+$/, "");
  return c;
}
