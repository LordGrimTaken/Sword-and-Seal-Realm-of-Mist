# Code signing guide (owner edition)

Plain-language guide for the owner of Sword and Seal. It covers what to buy or sign up for, which GitHub secret to create for each step, and what to expect. Nothing here is needed to build: **with no secrets set, every build still succeeds and produces unsigned installers**, and `launcher/latest.json` marks them `"signed": false`. Signing only changes what your players see on first launch.

Rules of thumb:

* Never commit a certificate, key, password or token. They live only in GitHub repository secrets (Settings > Secrets and variables > Actions).
* Secrets are exposed only to the signing and publishing steps of `.github/workflows/release.yml`, which runs on version tags. Pull requests (`ci.yml`) never see any secret.
* Verify prices and requirements yourself before paying: they change. Pricing is therefore not quoted here except where a Microsoft page states it.

## 0. Why warnings appear for a new app, even when signed

* **Windows SmartScreen** judges two things: the publisher (is the file signed by a known certificate?) and the reputation of the file. Microsoft states that even a signed, brand-new binary can show a warning until its hash or publisher certificate accumulates positive reputation, which "can take several weeks and hundreds of clean installs". Microsoft also states EV certificates no longer bypass SmartScreen. Signing consistently with the same identity lets reputation carry over between versions; unsigned files restart from zero with every release. A signed app at least shows your verified publisher name instead of "Unknown publisher". Source: [Microsoft, SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
* **Windows 11 Smart App Control** (when switched on) can block unsigned executables outright.
* **macOS Gatekeeper** blocks apps that are not signed with a Developer ID certificate AND notarized by Apple. There is no reputation shortcut: unsigned or un-notarized apps show "cannot be opened" and need a right-click > Open or a System Settings override. Signed and notarized apps open normally on first launch.
* **Linux** has no central gatekeeper. The best available is a published checksum file (and optionally a GPG signature) so players can verify the download.

## 1. Windows

### Option A (recommended): Azure Artifact Signing (formerly "Trusted Signing")

Microsoft's service; no hardware token; certificates are short-lived and handled for you. Microsoft's own page lists it as starting at a monthly fee (check [current pricing](https://azure.microsoft.com/pricing/details/trusted-signing/) before you subscribe).

Eligibility (from the [quickstart](https://learn.microsoft.com/azure/artifact-signing/quickstart), re-check it): organizations in the US, Canada, EU, UK, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway and Israel; individual developers only in the US or Canada. Identity validation of the organization takes 1 to 20 business days. For Xianwuli Interactive LLC (Ohio) choose **Organization** validation. You need a business website and an email address on a domain the company owns (for example `owner@swordandseal.com`).

Steps:

1. Create an Azure account and subscription. In the portal, register the resource provider `Microsoft.CodeSigning` (Subscriptions > your subscription > Resource providers).
2. Create an **Artifact Signing account** (name 3 to 24 letters/digits). Note its **region endpoint**, for example `https://eus.codesigning.azure.net/` (it must match the region you picked).
3. Give yourself the role **Artifact Signing Identity Verifier**, open **Identity validations > New identity**, choose Organization, Public Trust, and complete it. Wait for status Completed.
4. Create a **Certificate profile** (type Public Trust) that uses that validation. Note the profile name.
5. Create an **App registration** (Microsoft Entra ID) and a client secret for CI. Assign the app's service principal the role **Artifact Signing Certificate Profile Signer** (older portals call it "Trusted Signing Certificate Profile Signer") on the signing account.
6. Create these GitHub secrets:

| Secret | Value |
|---|---|
| `AZURE_TENANT_ID` | Directory (tenant) ID of the app registration |
| `AZURE_CLIENT_ID` | Application (client) ID (not the object ID) |
| `AZURE_CLIENT_SECRET` | the secret VALUE (not the secret ID) |
| `AZURE_CODESIGN_ENDPOINT` | the account's endpoint URL from step 2 |
| `AZURE_CODESIGN_ACCOUNT` | the signing account name |
| `AZURE_CODESIGN_PROFILE` | the certificate profile name |
| `AZURE_CODESIGN_PUBLISHER` | (optional) exact certificate subject, e.g. `CN=Xianwuli Interactive LLC, O=Xianwuli Interactive LLC, L=..., S=Ohio, C=US` as shown in the profile's Certificate Subject Preview. Used by electron-builder to verify the publisher |

How it is wired: `scripts/lib/builder-signing.cjs` turns those secrets into electron-builder's `win.azureSignOptions` (SHA-256, RFC 3161 timestamp from Microsoft's timestamp server). Microsoft's service uses certificates that live only days, so **the timestamp is what keeps the signature valid afterwards: never disable it.** See electron-builder's [Windows signing docs](https://www.electron.build/docs/features/code-signing/code-signing-win).

### Option B: classic OV or EV certificate in a .pfx

A certificate authority sells you a code-signing certificate after verifying the company. Since 2023 the CA/B rules require the private key to live on a hardware token or an HSM, so a plain downloadable .pfx is usually only available through cloud-HSM offerings or older certificates. If your CA gives you an exportable .pfx:

1. Base64-encode it: `base64 -w0 sword-and-seal.pfx` (Linux) or `[Convert]::ToBase64String([IO.File]::ReadAllBytes("sword-and-seal.pfx"))` (PowerShell).
2. Create secrets `CSC_LINK` (the base64 text) and `CSC_KEY_PASSWORD` (the .pfx password). The names `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` also work.
3. Delete the local .pfx copy once the secrets are stored; keep one offline backup in a password manager.

EV vs OV: EV costs more and may help with enterprise procurement, but Microsoft says it does not bypass SmartScreen, so OV or Azure is enough for a game. Hardware-token certificates cannot be used on GitHub's hosted runners; use a cloud-HSM product or Option A.

Priority when both are set: Azure wins.

## 2. macOS

Requirements: an **Apple Developer Program** membership (paid annually; Apple lists the current fee on its enrolment page, historically USD 99 per year; check it). Enrolling as an organization needs a D-U-N-S number for Xianwuli Interactive LLC; as an individual it is faster. Enrolment can take days.

1. In your developer account (Certificates, Identifiers & Profiles) create a **Developer ID Application** certificate (not "Developer ID Installer", not "Mac App Distribution"). Easiest path: Xcode > Settings > Accounts > Manage Certificates > "+" > Developer ID Application, on any Mac.
2. In Keychain Access, find "Developer ID Application: ..." and export it with its private key as `.p12`, with a strong password.
3. Base64 it: `base64 -i DeveloperID.p12 | pbcopy`.
4. Create secrets `CSC_LINK` (that base64 text) and `CSC_KEY_PASSWORD` (the .p12 password). For the macOS job these are separate from the Windows ones only by what you store; if you also use a Windows PFX, keep it in `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` and store the Mac one in `CSC_LINK` / `CSC_KEY_PASSWORD` (the workflow routes each to its own OS).
5. Notarization (Apple scans the build; required for Gatekeeper to accept it). Pick ONE:

**Recommended: App Store Connect API key** (no personal Apple ID in CI). In App Store Connect > Users and Access > Integrations > Team Keys, create a key with the **Developer** role (enough for notarization). Download `AuthKey_XXXXXXXX.p8` once (Apple lets you download it only once). Secrets:

| Secret | Value |
|---|---|
| `APPLE_API_KEY_P8` | base64 of the .p8 file (the workflow writes it to a temp file and passes its path as `APPLE_API_KEY`) |
| `APPLE_API_KEY_ID` | the Key ID |
| `APPLE_API_ISSUER` | the Issuer ID (UUID shown above the keys list) |

**Alternative: Apple ID + app-specific password.** Create the password at appleid.apple.com > Sign-In and Security > App-Specific Passwords. Secrets: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (10 characters, shown in your developer account Membership details).

electron-builder runs Apple's `notarytool` for you and staples the ticket when these are present (see electron-builder's [notarization docs](https://www.electron.build/docs/notarization), [Apple TN3147](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool.md)). The apps are built with the Hardened Runtime and the minimal entitlements in `launcher/build/entitlements.mac*.plist` and `client/build/entitlements.mac*.plist`; each entitlement is commented with its reason. Builds are universal (Apple Silicon + Intel) as .dmg and .zip.

Without the secrets the macOS job still produces an unsigned, un-notarized dmg that players must open with right-click > Open.

## 3. Linux

No certificate exists for this. The release job writes `SHA256SUMS` next to the AppImage and publishes it. Players check it with `sha256sum -c SHA256SUMS`.

Optional GPG signature (adds `SHA256SUMS.asc`; `latest.json` then marks the Linux file `signed: true`):

1. `gpg --quick-generate-key "Sword and Seal Releases <releases@swordandseal.com>" ed25519 sign 2y`
2. `gpg --armor --export-secret-keys <KEYID> | base64 -w0` -> secret `GPG_PRIVATE_KEY`; the passphrase -> secret `GPG_PASSPHRASE`.
3. Publish the public key `gpg --armor --export <KEYID>` on the website so players can import it.

## 4. Key handling

* Keep the originals (the .p12/.pfx, the .p8, the GPG key) in a password manager or encrypted offline backup. GitHub secrets cannot be read back.
* Use the narrowest roles: the Azure app can only sign with one profile; the Apple API key has the Developer role only.
* Rotate: Azure client secrets expire (pick a reminder date), Apple Developer ID certificates last 5 years, app-specific passwords can be revoked at any time.
* If a secret leaks: revoke it at the issuer first (Azure: delete the client secret; Apple: revoke the key or certificate; CA: request revocation), then replace the GitHub secret. The same goes for `DL_ADMIN_TOKEN` (rotate it in the Cloudflare Worker).
* Use a GitHub **Environment** called `release` with required reviewers if you want a human click before any signing happens (the workflow already targets it).
* Tag builds only: signing runs on `v*` tags and manual runs from the default branch, never on pull requests.

## 5. Checking the result

After a release the workflow runs `scripts/verify-signatures.mjs` per OS (Windows: `Get-AuthenticodeSignature`; macOS: `codesign --verify --deep --strict`, `spctl --assess`, `xcrun stapler validate`; Linux: checksums) and records the outcome in `signing-<os>.json`, which `make-release` turns into the `signed` flags of `launcher/latest.json`. You can also check by hand: on Windows right-click the exe > Properties > Digital Signatures; on macOS `spctl -a -vv -t install SwordAndSeal-Launcher.dmg`.

## 6. Summary: what to create

| Goal | Accounts | Secrets |
|---|---|---|
| Release uploads (required) | Cloudflare Worker admin token | `DL_ADMIN_TOKEN` |
| Windows signing (A) | Azure subscription + Artifact Signing | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_CODESIGN_ENDPOINT`, `AZURE_CODESIGN_ACCOUNT`, `AZURE_CODESIGN_PROFILE`, optional `AZURE_CODESIGN_PUBLISHER` |
| Windows signing (B) | OV/EV certificate vendor | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |
| macOS signing | Apple Developer Program | `CSC_LINK`, `CSC_KEY_PASSWORD` |
| macOS notarization | same | `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) |
| Linux signature (optional) | none | `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE` |
