# JIUZHOU v0.3.0 - third-party license notes

Licenses below were read from the `license` field of each package's `package.json` in `node_modules`.

## Shipped in the release zip
| Component | Version | License | Where |
|---|---|---|---|
| three (three.js) | 0.170.0 | MIT | bundled into `client/dist/assets/*.js` |
| ws | 8.22.0 | MIT | bundled into `server/dist/server.mjs` |
| @fontsource/ma-shan-zheng (Ma Shan Zheng font) | 5.3.1 | SIL OFL 1.1 | font files in `client/dist/assets/` |
| @fontsource/noto-serif (Noto Serif font, Latin 400/600/700 subsets) | 5.x | SIL OFL 1.1 | font files in `client/dist/assets/` |
| Node.js (not shipped; user installs) | >= 22.5 | MIT | runtime |

### Font attribution (SIL Open Font License 1.1)
- Ma Shan Zheng - Copyright 2011 The Ma Shan Zheng Project Authors (https://github.com/googlefonts/mashanzheng). 
- Noto Serif - Copyright 2015-2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic).
Both fonts are licensed under the SIL Open Font License, Version 1.1 (https://openfontlicense.org). The fonts may be bundled, embedded, redistributed and sold with software, but not sold by themselves; the license text must accompany copies (see each package's LICENSE file in `@fontsource/*`). The fonts are unmodified; only the Fontsource Latin woff/woff2 subsets are used. Noto Serif SC and all Chinese font files were removed in 0.3.0 (the game is English-only).

## Development / build only (not in the zip)
| Component | Version | License |
|---|---|---|
| vite | 5.4.21 | MIT |
| typescript | ^5.6 / ^7 | Apache-2.0 |
| esbuild (server bundling), tsx | - | MIT |
| electron | ^37 (declared; the release workflow installs it) | MIT (bundles Chromium under BSD-style and other licenses, see `LICENSES.chromium.html` inside any Electron build) |
| electron-builder | ^25 | MIT |
| @eslint/js, eslint, typescript-eslint, @types/* | see package.json | MIT / Apache-2.0 |
| softprops/action-gh-release, actions/* (CI only) | - | MIT |

## Game content
All game code, art (procedural three.js geometry) and audio (procedural) in this project are original to JIUZHOU; no third-party art or audio assets are included.

## Electron build status
- The packaged desktop app (Electron, Chromium and Node inside) is distributed by the installers only, never in the release zip. Electron's own `LICENSE` and `LICENSES.chromium.html` are placed inside every installer by electron-builder; keep them when redistributing.
- The server bundle inside installers is `server/dist/server.mjs` (ws, MIT, bundled by esbuild).
- Earlier (v0.1.0) an unpacked linux-x64 build with Electron 33 was produced in the sandbox but never launched. v0.2.0 installers (NSIS/portable, dmg, AppImage) are built only by `.github/workflows/release.yml` on GitHub runners; none of them was built or run in the development sandbox, and they are unsigned.
