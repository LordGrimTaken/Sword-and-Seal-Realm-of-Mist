#!/usr/bin/env node
// Generates the release notes the game ships with, from CHANGELOG.md.
//   node scripts/make-releases.mjs        -> client/src/data/releases.json
//
// The client bundles this file at build time (no network call), so the in-game "what's new" window and the
// patch-notes panel work offline and inside the Electron package.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog, versionAnchor } from "./release-notes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "client", "src", "data", "releases.json");

const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const versions = parseChangelog(changelog, { filterDev: true }).map((v) => ({
  ...v,
  anchor: versionAnchor(v.version),
}));

if (!versions.length) {
  console.error("make-releases: parsed no versions from CHANGELOG.md");
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(versions, null, 2) + "\n");
const bullets = versions.reduce((n, v) => n + v.groups.reduce((m, g) => m + g.bullets.length, 0), 0);
console.log(`release notes: ${versions.length} versions, ${bullets} bullets -> ${path.relative(ROOT, OUT)}`);
