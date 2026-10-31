# Headless / invisible tooling

**Rule: nothing run for verification may put a window on the interactive desktop.**

Four mechanisms — pick by what you need to learn from the run. Everything here is developed and tested from this
repo; the harness plugin is *installed from* `tools/dsh-plugins/run-hidden/`.

## 1. The `run_hidden` harness tool (installed, available every session)

`tools/dsh-plugins/run-hidden/` is a DSH bundle that adds one tool, **`run_hidden`**, to every session in the
profile. It starts a windowed program on an invisible Windows desktop, confirms it stayed alive, and stops it.

```js
run_hidden({ exe: "C:\\Windows\\System32\\charmap.exe", seconds: 4 })
// → Ran hidden for 4s: survived=true, windows on the real desktop=0. Process stopped.
```

Result fields: `ok`, `survived`, `realDesktopWindows`, `pid`, `desktop`, `seconds`, and `exitCode`/`error` on
failure. `realDesktopWindows` counts visible windows that process put on the real desktop — it must be `0`.

Install / update (after editing the bundle):

```powershell
# first time, or after changing files
plugin_manager({ action: "install_bundle", target: "<repo>\\tools\\dsh-plugins\\run-hidden" })
# to pick up edits, remove first: install_bundle refuses an already-installed package
plugin_manager({ action: "remove_bundle", target: "@local/dsh-plugin-run-hidden" })
```

The bundle imports nothing from the harness, because a linked workspace package cannot resolve the harness's own
modules; it authors the tool definition in the raw JSON-Schema subset the tool registry accepts.

## 2. The standalone runner — same mechanism, ad-hoc

`tools/hidden-run.ps1` creates a throwaway desktop (`dsh-hidden-xxxxxxxx`) and launches the target on it via
`CreateProcessW` with `STARTUPINFO.lpDesktop`. Use it when you are not going through the harness tool.

```powershell
powershell -NoProfile -File tools/hidden-run.ps1 -Exe "C:\path\App.exe" `
  -ArgList "--flag","value" -WorkingDirectory "C:\dir" -Seconds 8
# or, for machine-built requests:
powershell -NoProfile -File tools/hidden-run.ps1 -RequestFile request.json
```

It prints one JSON line — `{ survived, realDesktopWindows, pid, desktop }` — and always kills the process tree and
closes the desktop before returning.

Exit codes: `0` ran hidden and healthy · `1` could not create desktop/process · `2` died before the window closed ·
`3` leaked a window to the real desktop.

## 3. In-process headless rendering — screenshots still work

- **Web UIs:** headless Chromium through Playwright (what the game screenshots already use).
- **Electron apps:** give the app its own headless switch and drive it over the DevTools protocol. A hidden window
  still renders, so `Page.captureScreenshot` works.

The launcher has such a switch (`launcher/electron/main.cjs`):

```
LAUNCHER_HIDDEN=1              build the window, never call win.show()
--remote-debugging-port=9333   expose CDP
```

Recipe:

1. start the launcher's dev host (`launcher/scripts/dev-host.mjs <releaseDir> 8815 --mock-api`)
2. launch Electron with `LAUNCHER_HIDDEN=1` and `--remote-debugging-port=9333`
3. connect Playwright over CDP, read DOM + screenshot
4. kill Electron and free the ports **in the same command**

Note: on this machine `ELECTRON_RUN_AS_NODE=1` is set by the host environment; clear it for the child process or
Electron starts as plain Node and crashes.

## Caveats

- Windows 11 Store stubs (`notepad`, `calc`, `mspaint`) relaunch themselves on the interactive desktop. Smoke-test
  the real Win32 host app (`charmap`, `winver`) or the app you actually care about.
- Windows on a hidden desktop are not composited by DWM, so you cannot screenshot them. For visual checks use #3.
- Windows is enumerated *visible windows owned by the target PID* on the real desktop — that number must be 0.

## Verified on this machine (2026-10-30)

| Target | Method | Result |
|---|---|---|
| `charmap.exe` | `run_hidden` harness tool | survived 3 s, **0** real-desktop windows |
| `charmap.exe` | standalone runner | survived 5 s, **0** real-desktop windows, cleaned up |
| Electron launcher (unmodified) | hidden desktop | survived 8 s, **0** real-desktop windows |
| Electron launcher | `LAUNCHER_HIDDEN=1` + CDP | **0** windows; CDP screenshot OK (v1.3.0, 1100×680) |

## Going forward

- Anything that might show UI goes through `run_hidden` (or the runner), or gets a headless switch (preferred when a
  visual check is the point).
- Never leave a window, process or port behind: the runner kills the tree, and CDP runs kill + free ports in the
  same command.
