"use strict";
// Shared code-signing wiring for the launcher and the game client (electron-builder).
// Everything here is INERT unless the matching environment variables are set: with no secrets the
// build still succeeds and produces unsigned artifacts (scripts/make-release.mjs then tags them signed:false).
//
// Windows, in priority order:
//   1. Azure Trusted Signing (now "Artifact Signing"): AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//      plus AZURE_CODESIGN_ENDPOINT, AZURE_CODESIGN_ACCOUNT, AZURE_CODESIGN_PROFILE (optional AZURE_CODESIGN_PUBLISHER).
//   2. Classic OV/EV PFX: CSC_LINK (or WIN_CSC_LINK) + CSC_KEY_PASSWORD (or WIN_CSC_KEY_PASSWORD).
// macOS:
//   Signing:       CSC_LINK (base64 .p12 / path / https URL) + CSC_KEY_PASSWORD (or CSC_NAME for a keychain identity).
//   Notarization:  APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID,
//                  or APPLE_API_KEY (path to AuthKey_XXXX.p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER.
// REQUIRE_SIGNING=1 turns "no credentials for this OS" into a hard error (CI sets it when it expects secrets).

const env = process.env;
const has = (...names) => names.every((n) => typeof env[n] === "string" && env[n].trim() !== "");

function windowsMode() {
  if (has("AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_CODESIGN_ENDPOINT", "AZURE_CODESIGN_ACCOUNT", "AZURE_CODESIGN_PROFILE")) return "azure";
  if ((has("CSC_LINK") || has("WIN_CSC_LINK")) && (has("CSC_KEY_PASSWORD") || has("WIN_CSC_KEY_PASSWORD"))) return "pfx";
  return "none";
}
function macSigningMode() { return has("CSC_LINK", "CSC_KEY_PASSWORD") || has("CSC_NAME") ? "developer-id" : "none"; }
function macNotarizeMode() {
  if (has("APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER")) return "api-key";
  if (has("APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID")) return "apple-id";
  return "none";
}

/** Returns { win, mac, summary } fragments to merge into an electron-builder config. */
function signingFragments({ macEntitlements, macEntitlementsInherit }) {
  const wm = windowsMode(), ms = macSigningMode(), mn = macNotarizeMode();
  const require_ = env.REQUIRE_SIGNING === "1";
  const plat = process.platform;
  if (require_ && plat === "win32" && wm === "none") throw new Error("REQUIRE_SIGNING=1 but no Windows signing credentials are set (Azure Trusted Signing or CSC_LINK/CSC_KEY_PASSWORD).");
  if (require_ && plat === "darwin" && (ms === "none" || mn === "none")) throw new Error("REQUIRE_SIGNING=1 but macOS signing (CSC_LINK/CSC_KEY_PASSWORD) and/or notarization (APPLE_*) credentials are missing.");

  const win = {
    // Both rfc3161 timestamping and sha256 only: signatures stay valid after the certificate expires.
    rfc3161TimeStampServer: "http://timestamp.digicert.com",
    timeStampServer: "http://timestamp.digicert.com",
    signingHashAlgorithms: ["sha256"],
    forceCodeSigning: false,
  };
  if (wm === "azure") {
    win.azureSignOptions = {
      endpoint: env.AZURE_CODESIGN_ENDPOINT,
      codeSigningAccountName: env.AZURE_CODESIGN_ACCOUNT,
      certificateProfileName: env.AZURE_CODESIGN_PROFILE,
      // Extra keys are passed straight to Invoke-TrustedSigning as -<Key> <value> (see app-builder-lib windowsSignAzureManager).
      FileDigest: "SHA256",
      TimestampRfc3161: "http://timestamp.acs.microsoft.com",
      TimestampDigest: "SHA256",
    };
    if (has("AZURE_CODESIGN_PUBLISHER")) win.publisherName = env.AZURE_CODESIGN_PUBLISHER;
    win.forceCodeSigning = require_;
  } else if (wm === "pfx") {
    win.forceCodeSigning = require_;
  }

  const mac = {
    hardenedRuntime: true,
    gatekeeperAssess: false,   // CI runs spctl itself (scripts/verify-signatures.mjs)
    entitlements: macEntitlements,
    entitlementsInherit: macEntitlementsInherit,
    notarize: ms === "developer-id" && mn !== "none",   // electron-builder 25: boolean; credentials come from APPLE_* env
  };
  if (ms === "none") mac.identity = null;                // do not auto-discover a stray keychain identity: unsigned build
  const summary = `signing: windows=${wm}, macos=${ms}${ms !== "none" ? `+notarize:${mn}` : ""}`;
  return { win, mac, summary };
}

module.exports = { signingFragments, windowsMode, macSigningMode, macNotarizeMode };
