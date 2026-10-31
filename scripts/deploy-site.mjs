#!/usr/bin/env node
// Publish the marketing site to Cloudflare Workers.
//
//   npm run deploy:site              build, gate, deploy
//   npm run deploy:site -- --dry-run build, gate, bundle and print the upload plan (no auth, no upload)
//   npm run deploy:site -- --check   build and gate only
//
// Auth, one of:
//   - CLOUDFLARE_API_TOKEN (+ optional CLOUDFLARE_ACCOUNT_ID) in the environment.
//     The token needs "Workers Scripts: Edit" on the account; the route in
//     website/wrangler.toml also needs permission to edit the swordandseal.com zone.
//   - a wrangler login session on this machine (`npx wrangler login`).
//
// Nothing here is deployed unless every gate passes first.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE = path.join(ROOT, "website");
const argv = new Set(process.argv.slice(2));
const DRY = argv.has("--dry-run");
const CHECK_ONLY = argv.has("--check");

function step(title) {
  console.log(`\n== ${title}`);
}

function run(command, args, cwd = ROOT) {
  // Build one shell line and quote anything with spaces (the Windows node path is
  // under "C:\Program Files", which an unquoted shell line splits at the space).
  const quote = (value) => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const line = [command, ...args].map(quote).join(" ");
  const result = spawnSync(line, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\nFAILED: ${line} (exit ${result.status})`);
    process.exit(result.status || 1);
  }
}

function wranglerDirectories() {
  return [
    path.join(os.homedir(), ".wrangler"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "xdg.config", ".wrangler") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "xdg.config", ".wrangler") : "",
  ].filter(Boolean);
}

function hasCredentials() {
  if (process.env.CLOUDFLARE_API_TOKEN) return "CLOUDFLARE_API_TOKEN";
  const dir = wranglerDirectories().find((candidate) => fs.existsSync(candidate));
  return dir ? `wrangler session in ${dir}` : null;
}

const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();

step("build");
run(process.execPath, [path.join("website", "build.mjs")]);

step("worker probe (the bundle Cloudflare will run)");
run(process.execPath, [path.join("website", "scripts", "probe-worker.mjs")]);

step("link check");
run(process.execPath, [path.join("website", "scripts", "linkcheck.mjs")]);

if (CHECK_ONLY) {
  console.log(`\ncheck only: site ${version} builds and passes every gate. Nothing was uploaded.`);
  process.exit(0);
}

const credentials = hasCredentials();
if (!credentials && !DRY) {
  console.error("\nCannot deploy: no Cloudflare credentials on this machine.\n");
  console.error(`  Site ${version} is built and verified in website/dist-worker/worker.mjs.`);
  console.error("  To publish it, do one of these and run this command again:\n");
  console.error("    set CLOUDFLARE_API_TOKEN=<token with Workers Scripts:Edit>");
  console.error("    set CLOUDFLARE_ACCOUNT_ID=<account id>\n");
  console.error("    (or run `npx wrangler login` once in website/ to create a session)\n");
  console.error("  Then:  npm run deploy:site");
  process.exit(2);
}

step(DRY ? "bundle (dry run, nothing uploaded)" : `deploy site ${version} via wrangler`);
const wranglerArgs = ["--yes", "wrangler@latest", "deploy"];
if (DRY) wranglerArgs.push("--dry-run", "--outdir", path.join("dist-worker", "dry-run"));
run("npx", wranglerArgs, WEBSITE);

if (!DRY) {
  step("verify the live site");
  const live = spawnSync(`"${process.execPath}" "${path.join(ROOT, "website", "scripts", "live-check.mjs")}"`, {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (live.status !== 0) {
    console.error("\nThe deploy reported success but the live check failed. The Worker may still be propagating; re-run: npm run live:site");
    process.exit(live.status || 1);
  }
}

console.log(`\n${DRY ? "Bundled" : "Published"} site ${version}.`);
