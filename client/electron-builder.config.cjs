"use strict";
// electron-builder config for the packaged Sword and Seal game client. Used via `electron-builder --config electron-builder.config.cjs`.
// Signing is wired through ../scripts/lib/builder-signing.cjs and is inert without secrets.
// Extra target "dir" (pass it on the command line, e.g. `electron-builder --win nsis portable dir`) also emits the unpacked
// app folder that scripts/make-release.mjs ships through the launcher (--electron-<platform>).
const path = require("node:path");
const { signingFragments } = require("../scripts/lib/builder-signing.cjs");

const sign = signingFragments({
  macEntitlements: path.join(__dirname, "build", "entitlements.mac.plist"),
  macEntitlementsInherit: path.join(__dirname, "build", "entitlements.mac.inherit.plist"),
});
if (process.env.BUILDER_QUIET !== "1") console.error(`[client builder] ${sign.summary}`);

module.exports = {
  appId: "com.jiuzhou.client",
  productName: "Sword and Seal",
  copyright: "Copyright (c) Xianwuli Interactive LLC",
  files: ["dist/**/*", "electron/**/*", "package.json"],
  extraResources: [{ from: "../server/dist/server.mjs", to: "server/server.mjs" }],
  directories: { output: "release" },
  artifactName: "Jiuzhou-${version}-${os}-${arch}.${ext}",
  linux: { target: [{ target: "AppImage", arch: ["x64"] }], category: "Game" },
  win: { target: [{ target: "nsis", arch: ["x64"] }, { target: "portable", arch: ["x64"] }], ...sign.win },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, artifactName: "Jiuzhou-Setup-${version}.${ext}" },
  portable: { artifactName: "Jiuzhou-Portable-${version}.${ext}" },
  mac: {
    target: [{ target: "dmg", arch: ["universal"] }, { target: "zip", arch: ["universal"] }],
    category: "public.app-category.games",
    artifactName: "Jiuzhou-${version}-mac-universal.${ext}",
    ...sign.mac,
  },
  dmg: { artifactName: "Jiuzhou-${version}-mac-universal.${ext}", sign: false },
};
