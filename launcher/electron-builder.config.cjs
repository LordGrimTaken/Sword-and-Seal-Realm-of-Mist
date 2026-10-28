"use strict";
// electron-builder config for the Sword and Seal Launcher. Used via `electron-builder --config electron-builder.config.cjs`
// (see "dist" scripts in package.json). Signing is wired through ../scripts/lib/builder-signing.cjs and is inert without secrets.
const path = require("node:path");
const { signingFragments } = require("../scripts/lib/builder-signing.cjs");

const sign = signingFragments({
  macEntitlements: path.join(__dirname, "build", "entitlements.mac.plist"),
  macEntitlementsInherit: path.join(__dirname, "build", "entitlements.mac.inherit.plist"),
});
if (process.env.BUILDER_QUIET !== "1") console.error(`[launcher builder] ${sign.summary}`);

module.exports = {
  appId: "com.swordandseal.launcher",
  productName: "Sword and Seal Launcher",
  copyright: "Copyright (c) Xianwuli Interactive LLC",
  files: ["electron/**/*", "src/**/*", "renderer/**/*", "config.json", "package.json", "build/icon.png"],
  directories: { output: "dist", buildResources: "build" },
  artifactName: "SwordAndSeal-Launcher-Setup-${version}.${ext}",
  // Self-update feed (electron-updater "generic"): see docs/LAUNCHER.md section 5 and docs/RELEASING.md.
  publish: [{ provider: "generic", url: "https://dl.swordandseal.com/launcher/feed" }],
  linux: { target: [{ target: "AppImage", arch: ["x64"] }], category: "Game", icon: "build/icon.png", artifactName: "SwordAndSeal-Launcher-${version}.${ext}" },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }, { target: "portable", arch: ["x64"] }],
    icon: "build/icon.png",
    ...sign.win,
  },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, artifactName: "SwordAndSeal-Launcher-Setup-${version}.${ext}" },
  portable: { artifactName: "SwordAndSeal-Launcher-Portable-${version}.${ext}" },
  mac: {
    // Universal binary (arm64 + x64) as dmg and zip (zip is what electron-updater uses on macOS).
    target: [{ target: "dmg", arch: ["universal"] }, { target: "zip", arch: ["universal"] }],
    category: "public.app-category.games",
    icon: "build/icon.png",
    artifactName: "SwordAndSeal-Launcher-${version}-mac.${ext}",
    ...sign.mac,
  },
  dmg: { artifactName: "SwordAndSeal-Launcher-${version}.${ext}", sign: false },
};
