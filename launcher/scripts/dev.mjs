// Dev mode: serve ../release (or LAUNCHER_DEV_RELEASE) + a mock account API on port 8815, then start the launcher against it.
// Usage: npm run launcher:dev   (run `npm run release` first)
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startDevHost } from "./dev-host.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const relDir = path.resolve(process.env.LAUNCHER_DEV_RELEASE || path.join(root, "release"));
const port = Number(process.env.LAUNCHER_DEV_PORT) || 8815;
if (!fs.existsSync(path.join(relDir, "latest", "manifest.json"))) { console.error(`No release found in ${relDir}. Run: npm run release`); process.exit(1); }
const host = await startDevHost({ dir: relDir, port, mockApi: !process.env.LAUNCHER_API_URL });
const base = `http://127.0.0.1:${port}`;
console.log(`Dev host: ${base} (release ${relDir}${process.env.LAUNCHER_API_URL ? "" : ", mock account API"})`);

const cands = [path.join(here, "..", "node_modules", ".bin", "electron"), path.join(root, "client", "node_modules", ".bin", "electron")];
const bin = cands.find((c) => fs.existsSync(c) || fs.existsSync(c + ".cmd"));
if (!bin) { console.error("Electron not found. Run `npm --prefix launcher install` (or `npm --prefix client install`)."); process.exit(1); }
const env = { LAUNCHER_RELEASE_URL: base, LAUNCHER_API_URL: base, LAUNCHER_SERVER_URL: "ws://127.0.0.1:8787", LAUNCHER_HOME: path.join(root, "release", ".launcher-dev-home"), ...process.env };
const child = spawn(bin + (process.platform === "win32" ? ".cmd" : ""), [path.join(here, ".."), ...(process.env.LAUNCHER_NO_SANDBOX === "1" ? [] : [])], { stdio: "inherit", env, shell: process.platform === "win32" });
child.on("exit", (c) => { host.close(); process.exit(c ?? 0); });
