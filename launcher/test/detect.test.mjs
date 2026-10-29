import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LauncherCore } from "../src/controller.js";

function mk(platform = "linux") {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ss-detect-"));
  const core = new LauncherCore({ config: { releaseBaseUrl: "http://127.0.0.1:1/game", apiBaseUrl: "http://127.0.0.1:1", gameServerUrl: "ws://127.0.0.1:1", channel: "stable" }, userData, launcherVersion: "1.2.0", platform });
  return { core, userData };
}

test("detect recommends a folder when nothing is installed", async () => {
  const { core } = mk();
  const r = await core.detectInstallDir();
  assert.equal(r.ok, true); assert.equal(r.existing, false); assert.ok(r.dir);
});

test("detect finds an existing install in the legacy folder", async () => {
  const { core, userData } = mk();
  const legacy = path.join(userData, "Game"); fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, ".install.json"), JSON.stringify({ version: "0.3.0", files: {}, updating: false }));
  core.settings.set({ installDir: path.join(userData, "elsewhere") });
  const r = await core.detectInstallDir();
  assert.equal(r.existing, true); assert.equal(path.resolve(r.dir), path.resolve(legacy)); assert.match(r.reason, /0\.3\.0/);
});
